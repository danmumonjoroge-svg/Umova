-- Phase 22 scenarios (Production). SCRATCH DATABASE ONLY.
-- Run from schema/ (three variants of the live movement columns):
--   psql -v ON_ERROR_STOP=1 -f tests/phase22_scenarios.sql                       (enum without production labels: fallback)
--   psql -v ON_ERROR_STOP=1 -v withenums=1 -f tests/phase22_scenarios.sql         (enum + phase22a: dedicated labels)
--   psql -v ON_ERROR_STOP=1 -v texttypes=1 -f tests/phase22_scenarios.sql         (plain text columns)
\i tests/phase19_stubs.sql
\i tests/phase22_stubs.sql
-- next_doc_number comes from the phase19 stubs (live: phase17)
\if :{?withenums}
\i phase22a_production_enums.sql
\endif
\i phase22_production.sql
\i phase22_production.sql

CREATE TABLE t_results (name text, pass boolean, info text);
GRANT ALL ON t_results TO PUBLIC;
CREATE FUNCTION t_ok(p_name text, p_cond boolean, p_info text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO t_results VALUES (p_name, coalesce(p_cond,false), p_info); RAISE NOTICE '% %', CASE WHEN coalesce(p_cond,false) THEN 'PASS' ELSE 'FAIL' END, p_name || CASE WHEN coalesce(p_cond,false) THEN '' ELSE '  -> ' || p_info END; END $$;
CREATE FUNCTION t_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
CREATE FUNCTION t_ctx(p_tenant text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.tenant', p_tenant, false) $$;
CREATE FUNCTION t_prod(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lb_products WHERE name = p $$;
CREATE FUNCTION t_qty(p text) RETURNS numeric LANGUAGE sql AS $$ SELECT quantity FROM lb_inventory WHERE product_id = t_prod(p) $$;
GRANT EXECUTE ON FUNCTION t_ok, t_err, t_ctx, t_prod, t_qty TO PUBLIC;

-- ---------- fixtures ----------
SELECT t_ctx('00000000-0000-0000-0000-0000000000aa');
DO $$
DECLARE T1 uuid := '00000000-0000-0000-0000-0000000000aa'; T2 uuid := '00000000-0000-0000-0000-0000000000bb';
        B1 uuid := 'b1000000-0000-0000-0000-000000000001'; B2 uuid := 'b2000000-0000-0000-0000-000000000002'; w uuid; p record;
BEGIN
  INSERT INTO lb_businesses VALUES (B1, T1, 'Umova Bakery'), (B2, T2, 'Other Co');
  INSERT INTO lb_warehouses(tenant_id, business_id, name, is_default) VALUES (T1, B1, 'Main', true) RETURNING id INTO w;
  INSERT INTO lb_warehouses(tenant_id, business_id, name, is_default) VALUES (T2, B2, 'Other', true);
  -- name, tracked, stock qty, avg cost
  FOR p IN SELECT * FROM (VALUES ('Flour',true,100,120),('Sugar',true,50,150),('Eggs',true,1000,10),('Milk',true,50,100),('Butter',true,20,300),
                                 ('Chocolate Cake',true,NULL,NULL),('Carcass',true,300,400),('Beef Cuts',true,NULL,NULL),('Bones',true,NULL,NULL),('Offcuts',true,NULL,NULL),
                                 ('Chicken',true,50,500),('Oil',true,20,200),('Chicken Meal',false,NULL,NULL),('Mystery Spice',true,10,NULL)) v(n,tr,q,c) LOOP
    INSERT INTO lb_products(tenant_id, name, track_inventory) VALUES (T1, p.n, p.tr);
    IF p.q IS NOT NULL THEN INSERT INTO lb_inventory(tenant_id, business_id, warehouse_id, product_id, quantity, average_cost) VALUES (T1, B1, w, t_prod(p.n), p.q, COALESCE(p.c, 0)); END IF;
  END LOOP;
  INSERT INTO lb_products(tenant_id, name, track_inventory) VALUES (T2, 'Flour', true);
  INSERT INTO lb_customers(tenant_id, business_id, name) VALUES (T1, B1, 'x');
END $$;

-- ---------- BAKERY: the acceptance test ----------
DO $$
DECLARE B1 uuid := 'b1000000-0000-0000-0000-000000000001'; rec uuid; run uuid; r jsonb; mv record; n int;
BEGIN
  rec := save_production_recipe(NULL, B1, 'Chocolate Cake',  'one cake',
    jsonb_build_array(jsonb_build_object('product_id', t_prod('Flour'),  'quantity', 0.5, 'unit', 'kg'),
                      jsonb_build_object('product_id', t_prod('Sugar'),  'quantity', 0.2, 'unit', 'kg'),
                      jsonb_build_object('product_id', t_prod('Eggs'),   'quantity', 4,   'unit', 'pcs'),
                      jsonb_build_object('product_id', t_prod('Milk'),   'quantity', 0.2, 'unit', 'L'),
                      jsonb_build_object('product_id', t_prod('Butter'), 'quantity', 0.1, 'unit', 'kg')),
    jsonb_build_array(jsonb_build_object('product_id', t_prod('Chocolate Cake'), 'quantity', 1, 'unit', 'cake')));
  PERFORM t_ok('recipe saved: 5 materials, 1 output (primary, 100%)', (SELECT count(*) FROM lb_production_recipe_inputs WHERE recipe_id = rec) = 5
     AND (SELECT is_primary AND cost_share_pct = 100 FROM lb_production_recipe_outputs WHERE recipe_id = rec));
  PERFORM t_ok('recipe list shows the expected cost of one cake = 180', (SELECT cost_per_batch FROM lb_recipe_summary WHERE id = rec) = 180, (SELECT cost_per_batch::text FROM lb_recipe_summary WHERE id = rec));
  PERFORM t_ok('a recipe name must be unique', t_err(format('SELECT save_production_recipe(NULL, %L, ''chocolate cake'', NULL, %L::jsonb, %L::jsonb)', B1,
     jsonb_build_array(jsonb_build_object('product_id', t_prod('Flour'), 'quantity', 1)), jsonb_build_array(jsonb_build_object('product_id', t_prod('Chocolate Cake'), 'quantity', 1)))) LIKE '%already have a recipe%');

  run := start_production_run(rec, 100, '2026-10-06', NULL, 'dev-1');
  PERFORM t_ok('same client reference returns the same run (offline retry safe)', start_production_run(rec, 100, '2026-10-06', NULL, 'dev-1') = run);
  PERFORM t_ok('draft scaled to 100 cakes: flour 50, eggs 400', (SELECT planned_quantity FROM lb_production_run_inputs WHERE run_id = run AND product_id = t_prod('Flour')) = 50
     AND (SELECT planned_quantity FROM lb_production_run_inputs WHERE run_id = run AND product_id = t_prod('Eggs')) = 400);
  PERFORM t_ok('a draft moves no stock', t_qty('Flour') = 100 AND (SELECT count(*) FROM lb_inventory WHERE product_id = t_prod('Chocolate Cake')) = 0);
  PERFORM t_ok('run number allocated (PRD-)', (SELECT run_number FROM lb_production_runs WHERE id = run) LIKE 'PRD-%');
  PERFORM t_ok('every output must be stated, no guessing', t_err(format('SELECT post_production_run(%L, ''[]''::jsonb)', run)) LIKE '%actually made%');
  PERFORM t_ok('an unknown wastage reason is refused', t_err(format('SELECT post_production_run(%L, %L::jsonb, NULL, ''Whim'')', run, jsonb_build_array(jsonb_build_object('product_id', t_prod('Chocolate Cake'), 'actual_quantity', 94)))) LIKE '%wastage reason%');

  r := post_production_run(run, jsonb_build_array(jsonb_build_object('product_id', t_prod('Chocolate Cake'), 'actual_quantity', 94)), NULL, 'Burnt', 'oven too hot');
  PERFORM t_ok('expected 100, actual 94, yield 94%, wastage 6', (r->>'expected_output')::numeric = 100 AND (r->>'actual_output')::numeric = 94 AND (r->>'yield_pct')::numeric = 94 AND (r->>'wastage_qty')::numeric = 6, r::text);
  PERFORM t_ok('input cost 18,000', (r->>'input_cost')::numeric = 18000, r::text);
  PERFORM t_ok('cost per expected unit 180, per actual unit 191.4894', (r->>'cost_per_expected_unit')::numeric = 180 AND (r->>'cost_per_actual_unit')::numeric = 191.4894, r::text);
  PERFORM t_ok('wastage cost 1,080 (6 cakes x 180)', (r->>'wastage_cost')::numeric = 1080, r::text);
  PERFORM t_ok('raw materials decreased', t_qty('Flour') = 50 AND t_qty('Sugar') = 30 AND t_qty('Eggs') = 600 AND t_qty('Milk') = 30 AND t_qty('Butter') = 10);
  PERFORM t_ok('finished cakes increased by 94', t_qty('Chocolate Cake') = 94);
  PERFORM t_ok('cakes carry the real unit cost (191.4894)', abs((SELECT average_cost FROM lb_inventory WHERE product_id = t_prod('Chocolate Cake')) - 191.4894) < 0.001);
  PERFORM t_ok('inventory value moved, not lost: out 18,000, in 94 x 191.4894', abs((SELECT sum(-quantity * unit_cost) FILTER (WHERE quantity < 0) FROM lb_stock_movements) - 18000) < 0.01
     AND abs((SELECT sum(total_cost) FILTER (WHERE quantity > 0) FROM lb_stock_movements WHERE product_id = t_prod('Chocolate Cake')) - 18000) < 0.01);
  SELECT count(*) INTO n FROM lb_stock_movements WHERE reference_id = run;
  PERFORM t_ok('audit trail: 6 movements, each tied to the run', n = 6, n::text);
  PERFORM t_ok('materials out are negative, cakes in are positive', (SELECT count(*) FROM lb_stock_movements WHERE reference_id = run AND quantity < 0) = 5 AND (SELECT count(*) FROM lb_stock_movements WHERE reference_id = run AND quantity > 0) = 1);
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'lb_stock_movements' AND column_name = 'movement_type') <> 'USER-DEFINED' THEN
    PERFORM t_ok('text columns: dedicated labels used', (SELECT count(*) FROM lb_stock_movements WHERE movement_type = 'PRODUCTION_CONSUMPTION') = 5 AND (SELECT count(*) FROM lb_stock_movements WHERE movement_type = 'PRODUCTION_OUTPUT') = 1 AND (SELECT count(*) FROM lb_stock_movements WHERE reference_type = 'PRODUCTION_RUN') = 6);
  ELSIF _col_accepts('lb_stock_movements', 'movement_type', 'PRODUCTION_OUTPUT') THEN
    PERFORM t_ok('enum + phase22a: dedicated labels used', (SELECT count(*) FROM lb_stock_movements WHERE movement_type::text = 'PRODUCTION_CONSUMPTION') = 5 AND (SELECT count(*) FROM lb_stock_movements WHERE movement_type::text = 'PRODUCTION_OUTPUT') = 1 AND (SELECT count(*) FROM lb_stock_movements WHERE reference_type::text = 'PRODUCTION_RUN') = 6);
  ELSE
    PERFORM t_ok('plain enum: falls back to STOCK_ISSUE / STOCK_ADJUSTMENT', (SELECT count(*) FROM lb_stock_movements WHERE movement_type::text = 'STOCK_ISSUE') = 5 AND (SELECT count(*) FROM lb_stock_movements WHERE movement_type::text = 'STOCK_ADJUSTMENT') = 1 AND (SELECT count(*) FROM lb_stock_movements WHERE reference_id = run AND reference_type IS NULL) = 6);
  END IF;
  PERFORM t_ok('the run keeps its summary', (SELECT status = 'POSTED' AND yield_pct = 94 AND wastage_reason = 'Burnt' AND difference = -6 FROM lb_production_runs WHERE id = run));

  r := post_production_run(run, jsonb_build_array(jsonb_build_object('product_id', t_prod('Chocolate Cake'), 'actual_quantity', 10)));
  PERFORM t_ok('posting twice returns the first result and moves nothing', (r->>'already_posted')::boolean AND (r->>'actual_output')::numeric = 94 AND t_qty('Flour') = 50 AND t_qty('Chocolate Cake') = 94);
  PERFORM t_ok('a posted run cannot be cancelled', t_err(format('SELECT cancel_production_run(%L)', run)) LIKE '%stock adjustment%');
END $$;

-- ---------- second run: weighted cost, real usage differs from plan ----------
DO $$
DECLARE rec uuid := (SELECT id FROM lb_production_recipes WHERE name = 'Chocolate Cake'); run uuid; r jsonb;
BEGIN
  run := start_production_run(rec, 10);
  r := post_production_run(run, jsonb_build_array(jsonb_build_object('product_id', t_prod('Chocolate Cake'), 'actual_quantity', 10)),
       jsonb_build_array(jsonb_build_object('product_id', t_prod('Flour'), 'actual_quantity', 6)));
  PERFORM t_ok('what was really used is what is charged: flour 6 not 5', t_qty('Flour') = 44 AND (SELECT actual_quantity FROM lb_production_run_inputs WHERE run_id = run AND product_id = t_prod('Flour')) = 6);
  PERFORM t_ok('perfect yield: 100%, no wastage', (r->>'yield_pct')::numeric = 100 AND (r->>'wastage_qty')::numeric = 0 AND (r->>'wastage_cost')::numeric = 0, r::text);
  PERFORM t_ok('extra flour raised the cake cost (10 cakes: 1,800 planned + 1 kg flour 120 = 1,920, unit 192)', (r->>'input_cost')::numeric = 1920 AND (r->>'cost_per_actual_unit')::numeric = 192, r::text);
  PERFORM t_ok('stock cost is a weighted average of both runs', abs((SELECT average_cost FROM lb_inventory WHERE product_id = t_prod('Chocolate Cake')) - ((18000 + 1920) / 104.0)) < 0.001, (SELECT average_cost::text FROM lb_inventory WHERE product_id = t_prod('Chocolate Cake')));
  PERFORM t_ok('an item that is not part of the run is refused', t_err(format('SELECT post_production_run(%L, %L::jsonb)', start_production_run(rec, 1), jsonb_build_array(jsonb_build_object('product_id', t_prod('Milk'), 'actual_quantity', 1)))) LIKE '%actually made%');
END $$;

-- ---------- not enough stock: nothing moves ----------
DO $$
DECLARE rec uuid := (SELECT id FROM lb_production_recipes WHERE name = 'Chocolate Cake'); run uuid; e text; before_flour numeric := t_qty('Flour'); before_cakes numeric := t_qty('Chocolate Cake');
BEGIN
  run := start_production_run(rec, 1000);
  e := t_err(format('SELECT post_production_run(%L, %L::jsonb)', run, jsonb_build_array(jsonb_build_object('product_id', t_prod('Chocolate Cake'), 'actual_quantity', 1000))));
  PERFORM t_ok('not enough flour is refused with a clear message', e LIKE 'Not enough%in stock%', coalesce(e, 'no error'));
  PERFORM t_ok('...and NOTHING moved, the run is still a draft', t_qty('Flour') = before_flour AND t_qty('Chocolate Cake') = before_cakes AND (SELECT status FROM lb_production_runs WHERE id = run) = 'DRAFT');
  PERFORM cancel_production_run(run);
  PERFORM t_ok('a draft can be cancelled', (SELECT status FROM lb_production_runs WHERE id = run) = 'CANCELLED');
  PERFORM t_ok('a cancelled run cannot be posted', t_err(format('SELECT post_production_run(%L, ''[]''::jsonb)', run)) LIKE '%cancelled%');
END $$;

-- ---------- BUTCHERY: one carcass, several outputs ----------
DO $$
DECLARE B1 uuid := 'b1000000-0000-0000-0000-000000000001'; rec uuid; run uuid; r jsonb; e text; ins jsonb; outs jsonb;
BEGIN
  ins := jsonb_build_array(jsonb_build_object('product_id', t_prod('Carcass'), 'quantity', 100, 'unit', 'kg'));
  e := t_err(format('SELECT save_production_recipe(NULL, %L, ''Beef bad shares'', NULL, %L::jsonb, %L::jsonb)', B1, ins, jsonb_build_array(
     jsonb_build_object('product_id', t_prod('Beef Cuts'), 'quantity', 60, 'cost_share_pct', 50, 'is_primary', true), jsonb_build_object('product_id', t_prod('Bones'), 'quantity', 15, 'cost_share_pct', 30))));
  PERFORM t_ok('output cost shares must add up to 100', e LIKE '%add up to 100%', coalesce(e, 'no error'));
  PERFORM t_ok('an item cannot be both input and output', t_err(format('SELECT save_production_recipe(NULL, %L, ''Loop'', NULL, %L::jsonb, %L::jsonb)', B1, ins, jsonb_build_array(jsonb_build_object('product_id', t_prod('Carcass'), 'quantity', 1)))) LIKE '%both a material and an output%');
  outs := jsonb_build_array(jsonb_build_object('product_id', t_prod('Beef Cuts'), 'quantity', 60, 'unit', 'kg', 'cost_share_pct', 70, 'is_primary', true),
                            jsonb_build_object('product_id', t_prod('Bones'), 'quantity', 15, 'unit', 'kg', 'cost_share_pct', 5),
                            jsonb_build_object('product_id', t_prod('Offcuts'), 'quantity', 10, 'unit', 'kg', 'cost_share_pct', 25));
  rec := save_production_recipe(NULL, B1, 'Beef carcass', NULL, ins, outs);
  run := start_production_run(rec, 60);
  PERFORM t_ok('planned 60 kg of cuts = exactly one carcass', (SELECT scale FROM lb_production_runs WHERE id = run) = 1);
  r := post_production_run(run, jsonb_build_array(jsonb_build_object('product_id', t_prod('Beef Cuts'), 'actual_quantity', 55), jsonb_build_object('product_id', t_prod('Bones'), 'actual_quantity', 15), jsonb_build_object('product_id', t_prod('Offcuts'), 'actual_quantity', 11)), NULL, 'Preparation Loss');
  PERFORM t_ok('carcass out: 100 kg at 400 = 40,000', t_qty('Carcass') = 200 AND (r->>'input_cost')::numeric = 40000, r::text);
  PERFORM t_ok('cuts yield 91.67%, wastage 5 kg', (r->>'yield_pct')::numeric = 91.67 AND (r->>'wastage_qty')::numeric = 5, r::text);
  PERFORM t_ok('cost split 70 / 5 / 25 into the three outputs', (SELECT total_cost FROM lb_production_run_outputs WHERE run_id = run AND product_id = t_prod('Beef Cuts')) = 28000
     AND (SELECT total_cost FROM lb_production_run_outputs WHERE run_id = run AND product_id = t_prod('Bones')) = 2000
     AND (SELECT total_cost FROM lb_production_run_outputs WHERE run_id = run AND product_id = t_prod('Offcuts')) = 10000);
  PERFORM t_ok('cuts: expected 466.6667/kg, actual 509.0909/kg', (r->>'cost_per_expected_unit')::numeric = 466.6667 AND (r->>'cost_per_actual_unit')::numeric = 509.0909, r::text);
  PERFORM t_ok('wastage cost = 5 kg x 466.6667 (extra offcuts are not waste)', (r->>'wastage_cost')::numeric = 2333.3333, r::text);
  PERFORM t_ok('all three cuts are in stock', t_qty('Beef Cuts') = 55 AND t_qty('Bones') = 15 AND t_qty('Offcuts') = 11);
  PERFORM t_ok('output value equals input value (nothing created or lost)', (SELECT sum(total_cost) FROM lb_production_run_outputs WHERE run_id = run) = 40000);
END $$;

-- ---------- RESTAURANT: made-to-order meal (output not stock-tracked) ----------
DO $$
DECLARE B1 uuid := 'b1000000-0000-0000-0000-000000000001'; rec uuid; run uuid; r jsonb; mv int;
BEGIN
  rec := save_production_recipe(NULL, B1, 'Chicken meal', NULL,
    jsonb_build_array(jsonb_build_object('product_id', t_prod('Chicken'), 'quantity', 0.3), jsonb_build_object('product_id', t_prod('Oil'), 'quantity', 0.05), jsonb_build_object('product_id', t_prod('Mystery Spice'), 'quantity', 0.01)),
    jsonb_build_array(jsonb_build_object('product_id', t_prod('Chicken Meal'), 'quantity', 1)));
  run := start_production_run(rec, 20);
  r := post_production_run(run, jsonb_build_array(jsonb_build_object('product_id', t_prod('Chicken Meal'), 'actual_quantity', 20)));
  PERFORM t_ok('ingredients consumed: chicken 6 kg, oil 1 L', t_qty('Chicken') = 44 AND t_qty('Oil') = 19);
  PERFORM t_ok('the untracked meal gets no stock row and no movement', (SELECT count(*) FROM lb_inventory WHERE product_id = t_prod('Chicken Meal')) = 0 AND (SELECT count(*) FROM lb_stock_movements WHERE product_id = t_prod('Chicken Meal')) = 0);
  PERFORM t_ok('meal cost still worked out: 20 meals cost 3,200 = 160 each', (r->>'input_cost')::numeric = 3200 AND (r->>'cost_per_actual_unit')::numeric = 160, r::text);
  PERFORM t_ok('an ingredient with no known cost is flagged, not hidden', (r->>'inputs_missing_cost')::int = 1, r::text);
END $$;

-- ---------- tenancy and permissions ----------
SELECT t_ctx('00000000-0000-0000-0000-0000000000bb');
DO $$
DECLARE B1 uuid := 'b1000000-0000-0000-0000-000000000001'; B2 uuid := 'b2000000-0000-0000-0000-000000000002'; rec uuid; run uuid;
BEGIN
  SELECT id INTO rec FROM lb_production_recipes WHERE name = 'Chocolate Cake';
  SELECT id INTO run FROM lb_production_runs LIMIT 1;
  PERFORM t_ok('other tenant cannot start a run from our recipe', t_err(format('SELECT start_production_run(%L, 5)', rec)) LIKE '%Recipe not found%');
  PERFORM t_ok('...nor post, cancel or switch off ours', t_err(format('SELECT post_production_run(%L, ''[]''::jsonb)', run)) LIKE '%not found%' AND t_err(format('SELECT cancel_production_run(%L)', run)) LIKE '%not found%' AND t_err(format('SELECT set_production_recipe_active(%L, false)', rec)) LIKE '%not found%');
  PERFORM t_ok('...nor build a recipe from our business or our products', t_err(format('SELECT save_production_recipe(NULL, %L, ''Steal'', NULL, %L::jsonb, %L::jsonb)', B1, '[]', '[]')) LIKE '%Business not found%'
     AND t_err(format('SELECT save_production_recipe(NULL, %L, ''Steal'', NULL, %L::jsonb, %L::jsonb)', B2, jsonb_build_array(jsonb_build_object('product_id', (SELECT id FROM lb_products WHERE tenant_id = '00000000-0000-0000-0000-0000000000aa' LIMIT 1), 'quantity', 1)), jsonb_build_array(jsonb_build_object('product_id', (SELECT id FROM lb_products WHERE tenant_id = '00000000-0000-0000-0000-0000000000bb' LIMIT 1), 'quantity', 1)))) LIKE '%not found%');
END $$;
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM t_ok('other tenant sees none of our recipes, runs, lines or the recipe list', (SELECT count(*) FROM lb_production_recipes) = 0 AND (SELECT count(*) FROM lb_production_runs) = 0
     AND (SELECT count(*) FROM lb_production_run_inputs) = 0 AND (SELECT count(*) FROM lb_production_run_outputs) = 0 AND (SELECT count(*) FROM lb_recipe_summary) = 0);
  RESET ROLE;
END $$;
SELECT t_ctx('00000000-0000-0000-0000-0000000000aa');
DO $$
DECLARE e text;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM t_ok('owner can read recipes and runs', (SELECT count(*) FROM lb_production_recipes) = 3 AND (SELECT count(*) FROM lb_production_runs) >= 4);
  e := t_err('UPDATE lb_production_runs SET actual_output = 9999'); PERFORM t_ok('client cannot edit a run directly', e LIKE '%permission denied%', coalesce(e, 'no error'));
  e := t_err('DELETE FROM lb_production_run_outputs'); PERFORM t_ok('client cannot delete run lines', e LIKE '%permission denied%', coalesce(e, 'no error'));
  e := t_err('INSERT INTO lb_production_recipes(tenant_id, business_id, name) VALUES (''00000000-0000-0000-0000-0000000000aa'', ''b1000000-0000-0000-0000-000000000001'', ''sneaky'')'); PERFORM t_ok('client cannot write recipes directly', e LIKE '%permission denied%', coalesce(e, 'no error'));
  RESET ROLE;
  PERFORM set_production_recipe_active((SELECT id FROM lb_production_recipes WHERE name = 'Chicken meal'), false);
  PERFORM t_ok('a switched-off recipe cannot start a run', t_err(format('SELECT start_production_run(%L, 1)', (SELECT id FROM lb_production_recipes WHERE name = 'Chicken meal'))) LIKE '%no longer in use%');
  PERFORM t_ok('editing a recipe does not rewrite a posted run', (SELECT count(*) FROM lb_production_run_inputs WHERE run_id = (SELECT id FROM lb_production_runs WHERE client_reference = 'dev-1')) = 5);
END $$;

SELECT CASE WHEN count(*) FILTER (WHERE NOT pass) = 0 THEN 'ALL ' || count(*) || ' CHECKS PASSED' ELSE count(*) FILTER (WHERE NOT pass) || ' OF ' || count(*) || ' CHECKS FAILED' END AS result FROM t_results;
SELECT name, info FROM t_results WHERE NOT pass;
