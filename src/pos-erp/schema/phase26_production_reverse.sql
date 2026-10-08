-- ============================================================
-- phase26 — Reverse a posted production run
--
-- A posted run used to be final ("use a stock adjustment"). Owners do post the wrong numbers,
-- so a posted run can now be REVERSED, once, with a reason: materials go back into stock at
-- the cost they were issued at, finished goods come out. The run stays on record as REVERSED
-- (never deleted) and no longer counts in yield / wastage figures.
-- Refused when the finished goods are no longer in stock (already sold or used): reversing
-- would make stock negative. Then correct it with a normal stock adjustment instead.
--
-- Needs phase22. Safe to re-run.
-- ============================================================
DO $$ DECLARE c text; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'lb_production_runs'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%DRAFT%' LOOP
    EXECUTE format('ALTER TABLE lb_production_runs DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE lb_production_runs ADD CONSTRAINT lb_production_runs_status_chk CHECK (status IN ('DRAFT','POSTED','CANCELLED','REVERSED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE lb_production_runs ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
ALTER TABLE lb_production_runs ADD COLUMN IF NOT EXISTS reversed_by uuid;
ALTER TABLE lb_production_runs ADD COLUMN IF NOT EXISTS reverse_reason text;

CREATE OR REPLACE FUNCTION _reversal_move_stock(
  p_tenant uuid, p_business uuid, p_warehouse uuid, p_product uuid, p_qty numeric, p_unit_cost numeric, p_run uuid, p_note text, p_by uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_inv record; v_new numeric; v_avg numeric; v_reorder numeric; v_status text; v_rtype text;
BEGIN
  SELECT COALESCE(reorder_level, 0) INTO v_reorder FROM lb_products WHERE id = p_product;
  SELECT * INTO v_inv FROM lb_inventory WHERE product_id = p_product AND warehouse_id = p_warehouse FOR UPDATE;
  IF FOUND THEN
    v_new := v_inv.quantity + p_qty;
    v_avg := CASE WHEN p_qty > 0 AND p_unit_cost > 0 THEN ((v_inv.quantity * v_inv.average_cost) + (p_qty * p_unit_cost)) / NULLIF(v_new, 0) ELSE v_inv.average_cost END;
    v_status := CASE WHEN v_new <= 0 THEN 'OUT_OF_STOCK' WHEN v_new <= v_reorder THEN 'LOW_STOCK' ELSE 'NORMAL' END;
    EXECUTE format('UPDATE lb_inventory SET quantity = %L, average_cost = %L, last_movement_at = now(), stock_status = %L WHERE id = %L', v_new, COALESCE(v_avg, 0), v_status, v_inv.id);
  ELSE
    v_new := p_qty;
    v_status := CASE WHEN v_new <= 0 THEN 'OUT_OF_STOCK' WHEN v_new <= v_reorder THEN 'LOW_STOCK' ELSE 'NORMAL' END;
    EXECUTE format('INSERT INTO lb_inventory (tenant_id, business_id, warehouse_id, product_id, quantity, average_cost, last_movement_at, stock_status) VALUES (%L,%L,%L,%L,%L,%L,now(),%L)',
                   p_tenant, p_business, p_warehouse, p_product, v_new, CASE WHEN p_qty > 0 THEN p_unit_cost ELSE 0 END, v_status);
  END IF;
  v_rtype := CASE WHEN _col_accepts('lb_stock_movements','reference_type','PRODUCTION_RUN') THEN 'PRODUCTION_RUN' ELSE NULL END;
  EXECUTE format('INSERT INTO lb_stock_movements (tenant_id, business_id, warehouse_id, product_id, movement_type, reference_type, reference_id, quantity, unit_cost, total_cost, notes, created_by) VALUES (%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',
                 p_tenant, p_business, p_warehouse, p_product, 'STOCK_ADJUSTMENT', v_rtype, p_run, p_qty, p_unit_cost, abs(p_qty) * p_unit_cost, p_note, p_by);
END $$;

CREATE OR REPLACE FUNCTION reverse_production_run(p_run_id uuid, p_reason text, p_by uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_run lb_production_runs; r record; v_prod lb_products; v_avail numeric; v_note text; v_n integer := 0;
BEGIN
  SELECT * INTO v_run FROM lb_production_runs WHERE id = p_run_id AND tenant_id = get_current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production run not found'; END IF;
  IF v_run.status = 'REVERSED' THEN RAISE EXCEPTION 'This run was already reversed'; END IF;
  IF v_run.status <> 'POSTED' THEN RAISE EXCEPTION 'Only a posted run can be reversed (this one is %)', lower(v_run.status); END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  v_note := 'Reversal of ' || v_run.run_number || ' · ' || btrim(p_reason);

  -- finished goods must still be there
  FOR r IN SELECT o.*, p.name FROM lb_production_run_outputs o JOIN lb_products p ON p.id = o.product_id WHERE o.run_id = v_run.id LOOP
    SELECT * INTO v_prod FROM lb_products WHERE id = r.product_id;
    IF v_prod.track_inventory AND COALESCE(r.actual_quantity, 0) > 0 AND NOT COALESCE(v_prod.allow_negative_stock, false) THEN
      SELECT COALESCE(quantity, 0) INTO v_avail FROM lb_inventory WHERE product_id = r.product_id AND warehouse_id = v_run.warehouse_id;
      IF COALESCE(v_avail, 0) < r.actual_quantity THEN
        RAISE EXCEPTION 'Cannot reverse: only % of % is left in stock (% were made). Use a stock adjustment instead', COALESCE(v_avail, 0), r.name, r.actual_quantity;
      END IF;
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM lb_production_run_outputs WHERE run_id = v_run.id LOOP
    SELECT * INTO v_prod FROM lb_products WHERE id = r.product_id;
    IF v_prod.track_inventory AND COALESCE(r.actual_quantity, 0) > 0 THEN
      PERFORM _reversal_move_stock(v_run.tenant_id, v_run.business_id, v_run.warehouse_id, r.product_id, -r.actual_quantity, COALESCE(r.unit_cost, 0), v_run.id, v_note, p_by); v_n := v_n + 1;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM lb_production_run_inputs WHERE run_id = v_run.id LOOP
    SELECT * INTO v_prod FROM lb_products WHERE id = r.product_id;
    IF v_prod.track_inventory AND COALESCE(r.actual_quantity, 0) > 0 THEN
      PERFORM _reversal_move_stock(v_run.tenant_id, v_run.business_id, v_run.warehouse_id, r.product_id, r.actual_quantity, COALESCE(r.unit_cost, 0), v_run.id, v_note, p_by); v_n := v_n + 1;
    END IF;
  END LOOP;
  UPDATE lb_production_runs SET status = 'REVERSED', reversed_at = now(), reversed_by = p_by, reverse_reason = btrim(p_reason) WHERE id = v_run.id;
  RETURN jsonb_build_object('run_id', v_run.id, 'run_number', v_run.run_number, 'stock_moves', v_n);
END $$;
REVOKE ALL ON FUNCTION _reversal_move_stock FROM PUBLIC;
REVOKE ALL ON FUNCTION reverse_production_run FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reverse_production_run TO authenticated;
