-- phase43_mpesa_c2b_inbox.sql   -- NOT YET RUN on any database. Run on STAGING first. Re-runnable.
--
-- WHY
--   Until now M-Pesa worked only two ways: the till sends an STK prompt, or the cashier types a code from the customer's
--   SMS. Nothing told the system about a payment the CUSTOMER started on their own (Lipa na M-Pesa Till / Paybill).
--   Example: Joy pays KES 3,000 to the till. The cashier opens "Received payments", sees
--   "JOY W. . KES 3,000 . SHK7X9ABCD . 10:42", picks Joy's bill and taps Clear bill. The bill turns PAID.
--
-- HOW (Safaricom "C2B"): Safaricom calls our Edge Function `c2b-hook` for every payment to the shortcode. The function
--   hands the payload to record_mpesa_c2b() below, which stores it in lb_mpesa_c2b_payments (the INBOX). Nothing is paid
--   by that alone: money only reaches a bill when a cashier allocates it (pos_apply_mpesa_c2b), through the SAME functions
--   the app already uses (settle_folio, record_customer_payment, record_rent_invoice_payment), so receipts, balances,
--   reports and the daily closing stay consistent.
--
-- SAFETY RULES BUILT IN
--   * Same M-Pesa code can never enter twice (Safaricom does retry): UNIQUE (tenant_id, trans_id), insert is idempotent.
--   * A code can never be used for more than its amount; partial use is tracked (amount_used) and every use is a row in
--     lb_mpesa_c2b_allocations (who, when, which bill, how much).
--   * A code already recorded another way (typed at the till, STK prompt, typed on a folio/customer/rent payment) is marked
--     USED the moment either side sees it, so the same SMS cannot pay two bills.
--   * Who may do what: see the inbox, apply a payment -> payments.record (cashier and up). Set a payment aside (IGNORED)
--     or bring it back -> payments.approve (manager and up). Turn on / register the shortcode URLs -> settings.manage.
--   * The Safaricom URL carries a long random token that lives in lb_mpesa_secrets (deny-all table). A cashier's browser
--     can read lb_mpesa_config but NEVER the token, so nobody on staff can fake a "payment" into the inbox.
--   * lb_mpesa_c2b_payments / allocations cannot be written by a client at all (no INSERT/UPDATE/DELETE grant).
--
-- RUN ORDER: after phase12, phase13, phase17, phase19, phase28, phase39. (Needs lb_folios, lb_rent_invoices, record_customer_payment.)
--
-- AFTER RUNNING: deploy the two Edge Functions in supabase/functions (c2b-hook, c2b-register), then in the app:
--   M-Pesa -> Setup -> "Receive payments made to my till" -> Turn on. (That registers the URLs with Safaricom.)
--   NOTE: Safaricom refuses URLs containing words like "mpesa" or "safaricom", which is why the function is called c2b-hook.
--
-- ROLLBACK: DROP TRIGGER trg_c2b_manual_use_* ...; DROP FUNCTION record_mpesa_c2b(text,jsonb), pos_apply_mpesa_c2b(...), pos_ignore_mpesa_c2b(...),
--   pos_c2b_suggest(uuid), _c2b_note_manual_use(); DROP TABLE lb_mpesa_c2b_allocations, lb_mpesa_c2b_payments;
--   ALTER TABLE lb_mpesa_secrets DROP COLUMN c2b_token; ALTER TABLE lb_mpesa_config DROP COLUMN c2b_enabled, DROP COLUMN c2b_registered_at.

DO $$ BEGIN
  IF to_regprocedure('pos_require(text[])') IS NULL THEN RAISE EXCEPTION 'phase43 needs phase28_permissions.sql first.'; END IF;
  IF to_regclass('public.lb_mpesa_secrets') IS NULL THEN RAISE EXCEPTION 'phase43 needs phase13_mpesa_client_credentials.sql first.'; END IF;
  IF to_regclass('public.lb_folios') IS NULL THEN RAISE EXCEPTION 'phase43 needs phase19_folios.sql first.'; END IF;
  IF to_regclass('public.lb_rent_invoice_summary') IS NULL THEN RAISE EXCEPTION 'phase43 needs phase17_invoices_maintenance.sql first.'; END IF;
  IF to_regclass('public.lb_mpesa_transactions') IS NULL THEN RAISE EXCEPTION 'phase43 needs phase12_mpesa.sql first.'; END IF;
END $$;

-- ---------- 0. config: token (secret) + status flags (not secret) ----------
ALTER TABLE lb_mpesa_secrets ADD COLUMN IF NOT EXISTS c2b_token text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_mpesa_secrets_c2b_token ON lb_mpesa_secrets (c2b_token) WHERE c2b_token IS NOT NULL;
ALTER TABLE lb_mpesa_config ADD COLUMN IF NOT EXISTS c2b_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE lb_mpesa_config ADD COLUMN IF NOT EXISTS c2b_registered_at timestamptz;

-- ---------- 1. the inbox ----------
CREATE TABLE IF NOT EXISTS lb_mpesa_c2b_payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  business_id   uuid NOT NULL REFERENCES lb_businesses(id),
  trans_id      text NOT NULL,                      -- the M-Pesa code, upper case, letters and digits only
  trans_type    text,                               -- 'Pay Bill' or 'Buy Goods'
  trans_time    timestamptz NOT NULL,               -- when Safaricom says it happened
  amount        numeric(15,2) NOT NULL CHECK (amount > 0),
  shortcode     text,
  bill_ref_number text,                             -- the "account number" a Paybill payer typed (often a folio / invoice number)
  invoice_number text,
  msisdn        text,                               -- as received. Safaricom now sends this HASHED, so never rely on it
  first_name    text, middle_name text, last_name text,
  payer_name    text,                               -- first + middle + last, as Safaricom sent it
  org_balance   numeric(15,2),
  status        text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','PARTLY_USED','USED','IGNORED')),
  amount_used   numeric(15,2) NOT NULL DEFAULT 0,
  note          text,                               -- why it is USED / IGNORED when no allocation explains it
  raw           jsonb,
  received_at   timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lb_c2b_used_within_amount CHECK (amount_used >= 0 AND amount_used <= amount)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_c2b_trans ON lb_mpesa_c2b_payments (tenant_id, trans_id);
CREATE INDEX IF NOT EXISTS idx_lb_c2b_business_time ON lb_mpesa_c2b_payments (business_id, trans_time DESC);
CREATE INDEX IF NOT EXISTS idx_lb_c2b_open ON lb_mpesa_c2b_payments (business_id) WHERE status IN ('NEW','PARTLY_USED');

CREATE TABLE IF NOT EXISTS lb_mpesa_c2b_allocations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  business_id uuid NOT NULL,
  c2b_id      uuid NOT NULL REFERENCES lb_mpesa_c2b_payments(id),
  target_type text NOT NULL CHECK (target_type IN ('FOLIO','CUSTOMER','RENT_INVOICE')),
  target_id   uuid NOT NULL,
  amount      numeric(15,2) NOT NULL CHECK (amount > 0),
  result      jsonb,                                -- e.g. invoice / receipt numbers, "paid in full"
  applied_by  uuid,
  applied_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lb_c2b_alloc_c2b ON lb_mpesa_c2b_allocations (c2b_id);

-- Staff may READ their own business's inbox (the Received payments screen needs payments.record to be useful, and the
-- screen is hidden without it); nobody can write except through the SECURITY DEFINER functions below.
-- The restrictive policy keeps people with no money permission (e.g. storekeeper, HR officer) from reading it directly.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['lb_mpesa_c2b_payments','lb_mpesa_c2b_allocations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%I ON %I', t, t);
    EXECUTE format('CREATE POLICY tenant_isolation_%I ON %I FOR SELECT USING (tenant_id = get_current_tenant_id())', t, t);
    EXECUTE format('DROP POLICY IF EXISTS money_permission_%I ON %I', t, t);
    EXECUTE format('CREATE POLICY money_permission_%I ON %I AS RESTRICTIVE FOR SELECT USING (NOT is_pos_session() OR pos_has_permission(''payments.record'') OR pos_has_permission(''finance.view''))', t, t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON %I TO authenticated', t);
  END LOOP;
END $$;

-- ---------- 2. a code recorded another way: mark the inbox row USED ----------
-- Fires after a payment row carrying an M-Pesa code is inserted by hand (till sale, folio, customer payment, rent payment).
-- Skipped while pos_apply_mpesa_c2b() itself is writing (it sets the transaction-local flag pos.c2b_apply).
CREATE OR REPLACE FUNCTION _c2b_note_manual_use() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_code text; v_ref text; v_method text;
BEGIN
  IF coalesce(current_setting('pos.c2b_apply', true), '') = 'on' THEN RETURN NEW; END IF;
  v_ref := to_jsonb(NEW) ->> 'reference_no';
  v_method := upper(coalesce(to_jsonb(NEW) ->> 'payment_method', ''));
  IF v_ref IS NULL OR v_method <> 'MOBILE_MONEY' THEN RETURN NEW; END IF;
  v_code := upper(regexp_replace(v_ref, '[^A-Za-z0-9]', '', 'g'));
  IF v_code = '' THEN RETURN NEW; END IF;
  UPDATE lb_mpesa_c2b_payments
     SET status = 'USED', amount_used = amount, updated_at = now(),
         note = coalesce(note || ' | ', '') || 'Recorded by hand on ' || TG_TABLE_NAME
   WHERE tenant_id = (to_jsonb(NEW) ->> 'tenant_id')::uuid AND trans_id = v_code AND status IN ('NEW','PARTLY_USED');
  RETURN NEW;
END $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['lb_payments','lb_folio_payments','lb_customer_payments','lb_rent_invoice_payments'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_c2b_manual_use_%s ON %I', t, t);
      EXECUTE format('CREATE TRIGGER trg_c2b_manual_use_%s AFTER INSERT ON %I FOR EACH ROW EXECUTE FUNCTION _c2b_note_manual_use()', t, t);
    ELSE
      RAISE NOTICE 'phase43: % not found here, its trigger is skipped', t;
    END IF;
  END LOOP;
END $$;

-- ---------- 3. receive a payment from Safaricom (called ONLY by the c2b-hook Edge Function, service role) ----------
-- p_payload is Safaricom's confirmation body as-is:
--   {"TransactionType":"Pay Bill","TransID":"SHK7X9ABCD","TransTime":"20261104104212","TransAmount":"3000.00",
--    "BusinessShortCode":"174379","BillRefNumber":"FOL-0012","InvoiceNumber":"","OrgAccountBalance":"49197.00",
--    "ThirdPartyTransID":"","MSISDN":"2547 ****** 126","FirstName":"JOY","MiddleName":"","LastName":"WANJIKU"}
-- Returns {ok, id, duplicate, status}. An unknown token or a shortcode that does not match is an ERROR (the Edge Function
-- still answers Safaricom "accepted" and logs it). A repeat of the same code returns the first row (duplicate = true).
CREATE OR REPLACE FUNCTION record_mpesa_c2b(p_token text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_sec lb_mpesa_secrets%ROWTYPE; v_cfg lb_mpesa_config%ROWTYPE;
  v_code text; v_amount numeric; v_when timestamptz; v_ts text; v_row lb_mpesa_c2b_payments%ROWTYPE;
  v_name text; v_status text := 'NEW'; v_used numeric := 0; v_note text; v_sale uuid;
BEGIN
  IF p_token IS NULL OR length(p_token) < 24 THEN RAISE EXCEPTION 'Unknown C2B token.'; END IF;
  SELECT * INTO v_sec FROM lb_mpesa_secrets WHERE c2b_token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown C2B token.'; END IF;
  SELECT * INTO v_cfg FROM lb_mpesa_config WHERE business_id = v_sec.business_id;
  IF NOT FOUND OR NOT v_cfg.c2b_enabled THEN RAISE EXCEPTION 'Receiving payments is switched off for this business.'; END IF;
  IF btrim(coalesce(p_payload ->> 'BusinessShortCode', '')) <> btrim(v_cfg.shortcode) THEN
    RAISE EXCEPTION 'Shortcode % does not match this business.', p_payload ->> 'BusinessShortCode';
  END IF;

  v_code := upper(regexp_replace(coalesce(p_payload ->> 'TransID', ''), '[^A-Za-z0-9]', '', 'g'));
  IF v_code = '' THEN RAISE EXCEPTION 'The payment has no M-Pesa code.'; END IF;
  BEGIN v_amount := (p_payload ->> 'TransAmount')::numeric; EXCEPTION WHEN others THEN v_amount := NULL; END;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'The payment has no valid amount.'; END IF;
  v_ts := p_payload ->> 'TransTime';
  BEGIN v_when := to_timestamp(v_ts, 'YYYYMMDDHH24MISS') AT TIME ZONE 'Africa/Nairobi';   -- Safaricom sends East Africa Time
  EXCEPTION WHEN others THEN v_when := now(); END;
  v_name := nullif(btrim(concat_ws(' ', nullif(btrim(p_payload ->> 'FirstName'), ''), nullif(btrim(p_payload ->> 'MiddleName'), ''), nullif(btrim(p_payload ->> 'LastName'), ''))), '');

  -- already recorded by Safaricom's retry? return the first one, unchanged
  SELECT * INTO v_row FROM lb_mpesa_c2b_payments WHERE tenant_id = v_sec.tenant_id AND trans_id = v_code;
  IF FOUND THEN RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'duplicate', true, 'status', v_row.status); END IF;

  -- already recorded another way (typed at the till, or an STK prompt with the same receipt)?
  SELECT p.sale_id INTO v_sale FROM lb_payments p
   WHERE p.tenant_id = v_sec.tenant_id AND p.payment_method = 'MOBILE_MONEY'
     AND upper(regexp_replace(coalesce(p.reference_no, ''), '[^A-Za-z0-9]', '', 'g')) = v_code LIMIT 1;
  IF FOUND THEN
    v_status := 'USED'; v_used := v_amount; v_note := 'Already recorded on a till sale before it arrived here.';
  ELSIF EXISTS (SELECT 1 FROM lb_mpesa_transactions t WHERE t.tenant_id = v_sec.tenant_id AND upper(t.mpesa_receipt_number) = v_code) THEN
    v_status := 'USED'; v_used := v_amount; v_note := 'Already received through a payment prompt (STK).';
  ELSIF EXISTS (SELECT 1 FROM lb_folio_payments p WHERE p.tenant_id = v_sec.tenant_id AND upper(regexp_replace(coalesce(p.reference_no, ''), '[^A-Za-z0-9]', '', 'g')) = v_code) THEN
    v_status := 'USED'; v_used := v_amount; v_note := 'Already recorded on a customer bill (folio).';
  END IF;

  INSERT INTO lb_mpesa_c2b_payments (tenant_id, business_id, trans_id, trans_type, trans_time, amount, shortcode, bill_ref_number, invoice_number,
      msisdn, first_name, middle_name, last_name, payer_name, org_balance, status, amount_used, note, raw)
  VALUES (v_sec.tenant_id, v_sec.business_id, v_code, p_payload ->> 'TransactionType', v_when, v_amount, p_payload ->> 'BusinessShortCode',
      nullif(btrim(p_payload ->> 'BillRefNumber'), ''), nullif(btrim(p_payload ->> 'InvoiceNumber'), ''), p_payload ->> 'MSISDN',
      nullif(btrim(p_payload ->> 'FirstName'), ''), nullif(btrim(p_payload ->> 'MiddleName'), ''), nullif(btrim(p_payload ->> 'LastName'), ''),
      v_name, nullif(p_payload ->> 'OrgAccountBalance', '')::numeric, v_status, v_used, v_note, p_payload)
  ON CONFLICT (tenant_id, trans_id) DO NOTHING
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN   -- two retries at the same instant: the other one won
    SELECT * INTO v_row FROM lb_mpesa_c2b_payments WHERE tenant_id = v_sec.tenant_id AND trans_id = v_code;
    RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'duplicate', true, 'status', v_row.status);
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'duplicate', false, 'status', v_row.status);
END $$;

-- ---------- 4. suggestions: which bills could this payment belong to? ----------
-- Scores open bills by: exact amount, the payer typed the bill number, payer's name matches the customer's name.
-- Returns the best 8. A hint, never an automatic match: a person always taps the bill.
CREATE OR REPLACE FUNCTION pos_c2b_suggest(p_c2b_id uuid)
RETURNS TABLE (target_type text, target_id uuid, label text, customer_name text, balance numeric, score integer, reasons text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE c lb_mpesa_c2b_payments%ROWTYPE; v_payer text;
BEGIN
  PERFORM pos_require('payments.record', 'finance.view');
  SELECT * INTO c FROM lb_mpesa_c2b_payments WHERE id = p_c2b_id AND tenant_id = get_current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;
  v_payer := lower(regexp_replace(coalesce(c.payer_name, ''), '[^A-Za-z ]', ' ', 'g'));

  RETURN QUERY
  WITH bills AS (
    -- open customer folios (running bills)
    SELECT 'FOLIO'::text AS ttype, f.id AS tid,
           'Folio ' || f.folio_number || coalesce(' . ' || f.title, '') AS lbl,
           cu.name AS cname, f.balance_due AS bal, f.folio_number AS refno
      FROM lb_folio_summary f JOIN lb_customers cu ON cu.id = f.customer_id
     WHERE f.tenant_id = get_current_tenant_id() AND f.business_id = c.business_id AND f.status = 'OPEN' AND f.balance_due > 0
    UNION ALL
    -- customers who owe on credit
    SELECT 'CUSTOMER', cu.id, 'Credit account . ' || cu.name, cu.name, cu.outstanding_balance, NULL
      FROM lb_customers cu
     WHERE cu.tenant_id = get_current_tenant_id() AND (cu.business_id IS NULL OR cu.business_id = c.business_id) AND cu.outstanding_balance > 0
    UNION ALL
    -- issued rent invoices with something left to pay
    SELECT 'RENT_INVOICE', r.id, 'Rent invoice ' || r.invoice_number, cu.name, r.balance_due, r.invoice_number
      FROM lb_rent_invoice_summary r JOIN lb_customers cu ON cu.id = r.customer_id
     WHERE r.tenant_id = get_current_tenant_id() AND r.business_id = c.business_id AND r.status = 'ISSUED' AND r.balance_due > 0
  ), scored AS (
    SELECT b.*,
      (SELECT count(*) FROM (SELECT DISTINCT x FROM unnest(string_to_array(v_payer, ' ')) x WHERE length(x) >= 3) a
        WHERE EXISTS (SELECT 1 FROM unnest(string_to_array(lower(regexp_replace(coalesce(b.cname, ''), '[^A-Za-z ]', ' ', 'g')), ' ')) y WHERE y = a.x))::integer AS name_hits,
      (b.bal = c.amount) AS exact,
      (c.amount < b.bal) AS partial,
      (b.refno IS NOT NULL AND upper(regexp_replace(coalesce(c.bill_ref_number, c.invoice_number, ''), '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(b.refno, '[^A-Za-z0-9]', '', 'g'))) AS refhit
      FROM bills b
  )
  SELECT s.ttype, s.tid, s.lbl, s.cname, s.bal,
         (CASE WHEN s.refhit THEN 60 ELSE 0 END + s.name_hits * 30 + CASE WHEN s.exact THEN 40 WHEN s.partial THEN 5 ELSE 0 END)::integer,
         concat_ws(', ', CASE WHEN s.refhit THEN 'bill number matches' END,
                         CASE WHEN s.name_hits > 0 THEN 'name matches' END,
                         CASE WHEN s.exact THEN 'exact amount' WHEN s.partial THEN 'part payment' END)
    FROM scored s
   WHERE s.refhit OR s.name_hits > 0 OR s.exact
   ORDER BY 6 DESC, s.bal DESC
   LIMIT 8;
END $$;

-- ---------- 5. clear a bill with a received payment ----------
-- p_target_type: FOLIO | CUSTOMER | RENT_INVOICE.   p_amount NULL = as much as the bill needs or the payment has left (the smaller).
-- FOLIO: pays the folio; if that clears the balance the folio is SETTLED (invoice + receipt numbers are returned), otherwise it
--        stays OPEN with a part payment. CUSTOMER: records a customer payment against their credit balance.
-- RENT_INVOICE: the existing rule is one whole payment per M-Pesa code, so the full remaining amount is used.
CREATE OR REPLACE FUNCTION pos_apply_mpesa_c2b(p_c2b_id uuid, p_target_type text, p_target_id uuid, p_amount numeric DEFAULT NULL, p_by uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  c lb_mpesa_c2b_payments%ROWTYPE; v_left numeric; v_amt numeric; v_res jsonb := '{}'::jsonb;
  v_f lb_folios; v_charges numeric; v_paid numeric; v_bal numeric; v_settle jsonb;
  v_cust lb_customers%ROWTYPE; v_inv lb_rent_invoice_summary%ROWTYPE; v_after numeric; v_new_status text;
BEGIN
  PERFORM pos_require('payments.record');
  SELECT * INTO c FROM lb_mpesa_c2b_payments WHERE id = p_c2b_id AND tenant_id = get_current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;
  IF c.status NOT IN ('NEW','PARTLY_USED') THEN
    RAISE EXCEPTION 'This M-Pesa payment (%) is already %: it cannot be used again.', c.trans_id, lower(replace(c.status, '_', ' '));
  END IF;
  v_left := c.amount - c.amount_used;
  IF v_left <= 0 THEN RAISE EXCEPTION 'This M-Pesa payment has nothing left to use.'; END IF;
  IF p_amount IS NOT NULL AND (p_amount <= 0 OR p_amount > v_left) THEN
    RAISE EXCEPTION 'You can use at most KES % of this payment.', v_left;
  END IF;

  PERFORM set_config('pos.c2b_apply', 'on', true);   -- the manual-use trigger must not mark our own write

  IF upper(p_target_type) = 'FOLIO' THEN
    v_f := _folio_for_update(p_target_id);                        -- raises "Folio not found" for another tenant's folio
    IF v_f.business_id <> c.business_id THEN RAISE EXCEPTION 'That bill belongs to a different business.'; END IF;
    IF v_f.status <> 'OPEN' THEN RAISE EXCEPTION 'That folio is already %.', lower(v_f.status); END IF;
    SELECT coalesce(sum(amount), 0) INTO v_charges FROM lb_folio_lines WHERE folio_id = v_f.id AND status = 'POSTED';
    SELECT coalesce(sum(amount), 0) INTO v_paid FROM lb_folio_payments WHERE folio_id = v_f.id;
    v_bal := v_charges - v_paid;
    IF v_bal <= 0 THEN RAISE EXCEPTION 'That folio has nothing to pay.'; END IF;
    v_amt := least(coalesce(p_amount, v_left), v_bal);
    IF p_amount IS NOT NULL AND p_amount > v_bal THEN
      RAISE EXCEPTION 'KES % is more than the bill (KES % left). Use KES % and keep the rest for another bill.', p_amount, v_bal, v_bal;
    END IF;
    IF v_amt = v_bal THEN
      v_settle := settle_folio(v_f.id, jsonb_build_array(jsonb_build_object('payment_method', 'MOBILE_MONEY', 'amount', v_amt, 'reference_no', c.trans_id)), p_by, NULL);
      v_res := v_settle || jsonb_build_object('paid_in_full', true, 'balance_after', 0, 'status', 'SETTLED');
    ELSE
      INSERT INTO lb_folio_payments (tenant_id, business_id, folio_id, payment_method, amount, reference_no, created_by)
      VALUES (v_f.tenant_id, v_f.business_id, v_f.id, 'MOBILE_MONEY', v_amt, c.trans_id, p_by);
      v_res := jsonb_build_object('paid_in_full', false, 'balance_after', v_bal - v_amt, 'status', 'OPEN', 'folio_id', v_f.id);
    END IF;

  ELSIF upper(p_target_type) = 'CUSTOMER' THEN
    SELECT * INTO v_cust FROM lb_customers WHERE id = p_target_id AND tenant_id = get_current_tenant_id() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found.'; END IF;
    IF coalesce(v_cust.outstanding_balance, 0) <= 0 THEN RAISE EXCEPTION '% owes nothing on credit.', v_cust.name; END IF;
    v_amt := least(coalesce(p_amount, v_left), v_cust.outstanding_balance);
    IF p_amount IS NOT NULL AND p_amount > v_cust.outstanding_balance THEN
      RAISE EXCEPTION 'KES % is more than % owes (KES %).', p_amount, v_cust.name, v_cust.outstanding_balance;
    END IF;
    PERFORM record_customer_payment(
      p_business_id => c.business_id, p_branch_id => NULL, p_customer_id => v_cust.id, p_amount => v_amt,
      p_payment_method => 'MOBILE_MONEY', p_reference_no => c.trans_id,
      p_notes => 'M-Pesa received payment ' || c.trans_id || coalesce(' from ' || c.payer_name, ''), p_created_by => p_by);
    SELECT outstanding_balance INTO v_after FROM lb_customers WHERE id = v_cust.id;
    v_res := jsonb_build_object('paid_in_full', v_after <= 0, 'balance_after', v_after, 'status', CASE WHEN v_after <= 0 THEN 'CLEARED' ELSE 'PART_PAID' END, 'customer_id', v_cust.id);

  ELSIF upper(p_target_type) = 'RENT_INVOICE' THEN
    SELECT * INTO v_inv FROM lb_rent_invoice_summary WHERE id = p_target_id AND tenant_id = get_current_tenant_id();
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found.'; END IF;
    IF v_inv.business_id <> c.business_id THEN RAISE EXCEPTION 'That invoice belongs to a different business.'; END IF;
    IF p_amount IS NOT NULL AND p_amount <> v_left THEN
      RAISE EXCEPTION 'A rent invoice takes the whole M-Pesa payment (KES %) in one go.', v_left;
    END IF;
    v_amt := v_left;
    IF v_amt > v_inv.balance_due + 0.004 THEN
      RAISE EXCEPTION 'KES % is more than the invoice balance (KES %). Clear the invoice another way, or use a smaller payment.', v_amt, v_inv.balance_due;
    END IF;
    v_res := record_rent_invoice_payment(v_inv.id, v_amt, 'MOBILE_MONEY', c.trans_id, 'M-Pesa received payment from ' || coalesce(c.payer_name, 'customer'), p_by, 'MPESA_MANUAL', NULL);
    v_res := coalesce(v_res, '{}'::jsonb) || jsonb_build_object('paid_in_full', v_amt >= v_inv.balance_due - 0.004);
  ELSE
    RAISE EXCEPTION 'Unknown bill type %.', p_target_type;
  END IF;

  INSERT INTO lb_mpesa_c2b_allocations (tenant_id, business_id, c2b_id, target_type, target_id, amount, result, applied_by)
  VALUES (c.tenant_id, c.business_id, c.id, upper(p_target_type), p_target_id, v_amt, v_res, p_by);
  v_new_status := CASE WHEN c.amount_used + v_amt >= c.amount THEN 'USED' ELSE 'PARTLY_USED' END;
  UPDATE lb_mpesa_c2b_payments SET amount_used = amount_used + v_amt, status = v_new_status, updated_at = now() WHERE id = c.id;

  RETURN v_res || jsonb_build_object('c2b_id', c.id, 'applied', v_amt, 'left_on_payment', v_left - v_amt, 'trans_id', c.trans_id);
END $$;

-- ---------- 6. set aside / bring back ----------
-- For a payment that is not for any bill here (wrong shortcode, personal, to be refunded). Manager and up. A payment that
-- is already part-used cannot be set aside. The reason is required and kept.
CREATE OR REPLACE FUNCTION pos_ignore_mpesa_c2b(p_c2b_id uuid, p_reason text, p_ignore boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE c lb_mpesa_c2b_payments%ROWTYPE;
BEGIN
  PERFORM pos_require('payments.approve');
  SELECT * INTO c FROM lb_mpesa_c2b_payments WHERE id = p_c2b_id AND tenant_id = get_current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;
  IF p_ignore THEN
    IF c.status <> 'NEW' THEN RAISE EXCEPTION 'Only a payment nobody has used can be set aside (this one is %).', lower(replace(c.status, '_', ' ')); END IF;
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'Please say why this payment is being set aside.'; END IF;
    UPDATE lb_mpesa_c2b_payments SET status = 'IGNORED', note = btrim(p_reason), updated_at = now() WHERE id = c.id;
  ELSE
    IF c.status <> 'IGNORED' THEN RAISE EXCEPTION 'This payment is not set aside.'; END IF;
    UPDATE lb_mpesa_c2b_payments SET status = 'NEW', note = coalesce(note, '') || ' | brought back', updated_at = now() WHERE id = c.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', c.id);
END $$;

REVOKE ALL ON FUNCTION record_mpesa_c2b(text, jsonb), pos_c2b_suggest(uuid), pos_apply_mpesa_c2b(uuid, text, uuid, numeric, uuid),
  pos_ignore_mpesa_c2b(uuid, text, boolean), _c2b_note_manual_use() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_mpesa_c2b(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION pos_c2b_suggest(uuid), pos_apply_mpesa_c2b(uuid, text, uuid, numeric, uuid), pos_ignore_mpesa_c2b(uuid, text, boolean) TO authenticated;
