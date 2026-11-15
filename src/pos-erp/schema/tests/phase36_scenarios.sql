-- Scenarios for phase36 on a SCRATCH database (run by phase36_run.sh). Results land in t_res.
CREATE TABLE t_res (n serial, name text, ok boolean);
CREATE TABLE kv (k text PRIMARY KEY, v text);
GRANT ALL ON t_res, kv TO PUBLIC; GRANT USAGE ON SEQUENCE t_res_n_seq TO PUBLIC;
CREATE FUNCTION chk(p_name text, p_ok boolean) RETURNS void LANGUAGE sql AS $$ INSERT INTO t_res(name, ok) VALUES (p_name, coalesce(p_ok, false)) $$;
CREATE FUNCTION try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE p_sql; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
CREATE FUNCTION kvv(p text) RETURNS text LANGUAGE sql AS $$ SELECT v FROM kv WHERE k = p $$;
CREATE FUNCTION as_user(t text, perms text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.tenant', t, false), set_config('test.perms', perms, false) $$;
CREATE FUNCTION sub_store(k text, j jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO kv VALUES (k, j ->> 'order_id'), (k || '_json', j::text) $$;
GRANT EXECUTE ON FUNCTION chk(text, boolean), try(text), kvv(text), as_user(text, text), sub_store(text, jsonb) TO PUBLIC;

\set S  '00000000-0000-0000-0000-0000000000a1'
\set B  '00000000-0000-0000-0000-0000000000a2'
\set X  '00000000-0000-0000-0000-0000000000a3'
\set P  '00000000-0000-0000-0000-0000000000a4'
\set SUP 'products.manage,sales.create,sales.view,inventory.view,settings.manage'
\set BUY 'purchases.create,inventory.view,inventory.receive'

INSERT INTO pos_tenants VALUES (:'S','Mwangi Wholesalers','0700000001','approved'),(:'B','Kikuyu Retail','0700000002','approved'),
  (:'X','Newbie Shop','0700000003','approved'),(:'P','Pending Shop','0700000004','pending');
INSERT INTO lb_product_categories VALUES ('00000000-0000-0000-0000-00000000ca01','Groceries');
INSERT INTO lb_product_units VALUES ('00000000-0000-0000-0000-00000000de01','Carton','CTN');
INSERT INTO lb_warehouses VALUES ('00000000-0000-0000-0000-0000000000d1',:'S',true),('00000000-0000-0000-0000-0000000000d2',:'B',true);
-- supplier products: P1 Sugar (tracked, 100), P2 Hidden (never published), P3 Rice (request-price, 50), P5 Old (inactive), P6 Flour (new-buyers-closed, 40), P7 Race (10)
INSERT INTO lb_products (id, tenant_id, track_inventory, reorder_level, name, barcode, category_id, unit_id, sku, cost_price, selling_price, is_active) VALUES
 ('00000000-0000-0000-0000-0000000000c1',:'S',true,10,'Sugar 50kg','6001','00000000-0000-0000-0000-00000000ca01','00000000-0000-0000-0000-00000000de01','SECRET-SKU-1',3000,3500,'active'),
 ('00000000-0000-0000-0000-0000000000c2',:'S',true,10,'Hidden Item',NULL,NULL,NULL,'SECRET-SKU-2',10,20,'active'),
 ('00000000-0000-0000-0000-0000000000c3',:'S',true,10,'Rice 25kg','6003','00000000-0000-0000-0000-00000000ca01',NULL,'SECRET-SKU-3',1000,1200,'active'),
 ('00000000-0000-0000-0000-0000000000c5',:'S',true,10,'Old Stock',NULL,NULL,NULL,'SECRET-SKU-5',1,2,'inactive'),
 ('00000000-0000-0000-0000-0000000000c6',:'S',true,5,'Flour 2kg','6006','00000000-0000-0000-0000-00000000ca01',NULL,'SECRET-SKU-6',50,70,'active'),
 ('00000000-0000-0000-0000-0000000000c7',:'S',true,1,'Race Item',NULL,NULL,NULL,'SECRET-SKU-7',5,9,'active'),
 ('00000000-0000-0000-0000-0000000000b1',:'B',true,1,'Buyer Own Item',NULL,NULL,NULL,'BUYER-SKU',5,9,'active');
INSERT INTO lb_inventory (tenant_id, warehouse_id, product_id, quantity) VALUES
 (:'S','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c1',100),
 (:'S','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c3',50),
 (:'S','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c6',40),
 (:'S','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c7',10);

-- ============ publishing ============
SELECT as_user(:'S','sales.create');
SELECT chk('publish needs products.manage', try($q$select network_publish_offer('00000000-0000-0000-0000-0000000000c1','SHOW',100,2,true,true,'{}',2,50,null)$q$) = '42501');
SELECT as_user(:'S',:'SUP');
SELECT chk('"show price" without a price is refused', try($q$select network_publish_offer('00000000-0000-0000-0000-0000000000c1','SHOW',null,2,true,true,'{}',2,50,null)$q$) = '22023');
SELECT chk('cannot publish an inactive item', try($q$select network_publish_offer('00000000-0000-0000-0000-0000000000c5','REQUEST',null,1,false,true,'{}',null,0,null)$q$) = '42501');
SELECT network_publish_offer('00000000-0000-0000-0000-0000000000c1','SHOW',100,2,true,true,ARRAY['Kiambu'],2,50,'Fresh stock');
SELECT network_publish_offer('00000000-0000-0000-0000-0000000000c3','REQUEST',null,1,false,true,'{}',3,0,null);
SELECT network_publish_offer('00000000-0000-0000-0000-0000000000c6','SHOW',80,1,true,false,'{}',1,0,null);   -- closed to new buyers
SELECT network_publish_offer('00000000-0000-0000-0000-0000000000c7','SHOW',9,1,true,true,'{}',1,0,null);
SELECT as_user(:'B',:'BUY');
SELECT chk('another business cannot publish my product', try(format($q$select network_publish_offer(%L,'REQUEST',null,1,false,true,'{}',null,0,null)$q$,'00000000-0000-0000-0000-0000000000c1')) = '42501');
SELECT as_user(:'B','products.manage');
SELECT chk('another business with permission still cannot publish a product it does not own', try($q$select network_publish_offer('00000000-0000-0000-0000-0000000000c1','REQUEST',null,1,false,true,'{}',null,0,null)$q$) = '42501');

-- ============ find stock ============
SELECT as_user(:'B',:'BUY');
INSERT INTO kv SELECT 'search_all', network_search_offers()::text;
SELECT chk('search shows published offers', (SELECT jsonb_array_length(kvv('search_all')::jsonb)) = 4);
SELECT chk('unpublished product is NOT visible', kvv('search_all') NOT LIKE '%Hidden Item%');
SELECT chk('inactive product is NOT visible', kvv('search_all') NOT LIKE '%Old Stock%');
SELECT chk('no SKU / cost / selling price leaks', kvv('search_all') NOT LIKE '%SECRET-SKU%' AND kvv('search_all') NOT LIKE '%cost_price%' AND kvv('search_all') NOT LIKE '%selling_price%' AND kvv('search_all') NOT LIKE '%3500%' AND kvv('search_all') NOT LIKE '%3000%');
SELECT chk('stock shown only as a band, never the number', (SELECT bool_and(e ->> 'stock' IN ('IN_STOCK','LOW','OUT','AVAILABLE') OR e -> 'stock' = 'null'::jsonb) FROM jsonb_array_elements(kvv('search_all')::jsonb) e) AND kvv('search_all') NOT LIKE '%"quantity"%');
SELECT chk('supplier who hides stock shows none (Rice)', (SELECT (e -> 'stock') = 'null'::jsonb FROM jsonb_array_elements(kvv('search_all')::jsonb) e WHERE e ->> 'product_name' = 'Rice 25kg'));
SELECT chk('request-price offer has no price', (SELECT (e -> 'price') = 'null'::jsonb AND e ->> 'price_mode' = 'REQUEST' FROM jsonb_array_elements(kvv('search_all')::jsonb) e WHERE e ->> 'product_name' = 'Rice 25kg'));
SELECT chk('closed-to-new-buyers offer says can_order=false', (SELECT (e ->> 'can_order')::boolean = false FROM jsonb_array_elements(kvv('search_all')::jsonb) e WHERE e ->> 'product_name' = 'Flour 2kg'));
SELECT chk('search by supplier name', jsonb_array_length(network_search_offers('mwangi')) = 4);
SELECT chk('search by exact barcode', jsonb_array_length(network_search_offers('6001')) = 1);
SELECT chk('SKU is not searchable', jsonb_array_length(network_search_offers('SECRET-SKU-1')) = 0);
SELECT chk('category filter', jsonb_array_length(network_search_offers(null,'Groceries')) = 3);
SELECT chk('no results is an empty list, not an error', network_search_offers('zzzzzz') = '[]'::jsonb);
SELECT chk('LIKE wildcards are plain text', network_search_offers('%') = '[]'::jsonb);
SELECT chk('sort by price puts priced offers first', (network_search_offers(null,null,'price') -> 0 ->> 'product_name') = 'Race Item');
SELECT as_user(:'S',:'SUP');
SELECT chk('a supplier does not see its own offers as stock to buy', jsonb_array_length(network_search_offers()) = 0);
SELECT as_user(:'B','sales.view');
SELECT chk('search needs a permission', try('select network_search_offers()') = '42501');

-- ============ placing orders ============
SELECT as_user(:'B',:'BUY');
INSERT INTO kv SELECT 'off_sugar', (e ->> 'offer_id') FROM jsonb_array_elements(network_search_offers('sugar')) e;
INSERT INTO kv SELECT 'off_rice',  (e ->> 'offer_id') FROM jsonb_array_elements(network_search_offers('rice')) e;
INSERT INTO kv SELECT 'off_flour', (e ->> 'offer_id') FROM jsonb_array_elements(network_search_offers('flour')) e;
INSERT INTO kv SELECT 'off_race',  (e ->> 'offer_id') FROM jsonb_array_elements(network_search_offers('race')) e;
SELECT chk('below minimum order is refused', try(format($q$select network_submit_order('REF-MOQ-00001',%L::jsonb,'COLLECTION',null,null)$q$, json_build_array(json_build_object('offer_id',kvv('off_sugar'),'quantity',1))::text)) = '22023');
SELECT chk('more than the stock is refused (P0412)', try(format($q$select network_submit_order('REF-BIG-00001',%L::jsonb,'COLLECTION',null,null)$q$, json_build_array(json_build_object('offer_id',kvv('off_sugar'),'quantity',500))::text)) = 'P0412');
SELECT chk('delivery needs an address', try(format($q$select network_submit_order('REF-ADR-00001',%L::jsonb,'DELIVERY','',null)$q$, json_build_array(json_build_object('offer_id',kvv('off_sugar'),'quantity',5))::text)) = '22023');
SELECT chk('closed-to-new-buyers supplier refuses an unconnected buyer (P0411)', try(format($q$select network_submit_order('REF-CLS-00001',%L::jsonb,'COLLECTION',null,null)$q$, json_build_array(json_build_object('offer_id',kvv('off_flour'),'quantity',1))::text)) = 'P0411');
SELECT as_user(:'P',:'BUY');
SELECT chk('a pending (unapproved) business cannot order', try(format($q$select network_submit_order('REF-PND-00001',%L::jsonb,'COLLECTION',null,null)$q$, json_build_array(json_build_object('offer_id',kvv('off_sugar'),'quantity',5))::text)) = '42501');
SELECT as_user(:'B',:'BUY');
-- wrong expected total (stale price): refused, nothing saved, and the SAME reference still works afterwards (claim rolled back)
SELECT chk('stale price is refused (P0410)', try(format($q$select network_submit_order('REF-PRC-00001',%L::jsonb,'DELIVERY','Kikuyu town',null,400)$q$, json_build_array(json_build_object('offer_id',kvv('off_sugar'),'quantity',5))::text)) = 'P0410');
SELECT chk('...and no order and no claim were left behind', (SELECT count(*) FROM network_orders) = 0 AND (SELECT count(*) FROM pos_client_ops WHERE client_reference='REF-PRC-00001') = 0);
SELECT sub_store('o1', network_submit_order('REF-ORDER-0001', json_build_array(json_build_object('offer_id',kvv('off_sugar'),'quantity',5))::jsonb, 'DELIVERY','Kikuyu town','Please call first',550));
SELECT chk('order placed: reference, status, server-computed total (5x100+50)', (kvv('o1_json')::jsonb ->> 'order_ref') ~ '^NET-[0-9]{4}-[0-9]{6}$' AND (kvv('o1_json')::jsonb ->> 'status') = 'AWAITING_CONFIRMATION' AND (kvv('o1_json')::jsonb ->> 'total')::numeric = 550);
SELECT chk('submitting reserves NOTHING (supplier must confirm)', (SELECT count(*) FROM network_reservations) = 0);
INSERT INTO kv SELECT 'o1_retry', network_submit_order('REF-ORDER-0001', json_build_array(json_build_object('offer_id',kvv('off_sugar'),'quantity',5))::jsonb, 'DELIVERY','Kikuyu town','Please call first',550)::text;
SELECT chk('retry with same reference: same order, duplicate=true', (kvv('o1_retry')::jsonb ->> 'order_id') = kvv('o1') AND (kvv('o1_retry')::jsonb ->> 'duplicate') = 'true');
SELECT chk('retry did not create a second order', (SELECT count(*) FROM network_orders) = 1);
SELECT chk('same reference for a DIFFERENT order is refused (P0409)', try(format($q$select network_submit_order('REF-ORDER-0001',%L::jsonb,'COLLECTION',null,null)$q$, json_build_array(json_build_object('offer_id',kvv('off_sugar'),'quantity',9))::text)) = 'P0409');
SELECT chk('the order has a snapshot of names and price', (SELECT unit_price = 100 AND product_name = 'Sugar 50kg' AND unit_label = 'Carton' FROM network_order_lines));

-- ============ who sees it ============
SELECT as_user(:'S',:'SUP');
SELECT chk('supplier sees the incoming order', (SELECT jsonb_array_length(network_my_orders('SALES')) = 1));
SELECT chk('supplier sees buyer name and delivery details', network_get_order(kvv('o1')::uuid) ->> 'other_name' = 'Kikuyu Retail' AND network_get_order(kvv('o1')::uuid) ->> 'delivery_address' = 'Kikuyu town');
SELECT chk('supplier (no purchasing rights) cannot open purchases', try('select network_my_orders(''PURCHASES'')') = '42501');
SELECT as_user(:'B',:'BUY');
SELECT chk('buyer sees it under purchases, not sales', jsonb_array_length(network_my_orders('PURCHASES')) = 1 AND (SELECT try('select network_my_orders(''SALES'')') = '42501'));
SELECT chk('buyer view hides supplier-private ids and sku', network_get_order(kvv('o1')::uuid)::text NOT LIKE '%supplier_product_id%' AND network_get_order(kvv('o1')::uuid)::text NOT LIKE '%SECRET%' AND network_get_order(kvv('o1')::uuid)::text NOT LIKE '%supplier_record_id%');
SELECT as_user(:'X',:'BUY'||',sales.view,sales.create');
SELECT chk('an unrelated business cannot open the order', try(format('select network_get_order(%L)', kvv('o1'))) = '42501');
SELECT chk('an unrelated business cannot confirm it', try(format($q$select network_confirm_order(%L,'XXX-CONF-0001')$q$, kvv('o1'))) = '42501');
SELECT chk('an unrelated business cannot cancel it (either side)', try(format($q$select network_cancel_order(%L,'SUPPLIER','x')$q$, kvv('o1'))) = '42501' AND try(format($q$select network_cancel_order(%L,'BUYER','x')$q$, kvv('o1'))) = '42501');
SELECT chk('an unrelated business sees no orders', network_my_orders('PURCHASES') = '[]'::jsonb AND network_my_orders('SALES') = '[]'::jsonb);
SELECT as_user(:'B',:'BUY'||',sales.create');
SELECT chk('the BUYER cannot confirm its own order (not the supplier)', try(format($q$select network_confirm_order(%L,'BUY-CONF-0001')$q$, kvv('o1'))) = '42501');
SELECT as_user(:'S','products.manage,inventory.view');
SELECT chk('confirming needs sales.create', try(format($q$select network_confirm_order(%L,'NOP-CONF-0001')$q$, kvv('o1'))) = '42501');

-- ============ confirm + reserve ============
SELECT as_user(:'S',:'SUP');
SELECT chk('cannot dispatch before confirming', try(format($q$select network_dispatch_order(%L,'EARLY-DISP-0001')$q$, kvv('o1'))) = 'P0413');
INSERT INTO kv SELECT 'c1', network_confirm_order(kvv('o1')::uuid,'CONF-ORDER-0001')::text;
SELECT chk('confirmed', (kvv('c1')::jsonb ->> 'status') = 'CONFIRMED' AND (SELECT status FROM network_orders) = 'CONFIRMED');
SELECT chk('confirming reserved 5 of the supplier''s stock', (SELECT sum(quantity) FROM network_reservations WHERE status='ACTIVE') = 5 AND _net_available(:'S','00000000-0000-0000-0000-0000000000c1') = 95);
SELECT chk('confirm retry is a safe duplicate (still ONE reservation)', (network_confirm_order(kvv('o1')::uuid,'CONF-ORDER-0001') ->> 'duplicate') = 'true' AND (SELECT count(*) FROM network_reservations) = 1);
SELECT chk('confirming again with a new reference is refused (already handled)', try(format($q$select network_confirm_order(%L,'CONF-ORDER-0002')$q$, kvv('o1'))) = 'P0413');
SELECT chk('physical stock is NOT touched by confirming (Phase 6 moves stock)', (SELECT quantity FROM lb_inventory WHERE product_id='00000000-0000-0000-0000-0000000000c1') = 100);

-- ============ dispatch (partial) ============
INSERT INTO kv SELECT 'line1', id::text FROM network_order_lines;
SELECT chk('cannot dispatch more than confirmed', try(format($q$select network_dispatch_order(%L,'DISP-ORDER-0000',%L::jsonb)$q$, kvv('o1'), json_build_array(json_build_object('line_id',kvv('line1'),'quantity',6))::text)) = '22023');
SELECT network_dispatch_order(kvv('o1')::uuid,'DISP-ORDER-0001', json_build_array(json_build_object('line_id',kvv('line1'),'quantity',2))::jsonb);
SELECT network_dispatch_order(kvv('o1')::uuid,'DISP-ORDER-0001', json_build_array(json_build_object('line_id',kvv('line1'),'quantity',2))::jsonb);   -- retry
SELECT chk('dispatch retry did not double-count', (SELECT qty_dispatched FROM network_order_lines) = 2);
SELECT network_dispatch_order(kvv('o1')::uuid,'DISP-ORDER-0002');   -- the rest
SELECT chk('second dispatch sends the remainder', (SELECT qty_dispatched FROM network_order_lines) = 5 AND (SELECT status FROM network_orders) = 'DISPATCHED');
SELECT chk('invoice and payment are NOT assumed from dispatch', (SELECT invoice_status = 'NOT_INVOICED' AND payment_status = 'UNPAID' FROM network_orders));
SELECT chk('cannot cancel after goods left (P0413)', try(format($q$select network_cancel_order(%L,'SUPPLIER','changed mind')$q$, kvv('o1'))) = 'P0413');
SELECT as_user(:'B',:'BUY');
SELECT chk('buyer can raise a problem after dispatch', (network_dispute_order(kvv('o1')::uuid,'Cartons were damaged') ->> 'status') = 'DISPUTED');

-- ============ cancel releases the reservation; reject ============
SELECT as_user(:'B',:'BUY');
SELECT sub_store('o2', network_submit_order('REF-ORDER-0002', json_build_array(json_build_object('offer_id',kvv('off_sugar'),'quantity',30))::jsonb, 'COLLECTION',null,null));
SELECT as_user(:'S',:'SUP');
SELECT network_confirm_order(kvv('o2')::uuid,'CONF-ORDER-0003');
SELECT chk('second order reserved too (5 + 30)', _net_available(:'S','00000000-0000-0000-0000-0000000000c1') = 65);
SELECT as_user(:'B',:'BUY');
SELECT sub_store('c2', network_cancel_order(kvv('o2')::uuid,'BUYER','not needed') || '{"order_id":null}'::jsonb);
SELECT chk('buyer cancels a confirmed order: 1 reservation released, stock free again', (kvv('c2_json')::jsonb ->> 'released') = '1');
SELECT chk('...and the supplier can offer those 30 again (95 free)', _net_available(:'S','00000000-0000-0000-0000-0000000000c1') = 95);
SELECT chk('cancelling twice is harmless', (network_cancel_order(kvv('o2')::uuid,'BUYER') ->> 'duplicate') = 'true');
SELECT sub_store('o3', network_submit_order('REF-ORDER-0003', json_build_array(json_build_object('offer_id',kvv('off_sugar'),'quantity',3))::jsonb, 'COLLECTION',null,null));
SELECT as_user(:'S',:'SUP');
SELECT chk('reject needs a reason', try(format($q$select network_reject_order(%L,' ')$q$, kvv('o3'))) = '22023');
SELECT chk('supplier rejects: cancelled and no reservation', (network_reject_order(kvv('o3')::uuid,'Out of season') ->> 'status') = 'CANCELLED' AND (SELECT count(*) FROM network_reservations WHERE status='ACTIVE' AND order_line_id IN (SELECT id FROM network_order_lines WHERE order_id = kvv('o3')::uuid)) = 0);
SELECT as_user(:'B',:'BUY');
SELECT chk('buyer sees the rejection reason', network_get_order(kvv('o3')::uuid) ->> 'cancel_reason' = 'Out of season' AND network_get_order(kvv('o3')::uuid) ->> 'cancelled_by' = 'SUPPLIER');

-- ============ request-price offer ============
SELECT sub_store('o4', network_submit_order('REF-ORDER-0004', json_build_array(json_build_object('offer_id',kvv('off_rice'),'quantity',4))::jsonb, 'COLLECTION',null,null));
SELECT chk('request-price order: total unknown, price pending', (kvv('o4_json')::jsonb ->> 'price_pending') = 'true' AND (kvv('o4_json')::jsonb -> 'total') = 'null'::jsonb);
SELECT as_user(:'S',:'SUP');
SELECT chk('supplier must quote a price before confirming', try(format($q$select network_confirm_order(%L,'CONF-ORDER-0004')$q$, kvv('o4'))) = '22023');
INSERT INTO kv SELECT 'line4', id::text FROM network_order_lines WHERE order_id = kvv('o4')::uuid;
SELECT network_confirm_order(kvv('o4')::uuid,'CONF-ORDER-0005', json_build_array(json_build_object('line_id',kvv('line4'),'quantity',3,'unit_price',1100))::jsonb);
SELECT chk('quoted + part-confirmed: total = 3 x 1100', (SELECT total = 3300 AND price_pending = false AND status = 'CONFIRMED' FROM network_orders WHERE id = kvv('o4')::uuid));
-- a supplier cannot change an already-agreed price
SELECT as_user(:'B',:'BUY');
SELECT sub_store('o5', network_submit_order('REF-ORDER-0005', json_build_array(json_build_object('offer_id',kvv('off_sugar'),'quantity',2))::jsonb, 'COLLECTION',null,null));
SELECT as_user(:'S',:'SUP');
INSERT INTO kv SELECT 'line5', id::text FROM network_order_lines WHERE order_id = kvv('o5')::uuid;
SELECT chk('supplier cannot change a price the buyer was shown', try(format($q$select network_confirm_order(%L,'CONF-ORDER-0006',%L::jsonb)$q$, kvv('o5'), json_build_array(json_build_object('line_id',kvv('line5'),'quantity',2,'unit_price',999))::text)) = '22023');
SELECT chk('a failed confirm left no reservation behind', (SELECT count(*) FROM network_reservations WHERE order_line_id = kvv('line5')::uuid) = 0);

-- ============ connections and special prices ============
SELECT as_user(:'X',:'BUY');
SELECT chk('unconnected new buyer still cannot order the closed offer (P0411)', try(format($q$select network_submit_order('REF-X-0000001',%L::jsonb,'COLLECTION',null,null)$q$, json_build_array(json_build_object('offer_id',kvv('off_flour'),'quantity',1))::text)) = 'P0411');
INSERT INTO kv SELECT 'conn', network_request_connection(:'S'::uuid,'Hello, we are new')->>'connection_id';
SELECT chk('connection request is idempotent', (network_request_connection(:'S'::uuid)->>'duplicate') = 'true' AND (SELECT count(*) FROM network_connections) = 1);
SELECT as_user(:'X','settings.manage,purchases.create');
SELECT chk('the requester cannot accept its own request (even with permission)', try(format('select network_respond_connection(%L,true)', kvv('conn'))) = '42501');
SELECT as_user(:'S','products.manage');
SELECT chk('accepting a connection needs settings.manage', try(format('select network_respond_connection(%L,true)', kvv('conn'))) = '42501');
SELECT as_user(:'S',:'SUP');
SELECT chk('supplier accepts', (network_respond_connection(kvv('conn')::uuid,true) ->> 'status') = 'ACCEPTED');
SELECT chk('a contract price needs a connection', try(format('select network_set_buyer_price(%L,%L,70)', kvv('off_flour'), :'B')) = '42501');
SELECT network_set_buyer_price(kvv('off_flour')::uuid, :'X'::uuid, 70);
SELECT as_user(:'X',:'BUY');
SELECT chk('connected buyer sees its special price (70)', (SELECT (e ->> 'price')::numeric = 70 AND (e ->> 'price_is_special')::boolean FROM jsonb_array_elements(network_search_offers('flour')) e));
SELECT as_user(:'B',:'BUY');
SELECT chk('another buyer does NOT see it (80)', (SELECT (e ->> 'price')::numeric = 80 AND NOT (e ->> 'price_is_special')::boolean FROM jsonb_array_elements(network_search_offers('flour')) e) AND network_search_offers('flour')::text NOT LIKE '%70%');
SELECT as_user(:'X',:'BUY');
SELECT sub_store('o6', network_submit_order('REF-ORDER-0006', json_build_array(json_build_object('offer_id',kvv('off_flour'),'quantity',10))::jsonb, 'COLLECTION',null,null));
SELECT chk('connected buyer can now order, at the special price (10 x 70)', (kvv('o6_json')::jsonb ->> 'total')::numeric = 700);
SELECT as_user(:'S',:'SUP');
SELECT chk('connection list shows order history count', (SELECT (e ->> 'order_count')::int = 1 FROM jsonb_array_elements(network_my_connections()) e WHERE e ->> 'other_name' = 'Newbie Shop'));

-- ============ pause / remove ============
SELECT network_set_offer_status(kvv('off_race')::uuid,'PAUSED');
SELECT as_user(:'B',:'BUY');
SELECT chk('a paused offer disappears from search', jsonb_array_length(network_search_offers('race')) = 0);
SELECT chk('a paused offer cannot be ordered (P0411)', try(format($q$select network_submit_order('REF-PAUSE-0001',%L::jsonb,'COLLECTION',null,null)$q$, json_build_array(json_build_object('offer_id',kvv('off_race'),'quantity',1))::text)) = 'P0411');
SELECT as_user(:'S',:'SUP');
SELECT network_set_offer_status(kvv('off_race')::uuid,'ACTIVE');
SELECT network_set_offer_status(kvv('off_race')::uuid,'PAUSED');
SELECT network_publish_offer('00000000-0000-0000-0000-0000000000c7','SHOW',9,1,true,true,'{}',1,0,'edited');
SELECT chk('editing a paused offer keeps it paused', (SELECT status FROM network_offers WHERE id = kvv('off_race')::uuid) = 'PAUSED');
SELECT network_set_offer_status(kvv('off_race')::uuid,'REMOVED');
SELECT network_publish_offer('00000000-0000-0000-0000-0000000000c7','SHOW',9,1,true,true,'{}',1,0,'back');
SELECT chk('republishing a removed offer makes it live again', (SELECT status FROM network_offers WHERE id = kvv('off_race')::uuid) = 'ACTIVE');
SELECT chk('pausing never deleted the product or its stock', (SELECT count(*) FROM lb_products WHERE id='00000000-0000-0000-0000-0000000000c7') = 1 AND (SELECT quantity FROM lb_inventory WHERE product_id='00000000-0000-0000-0000-0000000000c7') = 10);
SELECT as_user(:'B','products.manage');
SELECT chk('a buyer cannot pause the supplier''s offer', try(format($q$select network_set_offer_status(%L,'PAUSED')$q$, kvv('off_race'))) = '42501');

-- ============ the race fixtures (concurrency is run from the shell script) ============
SELECT as_user(:'B',:'BUY');
SELECT network_submit_order('RACE-ORDER-A', json_build_array(json_build_object('offer_id',kvv('off_race'),'quantity',7))::jsonb, 'COLLECTION',null,null);
SELECT network_submit_order('RACE-ORDER-B', json_build_array(json_build_object('offer_id',kvv('off_race'),'quantity',7))::jsonb, 'COLLECTION',null,null);
SELECT chk('both competing orders were accepted for confirmation (neither reserves)', (SELECT count(*) FROM network_orders WHERE client_reference LIKE 'RACE-ORDER-%') = 2);

-- ============ database-level lockdown ============
SELECT as_user(:'B',:'BUY');
SET ROLE authenticated;
SELECT chk('API cannot read network_orders directly', try('select * from network_orders') = '42501');
SELECT chk('API cannot read network_offers directly', try('select * from network_offers') = '42501');
SELECT chk('API cannot change an order total directly', try('update network_orders set total = 1') = '42501');
SELECT chk('API cannot change a status directly', try('update network_orders set status = ''RECEIVED''') = '42501');
SELECT chk('API cannot write reservations directly', try('insert into network_reservations(order_line_id,supplier_tenant,product_id,warehouse_id,quantity) values (gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1)') = '42501');
SELECT chk('API cannot call internal helpers', try('select _net_available(gen_random_uuid(), gen_random_uuid())') = '42501' AND try('select _net_release(gen_random_uuid())') = '42501');
SELECT chk('public functions ARE callable by a signed-in session', try('select network_search_offers()') = 'OK');
RESET ROLE;
SET ROLE anon;
SELECT chk('anon cannot call public functions', try('select network_search_offers()') = '42501');
RESET ROLE;

-- ============ audit ============
SELECT chk('important changes were written to the audit log', (SELECT count(DISTINCT action) FROM pos_audit_log WHERE action LIKE 'NETWORK_%') >= 6);
SELECT chk('existing stock was never changed by any network action in this file', (SELECT quantity FROM lb_inventory WHERE product_id='00000000-0000-0000-0000-0000000000c1') = 100);
