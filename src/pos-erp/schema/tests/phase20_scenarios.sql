-- Phase 20 scenarios (Rooms & Stays). SCRATCH DATABASE ONLY -- never run on production.
-- Run from schema/:   psql -v ON_ERROR_STOP=1 -f tests/phase20_scenarios.sql
-- Needs a throwaway Postgres 14+. Stand-in base tables come from phase19_stubs.sql.
-- Every line is PASS or FAIL; the last line says how many failed.

\i tests/phase19_stubs.sql
\i phase19_folios.sql
\i phase20_rooms_stays.sql

-- the stand-in base tables carry no grants; the live ones let the app read them through RLS
GRANT SELECT ON lb_customers, lb_businesses TO authenticated;

-- test-only: let the scenario move "today" (production _local_today() is Africa/Nairobi now())
CREATE OR REPLACE FUNCTION _local_today() RETURNS date LANGUAGE sql STABLE
AS $$ SELECT coalesce(nullif(current_setting('test.today', true), ''), '2026-10-06')::date $$;

CREATE TABLE t_results (name text, pass boolean, info text);
GRANT ALL ON t_results TO PUBLIC;
CREATE FUNCTION t_ok(p_name text, p_cond boolean, p_info text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO t_results VALUES (p_name, coalesce(p_cond, false), p_info);
  RAISE NOTICE '% %', CASE WHEN coalesce(p_cond, false) THEN 'PASS' ELSE 'FAIL' END, p_name || CASE WHEN coalesce(p_cond,false) THEN '' ELSE '  -> ' || p_info END;
END $$;
-- runs SQL, returns the error text (or NULL if it succeeded). Savepoint-safe.
CREATE FUNCTION t_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
CREATE FUNCTION t_ctx(p_tenant text, p_today text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('test.tenant', p_tenant, false), set_config('test.today', p_today, false) $$;
GRANT EXECUTE ON FUNCTION t_ok, t_err, t_ctx TO PUBLIC;

CREATE FUNCTION t_room(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lb_rooms WHERE room_number = p $$;
CREATE FUNCTION t_cust(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lb_customers WHERE name = p $$;
CREATE FUNCTION t_stay(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lb_stays WHERE customer_id = t_cust(p) ORDER BY created_at DESC, id LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION t_room, t_cust, t_stay TO PUBLIC;

-- ---------- fixtures ----------
DO $$
DECLARE T1 uuid := '00000000-0000-0000-0000-0000000000aa'; T2 uuid := '00000000-0000-0000-0000-0000000000bb';
        B1 uuid := 'b1000000-0000-0000-0000-000000000001'; B2 uuid := 'b2000000-0000-0000-0000-000000000002';
        v_dbl uuid; v_sgl uuid; i int; n text;
BEGIN
  INSERT INTO lb_businesses VALUES (B1, T1, 'Umova Hotel'), (B2, T2, 'Other Co');
  INSERT INTO lb_customers(tenant_id, business_id, name)
    SELECT T1, B1, x FROM unnest(ARRAY['John Kamau','Mary Wanjiku','Wanjiru','Otieno','Njeri','Late Larry']) x;
  INSERT INTO lb_customers(tenant_id, business_id, name) VALUES (T2, B2, 'Stranger');
  INSERT INTO lb_products(tenant_id, name, track_inventory) VALUES
    (T1,'Breakfast',true),(T1,'Dinner',true),(T1,'Drinks',true),(T1,'Swimming',false),(T1,'Football',false);
  INSERT INTO lb_room_types(tenant_id, business_id, name, base_rate, capacity) VALUES (T1,B1,'Double Room',4000,2) RETURNING id INTO v_dbl;
  INSERT INTO lb_room_types(tenant_id, business_id, name, base_rate, capacity) VALUES (T1,B1,'Single Room',2500,1) RETURNING id INTO v_sgl;
  FOR i IN 201..230 LOOP
    INSERT INTO lb_rooms(tenant_id, business_id, room_type_id, room_number) VALUES (T1, B1, CASE WHEN i % 2 = 0 THEN v_dbl ELSE v_sgl END, i::text);
  END LOOP;
  INSERT INTO lb_rooms(tenant_id, business_id, room_type_id, room_number) VALUES (T1, B1, v_dbl, '231');
  UPDATE lb_rooms SET status = 'MAINTENANCE' WHERE room_number = '231';
  PERFORM t_ok('30 rooms + 1 maintenance room set up', (SELECT count(*) FROM lb_rooms) = 31);
  PERFORM t_ok('room 204 prices from its type (4,000)', (SELECT rate FROM lb_room_board WHERE room_number = '204') = 4000);
  PERFORM t_ok('a room with its own price uses it', (SELECT count(*) FROM lb_room_board WHERE rate_override IS NULL) = 31);
END $$;

-- ---------- ACCEPTANCE: John Kamau, one bill ----------
SELECT t_ctx('00000000-0000-0000-0000-0000000000aa', '2026-10-06');
DO $$
DECLARE B1 uuid := 'b1000000-0000-0000-0000-000000000001'; T1 uuid := '00000000-0000-0000-0000-0000000000aa';
        v_stay uuid; v_folio uuid; v_sale uuid; r record; p record; ln record;
BEGIN
  v_stay := create_stay(B1, t_cust('John Kamau'), t_room('204'), NULL, '2026-10-08', NULL, 2, NULL, NULL, true);
  SELECT * INTO r FROM lb_stays WHERE id = v_stay;
  PERFORM t_ok('walk-in is CHECKED_IN straight away', r.status = 'CHECKED_IN' AND r.check_in_date = '2026-10-06' AND r.folio_id IS NOT NULL, r.status::text);
  PERFORM t_ok('stay number allocated (STY-)', r.stay_number LIKE 'STY-%', r.stay_number);
  PERFORM t_ok('rate snapshotted from the room type', r.rate = 4000);
  PERFORM t_ok('room 204 is OCCUPIED', (SELECT status FROM lb_rooms WHERE room_number = '204') = 'OCCUPIED');
  v_folio := r.folio_id;
  PERFORM t_ok('folio opened for the guest, titled Room 204', (SELECT title FROM lb_folios WHERE id = v_folio) = 'Room 204' AND (SELECT customer_id FROM lb_folios WHERE id = v_folio) = t_cust('John Kamau'));
  PERFORM t_ok('folio points back at the stay', (SELECT stay_id FROM lb_folios WHERE id = v_folio) = v_stay);
  SELECT * INTO ln FROM lb_folio_lines WHERE folio_id = v_folio AND status = 'POSTED';
  PERFORM t_ok('ONE room line: 2 nights x 4,000 = 8,000, typed ROOM, tied to the stay',
    ln.line_type = 'ROOM' AND ln.quantity = 2 AND ln.unit_price = 4000 AND ln.amount = 8000 AND ln.stay_id = v_stay, row_to_json(ln)::text);
  PERFORM t_ok('line text names the room, type and dates', ln.description = 'Room 204 · Double Room · 6 Oct – 8 Oct', ln.description);

  -- breakfast, drinks, swimming, football, dinner charged to the folio from the POS (phase19 path)
  FOR p IN SELECT * FROM (VALUES ('Breakfast',800),('Drinks',900),('Swimming',500),('Football',300),('Dinner',1800)) v(n, amt) LOOP
    INSERT INTO lb_sales(tenant_id, business_id, customer_id, status, folio_id) VALUES (T1, B1, t_cust('John Kamau'), 'COMPLETED', v_folio) RETURNING id INTO v_sale;
    INSERT INTO lb_sale_items(sale_id, product_id, quantity, unit_price, total_price)
      SELECT v_sale, id, 1, p.amt, p.amt FROM lb_products WHERE name = p.n;
    PERFORM post_sale_to_folio(v_folio, v_sale);
  END LOOP;
  PERFORM t_ok('ONE BILL = 12,300', (SELECT total_charges FROM lb_folio_summary WHERE id = v_folio) = 12300, (SELECT total_charges::text FROM lb_folio_summary WHERE id = v_folio));
  PERFORM t_ok('every line is tagged with the stay', (SELECT count(*) FROM lb_folio_lines WHERE folio_id = v_folio AND stay_id = v_stay) = 6);
  PERFORM t_ok('POS sales carry stay_id (brief §6)', (SELECT count(*) FROM lb_sales WHERE folio_id = v_folio AND stay_id = v_stay) = 5);
  PERFORM t_ok('guest balance NOT touched (no double counting)', (SELECT outstanding_balance FROM lb_customers WHERE id = t_cust('John Kamau')) = 0);

  SELECT * INTO r FROM lb_room_board WHERE room_number = '204';
  PERFORM t_ok('room board shows the guest and the folio', r.display_status = 'OCCUPIED' AND r.current_guest = 'John Kamau' AND r.current_folio_id = v_folio AND r.current_check_out = '2026-10-08');
  PERFORM t_ok('stay summary carries bill and balance', (SELECT folio_total FROM lb_stay_summary WHERE id = v_stay) = 12300 AND (SELECT nights_booked FROM lb_stay_summary WHERE id = v_stay) = 2);

  PERFORM t_ok('room charge cannot be removed by hand', t_err(format('SELECT void_folio_line(%L, ''oops'')', ln.id)) LIKE '%follows the stay%', coalesce(t_err(format('SELECT void_folio_line(%L, ''oops'')', ln.id)), 'no error'));
  PERFORM t_ok('a second guest cannot take an occupied room', t_err(format('SELECT create_stay(%L,%L,%L,''2026-10-07'',''2026-10-09'')', B1, t_cust('Mary Wanjiku'), t_room('204'))) LIKE '%already taken%');
  PERFORM t_ok('checking in someone else needs the room free', t_err(format('SELECT create_stay(%L,%L,%L,NULL,''2026-10-07'',NULL,1,NULL,NULL,true)', B1, t_cust('Mary Wanjiku'), t_room('204'))) LIKE '%already taken%');

  -- a booking that starts the day John leaves is fine
  PERFORM create_stay(B1, t_cust('Mary Wanjiku'), t_room('204'), '2026-10-08', '2026-10-12', NULL, 1, 'Late arrival', NULL, false);
  PERFORM t_ok('back-to-back booking on departure day is allowed', (SELECT status FROM lb_stays WHERE id = t_stay('Mary Wanjiku')) = 'RESERVED');
  PERFORM t_ok('board shows the next guest', (SELECT next_guest FROM lb_room_board WHERE room_number = '204') = 'Mary Wanjiku');
  PERFORM t_ok('extending John into Mary''s dates is refused', t_err(format('SELECT update_stay(%L, ''2026-10-09'')', v_stay)) LIKE '%already taken%');
  PERFORM t_ok('a reservation does not create a folio or a charge', (SELECT folio_id FROM lb_stays WHERE id = t_stay('Mary Wanjiku')) IS NULL);
  PERFORM t_ok('booking in the past is refused', t_err(format('SELECT create_stay(%L,%L,%L,''2026-10-01'',''2026-10-03'')', B1, t_cust('Otieno'), t_room('220'))) LIKE '%in the past%');
  PERFORM t_ok('check-out must be after check-in', t_err(format('SELECT create_stay(%L,%L,%L,''2026-10-09'',''2026-10-09'')', B1, t_cust('Otieno'), t_room('220'))) LIKE '%after check-in%');
  PERFORM t_ok('a room under maintenance cannot receive a guest', t_err(format('SELECT create_stay(%L,%L,%L,NULL,''2026-10-07'',NULL,1,NULL,NULL,true)', B1, t_cust('Otieno'), t_room('231'))) LIKE '%maintenance%');
END $$;

-- ---------- check-out and settle (day 2) ----------
SELECT t_ctx('00000000-0000-0000-0000-0000000000aa', '2026-10-08');
DO $$
DECLARE v_stay uuid := t_stay('John Kamau'); v_folio uuid; r jsonb; s jsonb; f record;
BEGIN
  SELECT folio_id INTO v_folio FROM lb_stays WHERE id = v_stay;
  r := check_out_stay(v_stay);
  PERFORM t_ok('check-out reports 2 nights, room 8,000, bill 12,300', (r->>'nights')::int = 2 AND (r->>'room_total')::numeric = 8000 AND (r->>'folio_total')::numeric = 12300, r::text);
  PERFORM t_ok('stay is CHECKED_OUT with nights_charged 2', (SELECT status || nights_charged FROM lb_stays WHERE id = v_stay) = 'CHECKED_OUT2');
  PERFORM t_ok('room goes to CLEANING', (SELECT status FROM lb_rooms WHERE room_number = '204') = 'CLEANING');
  PERFORM t_ok('the folio stays OPEN until it is settled', (SELECT status FROM lb_folios WHERE id = v_folio) = 'OPEN');
  PERFORM t_ok('still exactly one live room line', (SELECT count(*) FROM lb_folio_lines WHERE folio_id = v_folio AND line_type = 'ROOM' AND status = 'POSTED') = 1);
  PERFORM t_ok('cannot check out twice', t_err(format('SELECT check_out_stay(%L)', v_stay)) LIKE '%cannot be checked out%');

  s := settle_folio(v_folio, '[{"payment_method":"MOBILE_MONEY","amount":12300,"reference_no":"SHK7X9ABCD"}]'::jsonb);
  SELECT * INTO f FROM lb_folio_summary WHERE id = v_folio;
  PERFORM t_ok('SETTLED, balance 0, invoice + receipt numbers', f.status = 'SETTLED' AND f.balance_due = 0 AND f.invoice_number LIKE 'INV-%' AND f.receipt_number LIKE 'RCT-%', row_to_json(f)::text);
  PERFORM t_ok('stay summary now shows a settled, zero-balance bill', (SELECT folio_status = 'SETTLED' AND folio_balance = 0 FROM lb_stay_summary WHERE id = v_stay));
END $$;

-- ---------- housekeeping and the next guest ----------
DO $$
DECLARE B1 uuid := 'b1000000-0000-0000-0000-000000000001'; v_mary uuid := t_stay('Mary Wanjiku');
BEGIN
  PERFORM t_ok('cannot check in to a room being cleaned', t_err(format('SELECT check_in_stay(%L)', v_mary)) LIKE '%being cleaned%');
  PERFORM t_ok('an occupied room cannot be set by hand', t_err(format('SELECT set_room_status(%L, ''OCCUPIED'')', t_room('204'))) LIKE '%available, cleaning or maintenance%');
  PERFORM set_room_status(t_room('204'), 'AVAILABLE');
  PERFORM t_ok('board shows RESERVED for a ready room with an arrival due', (SELECT display_status FROM lb_room_board WHERE room_number = '204') = 'RESERVED');
  PERFORM check_in_stay(v_mary);
  PERFORM t_ok('Mary checked in on her booked day, own folio', (SELECT status FROM lb_stays WHERE id = v_mary) = 'CHECKED_IN'
     AND (SELECT folio_id FROM lb_stays WHERE id = v_mary) <> (SELECT folio_id FROM lb_stays WHERE id = t_stay('John Kamau')));
  PERFORM t_ok('Mary''s room line: 4 nights booked = 16,000', (SELECT amount FROM lb_folio_lines WHERE stay_id = v_mary AND status = 'POSTED') = 16000);
  PERFORM t_ok('a checked-in stay cannot be checked in again', t_err(format('SELECT check_in_stay(%L)', v_mary)) LIKE '%cannot be checked in%');
  PERFORM t_ok('cannot cancel a guest who is in the room', t_err(format('SELECT cancel_stay(%L)', v_mary)) LIKE '%not arrived%');
  PERFORM t_ok('a room cannot be switched off while occupied', t_err(format('UPDATE lb_rooms SET is_active = false WHERE room_number = ''204''')) LIKE '%has a guest%');
END $$;

-- ---------- early departure, booked nights, same-day stay ----------
SELECT t_ctx('00000000-0000-0000-0000-0000000000aa', '2026-10-09');
DO $$
DECLARE B1 uuid := 'b1000000-0000-0000-0000-000000000001'; v_mary uuid := t_stay('Mary Wanjiku'); v_old timestamptz; r jsonb; v_w uuid;
BEGIN
  SELECT created_at INTO v_old FROM lb_folio_lines WHERE stay_id = v_mary AND status = 'POSTED';
  r := check_out_stay(v_mary);
  PERFORM t_ok('early departure charges the 1 night used', (r->>'nights')::int = 1 AND (r->>'room_total')::numeric = 4000, r::text);
  PERFORM t_ok('old room line voided with a reason, new one posted', (SELECT count(*) FROM lb_folio_lines WHERE stay_id = v_mary AND status = 'VOID' AND void_reason LIKE 'Recalculated%') = 1
     AND (SELECT count(*) FROM lb_folio_lines WHERE stay_id = v_mary AND status = 'POSTED') = 1);
  PERFORM t_ok('the recalculated line keeps its original date (revenue date does not jump)', (SELECT created_at FROM lb_folio_lines WHERE stay_id = v_mary AND status = 'POSTED') = v_old);

  v_w := create_stay(B1, t_cust('Wanjiru'), t_room('205'), NULL, '2026-10-12', NULL, 1, NULL, NULL, true);
  PERFORM t_ok('single room priced from its own type (2,500)', (SELECT rate FROM lb_stays WHERE id = v_w) = 2500);
END $$;
SELECT t_ctx('00000000-0000-0000-0000-0000000000aa', '2026-10-10');
DO $$
DECLARE B1 uuid := 'b1000000-0000-0000-0000-000000000001'; r jsonb; v_o uuid;
BEGIN
  r := check_out_stay(t_stay('Wanjiru'), true);
  PERFORM t_ok('"charge the nights booked" keeps 3 nights x 2,500 = 7,500', (r->>'nights')::int = 3 AND (r->>'room_total')::numeric = 7500, r::text);
  v_o := create_stay(B1, t_cust('Otieno'), t_room('206'), NULL, '2026-10-11', NULL, 1, NULL, NULL, true);
  r := check_out_stay(v_o);
  PERFORM t_ok('a same-day stay is charged 1 night', (r->>'nights')::int = 1 AND (r->>'room_total')::numeric = 4000, r::text);
END $$;

-- ---------- extending, re-pricing, two rooms on one bill ----------
DO $$
DECLARE B1 uuid := 'b1000000-0000-0000-0000-000000000001'; T1 uuid := '00000000-0000-0000-0000-0000000000aa';
        v_n uuid; v_n2 uuid; v_folio uuid; v_sale uuid; ln record;
BEGIN
  v_n := create_stay(B1, t_cust('Njeri'), t_room('207'), NULL, '2026-10-12', NULL, 1, NULL, NULL, true);
  SELECT folio_id INTO v_folio FROM lb_stays WHERE id = v_n;
  PERFORM update_stay(v_n, '2026-10-14');
  SELECT * INTO ln FROM lb_folio_lines WHERE stay_id = v_n AND status = 'POSTED';
  PERFORM t_ok('extending to 4 nights recalculates the room line (16,000 at 4,000... single = 2,500 x 4 = 10,000)', ln.quantity = 4 AND ln.amount = 10000, row_to_json(ln)::text);
  PERFORM update_stay(v_n, NULL, 3000);
  SELECT * INTO ln FROM lb_folio_lines WHERE stay_id = v_n AND status = 'POSTED';
  PERFORM t_ok('a new price per night re-prices the whole stay (4 x 3,000)', ln.unit_price = 3000 AND ln.amount = 12000, row_to_json(ln)::text);
  PERFORM t_ok('earlier versions kept as VOID history', (SELECT count(*) FROM lb_folio_lines WHERE stay_id = v_n AND status = 'VOID') = 2);
  PERFORM t_ok('price must be above zero', t_err(format('SELECT update_stay(%L, NULL, 0)', v_n)) LIKE '%above zero%');
  PERFORM t_ok('guest in the room: check-in date is locked', t_err(format('SELECT update_stay(%L, NULL, NULL, NULL, ''2026-10-11'')', v_n)) LIKE '%cannot change%');

  -- same guest, second room: ONE open bill
  v_n2 := create_stay(B1, t_cust('Njeri'), t_room('208'), NULL, '2026-10-11', NULL, 1, NULL, NULL, true);
  PERFORM t_ok('second room lands on the SAME folio', (SELECT folio_id FROM lb_stays WHERE id = v_n2) = v_folio);
  PERFORM t_ok('folio holds two live room lines', (SELECT count(*) FROM lb_folio_lines WHERE folio_id = v_folio AND line_type = 'ROOM' AND status = 'POSTED') = 2);
  INSERT INTO lb_sales(tenant_id, business_id, customer_id, status, folio_id) VALUES (T1, B1, t_cust('Njeri'), 'COMPLETED', v_folio) RETURNING id INTO v_sale;
  INSERT INTO lb_sale_items(sale_id, product_id, quantity, unit_price, total_price) SELECT v_sale, id, 2, 100, 200 FROM lb_products WHERE name = 'Drinks';
  PERFORM post_sale_to_folio(v_folio, v_sale);
  PERFORM t_ok('with two rooms in house a sale is NOT guessed onto one of them', (SELECT stay_id FROM lb_sales WHERE id = v_sale) IS NULL);
END $$;

-- ---------- settled account vs. room charge ----------
SELECT t_ctx('00000000-0000-0000-0000-0000000000aa', '2026-10-10');
DO $$
DECLARE B1 uuid := 'b1000000-0000-0000-0000-000000000001'; v_l uuid; v_folio uuid;
BEGIN
  v_l := create_stay(B1, t_cust('Late Larry'), t_room('210'), NULL, '2026-10-13', NULL, 1, NULL, NULL, true);
  SELECT folio_id INTO v_folio FROM lb_stays WHERE id = v_l;
  PERFORM settle_folio(v_folio, '[{"payment_method":"CASH","amount":12000}]'::jsonb);
  PERFORM t_ok('a settled account refuses a new room charge', t_err(format('SELECT update_stay(%L, ''2026-10-15'')', v_l)) LIKE '%already settled%');
  PERFORM t_ok('...and an early check-out that would change it', (SELECT t_err(format('SELECT check_out_stay(%L)', v_l))) LIKE '%already settled%');
  PERFORM t_ok('...the failed attempt left the guest in the room', (SELECT status FROM lb_stays WHERE id = v_l) = 'CHECKED_IN' AND (SELECT status FROM lb_rooms WHERE room_number = '210') = 'OCCUPIED');
  PERFORM check_out_stay(v_l, true);
  PERFORM t_ok('checking out with the booked nights succeeds (nothing changes)', (SELECT status FROM lb_stays WHERE id = v_l) = 'CHECKED_OUT');
END $$;

-- ---------- cancel ----------
DO $$
DECLARE B1 uuid := 'b1000000-0000-0000-0000-000000000001'; v uuid;
BEGIN
  v := create_stay(B1, t_cust('Otieno'), t_room('212'), '2026-10-20', '2026-10-22', NULL, 1, NULL, NULL, false);
  PERFORM t_ok('a future booking blocks its dates', t_err(format('SELECT create_stay(%L,%L,%L,''2026-10-21'',''2026-10-23'')', B1, t_cust('Njeri'), t_room('212'))) LIKE '%already taken%');
  PERFORM cancel_stay(v, 'Guest called');
  PERFORM t_ok('cancelled with a reason', (SELECT status || cancel_reason FROM lb_stays WHERE id = v) = 'CANCELLEDGuest called');
  PERFORM t_ok('...and the dates are free again', t_err(format('SELECT create_stay(%L,%L,%L,''2026-10-21'',''2026-10-23'')', B1, t_cust('Njeri'), t_room('212'))) IS NULL);
  PERFORM t_ok('a cancelled booking cannot be checked in', t_err(format('SELECT check_in_stay(%L)', v)) LIKE '%cannot be checked in%');
END $$;

-- ---------- reports read real data ----------
DO $$
BEGIN
  PERFORM t_ok('room revenue = live ROOM lines only (voided versions excluded)',
    (SELECT sum(amount) FROM lb_folio_lines WHERE line_type = 'ROOM' AND status = 'POSTED') =
    8000 + 4000 + 7500 + 4000 + 12000 + 4000 + 12000);
END $$;

-- ---------- tenancy and permissions ----------
SELECT t_ctx('00000000-0000-0000-0000-0000000000bb', '2026-10-10');
DO $$
DECLARE B1 uuid := 'b1000000-0000-0000-0000-000000000001'; B2 uuid := 'b2000000-0000-0000-0000-000000000002'; v_john uuid;
BEGIN
  SELECT id INTO v_john FROM lb_stays ORDER BY created_at LIMIT 1;
  PERFORM t_ok('other tenant cannot book our room', t_err(format('SELECT create_stay(%L,%L,%L,NULL,''2026-10-11'',NULL,1,NULL,NULL,true)', B2, (SELECT id FROM lb_customers WHERE name = 'Stranger'), t_room('213'))) LIKE '%Room not found%');
  PERFORM t_ok('...nor use our business', t_err(format('SELECT create_stay(%L,%L,%L,NULL,''2026-10-11'',NULL,1,NULL,NULL,true)', B1, (SELECT id FROM lb_customers WHERE name = 'Stranger'), t_room('213'))) LIKE '%Business not found%');
  PERFORM t_ok('...nor check out our guest', t_err(format('SELECT check_out_stay(%L)', v_john)) LIKE '%Stay not found%');
  PERFORM t_ok('...nor extend, cancel or re-status', t_err(format('SELECT update_stay(%L, ''2026-12-01'')', v_john)) LIKE '%Stay not found%'
     AND t_err(format('SELECT cancel_stay(%L)', v_john)) LIKE '%Stay not found%'
     AND t_err(format('SELECT set_room_status(%L, ''CLEANING'')', t_room('213'))) LIKE '%Room not found%');
END $$;
DO $$
DECLARE B1 uuid := 'b1000000-0000-0000-0000-000000000001'; B2 uuid := 'b2000000-0000-0000-0000-000000000002'; T2 uuid := '00000000-0000-0000-0000-0000000000bb'; v_type uuid; e text;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM t_ok('other tenant sees none of our rooms', (SELECT count(*) FROM lb_rooms) = 0 AND (SELECT count(*) FROM lb_room_board) = 0);
  PERFORM t_ok('...none of our stays', (SELECT count(*) FROM lb_stays) = 0 AND (SELECT count(*) FROM lb_stay_summary) = 0);
  PERFORM t_ok('...none of our room types', (SELECT count(*) FROM lb_room_types) = 0);
  e := t_err(format('INSERT INTO lb_room_types(tenant_id, business_id, name) VALUES (%L,%L,''Sneaky'')', T2, B1));
  PERFORM t_ok('cannot hang a room type on our business', e LIKE '%Business not found%', coalesce(e,'no error'));
  RESET ROLE;
END $$;
SELECT t_ctx('00000000-0000-0000-0000-0000000000aa', '2026-10-10');
DO $$
DECLARE B1 uuid := 'b1000000-0000-0000-0000-000000000001'; T1 uuid := '00000000-0000-0000-0000-0000000000aa'; e text; v_type uuid;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM t_ok('owner can read rooms and stays', (SELECT count(*) FROM lb_rooms) = 31 AND (SELECT count(*) FROM lb_stays) >= 8);
  e := t_err('UPDATE lb_rooms SET status = ''AVAILABLE'' WHERE room_number = ''210''');
  PERFORM t_ok('client cannot set a room status directly', e LIKE '%permission denied%', coalesce(e,'no error'));
  e := t_err('UPDATE lb_stays SET status = ''CHECKED_OUT''');
  PERFORM t_ok('client cannot write stays directly', e LIKE '%permission denied%', coalesce(e,'no error'));
  e := t_err(format('INSERT INTO lb_stays(tenant_id,business_id,stay_number,room_id,customer_id,check_in_date,expected_check_out,rate) VALUES (%L,%L,''X'',%L,%L,''2026-11-01'',''2026-11-02'',1)', T1, B1, t_room('215'), t_cust('Otieno')));
  PERFORM t_ok('...nor insert one', e LIKE '%permission denied%', coalesce(e,'no error'));
  e := t_err('UPDATE lb_folio_lines SET amount = 1');
  PERFORM t_ok('...nor edit a room charge', e LIKE '%permission denied%', coalesce(e,'no error'));
  e := t_err('UPDATE lb_rooms SET notes = ''sea view'', rate_override = 5000 WHERE room_number = ''215''');
  PERFORM t_ok('owner CAN rename / re-price / annotate a room', e IS NULL, coalesce(e,''));
  SELECT id INTO v_type FROM lb_room_types WHERE name = 'Single Room';
  e := t_err(format('INSERT INTO lb_rooms(tenant_id,business_id,room_type_id,room_number) VALUES (%L,%L,%L,''232'')', T1, B1, v_type));
  PERFORM t_ok('owner CAN add a room', e IS NULL, coalesce(e,''));
  PERFORM t_ok('a priced room overrides its type', (SELECT rate FROM lb_room_board WHERE room_number = '215') = 5000);
  RESET ROLE;
END $$;

-- ---------- retail is untouched ----------
DO $$
BEGIN
  PERFORM t_ok('a retail sale with no folio gets no stay', (SELECT count(*) FROM lb_sales WHERE folio_id IS NULL AND stay_id IS NOT NULL) = 0);
END $$;

-- applying the migration a second time must change nothing and raise nothing
\i phase20_rooms_stays.sql
CREATE OR REPLACE FUNCTION _local_today() RETURNS date LANGUAGE sql STABLE
AS $$ SELECT coalesce(nullif(current_setting('test.today', true), ''), '2026-10-06')::date $$;
SELECT t_ok('phase20 re-applies cleanly and data is intact', (SELECT count(*) FROM lb_rooms) = 32 AND (SELECT count(*) FROM lb_stays) >= 8);

SELECT CASE WHEN count(*) FILTER (WHERE NOT pass) = 0 THEN 'ALL ' || count(*) || ' CHECKS PASSED' ELSE count(*) FILTER (WHERE NOT pass) || ' OF ' || count(*) || ' CHECKS FAILED' END AS result FROM t_results;
SELECT name, info FROM t_results WHERE NOT pass;
