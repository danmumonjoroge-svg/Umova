-- Phase 23 scenarios (Packages). SCRATCH DATABASE ONLY.
-- Run from schema/:  psql -v ON_ERROR_STOP=1 -f tests/phase23_scenarios.sql      (add -v texttypes=1 for text movement columns)
\i tests/phase19_stubs.sql
\i tests/phase22_stubs.sql
ALTER TABLE lb_products ADD COLUMN IF NOT EXISTS selling_price numeric DEFAULT 0;
CREATE TABLE lb_service_details (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, product_id uuid NOT NULL UNIQUE REFERENCES lb_products(id), duration_minutes integer, commission_rate numeric(5,2) NOT NULL DEFAULT 0);
\i phase19_folios.sql
\i phase20_rooms_stays.sql
\i phase21_services_activities.sql
\i phase22_production.sql
\i phase23_packages.sql
\i phase23_packages.sql

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
        W uuid; john uuid; f uuid; fam uuid; bnb uuid; res jsonb; res2 jsonb; chg uuid; lines record; s numeric;
BEGIN
  PERFORM t_ctx(T1::text);
  INSERT INTO lb_businesses VALUES (B1, T1, 'Umova Resort'), (B2, T2, 'Other Hotel');
  INSERT INTO lb_customers(tenant_id, business_id, name) VALUES (T1, B1, 'John Kamau') RETURNING id INTO john;
  INSERT INTO lb_warehouses(tenant_id, business_id, name, is_default) VALUES (T1, B1, 'Main', true) RETURNING id INTO W;
  INSERT INTO lb_products(tenant_id, name, track_inventory, selling_price, cost_price) VALUES
    (T1,'Lunch',true,800,300),(T1,'Soda',true,100,40),(T1,'Swimming',false,500,0),(T1,'Football',false,300,0),(T1,'Breakfast',true,600,200);
  INSERT INTO lb_service_details(tenant_id, product_id, kind) SELECT T1, id, 'ACTIVITY' FROM lb_products WHERE name IN ('Swimming','Football');
  INSERT INTO lb_inventory(tenant_id, business_id, warehouse_id, product_id, quantity, average_cost) VALUES
    (T1,B1,W,t_prod('Lunch'),10,300),(T1,B1,W,t_prod('Soda'),20,40),(T1,B1,W,t_prod('Breakfast'),10,200);

  -- Family package: swimming 2x500, lunch 2x800, soda 2x100 => list 2,800, sold at 2,500
  fam := save_package(NULL, B1, 'Family Package', 'Swim, lunch and drinks', 2500, jsonb_build_array(
     jsonb_build_object('product_id', t_prod('Swimming'), 'quantity', 2),
     jsonb_build_object('product_id', t_prod('Lunch'), 'quantity', 2),
     jsonb_build_object('product_id', t_prod('Soda'), 'quantity', 2)));
  PERFORM t_ok('package saved with list prices read from the products', (SELECT list_total FROM lb_package_summary WHERE id = fam) = 2800 AND (SELECT item_count FROM lb_package_summary WHERE id = fam) = 3);
  PERFORM t_ok('guest saving = 300, estimated cost = 2x300+2x40 = 680', (SELECT guest_saving FROM lb_package_summary WHERE id = fam) = 300 AND (SELECT est_cost FROM lb_package_summary WHERE id = fam) = 680);

  bnb := save_package(NULL, B1, 'Bed & Breakfast', NULL, 1000, jsonb_build_array(
     jsonb_build_object('product_id', t_prod('Breakfast'), 'quantity', 1),
     jsonb_build_object('description', 'Late check-out', 'quantity', 1, 'list_price', 400, 'category', 'Rooms')));
  PERFORM t_ok('free-text item allowed (no product)', (SELECT count(*) FROM lb_package_items WHERE package_id = bnb AND product_id IS NULL) = 1);

  f := open_folio(B1, john, 'Room 204');
  res := add_package_to_folio(f, fam, 1, 'fam-1');
  PERFORM t_ok('package posts one line per component', (res->>'lines')::int = 3 AND (res->>'total')::numeric = 2500, res::text);
  SELECT sum(amount) INTO s FROM lb_folio_lines WHERE folio_id = f AND status = 'POSTED';
  PERFORM t_ok('the lines add up to EXACTLY the package price', s = 2500, s::text);
  PERFORM t_ok('split follows normal prices (swim 1000/2800 -> 892.86)', (SELECT amount FROM lb_folio_lines WHERE folio_id = f AND description LIKE '%Swimming') = 892.86,
     (SELECT amount::text FROM lb_folio_lines WHERE folio_id = f AND description LIKE '%Swimming'));
  PERFORM t_ok('swimming is typed ACTIVITY, lunch PRODUCT', (SELECT line_type FROM lb_folio_lines WHERE description LIKE '%Swimming') = 'ACTIVITY' AND (SELECT line_type FROM lb_folio_lines WHERE description LIKE '%Lunch') = 'PRODUCT');
  PERFORM t_ok('lines carry the package name', (SELECT count(*) FROM lb_folio_lines WHERE package_name = 'Family Package' AND package_charge_id = (res->>'charge_id')::uuid) = 3);
  PERFORM t_ok('stock issued: lunch 10 -> 8, soda 20 -> 18', t_qty('Lunch') = 8 AND t_qty('Soda') = 18, t_qty('Lunch') || '/' || t_qty('Soda'));
  PERFORM t_ok('a service moves no stock', NOT EXISTS (SELECT 1 FROM lb_stock_movements WHERE product_id = t_prod('Swimming')));
  PERFORM t_ok('movements are SALE, negative, at cost', (SELECT count(*) FROM lb_stock_movements WHERE movement_type::text = 'SALE' AND quantity < 0) = 2 AND (SELECT unit_cost FROM lb_stock_movements WHERE product_id = t_prod('Lunch')) = 300);

  res2 := add_package_to_folio(f, fam, 1, 'fam-1');
  PERFORM t_ok('same client reference again = no double charge, no double stock', (res2->>'duplicate')::boolean AND (SELECT count(*) FROM lb_folio_lines WHERE folio_id = f) = 3 AND t_qty('Lunch') = 8, res2::text);

  res := add_package_to_folio(f, fam, 2, 'fam-2');
  SELECT sum(amount) INTO s FROM lb_folio_lines WHERE package_charge_id = (res->>'charge_id')::uuid;
  PERFORM t_ok('two packages = 5,000 and stock x2 (lunch 8 -> 4)', s = 5000 AND t_qty('Lunch') = 4, s || '/' || t_qty('Lunch'));
  chg := (res->>'charge_id')::uuid;

  PERFORM t_ok('a single package line cannot be voided by hand', t_err(format('SELECT void_folio_line(%L, ''oops'')', (SELECT id FROM lb_folio_lines WHERE package_charge_id = chg LIMIT 1))) LIKE '%part of a package%', coalesce(t_err(format('SELECT void_folio_line(%L, ''oops'')', (SELECT id FROM lb_folio_lines WHERE package_charge_id = chg LIMIT 1))),'no error'));
  PERFORM t_ok('void needs a reason', t_err(format('SELECT void_package_charge(%L, %L, '' '')', f, chg)) LIKE '%reason%');
  PERFORM void_package_charge(f, chg, 'Guest changed mind');
  PERFORM t_ok('removing the package takes it off the bill (back to 2,500)', (SELECT total_charges FROM lb_folio_summary WHERE id = f) = 2500);
  PERFORM t_ok('...and returns the stock (lunch back to 8)', t_qty('Lunch') = 8 AND t_qty('Soda') = 18, t_qty('Lunch')::text);
  PERFORM t_ok('removing it twice is refused', t_err(format('SELECT void_package_charge(%L, %L, ''again'')', f, chg)) LIKE '%not found%');

  -- stock guard
  UPDATE lb_inventory SET quantity = 1 WHERE product_id = t_prod('Lunch');
  PERFORM t_ok('not enough lunch for a family package -> refused, nothing posted', t_err(format('SELECT add_package_to_folio(%L, %L, 1, NULL)', f, fam)) LIKE '%Not enough Lunch%' AND (SELECT count(*) FROM lb_folio_lines WHERE folio_id = f AND status = 'POSTED') = 3);
  UPDATE lb_inventory SET quantity = 8 WHERE product_id = t_prod('Lunch');

  -- B&B: odd split rounds exactly
  res := add_package_to_folio(f, bnb, 3, NULL);
  PERFORM t_ok('B&B x3 = 3,000 and lines sum exactly', (SELECT sum(amount) FROM lb_folio_lines WHERE package_charge_id = (res->>'charge_id')::uuid) = 3000);
  PERFORM t_ok('free-text line is OTHER, category from the item', (SELECT line_type || '/' || category FROM lb_folio_lines WHERE description LIKE '%Late check-out') = 'OTHER/Rooms');
  PERFORM t_ok('breakfast x3 left stock 7', t_qty('Breakfast') = 7, t_qty('Breakfast')::text);

  -- package priced 0 with free items splits equally
  fam := save_package(NULL, B1, 'Free tour', NULL, 100, jsonb_build_array(jsonb_build_object('description','Welcome drink','quantity',1,'list_price',0), jsonb_build_object('description','Tour','quantity',1,'list_price',0), jsonb_build_object('description','Photo','quantity',1,'list_price',0)));
  res := add_package_to_folio(f, fam, 1, NULL);
  PERFORM t_ok('all-free components split equally and still add up (100)', (SELECT sum(amount) FROM lb_folio_lines WHERE package_charge_id = (res->>'charge_id')::uuid) = 100);

  -- validation
  PERFORM t_ok('empty package refused', t_err(format('SELECT save_package(NULL, %L, ''Empty'', NULL, 10, ''[]''::jsonb)', B1)) LIKE '%at least one item%');
  PERFORM t_ok('duplicate name refused', t_err(format('SELECT save_package(NULL, %L, ''Family Package'', NULL, 10, %L::jsonb)', B1, '[{"description":"x"}]')) LIKE '%already have a package%');
  PERFORM t_ok('negative price refused', t_err(format('SELECT save_package(NULL, %L, ''Neg'', NULL, -1, %L::jsonb)', B1, '[{"description":"x"}]')) LIKE '%negative%');
  PERFORM t_ok('fractional package count refused', t_err(format('SELECT add_package_to_folio(%L, %L, 1.5, NULL)', f, bnb)) LIKE '%whole number%');
  PERFORM set_package_active(bnb, false);
  PERFORM t_ok('a switched-off package cannot be sold', t_err(format('SELECT add_package_to_folio(%L, %L, 1, NULL)', f, bnb)) LIKE '%no longer in use%');
  -- editing a package never rewrites what was already sold
  PERFORM save_package(bnb, B1, 'Bed & Breakfast', NULL, 1500, jsonb_build_array(jsonb_build_object('description','Only breakfast','quantity',1,'list_price',600)));
  PERFORM t_ok('editing a package does not change the bill already posted', (SELECT count(*) FROM lb_folio_lines WHERE package_name = 'Bed & Breakfast' AND status = 'POSTED') = 2);

  -- settle: one account, one payment
  s := (SELECT total_charges FROM lb_folio_summary WHERE id = f);
  PERFORM t_ok('settle with M-Pesa, package lines included', (settle_folio(f, jsonb_build_array(jsonb_build_object('payment_method','MOBILE_MONEY','amount', s)))->>'total')::numeric = s);

  -- tenant isolation
  PERFORM t_ctx(T2::text);
  PERFORM t_ok('other tenant cannot sell, edit or switch off our package', t_err(format('SELECT add_package_to_folio(%L, %L, 1, NULL)', f, fam)) LIKE '%not found%'
     AND t_err(format('SELECT set_package_active(%L, true)', fam)) LIKE '%not found%'
     AND t_err(format('SELECT save_package(%L, %L, ''x'', NULL, 1, %L::jsonb)', fam, B2, '[{"description":"x"}]')) LIKE '%not found%');
  PERFORM t_ok('...nor build a package from our business or products', t_err(format('SELECT save_package(NULL, %L, ''Steal'', NULL, 1, %L::jsonb)', B1, '[{"description":"x"}]')) LIKE '%Business not found%'
     AND t_err(format('SELECT save_package(NULL, %L, ''Steal'', NULL, 1, %L::jsonb)', B2, jsonb_build_array(jsonb_build_object('product_id', t_prod('Lunch'))))) LIKE '%not one of your products%');
END $$;
DO $$
DECLARE e text;
BEGIN
  PERFORM t_ctx('00000000-0000-0000-0000-0000000000bb');
  SET LOCAL ROLE authenticated;
  PERFORM t_ok('other tenant sees none of our packages', (SELECT count(*) FROM lb_packages) = 0 AND (SELECT count(*) FROM lb_package_items) = 0 AND (SELECT count(*) FROM lb_package_summary) = 0);
  RESET ROLE;
  PERFORM t_ctx('00000000-0000-0000-0000-0000000000aa');
  SET LOCAL ROLE authenticated;
  PERFORM t_ok('owner reads packages', (SELECT count(*) FROM lb_packages) = 3);
  e := t_err('UPDATE lb_packages SET price = 1'); PERFORM t_ok('client cannot edit a package directly', e LIKE '%permission denied%', coalesce(e,'no error'));
  e := t_err('INSERT INTO lb_package_items(tenant_id, package_id, description) SELECT tenant_id, id, ''x'' FROM lb_packages'); PERFORM t_ok('client cannot add items directly', e LIKE '%permission denied%', coalesce(e,'no error'));
  RESET ROLE;
END $$;
SELECT CASE WHEN count(*) FILTER (WHERE NOT pass) = 0 THEN 'ALL ' || count(*) || ' CHECKS PASSED' ELSE count(*) FILTER (WHERE NOT pass) || ' OF ' || count(*) || ' CHECKS FAILED' END AS result FROM t_results;
SELECT name, info FROM t_results WHERE NOT pass;
