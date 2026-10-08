-- Phase 21 scenarios (Services & Activities). SCRATCH DATABASE ONLY.
-- Run from schema/:  psql -v ON_ERROR_STOP=1 -f tests/phase21_scenarios.sql
\i tests/phase19_stubs.sql
\i phase19_folios.sql
-- stand-in for the phase6 table this phase extends (live one has more columns)
CREATE TABLE lb_service_details (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, product_id uuid NOT NULL UNIQUE REFERENCES lb_products(id), duration_minutes integer, commission_rate numeric(5,2) NOT NULL DEFAULT 0);
\i phase21_services_activities.sql
\i phase21_services_activities.sql

CREATE TABLE t_results (name text, pass boolean, info text);
CREATE FUNCTION t_ok(p_name text, p_cond boolean, p_info text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO t_results VALUES (p_name, coalesce(p_cond,false), p_info); RAISE NOTICE '% %', CASE WHEN coalesce(p_cond,false) THEN 'PASS' ELSE 'FAIL' END, p_name; END $$;
CREATE FUNCTION t_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

DO $$
DECLARE T1 uuid := '00000000-0000-0000-0000-0000000000aa'; B1 uuid := 'b1000000-0000-0000-0000-000000000001';
        john uuid; f uuid; s uuid; p record; types jsonb;
BEGIN
  PERFORM set_config('test.tenant', T1::text, false);
  INSERT INTO lb_businesses VALUES (B1, T1, 'Umova Resort');
  INSERT INTO lb_customers(tenant_id, business_id, name) VALUES (T1, B1, 'John Kamau') RETURNING id INTO john;
  INSERT INTO lb_products(tenant_id, name, track_inventory) VALUES (T1,'Soda',true),(T1,'Haircut',false),(T1,'Swimming',false),(T1,'Football',false),(T1,'Massage',false);
  INSERT INTO lb_service_details(tenant_id, product_id, kind) SELECT T1, id, CASE WHEN name IN ('Swimming','Football') THEN 'ACTIVITY' ELSE 'SERVICE' END FROM lb_products WHERE track_inventory = false;
  PERFORM t_ok('existing services default to SERVICE (nothing changes for a salon)', (SELECT count(*) FROM lb_service_details WHERE kind = 'SERVICE') = 2);
  PERFORM t_ok('bad kind rejected', t_err('INSERT INTO lb_service_details(tenant_id, product_id, kind) SELECT ''00000000-0000-0000-0000-0000000000aa'', id, ''SPORT'' FROM lb_products WHERE name = ''Soda''') LIKE '%kind_chk%');

  f := open_folio(B1, john, 'Room 204');
  FOR p IN SELECT n, price FROM (VALUES ('Soda',100),('Haircut',700),('Swimming',500),('Football',300),('Massage',2000)) v(n, price) LOOP
    INSERT INTO lb_sales(tenant_id, business_id, customer_id, status, folio_id) VALUES (T1, B1, john, 'COMPLETED', f) RETURNING id INTO s;
    INSERT INTO lb_sale_items(sale_id, product_id, quantity, unit_price, total_price) SELECT s, id, 1, p.price, p.price FROM lb_products WHERE name = p.n;
    PERFORM post_sale_to_folio(f, s);
  END LOOP;
  SELECT jsonb_object_agg(line_type, total) INTO types FROM (SELECT line_type, sum(amount) total FROM lb_folio_lines WHERE folio_id = f GROUP BY 1) x;
  PERFORM t_ok('swimming + football land as ACTIVITY (800)', (types->>'ACTIVITY')::numeric = 800, types::text);
  PERFORM t_ok('haircut + massage stay SERVICE (2,700)', (types->>'SERVICE')::numeric = 2700, types::text);
  PERFORM t_ok('a stocked soda stays PRODUCT (100)', (types->>'PRODUCT')::numeric = 100, types::text);
  PERFORM t_ok('one bill = 3,600', (SELECT total_charges FROM lb_folio_summary WHERE id = f) = 3600);
  PERFORM t_ok('re-posting a sale is still idempotent', post_sale_to_folio(f, s) = 0);
  PERFORM t_ok('a product with NO service row still works (soda, no details)', (SELECT count(*) FROM lb_folio_lines WHERE description = 'Soda') = 1);
  PERFORM t_ok('settle one payment, whole account', (settle_folio(f, '[{"payment_method":"CASH","amount":3600}]'::jsonb)->>'total')::numeric = 3600);
END $$;
SELECT CASE WHEN count(*) FILTER (WHERE NOT pass) = 0 THEN 'ALL ' || count(*) || ' CHECKS PASSED' ELSE count(*) FILTER (WHERE NOT pass) || ' FAILED' END FROM t_results;
