-- Phase 25 + 26 scenarios (unified receipt data, production reversal). SCRATCH DATABASE ONLY.
-- Run from schema/:  psql -v ON_ERROR_STOP=1 -f tests/phase25_26_scenarios.sql   (add -v texttypes=1 for text movement columns)
\i tests/phase19_stubs.sql
\i tests/phase22_stubs.sql
ALTER TABLE lb_products ADD COLUMN IF NOT EXISTS category_id uuid;
CREATE TABLE lb_product_categories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, name text);
CREATE TABLE lb_service_details (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, product_id uuid NOT NULL UNIQUE REFERENCES lb_products(id), duration_minutes integer, commission_rate numeric(5,2) NOT NULL DEFAULT 0);
\i phase19_folios.sql
\i phase21_services_activities.sql
\i phase22_production.sql
\i phase25_unified_receipts.sql
\i phase26_production_reverse.sql
\i phase26_production_reverse.sql

CREATE TABLE t_results (name text, pass boolean, info text);
GRANT ALL ON t_results TO PUBLIC;
CREATE FUNCTION t_ok(p_name text, p_cond boolean, p_info text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO t_results VALUES (p_name, coalesce(p_cond,false), p_info); RAISE NOTICE '% %', CASE WHEN coalesce(p_cond,false) THEN 'PASS' ELSE 'FAIL' END, p_name || CASE WHEN coalesce(p_cond,false) THEN '' ELSE '  -> ' || p_info END; END $$;
CREATE FUNCTION t_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
CREATE FUNCTION t_ctx(p_tenant text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.tenant', p_tenant, false) $$;
CREATE FUNCTION t_prod(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lb_products WHERE name = p $$;
CREATE FUNCTION t_qty(p text) RETURNS numeric LANGUAGE sql AS $$ SELECT quantity FROM lb_inventory WHERE product_id = t_prod(p) $$;
GRANT EXECUTE ON FUNCTION t_ok, t_err, t_ctx, t_prod, t_qty TO PUBLIC;

DO $$
DECLARE T1 uuid := '00000000-0000-0000-0000-0000000000aa'; T2 uuid := '00000000-0000-0000-0000-0000000000bb';
        B1 uuid := 'b1000000-0000-0000-0000-000000000001'; B2 uuid := 'b2000000-0000-0000-0000-000000000002';
        w uuid; john uuid; f uuid; s uuid; cf uuid; cd uuid; rec uuid; run uuid; run2 uuid; r jsonb; x text;
BEGIN
  PERFORM t_ctx(T1::text);
  INSERT INTO lb_businesses VALUES (B1, T1, 'Umova Resort'), (B2, T2, 'Other Co');
  INSERT INTO lb_customers(tenant_id, business_id, name) VALUES (T1, B1, 'John Kamau') RETURNING id INTO john;
  INSERT INTO lb_warehouses(tenant_id, business_id, name, is_default) VALUES (T1, B1, 'Main', true) RETURNING id INTO w;

  -- ===== Phase 25: till sales carry the product category onto the guest's bill =====
  INSERT INTO lb_product_categories(tenant_id, name) VALUES (T1, 'Food') RETURNING id INTO cf;
  INSERT INTO lb_product_categories(tenant_id, name) VALUES (T1, 'Drinks') RETURNING id INTO cd;
  INSERT INTO lb_products(tenant_id, name, track_inventory, category_id) VALUES (T1,'Pilau',true,cf),(T1,'Soda',true,cd),(T1,'Swimming',false,NULL),(T1,'Loose item',true,NULL);
  INSERT INTO lb_service_details(tenant_id, product_id, kind) VALUES (T1, t_prod('Swimming'), 'ACTIVITY');
  f := open_folio(B1, john, 'Room 204');
  INSERT INTO lb_sales(tenant_id, business_id, customer_id, status, folio_id) VALUES (T1, B1, john, 'COMPLETED', f) RETURNING id INTO s;
  INSERT INTO lb_sale_items(sale_id, product_id, quantity, unit_price, total_price)
    SELECT s, id, 1, 100, 100 FROM lb_products WHERE name IN ('Pilau','Soda','Swimming','Loose item');
  PERFORM t_ok('four sale items post', post_sale_to_folio(f, s) = 4);
  PERFORM t_ok('Pilau line carries Food, Soda carries Drinks', (SELECT category FROM lb_folio_lines WHERE description = 'Pilau') = 'Food' AND (SELECT category FROM lb_folio_lines WHERE description = 'Soda') = 'Drinks');
  PERFORM t_ok('a product with no category posts with no category (old behaviour)', (SELECT category FROM lb_folio_lines WHERE description = 'Loose item') IS NULL);
  PERFORM t_ok('line types unchanged: ACTIVITY and PRODUCT', (SELECT line_type FROM lb_folio_lines WHERE description = 'Swimming') = 'ACTIVITY' AND (SELECT line_type FROM lb_folio_lines WHERE description = 'Pilau') = 'PRODUCT');
  PERFORM t_ok('re-posting the sale stays idempotent', post_sale_to_folio(f, s) = 0);

  -- ===== Phase 26: reverse a posted run =====
  INSERT INTO lb_products(tenant_id, name, track_inventory) VALUES (T1,'Flour',true),(T1,'Sugar',true),(T1,'Chocolate Cake',true);
  INSERT INTO lb_inventory(tenant_id, business_id, warehouse_id, product_id, quantity, average_cost) VALUES (T1,B1,w,t_prod('Flour'),100,120),(T1,B1,w,t_prod('Sugar'),50,150);
  rec := save_production_recipe(NULL, B1, 'Chocolate Cake', NULL,
     jsonb_build_array(jsonb_build_object('product_id', t_prod('Flour'), 'quantity', 0.5), jsonb_build_object('product_id', t_prod('Sugar'), 'quantity', 0.25)),
     jsonb_build_array(jsonb_build_object('product_id', t_prod('Chocolate Cake'), 'quantity', 1)));
  run := start_production_run(rec, 100, CURRENT_DATE, NULL, 'rv-1');
  PERFORM post_production_run(run, jsonb_build_array(jsonb_build_object('product_id', t_prod('Chocolate Cake'), 'actual_quantity', 94)), NULL, 'Burnt');
  PERFORM t_ok('after posting: flour 50, sugar 25, cake 94', t_qty('Flour') = 50 AND t_qty('Sugar') = 25 AND t_qty('Chocolate Cake') = 94);
  PERFORM t_ok('a draft cannot be reversed', t_err(format('SELECT reverse_production_run(%L, ''x'')', start_production_run(rec, 10, CURRENT_DATE, NULL, 'rv-draft'))) LIKE '%Only a posted run%');
  PERFORM t_ok('a reason is required', t_err(format('SELECT reverse_production_run(%L, '' '')', run)) LIKE '%reason%');

  -- some cakes were sold: reversing would make stock negative
  UPDATE lb_inventory SET quantity = 90 WHERE product_id = t_prod('Chocolate Cake');
  PERFORM t_ok('cannot reverse when the cakes are no longer there', t_err(format('SELECT reverse_production_run(%L, ''typed wrong'')', run)) LIKE '%Cannot reverse%' AND t_qty('Flour') = 50 AND (SELECT status FROM lb_production_runs WHERE id = run) = 'POSTED');
  UPDATE lb_inventory SET quantity = 94 WHERE product_id = t_prod('Chocolate Cake');

  r := reverse_production_run(run, 'Typed the wrong count');
  PERFORM t_ok('reversal puts materials back (flour 100, sugar 50) and takes the cakes out (0)', t_qty('Flour') = 100 AND t_qty('Sugar') = 50 AND t_qty('Chocolate Cake') = 0, t_qty('Flour') || '/' || t_qty('Sugar') || '/' || t_qty('Chocolate Cake'));
  PERFORM t_ok('run is REVERSED with reason and time, not deleted', (SELECT status FROM lb_production_runs WHERE id = run) = 'REVERSED' AND (SELECT reverse_reason FROM lb_production_runs WHERE id = run) = 'Typed the wrong count' AND (SELECT reversed_at FROM lb_production_runs WHERE id = run) IS NOT NULL);
  PERFORM t_ok('every reversal is a stock movement (3 reversals, history kept)', (SELECT count(*) FROM lb_stock_movements WHERE notes LIKE 'Reversal of%') = 3 AND (SELECT count(*) FROM lb_stock_movements) = 6, (SELECT count(*) FROM lb_stock_movements)::text);
  PERFORM t_ok('flour average cost still 120 after the round trip', (SELECT average_cost FROM lb_inventory WHERE product_id = t_prod('Flour')) = 120);
  PERFORM t_ok('reversing twice is refused', t_err(format('SELECT reverse_production_run(%L, ''again'')', run)) LIKE '%already reversed%');
  PERFORM t_ok('a reversed run cannot be posted again', t_err(format('SELECT post_production_run(%L, ''[]''::jsonb)', run)) LIKE '%reversed%');
  PERFORM t_ok('a reversed run cannot be cancelled', t_err(format('SELECT cancel_production_run(%L)', run)) LIKE '%cannot be cancelled%' OR t_err(format('SELECT cancel_production_run(%L)', run)) LIKE '%Only a run%');

  -- the same recipe can be run again properly
  run2 := start_production_run(rec, 100, CURRENT_DATE, NULL, 'rv-2');
  r := post_production_run(run2, jsonb_build_array(jsonb_build_object('product_id', t_prod('Chocolate Cake'), 'actual_quantity', 100)));
  PERFORM t_ok('a corrected run posts normally (yield 100)', (r->>'yield_pct')::numeric = 100 AND t_qty('Chocolate Cake') = 100);

  PERFORM t_ctx(T2::text);
  PERFORM t_ok('other tenant cannot reverse our run', t_err(format('SELECT reverse_production_run(%L, ''x'')', run2)) LIKE '%not found%');
END $$;
SELECT CASE WHEN count(*) FILTER (WHERE NOT pass) = 0 THEN 'ALL ' || count(*) || ' CHECKS PASSED' ELSE count(*) FILTER (WHERE NOT pass) || ' OF ' || count(*) || ' CHECKS FAILED' END AS result FROM t_results;
SELECT name, info FROM t_results WHERE NOT pass;
