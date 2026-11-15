-- phase50_etims_queue.sql   -- NOT YET RUN. STAGING first. Re-runnable. Needs phase48 + phase49.
--
-- KRA eTIMS PHASE 4: the invoice queue. Dormant until a business turns tax invoices ON (pos_etims_set_enabled).
-- Nothing here edits a sale, a receipt, a till function or Daraja. The queue is fed by a trigger on lb_receipts that can never
-- raise (an exception inside it is swallowed), plus a sweeper that catches anything it missed.
--
-- THE RULES THIS FILE ENFORCES
--   * One tax invoice per sale (unique index from phase48). Its KRA invoice number is allocated ONCE, here, and never again.
--   * The exact body sent to KRA is stored (snapshot) and cannot change. A retry resends the same body and the same number.
--   * A timeout AFTER the request was sent is "unconfirmed": nothing resends it automatically (KRA gives no way to look a sent
--     sale up, and its duplicate behaviour is not documented). The owner decides. A failure BEFORE anything was sent just retries.
--   * KRA being down only ever delays an invoice. lb_sales is never written.
--   * A sale that cannot be turned into an invoice (item without KRA codes, tax rate unknown...) is listed with the reason, not dropped.
--
-- ASSUMPTIONS TO PROVE IN THE SANDBOX (the spec text is silent): credit-note amounts are sent positive with rcptTyCd 'R' and
-- salesSttsCd '05'; credit notes share the sale invoice-number counter; item tax field is `taxAmt` (as in the spec's JSON sample).
-- ROLLBACK: DROP TRIGGER trg_etims_receipt_enqueue ON lb_receipts; DROP TRIGGER trg_etims_sale_void ON lb_sales; DROP the functions
--   named etims_* / pos_etims_* created below; DROP TABLE lb_etims_skipped.

DO $$ BEGIN
  IF to_regclass('public.lb_etims_invoices') IS NULL OR to_regclass('public.lb_etims_secrets') IS NULL THEN
    RAISE EXCEPTION 'Run phase48 and phase49 first.';
  END IF;
END $$;

-- a reversed-but-never-sent invoice that KRA refused may also be closed (REJECTED -> CANCELLED_BEFORE_SEND)
CREATE OR REPLACE FUNCTION etims_invoice_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ETIMS_IMMUTABLE: tax documents cannot be deleted' USING ERRCODE = 'P0001'; END IF;
  IF (NEW.snapshot, NEW.snapshot_hash, NEW.invoice_no, NEW.sale_id, NEW.doc_type, NEW.business_id, NEW.tenant_id, NEW.original_invoice_id)
     IS DISTINCT FROM (OLD.snapshot, OLD.snapshot_hash, OLD.invoice_no, OLD.sale_id, OLD.doc_type, OLD.business_id, OLD.tenant_id, OLD.original_invoice_id) THEN
    RAISE EXCEPTION 'ETIMS_IMMUTABLE: the invoice content and number cannot change after it is created' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status IN ('ACCEPTED','CANCELLED_BEFORE_SEND') THEN
      RAISE EXCEPTION 'ETIMS_FINAL: an % invoice cannot change status', OLD.status USING ERRCODE = 'P0001';
    END IF;
    IF NOT ((OLD.status, NEW.status) IN (
        ('PENDING','SENDING'), ('PENDING','CANCELLED_BEFORE_SEND'),
        ('SENDING','PENDING'), ('SENDING','ACCEPTED'), ('SENDING','REJECTED'), ('SENDING','SENT_UNCONFIRMED'),
        ('SENT_UNCONFIRMED','ACCEPTED'), ('SENT_UNCONFIRMED','REJECTED'), ('SENT_UNCONFIRMED','PENDING'), ('SENT_UNCONFIRMED','SENDING'),
        ('REJECTED','PENDING'), ('REJECTED','CANCELLED_BEFORE_SEND'))) THEN
      RAISE EXCEPTION 'ETIMS_BAD_TRANSITION: % -> % is not allowed', OLD.status, NEW.status USING ERRCODE = 'P0001';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- sales that could not be turned into an invoice yet, with the reason in plain words (rebuilt by the sweeper)
CREATE TABLE IF NOT EXISTS lb_etims_skipped (
  sale_id     uuid PRIMARY KEY REFERENCES lb_sales(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  reason_code text NOT NULL,
  reason_text text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE lb_etims_skipped ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON lb_etims_skipped FROM PUBLIC, anon, authenticated;
GRANT SELECT ON lb_etims_skipped TO authenticated;
DROP POLICY IF EXISTS etims_skipped_read ON lb_etims_skipped;
CREATE POLICY etims_skipped_read ON lb_etims_skipped FOR SELECT
  USING (tenant_id = get_current_tenant_id() AND (NOT is_pos_session() OR pos_has_permission('settings.manage') OR pos_has_permission('finance.view')));

-- ---------- tax rate for one KRA tax code, read from KRA's own synced list (never typed in here) ----------
-- KRA labels carry the rate ("B-16.00%", "C-0%"). Exempt (A) and non-VAT (D) have no percentage and are 0 by definition.
CREATE OR REPLACE FUNCTION etims_tax_rate(p_env text, p_code text) RETURNS numeric
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v_name text; v_desc text; m text[];
BEGIN
  SELECT name, extra ->> 'desc' INTO v_name, v_desc FROM lb_etims_code_lists WHERE environment = p_env AND list_name = 'tax_type' AND code = p_code;
  IF NOT FOUND THEN RETURN NULL; END IF;
  m := regexp_match(coalesce(v_name,'') || ' ' || coalesce(v_desc,''), '(\d+(?:\.\d+)?)\s*%');
  IF m IS NOT NULL THEN RETURN m[1]::numeric; END IF;
  IF p_code IN ('A','D') THEN RETURN 0; END IF;
  RETURN NULL;     -- unknown: the sale is held back rather than guessed
END $$;

CREATE OR REPLACE FUNCTION etims_nairobi(p_ts timestamptz, p_fmt text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT to_char(p_ts AT TIME ZONE 'Africa/Nairobi', p_fmt) $$;

-- ---------- build the body for one sale. Raises 'ETIMS_SKIP:<code>|<words>' when it cannot be built ----------
CREATE OR REPLACE FUNCTION etims_build_sale_body(p_sale lb_sales, p_cfg lb_etims_config, p_invoice_no bigint) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  it record; v_items jsonb := '[]'::jsonb; v_seq int := 0; v_rate numeric; v_tax numeric; v_taxbl numeric; v_line numeric; v_sply numeric;
  v_code text; v_tot numeric := 0; v_tottax numeric := 0; v_tottaxbl numeric := 0;
  v_taxbl_by jsonb := '{"A":0,"B":0,"C":0,"D":0,"E":0}'; v_tax_by jsonb := '{"A":0,"B":0,"C":0,"D":0,"E":0}'; v_rate_by jsonb := '{}';
  c text; v_cust record; v_pay text; v_now timestamptz := now(); v_h jsonb;
BEGIN
  IF NOT p_cfg.prices_include_tax THEN
    RAISE EXCEPTION 'ETIMS_SKIP:EXCLUSIVE_PRICES|Tax invoices need prices that include tax. Change this in Tax invoices settings.';
  END IF;
  IF p_sale.folio_id IS NOT NULL THEN RAISE EXCEPTION 'ETIMS_SKIP:FOLIO|Sales charged to a room or folio are not sent to KRA yet.'; END IF;

  FOR it IN
    SELECT si.*, p.name AS pname, p.barcode AS pbarcode, m.tax_code, m.item_class_code, m.unit_code, m.packaging_code, m.kra_item_code, m.registration_status
    FROM lb_sale_items si
    JOIN lb_products p ON p.id = si.product_id
    LEFT JOIN lb_etims_item_map m ON m.product_id = si.product_id AND m.business_id = p_cfg.business_id
    WHERE si.sale_id = p_sale.id ORDER BY si.id
  LOOP
    IF it.tax_code IS NULL OR it.item_class_code IS NULL OR it.unit_code IS NULL OR it.packaging_code IS NULL THEN
      RAISE EXCEPTION 'ETIMS_SKIP:ITEM_NO_CODES|"%" has no KRA codes yet. Open the item and pick its tax type, class, unit and packaging.', it.pname;
    END IF;
    IF it.registration_status <> 'REGISTERED' OR it.kra_item_code IS NULL THEN
      RAISE EXCEPTION 'ETIMS_SKIP:ITEM_NOT_REGISTERED|"%" has not been registered with KRA yet.', it.pname;
    END IF;
    v_rate := etims_tax_rate(p_cfg.environment, it.tax_code);
    IF v_rate IS NULL THEN RAISE EXCEPTION 'ETIMS_SKIP:RATE_UNKNOWN|The tax rate for code % is not in the KRA list. Download the KRA lists again.', it.tax_code; END IF;
    v_seq := v_seq + 1;
    v_line := round(it.total_price, 2);                                  -- what the customer paid for this line (prices include tax)
    v_tax := round(v_line * v_rate / (100 + v_rate), 2);                 -- tax extracted from the inclusive amount
    v_taxbl := v_line - v_tax;
    v_sply := round(it.quantity * it.unit_price, 2);
    v_taxbl_by := jsonb_set(v_taxbl_by, ARRAY[it.tax_code], to_jsonb(coalesce((v_taxbl_by ->> it.tax_code)::numeric,0) + v_taxbl));
    v_tax_by   := jsonb_set(v_tax_by,   ARRAY[it.tax_code], to_jsonb(coalesce((v_tax_by ->> it.tax_code)::numeric,0) + v_tax));
    v_rate_by  := jsonb_set(v_rate_by,  ARRAY[it.tax_code], to_jsonb(v_rate));
    v_tot := v_tot + v_line; v_tottax := v_tottax + v_tax; v_tottaxbl := v_tottaxbl + v_taxbl;
    v_items := v_items || jsonb_build_object(
      'itemSeq', v_seq, 'itemClsCd', it.item_class_code, 'itemCd', it.kra_item_code, 'itemNm', left(it.pname, 200),
      'bcd', nullif(left(coalesce(it.pbarcode,''), 20), ''), 'pkgUnitCd', it.packaging_code, 'pkg', it.quantity,
      'qtyUnitCd', it.unit_code, 'qty', it.quantity, 'prc', it.unit_price, 'splyAmt', v_sply,
      'dcRt', CASE WHEN v_sply > 0 THEN round(coalesce(it.discount_amount,0) / v_sply * 100, 2) ELSE 0 END, 'dcAmt', coalesce(it.discount_amount,0),
      'taxTyCd', it.tax_code, 'taxblAmt', v_taxbl, 'taxAmt', v_tax, 'totAmt', v_line);
  END LOOP;
  IF v_seq = 0 THEN RAISE EXCEPTION 'ETIMS_SKIP:NO_ITEMS|This sale has no items.'; END IF;
  IF abs(v_tot - round(p_sale.total_amount, 2)) > 0.01 THEN
    RAISE EXCEPTION 'ETIMS_SKIP:TOTAL_MISMATCH|The item lines add up to % but the sale total is %.', v_tot, p_sale.total_amount;
  END IF;

  SELECT name, kra_pin INTO v_cust FROM lb_customers WHERE id = p_sale.customer_id AND tenant_id = p_sale.tenant_id;
  -- payment type (spec 4.11 classification): the method that carried most of the money
  SELECT CASE upper(payment_method) WHEN 'CASH' THEN '01' WHEN 'CREDIT' THEN '02' WHEN 'CARD' THEN '05' WHEN 'MOBILE_MONEY' THEN '06' ELSE '07' END
    INTO v_pay FROM lb_payments WHERE sale_id = p_sale.id ORDER BY amount DESC NULLS LAST LIMIT 1;

  v_h := jsonb_build_object(
    'trdInvcNo', left(coalesce(p_sale.sale_number, p_sale.id::text), 50), 'invcNo', p_invoice_no, 'orgInvcNo', 0,
    'custTin', nullif(v_cust.kra_pin, ''), 'custNm', nullif(left(coalesce(v_cust.name,''), 60), ''),
    'rcptTyCd', 'S', 'pmtTyCd', coalesce(v_pay, '01'), 'salesSttsCd', '02',
    'cfmDt', etims_nairobi(v_now, 'YYYYMMDDHH24MISS'), 'salesDt', etims_nairobi(coalesce(p_sale.completed_at, v_now), 'YYYYMMDD'),
    'totItemCnt', v_seq, 'totTaxblAmt', v_tottaxbl, 'totTaxAmt', v_tottax, 'totAmt', v_tot,
    'prchrAcptcYn', 'N', 'remark', NULL, 'regrId', 'umova', 'regrNm', 'Umova', 'modrId', 'umova', 'modrNm', 'Umova');
  FOREACH c IN ARRAY ARRAY['A','B','C','D','E'] LOOP
    v_h := v_h || jsonb_build_object('taxblAmt'||c, (v_taxbl_by ->> c)::numeric, 'taxRt'||c, coalesce((v_rate_by ->> c)::numeric, 0), 'taxAmt'||c, (v_tax_by ->> c)::numeric);
  END LOOP;
  RETURN jsonb_build_object('body', v_h || jsonb_build_object(
      'receipt', jsonb_build_object('custTin', nullif(v_cust.kra_pin,''), 'rcptPbctDt', etims_nairobi(v_now, 'YYYYMMDDHH24MISS'), 'prchrAcptcYn', 'N'),
      'itemList', v_items),
    'built_at', v_now);
END $$;

-- ---------- queue one sale ----------
CREATE OR REPLACE FUNCTION etims_enqueue_sale(p_sale_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s lb_sales; cfg lb_etims_config; v_no bigint; v_snap jsonb; v_msg text;
BEGIN
  SELECT * INTO s FROM lb_sales WHERE id = p_sale_id;
  IF s.id IS NULL OR s.business_id IS NULL OR s.status IS DISTINCT FROM 'COMPLETED' THEN RETURN 'IGNORED'; END IF;
  SELECT * INTO cfg FROM lb_etims_config WHERE business_id = s.business_id;
  IF cfg.id IS NULL OR NOT cfg.enabled OR cfg.go_live_at IS NULL THEN RETURN 'OFF'; END IF;
  IF coalesce(s.completed_at, now()) < cfg.go_live_at THEN RETURN 'BEFORE_GO_LIVE'; END IF;
  IF EXISTS (SELECT 1 FROM lb_etims_invoices WHERE sale_id = s.id AND doc_type = 'SALE') THEN RETURN 'EXISTS'; END IF;

  -- serialise per sale so a trigger and the sweeper can never both allocate a number for it
  PERFORM pg_advisory_xact_lock(hashtextextended('etims-sale:' || s.id::text, 0));
  IF EXISTS (SELECT 1 FROM lb_etims_invoices WHERE sale_id = s.id AND doc_type = 'SALE') THEN RETURN 'EXISTS'; END IF;

  BEGIN
    -- build with a provisional number first; the real number is taken only once the body is known to be buildable
    PERFORM etims_build_sale_body(s, cfg, 0);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ETIMS_SKIP:%' THEN
      v_msg := substr(SQLERRM, 12);
      INSERT INTO lb_etims_skipped (sale_id, tenant_id, business_id, reason_code, reason_text)
        VALUES (s.id, s.tenant_id, s.business_id, split_part(v_msg,'|',1), substr(v_msg, position('|' in v_msg) + 1))
        ON CONFLICT (sale_id) DO UPDATE SET reason_code = EXCLUDED.reason_code, reason_text = EXCLUDED.reason_text, updated_at = now();
      RETURN 'SKIPPED';
    END IF;
    RAISE;
  END;
  v_no := etims_next_invoice_no(s.business_id, 'SALE');
  v_snap := etims_build_sale_body(s, cfg, v_no);
  INSERT INTO lb_etims_invoices (tenant_id, business_id, sale_id, doc_type, invoice_no, snapshot, snapshot_hash)
    VALUES (s.tenant_id, s.business_id, s.id, 'SALE', v_no, v_snap, md5(v_snap::text));
  DELETE FROM lb_etims_skipped WHERE sale_id = s.id;
  RETURN 'QUEUED';
END $$;

-- ---------- credit note / cancellation when a sale is reversed ----------
CREATE OR REPLACE FUNCTION etims_settle_void(p_sale_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s lb_sales; inv lb_etims_invoices; v_no bigint; v_body jsonb; v_snap jsonb; v_now timestamptz := now();
BEGIN
  SELECT * INTO s FROM lb_sales WHERE id = p_sale_id;
  IF s.id IS NULL OR s.status IS DISTINCT FROM 'VOIDED' THEN RETURN 'IGNORED'; END IF;
  SELECT * INTO inv FROM lb_etims_invoices WHERE sale_id = s.id AND doc_type = 'SALE';
  IF inv.id IS NULL THEN DELETE FROM lb_etims_skipped WHERE sale_id = s.id; RETURN 'NO_INVOICE'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('etims-void:' || s.id::text, 0));
  SELECT * INTO inv FROM lb_etims_invoices WHERE id = inv.id;           -- re-read under the lock

  IF inv.status IN ('PENDING','REJECTED') THEN                          -- KRA never accepted it: nothing to credit
    UPDATE lb_etims_invoices SET status = 'CANCELLED_BEFORE_SEND', last_error_message = 'Sale reversed before KRA accepted it.' WHERE id = inv.id;
    RETURN 'CANCELLED';
  ELSIF inv.status = 'ACCEPTED' THEN
    IF EXISTS (SELECT 1 FROM lb_etims_invoices WHERE original_invoice_id = inv.id AND doc_type = 'CREDIT_NOTE') THEN RETURN 'EXISTS'; END IF;
    v_no := etims_next_invoice_no(s.business_id, 'SALE');               -- same counter as sales: a number is never reused across types
    v_body := (inv.snapshot -> 'body') || jsonb_build_object(
      'invcNo', v_no, 'orgInvcNo', (inv.snapshot -> 'body' ->> 'invcNo')::bigint, 'trdInvcNo', left((inv.snapshot -> 'body' ->> 'trdInvcNo') || '-CN', 50),
      'rcptTyCd', 'R', 'salesSttsCd', '05', 'rfdDt', etims_nairobi(v_now, 'YYYYMMDDHH24MISS'), 'rfdRsnCd', '06',
      'cfmDt', etims_nairobi(v_now, 'YYYYMMDDHH24MISS'), 'salesDt', etims_nairobi(v_now, 'YYYYMMDD'));
    v_body := jsonb_set(v_body, '{receipt,rcptPbctDt}', to_jsonb(etims_nairobi(v_now, 'YYYYMMDDHH24MISS')));
    v_snap := jsonb_build_object('body', v_body, 'built_at', v_now);
    INSERT INTO lb_etims_invoices (tenant_id, business_id, sale_id, doc_type, original_invoice_id, invoice_no, snapshot, snapshot_hash)
      VALUES (s.tenant_id, s.business_id, s.id, 'CREDIT_NOTE', inv.id, v_no, v_snap, md5(v_snap::text));
    RETURN 'CREDIT_NOTE_QUEUED';
  END IF;
  RETURN 'WAIT';                                                        -- SENDING / SENT_UNCONFIRMED: the sweeper settles it once the outcome is known
END $$;

-- ---------- triggers: can NEVER raise ----------
CREATE OR REPLACE FUNCTION etims_on_receipt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  BEGIN PERFORM etims_enqueue_sale(NEW.sale_id); EXCEPTION WHEN OTHERS THEN NULL; END;   -- the sweeper will pick it up
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_etims_receipt_enqueue ON lb_receipts;
CREATE TRIGGER trg_etims_receipt_enqueue AFTER INSERT ON lb_receipts FOR EACH ROW EXECUTE FUNCTION etims_on_receipt();

CREATE OR REPLACE FUNCTION etims_on_void() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  BEGIN PERFORM etims_settle_void(NEW.id); EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_etims_sale_void ON lb_sales;
CREATE TRIGGER trg_etims_sale_void AFTER UPDATE OF status ON lb_sales FOR EACH ROW
  WHEN (NEW.status = 'VOIDED' AND OLD.status IS DISTINCT FROM 'VOIDED') EXECUTE FUNCTION etims_on_void();

-- ---------- sweeper: queue anything the trigger skipped, retry held-back sales, settle pending reversals ----------
CREATE OR REPLACE FUNCTION etims_sweep(p_business uuid, p_limit int DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE cfg lb_etims_config; r record; v_q int := 0; v_s int := 0; v_v int := 0; res text;
BEGIN
  SELECT * INTO cfg FROM lb_etims_config WHERE business_id = p_business;
  IF cfg.id IS NULL OR NOT cfg.enabled OR cfg.go_live_at IS NULL THEN RETURN jsonb_build_object('queued',0,'skipped',0,'voids',0); END IF;
  FOR r IN SELECT s.id FROM lb_sales s
           WHERE s.business_id = p_business AND s.status = 'COMPLETED' AND coalesce(s.completed_at, s.created_at) >= cfg.go_live_at
             AND NOT EXISTS (SELECT 1 FROM lb_etims_invoices i WHERE i.sale_id = s.id AND i.doc_type = 'SALE')
           ORDER BY s.completed_at LIMIT p_limit LOOP
    BEGIN res := etims_enqueue_sale(r.id); EXCEPTION WHEN OTHERS THEN res := 'ERROR'; END;
    IF res = 'QUEUED' THEN v_q := v_q + 1; ELSIF res = 'SKIPPED' THEN v_s := v_s + 1; END IF;
  END LOOP;
  FOR r IN SELECT s.id FROM lb_sales s JOIN lb_etims_invoices i ON i.sale_id = s.id AND i.doc_type = 'SALE'
           WHERE s.business_id = p_business AND s.status = 'VOIDED' AND i.status <> 'CANCELLED_BEFORE_SEND'
             AND NOT EXISTS (SELECT 1 FROM lb_etims_invoices c WHERE c.original_invoice_id = i.id AND c.doc_type = 'CREDIT_NOTE')
           LIMIT p_limit LOOP
    BEGIN res := etims_settle_void(r.id); EXCEPTION WHEN OTHERS THEN res := 'ERROR'; END;
    IF res IN ('CANCELLED','CREDIT_NOTE_QUEUED') THEN v_v := v_v + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('queued', v_q, 'skipped', v_s, 'voids', v_v);
END $$;

-- ---------- worker side: claim, record. Backend (service_role) only ----------
DROP FUNCTION IF EXISTS etims_claim_due(int,text,int);
CREATE OR REPLACE FUNCTION etims_claim_due(p_limit int, p_worker text, p_lease_seconds int DEFAULT 120, p_business uuid DEFAULT NULL) RETURNS SETOF lb_etims_invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- a worker that died mid-call left the outcome UNKNOWN: park it for the owner, never resend it blindly
  UPDATE lb_etims_invoices SET status = 'SENT_UNCONFIRMED', lease_until = NULL, last_error_code = 'LEASE_EXPIRED',
         last_error_message = 'The send was interrupted. Check with KRA before sending again.'
   WHERE status = 'SENDING' AND lease_until < now() AND (p_business IS NULL OR business_id = p_business);
  RETURN QUERY
  UPDATE lb_etims_invoices i SET status = 'SENDING', lease_by = p_worker, lease_until = now() + make_interval(secs => p_lease_seconds),
         attempt_count = i.attempt_count + 1, submitted_at = coalesce(i.submitted_at, now())
   WHERE i.id IN (
     SELECT x.id FROM lb_etims_invoices x JOIN lb_etims_config c ON c.business_id = x.business_id
      WHERE x.status = 'PENDING' AND x.next_attempt_at <= now() AND (p_business IS NULL OR x.business_id = p_business) AND c.enabled AND c.status = 'ACTIVE' AND c.has_comm_key
        AND (x.doc_type = 'SALE' OR EXISTS (SELECT 1 FROM lb_etims_invoices o WHERE o.id = x.original_invoice_id AND o.status = 'ACCEPTED'))
      ORDER BY x.invoice_no FOR UPDATE OF x SKIP LOCKED LIMIT p_limit)
   RETURNING i.*;
END $$;

-- outcome: ACCEPTED | REJECTED | RETRY (nothing reached KRA) | UNCONFIRMED (request sent, no usable answer) | AUTH (device/key problem)
CREATE OR REPLACE FUNCTION etims_record_result(p_invoice uuid, p_outcome text, p_http int, p_result_code text, p_duration_ms int, p_message text, p_kra_data jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE inv lb_etims_invoices; v_back int[] := ARRAY[60,120,300,900,3600,21600]; v_wait int; v_att text; v_msg text := left(coalesce(p_message,''), 300);
BEGIN
  SELECT * INTO inv FROM lb_etims_invoices WHERE id = p_invoice FOR UPDATE;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  IF inv.status <> 'SENDING' THEN RETURN; END IF;                      -- already settled by someone else: ignore a late report
  v_att := CASE p_outcome WHEN 'ACCEPTED' THEN 'ACCEPTED' WHEN 'REJECTED' THEN 'REJECTED' WHEN 'RETRY' THEN 'NETWORK_ERROR'
                          WHEN 'UNCONFIRMED' THEN 'NO_REPLY' WHEN 'AUTH' THEN 'AUTH_ERROR' ELSE 'OTHER' END;
  INSERT INTO lb_etims_attempts (tenant_id, business_id, invoice_id, attempt_no, outcome, http_status, result_code, duration_ms)
    VALUES (inv.tenant_id, inv.business_id, inv.id, inv.attempt_count, v_att, p_http, left(p_result_code, 20), p_duration_ms);

  IF p_outcome = 'ACCEPTED' THEN
    UPDATE lb_etims_invoices SET status = 'ACCEPTED', accepted_at = now(), lease_until = NULL, kra_data = p_kra_data,
           response_summary = jsonb_build_object('resultCd', p_result_code, 'resultMsg', v_msg), last_error_code = NULL, last_error_message = NULL WHERE id = inv.id;
    UPDATE lb_etims_config SET last_success_at = now(), last_error = NULL WHERE business_id = inv.business_id;
  ELSIF p_outcome = 'REJECTED' THEN
    UPDATE lb_etims_invoices SET status = 'REJECTED', lease_until = NULL, last_error_code = left(p_result_code, 20), last_error_message = v_msg,
           response_summary = jsonb_build_object('resultCd', p_result_code, 'resultMsg', v_msg) WHERE id = inv.id;
  ELSIF p_outcome = 'UNCONFIRMED' THEN
    UPDATE lb_etims_invoices SET status = 'SENT_UNCONFIRMED', lease_until = NULL, last_error_code = left(p_result_code, 20), last_error_message = v_msg WHERE id = inv.id;
  ELSE   -- RETRY or AUTH: the invoice itself is fine, it waits and goes again with the SAME number and body
    v_wait := v_back[least(greatest(inv.attempt_count, 1), array_length(v_back, 1))];
    UPDATE lb_etims_invoices SET status = 'PENDING', lease_until = NULL, next_attempt_at = now() + make_interval(secs => v_wait),
           last_error_code = left(p_result_code, 20), last_error_message = v_msg WHERE id = inv.id;
    IF p_outcome = 'AUTH' THEN
      UPDATE lb_etims_config SET status = 'NEEDS_ATTENTION', last_error = v_msg WHERE business_id = inv.business_id;   -- stops claiming until the owner reconnects
    END IF;
  END IF;
END $$;

-- ---------- owner-facing ----------
CREATE OR REPLACE FUNCTION pos_etims_set_enabled(p_business_id uuid, p_enabled boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := get_current_tenant_id(); c lb_etims_config;
BEGIN
  PERFORM pos_require('settings.manage');
  IF v_tenant IS NULL OR NOT EXISTS (SELECT 1 FROM lb_businesses WHERE id = p_business_id AND tenant_id = v_tenant) THEN RAISE EXCEPTION 'This business is not yours.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM lb_etims_config WHERE business_id = p_business_id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'ETIMS_NOT_SET_UP: set up tax invoices first' USING ERRCODE = 'P0001'; END IF;
  IF p_enabled AND (c.status <> 'ACTIVE' OR NOT c.has_comm_key) THEN RAISE EXCEPTION 'ETIMS_NOT_CONNECTED: connect to KRA first' USING ERRCODE = 'P0001'; END IF;
  UPDATE lb_etims_config SET enabled = p_enabled,
         go_live_at = CASE WHEN p_enabled AND go_live_at IS NULL THEN now() ELSE go_live_at END, updated_at = now()   -- go-live is set once, never moved back
   WHERE business_id = p_business_id;
  BEGIN
    INSERT INTO pos_audit_log (pos_tenant_id, actor_type, actor_id, action, entity_type, entity_id)
    VALUES (v_tenant, 'staff', nullif(auth.jwt() ->> 'pos_staff_id','')::uuid, CASE WHEN p_enabled THEN 'ETIMS_ENABLED' ELSE 'ETIMS_DISABLED' END, 'lb_etims_config', c.id);
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('ok', true, 'enabled', p_enabled);
END $$;

-- everything that needs a person: rejected, unconfirmed, and sales held back (with the reason in words)
CREATE OR REPLACE FUNCTION pos_etims_attention(p_business_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := get_current_tenant_id();
BEGIN
  PERFORM pos_require('settings.manage', 'finance.view');
  IF v_tenant IS NULL OR NOT EXISTS (SELECT 1 FROM lb_businesses WHERE id = p_business_id AND tenant_id = v_tenant) THEN RAISE EXCEPTION 'This business is not yours.' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'invoices', coalesce((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'sale_id', i.sale_id, 'sale_number', s.sale_number, 'doc_type', i.doc_type, 'invoice_no', i.invoice_no,
                'status', i.status, 'message', i.last_error_message, 'code', i.last_error_code, 'total', s.total_amount, 'created_at', i.created_at) ORDER BY i.created_at DESC)
              FROM lb_etims_invoices i JOIN lb_sales s ON s.id = i.sale_id
              WHERE i.business_id = p_business_id AND i.status IN ('REJECTED','SENT_UNCONFIRMED')), '[]'::jsonb),
    'held_back', coalesce((SELECT jsonb_agg(jsonb_build_object('sale_id', k.sale_id, 'sale_number', s.sale_number, 'reason_code', k.reason_code, 'reason', k.reason_text, 'total', s.total_amount) ORDER BY s.completed_at DESC)
              FROM lb_etims_skipped k JOIN lb_sales s ON s.id = k.sale_id WHERE k.business_id = p_business_id), '[]'::jsonb),
    'oldest_waiting_at', (SELECT min(created_at) FROM lb_etims_invoices WHERE business_id = p_business_id AND status IN ('PENDING','SENDING')));
END $$;

-- owner presses Resend on a rejected / unconfirmed invoice. SAME number, SAME body. For an unconfirmed one the owner is
-- accepting that KRA may already have it; the worker treats KRA's "already have it" answer (994) as accepted.
CREATE OR REPLACE FUNCTION pos_etims_requeue(p_invoice_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := get_current_tenant_id(); inv lb_etims_invoices;
BEGIN
  PERFORM pos_require('settings.manage');
  SELECT * INTO inv FROM lb_etims_invoices WHERE id = p_invoice_id AND tenant_id = v_tenant FOR UPDATE;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF inv.status NOT IN ('REJECTED','SENT_UNCONFIRMED') THEN RAISE EXCEPTION 'ETIMS_NOT_RESENDABLE: only a rejected or unconfirmed invoice can be sent again' USING ERRCODE = 'P0001'; END IF;
  UPDATE lb_etims_invoices SET status = 'PENDING', next_attempt_at = now(), lease_until = NULL WHERE id = inv.id;
  BEGIN
    INSERT INTO pos_audit_log (pos_tenant_id, actor_type, actor_id, action, entity_type, entity_id)
    VALUES (v_tenant, 'staff', nullif(auth.jwt() ->> 'pos_staff_id','')::uuid, 'ETIMS_RESEND', 'lb_etims_invoices', inv.id);
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('ok', true);
END $$;

-- owner presses "Check again" after fixing item codes: re-runs the held-back sales now
CREATE OR REPLACE FUNCTION pos_etims_retry_held(p_business_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := get_current_tenant_id();
BEGIN
  PERFORM pos_require('settings.manage');
  IF v_tenant IS NULL OR NOT EXISTS (SELECT 1 FROM lb_businesses WHERE id = p_business_id AND tenant_id = v_tenant) THEN RAISE EXCEPTION 'This business is not yours.' USING ERRCODE = '42501'; END IF;
  RETURN etims_sweep(p_business_id, 200);
END $$;

-- grants
REVOKE ALL ON FUNCTION etims_tax_rate(text,text), etims_nairobi(timestamptz,text), etims_build_sale_body(lb_sales,lb_etims_config,bigint), etims_enqueue_sale(uuid), etims_settle_void(uuid),
  etims_sweep(uuid,int), etims_claim_due(int,text,int,uuid), etims_record_result(uuid,text,int,text,int,text,jsonb), etims_on_receipt(), etims_on_void() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION pos_etims_set_enabled(uuid,boolean), pos_etims_attention(uuid), pos_etims_requeue(uuid), pos_etims_retry_held(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pos_etims_set_enabled(uuid,boolean), pos_etims_attention(uuid), pos_etims_requeue(uuid), pos_etims_retry_held(uuid) TO authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION etims_sweep(uuid,int), etims_claim_due(int,text,int,uuid), etims_record_result(uuid,text,int,text,int,text,jsonb) TO service_role;
  END IF;
END $$;
