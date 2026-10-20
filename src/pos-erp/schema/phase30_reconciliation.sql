-- ============================================================
-- Phase 30 -- Daily cash and M-Pesa reconciliation. NOT DEPLOYED.
-- Needs phase28 (permissions) and phase29 (reversals). Review, then run on STAGING first.
--
-- For one business and one day (Nairobi time) the system works out what SHOULD be there:
--   cash   = cash sales (net of change) + cash paid on folios + cash-in - cash-out - cash spending
--            - cash given back for reversals the day's payments no longer show
--   M-Pesa = M-Pesa sales + M-Pesa paid on folios - M-Pesa refunds sent for such reversals
-- The person counting enters the opening float, the cash counted and the M-Pesa total from the
-- statement. The difference is the variance; any variance needs a written reason. A second person
-- (or the owner) signs it off, and a signed-off day cannot be changed.
-- Not covered: per-cashier shift variance (close_cashier_shift is a live function not in this
-- project), card settlements, and bank deposits.
-- ============================================================
DO $$ BEGIN
  IF to_regprocedure('public.pos_has_permission(text)') IS NULL OR to_regclass('public.pos_sale_reversals') IS NULL THEN
    RAISE EXCEPTION 'Run phase28_staff_permissions.sql and phase29_sale_reversals.sql first.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS pos_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_tenant_id uuid NOT NULL,
  business_id uuid NOT NULL,
  rec_date date NOT NULL,
  opening_float numeric(15,2) NOT NULL DEFAULT 0,
  expected_cash numeric(15,2) NOT NULL,
  expected_mpesa numeric(15,2) NOT NULL,
  counted_cash numeric(15,2) NOT NULL CHECK (counted_cash >= 0),
  counted_mpesa numeric(15,2) NOT NULL CHECK (counted_mpesa >= 0),
  variance_cash numeric(15,2) NOT NULL,
  variance_mpesa numeric(15,2) NOT NULL,
  components jsonb NOT NULL,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SIGNED_OFF')),
  prepared_by uuid NOT NULL,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  signed_by uuid,
  signed_at timestamptz,
  self_signed boolean NOT NULL DEFAULT false,
  UNIQUE (business_id, rec_date)
);
ALTER TABLE pos_reconciliations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pos_reconciliations FROM PUBLIC, anon, authenticated;

-- what the books say for that day (no permission check: callers below check)
CREATE OR REPLACE FUNCTION _reconcile_expected(p_tenant uuid, p_business uuid, p_date date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  tz constant text := 'Africa/Nairobi';
  v_cash_sales numeric := 0; v_mpesa_sales numeric := 0; v_card_sales numeric := 0; v_credit_sales numeric := 0;
  v_folio_cash numeric := 0; v_folio_mpesa numeric := 0; v_cash_in numeric := 0; v_cash_out numeric := 0; v_cash_exp numeric := 0;
  v_rev_cash numeric := 0; v_rev_mpesa numeric := 0; v_warn jsonb := '[]'::jsonb; v_n integer;
BEGIN
  SELECT coalesce(sum(p.amount - coalesce(p.change_amount,0)) FILTER (WHERE p.payment_method::text = 'CASH'),0),
         coalesce(sum(p.amount) FILTER (WHERE p.payment_method::text = 'MOBILE_MONEY'),0),
         coalesce(sum(p.amount) FILTER (WHERE p.payment_method::text = 'CARD'),0),
         coalesce(sum(p.amount) FILTER (WHERE p.payment_method::text = 'CREDIT'),0)
    INTO v_cash_sales, v_mpesa_sales, v_card_sales, v_credit_sales
    FROM lb_payments p JOIN lb_sales s ON s.id = p.sale_id
   WHERE s.tenant_id = p_tenant AND s.business_id = p_business AND p.status::text = 'COMPLETED'
     AND (p.created_at AT TIME ZONE tz)::date = p_date;

  SELECT coalesce(sum(amount) FILTER (WHERE payment_method::text = 'CASH'),0),
         coalesce(sum(amount) FILTER (WHERE payment_method::text = 'MOBILE_MONEY'),0)
    INTO v_folio_cash, v_folio_mpesa
    FROM lb_folio_payments WHERE tenant_id = p_tenant AND business_id = p_business AND (created_at AT TIME ZONE tz)::date = p_date;

  SELECT coalesce(sum(amount) FILTER (WHERE movement_type::text = 'CASH_IN'),0),
         coalesce(sum(amount) FILTER (WHERE movement_type::text = 'CASH_OUT'),0)
    INTO v_cash_in, v_cash_out
    FROM lb_cash_movements WHERE business_id = p_business AND (created_at AT TIME ZONE tz)::date = p_date;

  SELECT coalesce(sum(amount),0) INTO v_cash_exp FROM lb_expenses
   WHERE tenant_id = p_tenant AND business_id = p_business AND expense_date = p_date AND payment_method::text = 'CASH'
     AND coalesce(status::text,'') NOT IN ('CANCELLED','VOID','VOIDED','REJECTED');

  -- Reversals decided today whose refund is NOT already cancelled out of today's payments:
  -- the sale was paid on an earlier day, or its payments could not be marked refunded.
  SELECT coalesce(sum((r.effects->>'cash')::numeric),0), coalesce(sum((r.effects->>'mobile_money')::numeric),0)
    INTO v_rev_cash, v_rev_mpesa
    FROM pos_sale_reversals r JOIN lb_sales s ON s.id = r.sale_id
   WHERE r.pos_tenant_id = p_tenant AND r.business_id = p_business AND r.status = 'APPROVED'
     AND (r.decided_at AT TIME ZONE tz)::date = p_date
     AND ((s.completed_at AT TIME ZONE tz)::date < p_date OR r.warnings::text LIKE '%PAYMENTS_NOT_MARKED%');

  SELECT count(*) INTO v_n FROM lb_mpesa_transactions
   WHERE tenant_id = p_tenant AND business_id = p_business AND (created_at AT TIME ZONE tz)::date = p_date AND status::text = 'PENDING';
  IF v_n > 0 THEN v_warn := v_warn || to_jsonb(v_n || ' M-Pesa request(s) are still waiting for payment. They are not counted.'::text); END IF;
  SELECT count(*) INTO v_n FROM lb_mpesa_transactions
   WHERE tenant_id = p_tenant AND business_id = p_business AND (created_at AT TIME ZONE tz)::date = p_date AND status::text = 'PAID' AND sale_id IS NULL;
  IF v_n > 0 THEN v_warn := v_warn || to_jsonb(v_n || ' M-Pesa payment(s) were confirmed but have no sale attached. Check the M-Pesa page.'::text); END IF;
  SELECT count(*) INTO v_n FROM lb_payments p JOIN lb_sales s ON s.id = p.sale_id
   WHERE s.tenant_id = p_tenant AND s.business_id = p_business AND p.status::text = 'COMPLETED' AND p.payment_method::text = 'MOBILE_MONEY'
     AND coalesce(btrim(p.reference_no),'') = '' AND (p.created_at AT TIME ZONE tz)::date = p_date;
  IF v_n > 0 THEN v_warn := v_warn || to_jsonb(v_n || ' M-Pesa sale(s) have no M-Pesa code, so they cannot be matched to the statement.'::text); END IF;

  RETURN jsonb_build_object(
    'cash_sales', v_cash_sales, 'folio_cash', v_folio_cash, 'cash_in', v_cash_in, 'cash_out', v_cash_out,
    'cash_spending', v_cash_exp, 'reversal_cash_given_back', v_rev_cash,
    'expected_cash', v_cash_sales + v_folio_cash + v_cash_in - v_cash_out - v_cash_exp - v_rev_cash,
    'mpesa_sales', v_mpesa_sales, 'folio_mpesa', v_folio_mpesa, 'reversal_mpesa_to_send', v_rev_mpesa,
    'expected_mpesa', v_mpesa_sales + v_folio_mpesa - v_rev_mpesa,
    'card_sales', v_card_sales, 'credit_sales', v_credit_sales, 'warnings', v_warn);
END $$;
REVOKE ALL ON FUNCTION _reconcile_expected(uuid,uuid,date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION pos__biz_ok(p_business uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM lb_businesses WHERE id = p_business AND tenant_id = pos28_tenant_id()) $$;
REVOKE ALL ON FUNCTION pos__biz_ok(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION pos_reconcile_preview(p_business uuid, p_date date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record;
BEGIN
  IF NOT pos_has_permission('finance.view') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='42501'; END IF;
  IF NOT pos__biz_ok(p_business) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  SELECT id, status, opening_float, counted_cash, counted_mpesa, notes, variance_cash, variance_mpesa INTO r FROM pos_reconciliations WHERE business_id = p_business AND rec_date = p_date;
  RETURN jsonb_build_object('expected', _reconcile_expected(pos28_tenant_id(), p_business, p_date),
    'saved', CASE WHEN r.id IS NULL THEN NULL ELSE to_jsonb(r) END);
END $$;

CREATE OR REPLACE FUNCTION pos_reconcile_save(p_business uuid, p_date date, p_opening_float numeric, p_counted_cash numeric, p_counted_mpesa numeric, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid := pos28_tenant_id(); e jsonb; vc numeric; vm numeric; v_id uuid; cur record;
BEGIN
  IF NOT pos_has_permission('finance.view') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='42501'; END IF;
  IF NOT pos__biz_ok(p_business) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF p_date > (now() AT TIME ZONE 'Africa/Nairobi')::date THEN RAISE EXCEPTION 'FUTURE_DATE: you cannot reconcile a day that has not happened' USING ERRCODE='22023'; END IF;
  IF p_counted_cash IS NULL OR p_counted_cash < 0 OR p_counted_mpesa IS NULL OR p_counted_mpesa < 0 OR coalesce(p_opening_float,0) < 0 THEN
    RAISE EXCEPTION 'BAD_AMOUNT: amounts cannot be empty or negative' USING ERRCODE='22023'; END IF;
  SELECT id, status INTO cur FROM pos_reconciliations WHERE business_id = p_business AND rec_date = p_date FOR UPDATE;
  IF cur.status = 'SIGNED_OFF' THEN RAISE EXCEPTION 'LOCKED: this day is signed off and cannot be changed' USING ERRCODE='P0001'; END IF;
  e := _reconcile_expected(v_t, p_business, p_date);
  vc := round(p_counted_cash - (coalesce(p_opening_float,0) + (e->>'expected_cash')::numeric), 2);
  vm := round(p_counted_mpesa - (e->>'expected_mpesa')::numeric, 2);
  IF (abs(vc) >= 0.5 OR abs(vm) >= 0.5) AND length(btrim(coalesce(p_notes,''))) < 5 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: there is a difference (cash %, M-Pesa %). Write what you think caused it', vc, vm USING ERRCODE='22023'; END IF;
  INSERT INTO pos_reconciliations (pos_tenant_id, business_id, rec_date, opening_float, expected_cash, expected_mpesa, counted_cash, counted_mpesa, variance_cash, variance_mpesa, components, warnings, notes, prepared_by)
  VALUES (v_t, p_business, p_date, coalesce(p_opening_float,0), (e->>'expected_cash')::numeric, (e->>'expected_mpesa')::numeric, p_counted_cash, p_counted_mpesa, vc, vm, e - 'warnings', e->'warnings', nullif(btrim(coalesce(p_notes,'')),''), pos28_staff_id())
  ON CONFLICT (business_id, rec_date) DO UPDATE SET opening_float=EXCLUDED.opening_float, expected_cash=EXCLUDED.expected_cash, expected_mpesa=EXCLUDED.expected_mpesa,
     counted_cash=EXCLUDED.counted_cash, counted_mpesa=EXCLUDED.counted_mpesa, variance_cash=EXCLUDED.variance_cash, variance_mpesa=EXCLUDED.variance_mpesa,
     components=EXCLUDED.components, warnings=EXCLUDED.warnings, notes=EXCLUDED.notes, prepared_by=EXCLUDED.prepared_by, prepared_at=now()
  RETURNING id INTO v_id;
  INSERT INTO pos_audit_log (pos_tenant_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_t, 'staff', pos28_staff_id(), 'RECONCILIATION_SAVED', 'pos_reconciliations', v_id, jsonb_build_object('date', p_date, 'variance_cash', vc, 'variance_mpesa', vm));
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'variance_cash', vc, 'variance_mpesa', vm);
END $$;

CREATE OR REPLACE FUNCTION pos_reconcile_signoff(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE q record; v_self boolean; v_role text;
BEGIN
  IF NOT (pos_has_permission('finance.view') AND pos_has_permission('payments.approve')) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='42501'; END IF;
  SELECT * INTO q FROM pos_reconciliations WHERE id = p_id AND pos_tenant_id = pos28_tenant_id() FOR UPDATE;
  IF q.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF q.status = 'SIGNED_OFF' THEN RAISE EXCEPTION 'LOCKED: already signed off' USING ERRCODE='P0001'; END IF;
  v_self := q.prepared_by = pos28_staff_id();
  SELECT role::text INTO v_role FROM pos_staff WHERE id = pos28_staff_id();
  IF v_self AND v_role <> 'owner' THEN RAISE EXCEPTION 'SECOND_PERSON: someone else (or the owner) must sign off what you counted' USING ERRCODE='42501'; END IF;
  UPDATE pos_reconciliations SET status='SIGNED_OFF', signed_by=pos28_staff_id(), signed_at=now(), self_signed=v_self WHERE id = q.id;
  INSERT INTO pos_audit_log (pos_tenant_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (q.pos_tenant_id, 'staff', pos28_staff_id(), 'RECONCILIATION_SIGNED_OFF', 'pos_reconciliations', q.id, jsonb_build_object('date', q.rec_date, 'self_signed', v_self));
  RETURN jsonb_build_object('ok', true, 'self_signed', v_self);
END $$;

CREATE OR REPLACE FUNCTION pos_reconcile_list(p_business uuid, p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT pos_has_permission('finance.view') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='42501'; END IF;
  IF NOT pos__biz_ok(p_business) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.rec_date DESC) FROM (
    SELECT r.id, r.rec_date, r.status, r.expected_cash, r.counted_cash, r.variance_cash, r.expected_mpesa, r.counted_mpesa, r.variance_mpesa, r.notes, r.self_signed,
           pb.name AS prepared_by_name, sb.name AS signed_by_name, r.signed_at
      FROM pos_reconciliations r LEFT JOIN pos_staff pb ON pb.id = r.prepared_by LEFT JOIN pos_staff sb ON sb.id = r.signed_by
     WHERE r.business_id = p_business AND r.pos_tenant_id = pos28_tenant_id() AND r.rec_date BETWEEN p_from AND p_to
     ORDER BY r.rec_date DESC LIMIT 400) x), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION pos_reconcile_preview(uuid,date), pos_reconcile_save(uuid,date,numeric,numeric,numeric,text), pos_reconcile_signoff(uuid), pos_reconcile_list(uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pos_reconcile_preview(uuid,date), pos_reconcile_save(uuid,date,numeric,numeric,numeric,text), pos_reconcile_signoff(uuid), pos_reconcile_list(uuid,date,date) TO authenticated;
