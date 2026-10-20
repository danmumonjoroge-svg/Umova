-- phase35_offline_idempotency.sql   (MVP offline-first, step 3)
-- STATUS: written for a STAGING database only. NOT run anywhere. Read "BEFORE YOU RUN" first.
--
-- WHAT IT DOES
--   Lets the app retry an offline expense / customer payment / new customer / stock adjustment any number of times, even if
--   the server already saved it and the reply was lost, without ever saving it twice.
--   * ONE new table  pos_client_ops (tenant_id, client_reference) UNIQUE  -- the "already done" ledger. No client can read or
--     write it directly (RLS on, no policies, no grants); only the four functions below touch it.
--   * Four wrapper functions. Each, in ONE transaction: (1) claims the key, (2) if the key was already used by the SAME
--     request it returns the saved result with duplicate=true and does nothing else, (3) if the key was used by a DIFFERENT
--     request it refuses loudly (error P0409, nothing saved), (4) otherwise checks permission + business, calls the EXISTING
--     function (record_expense / record_customer_payment) or does the work, and stores the result.
--     If anything fails, the whole transaction rolls back INCLUDING the claim, so a later retry works.
--   * Two retries at the same moment: the second waits for the first to commit, then returns the first one's result.
--
-- WHAT IT DOES NOT TOUCH
--   No existing table is altered. No existing function is replaced. RLS and permission triggers on lb_expenses /
--   lb_customer_payments still fire (the wrappers also call pos_require() themselves). Nothing is granted to anon.
--
-- STOCK ADJUSTMENT (conflict rule)
--   The app used to read the quantity, add the change in the browser and write the total back (two phones could overwrite
--   each other). pos_apply_stock_adjustment() instead locks the stock row and applies the CHANGE (+/-) on the server, then
--   writes the movement. Two phones' changes add up. A result below zero is ACCEPTED and flagged (negative=true) because
--   the goods really moved; the owner sees it. It follows the same pattern as _package_move_stock() in phase23.
--   NOTE: goods receiving (purchaseService.applyStockMovement) still reads-then-writes in the browser. Until it is moved onto
--   the same server function, a receipt saved at the very same instant as an adjustment could lose one of them. Receiving
--   stays online-only and is the next thing to move.
--
-- BEFORE YOU RUN (staging only)
--   1. Run schema/diagnostics/phase35_precheck.sql and read every result. It is read-only.
--   2. Confirm phase28 (pos_require, is_pos_session) exists. This file stops with an error if not.
--   3. Run this file once. It is safe to run twice (IF NOT EXISTS / CREATE OR REPLACE).
-- ROLLBACK
--   DROP FUNCTION pos_apply_expense, pos_apply_customer_payment, pos_create_customer, pos_apply_stock_adjustment,
--   _pos_claim_op, _pos_finish_op;  DROP TABLE pos_client_ops;   (loses only the "already done" memory)

DO $$ BEGIN
  IF to_regprocedure('pos_require(text[])') IS NULL OR to_regprocedure('is_pos_session()') IS NULL THEN
    RAISE EXCEPTION 'phase35 needs phase28_permissions.sql first (pos_require / is_pos_session not found).';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS pos_client_ops (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  client_reference text NOT NULL CHECK (length(btrim(client_reference)) >= 8),
  kind             text NOT NULL,
  request_hash     text NOT NULL,
  result           jsonb,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, client_reference)
);
ALTER TABLE pos_client_ops ENABLE ROW LEVEL SECURITY;
-- Deliberately NO policies and NO grants: nobody signed in through the API can read or write this table directly.
REVOKE ALL ON pos_client_ops FROM PUBLIC, anon, authenticated;

-- ---------- claim / finish ----------
CREATE OR REPLACE FUNCTION _pos_claim_op(p_kind text, p_ref text, p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := get_current_tenant_id(); v_n int; v_row pos_client_ops;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No business in this session.' USING ERRCODE = '42501'; END IF;
  IF p_ref IS NULL OR length(btrim(p_ref)) < 8 THEN RAISE EXCEPTION 'A client reference (8+ characters) is required.' USING ERRCODE = '22023'; END IF;
  INSERT INTO pos_client_ops (tenant_id, client_reference, kind, request_hash, created_by)
  VALUES (v_tenant, p_ref, p_kind, p_hash, nullif(auth.jwt() ->> 'pos_staff_id', '')::uuid)
  ON CONFLICT (tenant_id, client_reference) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 1 THEN RETURN NULL; END IF;                       -- first time: caller goes on to do the work
  SELECT * INTO v_row FROM pos_client_ops WHERE tenant_id = v_tenant AND client_reference = p_ref;
  IF v_row.kind <> p_kind OR v_row.request_hash <> p_hash THEN
    RAISE EXCEPTION 'Reference % was already used for a different request. Nothing was saved.', p_ref USING ERRCODE = 'P0409';
  END IF;
  IF v_row.result IS NULL THEN RAISE EXCEPTION 'Reference % is still being processed. Try again.', p_ref USING ERRCODE = '40001'; END IF;
  RETURN v_row.result || jsonb_build_object('duplicate', true);
END $$;

CREATE OR REPLACE FUNCTION _pos_finish_op(p_ref text, p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE pos_client_ops SET result = p_result WHERE tenant_id = get_current_tenant_id() AND client_reference = p_ref;
  RETURN p_result || jsonb_build_object('duplicate', false);
END $$;

-- ---------- 1. expense ----------
CREATE OR REPLACE FUNCTION pos_apply_expense(
  p_client_reference text, p_business_id uuid, p_branch_id uuid, p_category_id uuid, p_expense_date date,
  p_amount numeric, p_payment_method text, p_description text, p_attachment_url text, p_status text,
  p_created_by uuid, p_occurred_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := get_current_tenant_id(); v_prev jsonb; v_id uuid;
BEGIN
  PERFORM pos_require('expenses.record');
  v_prev := _pos_claim_op('expense', p_client_reference, md5(concat_ws('|', p_business_id, p_branch_id, p_category_id, p_expense_date, p_amount, p_payment_method, p_description, p_attachment_url, p_status)));
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Expense amount must be greater than zero.' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM lb_businesses WHERE id = p_business_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Business not found.' USING ERRCODE = '42501';
  END IF;
  v_id := record_expense(p_business_id, p_branch_id, p_category_id, p_expense_date, p_amount, p_payment_method::lb_payment_method,
                         p_description, p_attachment_url, coalesce(p_status, 'PAID'), p_created_by);
  RETURN _pos_finish_op(p_client_reference, jsonb_build_object('id', v_id));
END $$;

-- ---------- 2. customer payment ----------
CREATE OR REPLACE FUNCTION pos_apply_customer_payment(
  p_client_reference text, p_business_id uuid, p_branch_id uuid, p_customer_id uuid, p_amount numeric,
  p_payment_method text, p_reference_no text, p_notes text, p_created_by uuid, p_occurred_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := get_current_tenant_id(); v_prev jsonb; v_id uuid;
BEGIN
  PERFORM pos_require('payments.record');
  v_prev := _pos_claim_op('customer_payment', p_client_reference, md5(concat_ws('|', p_business_id, p_branch_id, p_customer_id, p_amount, p_payment_method, p_reference_no, p_notes)));
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Payment amount must be greater than zero.' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM lb_customers WHERE id = p_customer_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Customer not found in this business.' USING ERRCODE = '42501';
  END IF;
  v_id := record_customer_payment(p_business_id, p_branch_id, p_customer_id, p_amount, p_payment_method::lb_payment_method,
                                  p_reference_no, p_notes, p_created_by);
  RETURN _pos_finish_op(p_client_reference, jsonb_build_object('id', v_id));
END $$;

-- ---------- 3. new customer (the phone chooses the id, so a payment queued for this customer can name it) ----------
CREATE OR REPLACE FUNCTION pos_create_customer(
  p_client_reference text, p_id uuid, p_business_id uuid, p_name text, p_phone text, p_email text, p_address text,
  p_customer_type text, p_credit_limit numeric, p_created_by uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := get_current_tenant_id(); v_prev jsonb;
BEGIN
  PERFORM pos_require('sales.create', 'payments.record', 'balances.view');
  v_prev := _pos_claim_op('customer', p_client_reference, md5(concat_ws('|', p_id, p_business_id, p_name, p_phone, p_email, p_address, p_customer_type, p_credit_limit)));
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  IF p_id IS NULL THEN RAISE EXCEPTION 'A customer id is required.' USING ERRCODE = '22023'; END IF;
  IF btrim(coalesce(p_name, '')) = '' THEN RAISE EXCEPTION 'Customer name is required.' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM lb_businesses WHERE id = p_business_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Business not found.' USING ERRCODE = '42501';
  END IF;
  -- %L literals let Postgres coerce text to the real column types (customer_type may be an enum) without guessing them here.
  EXECUTE format('INSERT INTO lb_customers (id, tenant_id, business_id, name, phone, email, address, customer_type, credit_limit, created_by) VALUES (%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',
                 p_id, v_tenant, p_business_id, btrim(p_name), p_phone, p_email, p_address, coalesce(p_customer_type, 'WALK_IN'), coalesce(p_credit_limit, 0), p_created_by);
  RETURN _pos_finish_op(p_client_reference, jsonb_build_object('id', p_id));
END $$;

-- ---------- 4. stock adjustment (applies a CHANGE, never overwrites a quantity) ----------
CREATE OR REPLACE FUNCTION pos_apply_stock_adjustment(
  p_client_reference text, p_business_id uuid, p_product_id uuid, p_movement_type text, p_quantity numeric,
  p_reason text, p_created_by uuid, p_occurred_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant uuid := get_current_tenant_id(); v_prev jsonb; v_wh uuid; v_track boolean; v_reorder numeric;
  v_inv record; v_new numeric; v_status text; v_note text;
BEGIN
  PERFORM pos_require('inventory.adjust');
  v_prev := _pos_claim_op('stock_adjustment', p_client_reference, md5(concat_ws('|', p_business_id, p_product_id, p_movement_type, p_quantity, p_reason)));
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  IF p_movement_type NOT IN ('STOCK_ADJUSTMENT', 'STOCK_COUNT', 'DAMAGED', 'EXPIRED', 'OPENING_STOCK') THEN
    RAISE EXCEPTION 'Unsupported stock adjustment type.' USING ERRCODE = '22023';
  END IF;
  IF p_quantity IS NULL OR p_quantity = 0 THEN RAISE EXCEPTION 'Quantity must not be zero.' USING ERRCODE = '22023'; END IF;
  IF p_movement_type IN ('DAMAGED', 'EXPIRED') AND p_quantity > 0 THEN RAISE EXCEPTION '% must reduce stock (negative quantity).', p_movement_type USING ERRCODE = '22023'; END IF;
  IF p_movement_type = 'OPENING_STOCK' AND p_quantity < 0 THEN RAISE EXCEPTION 'OPENING_STOCK cannot be negative.' USING ERRCODE = '22023'; END IF;

  SELECT track_inventory, coalesce(reorder_level, 0) INTO v_track, v_reorder FROM lb_products WHERE id = p_product_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item not found in this business.' USING ERRCODE = '42501'; END IF;
  IF NOT v_track THEN RETURN _pos_finish_op(p_client_reference, jsonb_build_object('skipped', true, 'reason', 'PRODUCT_NOT_TRACKED')); END IF;

  SELECT id INTO v_wh FROM lb_warehouses WHERE tenant_id = v_tenant AND is_default = true LIMIT 1;
  IF v_wh IS NULL THEN RAISE EXCEPTION 'No default warehouse for this business.' USING ERRCODE = '22023'; END IF;

  -- one adjustment at a time per item+warehouse (also covers "no row yet" where FOR UPDATE has nothing to lock)
  PERFORM pg_advisory_xact_lock(hashtextextended(p_product_id::text || v_wh::text, 0));
  SELECT * INTO v_inv FROM lb_inventory WHERE product_id = p_product_id AND warehouse_id = v_wh FOR UPDATE;
  v_new := coalesce(v_inv.quantity, 0) + p_quantity;
  v_status := CASE WHEN v_new <= 0 THEN 'OUT_OF_STOCK' WHEN v_new <= v_reorder THEN 'LOW_STOCK' ELSE 'NORMAL' END;
  IF v_inv.id IS NOT NULL THEN
    EXECUTE format('UPDATE lb_inventory SET quantity = %L, last_movement_at = now(), stock_status = %L WHERE id = %L', v_new, v_status, v_inv.id);
  ELSE
    EXECUTE format('INSERT INTO lb_inventory (tenant_id, business_id, warehouse_id, product_id, quantity, average_cost, last_movement_at, stock_status) VALUES (%L,%L,%L,%L,%L,0,now(),%L)',
                   v_tenant, p_business_id, v_wh, p_product_id, v_new, v_status);
  END IF;
  v_note := coalesce(p_reason, '') || CASE WHEN p_occurred_at IS NOT NULL AND p_occurred_at < now() - interval '2 minutes'
                                            THEN ' (made offline ' || to_char(p_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC)' ELSE '' END;
  EXECUTE format('INSERT INTO lb_stock_movements (tenant_id, business_id, warehouse_id, product_id, movement_type, reference_type, quantity, unit_cost, total_cost, notes, created_by) VALUES (%L,%L,%L,%L,%L,%L,%L,0,0,%L,%L)',
                 v_tenant, p_business_id, v_wh, p_product_id, p_movement_type, 'MANUAL_ADJUSTMENT', p_quantity, nullif(v_note, ''), p_created_by);
  RETURN _pos_finish_op(p_client_reference, jsonb_build_object('quantity', v_new, 'negative', v_new < 0, 'stock_status', v_status));
END $$;

-- ---------- who may call ----------
REVOKE ALL ON FUNCTION _pos_claim_op(text, text, text), _pos_finish_op(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION pos_apply_expense(text, uuid, uuid, uuid, date, numeric, text, text, text, text, uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION pos_apply_customer_payment(text, uuid, uuid, uuid, numeric, text, text, text, uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION pos_create_customer(text, uuid, uuid, text, text, text, text, text, numeric, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION pos_apply_stock_adjustment(text, uuid, uuid, text, numeric, text, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pos_apply_expense(text, uuid, uuid, uuid, date, numeric, text, text, text, text, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION pos_apply_customer_payment(text, uuid, uuid, uuid, numeric, text, text, text, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION pos_create_customer(text, uuid, uuid, text, text, text, text, text, numeric, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pos_apply_stock_adjustment(text, uuid, uuid, text, numeric, text, uuid, timestamptz) TO authenticated;
