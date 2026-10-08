-- Phase 24 scenarios (Efficiency report) = the brief's acceptance tests end to end. SCRATCH DATABASE ONLY.
-- Run from schema/:  psql -v ON_ERROR_STOP=1 -f tests/phase24_scenarios.sql
\i tests/phase19_stubs.sql
\i tests/phase22_stubs.sql
ALTER TABLE lb_products ADD COLUMN IF NOT EXISTS selling_price numeric DEFAULT 0;
CREATE TABLE lb_service_details (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, product_id uuid NOT NULL UNIQUE REFERENCES lb_products(id), duration_minutes integer, commission_rate numeric(5,2) NOT NULL DEFAULT 0);
\i phase19_folios.sql
\i phase20_rooms_stays.sql
\i phase21_services_activities.sql
\i phase22_production.sql
\i phase23_packages.sql
\i phase24_efficiency.sql
\i phase24_efficiency.sql

CREATE TABLE t_results (name text, pass boolean, info text);
GRANT ALL ON t_results TO PUBLIC;
CREATE FUNCTION t_ok(p_name text, p_cond boolean, p_info text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO t_results VALUES (p_name, coalesce(p_cond,false), p_info); RAISE NOTICE '% %', CASE WHEN coalesce(p_cond,false) THEN 'PASS' ELSE 'FAIL' END, p_name || CASE WHEN coalesce(p_cond,false) THEN '' ELSE '  -> ' || p_info END; END $$;
CREATE FUNCTION t_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
CREATE FUNCTION t_ctx(p_tenant text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.tenant', p_tenant, false) $$;
CREATE FUNCTION t_prod(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lb_products WHERE name = p $$;
GRANT EXECUTE ON FUNCTION t_ok, t_err, t_ctx, t_prod TO PUBLIC;

DO $$
DECLARE T1 uuid := '00000000-0000-0000-0000-0000000000aa'; T2 uuid := '00000000-0000-0000-0000-0000000000bb';
        B1 uuid := 'b1000000-0000-0000-0000-000000000001'; B2 uuid := 'b2000000-0000-0000-0000-000000000002'; B3 uuid := 'b3000000-0000-0000-0000-000000000003';
        today date := _local_today(); typ uuid; john uuid; room uuid; st uuid; f uuid; w uuid; rec uuid; run uuid; r jsonb; fam uuid; i int; x jsonb;
BEGIN
  PERFORM t_ctx(T1::text);
  INSERT INTO lb_businesses VALUES (B1, T1, 'Umova Resort'), (B2, T2, 'Other Hotel'), (B3, T1, 'Plain Shop');
  INSERT INTO lb_customers(tenant_id, business_id, name) VALUES (T1, B1, 'John Kamau') RETURNING id INTO john;
  INSERT INTO lb_warehouses(tenant_id, business_id, name, is_default) VALUES (T1, B1, 'Main', true) RETURNING id INTO w;
  INSERT INTO lb_room_types(tenant_id, business_id, name, base_rate, capacity) VALUES (T1, B1, 'Double', 4000, 2) RETURNING id INTO typ;
  FOR i IN 201..230 LOOP INSERT INTO lb_rooms(tenant_id, business_id, room_type_id, room_number) VALUES (T1, B1, typ, i::text); END LOOP;

  -- a business that never used any of it gets an almost empty report
  x := efficiency_report(B3, today - 6, today);
  PERFORM t_ok('a plain shop gets no rooms / folios / packages / production sections', NOT (x ? 'rooms') AND NOT (x ? 'folios') AND NOT (x ? 'packages') AND NOT (x ? 'production'), x::text);

  -- ===== HOSPITALITY ACCEPTANCE: John Kamau, Room 204, 4,000 x 2 nights + extras = 12,300 =====
  SELECT id INTO room FROM lb_rooms WHERE room_number = '204';
  st := create_stay(B1, john, room, today, today + 2, 4000, 1, NULL, NULL, true);
  -- the app refuses past dates on purpose; the test moves the guest's arrival back two days to simulate time passing
  UPDATE lb_stays SET check_in_date = today - 2, expected_check_out = today WHERE id = st;
  PERFORM _sync_room_line(st, 2, NULL);
  f := (SELECT folio_id FROM lb_stays WHERE id = st);
  PERFORM post_folio_line(f, 'SERVICE', 'Breakfast', 1, 600, 'Food');
  PERFORM post_folio_line(f, 'SERVICE', 'Dinner', 1, 1800, 'Food');
  PERFORM post_folio_line(f, 'SERVICE', 'Drinks', 1, 1100, 'Beverages');
  PERFORM post_folio_line(f, 'ACTIVITY', 'Swimming', 1, 500, 'Activities');
  PERFORM post_folio_line(f, 'ACTIVITY', 'Football', 1, 300, 'Activities');
  x := efficiency_report(B1, today - 2, today);
  PERFORM t_ok('mid-stay: guest is in house and the bill so far is 12,300 (room 8,000 at 2 nights)', (x->'rooms'->>'in_house_now')::int = 1 AND (SELECT total_charges FROM lb_folio_summary WHERE id = f) = 12300, (SELECT total_charges::text FROM lb_folio_summary WHERE id = f));
  PERFORM check_out_stay(st, false);
  PERFORM t_ok('one folio of 12,300 settled with M-Pesa', (settle_folio(f, '[{"payment_method":"MOBILE_MONEY","amount":12300,"reference_no":"SHK7X9ABCD"}]'::jsonb)->>'total')::numeric = 12300);

  x := efficiency_report(B1, today - 2, today);
  PERFORM t_ok('30 rooms x 3 days = 90 room nights available', (x->'rooms'->>'room_nights_available')::numeric = 90, (x->'rooms')::text);
  PERFORM t_ok('2 room nights sold, revenue 8,000, ADR 4,000', (x->'rooms'->>'room_nights_sold')::numeric = 2 AND (x->'rooms'->>'room_revenue')::numeric = 8000 AND (x->'rooms'->>'adr')::numeric = 4000, (x->'rooms')::text);
  PERFORM t_ok('occupancy 2.2%, RevPAR 88.89', (x->'rooms'->>'occupancy_pct')::numeric = 2.2 AND (x->'rooms'->>'revpar')::numeric = 88.89, (x->'rooms')::text);
  PERFORM t_ok('average stay 2 nights, 1 checked out', (x->'rooms'->>'avg_stay_nights')::numeric = 2.0 AND (x->'rooms'->>'stays_checked_out')::int = 1, (x->'rooms')::text);
  PERFORM t_ok('guest spend = 12,300 over 1 settled folio', (x->'folios'->>'avg_guest_spend')::numeric = 12300 AND (x->'folios'->>'settled_count')::int = 1, (x->'folios')::text);
  PERFORM t_ok('revenue by type: ROOM 8,000 first, ACTIVITY 800', (x->'folios'->'by_type'->0->>'type') = 'ROOM' AND (x->'folios'->'by_type'->0->>'amount')::numeric = 8000
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(x->'folios'->'by_type') e WHERE e->>'type' = 'ACTIVITY' AND (e->>'amount')::numeric = 800), x->'folios'->>'by_type');
  PERFORM t_ok('top activity is Swimming 500', (x->'folios'->'top_activities'->0->>'name') = 'Swimming' AND (x->'folios'->'top_activities'->0->>'amount')::numeric = 500, x->'folios'->>'top_activities');
  PERFORM t_ok('nothing open', (x->'folios'->>'open_count')::int = 0 AND (x->'folios'->>'open_balance')::numeric = 0);
  PERFORM t_ok('no production or package sections yet (no such data)', NOT (x ? 'production') AND NOT (x ? 'packages'));

  -- a future end date cannot be "measured": nights are not invented
  x := efficiency_report(B1, today - 2, today + 30);
  PERFORM t_ok('future days are not counted as available', (x->>'days_measured')::int = 3 AND (x->'rooms'->>'room_nights_available')::numeric = 90, x->>'days_measured');

  -- packages show up with the same bill
  INSERT INTO lb_products(tenant_id, name, track_inventory, selling_price) VALUES (T1, 'Swim pass', false, 500);
  fam := save_package(NULL, B1, 'Day Pass', NULL, 400, jsonb_build_array(jsonb_build_object('product_id', t_prod('Swim pass'), 'quantity', 1)));
  INSERT INTO lb_customers(tenant_id, business_id, name) VALUES (T1, B1, 'Mary') ;
  f := open_folio(B1, (SELECT id FROM lb_customers WHERE name = 'Mary'), 'Day visitor');
  PERFORM add_package_to_folio(f, fam, 3, NULL);
  x := efficiency_report(B1, today - 2, today);
  PERFORM t_ok('packages: 3 sold, 1,200', (x->'packages'->>'sold')::int = 3 AND (x->'packages'->>'revenue')::numeric = 1200 AND (x->'packages'->'by_package'->0->>'name') = 'Day Pass', (x->'packages')::text);
  PERFORM t_ok('the open folio shows as open balance 1,200', (x->'folios'->>'open_count')::int = 1 AND (x->'folios'->>'open_balance')::numeric = 1200, (x->'folios')::text);

  -- ===== BAKERY ACCEPTANCE: expected 100, actual 94, wastage 6, yield 94% =====
  INSERT INTO lb_products(tenant_id, name, track_inventory) VALUES (T1,'Flour',true),(T1,'Sugar',true),(T1,'Eggs',true),(T1,'Milk',true),(T1,'Butter',true),(T1,'Chocolate Cake',true);
  INSERT INTO lb_inventory(tenant_id, business_id, warehouse_id, product_id, quantity, average_cost)
    SELECT T1, B1, w, t_prod(n), q, c FROM (VALUES ('Flour',100,120),('Sugar',50,150),('Eggs',1000,10),('Milk',50,100),('Butter',20,300)) v(n,q,c);
  rec := save_production_recipe(NULL, B1, 'Chocolate Cake', 'one cake',
    jsonb_build_array(jsonb_build_object('product_id', t_prod('Flour'), 'quantity', 0.5), jsonb_build_object('product_id', t_prod('Sugar'), 'quantity', 0.25),
                      jsonb_build_object('product_id', t_prod('Eggs'), 'quantity', 3), jsonb_build_object('product_id', t_prod('Milk'), 'quantity', 0.2), jsonb_build_object('product_id', t_prod('Butter'), 'quantity', 0.1)),
    jsonb_build_array(jsonb_build_object('product_id', t_prod('Chocolate Cake'), 'quantity', 1)));
  run := start_production_run(rec, 100, today, NULL, 'p24');
  r := post_production_run(run, jsonb_build_array(jsonb_build_object('product_id', t_prod('Chocolate Cake'), 'actual_quantity', 94)), NULL, 'Burnt', 'oven too hot');
  x := efficiency_report(B1, today - 2, today);
  PERFORM t_ok('production: 1 run, expected 100, actual 94, yield 94%', (x->'production'->>'runs')::int = 1 AND (x->'production'->>'expected')::numeric = 100 AND (x->'production'->>'actual')::numeric = 94 AND (x->'production'->>'yield_pct')::numeric = 94.0, (x->'production')::text);
  PERFORM t_ok('wastage 6 with a cost, reason Burnt', (x->'production'->>'wastage_qty')::numeric = 6 AND (x->'production'->>'wastage_cost')::numeric > 0 AND (x->'production'->'wastage_by_reason'->0->>'reason') = 'Burnt', (x->'production')::text);
  PERFORM t_ok('per-recipe row for Chocolate Cake at 94%', (x->'production'->'by_recipe'->0->>'name') = 'Chocolate Cake' AND (x->'production'->'by_recipe'->0->>'yield_pct')::numeric = 94.0);
  x := efficiency_report(B1, today - 40, today - 20);
  PERFORM t_ok('a range with no activity has no production section and no made-up numbers', NOT (x ? 'production') AND NOT (x ? 'packages'), x::text);
  PERFORM t_ok('bad ranges refused', t_err(format('SELECT efficiency_report(%L, %L, %L)', B1, today, today - 1)) LIKE '%start date%' AND t_err(format('SELECT efficiency_report(%L, %L, %L)', B1, today - 400, today)) LIKE '%one year%');

  PERFORM t_ctx(T2::text);
  PERFORM t_ok('other tenant cannot report on our business', t_err(format('SELECT efficiency_report(%L, %L, %L)', B1, today - 2, today)) LIKE '%Business not found%');
END $$;
GRANT SELECT ON lb_businesses, lb_customers TO authenticated;
DO $$
DECLARE x jsonb;
BEGIN
  PERFORM t_ctx('00000000-0000-0000-0000-0000000000bb');
  SET LOCAL ROLE authenticated;
  x := efficiency_report('b2000000-0000-0000-0000-000000000002', _local_today() - 2, _local_today());
  PERFORM t_ok('under RLS the other tenant''s own report is empty of our data', NOT (x ? 'rooms') AND NOT (x ? 'folios') AND NOT (x ? 'production'), x::text);
  RESET ROLE;
END $$;
SELECT CASE WHEN count(*) FILTER (WHERE NOT pass) = 0 THEN 'ALL ' || count(*) || ' CHECKS PASSED' ELSE count(*) FILTER (WHERE NOT pass) || ' OF ' || count(*) || ' CHECKS FAILED' END AS result FROM t_results;
SELECT name, info FROM t_results WHERE NOT pass;
