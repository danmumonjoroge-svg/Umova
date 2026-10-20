-- ============================================================
-- Phase 29 -- Sale reversals with approval and audit trail.
-- NOT DEPLOYED. RUN phase28_staff_permissions.sql FIRST (this file stops with an error if you have not). Review, then run manually on STAGING first.
--
-- Replaces the old client-side "void" (saleService.voidSale), which updated the sale
-- from the browser: not atomic, no permission, could be applied twice, never touched
-- cash or the customer's balance.
--
-- Flow
--   cashier  -> pos_request_sale_reversal(sale, reason)           status PENDING
--   approver -> pos_decide_sale_reversal(request, approve, note)  runs ONE atomic reversal
--   anyone with the request -> pos_cancel_sale_reversal(request)  while PENDING
-- An approver (permission refunds.approve: owner / manager by default) may approve
-- a request they raised themselves; it is then flagged self_approved and shown as such.
--
-- What one approved reversal does, all-or-nothing (one transaction):
--   1. sale -> VOIDED (only from COMPLETED; locked, so it cannot happen twice)
--   2. stock goes back in (lb_inventory + lb_stock_movements), tracked items only
--   3. customer credit balance is reduced by exactly what the sale added to it
--      (read from the ledger rows that reference the sale; none found -> a warning, never a guess)
--   4. the sale's payments are marked refunded so cash-up stops counting them
--      (tries REFUNDED / VOIDED / CANCELLED; if the live column accepts none, a warning says so)
--   5. an audit row, and a record of what was done and what still needs a human
-- NOT done automatically (returned as warnings): paying M-Pesa/card money back to the
-- customer, and cash paid out on a later day than the sale (record a Cash Out).
-- Sales charged to a customer folio are refused: remove the charge from the folio instead.
--
-- Also closes the back doors: staff sessions can no longer set a sale to VOIDED, delete a
-- finished sale, or edit/delete payment rows directly. Service-role callers are unaffected.
-- ============================================================

-- Stop early, with a clear message, if phase28 has not been run (it creates the permission helpers this file uses).
DO $$
BEGIN
  IF to_regprocedure('public.is_pos_session()') IS NULL
     OR to_regprocedure('public.pos_has_permission(text)') IS NULL
     OR to_regprocedure('public.pos28_tenant_id()') IS NULL
     OR to_regprocedure('public.pos28_staff_id()') IS NULL THEN
    RAISE EXCEPTION 'Run schema/phase28_staff_permissions.sql first (it adds two small helper functions). Your existing permission system must also be present.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION _col_accepts(p_table text, p_column text, p_label text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((
    SELECT CASE WHEN c.data_type = 'USER-DEFINED'
                THEN EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = c.udt_name AND e.enumlabel = p_label)
                ELSE true END
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = p_table AND c.column_name = p_column), false)
$$;

CREATE TABLE IF NOT EXISTS pos_sale_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_tenant_id uuid NOT NULL,
  business_id uuid,
  sale_id uuid NOT NULL,
  sale_number text,
  sale_total numeric,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 5),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  self_approved boolean NOT NULL DEFAULT false,
  effects jsonb,
  warnings jsonb
);
-- one live request per sale, and an approved one is final: a sale can never be reversed twice
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_sale_reversals_live ON pos_sale_reversals(sale_id) WHERE status IN ('PENDING','APPROVED');
CREATE INDEX IF NOT EXISTS idx_pos_sale_reversals_tenant ON pos_sale_reversals(pos_tenant_id, status, requested_at DESC);
ALTER TABLE pos_sale_reversals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pos_sale_reversals FROM PUBLIC, anon, authenticated;   -- RPCs only

-- ---------- stock back in (same effect as applyStockMovement in the app) ----------
CREATE OR REPLACE FUNCTION _sale_reversal_stock_in(
  p_tenant uuid, p_business uuid, p_warehouse uuid, p_product uuid, p_qty numeric, p_unit_cost numeric, p_sale uuid, p_note text, p_by uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_inv record; v_new numeric; v_reorder numeric; v_status text; v_mtype text; v_rtype text;
BEGIN
  SELECT COALESCE(reorder_level, 0) INTO v_reorder FROM lb_products WHERE id = p_product;
  SELECT * INTO v_inv FROM lb_inventory WHERE product_id = p_product AND warehouse_id = p_warehouse FOR UPDATE;
  IF FOUND THEN
    v_new := v_inv.quantity + p_qty;
    v_status := CASE WHEN v_new <= 0 THEN 'OUT_OF_STOCK' WHEN v_new <= v_reorder THEN 'LOW_STOCK' ELSE 'NORMAL' END;
    EXECUTE format('UPDATE lb_inventory SET quantity = %L, last_movement_at = now(), stock_status = %L WHERE id = %L', v_new, v_status, v_inv.id);
  ELSE
    v_new := p_qty;
    v_status := CASE WHEN v_new <= 0 THEN 'OUT_OF_STOCK' WHEN v_new <= v_reorder THEN 'LOW_STOCK' ELSE 'NORMAL' END;
    EXECUTE format('INSERT INTO lb_inventory (tenant_id, business_id, warehouse_id, product_id, quantity, average_cost, last_movement_at, stock_status) VALUES (%L,%L,%L,%L,%L,%L,now(),%L)',
                   p_tenant, p_business, p_warehouse, p_product, v_new, p_unit_cost, v_status);
  END IF;
  v_mtype := CASE WHEN _col_accepts('lb_stock_movements','movement_type','STOCK_RETURN') THEN 'STOCK_RETURN' ELSE 'STOCK_ADJUSTMENT' END;
  v_rtype := CASE WHEN _col_accepts('lb_stock_movements','reference_type','SALE_VOID') THEN 'SALE_VOID' ELSE NULL END;
  EXECUTE format('INSERT INTO lb_stock_movements (tenant_id, business_id, warehouse_id, product_id, movement_type, reference_type, reference_id, quantity, unit_cost, total_cost, notes, created_by) VALUES (%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',
                 p_tenant, p_business, p_warehouse, p_product, v_mtype, v_rtype, p_sale, p_qty, p_unit_cost, abs(p_qty) * p_unit_cost, p_note, p_by);
END $$;
REVOKE ALL ON FUNCTION _sale_reversal_stock_in(uuid,uuid,uuid,uuid,numeric,numeric,uuid,text,uuid) FROM PUBLIC, anon, authenticated;

-- ---------- the one place a sale is reversed ----------
CREATE OR REPLACE FUNCTION _reverse_sale_core(p_sale_id uuid, p_tenant uuid, p_reason text, p_actor_auth uuid, p_allow_folio boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s record; it record; v_wh uuid; v_note text; v_stock int := 0; v_ledger numeric; v_bal numeric; v_cust uuid;
  v_by jsonb := '{}'::jsonb; v_warn jsonb := '[]'::jsonb; v_marked boolean := false; lbl text; r record; v_old_day boolean := false;
BEGIN
  SELECT id, business_id, branch_id, status::text AS status, customer_id, folio_id, sale_number, total_amount, notes
    INTO s FROM lb_sales WHERE id = p_sale_id AND tenant_id = p_tenant FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'SALE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF s.status = 'VOIDED' THEN RAISE EXCEPTION 'ALREADY_REVERSED' USING ERRCODE='P0001'; END IF;
  IF s.status <> 'COMPLETED' THEN RAISE EXCEPTION 'SALE_NOT_REVERSIBLE: this sale is %', lower(s.status) USING ERRCODE='P0001'; END IF;
  IF s.folio_id IS NOT NULL AND NOT p_allow_folio THEN RAISE EXCEPTION 'SALE_ON_FOLIO: remove the charge from the customer folio instead' USING ERRCODE='P0001'; END IF;
  v_note := 'Reversal of ' || coalesce(s.sale_number, p_sale_id::text) || ' · ' || btrim(p_reason);

  -- 2. stock
  SELECT id INTO v_wh FROM lb_warehouses WHERE business_id = s.business_id AND is_default = true LIMIT 1;
  FOR it IN SELECT product_id, quantity, cost_price FROM lb_sale_items WHERE sale_id = p_sale_id LOOP
    IF it.product_id IS NOT NULL AND coalesce(it.quantity,0) > 0
       AND EXISTS (SELECT 1 FROM lb_products WHERE id = it.product_id AND track_inventory) THEN
      IF v_wh IS NULL THEN RAISE EXCEPTION 'NO_DEFAULT_WAREHOUSE' USING ERRCODE='P0001'; END IF;
      PERFORM _sale_reversal_stock_in(p_tenant, s.business_id, v_wh, it.product_id, it.quantity, coalesce(it.cost_price,0), p_sale_id, v_note, p_actor_auth);
      v_stock := v_stock + 1;
    END IF;
  END LOOP;

  -- 3. credit balance: exactly what the ledger says this sale added
  IF s.customer_id IS NOT NULL THEN
    SELECT coalesce(sum(amount),0) INTO v_ledger FROM lb_customer_credit_transactions
     WHERE customer_id = s.customer_id AND reference_id = p_sale_id AND amount > 0;
    IF v_ledger > 0 THEN
      UPDATE lb_customers SET outstanding_balance = greatest(0, outstanding_balance - v_ledger), updated_at = now()
       WHERE id = s.customer_id AND tenant_id = p_tenant RETURNING outstanding_balance INTO v_bal;
      EXECUTE format('INSERT INTO lb_customer_credit_transactions (tenant_id, business_id, customer_id, transaction_type, reference_type, reference_id, amount, balance_after, notes, created_by) VALUES (%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',
        p_tenant, s.business_id, s.customer_id, 'ADJUSTMENT', 'sale_reversal', p_sale_id, -v_ledger, v_bal, v_note, p_actor_auth);
      v_by := v_by || jsonb_build_object('credit_balance_reduced', v_ledger);
    ELSIF EXISTS (SELECT 1 FROM lb_payments WHERE sale_id = p_sale_id AND payment_method::text = 'CREDIT' AND status::text = 'COMPLETED') THEN
      v_warn := v_warn || to_jsonb('CREDIT_NOT_ADJUSTED: this was a credit sale but no ledger entry was found for it, so the customer balance was NOT changed. Check the customer''s account.'::text);
    END IF;
  END IF;

  -- 4. payments: net amount per method, then mark refunded so cash-up stops counting them
  FOR r IN SELECT payment_method::text AS m, sum(amount - coalesce(change_amount,0)) AS net, min(created_at::date) AS d
             FROM lb_payments WHERE sale_id = p_sale_id AND status::text = 'COMPLETED' GROUP BY 1 LOOP
    v_by := v_by || jsonb_build_object(lower(r.m), r.net);
    IF r.d < current_date AND r.m = 'CASH' THEN v_old_day := true; END IF;
    IF r.m = 'MOBILE_MONEY' THEN v_warn := v_warn || to_jsonb(('MPESA_PAYOUT: send KES ' || r.net || ' back to the customer by M-Pesa. The system cannot do this for you.')::text); END IF;
    IF r.m = 'CARD' THEN v_warn := v_warn || to_jsonb(('CARD_REFUND: refund KES ' || r.net || ' to the customer''s card through your card provider.')::text); END IF;
    IF r.m = 'CASH' AND r.net > 0 THEN v_warn := v_warn || to_jsonb(('CASH_REFUND: give the customer KES ' || r.net || ' cash back.')::text); END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM lb_payments WHERE sale_id = p_sale_id AND status::text = 'COMPLETED') THEN
    FOREACH lbl IN ARRAY ARRAY['REFUNDED','VOIDED','CANCELLED'] LOOP
      EXIT WHEN v_marked;
      IF _col_accepts('lb_payments','status',lbl) THEN
        BEGIN
          EXECUTE format('UPDATE lb_payments SET status = %L WHERE sale_id = %L AND status::text = %L', lbl, p_sale_id, 'COMPLETED');
          v_marked := true; v_by := v_by || jsonb_build_object('payments_marked', lbl);
        EXCEPTION WHEN check_violation OR invalid_text_representation THEN NULL;
        END;
      END IF;
    END LOOP;
    IF NOT v_marked THEN
      v_warn := v_warn || to_jsonb('PAYMENTS_NOT_MARKED: the payment records could not be marked refunded, so cash-up still counts this sale''s payments. Adjust the cash-up by hand.'::text);
    ELSIF v_old_day THEN
      v_warn := v_warn || to_jsonb('CASH_OUT_TODAY: the sale was paid on an earlier day, so that day''s cash-up already counted it. Record the cash you gave back as a Cash Out today.'::text);
    END IF;
  END IF;

  -- 1. the sale itself (last, so any failure above leaves it untouched)
  EXECUTE format('UPDATE lb_sales SET status = %L, notes = %L, updated_at = now() WHERE id = %L',
                 'VOIDED', CASE WHEN coalesce(s.notes,'') = '' THEN 'Reversed: ' || btrim(p_reason) ELSE s.notes || ' | Reversed: ' || btrim(p_reason) END, p_sale_id);

  RETURN jsonb_build_object('effects', v_by || jsonb_build_object('stock_lines_returned', v_stock, 'sale_total', s.total_amount),
                            'warnings', v_warn, 'sale_number', s.sale_number, 'business_id', s.business_id);
END $$;
REVOKE ALL ON FUNCTION _reverse_sale_core(uuid,uuid,text,uuid,boolean) FROM PUBLIC, anon, authenticated;

-- ---------- helpers ----------
CREATE OR REPLACE FUNCTION pos__me() RETURNS record LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT id, auth_user_id, pos_tenant_id, name FROM pos_staff WHERE id = pos28_staff_id() $$;
REVOKE ALL ON FUNCTION pos__me() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION pos__audit_sale(p_action text, p_sale uuid, p_meta jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO pos_audit_log (pos_tenant_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (pos28_tenant_id(), 'staff', pos28_staff_id(), p_action, 'lb_sales', p_sale, p_meta) $$;
REVOKE ALL ON FUNCTION pos__audit_sale(text,uuid,jsonb) FROM PUBLIC, anon, authenticated;

-- ---------- RPCs ----------
CREATE OR REPLACE FUNCTION pos_recent_sales(p_search text DEFAULT NULL, p_limit integer DEFAULT 40) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid := pos28_tenant_id(); v_approver boolean := pos_has_permission('refunds.approve'); v_auth uuid; BEGIN
  IF NOT (v_approver OR pos_has_permission('refunds.request')) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='42501'; END IF;
  SELECT auth_user_id INTO v_auth FROM pos_staff WHERE id = pos28_staff_id();
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY (x->>'completed_at') DESC) FROM (
    SELECT jsonb_build_object('id', s.id, 'sale_number', s.sale_number, 'total_amount', s.total_amount, 'completed_at', s.completed_at,
             'on_folio', s.folio_id IS NOT NULL,
             'live_request', EXISTS (SELECT 1 FROM pos_sale_reversals r WHERE r.sale_id = s.id AND r.status IN ('PENDING','APPROVED'))) AS x
      FROM lb_sales s
     WHERE s.tenant_id = v_t AND s.status::text = 'COMPLETED'
       AND (v_approver OR (s.cashier_id = v_auth AND s.completed_at > now() - interval '24 hours'))
       AND (p_search IS NULL OR btrim(p_search) = '' OR s.sale_number ILIKE '%' || btrim(p_search) || '%')
     ORDER BY s.completed_at DESC LIMIT least(greatest(p_limit,1),100)) q), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION pos_request_sale_reversal(p_sale_id uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid := pos28_tenant_id(); s record; v_auth uuid; v_id uuid; v_approver boolean := pos_has_permission('refunds.approve');
BEGIN
  IF NOT (v_approver OR pos_has_permission('refunds.request')) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='42501'; END IF;
  IF length(btrim(coalesce(p_reason,''))) < 5 THEN RAISE EXCEPTION 'REASON_REQUIRED: give a reason of at least 5 characters' USING ERRCODE='22023'; END IF;
  SELECT auth_user_id INTO v_auth FROM pos_staff WHERE id = pos28_staff_id();
  SELECT id, business_id, sale_number, total_amount, status::text AS status, folio_id, cashier_id, completed_at INTO s
    FROM lb_sales WHERE id = p_sale_id AND tenant_id = v_t;
  IF s.id IS NULL THEN RAISE EXCEPTION 'SALE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF NOT v_approver AND (s.cashier_id IS DISTINCT FROM v_auth OR s.completed_at < now() - interval '24 hours') THEN
    RAISE EXCEPTION 'NOT_ALLOWED: you can only ask to reverse your own sales from the last 24 hours' USING ERRCODE='42501'; END IF;
  IF s.status = 'VOIDED' THEN RAISE EXCEPTION 'ALREADY_REVERSED' USING ERRCODE='P0001'; END IF;
  IF s.status <> 'COMPLETED' THEN RAISE EXCEPTION 'SALE_NOT_REVERSIBLE: this sale is %', lower(s.status) USING ERRCODE='P0001'; END IF;
  IF s.folio_id IS NOT NULL THEN RAISE EXCEPTION 'SALE_ON_FOLIO: remove the charge from the customer folio instead' USING ERRCODE='P0001'; END IF;
  BEGIN
    INSERT INTO pos_sale_reversals (pos_tenant_id, business_id, sale_id, sale_number, sale_total, reason, requested_by)
    VALUES (v_t, s.business_id, s.id, s.sale_number, s.total_amount, btrim(p_reason), pos28_staff_id()) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'ALREADY_REQUESTED: this sale already has a reversal request' USING ERRCODE='P0001'; END;
  PERFORM pos__audit_sale('SALE_REVERSAL_REQUESTED', s.id, jsonb_build_object('request_id', v_id, 'reason', btrim(p_reason), 'sale_number', s.sale_number));
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

CREATE OR REPLACE FUNCTION pos_decide_sale_reversal(p_request_id uuid, p_approve boolean, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid := pos28_tenant_id(); q record; v_auth uuid; res jsonb; v_self boolean;
BEGIN
  IF NOT pos_has_permission('refunds.approve') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='42501'; END IF;
  SELECT * INTO q FROM pos_sale_reversals WHERE id = p_request_id AND pos_tenant_id = v_t FOR UPDATE;
  IF q.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF q.status <> 'PENDING' THEN RAISE EXCEPTION 'ALREADY_DECIDED: this request is %', lower(q.status) USING ERRCODE='P0001'; END IF;
  v_self := q.requested_by = pos28_staff_id();
  IF NOT p_approve THEN
    IF length(btrim(coalesce(p_note,''))) < 3 THEN RAISE EXCEPTION 'NOTE_REQUIRED: say why it is refused' USING ERRCODE='22023'; END IF;
    UPDATE pos_sale_reversals SET status='REJECTED', decided_by=pos28_staff_id(), decided_at=now(), decision_note=btrim(p_note), self_approved=v_self WHERE id=q.id;
    PERFORM pos__audit_sale('SALE_REVERSAL_REJECTED', q.sale_id, jsonb_build_object('request_id', q.id, 'note', btrim(p_note)));
    RETURN jsonb_build_object('ok', true, 'status', 'REJECTED');
  END IF;
  SELECT auth_user_id INTO v_auth FROM pos_staff WHERE id = pos28_staff_id();
  res := _reverse_sale_core(q.sale_id, v_t, q.reason, v_auth, false);   -- any failure rolls the whole decision back
  UPDATE pos_sale_reversals SET status='APPROVED', decided_by=pos28_staff_id(), decided_at=now(), decision_note=nullif(btrim(coalesce(p_note,'')),''),
         self_approved=v_self, effects=res->'effects', warnings=res->'warnings' WHERE id=q.id;
  PERFORM pos__audit_sale('SALE_REVERSED', q.sale_id, jsonb_build_object('request_id', q.id, 'self_approved', v_self, 'effects', res->'effects', 'warnings', res->'warnings', 'reason', q.reason));
  RETURN jsonb_build_object('ok', true, 'status', 'APPROVED', 'effects', res->'effects', 'warnings', res->'warnings');
END $$;

CREATE OR REPLACE FUNCTION pos_cancel_sale_reversal(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE q record;
BEGIN
  SELECT * INTO q FROM pos_sale_reversals WHERE id = p_request_id AND pos_tenant_id = pos28_tenant_id() FOR UPDATE;
  IF q.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF q.requested_by <> pos28_staff_id() THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='42501'; END IF;
  IF q.status <> 'PENDING' THEN RAISE EXCEPTION 'ALREADY_DECIDED: this request is %', lower(q.status) USING ERRCODE='P0001'; END IF;
  UPDATE pos_sale_reversals SET status='CANCELLED', decided_by=pos28_staff_id(), decided_at=now() WHERE id=q.id;
  PERFORM pos__audit_sale('SALE_REVERSAL_CANCELLED', q.sale_id, jsonb_build_object('request_id', q.id));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION pos_list_sale_reversals(p_status text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid := pos28_tenant_id(); v_approver boolean := pos_has_permission('refunds.approve');
BEGIN
  IF NOT (v_approver OR pos_has_permission('refunds.request')) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.requested_at DESC) FROM (
    SELECT r.id, r.sale_id, r.sale_number, r.sale_total, r.reason, r.status, r.requested_at, r.decided_at, r.decision_note, r.self_approved, r.effects, r.warnings,
           rq.name AS requested_by_name, dc.name AS decided_by_name, (r.requested_by = pos28_staff_id()) AS mine
      FROM pos_sale_reversals r
      LEFT JOIN pos_staff rq ON rq.id = r.requested_by LEFT JOIN pos_staff dc ON dc.id = r.decided_by
     WHERE r.pos_tenant_id = v_t AND (v_approver OR r.requested_by = pos28_staff_id())
       AND (p_status IS NULL OR r.status = p_status)
     ORDER BY r.requested_at DESC LIMIT 200) x), '[]'::jsonb);
END $$;

-- The sale you just made could not be posted to its folio (saleService.create). Only the cashier
-- who made it, within 10 minutes, only while no folio line exists. Not a way around approval.
CREATE OR REPLACE FUNCTION pos_rollback_new_sale(p_sale_id uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid := pos28_tenant_id(); v_auth uuid; s record; res jsonb;
BEGIN
  SELECT auth_user_id INTO v_auth FROM pos_staff WHERE id = pos28_staff_id();
  SELECT id, cashier_id, folio_id, completed_at INTO s FROM lb_sales WHERE id = p_sale_id AND tenant_id = v_t;
  IF s.id IS NULL OR s.cashier_id IS DISTINCT FROM v_auth OR s.folio_id IS NULL OR s.completed_at < now() - interval '10 minutes'
     OR EXISTS (SELECT 1 FROM lb_folio_lines WHERE sale_id = s.id AND status = 'POSTED') THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='42501'; END IF;
  res := _reverse_sale_core(p_sale_id, v_t, coalesce(nullif(btrim(p_reason),''), 'Could not be charged to the folio'), v_auth, true);
  PERFORM pos__audit_sale('SALE_ROLLED_BACK', p_sale_id, jsonb_build_object('effects', res->'effects', 'warnings', res->'warnings'));
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION pos_recent_sales(text,integer), pos_request_sale_reversal(uuid,text), pos_decide_sale_reversal(uuid,boolean,text),
  pos_cancel_sale_reversal(uuid), pos_list_sale_reversals(text), pos_rollback_new_sale(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pos_recent_sales(text,integer), pos_request_sale_reversal(uuid,text), pos_decide_sale_reversal(uuid,boolean,text),
  pos_cancel_sale_reversal(uuid), pos_list_sale_reversals(text), pos_rollback_new_sale(uuid,text) TO authenticated;

-- ---------- close the back doors (staff sessions only; ANDed with existing policies) ----------
DO $$
BEGIN
  IF to_regclass('public.lb_sales') IS NOT NULL THEN
    DROP POLICY IF EXISTS r_sales_no_void ON lb_sales;
    CREATE POLICY r_sales_no_void ON lb_sales AS RESTRICTIVE FOR UPDATE
      USING (true) WITH CHECK (NOT is_pos_session() OR status::text IS DISTINCT FROM 'VOIDED');
    DROP POLICY IF EXISTS r_sales_no_delete ON lb_sales;
    CREATE POLICY r_sales_no_delete ON lb_sales AS RESTRICTIVE FOR DELETE
      USING (NOT is_pos_session() OR status::text IN ('DRAFT','HELD','PENDING'));
  END IF;
  IF to_regclass('public.lb_payments') IS NOT NULL THEN
    DROP POLICY IF EXISTS r_payments_no_update ON lb_payments;
    CREATE POLICY r_payments_no_update ON lb_payments AS RESTRICTIVE FOR UPDATE USING (NOT is_pos_session());
    DROP POLICY IF EXISTS r_payments_no_delete ON lb_payments;
    CREATE POLICY r_payments_no_delete ON lb_payments AS RESTRICTIVE FOR DELETE USING (NOT is_pos_session());
  END IF;
END $$;
