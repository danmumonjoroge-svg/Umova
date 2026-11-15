-- ============================================================
-- Phase 54 -- Salon: optional provider on a booking, commission into payroll, and ONE place to take payment (Sell).
-- NOT RUN against a live database. Needs phase6 (salon), phase19 (folios), phase28 + phase31 (HR/payroll), phase39 (M-Pesa).
--
-- WHAT CHANGES
--  1. A booking can name a provider (optional). The provider is an HR employee (pos_hr_employees), because that is
--     who payroll pays; a stylist does not need a login. lb_appointments.provider_name keeps the name for display
--     (the HR table is closed to normal screens).
--  2. The Sell page sends employee_id / appointment_id on a service line. When that sale item is saved, a trigger
--       - writes the commission into pos_commissions (service's lb_service_details.commission_rate x the line's
--         net amount), and
--       - marks the booking COMPLETED and links the sale.
--     It lives in the database so it works the same for a till sale, an offline-synced sale and an M-Pesa prompt
--     sale (the server builds that one itself).
--  3. Payroll: pos_payroll_create_run pulls every unpaid commission up to the period end into the employee's
--     ALLOWANCES (so statutory deductions apply, as they do to any pay), links the ledger rows to the run, and shows
--     a note on the payslip line. Cancelling a run frees them; marking it paid marks them PAID. A commission-only
--     stylist (basic 0) is included. A reversed sale voids an unpaid commission, or adds a negative row (clawback)
--     when it was already in a run; a negative balance carries to the next run rather than going below zero.
--  4. Folio payment moves to Sell. _settle_folio_system is settle_folio without the logged-in-tenant check, for the
--     M-Pesa callback (it has no user session); confirm_mpesa_payment gets a folio branch like the rent-invoice one.
--
-- COMMISSION IS EARNED WHEN THE SERVICE IS SOLD (the sale is saved), not when the money arrives. A service charged
-- to a folio therefore earns its commission at once. Change the trigger if you want it on payment instead.
-- ============================================================
DO $$ BEGIN
  IF to_regclass('public.pos_hr_employees') IS NULL OR to_regprocedure('public.pos28_tenant_id()') IS NULL THEN
    RAISE EXCEPTION 'Run phase28_staff_permissions.sql and phase31_hr_payroll.sql first.';
  END IF;
  IF to_regclass('public.lb_folios') IS NULL OR to_regclass('public.lb_appointments') IS NULL THEN
    RAISE EXCEPTION 'Run phase19_folios.sql and phase6_salon.sql first.';
  END IF;
END $$;

-- ---------- 1. columns ----------
ALTER TABLE lb_appointments ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES pos_hr_employees(id) ON DELETE SET NULL;
ALTER TABLE lb_appointments ADD COLUMN IF NOT EXISTS provider_name text;
ALTER TABLE lb_sale_items   ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES pos_hr_employees(id) ON DELETE SET NULL;
ALTER TABLE lb_sale_items   ADD COLUMN IF NOT EXISTS appointment_id uuid REFERENCES lb_appointments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_lb_sale_items_employee ON lb_sale_items(employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lb_sale_items_appointment ON lb_sale_items(appointment_id) WHERE appointment_id IS NOT NULL;

-- ---------- 2. commission ledger (closed to clients like the other HR/payroll tables: read through the functions) ----------
CREATE TABLE IF NOT EXISTS pos_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_tenant_id uuid NOT NULL, business_id uuid,
  employee_id uuid NOT NULL REFERENCES pos_hr_employees(id),
  sale_id uuid, sale_item_id uuid, appointment_id uuid, product_id uuid,
  description text,
  kind text NOT NULL DEFAULT 'EARNED' CHECK (kind IN ('EARNED','REVERSAL')),
  base_amount numeric(15,2) NOT NULL, rate numeric(5,2) NOT NULL,
  amount numeric(15,2) NOT NULL,                       -- signed: a REVERSAL is negative
  status text NOT NULL DEFAULT 'ACCRUED' CHECK (status IN ('ACCRUED','IN_PAYROLL','PAID','VOID')),
  run_id uuid REFERENCES pos_payroll_runs(id) ON DELETE SET NULL,
  earned_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_commission_item ON pos_commissions(sale_item_id) WHERE kind = 'EARNED' AND sale_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_commission_emp ON pos_commissions(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_pos_commission_run ON pos_commissions(run_id) WHERE run_id IS NOT NULL;
ALTER TABLE pos_commissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pos_commissions FROM PUBLIC, anon, authenticated;

-- ---------- 3. accrual: runs when a sale item is saved ----------
CREATE OR REPLACE FUNCTION _lb_sale_item_service_hooks() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_emp pos_hr_employees; v_rate numeric; v_biz uuid; v_name text; v_base numeric;
BEGIN
  IF NEW.appointment_id IS NOT NULL THEN
    UPDATE lb_appointments SET status = 'COMPLETED', sale_id = NEW.sale_id, updated_at = now()
     WHERE id = NEW.appointment_id AND tenant_id = NEW.tenant_id AND status IN ('SCHEDULED','CONFIRMED');
  END IF;
  IF NEW.employee_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_emp FROM pos_hr_employees WHERE id = NEW.employee_id AND pos_tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN RETURN NEW; END IF;                 -- not one of this business's employees: ignore, never fail the sale
  SELECT commission_rate INTO v_rate FROM lb_service_details WHERE product_id = NEW.product_id AND tenant_id = NEW.tenant_id;
  IF coalesce(v_rate, 0) <= 0 THEN RETURN NEW; END IF;
  v_base := greatest(coalesce(NEW.total_price, 0), 0);
  IF v_base = 0 THEN RETURN NEW; END IF;
  SELECT business_id INTO v_biz FROM lb_sales WHERE id = NEW.sale_id;
  SELECT name INTO v_name FROM lb_products WHERE id = NEW.product_id;
  INSERT INTO pos_commissions (pos_tenant_id, business_id, employee_id, sale_id, sale_item_id, appointment_id, product_id, description, base_amount, rate, amount)
  VALUES (NEW.tenant_id, v_biz, v_emp.id, NEW.sale_id, NEW.id, NEW.appointment_id, NEW.product_id, v_name, round(v_base, 2), v_rate, round(v_base * v_rate / 100, 2))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION _lb_sale_item_service_hooks() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_lb_sale_item_service_hooks ON lb_sale_items;
CREATE TRIGGER trg_lb_sale_item_service_hooks AFTER INSERT ON lb_sale_items FOR EACH ROW EXECUTE FUNCTION _lb_sale_item_service_hooks();

-- a reversed sale: void what is still unpaid, claw back (negative row) what already went into a payroll run
CREATE OR REPLACE FUNCTION _lb_sale_void_commissions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE k pos_commissions;
BEGIN
  FOR k IN SELECT * FROM pos_commissions WHERE sale_id = NEW.id AND kind = 'EARNED' AND status <> 'VOID' LOOP
    IF k.status = 'ACCRUED' THEN
      UPDATE pos_commissions SET status = 'VOID' WHERE id = k.id;
    ELSIF NOT EXISTS (SELECT 1 FROM pos_commissions WHERE sale_item_id = k.sale_item_id AND kind = 'REVERSAL') THEN
      INSERT INTO pos_commissions (pos_tenant_id, business_id, employee_id, sale_id, sale_item_id, appointment_id, product_id, description, kind, base_amount, rate, amount)
      VALUES (k.pos_tenant_id, k.business_id, k.employee_id, k.sale_id, k.sale_item_id, k.appointment_id, k.product_id, 'Reversed sale: ' || coalesce(k.description, ''), 'REVERSAL', -k.base_amount, k.rate, -k.amount);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION _lb_sale_void_commissions() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_lb_sale_void_commissions ON lb_sales;
CREATE TRIGGER trg_lb_sale_void_commissions AFTER UPDATE OF status ON lb_sales
  FOR EACH ROW WHEN (NEW.status::text = 'VOIDED' AND OLD.status::text IS DISTINCT FROM 'VOIDED') EXECUTE FUNCTION _lb_sale_void_commissions();

-- ---------- 4. functions the screens call ----------
-- People a booking / service line can be given to. Names and job titles only (no pay, no IDs), so any till user can see them.
CREATE OR REPLACE FUNCTION salon_list_providers(p_business uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT pos__biz_ok2(p_business) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'name', e.full_name, 'job_title', e.job_title, 'staff_id', e.staff_id) ORDER BY e.full_name)
                     FROM pos_hr_employees e WHERE e.business_id = p_business AND e.pos_tenant_id = pos28_tenant_id() AND e.status = 'ACTIVE'), '[]'::jsonb);
END $$;

-- Commission per person for a date range (payroll access only).
CREATE OR REPLACE FUNCTION pos_commission_summary(p_business uuid, p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM pos__need('payroll.access');
  IF NOT pos__biz_ok2(p_business) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x->>'name') FROM (
    SELECT jsonb_build_object('employee_id', e.id, 'name', e.full_name,
             'services', count(*) FILTER (WHERE k.kind = 'EARNED' AND k.status <> 'VOID'),
             'earned', coalesce(sum(k.amount) FILTER (WHERE k.status <> 'VOID'), 0),
             'unpaid', coalesce(sum(k.amount) FILTER (WHERE k.status = 'ACCRUED'), 0),
             'in_payroll', coalesce(sum(k.amount) FILTER (WHERE k.status = 'IN_PAYROLL'), 0),
             'paid', coalesce(sum(k.amount) FILTER (WHERE k.status = 'PAID'), 0)) AS x
      FROM pos_commissions k JOIN pos_hr_employees e ON e.id = k.employee_id
     WHERE k.business_id = p_business AND k.pos_tenant_id = pos28_tenant_id()
       AND (k.earned_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to
     GROUP BY e.id, e.full_name) s), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION salon_list_providers(uuid), pos_commission_summary(uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION salon_list_providers(uuid), pos_commission_summary(uuid,date,date) TO authenticated;

-- ---------- 5. M-Pesa prompt can now pay a folio ----------
ALTER TABLE lb_mpesa_transactions ADD COLUMN IF NOT EXISTS folio_id uuid REFERENCES lb_folios(id);
CREATE INDEX IF NOT EXISTS idx_lb_mpesa_folio ON lb_mpesa_transactions (folio_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_mpesa_one_pending_per_folio ON lb_mpesa_transactions (folio_id) WHERE folio_id IS NOT NULL AND status = 'PENDING';
ALTER TABLE lb_mpesa_transactions ALTER COLUMN cart_snapshot DROP NOT NULL;
ALTER TABLE lb_mpesa_transactions DROP CONSTRAINT IF EXISTS lb_mpesa_txn_has_purpose;
ALTER TABLE lb_mpesa_transactions ADD CONSTRAINT lb_mpesa_txn_has_purpose CHECK (cart_snapshot IS NOT NULL OR rent_invoice_id IS NOT NULL OR folio_id IS NOT NULL);

-- ---------- 6. settle_folio for the M-Pesa callback (no user session there; the tenant is passed in) ----------
CREATE OR REPLACE FUNCTION _settle_folio_system(p_folio_id uuid, p_tenant uuid, p_payments jsonb, p_settled_by uuid DEFAULT NULL, p_shift_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_f lb_folios; v_charges numeric(15,4); v_paid numeric(15,4); v_balance numeric(15,4);
  v_pay jsonb; v_in numeric(15,4) := 0; v_amt numeric(15,4); v_inv text; v_rct text;
BEGIN
  SELECT * INTO v_f FROM lb_folios WHERE id = p_folio_id AND tenant_id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Folio not found'; END IF;
  IF v_f.status <> 'OPEN' THEN RAISE EXCEPTION 'This folio is already %', lower(v_f.status); END IF;
  SELECT COALESCE(SUM(amount),0) INTO v_charges FROM lb_folio_lines WHERE folio_id = v_f.id AND status = 'POSTED';
  SELECT COALESCE(SUM(amount),0) INTO v_paid FROM lb_folio_payments WHERE folio_id = v_f.id;
  v_balance := v_charges - v_paid;
  IF v_charges <= 0 THEN RAISE EXCEPTION 'There is nothing to settle on this folio'; END IF;

  FOR v_pay IN SELECT * FROM jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) LOOP
    v_amt := (v_pay->>'amount')::numeric;
    IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'Each payment needs an amount above zero'; END IF;
    IF upper(coalesce(v_pay->>'payment_method','')) = 'CREDIT' THEN RAISE EXCEPTION 'A folio cannot be settled on credit'; END IF;
    v_in := v_in + v_amt;
  END LOOP;
  IF v_in <> v_balance THEN
    RAISE EXCEPTION 'Payments (%) must equal the balance (%)', v_in, v_balance;
  END IF;

  FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    INSERT INTO lb_folio_payments (tenant_id, business_id, folio_id, payment_method, amount, reference_no, shift_id, created_by)
    VALUES (v_f.tenant_id, v_f.business_id, v_f.id, (v_pay->>'payment_method')::lb_payment_method, (v_pay->>'amount')::numeric, nullif(btrim(v_pay->>'reference_no'),''), p_shift_id, p_settled_by);
  END LOOP;

  v_inv := next_doc_number(v_f.business_id, 'INV');
  v_rct := next_doc_number(v_f.business_id, 'RCT');
  UPDATE lb_folios SET status = 'SETTLED', settled_at = now(), settled_by = p_settled_by,
         invoice_number = v_inv, receipt_number = v_rct, updated_at = now()
   WHERE id = v_f.id;
  RETURN jsonb_build_object('folio_id', v_f.id, 'invoice_number', v_inv, 'receipt_number', v_rct, 'total', v_charges);
END $$;
REVOKE ALL ON FUNCTION _settle_folio_system(uuid,uuid,jsonb,uuid,uuid) FROM PUBLIC, anon, authenticated;

-- ---------- 7. payroll pulls commission (replaces the phase31 function; same signature) ----------
CREATE OR REPLACE FUNCTION pos_payroll_create_run(p_business uuid, p_period_start date, p_period_end date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid := pos28_tenant_id(); v_run uuid; e record; c jsonb; v_n int := 0; snap jsonb; v_comm numeric; v_cn int;
BEGIN
  PERFORM pos__need('payroll.access');
  IF NOT pos__biz_ok2(p_business) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF p_period_end < p_period_start OR p_period_end - p_period_start > 31 THEN RAISE EXCEPTION 'BAD_DATES: a run covers one month' USING ERRCODE='22023'; END IF;
  IF p_period_end > (now() AT TIME ZONE 'Africa/Nairobi')::date + 31 THEN RAISE EXCEPTION 'BAD_DATES: too far in the future' USING ERRCODE='22023'; END IF;
  PERFORM _payroll_seed_rates(v_t);
  BEGIN
    INSERT INTO pos_payroll_runs(pos_tenant_id, business_id, period_start, period_end, prepared_by) VALUES (v_t, p_business, p_period_start, p_period_end, pos28_staff_id()) RETURNING id INTO v_run;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'ALREADY_EXISTS: there is already a payroll run for that month' USING ERRCODE='P0001'; END;
  FOR e IN SELECT * FROM pos_hr_employees WHERE pos_tenant_id = v_t AND business_id = p_business AND status = 'ACTIVE' AND (basic_salary > 0 OR EXISTS (SELECT 1 FROM pos_commissions k WHERE k.employee_id = pos_hr_employees.id AND k.status = 'ACCRUED' AND k.earned_at::date <= p_period_end))
             AND (start_date IS NULL OR start_date <= p_period_end) AND (end_date IS NULL OR end_date >= p_period_start) ORDER BY full_name LOOP
    -- unpaid commission up to the end of the period becomes this month's allowance (a negative balance carries over)
    SELECT coalesce(sum(amount), 0), count(*) INTO v_comm, v_cn FROM pos_commissions
     WHERE employee_id = e.id AND status = 'ACCRUED' AND earned_at::date <= p_period_end;
    IF v_comm < 0 THEN v_comm := 0; v_cn := 0; END IF;
    c := _payroll_calc(v_t, p_period_end, e.basic_salary, v_comm, 0);
    INSERT INTO pos_payroll_lines(run_id, pos_tenant_id, employee_id, employee_name, job_title, tax_pin, nssf_no, sha_no, basic, allowances, other_deductions, gross, nssf, shif, housing, taxable, paye_before_relief, relief, paye, net, employer_nssf, employer_housing)
    VALUES (v_run, v_t, e.id, e.full_name, e.job_title, e.tax_pin, e.nssf_no, e.sha_no, e.basic_salary, v_comm, 0, (c->>'gross')::numeric, (c->>'nssf')::numeric, (c->>'shif')::numeric, (c->>'housing')::numeric,
            (c->>'taxable')::numeric, (c->>'paye_before_relief')::numeric, (c->>'relief')::numeric, (c->>'paye')::numeric, (c->>'net')::numeric, (c->>'employer_nssf')::numeric, (c->>'employer_housing')::numeric);
    IF v_cn > 0 THEN
      UPDATE pos_commissions SET status = 'IN_PAYROLL', run_id = v_run WHERE employee_id = e.id AND status = 'ACCRUED' AND earned_at::date <= p_period_end;
      UPDATE pos_payroll_lines SET notes = 'Includes commission KES ' || v_comm::text || ' from ' || v_cn::text || ' service line(s)' WHERE run_id = v_run AND employee_id = e.id;
    END IF;
    snap := c->'rates'; v_n := v_n + 1;
  END LOOP;
  IF v_n = 0 THEN RAISE EXCEPTION 'NO_EMPLOYEES: no active employee with a salary is on file for that month' USING ERRCODE='P0001'; END IF;
  UPDATE pos_payroll_runs SET rates_snapshot = snap WHERE id = v_run;
  PERFORM _payroll_retotal(v_run);
  PERFORM pos__audit_x('PAYROLL_RUN_CREATED','pos_payroll_runs',v_run,jsonb_build_object('start',p_period_start,'end',p_period_end,'employees',v_n));
  RETURN jsonb_build_object('ok', true, 'id', v_run, 'employees', v_n);
END $$;

CREATE OR REPLACE FUNCTION pos_payroll_cancel(p_run uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record;
BEGIN
  PERFORM pos__need('payroll.access');
  IF length(btrim(coalesce(p_reason,''))) < 5 THEN RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM pos_payroll_runs WHERE id = p_run AND pos_tenant_id = pos28_tenant_id() FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF r.status NOT IN ('DRAFT','APPROVED') THEN RAISE EXCEPTION 'LOCKED: a % run cannot be cancelled', lower(r.status) USING ERRCODE='P0001'; END IF;
  UPDATE pos_payroll_runs SET status='CANCELLED', notes = btrim(p_reason) WHERE id = r.id;
  UPDATE pos_commissions SET status = 'ACCRUED', run_id = NULL WHERE run_id = r.id AND status = 'IN_PAYROLL';
  PERFORM pos__audit_x('PAYROLL_RUN_CANCELLED','pos_payroll_runs',r.id,jsonb_build_object('reason',p_reason));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION pos_payroll_mark_paid(p_run uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record;
BEGIN
  PERFORM pos__need('payroll.access');
  SELECT * INTO r FROM pos_payroll_runs WHERE id = p_run AND pos_tenant_id = pos28_tenant_id() FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF r.status <> 'APPROVED' THEN RAISE EXCEPTION 'NOT_APPROVED: approve the run before marking it paid' USING ERRCODE='P0001'; END IF;
  UPDATE pos_payroll_runs SET status='PAID', paid_by=pos28_staff_id(), paid_at=now() WHERE id = r.id;
  UPDATE pos_commissions SET status = 'PAID', paid_at = now() WHERE run_id = r.id AND status = 'IN_PAYROLL';
  PERFORM pos__audit_x('PAYROLL_RUN_PAID','pos_payroll_runs',r.id,jsonb_build_object('net',r.totals->'net'));
  RETURN jsonb_build_object('ok', true);
END $$;

-- ---------- 8. confirm_mpesa_payment = phase39 body + folio branch + provider/booking on sale items ----------
CREATE OR REPLACE FUNCTION confirm_mpesa_payment(
  p_checkout_request_id text,
  p_result_code integer,
  p_result_desc text,
  p_mpesa_receipt_number text,
  p_raw_callback jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_txn lb_mpesa_transactions%ROWTYPE;
  v_sale_id uuid;
  v_sale_number text;
  v_item jsonb;
  v_warehouse_id uuid;
  v_inv_result jsonb;
  v_subtotal numeric;
  v_receipt_number text;
  v_receipt_items jsonb;
  v_code text;
  v_cb_amount numeric;
  v_reopen boolean;
  v_dup_sale uuid;
  v_fres jsonb;
BEGIN
  SELECT * INTO v_txn FROM lb_mpesa_transactions WHERE checkout_request_id = p_checkout_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No M-Pesa transaction found for checkout_request_id %', p_checkout_request_id;
  END IF;

  -- A request the till gave up on (TIMED_OUT, or set aside by hand before any callback) has NOT been settled: the buyer may
  -- still have approved. Only those can still change. PAID / FAILED / CANCELLED, and a NEEDS_ATTENTION that already holds
  -- a callback result, are final: a repeated callback is an idempotent no-op (Safaricom does send duplicates).
  v_reopen := v_txn.status = 'TIMED_OUT' OR (v_txn.status = 'NEEDS_ATTENTION' AND v_txn.result_code IS NULL);
  IF v_txn.status IN ('PAID', 'FAILED', 'CANCELLED') OR (v_txn.status IN ('TIMED_OUT', 'NEEDS_ATTENTION') AND NOT v_reopen) THEN
    RETURN jsonb_build_object('already_processed', true, 'status', v_txn.status, 'sale_id', v_txn.sale_id);
  END IF;

  UPDATE lb_mpesa_transactions
  SET result_code = p_result_code,
      result_desc = p_result_desc,
      raw_callback = p_raw_callback,
      updated_at = now()
  WHERE id = v_txn.id;

  -- Daraja: ResultCode 0 = success. Anything else = failed/cancelled at the customer's end.
  IF p_result_code <> 0 THEN
    UPDATE lb_mpesa_transactions
    SET status = (CASE WHEN p_result_code = 1032 THEN 'CANCELLED' ELSE 'FAILED' END)::lb_mpesa_status
    WHERE id = v_txn.id;
    RETURN jsonb_build_object('already_processed', false, 'status', 'FAILED', 'sale_id', NULL);
  END IF;

  -- ---- Success callback: verify before trusting ----
  v_code := upper(regexp_replace(coalesce(p_mpesa_receipt_number, ''), '[^A-Za-z0-9]', '', 'g'));
  SELECT (i->>'Value')::numeric INTO v_cb_amount
    FROM jsonb_array_elements(coalesce(p_raw_callback #> '{Body,stkCallback,CallbackMetadata,Item}', '[]'::jsonb)) i
   WHERE i->>'Name' = 'Amount' LIMIT 1;

  IF v_code = '' THEN
    -- Confirmed, but no receipt code: never invent one.
    UPDATE lb_mpesa_transactions SET status = 'NEEDS_ATTENTION', confirmed_at = now(),
           result_desc = coalesce(result_desc, '') || ' | Confirmed by Safaricom but no M-Pesa code was supplied: check the Daraja statement before recording it.'
     WHERE id = v_txn.id;
    RETURN jsonb_build_object('already_processed', false, 'status', 'NEEDS_ATTENTION', 'sale_id', NULL);
  END IF;

  IF v_cb_amount IS NOT NULL AND abs(v_cb_amount - v_txn.amount) > 0.5 THEN
    UPDATE lb_mpesa_transactions SET status = 'NEEDS_ATTENTION', mpesa_receipt_number = NULL, confirmed_at = now(),
           result_desc = coalesce(result_desc, '') || ' | Safaricom confirmed KES ' || v_cb_amount || ' (code ' || v_code || ') but KES ' || v_txn.amount || ' was requested. Not applied.'
     WHERE id = v_txn.id;
    RETURN jsonb_build_object('already_processed', false, 'status', 'NEEDS_ATTENTION', 'sale_id', NULL);
  END IF;

  -- The same code already recorded (a cashier typed it, or another request carries it): applying it again would count one
  -- payment twice. Parked for a human, with the sale it is already on.
  SELECT p.sale_id INTO v_dup_sale FROM lb_payments p
   WHERE p.tenant_id = v_txn.tenant_id AND p.payment_method = 'MOBILE_MONEY'
     AND upper(regexp_replace(coalesce(p.reference_no, ''), '[^A-Za-z0-9]', '', 'g')) = v_code LIMIT 1;
  IF FOUND OR EXISTS (SELECT 1 FROM lb_mpesa_transactions t WHERE t.tenant_id = v_txn.tenant_id AND t.id <> v_txn.id AND upper(t.mpesa_receipt_number) = v_code) THEN
    UPDATE lb_mpesa_transactions SET status = 'NEEDS_ATTENTION', mpesa_receipt_number = NULL, confirmed_at = now(),
           result_desc = coalesce(result_desc, '') || ' | M-Pesa code ' || v_code || ' is already recorded' || coalesce(' on sale ' || v_dup_sale::text, '') || '. Not applied a second time.'
     WHERE id = v_txn.id;
    RETURN jsonb_build_object('already_processed', false, 'status', 'NEEDS_ATTENTION', 'sale_id', NULL);
  END IF;

  -- ---- Rent invoice payment (phase17): apply to the invoice, not a sale ----
  IF v_txn.rent_invoice_id IS NOT NULL THEN
    BEGIN
      v_inv_result := record_rent_invoice_payment(
        v_txn.rent_invoice_id, v_txn.amount, 'MOBILE_MONEY', v_code,
        'M-Pesa STK payment', v_txn.requested_by, 'MPESA_PROMPT', v_txn.id);
    EXCEPTION WHEN OTHERS THEN
      UPDATE lb_mpesa_transactions
      SET status = 'NEEDS_ATTENTION', mpesa_receipt_number = v_code, confirmed_at = now(),
          result_desc = COALESCE(result_desc, '') || ' | Received but not applied: ' || SQLERRM
      WHERE id = v_txn.id;
      RETURN jsonb_build_object('already_processed', false, 'status', 'NEEDS_ATTENTION', 'sale_id', NULL);
    END;
    UPDATE lb_mpesa_transactions
    SET status = 'PAID', mpesa_receipt_number = v_code, confirmed_at = now()
    WHERE id = v_txn.id;
    RETURN jsonb_build_object('already_processed', false, 'status', 'PAID', 'sale_id', NULL, 'rent_invoice_id', v_txn.rent_invoice_id);
  END IF;

  -- ---- Folio payment (phase54): settle the customer's folio, not a sale ----
  IF v_txn.folio_id IS NOT NULL THEN
    BEGIN
      v_fres := _settle_folio_system(v_txn.folio_id, v_txn.tenant_id,
        jsonb_build_array(jsonb_build_object('payment_method', 'MOBILE_MONEY', 'amount', v_txn.amount, 'reference_no', v_code)),
        v_txn.requested_by, v_txn.shift_id);
    EXCEPTION WHEN OTHERS THEN
      -- The money arrived but the folio no longer matches (balance changed, already settled...). Kept for a human, never guessed.
      UPDATE lb_mpesa_transactions
      SET status = 'NEEDS_ATTENTION', mpesa_receipt_number = v_code, confirmed_at = now(),
          result_desc = COALESCE(result_desc, '') || ' | Received but not applied: ' || SQLERRM
      WHERE id = v_txn.id;
      RETURN jsonb_build_object('already_processed', false, 'status', 'NEEDS_ATTENTION', 'sale_id', NULL);
    END;
    UPDATE lb_mpesa_transactions SET status = 'PAID', mpesa_receipt_number = v_code, confirmed_at = now() WHERE id = v_txn.id;
    RETURN jsonb_build_object('already_processed', false, 'status', 'PAID', 'sale_id', NULL, 'folio_id', v_txn.folio_id);
  END IF;

  -- ---- Payment confirmed. Create the sale now, not before. ----
  SELECT id INTO v_warehouse_id FROM lb_warehouses WHERE business_id = v_txn.business_id AND is_default = true LIMIT 1;
  v_subtotal := COALESCE((SELECT SUM((i->>'quantity')::numeric * (i->>'unit_price')::numeric) FROM jsonb_array_elements(v_txn.cart_snapshot) i), v_txn.amount);

  INSERT INTO lb_sales (
    tenant_id, business_id, cashier_id, shift_id, customer_id, sale_number,
    status, subtotal, discount_total, tax_total, total_amount, notes,
    completed_at, client_reference
  ) VALUES (
    v_txn.tenant_id, v_txn.business_id, v_txn.requested_by, v_txn.shift_id, v_txn.customer_id,
    generate_sale_number(), 'COMPLETED', v_subtotal, 0, 0, v_txn.amount,
    'M-Pesa STK payment — ' || v_code, now(), 'MPESA-' || p_checkout_request_id
  ) RETURNING id, sale_number INTO v_sale_id, v_sale_number;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_txn.cart_snapshot)
  LOOP
    INSERT INTO lb_sale_items (
      tenant_id, sale_id, product_id, quantity, unit_price, cost_price,
      discount_amount, discount_percent, tax_amount, total_price, selling_mode, employee_id, appointment_id
    ) VALUES (
      v_txn.tenant_id, v_sale_id, (v_item->>'product_id')::uuid,
      (v_item->>'quantity')::numeric, (v_item->>'unit_price')::numeric,
      COALESCE((v_item->>'cost_price')::numeric, 0),
      COALESCE((v_item->>'discount_amount')::numeric, 0), 0, 0,
      (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric - COALESCE((v_item->>'discount_amount')::numeric, 0),
      COALESCE(v_item->>'selling_mode', 'PER_UNIT'),
      NULLIF(v_item->>'employee_id', '')::uuid, NULLIF(v_item->>'appointment_id', '')::uuid
    );

    IF v_warehouse_id IS NOT NULL THEN
      UPDATE lb_inventory
      SET quantity = quantity - (v_item->>'quantity')::numeric, updated_at = now()
      WHERE product_id = (v_item->>'product_id')::uuid AND warehouse_id = v_warehouse_id;

      INSERT INTO lb_inventory_movements (
        tenant_id, business_id, warehouse_id, product_id, movement_type,
        quantity, unit_cost, reference_id, reference_type, created_by
      ) VALUES (
        v_txn.tenant_id, v_txn.business_id, v_warehouse_id, (v_item->>'product_id')::uuid, 'SALE',
        -(v_item->>'quantity')::numeric, COALESCE((v_item->>'cost_price')::numeric, 0),
        v_sale_id, 'SALE', v_txn.requested_by
      );
    END IF;
  END LOOP;

  INSERT INTO lb_payments (tenant_id, business_id, sale_id, payment_method, amount, change_amount, reference_no, status, created_by)
  VALUES (v_txn.tenant_id, v_txn.business_id, v_sale_id, 'MOBILE_MONEY', v_txn.amount, 0, v_code, 'COMPLETED', v_txn.requested_by);

  -- Receipt row (phase14 content snapshot, restored: phase17 had dropped it)
  SELECT jsonb_agg(jsonb_build_object(
    'product_id', i->>'product_id', 'name', i->>'name',
    'quantity', (i->>'quantity')::numeric, 'unit_price', (i->>'unit_price')::numeric,
    'total_price', (i->>'quantity')::numeric * (i->>'unit_price')::numeric - COALESCE((i->>'discount_amount')::numeric, 0)))
  INTO v_receipt_items FROM jsonb_array_elements(v_txn.cart_snapshot) i;

  v_receipt_number := 'RCPT-' || to_char(now(), 'YYYYMMDD') || '-' || substr(v_sale_id::text, 1, 8);
  INSERT INTO lb_receipts (tenant_id, business_id, sale_id, receipt_number, receipt_type, receipt_data)
  VALUES (
    v_txn.tenant_id, v_txn.business_id, v_sale_id, v_receipt_number, 'THERMAL',
    jsonb_build_object(
      'sale_number', v_sale_number, 'items', COALESCE(v_receipt_items, '[]'::jsonb),
      'payments', jsonb_build_array(jsonb_build_object('payment_method', 'MOBILE_MONEY', 'amount', v_txn.amount, 'reference_no', v_code)),
      'subtotal', v_subtotal, 'discount_total', 0, 'tax_total', 0, 'total_amount', v_txn.amount, 'completed_at', now()));

  UPDATE lb_mpesa_transactions
  SET status = 'PAID', mpesa_receipt_number = v_code, sale_id = v_sale_id, confirmed_at = now()
  WHERE id = v_txn.id;

  RETURN jsonb_build_object('already_processed', false, 'status', 'PAID', 'sale_id', v_sale_id, 'sale_number', v_sale_number);
END;
$$;

ALTER FUNCTION confirm_mpesa_payment(text, integer, text, text, jsonb) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION confirm_mpesa_payment(text, integer, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_mpesa_payment(text, integer, text, text, jsonb) TO service_role;
