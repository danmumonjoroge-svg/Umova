-- Phase 39 scenarios (scratch database ONLY). Prints PASS/FAIL lines; last line: TOTAL n FAIL m.
\set ON_ERROR_STOP off
CREATE TABLE IF NOT EXISTS t_res (name text, ok boolean);
CREATE OR REPLACE FUNCTION chk(n text, ok boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN INSERT INTO t_res VALUES (n, coalesce(ok,false)); RAISE NOTICE '% %', CASE WHEN coalesce(ok,false) THEN 'PASS' ELSE 'FAIL' END, n; END $$;
-- chke: runs a statement expecting an error whose message/SQLSTATE contains p_expect
CREATE OR REPLACE FUNCTION chke(n text, stmt text, p_expect text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE stmt; PERFORM chk(n || ' (expected an error, got none)', false);
EXCEPTION WHEN OTHERS THEN PERFORM chk(n, SQLERRM ILIKE '%' || p_expect || '%' OR SQLSTATE = p_expect); END $$;

\set T '00000000-0000-0000-0000-0000000000a1'
\set T2 '00000000-0000-0000-0000-0000000000a2'
\set B '00000000-0000-0000-0000-0000000000b1'
INSERT INTO lb_businesses VALUES (:'B', :'T', 'Shop');
INSERT INTO lb_businesses VALUES ('00000000-0000-0000-0000-0000000000b2', :'T2', 'Other shop');
INSERT INTO lb_products VALUES ('00000000-0000-0000-0000-0000000000c1');
INSERT INTO lb_warehouses VALUES ('00000000-0000-0000-0000-0000000000d1', :'B', true);
INSERT INTO lb_inventory(product_id, warehouse_id, quantity) VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 100);
-- Safaricom-shaped callback
CREATE OR REPLACE FUNCTION cb(p_checkout text, p_code int, p_receipt text, p_amount numeric) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('Body', jsonb_build_object('stkCallback', jsonb_build_object('CheckoutRequestID', p_checkout, 'ResultCode', p_code,
   'CallbackMetadata', CASE WHEN p_code = 0 THEN jsonb_build_object('Item', jsonb_build_array(jsonb_build_object('Name','Amount','Value',p_amount), jsonb_build_object('Name','MpesaReceiptNumber','Value',p_receipt))) END))) $$;
CREATE OR REPLACE FUNCTION mk(p_id text, p_amount numeric DEFAULT 500, p_tenant uuid DEFAULT '00000000-0000-0000-0000-0000000000a1', p_status text DEFAULT 'PENDING') RETURNS void LANGUAGE sql AS $$
 INSERT INTO lb_mpesa_transactions(tenant_id, business_id, phone, amount, cart_snapshot, checkout_request_id, status)
 VALUES (p_tenant, '00000000-0000-0000-0000-0000000000b1', '254712345678', p_amount,
   '[{"product_id":"00000000-0000-0000-0000-0000000000c1","name":"Sugar","quantity":5,"unit_price":100}]'::jsonb, p_id, p_status::lb_mpesa_status) $$;
CREATE OR REPLACE FUNCTION conf(p_id text, p_code int, p_receipt text, p_amount numeric DEFAULT 500) RETURNS jsonb LANGUAGE sql AS $$
 SELECT confirm_mpesa_payment(p_id, p_code, 'x', p_receipt, cb(p_id, p_code, p_receipt, p_amount)) $$;
CREATE OR REPLACE FUNCTION st(p_id text) RETURNS text LANGUAGE sql AS $$ SELECT status::text FROM lb_mpesa_transactions WHERE checkout_request_id = p_id $$;

-- ===== 6. successful callback: payment confirmed, REAL code stored, one sale / payment / receipt, stock moved =====
SELECT mk('CK-1');
SELECT chk('6: success callback -> PAID', (conf('CK-1', 0, 'shk7x9abcd') ->> 'status') = 'PAID');
SELECT chk('6: the real M-Pesa code (normalised) is on the transaction and on the payment',
  (SELECT mpesa_receipt_number FROM lb_mpesa_transactions WHERE checkout_request_id='CK-1') = 'SHK7X9ABCD'
  AND (SELECT reference_no FROM lb_payments p JOIN lb_mpesa_transactions t ON t.sale_id = p.sale_id WHERE t.checkout_request_id='CK-1') = 'SHK7X9ABCD');
SELECT chk('6: payment is MOBILE_MONEY for the requested amount', (SELECT count(*) FROM lb_payments p JOIN lb_mpesa_transactions t ON t.sale_id=p.sale_id WHERE t.checkout_request_id='CK-1' AND p.payment_method='MOBILE_MONEY' AND p.amount=500) = 1);
SELECT chk('18: a receipt row exists and names the code (phase17 had dropped it)', (SELECT receipt_data #>> '{payments,0,reference_no}' FROM lb_receipts r JOIN lb_mpesa_transactions t ON t.sale_id=r.sale_id WHERE t.checkout_request_id='CK-1') = 'SHK7X9ABCD');
SELECT chk('stock moved once', (SELECT quantity FROM lb_inventory) = 95);

-- ===== 23. duplicate callback =====
SELECT chk('23: duplicate callback is a no-op', (conf('CK-1', 0, 'SHK7X9ABCD') ->> 'already_processed') = 'true');
SELECT chk('23: still exactly one sale, one payment, one receipt, stock moved once',
  (SELECT count(*) FROM lb_sales) = 1 AND (SELECT count(*) FROM lb_payments) = 1 AND (SELECT count(*) FROM lb_receipts) = 1 AND (SELECT quantity FROM lb_inventory) = 95);

-- ===== 7/8. failed and cancelled: never paid, no sale =====
SELECT mk('CK-F'); SELECT conf('CK-F', 1, NULL);
SELECT chk('7: failed callback -> FAILED, no sale', st('CK-F') = 'FAILED' AND (SELECT count(*) FROM lb_sales) = 1);
SELECT mk('CK-C'); SELECT conf('CK-C', 1032, NULL);
SELECT chk('8: cancelled by buyer -> CANCELLED, no sale', st('CK-C') = 'CANCELLED' AND (SELECT count(*) FROM lb_sales) = 1);
SELECT chk('8: a later success callback cannot revive a CANCELLED request', (conf('CK-C', 0, 'LATE000001') ->> 'already_processed') = 'true' AND (SELECT count(*) FROM lb_sales) = 1);

-- ===== 24. late success after the till timed out =====
SELECT mk('CK-T', 500, :'T', 'TIMED_OUT');
SELECT chk('24: late success on a TIMED_OUT request is applied (money was received)', (conf('CK-T', 0, 'LATE777777') ->> 'status') = 'PAID' AND st('CK-T') = 'PAID');
SELECT chk('24: exactly one extra sale + payment, code stored', (SELECT count(*) FROM lb_sales) = 2 AND (SELECT count(*) FROM lb_payments WHERE reference_no='LATE777777') = 1);
SELECT chk('24: and a repeat of that late callback is idempotent', (conf('CK-T', 0, 'LATE777777') ->> 'already_processed') = 'true' AND (SELECT count(*) FROM lb_sales) = 2);
-- set aside by hand (NEEDS_ATTENTION, no callback yet) then the buyer pays
SELECT mk('CK-N', 500, :'T', 'NEEDS_ATTENTION');
SELECT chk('24: late success on a request set aside by hand is applied', (conf('CK-N', 0, 'LATE888888') ->> 'status') = 'PAID');
-- but a NEEDS_ATTENTION that already holds a callback result is final
SELECT mk('CK-N2'); SELECT conf('CK-N2', 0, 'AMT0000001', 999);   -- amount mismatch -> parked
SELECT chk('3: callback amount != requested amount -> NEEDS_ATTENTION, no sale, code not stored on the request', st('CK-N2') = 'NEEDS_ATTENTION' AND (SELECT mpesa_receipt_number FROM lb_mpesa_transactions WHERE checkout_request_id='CK-N2') IS NULL AND (SELECT count(*) FROM lb_payments WHERE reference_no='AMT0000001') = 0);
SELECT chk('a parked request is final: a repeat callback does not apply it', (conf('CK-N2', 0, 'AMT0000001', 500) ->> 'already_processed') = 'true' AND (SELECT count(*) FROM lb_payments WHERE reference_no='AMT0000001') = 0);
-- success with no receipt code
SELECT mk('CK-NC'); SELECT confirm_mpesa_payment('CK-NC', 0, 'x', NULL, cb('CK-NC', 0, NULL, 500));
SELECT chk('success without a code is parked, never given an invented code', st('CK-NC') = 'NEEDS_ATTENTION' AND (SELECT count(*) FROM lb_sales) = 3);

-- ===== 10/12. duplicates between manual and prompted =====
INSERT INTO lb_sales(id, tenant_id, business_id, total_amount, status) VALUES ('00000000-0000-0000-0000-0000000000e1', :'T', :'B', 300, 'COMPLETED');
INSERT INTO lb_payments(tenant_id, business_id, sale_id, payment_method, amount, reference_no, status) VALUES (:'T', :'B', '00000000-0000-0000-0000-0000000000e1', 'MOBILE_MONEY', 300, 'MANU123456', 'COMPLETED');
SELECT chke('10: the same manual code on a second payment is refused by the database', $$INSERT INTO lb_payments(tenant_id, business_id, payment_method, amount, reference_no, status) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','MOBILE_MONEY',100,'MANU123456','COMPLETED')$$, 'uq_lb_payments_mpesa_ref');
SELECT chke('10: ...even when typed differently (case, spaces, dashes)', $$INSERT INTO lb_payments(tenant_id, business_id, payment_method, amount, reference_no, status) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','MOBILE_MONEY',100,'manu-123 456','COMPLETED')$$, 'uq_lb_payments_mpesa_ref');
SELECT chk('cash payments and blank references are not affected by the index', (SELECT count(*) FROM (SELECT 1 FROM lb_payments WHERE payment_method='CASH') x) = 0);
INSERT INTO lb_payments(tenant_id, business_id, payment_method, amount, reference_no, status) VALUES (:'T', :'B', 'CASH', 50, NULL, 'COMPLETED');
INSERT INTO lb_payments(tenant_id, business_id, payment_method, amount, reference_no, status) VALUES (:'T', :'B', 'CASH', 50, NULL, 'COMPLETED');
INSERT INTO lb_payments(tenant_id, business_id, payment_method, amount, reference_no, status) VALUES (:'T', :'B', 'MOBILE_MONEY', 50, '', 'COMPLETED');
INSERT INTO lb_payments(tenant_id, business_id, payment_method, amount, reference_no, status) VALUES (:'T', :'B', 'MOBILE_MONEY', 50, NULL, 'COMPLETED');
SELECT chk('two cash payments and two code-less M-Pesa rows are still allowed', (SELECT count(*) FROM lb_payments WHERE amount = 50) = 4);
INSERT INTO lb_payments(tenant_id, business_id, payment_method, amount, reference_no, status) VALUES (:'T2', '00000000-0000-0000-0000-0000000000b2', 'MOBILE_MONEY', 100, 'MANU123456', 'COMPLETED');
SELECT chk('22: tenant-safe: another business may hold the same string (no cross-tenant collision or leak)', (SELECT count(*) FROM lb_payments WHERE reference_no='MANU123456') = 2);
-- prompted payment whose code was ALREADY typed manually (scenario 12)
SELECT mk('CK-D'); SELECT conf('CK-D', 0, 'manu123456');
SELECT chk('12: prompt confirmed with a code already recorded manually -> parked, NOT applied twice', st('CK-D') = 'NEEDS_ATTENTION' AND (SELECT count(*) FROM lb_payments WHERE tenant_id=:'T' AND reference_no='MANU123456') = 1);
SELECT chk('12: the parked request says which sale already has the code', (SELECT result_desc FROM lb_mpesa_transactions WHERE checkout_request_id='CK-D') LIKE '%already recorded on sale 00000000-0000-0000-0000-0000000000e1%');
-- manual code equal to a prompted payment's code
SELECT chke('12: a manual code equal to a prompted payment''s code is refused', $$INSERT INTO lb_payments(tenant_id, business_id, payment_method, amount, reference_no, status) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','MOBILE_MONEY',100,'shk7x9abcd','COMPLETED')$$, 'uq_lb_payments_mpesa_ref');

-- ===== 22. cross-tenant: a callback only ever touches the request it names =====
SELECT mk('CK-X', 500, :'T2');
SELECT conf('CK-X', 0, 'TEN2CODE01');
SELECT chk('22: tenant 2''s confirmation created tenant 2''s payment only', (SELECT count(*) FROM lb_payments WHERE reference_no='TEN2CODE01' AND tenant_id=:'T2') = 1 AND (SELECT count(*) FROM lb_payments WHERE reference_no='TEN2CODE01' AND tenant_id=:'T') = 0);
SELECT chke('callback for an unknown checkout id is refused', $$SELECT confirm_mpesa_payment('NOPE', 0, 'x', 'ABC12345XY', '{}')$$, 'No M-Pesa transaction found');

-- ===== 21. who may configure / prompt (staff session simulated) =====
SET test.pos = 'on'; SET test.perms = 'sales.create';
SELECT chke('21: a cashier (sales.create only) cannot create M-Pesa config', $$INSERT INTO lb_mpesa_config(tenant_id, business_id, shortcode) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','123456')$$, '42501');
SET test.perms = 'settings.manage';
INSERT INTO lb_mpesa_config(tenant_id, business_id, shortcode) VALUES (:'T', :'B', '123456');
SELECT chk('21: a manager (settings.manage) can', (SELECT count(*) FROM lb_mpesa_config) = 1);
SET test.perms = 'sales.create';
SELECT chke('21: a cashier cannot switch M-Pesa on/off or change the shortcode', $$UPDATE lb_mpesa_config SET is_active = true, shortcode = '999999'$$, '42501');
SELECT chke('21: a cashier cannot delete the config', $$DELETE FROM lb_mpesa_config$$, '42501');
SELECT mk('CK-P');
SELECT chk('a cashier CAN start a prompt (sales.create)', st('CK-P') = 'PENDING');
SET test.perms = 'reports.export';
SELECT chke('a role with no sales/payment permission cannot start a prompt', $$INSERT INTO lb_mpesa_transactions(tenant_id, business_id, phone, amount, cart_snapshot, checkout_request_id) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','254712345678',10,'[]','CK-DENY')$$, '42501');
SET test.pos = 'off';

-- ===== grants =====
SELECT chk('confirm_mpesa_payment is still locked down (service_role only)', has_function_privilege('service_role', 'confirm_mpesa_payment(text,integer,text,text,jsonb)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'confirm_mpesa_payment(text,integer,text,text,jsonb)', 'EXECUTE') AND NOT has_function_privilege('anon', 'confirm_mpesa_payment(text,integer,text,text,jsonb)', 'EXECUTE'));

SELECT 'TOTAL ' || count(*) || ' FAIL ' || count(*) FILTER (WHERE NOT ok) FROM t_res;
