-- Scenarios for phases 42 (product classes + class reports), 43 (M-Pesa received payments) and 44 (budgets).
-- Scratch database ONLY. Run through phase42_44_run.sh. Every line prints PASS or FAIL; the last line is the total.
\set ON_ERROR_STOP off
SET client_min_messages = notice;

CREATE TABLE results (name text, ok boolean);
CREATE TABLE ctx (k text PRIMARY KEY, v uuid);
GRANT ALL ON results, ctx TO PUBLIC;
CREATE TABLE keep_t (k text PRIMARY KEY, r jsonb); GRANT ALL ON keep_t TO PUBLIC;
CREATE FUNCTION keep(p text, j jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO keep_t VALUES (p, j) ON CONFLICT (k) DO UPDATE SET r = EXCLUDED.r $$;
CREATE FUNCTION got(p text) RETURNS jsonb LANGUAGE sql AS $$ SELECT r FROM keep_t WHERE k = p $$;
CREATE FUNCTION kid(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ctx WHERE k = p $$;
CREATE FUNCTION put(p text, u uuid) RETURNS uuid LANGUAGE sql AS $$ INSERT INTO ctx VALUES (p, u) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v RETURNING v $$;
CREATE FUNCTION t(n text, ok boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  INSERT INTO results VALUES (n, coalesce(ok, false)); RAISE NOTICE '% %', CASE WHEN coalesce(ok, false) THEN 'PASS' ELSE 'FAIL' END, n; END $$;
-- runs q; passes only if it raises, and (when pat is given) the message contains pat or the SQLSTATE equals pat
CREATE FUNCTION must_fail(n text, q text, pat text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE q; PERFORM t(n || ' (was NOT refused)', false);
  EXCEPTION WHEN others THEN PERFORM t(n, pat IS NULL OR SQLERRM ILIKE '%' || pat || '%' OR SQLSTATE = pat); END; END $$;
CREATE FUNCTION as_role(r text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('test.pos', CASE WHEN r = 'owner' THEN 'off' ELSE 'on' END, false);
  PERFORM set_config('test.perms', CASE r
    WHEN 'owner' THEN ''
    WHEN 'manager' THEN 'sales.view,sales.create,products.manage,inventory.view,finance.view,balances.view,expenses.record,payments.record,payments.approve,reports.export,audit.view,operations.use'
    WHEN 'cashier' THEN 'sales.create,refunds.request,inventory.scan,payments.record,operations.use'
    WHEN 'accountant' THEN 'sales.view,inventory.view,finance.view,balances.view,expenses.record,payments.record,reports.export'
    WHEN 'storekeeper' THEN 'inventory.view,inventory.scan,inventory.receive,inventory.adjust,inventory.stocktake,inventory.transfer,purchases.create'
    ELSE '' END, false);
END $$;
CREATE FUNCTION as_tenant(x text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.tenant', CASE x WHEN 'A' THEN '00000000-0000-0000-0000-0000000000a1' ELSE '00000000-0000-0000-0000-0000000000b2' END, false) $$;
CREATE FUNCTION sale(p_when timestamptz, p_status text, p_cust uuid DEFAULT NULL, p_folio uuid DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO lb_sales (tenant_id, business_id, customer_id, folio_id, status, created_at) VALUES (get_current_tenant_id(), kid('BA'), p_cust, p_folio, p_status, p_when) RETURNING id $$;
CREATE FUNCTION line(p_sale uuid, p_prod text, p_qty numeric) RETURNS void LANGUAGE sql AS $$
  INSERT INTO lb_sale_items (tenant_id, sale_id, product_id, quantity, unit_price, cost_price, total_price)
  SELECT get_current_tenant_id(), p_sale, p.id, p_qty, p.selling_price, p.cost_price, p_qty * p.selling_price FROM lb_products p WHERE p.name = p_prod AND p.tenant_id = get_current_tenant_id() $$;

-- ===================================================================== world
SELECT as_role('owner'), as_tenant('A');
INSERT INTO lb_businesses (id, tenant_id, name) VALUES ('00000000-0000-0000-0000-00000000ba01', '00000000-0000-0000-0000-0000000000a1', 'Acacia Lodge'),
                                                      ('00000000-0000-0000-0000-00000000bb02', '00000000-0000-0000-0000-0000000000b2', 'Other Tenant Shop');
SELECT put('BA', '00000000-0000-0000-0000-00000000ba01'), put('BB', '00000000-0000-0000-0000-00000000bb02');
INSERT INTO lb_product_categories (tenant_id, name) SELECT '00000000-0000-0000-0000-0000000000a1', n FROM unnest(ARRAY['Sodas','Beers','Mains','Activities','Other','Rooms']) n;
INSERT INTO lb_warehouses (id, business_id, is_default) VALUES ('00000000-0000-0000-0000-0000000000f1', kid('BA'), true);
INSERT INTO lb_products (tenant_id, business_id, name, category_id, cost_price, selling_price, reorder_level, track_inventory)
SELECT '00000000-0000-0000-0000-0000000000a1', kid('BA'), v.n, (SELECT id FROM lb_product_categories WHERE name = v.c AND tenant_id = '00000000-0000-0000-0000-0000000000a1'), v.cost, v.price, v.ro, v.tr
  FROM (VALUES ('Coke','Sodas',60,100,10,true), ('Tusker Lager','Beers',200,300,5,true), ('Nyama Choma','Mains',500,800,2,true),
               ('Horse Ride','Activities',0,1500,0,false), ('Misc item','Other',0,50,0,true), ('Deluxe Room','Rooms',0,5000,0,false),
               ('Pilsner Special','Beers',100,250,0,true)) v(n,c,cost,price,ro,tr);
INSERT INTO lb_products (tenant_id, business_id, name, cost_price, selling_price) VALUES ('00000000-0000-0000-0000-0000000000b2', kid('BB'), 'Other tenant item', 1, 2);

-- ===================================================================== PHASE 42
SELECT t('42.1 hospitality set creates 4 classes', seed_default_product_classes(kid('BA'), 'hospitality') = 4);
SELECT t('42.2 running it again creates none', seed_default_product_classes(kid('BA'), 'hospitality') = 0);
SELECT t('42.3 the four classes are Restaurant, Bar, Accommodation, Outdoor',
  (SELECT string_agg(kind, ',' ORDER BY sort_order) FROM lb_product_classes WHERE business_id = kid('BA')) = 'RESTAURANT,BAR,ACCOMMODATION,OUTDOOR');
SELECT put('K_REST', (SELECT id FROM lb_product_classes WHERE kind = 'RESTAURANT' AND business_id = kid('BA')));
SELECT put('K_BAR',  (SELECT id FROM lb_product_classes WHERE kind = 'BAR' AND business_id = kid('BA')));
SELECT put('K_ACC',  (SELECT id FROM lb_product_classes WHERE kind = 'ACCOMMODATION' AND business_id = kid('BA')));
SELECT put('K_OUT',  (SELECT id FROM lb_product_classes WHERE kind = 'OUTDOOR' AND business_id = kid('BA')));
SELECT must_fail('42.4 a class name is unique per business, ignoring capitals', format('INSERT INTO lb_product_classes (tenant_id, business_id, name, kind) VALUES (%L, %L, %L, %L)', '00000000-0000-0000-0000-0000000000a1', kid('BA'), '  lounge & bar ', 'BAR'), 'uq_lb_product_classes_name');
SELECT must_fail('42.5 a business of another tenant cannot be seeded', format('SELECT seed_default_product_classes(%L)', kid('BB')), 'Business not found');
SELECT as_role('cashier');
SELECT must_fail('42.6 a cashier cannot seed classes', format('SELECT seed_default_product_classes(%L)', kid('BA')), '42501');
SELECT must_fail('42.7 a cashier cannot rename a class', format('UPDATE lb_product_classes SET name = %L WHERE id = %L', 'x', kid('K_BAR')), '42501');
SELECT as_role('manager');
INSERT INTO lb_product_classes (tenant_id, business_id, name, kind) VALUES ('00000000-0000-0000-0000-0000000000a1', kid('BA'), 'Gift Shop', 'RETAIL');
SELECT t('42.8 a manager (products.manage) can add a class', (SELECT count(*) = 1 FROM (SELECT 1 FROM lb_product_classes WHERE name = 'Gift Shop') z));

-- a person's own choice is never overwritten
UPDATE lb_products SET class_id = kid('K_REST') WHERE name = 'Pilsner Special';
SELECT t('42.9 preview suggests classes and changes nothing',
  (SELECT count(*) FROM pos_auto_assign_product_classes(kid('BA'), false)) >= 5 AND (SELECT count(*) FROM lb_products WHERE class_id IS NOT NULL AND tenant_id = get_current_tenant_id()) = 1);
SELECT t('42.10 Tusker goes to the Bar, Coke to the Restaurant, Horse Ride to Outdoor, Room to Accommodation',
  (SELECT bool_and(suggested_class_id = CASE product_name WHEN 'Tusker Lager' THEN kid('K_BAR') WHEN 'Coke' THEN kid('K_REST') WHEN 'Nyama Choma' THEN kid('K_REST')
                   WHEN 'Horse Ride' THEN kid('K_OUT') WHEN 'Deluxe Room' THEN kid('K_ACC') END)
     FROM pos_auto_assign_product_classes(kid('BA'), false) WHERE product_name IN ('Tusker Lager','Coke','Nyama Choma','Horse Ride','Deluxe Room')));
SELECT t('42.11 an item with no clue (Misc item) is left out of the suggestions', NOT EXISTS (SELECT 1 FROM pos_auto_assign_product_classes(kid('BA'), false) WHERE product_name = 'Misc item'));
SELECT t('42.12 an item that already has a class (Pilsner Special) is never suggested', NOT EXISTS (SELECT 1 FROM pos_auto_assign_product_classes(kid('BA'), false) WHERE product_name = 'Pilsner Special'));
SELECT t('42.13 apply writes the classes', (SELECT count(*) FROM pos_auto_assign_product_classes(kid('BA'), true) WHERE applied) = 5);
SELECT t('42.14 apply left the manual choice and the unclear item alone',
  (SELECT class_id FROM lb_products WHERE name = 'Pilsner Special') = kid('K_REST') AND (SELECT class_id FROM lb_products WHERE name = 'Misc item') IS NULL);
SELECT t('42.15 applying again changes nothing', (SELECT count(*) FROM pos_auto_assign_product_classes(kid('BA'), true)) = 0);
SELECT keep('m', to_jsonb(pos_assign_class_to_category(kid('BA'), (SELECT id FROM lb_product_categories WHERE name = 'Beers'), kid('K_BAR'))));
SELECT t('42.16 bulk: a whole category can be moved into a class',
  got('m')::text = '2'
  AND (SELECT class_id FROM lb_products WHERE name = 'Pilsner Special') = kid('K_BAR'));
SELECT must_fail('42.17 a class of another business cannot be used', format('SELECT pos_assign_class_to_category(%L, %L, %L)', kid('BA'), (SELECT id FROM lb_product_categories WHERE name = 'Beers'), gen_random_uuid()), 'does not belong');

-- sales (Nairobi days; amounts chosen so every figure can be checked by hand)
SELECT as_role('owner');
SELECT line(sale('2026-11-05 10:00+03', 'COMPLETED'), 'Coke', 4);
UPDATE lb_sale_items SET quantity = quantity WHERE false;
SELECT line((SELECT id FROM lb_sales ORDER BY created_at LIMIT 1), 'Tusker Lager', 2);
SELECT line(sale('2026-11-10 12:00+03', 'COMPLETED'), 'Nyama Choma', 3);
SELECT line((SELECT id FROM lb_sales WHERE created_at = '2026-11-10 12:00+03'), 'Horse Ride', 2);
SELECT line(sale('2026-11-10 13:00+03', 'VOIDED'), 'Tusker Lager', 10);             -- reversed sale: must not count
SELECT line(sale('2026-11-11 09:00+03', 'PARTIALLY_REFUNDED'), 'Misc item', 2);       -- counts, no class
SELECT line(sale('2026-11-30 21:30+00', 'COMPLETED'), 'Coke', 1);                     -- 00:30 on 1 Dec in Nairobi: NOT November
SELECT line(sale('2026-10-31 21:30+00', 'COMPLETED'), 'Coke', 1);                     -- 00:30 on 1 Nov in Nairobi: November
INSERT INTO lb_customers (id, tenant_id, business_id, name) VALUES ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000a1', kid('BA'), 'Room Guest');
SELECT put('GUEST', '00000000-0000-0000-0000-00000000c001');
SELECT put('F0', open_folio(kid('BA'), kid('GUEST'), 'Room 3'));
SELECT post_folio_line(kid('F0'), 'ROOM', 'Deluxe Room night', 2, 5000);
UPDATE lb_folio_lines SET created_at = '2026-11-12 09:00+03';
SELECT put('S7', sale('2026-11-12 19:00+03', 'COMPLETED', kid('GUEST'), kid('F0')));
SELECT line(kid('S7'), 'Coke', 2);
SELECT t('42.18 a till sale charged to a folio posts its lines to the folio', post_sale_to_folio(kid('F0'), kid('S7')) = 1);

SELECT as_role('accountant');
SELECT t('42.19 class totals: Restaurant 3100 (coke 500 + nyama 2400 + folio coke 200)', (SELECT revenue FROM pos_sales_by_class(kid('BA'), '2026-11-01', '2026-11-30') WHERE class_kind = 'RESTAURANT') = 3100);
SELECT t('42.20 Bar 600, Outdoor 3000; the VOIDED beer sale is left out',
  (SELECT revenue FROM pos_sales_by_class(kid('BA'), '2026-11-01', '2026-11-30') WHERE class_kind = 'BAR') = 600
  AND (SELECT revenue FROM pos_sales_by_class(kid('BA'), '2026-11-01', '2026-11-30') WHERE class_kind = 'OUTDOOR') = 3000);
SELECT t('42.21 Accommodation 10000 comes from the room line, counted once',
  (SELECT revenue FROM pos_sales_by_class(kid('BA'), '2026-11-01', '2026-11-30') WHERE class_kind = 'ACCOMMODATION') = 10000);
SELECT t('42.22 the folio-charged coke is NOT counted twice (5 + 2 = 7 units of Coke in the restaurant detail... 1 Oct-31 sale counted)',
  (SELECT units FROM pos_sales_by_class_detail(kid('BA'), '2026-11-01', '2026-11-30') WHERE product_name = 'Coke') = 7);
SELECT t('42.23 a sale with no class shows as "Not classified" (100), and sorts last',
  (SELECT revenue FROM pos_sales_by_class(kid('BA'), '2026-11-01', '2026-11-30') WHERE class_id IS NULL) = 100
  AND (SELECT class_name FROM pos_sales_by_class(kid('BA'), '2026-11-01', '2026-11-30') OFFSET 4 LIMIT 1) = 'Not classified');
SELECT t('42.24 Nairobi midnight: the 00:30 EAT sale lands in the right month',
  (SELECT units FROM pos_sales_by_class_detail(kid('BA'), '2026-12-01', '2026-12-01') WHERE product_name = 'Coke') = 1
  AND (SELECT count(*) FROM pos_sales_by_class_detail(kid('BA'), '2026-10-31', '2026-10-31')) = 0);
SELECT t('42.25 cost and gross profit: Restaurant cost = 7*60 + 3*500 = 1920', (SELECT cost FROM pos_sales_by_class(kid('BA'), '2026-11-01', '2026-11-30') WHERE class_kind = 'RESTAURANT') = 1920
  AND (SELECT gross_profit FROM pos_sales_by_class(kid('BA'), '2026-11-01', '2026-11-30') WHERE class_kind = 'RESTAURANT') = 3100 - 1920);
SELECT must_fail('42.26 a business of another tenant cannot be reported on', format('SELECT * FROM pos_sales_by_class(%L, %L, %L)', kid('BB'), '2026-11-01', '2026-11-30'), 'Business not found');
SELECT as_role('cashier');
SELECT must_fail('42.27 a cashier cannot read sales by class', format('SELECT * FROM pos_sales_by_class(%L, %L, %L)', kid('BA'), '2026-11-01', '2026-11-30'), '42501');
SELECT must_fail('42.28 a cashier cannot read the stock report', format('SELECT * FROM pos_stock_report(%L)', kid('BA')), '42501');

-- stock
SELECT as_role('owner');
INSERT INTO lb_inventory (product_id, warehouse_id, quantity, average_cost) SELECT id, '00000000-0000-0000-0000-0000000000f1', v.q, v.a FROM lb_products p JOIN (VALUES ('Coke',50,55),('Tusker Lager',3,0),('Nyama Choma',0,0),('Misc item',10,0),('Horse Ride',9,0)) v(n,q,a) ON v.n = p.name;
SELECT as_role('storekeeper');
SELECT t('42.29 stock: Coke 50 x average cost 55 = 2750 at cost, 5000 at retail',
  (SELECT value_at_cost FROM pos_stock_report(kid('BA')) WHERE product_name = 'Coke') = 2750 AND (SELECT value_at_retail FROM pos_stock_report(kid('BA')) WHERE product_name = 'Coke') = 5000);
SELECT t('42.30 stock: no average cost falls back to the cost price (Tusker 3 x 200 = 600)', (SELECT value_at_cost FROM pos_stock_report(kid('BA')) WHERE product_name = 'Tusker Lager') = 600);
SELECT t('42.31 stock states: Tusker LOW (3 <= 5), Nyama OUT (0), Coke OK',
  (SELECT stock_state FROM pos_stock_report(kid('BA')) WHERE product_name = 'Tusker Lager') = 'LOW'
  AND (SELECT stock_state FROM pos_stock_report(kid('BA')) WHERE product_name = 'Nyama Choma') = 'OUT'
  AND (SELECT stock_state FROM pos_stock_report(kid('BA')) WHERE product_name = 'Coke') = 'OK');
SELECT t('42.32 items that do not track stock (Horse Ride) and other tenants'' items are not listed',
  NOT EXISTS (SELECT 1 FROM pos_stock_report(kid('BA')) WHERE product_name IN ('Horse Ride', 'Other tenant item')));
SELECT t('42.33 stock rows carry class and category names', (SELECT class_name || '/' || category_name FROM pos_stock_report(kid('BA')) WHERE product_name = 'Tusker Lager') = 'Lounge & Bar/Beers');

-- ===================================================================== PHASE 43
SELECT as_role('owner'); SELECT as_tenant('A');
INSERT INTO lb_mpesa_config (tenant_id, business_id, shortcode, environment, is_active, c2b_enabled) VALUES ('00000000-0000-0000-0000-0000000000a1', kid('BA'), '174379', 'sandbox', true, true);
INSERT INTO lb_mpesa_secrets (tenant_id, business_id, c2b_token) VALUES ('00000000-0000-0000-0000-0000000000a1', kid('BA'), 'tok_0123456789abcdef0123456789abcdef');
CREATE FUNCTION pl(p_code text, p_amt text, p_first text, p_last text, p_ref text DEFAULT '', p_time text DEFAULT '20261104104212', p_short text DEFAULT '174379') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('TransactionType','Pay Bill','TransID',p_code,'TransTime',p_time,'TransAmount',p_amt,'BusinessShortCode',p_short,'BillRefNumber',p_ref,'InvoiceNumber','',
    'OrgAccountBalance','49197.00','ThirdPartyTransID','','MSISDN','2547 ****** 126','FirstName',p_first,'MiddleName','','LastName',p_last) $$;
CREATE FUNCTION rec(p jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT record_mpesa_c2b('tok_0123456789abcdef0123456789abcdef', p) $$;
CREATE FUNCTION c2b(p_code text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lb_mpesa_c2b_payments WHERE trans_id = upper(p_code) AND tenant_id = '00000000-0000-0000-0000-0000000000a1' $$;

-- customers and bills
INSERT INTO lb_customers (id, tenant_id, business_id, name, outstanding_balance) VALUES
 ('00000000-0000-0000-0000-00000000c101', '00000000-0000-0000-0000-0000000000a1', kid('BA'), 'Joy Wanjiku', 0),
 ('00000000-0000-0000-0000-00000000c102', '00000000-0000-0000-0000-0000000000a1', kid('BA'), 'Peter Otieno', 0),
 ('00000000-0000-0000-0000-00000000c103', '00000000-0000-0000-0000-0000000000a1', kid('BA'), 'Mary Njeri', 4000),
 ('00000000-0000-0000-0000-00000000c104', '00000000-0000-0000-0000-0000000000a1', kid('BA'), 'Zed Kamau', 1000),
 ('00000000-0000-0000-0000-00000000c105', '00000000-0000-0000-0000-0000000000a1', kid('BA'), 'Tenant Kariuki', 0);
SELECT put('JOY','00000000-0000-0000-0000-00000000c101'), put('PETER','00000000-0000-0000-0000-00000000c102'), put('MARY','00000000-0000-0000-0000-00000000c103'), put('ZED','00000000-0000-0000-0000-00000000c104'), put('KAR','00000000-0000-0000-0000-00000000c105');
SELECT put('F1', open_folio(kid('BA'), kid('JOY'), 'Table 4'));    SELECT post_folio_line(kid('F1'), 'OTHER', 'Lunch bill', 3, 1000);
SELECT put('F2', open_folio(kid('BA'), kid('PETER'), 'Table 7'));  SELECT post_folio_line(kid('F2'), 'OTHER', 'Dinner bill', 2, 1000);
INSERT INTO lb_rent_invoices (id, tenant_id, business_id, customer_id, invoice_number, status, total) VALUES
 ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000000a1', kid('BA'), kid('KAR'), 'INV-R1', 'ISSUED', 15000),
 ('00000000-0000-0000-0000-0000000a0002', '00000000-0000-0000-0000-0000000000a1', kid('BA'), kid('KAR'), 'INV-R2', 'ISSUED', 15000);

-- receiving
SELECT keep('r1', rec(pl('SHK7X9ABCD', '3000.00', 'JOY', 'WANJIKU', 'FOL-0002')));
SELECT t('43.1 Safaricom confirmation is stored in the inbox as NEW (Joy, KES 3000)',
  (got('r1') ->> 'status') = 'NEW'
  AND (SELECT payer_name || '/' || amount FROM lb_mpesa_c2b_payments WHERE trans_id = 'SHK7X9ABCD') = 'JOY WANJIKU/3000.00');
SELECT t('43.2 TransTime is read as Nairobi time (10:42:12 EAT = 07:42:12 UTC)', (SELECT trans_time FROM lb_mpesa_c2b_payments WHERE trans_id = 'SHK7X9ABCD') = '2026-11-04 07:42:12+00');
SELECT keep('r3', rec(pl('SHK7X9ABCD', '3000.00', 'JOY', 'WANJIKU', 'FOL-0002')));
SELECT t('43.3 Safaricom sending the same payment again returns the first, stores nothing new',
  (got('r3') ->> 'duplicate') = 'true' AND (SELECT count(*) FROM lb_mpesa_c2b_payments WHERE trans_id = 'SHK7X9ABCD') = 1);
SELECT t('43.4 a lower-case / spaced code is the same code', (rec(pl('shk7 x9abcd', '3000', 'JOY', 'WANJIKU')) ->> 'duplicate') = 'true');
SELECT must_fail('43.5 an unknown token is refused', format('SELECT record_mpesa_c2b(%L, %L::jsonb)', 'tok_ffffffffffffffffffffffffffffffff', pl('X1', '5', 'A', 'B')), 'Unknown');
SELECT must_fail('43.6 a short token is refused', format('SELECT record_mpesa_c2b(%L, %L::jsonb)', 'abc', pl('X1', '5', 'A', 'B')), 'Unknown');
SELECT must_fail('43.7 a different shortcode is refused', format('SELECT rec(%L::jsonb)', pl('X2', '5', 'A', 'B', '', '20261104104212', '999999')), 'does not match');
SELECT must_fail('43.8 zero amount is refused', format('SELECT rec(%L::jsonb)', pl('X3', '0', 'A', 'B')), 'valid amount');
SELECT must_fail('43.9 no code is refused', format('SELECT rec(%L::jsonb)', pl('', '100', 'A', 'B')), 'no M-Pesa code');
UPDATE lb_mpesa_config SET c2b_enabled = false;
SELECT must_fail('43.10 switched off = refused', format('SELECT rec(%L::jsonb)', pl('X4', '100', 'A', 'B')), 'switched off');
UPDATE lb_mpesa_config SET c2b_enabled = true;
INSERT INTO lb_payments (tenant_id, business_id, payment_method, amount, reference_no, status) VALUES ('00000000-0000-0000-0000-0000000000a1', kid('BA'), 'MOBILE_MONEY', 700, 'DUP1ABCDE1', 'COMPLETED');
SELECT keep('r11', rec(pl('DUP1ABCDE1', '700', 'A', 'B')));
SELECT t('43.11 a code already typed at the till arrives as USED (cannot pay a second bill)', (got('r11') ->> 'status') = 'USED' AND (SELECT note FROM lb_mpesa_c2b_payments WHERE trans_id = 'DUP1ABCDE1') ILIKE '%till sale%');

-- suggestions
SELECT as_role('cashier');
SELECT t('43.12 suggestion: Joy''s folio first (bill number + name + exact amount)',
  (SELECT target_id FROM pos_c2b_suggest(c2b('SHK7X9ABCD')) ORDER BY score DESC LIMIT 1) = kid('F1')
  AND (SELECT reasons FROM pos_c2b_suggest(c2b('SHK7X9ABCD')) ORDER BY score DESC LIMIT 1) ILIKE '%exact amount%'
  AND (SELECT reasons FROM pos_c2b_suggest(c2b('SHK7X9ABCD')) ORDER BY score DESC LIMIT 1) ILIKE '%name matches%');
SELECT t('43.13 bills that match nothing are not suggested (Mary 4000, Peter 2000)', NOT EXISTS (SELECT 1 FROM pos_c2b_suggest(c2b('SHK7X9ABCD')) WHERE target_id IN (kid('MARY'), kid('F2'))));
SELECT as_role('storekeeper');
SELECT must_fail('43.14 a storekeeper (no money permission) cannot see suggestions', format('SELECT * FROM pos_c2b_suggest(%L)', c2b('SHK7X9ABCD')), '42501');
SELECT must_fail('43.15 ...nor apply a payment', format('SELECT pos_apply_mpesa_c2b(%L, %L, %L)', c2b('SHK7X9ABCD'), 'FOLIO', kid('F1')), '42501');

-- clearing a bill
SELECT as_role('cashier');
SELECT put('R1', NULL);
SELECT keep('a16', pos_apply_mpesa_c2b(c2b('SHK7X9ABCD'), 'FOLIO', kid('F1'), NULL, '00000000-0000-0000-0000-0000000000e1'));
SELECT t('43.16 THE JOY CASE: apply KES 3000 to her folio -> folio is SETTLED, result says paid in full with invoice + receipt',
  (got('a16') ->> 'paid_in_full') = 'true' AND (got('a16') ->> 'status') = 'SETTLED' AND (got('a16') ->> 'invoice_number') IS NOT NULL AND (got('a16') ->> 'receipt_number') IS NOT NULL
  AND (SELECT status FROM lb_folios WHERE id = kid('F1')) = 'SETTLED');
SELECT t('43.17 the payment is recorded on the folio with the real M-Pesa code', (SELECT amount || '/' || payment_method || '/' || reference_no FROM lb_folio_payments WHERE folio_id = kid('F1')) = '3000.0000/MOBILE_MONEY/SHK7X9ABCD');
SELECT t('43.18 the inbox row is USED, fully, with one allocation naming who and what',
  (SELECT status || '/' || amount_used FROM lb_mpesa_c2b_payments WHERE trans_id = 'SHK7X9ABCD') = 'USED/3000.00'
  AND (SELECT count(*) FROM lb_mpesa_c2b_allocations WHERE c2b_id = c2b('SHK7X9ABCD') AND target_id = kid('F1') AND amount = 3000 AND applied_by = '00000000-0000-0000-0000-0000000000e1') = 1);
SELECT must_fail('43.19 the same payment cannot be used again', format('SELECT pos_apply_mpesa_c2b(%L, %L, %L)', c2b('SHK7X9ABCD'), 'CUSTOMER', kid('MARY')), 'already used');

-- part payment, split payment
SELECT as_role('owner');
SELECT rec(pl('PAR1ABCDE1', '1000', 'PETER', 'OTIENO'));
SELECT as_role('cashier');
SELECT keep('a20', pos_apply_mpesa_c2b(c2b('PAR1ABCDE1'), 'FOLIO', kid('F2')));
SELECT t('43.20 a part payment leaves the folio OPEN with the balance reduced (2000 - 1000)',
  (got('a20') ->> 'paid_in_full') = 'false' AND (got('a20') ->> 'balance_after')::numeric = 1000
  AND (SELECT status FROM lb_folios WHERE id = kid('F2')) = 'OPEN');
SELECT t('43.21 ...and that part payment did NOT mark the code as used elsewhere (it is USED only because all 1000 went to the bill)',
  (SELECT status || '/' || amount_used FROM lb_mpesa_c2b_payments WHERE trans_id = 'PAR1ABCDE1') = 'USED/1000.00');
SELECT as_role('owner'); SELECT rec(pl('OVR1ABCDE1', '5000', 'PETER', 'OTIENO')); SELECT as_role('cashier');
SELECT keep('a22', pos_apply_mpesa_c2b(c2b('OVR1ABCDE1'), 'FOLIO', kid('F2')));
SELECT t('43.22 a bigger payment pays the folio off (only the 1000 that was left) and keeps 4000 on the payment',
  (got('a22') ->> 'status') = 'SETTLED' AND (got('a22') ->> 'applied')::numeric = 1000 AND (got('a22') ->> 'left_on_payment')::numeric = 4000
  AND (SELECT status || '/' || amount_used FROM lb_mpesa_c2b_payments WHERE trans_id = 'OVR1ABCDE1') = 'PARTLY_USED/1000.00');
SELECT keep('a23', pos_apply_mpesa_c2b(c2b('OVR1ABCDE1'), 'CUSTOMER', kid('MARY')));
SELECT t('43.23 the rest (4000) clears Mary''s credit balance exactly',
  (got('a23') ->> 'paid_in_full') = 'true' AND (got('a23') ->> 'balance_after')::numeric = 0
  AND (SELECT outstanding_balance FROM lb_customers WHERE id = kid('MARY')) = 0
  AND (SELECT status || '/' || amount_used FROM lb_mpesa_c2b_payments WHERE trans_id = 'OVR1ABCDE1') = 'USED/5000.00');
SELECT t('43.24 the customer payment carries the M-Pesa code and the payer''s name', (SELECT reference_no || '|' || notes FROM lb_customer_payments WHERE customer_id = kid('MARY')) = 'OVR1ABCDE1|M-Pesa received payment OVR1ABCDE1 from PETER OTIENO');
SELECT t('43.25 one payment, two bills: two allocations that add up to the payment', (SELECT sum(amount) FROM lb_mpesa_c2b_allocations WHERE c2b_id = c2b('OVR1ABCDE1')) = 5000);

-- refusals
SELECT as_role('owner'); SELECT rec(pl('BIG1ABCDE1', '9000', 'ZED', 'KAMAU')); SELECT as_role('cashier');
SELECT must_fail('43.26 cannot take more than the bill (5000 on a 1000 credit)', format('SELECT pos_apply_mpesa_c2b(%L, %L, %L, 5000)', c2b('BIG1ABCDE1'), 'CUSTOMER', kid('ZED')), 'more than');
SELECT must_fail('43.27 cannot take more than the payment has (20000 of 9000)', format('SELECT pos_apply_mpesa_c2b(%L, %L, %L, 20000)', c2b('BIG1ABCDE1'), 'CUSTOMER', kid('ZED')), 'at most');
SELECT must_fail('43.28 a bill that is already paid cannot take more', format('SELECT pos_apply_mpesa_c2b(%L, %L, %L)', c2b('BIG1ABCDE1'), 'FOLIO', kid('F1')), 'already');
SELECT must_fail('43.29 an unknown bill type is refused', format('SELECT pos_apply_mpesa_c2b(%L, %L, %L)', c2b('BIG1ABCDE1'), 'BANANA', kid('ZED')), 'Unknown bill type');
SELECT t('43.30 nothing was written by the refused attempts', (SELECT status || '/' || amount_used FROM lb_mpesa_c2b_payments WHERE trans_id = 'BIG1ABCDE1') = 'NEW/0.00' AND (SELECT outstanding_balance FROM lb_customers WHERE id = kid('ZED')) = 1000);

-- rent invoices take the whole payment
SELECT as_role('owner'); SELECT rec(pl('RNT1ABCDE1', '15000', 'TENANT', 'KARIUKI')); SELECT rec(pl('RNT2ABCDE1', '20000', 'TENANT', 'KARIUKI')); SELECT as_role('cashier');
SELECT must_fail('43.31 a rent invoice will not take a part of an M-Pesa payment', format('SELECT pos_apply_mpesa_c2b(%L, %L, %L, 5000)', c2b('RNT1ABCDE1'), 'RENT_INVOICE', '00000000-0000-0000-0000-0000000a0001'), 'whole');
SELECT must_fail('43.32 ...nor a payment bigger than the invoice', format('SELECT pos_apply_mpesa_c2b(%L, %L, %L)', c2b('RNT2ABCDE1'), 'RENT_INVOICE', '00000000-0000-0000-0000-0000000a0002'), 'more than');
SELECT keep('a33', pos_apply_mpesa_c2b(c2b('RNT1ABCDE1'), 'RENT_INVOICE', '00000000-0000-0000-0000-0000000a0001'));
SELECT t('43.33 a whole 15000 payment clears the rent invoice', (got('a33') ->> 'paid_in_full') = 'true'
  AND (SELECT balance_due FROM lb_rent_invoice_summary WHERE invoice_number = 'INV-R1') = 0);

-- a code recorded by hand AFTER it arrived
SELECT as_role('owner'); SELECT rec(pl('MAN1ABCDE1', '500', 'A', 'B'));
INSERT INTO lb_payments (tenant_id, business_id, payment_method, amount, reference_no, status) VALUES ('00000000-0000-0000-0000-0000000000a1', kid('BA'), 'MOBILE_MONEY', 500, 'man1-abcde1', 'COMPLETED');
SELECT t('43.34 typing the code at the till afterwards marks the inbox row USED', (SELECT status || '/' || amount_used FROM lb_mpesa_c2b_payments WHERE trans_id = 'MAN1ABCDE1') = 'USED/500.00');
SELECT must_fail('43.35 ...so it can no longer clear a bill', format('SELECT pos_apply_mpesa_c2b(%L, %L, %L)', c2b('MAN1ABCDE1'), 'CUSTOMER', kid('ZED')), 'already used');
SELECT rec(pl('MAN2ABCDE1', '800', 'A', 'B'));
INSERT INTO lb_folio_payments (tenant_id, business_id, folio_id, payment_method, amount, reference_no) VALUES ('00000000-0000-0000-0000-0000000000a1', kid('BA'), kid('F1'), 'MOBILE_MONEY', 800, 'MAN2ABCDE1');
SELECT t('43.36 typing the code on a folio payment also marks it USED', (SELECT status FROM lb_mpesa_c2b_payments WHERE trans_id = 'MAN2ABCDE1') = 'USED');

-- set aside / bring back
SELECT as_role('owner'); SELECT rec(pl('IGN1ABCDE1', '250', 'A', 'B')); SELECT rec(pl('IGN2ABCDE1', '260', 'A', 'B'));
SELECT as_role('cashier');
SELECT must_fail('43.37 a cashier cannot set a payment aside', format('SELECT pos_ignore_mpesa_c2b(%L, %L)', c2b('IGN1ABCDE1'), 'not ours'), '42501');
SELECT as_role('accountant');
SELECT must_fail('43.38 an accountant (cannot approve payments) cannot either', format('SELECT pos_ignore_mpesa_c2b(%L, %L)', c2b('IGN1ABCDE1'), 'not ours'), '42501');
SELECT as_role('manager');
SELECT must_fail('43.39 a manager must give a reason', format('SELECT pos_ignore_mpesa_c2b(%L, %L)', c2b('IGN1ABCDE1'), '  '), 'why');
SELECT keep('i40', pos_ignore_mpesa_c2b(c2b('IGN1ABCDE1'), 'Paid to the wrong till, refund customer'));
SELECT t('43.40 a manager can set it aside with a reason', (got('i40') ->> 'ok') = 'true' AND (SELECT status FROM lb_mpesa_c2b_payments WHERE trans_id = 'IGN1ABCDE1') = 'IGNORED');
SELECT as_role('cashier');
SELECT must_fail('43.41 a set-aside payment cannot be used', format('SELECT pos_apply_mpesa_c2b(%L, %L, %L)', c2b('IGN1ABCDE1'), 'CUSTOMER', kid('ZED')), 'already ignored');
SELECT as_role('manager');
SELECT must_fail('43.42 a used payment cannot be set aside', format('SELECT pos_ignore_mpesa_c2b(%L, %L)', c2b('SHK7X9ABCD'), 'oops'), 'nobody has used');
SELECT keep('i43', pos_ignore_mpesa_c2b(c2b('IGN1ABCDE1'), NULL, false));
SELECT t('43.43 and it can be brought back', (got('i43') ->> 'ok') = 'true' AND (SELECT status FROM lb_mpesa_c2b_payments WHERE trans_id = 'IGN1ABCDE1') = 'NEW');

-- who can read the inbox directly; clients cannot write it
SELECT as_role('cashier');
SET ROLE authenticated;
SELECT t('43.44 a cashier can read the inbox', (SELECT count(*) FROM lb_mpesa_c2b_payments) > 5);
RESET ROLE; SELECT as_role('storekeeper'); SET ROLE authenticated;
SELECT t('43.45 a storekeeper reads nothing from the inbox (row security)', (SELECT count(*) FROM lb_mpesa_c2b_payments) = 0 AND (SELECT count(*) FROM lb_mpesa_c2b_allocations) = 0);
RESET ROLE; SELECT as_role('cashier'); SET ROLE authenticated;
SELECT must_fail('43.46 no client can insert into the inbox (a cashier cannot invent a payment)', format('INSERT INTO lb_mpesa_c2b_payments (tenant_id, business_id, trans_id, trans_time, amount) VALUES (%L, %L, %L, now(), 99999)', '00000000-0000-0000-0000-0000000000a1', kid('BA'), 'FAKE000001'), 'permission denied');
SELECT must_fail('43.47 ...nor change one', format('UPDATE lb_mpesa_c2b_payments SET amount_used = 0'), 'permission denied');
SELECT must_fail('43.48 ...nor read the secret token (deny-all table)', 'SELECT c2b_token FROM lb_mpesa_secrets', 'permission denied');
RESET ROLE;
SELECT must_fail('43.49 ...and the receiving function is not callable by a client', format('SET ROLE authenticated; SELECT record_mpesa_c2b(%L, %L::jsonb)', 'tok_0123456789abcdef0123456789abcdef', pl('FAKE000002', '99999', 'A', 'B')), 'permission denied');
RESET ROLE;
SELECT as_role('owner'); SELECT as_tenant('B');
SELECT must_fail('43.50 another business cannot touch this payment', format('SELECT pos_apply_mpesa_c2b(%L, %L, %L)', c2b('IGN1ABCDE1'), 'CUSTOMER', kid('ZED')), 'not found');
SET ROLE authenticated;
SELECT t('43.51 another business sees none of this inbox', (SELECT count(*) FROM lb_mpesa_c2b_payments) = 0);
RESET ROLE; SELECT as_tenant('A');

-- ===================================================================== PHASE 44
SELECT as_role('owner');
INSERT INTO lb_expense_categories (id, tenant_id, name) VALUES ('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000000a1', 'Rent'),
  ('00000000-0000-0000-0000-0000000e0002', '00000000-0000-0000-0000-0000000000a1', 'Salaries'), ('00000000-0000-0000-0000-0000000e0003', '00000000-0000-0000-0000-0000000000a1', 'Utilities'),
  ('00000000-0000-0000-0000-0000000e0004', '00000000-0000-0000-0000-0000000000a1', 'Electricity');
INSERT INTO lb_expenses (tenant_id, business_id, category_id, expense_date, amount, status) VALUES
 ('00000000-0000-0000-0000-0000000000a1', kid('BA'), '00000000-0000-0000-0000-0000000e0001', '2026-11-03', 15000, 'PAID'),
 ('00000000-0000-0000-0000-0000000000a1', kid('BA'), '00000000-0000-0000-0000-0000000e0001', '2026-11-30', 5000,  'PAID'),
 ('00000000-0000-0000-0000-0000000000a1', kid('BA'), '00000000-0000-0000-0000-0000000e0001', '2026-11-15', 7777,  'PENDING'),   -- not paid: excluded
 ('00000000-0000-0000-0000-0000000000a1', kid('BA'), '00000000-0000-0000-0000-0000000e0001', '2026-10-31', 1000,  'PAID'),      -- last month: excluded
 ('00000000-0000-0000-0000-0000000000a1', kid('BA'), '00000000-0000-0000-0000-0000000e0003', '2026-11-20', 4500,  'PAID');      -- never budgeted
SELECT as_role('accountant');
SELECT must_fail('44.1 an accountant can read budgets but not set them', format('SELECT pos_save_budget(%L, %L, %L, %L, %L, %L::jsonb)', kid('BA'), '2026-11-01', '2026-11-30', 'Nov', 'MONTH', '[]'), '42501');
SELECT as_role('cashier');
SELECT must_fail('44.2 a cashier cannot set a budget', format('SELECT pos_save_budget(%L, %L, %L, %L, %L, %L::jsonb)', kid('BA'), '2026-11-01', '2026-11-30', 'Nov', 'MONTH', '[]'), '42501');
SELECT as_role('manager');
SELECT must_fail('44.3 end before start is refused', format('SELECT pos_save_budget(%L, %L, %L, %L, %L, %L::jsonb)', kid('BA'), '2026-11-30', '2026-11-01', 'x', 'MONTH', '[]'), 'same or later');
SELECT must_fail('44.4 a class from another business is refused', format('SELECT pos_save_budget(%L, %L, %L, %L, %L, %L::jsonb)', kid('BA'), '2026-11-01', '2026-11-30', 'x', 'MONTH', jsonb_build_array(jsonb_build_object('line_type','REVENUE','class_id',gen_random_uuid(),'amount',5))), 'not in this business');
SELECT must_fail('44.5 a spending line with no category is refused', format('SELECT pos_save_budget(%L, %L, %L, %L, %L, %L::jsonb)', kid('BA'), '2026-11-01', '2026-11-30', 'x', 'MONTH', jsonb_build_array(jsonb_build_object('line_type','EXPENSE','amount',5))), 'does not exist');
SELECT must_fail('44.6 another tenant''s business is refused', format('SELECT pos_save_budget(%L, %L, %L, %L, %L, %L::jsonb)', kid('BB'), '2026-11-01', '2026-11-30', 'x', 'MONTH', '[]'), 'Business not found');
SELECT put('BUD', pos_save_budget(kid('BA'), '2026-11-01', '2026-11-30', 'November 2026', 'MONTH', jsonb_build_array(
  jsonb_build_object('line_type','REVENUE','class_id',kid('K_REST'),'amount',3000), jsonb_build_object('line_type','REVENUE','class_id',kid('K_BAR'),'amount',1000),
  jsonb_build_object('line_type','REVENUE','class_id',kid('K_OUT'),'amount',2500), jsonb_build_object('line_type','REVENUE','class_id',kid('K_ACC'),'amount',8000),
  jsonb_build_object('line_type','EXPENSE','expense_category_id','00000000-0000-0000-0000-0000000e0001','amount',20000),
  jsonb_build_object('line_type','EXPENSE','expense_category_id','00000000-0000-0000-0000-0000000e0002','amount',50000),
  jsonb_build_object('line_type','EXPENSE','expense_category_id','00000000-0000-0000-0000-0000000e0004','amount',0)), 'for the owner', '00000000-0000-0000-0000-0000000000e1'));
SELECT t('44.7 a manager saves a budget; zero-amount lines are dropped (6 lines)', (SELECT count(*) FROM lb_budget_lines WHERE budget_id = kid('BUD')) = 6);
SELECT as_role('accountant');
CREATE TEMP TABLE bva AS SELECT * FROM pos_budget_vs_actual(kid('BUD'));
SELECT t('44.8 Restaurant: budget 3000, actual 3100, variance +100 (above target is good), 103.3% of budget',
  (SELECT budget || '/' || actual || '/' || variance || '/' || pct_used FROM bva WHERE label = 'General Restaurant') = '3000.00/3100.00/100.00/103.3');
SELECT t('44.9 Bar: 1000 vs 600 = -400 (behind target), 60.0%', (SELECT variance || '/' || pct_used FROM bva WHERE label = 'Lounge & Bar') = '-400.00/60.0');
SELECT t('44.10 Accommodation: 8000 vs 10000 = +2000 (room nights from the folio)', (SELECT variance FROM bva WHERE label = 'Accommodation') = 2000);
SELECT t('44.11 sales in no class show up unbudgeted (Misc 100 + hand-posted folio lines 3000 + 2000 = 5100, flagged)', (SELECT actual || '/' || unbudgeted FROM bva WHERE label = 'Sales not in a class') = '5100.00/true');
SELECT t('44.12 Rent: budget 20000, paid 15000 + 5000 = 20000, variance 0, 100.0%; the PENDING and last-month rent are left out',
  (SELECT actual || '/' || variance || '/' || pct_used FROM bva WHERE label = 'Rent') = '20000.00/0.00/100.0');
SELECT t('44.13 Salaries: nothing spent = +50000 under budget, 0.0%', (SELECT variance || '/' || pct_used FROM bva WHERE label = 'Salaries') = '50000.00/0.0');
SELECT t('44.14 Utilities: spent 4500 with no budget = -4500, flagged', (SELECT variance || '/' || unbudgeted FROM bva WHERE label = 'Utilities') = '-4500.00/true');
SELECT t('44.15 a category budgeted at 0 and never used does not appear', NOT EXISTS (SELECT 1 FROM bva WHERE label = 'Electricity'));
SELECT t('44.16 order: sales lines first, then spending, "not in a class" last among sales',
  (SELECT string_agg(line_type, ',' ORDER BY ord) FROM (SELECT line_type, row_number() OVER () AS ord FROM pos_budget_vs_actual(kid('BUD'))) z) = 'REVENUE,REVENUE,REVENUE,REVENUE,REVENUE,EXPENSE,EXPENSE,EXPENSE'
  AND (SELECT label FROM (SELECT label, row_number() OVER () rn FROM pos_budget_vs_actual(kid('BUD'))) z WHERE rn = 5) = 'Sales not in a class');
SELECT t('44.17 totals work out: budget sales 14500 vs actual 16800; budget spend 70000 vs actual 24500',
  (SELECT sum(budget) || '/' || sum(actual) FROM bva WHERE line_type = 'REVENUE') = '14500.00/21800.00' AND (SELECT sum(budget) || '/' || sum(actual) FROM bva WHERE line_type = 'EXPENSE') = '70000.00/24500.00');
SELECT as_role('cashier');
SELECT must_fail('44.18 a cashier cannot see budget vs actual', format('SELECT * FROM pos_budget_vs_actual(%L)', kid('BUD')), '42501');
RESET ROLE; SET ROLE authenticated;
SELECT t('44.19 a cashier reads no budget rows directly (row security)', (SELECT count(*) FROM lb_budgets) = 0);
RESET ROLE; SELECT as_role('accountant'); SET ROLE authenticated;
SELECT t('44.20 an accountant reads the budget tables', (SELECT count(*) FROM lb_budgets) = 1 AND (SELECT count(*) FROM lb_budget_lines) = 6);
SELECT must_fail('44.21 no client can write the budget tables', format('INSERT INTO lb_budget_lines (tenant_id, business_id, budget_id, line_type, amount) VALUES (%L, %L, %L, %L, 1)', '00000000-0000-0000-0000-0000000000a1', kid('BA'), kid('BUD'), 'REVENUE'), 'permission denied');
RESET ROLE;
SELECT as_role('manager');
SELECT keep('b22', to_jsonb(pos_save_budget(kid('BA'), '2026-11-01', '2026-11-30', 'November 2026', 'MONTH', jsonb_build_array(jsonb_build_object('line_type','REVENUE','class_id',kid('K_BAR'),'amount',1200)))));
SELECT t('44.22 saving the same period again REPLACES the lines (one budget, one line)',
  trim(both '"' from got('b22')::text)::uuid = kid('BUD')
  AND (SELECT count(*) FROM lb_budgets WHERE business_id = kid('BA')) = 1 AND (SELECT count(*) FROM lb_budget_lines WHERE budget_id = kid('BUD')) = 1);
SELECT as_role('accountant');
SELECT must_fail('44.23 an accountant cannot delete a budget', format('SELECT pos_delete_budget(%L)', kid('BUD')), '42501');
SELECT as_role('manager');
SELECT pos_delete_budget(kid('BUD'));
SELECT t('44.24 a manager deletes it and its lines go too', TRUE AND (SELECT count(*) FROM lb_budget_lines) = 0 AND (SELECT count(*) FROM lb_budgets) = 0);
SELECT as_role('owner');

-- ===================================================================== total
DO $$ DECLARE n int; f int; BEGIN
  SELECT count(*), count(*) FILTER (WHERE NOT ok) INTO n, f FROM results;
  RAISE NOTICE 'TOTAL % FAIL %', n, f;
END $$;
