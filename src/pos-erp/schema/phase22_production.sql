-- ============================================================
-- phase22 — Production (Phase 5 of the hospitality/production upgrade)
--
-- ONE generic engine for bakery, butchery, restaurant kitchen, juice bar:
--     materials (inputs)  --recipe-->  finished goods (one or more outputs)
-- A recipe says what goes in and what should come out FOR ONE BATCH. A run says
-- how many batches were planned and what was REALLY used and made. Posting a run
-- moves stock and records yield, wastage and cost.
--
-- Reuses, does not replace: lb_products (materials and finished goods are
-- ordinary products), lb_inventory + lb_stock_movements (the SAME tables the till
-- and goods receiving write, with the same sign convention: out = negative),
-- lb_warehouses.is_default, next_doc_number() for PRD- numbers, tenant_isolation RLS.
--
-- STOCK TABLES — the question left open since Phase 1:
--   The JS that actually runs (saleService, purchaseService, inventoryService)
--   writes lb_inventory + lb_stock_movements. phase12/14/17 SQL mention
--   lb_inventory_movements instead. Production follows the running code
--   (lb_stock_movements). If your live database really has lb_inventory_movements
--   and no lb_stock_movements, this migration fails loudly on first use — by design.
--
-- DESIGN DECISIONS
--  * Stock is never overwritten: every change is an lb_stock_movements row
--    (reference_id = the run) AND the lb_inventory quantity/average cost moves with it.
--  * Cost: materials are issued at their current average cost. The WHOLE input cost
--    is carried into the finished goods (split across outputs by cost_share_pct), so
--    poor yield shows up as a higher cost per unit instead of vanishing.
--      cost per expected unit = input cost x share / expected output
--      cost per actual unit   = input cost x share / actual output
--      wastage cost           = (expected - actual) x cost per expected unit
--                               (= what the lost output was worth)
--  * Yield % = actual / expected of the PRIMARY output. Extra outputs (butchery:
--    cuts, bones, offcuts) each get their own expected/actual/wastage.
--  * A finished good that is not stock-tracked (a meal made to order) is not
--    counted into stock; the materials are still consumed and costed.
--  * A posted run is final. Corrections are stock adjustments (never silent edits).
--  * Recipes/runs/lines are written only by the SECURITY DEFINER functions below.
--
-- NOT RUN against a live database. Assumed columns (confirm on staging):
--   lb_warehouses(id, tenant_id, is_default); lb_inventory(id, tenant_id, business_id,
--   warehouse_id, product_id, quantity, average_cost, last_movement_at, stock_status);
--   lb_stock_movements(tenant_id, business_id, warehouse_id, product_id, movement_type,
--   reference_type, reference_id, quantity, unit_cost, total_cost, notes, created_by);
--   lb_products(id, tenant_id, name, track_inventory, allow_negative_stock, reorder_level, cost_price).
-- Optional: run phase22a_production_enums.sql first for dedicated movement labels.
-- ============================================================

-- ---------- recipes ----------
CREATE TABLE IF NOT EXISTS lb_production_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  name text NOT NULL,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_production_recipes_name ON lb_production_recipes(business_id, lower(name));

CREATE TABLE IF NOT EXISTS lb_production_recipe_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  recipe_id uuid NOT NULL REFERENCES lb_production_recipes(id),
  product_id uuid NOT NULL REFERENCES lb_products(id),
  quantity numeric(15,4) NOT NULL CHECK (quantity > 0),          -- per ONE batch
  unit text,                                                      -- free label, e.g. kg, L, pcs
  UNIQUE (recipe_id, product_id)
);

CREATE TABLE IF NOT EXISTS lb_production_recipe_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  recipe_id uuid NOT NULL REFERENCES lb_production_recipes(id),
  product_id uuid NOT NULL REFERENCES lb_products(id),
  quantity numeric(15,4) NOT NULL CHECK (quantity > 0),          -- expected from ONE batch
  unit text,
  cost_share_pct numeric(7,3) NOT NULL DEFAULT 100 CHECK (cost_share_pct >= 0 AND cost_share_pct <= 100),
  is_primary boolean NOT NULL DEFAULT false,
  UNIQUE (recipe_id, product_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_recipe_one_primary ON lb_production_recipe_outputs(recipe_id) WHERE is_primary;

-- ---------- runs ----------
CREATE TABLE IF NOT EXISTS lb_production_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  run_number text NOT NULL,
  recipe_id uuid NOT NULL REFERENCES lb_production_recipes(id),
  warehouse_id uuid,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED','CANCELLED')),
  run_date date NOT NULL DEFAULT CURRENT_DATE,
  planned_quantity numeric(15,4) NOT NULL CHECK (planned_quantity > 0),   -- of the PRIMARY output
  scale numeric(15,6) NOT NULL CHECK (scale > 0),                         -- batches = planned / recipe primary quantity
  -- filled when posted
  expected_output numeric(15,4), actual_output numeric(15,4), difference numeric(15,4), yield_pct numeric(8,2),
  wastage_qty numeric(15,4), wastage_cost numeric(15,4), wastage_reason text,
  input_cost numeric(15,4), output_cost numeric(15,4),
  cost_per_expected_unit numeric(15,4), cost_per_actual_unit numeric(15,4),
  inputs_missing_cost integer,
  notes text, client_reference text,
  posted_at timestamptz, posted_by uuid, created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, run_number),
  CHECK (wastage_reason IS NULL OR wastage_reason IN ('Spillage','Burnt','Damaged','Expired','Overproduction','Preparation Loss','Other'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_production_runs_client_ref ON lb_production_runs(tenant_id, client_reference) WHERE client_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lb_production_runs_business ON lb_production_runs(business_id, status, run_date);

CREATE TABLE IF NOT EXISTS lb_production_run_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  run_id uuid NOT NULL REFERENCES lb_production_runs(id),
  product_id uuid NOT NULL REFERENCES lb_products(id),
  unit text,
  planned_quantity numeric(15,4) NOT NULL,
  actual_quantity numeric(15,4),
  unit_cost numeric(15,4), total_cost numeric(15,4),
  UNIQUE (run_id, product_id)
);
CREATE TABLE IF NOT EXISTS lb_production_run_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  run_id uuid NOT NULL REFERENCES lb_production_runs(id),
  product_id uuid NOT NULL REFERENCES lb_products(id),
  unit text, is_primary boolean NOT NULL DEFAULT false,
  cost_share_pct numeric(7,3) NOT NULL DEFAULT 100,
  expected_quantity numeric(15,4) NOT NULL,
  actual_quantity numeric(15,4),
  wastage_qty numeric(15,4), wastage_cost numeric(15,4),
  unit_cost numeric(15,4), total_cost numeric(15,4),
  UNIQUE (run_id, product_id)
);

-- ---------- RLS + closed writes ----------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['lb_production_recipes','lb_production_recipe_inputs','lb_production_recipe_outputs','lb_production_runs','lb_production_run_inputs','lb_production_run_outputs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%I ON %I', t, t);
    EXECUTE format('CREATE POLICY tenant_isolation_%I ON %I FOR ALL USING (tenant_id = get_current_tenant_id()) WITH CHECK (tenant_id = get_current_tenant_id())', t, t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON %I TO authenticated', t);
  END LOOP;
END $$;

-- ---------- recipe list with the expected cost of one batch ----------
CREATE OR REPLACE VIEW lb_recipe_summary WITH (security_invoker = true) AS
SELECT r.id, r.tenant_id, r.business_id, r.name, r.notes, r.is_active, r.created_at,
       (SELECT count(*) FROM lb_production_recipe_inputs i WHERE i.recipe_id = r.id) AS input_count,
       (SELECT COALESCE(SUM(i.quantity * COALESCE(NULLIF(inv.average_cost, 0), p.cost_price, 0)), 0)
          FROM lb_production_recipe_inputs i
          JOIN lb_products p ON p.id = i.product_id
          LEFT JOIN lb_inventory inv ON inv.product_id = i.product_id
               AND inv.warehouse_id = (SELECT w.id FROM lb_warehouses w WHERE w.tenant_id = r.tenant_id AND w.is_default LIMIT 1)
         WHERE i.recipe_id = r.id) AS cost_per_batch,
       po.product_id AS primary_product_id, pp.name AS primary_product_name, po.quantity AS primary_quantity, po.unit AS primary_unit
FROM lb_production_recipes r
LEFT JOIN lb_production_recipe_outputs po ON po.recipe_id = r.id AND po.is_primary
LEFT JOIN lb_products pp ON pp.id = po.product_id;
GRANT SELECT ON lb_recipe_summary TO authenticated;

-- ============================================================
-- Internal helpers
-- ============================================================

-- Does a column accept this label? (plain text always does; an enum only if it has the value)
CREATE OR REPLACE FUNCTION _col_accepts(p_table text, p_column text, p_label text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((
    SELECT CASE WHEN c.data_type = 'USER-DEFINED'
                THEN EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = c.udt_name AND e.enumlabel = p_label)
                ELSE true END
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = p_table AND c.column_name = p_column), false)
$$;

-- Moves stock ONE way, the same way applyStockMovement() does in the app: updates lb_inventory
-- (quantity, weighted average cost on receipts, status) and writes the lb_stock_movements row.
-- p_qty is signed (out = negative). Dynamic SQL so enum columns accept the text labels.
CREATE OR REPLACE FUNCTION _production_move_stock(
  p_tenant uuid, p_business uuid, p_warehouse uuid, p_product uuid, p_qty numeric, p_unit_cost numeric,
  p_kind text, p_run uuid, p_note text, p_by uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_inv record; v_new numeric; v_avg numeric; v_reorder numeric; v_status text; v_mtype text; v_rtype text;
BEGIN
  SELECT COALESCE(reorder_level, 0) INTO v_reorder FROM lb_products WHERE id = p_product;
  SELECT * INTO v_inv FROM lb_inventory WHERE product_id = p_product AND warehouse_id = p_warehouse FOR UPDATE;
  IF FOUND THEN
    v_new := v_inv.quantity + p_qty;
    v_avg := CASE WHEN p_qty > 0 AND p_unit_cost > 0 THEN ((v_inv.quantity * v_inv.average_cost) + (p_qty * p_unit_cost)) / NULLIF(v_new, 0) ELSE v_inv.average_cost END;
    v_status := CASE WHEN v_new <= 0 THEN 'OUT_OF_STOCK' WHEN v_new <= v_reorder THEN 'LOW_STOCK' ELSE 'NORMAL' END;
    EXECUTE format('UPDATE lb_inventory SET quantity = %L, average_cost = %L, last_movement_at = now(), stock_status = %L WHERE id = %L',
                   v_new, COALESCE(v_avg, 0), v_status, v_inv.id);
  ELSE
    v_new := p_qty;
    v_status := CASE WHEN v_new <= 0 THEN 'OUT_OF_STOCK' WHEN v_new <= v_reorder THEN 'LOW_STOCK' ELSE 'NORMAL' END;
    EXECUTE format('INSERT INTO lb_inventory (tenant_id, business_id, warehouse_id, product_id, quantity, average_cost, last_movement_at, stock_status) VALUES (%L,%L,%L,%L,%L,%L,now(),%L)',
                   p_tenant, p_business, p_warehouse, p_product, v_new, CASE WHEN p_qty > 0 THEN p_unit_cost ELSE 0 END, v_status);
  END IF;

  v_mtype := CASE WHEN p_kind = 'OUT'
                  THEN CASE WHEN _col_accepts('lb_stock_movements','movement_type','PRODUCTION_CONSUMPTION') THEN 'PRODUCTION_CONSUMPTION' ELSE 'STOCK_ISSUE' END
                  ELSE CASE WHEN _col_accepts('lb_stock_movements','movement_type','PRODUCTION_OUTPUT') THEN 'PRODUCTION_OUTPUT' ELSE 'STOCK_ADJUSTMENT' END END;
  v_rtype := CASE WHEN _col_accepts('lb_stock_movements','reference_type','PRODUCTION_RUN') THEN 'PRODUCTION_RUN' ELSE NULL END;
  EXECUTE format('INSERT INTO lb_stock_movements (tenant_id, business_id, warehouse_id, product_id, movement_type, reference_type, reference_id, quantity, unit_cost, total_cost, notes, created_by) VALUES (%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',
                 p_tenant, p_business, p_warehouse, p_product, v_mtype, v_rtype, p_run, p_qty, p_unit_cost, abs(p_qty) * p_unit_cost, p_note, p_by);
END $$;

-- ============================================================
-- RPCs
-- ============================================================

-- Creates or replaces a recipe. p_inputs: [{"product_id","quantity","unit"}]
-- p_outputs: [{"product_id","quantity","unit","cost_share_pct","is_primary"}] (one output: share is 100).
-- Posted runs keep their own copy of the lines, so editing a recipe never rewrites history.
CREATE OR REPLACE FUNCTION save_production_recipe(
  p_recipe_id uuid, p_business_id uuid, p_name text, p_notes text, p_inputs jsonb, p_outputs jsonb, p_created_by uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tid uuid := get_current_tenant_id(); v_id uuid; v_row jsonb; v_n integer; v_sum numeric := 0; v_prim integer := 0; v_i integer := 0; v_share numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM lb_businesses WHERE id = p_business_id AND tenant_id = v_tid) THEN RAISE EXCEPTION 'Business not found'; END IF;
  IF coalesce(btrim(p_name), '') = '' THEN RAISE EXCEPTION 'Give the recipe a name'; END IF;
  IF jsonb_typeof(p_inputs) <> 'array' OR jsonb_array_length(p_inputs) = 0 THEN RAISE EXCEPTION 'Add at least one material'; END IF;
  IF jsonb_typeof(p_outputs) <> 'array' OR jsonb_array_length(p_outputs) = 0 THEN RAISE EXCEPTION 'Say what this makes'; END IF;
  v_n := jsonb_array_length(p_outputs);

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_inputs) LOOP
    IF coalesce((v_row->>'quantity')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'Every material needs an amount above zero'; END IF;
    IF NOT EXISTS (SELECT 1 FROM lb_products WHERE id = (v_row->>'product_id')::uuid AND tenant_id = v_tid) THEN RAISE EXCEPTION 'A material was not found'; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT v->>'product_id') FROM jsonb_array_elements(p_inputs) v) <> jsonb_array_length(p_inputs) THEN RAISE EXCEPTION 'A material is listed twice'; END IF;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_outputs) LOOP
    IF coalesce((v_row->>'quantity')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'Every output needs an amount above zero'; END IF;
    IF NOT EXISTS (SELECT 1 FROM lb_products WHERE id = (v_row->>'product_id')::uuid AND tenant_id = v_tid) THEN RAISE EXCEPTION 'An output item was not found'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_inputs) i WHERE i->>'product_id' = v_row->>'product_id') THEN RAISE EXCEPTION 'An item cannot be both a material and an output'; END IF;
    v_share := CASE WHEN v_n = 1 THEN 100 ELSE coalesce((v_row->>'cost_share_pct')::numeric, 0) END;
    v_sum := v_sum + v_share;
    IF coalesce((v_row->>'is_primary')::boolean, false) THEN v_prim := v_prim + 1; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT v->>'product_id') FROM jsonb_array_elements(p_outputs) v) <> v_n THEN RAISE EXCEPTION 'An output is listed twice'; END IF;
  IF abs(v_sum - 100) > 0.01 THEN RAISE EXCEPTION 'The cost shares of the outputs must add up to 100 (they add up to %)', v_sum; END IF;
  IF v_prim > 1 THEN RAISE EXCEPTION 'Only one output can be the main one'; END IF;

  IF p_recipe_id IS NULL THEN
    INSERT INTO lb_production_recipes (tenant_id, business_id, name, notes, created_by) VALUES (v_tid, p_business_id, btrim(p_name), p_notes, p_created_by) RETURNING id INTO v_id;
  ELSE
    SELECT id INTO v_id FROM lb_production_recipes WHERE id = p_recipe_id AND tenant_id = v_tid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Recipe not found'; END IF;
    UPDATE lb_production_recipes SET name = btrim(p_name), notes = p_notes, updated_at = now() WHERE id = v_id;
    DELETE FROM lb_production_recipe_inputs WHERE recipe_id = v_id;
    DELETE FROM lb_production_recipe_outputs WHERE recipe_id = v_id;
  END IF;

  INSERT INTO lb_production_recipe_inputs (tenant_id, recipe_id, product_id, quantity, unit)
  SELECT v_tid, v_id, (v->>'product_id')::uuid, (v->>'quantity')::numeric, nullif(btrim(coalesce(v->>'unit','')), '') FROM jsonb_array_elements(p_inputs) v;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_outputs) LOOP
    v_i := v_i + 1;
    INSERT INTO lb_production_recipe_outputs (tenant_id, recipe_id, product_id, quantity, unit, cost_share_pct, is_primary)
    VALUES (v_tid, v_id, (v_row->>'product_id')::uuid, (v_row->>'quantity')::numeric, nullif(btrim(coalesce(v_row->>'unit','')), ''),
            CASE WHEN v_n = 1 THEN 100 ELSE (v_row->>'cost_share_pct')::numeric END,
            CASE WHEN v_prim = 1 THEN coalesce((v_row->>'is_primary')::boolean, false) ELSE v_i = 1 END);
  END LOOP;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'You already have a recipe with that name';
END $$;

CREATE OR REPLACE FUNCTION set_production_recipe_active(p_recipe_id uuid, p_active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE lb_production_recipes SET is_active = p_active, updated_at = now() WHERE id = p_recipe_id AND tenant_id = get_current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Recipe not found'; END IF;
END $$;

-- Starts a run: p_planned_quantity is how many of the MAIN output you mean to make.
-- Copies the recipe's lines, scaled, into the run. Idempotent on p_client_reference.
CREATE OR REPLACE FUNCTION start_production_run(
  p_recipe_id uuid, p_planned_quantity numeric, p_run_date date DEFAULT NULL, p_notes text DEFAULT NULL,
  p_client_reference text DEFAULT NULL, p_created_by uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tid uuid := get_current_tenant_id(); v_r lb_production_recipes; v_prim numeric; v_scale numeric; v_id uuid; v_wh uuid;
BEGIN
  IF p_client_reference IS NOT NULL THEN
    SELECT id INTO v_id FROM lb_production_runs WHERE tenant_id = v_tid AND client_reference = p_client_reference;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  SELECT * INTO v_r FROM lb_production_recipes WHERE id = p_recipe_id AND tenant_id = v_tid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recipe not found'; END IF;
  IF NOT v_r.is_active THEN RAISE EXCEPTION 'This recipe is no longer in use'; END IF;
  IF coalesce(p_planned_quantity, 0) <= 0 THEN RAISE EXCEPTION 'Say how many you plan to make'; END IF;
  SELECT quantity INTO v_prim FROM lb_production_recipe_outputs WHERE recipe_id = v_r.id AND is_primary;
  IF v_prim IS NULL THEN RAISE EXCEPTION 'This recipe has no main output'; END IF;
  v_scale := p_planned_quantity / v_prim;
  SELECT id INTO v_wh FROM lb_warehouses WHERE tenant_id = v_tid AND is_default LIMIT 1;
  IF v_wh IS NULL THEN RAISE EXCEPTION 'No default warehouse found for this business'; END IF;

  INSERT INTO lb_production_runs (tenant_id, business_id, run_number, recipe_id, warehouse_id, run_date, planned_quantity, scale, notes, client_reference, created_by)
  VALUES (v_tid, v_r.business_id, next_doc_number(v_r.business_id, 'PRD'), v_r.id, v_wh, COALESCE(p_run_date, CURRENT_DATE), p_planned_quantity, v_scale, p_notes, p_client_reference, p_created_by)
  RETURNING id INTO v_id;
  INSERT INTO lb_production_run_inputs (tenant_id, run_id, product_id, unit, planned_quantity)
  SELECT v_tid, v_id, product_id, unit, round(quantity * v_scale, 4) FROM lb_production_recipe_inputs WHERE recipe_id = v_r.id;
  INSERT INTO lb_production_run_outputs (tenant_id, run_id, product_id, unit, is_primary, cost_share_pct, expected_quantity)
  SELECT v_tid, v_id, product_id, unit, is_primary, cost_share_pct, round(quantity * v_scale, 4) FROM lb_production_recipe_outputs WHERE recipe_id = v_r.id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION cancel_production_run(p_run_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v lb_production_runs;
BEGIN
  SELECT * INTO v FROM lb_production_runs WHERE id = p_run_id AND tenant_id = get_current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production run not found'; END IF;
  IF v.status <> 'DRAFT' THEN RAISE EXCEPTION 'Only a run that has not been posted can be cancelled. Use a stock adjustment to correct a posted one'; END IF;
  UPDATE lb_production_runs SET status = 'CANCELLED' WHERE id = v.id;
END $$;

-- Posts a run: p_outputs = [{"product_id","actual_quantity"}] (every output, no guessing);
-- p_inputs = optional [{"product_id","actual_quantity"}] where more or less than planned was really used.
-- Returns the result. Posting twice returns the first result and moves nothing.
CREATE OR REPLACE FUNCTION post_production_run(
  p_run_id uuid, p_outputs jsonb, p_inputs jsonb DEFAULT NULL, p_wastage_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL, p_posted_by uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_run lb_production_runs; v_rec text; r record; v_o jsonb; v_act numeric; v_avail numeric; v_prod lb_products;
  v_unit_cost numeric; v_in_cost numeric := 0; v_missing integer := 0; v_out_cost numeric := 0;
  v_p_exp numeric; v_p_act numeric; v_w_qty numeric := 0; v_w_cost numeric := 0; v_share_cost numeric; v_exp_uc numeric; v_act_uc numeric;
  v_p_exp_uc numeric; v_p_act_uc numeric; v_note text;
BEGIN
  SELECT * INTO v_run FROM lb_production_runs WHERE id = p_run_id AND tenant_id = get_current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production run not found'; END IF;
  IF v_run.status = 'POSTED' THEN
    RETURN jsonb_build_object('run_id', v_run.id, 'already_posted', true, 'run_number', v_run.run_number, 'expected_output', v_run.expected_output, 'actual_output', v_run.actual_output,
      'yield_pct', v_run.yield_pct, 'wastage_qty', v_run.wastage_qty, 'wastage_cost', v_run.wastage_cost, 'input_cost', v_run.input_cost,
      'cost_per_expected_unit', v_run.cost_per_expected_unit, 'cost_per_actual_unit', v_run.cost_per_actual_unit);
  END IF;
  IF v_run.status <> 'DRAFT' THEN RAISE EXCEPTION 'This run is %', lower(v_run.status); END IF;
  IF p_wastage_reason IS NOT NULL AND p_wastage_reason NOT IN ('Spillage','Burnt','Damaged','Expired','Overproduction','Preparation Loss','Other') THEN
    RAISE EXCEPTION 'Unknown wastage reason';
  END IF;
  IF jsonb_typeof(p_outputs) <> 'array' THEN RAISE EXCEPTION 'Enter what was actually made'; END IF;
  v_rec := (SELECT name FROM lb_production_recipes WHERE id = v_run.recipe_id);
  v_note := 'Production ' || v_run.run_number || ' · ' || coalesce(v_rec, '');

  -- actual outputs: every one must be stated
  FOR r IN SELECT * FROM lb_production_run_outputs WHERE run_id = v_run.id LOOP
    SELECT e INTO v_o FROM jsonb_array_elements(p_outputs) e WHERE e->>'product_id' = r.product_id::text LIMIT 1;
    IF v_o IS NULL OR (v_o->>'actual_quantity') IS NULL THEN
      RAISE EXCEPTION 'Enter how much % was actually made', (SELECT name FROM lb_products WHERE id = r.product_id);
    END IF;
    v_act := (v_o->>'actual_quantity')::numeric;
    IF v_act < 0 THEN RAISE EXCEPTION 'An amount cannot be negative'; END IF;
    UPDATE lb_production_run_outputs SET actual_quantity = v_act WHERE id = r.id;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_outputs) e WHERE NOT EXISTS (SELECT 1 FROM lb_production_run_outputs o WHERE o.run_id = v_run.id AND o.product_id::text = e->>'product_id')) THEN
    RAISE EXCEPTION 'An item in the result is not part of this run';
  END IF;

  -- actual inputs: planned unless overridden
  IF p_inputs IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_inputs) e WHERE NOT EXISTS (SELECT 1 FROM lb_production_run_inputs i WHERE i.run_id = v_run.id AND i.product_id::text = e->>'product_id')) THEN
      RAISE EXCEPTION 'A material in the result is not part of this run';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_inputs) e WHERE coalesce((e->>'actual_quantity')::numeric, -1) < 0) THEN RAISE EXCEPTION 'An amount cannot be negative'; END IF;
  END IF;
  UPDATE lb_production_run_inputs i SET actual_quantity = COALESCE(
    (SELECT (e->>'actual_quantity')::numeric FROM jsonb_array_elements(coalesce(p_inputs, '[]'::jsonb)) e WHERE e->>'product_id' = i.product_id::text LIMIT 1), i.planned_quantity)
  WHERE i.run_id = v_run.id;

  -- stock check BEFORE anything moves (same rule as a sale)
  FOR r IN SELECT i.*, p.name FROM lb_production_run_inputs i JOIN lb_products p ON p.id = i.product_id WHERE i.run_id = v_run.id LOOP
    SELECT * INTO v_prod FROM lb_products WHERE id = r.product_id;
    IF v_prod.track_inventory AND NOT COALESCE(v_prod.allow_negative_stock, false) AND r.actual_quantity > 0 THEN
      SELECT COALESCE(quantity, 0) INTO v_avail FROM lb_inventory WHERE product_id = r.product_id AND warehouse_id = v_run.warehouse_id;
      IF r.actual_quantity > COALESCE(v_avail, 0) THEN
        RAISE EXCEPTION 'Not enough % in stock: you have %, the run needs %', r.name, COALESCE(v_avail, 0), r.actual_quantity;
      END IF;
    END IF;
  END LOOP;

  -- consume materials at current average cost
  FOR r IN SELECT * FROM lb_production_run_inputs WHERE run_id = v_run.id LOOP
    SELECT * INTO v_prod FROM lb_products WHERE id = r.product_id;
    SELECT COALESCE(NULLIF(average_cost, 0), v_prod.cost_price, 0) INTO v_unit_cost FROM lb_inventory WHERE product_id = r.product_id AND warehouse_id = v_run.warehouse_id;
    v_unit_cost := COALESCE(v_unit_cost, v_prod.cost_price, 0);
    IF v_unit_cost = 0 AND r.actual_quantity > 0 THEN v_missing := v_missing + 1; END IF;
    UPDATE lb_production_run_inputs SET unit_cost = v_unit_cost, total_cost = round(r.actual_quantity * v_unit_cost, 4) WHERE id = r.id;
    v_in_cost := v_in_cost + round(r.actual_quantity * v_unit_cost, 4);
    IF v_prod.track_inventory AND r.actual_quantity > 0 THEN
      PERFORM _production_move_stock(v_run.tenant_id, v_run.business_id, v_run.warehouse_id, r.product_id, -r.actual_quantity, v_unit_cost, 'OUT', v_run.id, v_note, p_posted_by);
    END IF;
  END LOOP;

  -- finished goods: the whole input cost is carried into what was really made
  FOR r IN SELECT * FROM lb_production_run_outputs WHERE run_id = v_run.id LOOP
    SELECT * INTO v_prod FROM lb_products WHERE id = r.product_id;
    v_share_cost := round(v_in_cost * r.cost_share_pct / 100, 4);
    v_exp_uc := CASE WHEN r.expected_quantity > 0 THEN v_share_cost / r.expected_quantity END;
    v_act_uc := CASE WHEN r.actual_quantity > 0 THEN v_share_cost / r.actual_quantity END;
    UPDATE lb_production_run_outputs SET
      wastage_qty = GREATEST(expected_quantity - actual_quantity, 0),
      wastage_cost = round(GREATEST(expected_quantity - actual_quantity, 0) * COALESCE(v_exp_uc, 0), 4),
      unit_cost = round(v_act_uc, 4), total_cost = v_share_cost
    WHERE id = r.id;
    v_out_cost := v_out_cost + v_share_cost;
    IF r.is_primary THEN v_p_exp := r.expected_quantity; v_p_act := r.actual_quantity; v_p_exp_uc := v_exp_uc; v_p_act_uc := v_act_uc; END IF;
    IF v_prod.track_inventory AND r.actual_quantity > 0 THEN
      PERFORM _production_move_stock(v_run.tenant_id, v_run.business_id, v_run.warehouse_id, r.product_id, r.actual_quantity, COALESCE(v_act_uc, 0), 'IN', v_run.id, v_note, p_posted_by);
    END IF;
  END LOOP;

  SELECT COALESCE(SUM(wastage_qty), 0), COALESCE(SUM(wastage_cost), 0) INTO v_w_qty, v_w_cost FROM lb_production_run_outputs WHERE run_id = v_run.id AND is_primary;
  SELECT COALESCE(SUM(wastage_cost), 0) INTO v_w_cost FROM lb_production_run_outputs WHERE run_id = v_run.id;

  UPDATE lb_production_runs SET status = 'POSTED', posted_at = now(), posted_by = p_posted_by,
    expected_output = v_p_exp, actual_output = v_p_act, difference = v_p_act - v_p_exp,
    yield_pct = CASE WHEN v_p_exp > 0 THEN round(v_p_act / v_p_exp * 100, 2) END,
    wastage_qty = v_w_qty, wastage_cost = v_w_cost, wastage_reason = CASE WHEN v_w_qty > 0 THEN p_wastage_reason END,
    input_cost = v_in_cost, output_cost = v_out_cost,
    cost_per_expected_unit = round(v_p_exp_uc, 4), cost_per_actual_unit = round(v_p_act_uc, 4),
    inputs_missing_cost = v_missing, notes = COALESCE(p_notes, notes)
  WHERE id = v_run.id;

  RETURN jsonb_build_object('run_id', v_run.id, 'already_posted', false, 'run_number', v_run.run_number, 'expected_output', v_p_exp, 'actual_output', v_p_act,
    'yield_pct', CASE WHEN v_p_exp > 0 THEN round(v_p_act / v_p_exp * 100, 2) END, 'wastage_qty', v_w_qty, 'wastage_cost', v_w_cost, 'input_cost', v_in_cost,
    'cost_per_expected_unit', round(v_p_exp_uc, 4), 'cost_per_actual_unit', round(v_p_act_uc, 4), 'inputs_missing_cost', v_missing);
END $$;

REVOKE ALL ON FUNCTION _col_accepts, _production_move_stock FROM PUBLIC;
REVOKE ALL ON FUNCTION save_production_recipe, set_production_recipe_active, start_production_run, cancel_production_run, post_production_run FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_production_recipe, set_production_recipe_active, start_production_run, cancel_production_run, post_production_run TO authenticated;
