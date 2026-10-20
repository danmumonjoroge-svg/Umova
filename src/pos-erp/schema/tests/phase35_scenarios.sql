-- Scenarios for phase35 on a SCRATCH database (run by phase35_run.sh). Results land in t_res.
CREATE TABLE t_res (n serial, name text, ok boolean);
GRANT ALL ON t_res TO PUBLIC; GRANT USAGE ON SEQUENCE t_res_n_seq TO PUBLIC;
CREATE FUNCTION chk(p_name text, p_ok boolean) RETURNS void LANGUAGE sql AS $$ INSERT INTO t_res(name, ok) VALUES (p_name, coalesce(p_ok, false)) $$;
CREATE FUNCTION try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE p_sql; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
GRANT EXECUTE ON FUNCTION chk(text, boolean), try(text) TO PUBLIC;
CREATE FUNCTION as_user(t text, perms text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.tenant', t, false), set_config('test.perms', perms, false) $$;

\set T1 '00000000-0000-0000-0000-0000000000a1'
\set T2 '00000000-0000-0000-0000-0000000000a2'
\set B1 '00000000-0000-0000-0000-0000000000b1'
\set B2 '00000000-0000-0000-0000-0000000000b2'
INSERT INTO lb_businesses VALUES (:'B1', :'T1'), (:'B2', :'T2');
INSERT INTO lb_customers (id, tenant_id, business_id, name, outstanding_balance) VALUES
  ('00000000-0000-0000-0000-0000000000c1', :'T1', :'B1', 'Wanjiru', 1000), ('00000000-0000-0000-0000-0000000000c2', :'T2', :'B2', 'Other shop customer', 500);
INSERT INTO lb_products VALUES ('00000000-0000-0000-0000-0000000000d1', :'T1', true, 5), ('00000000-0000-0000-0000-0000000000d2', :'T1', false, 0), ('00000000-0000-0000-0000-0000000000d3', :'T2', true, 0);
INSERT INTO lb_warehouses VALUES ('00000000-0000-0000-0000-0000000000e1', :'T1', true), ('00000000-0000-0000-0000-0000000000e2', :'T2', true);

SELECT as_user(:'T1', 'expenses.record payments.record inventory.adjust sales.create');

-- ---- expenses ----
SELECT pos_apply_expense('exp-ref-0001', :'B1', null, null, current_date, 250, 'CASH', 'Cartons', null, 'PAID', null) AS r1 \gset
SELECT pos_apply_expense('exp-ref-0001', :'B1', null, null, current_date, 250, 'CASH', 'Cartons', null, 'PAID', null) AS r2 \gset
SELECT chk('expense: same reference twice saves ONE expense', (SELECT count(*) FROM lb_expenses WHERE description = 'Cartons') = 1);
SELECT chk('expense: the retry returns the same id and says duplicate=true', (:'r1'::jsonb ->> 'id') = (:'r2'::jsonb ->> 'id') AND (:'r2'::jsonb ->> 'duplicate') = 'true' AND (:'r1'::jsonb ->> 'duplicate') = 'false');
SELECT chk('expense: same reference with a DIFFERENT amount is refused (P0409), nothing saved',
  try($$ SELECT pos_apply_expense('exp-ref-0001', '00000000-0000-0000-0000-0000000000b1', null, null, current_date, 999, 'CASH', 'Cartons', null, 'PAID', null) $$) = 'P0409'
  AND (SELECT count(*) FROM lb_expenses) = 1);
SELECT chk('expense: invalid amount fails', try($$ SELECT pos_apply_expense('exp-ref-0002', '00000000-0000-0000-0000-0000000000b1', null, null, current_date, 0, 'CASH', 'Zero', null, 'PAID', null) $$) = '22023');
SELECT chk('expense: a FAILED attempt does not use up the reference (claim rolled back)', (SELECT count(*) FROM pos_client_ops WHERE client_reference = 'exp-ref-0002') = 0);
SELECT chk('expense: the same reference then works once corrected', try($$ SELECT pos_apply_expense('exp-ref-0002', '00000000-0000-0000-0000-0000000000b1', null, null, current_date, 80, 'CASH', 'Zero', null, 'PAID', null) $$) = 'OK');
SELECT chk('expense: reference too short is refused', try($$ SELECT pos_apply_expense('x', '00000000-0000-0000-0000-0000000000b1', null, null, current_date, 80, 'CASH', 'Short', null, 'PAID', null) $$) = '22023');
SELECT chk('expense: another business id is refused', try($$ SELECT pos_apply_expense('exp-ref-0003', '00000000-0000-0000-0000-0000000000b2', null, null, current_date, 80, 'CASH', 'Cross', null, 'PAID', null) $$) = '42501');
SELECT as_user(:'T1', 'sales.create');
SELECT chk('expense: no expenses.record permission => refused (42501)', try($$ SELECT pos_apply_expense('exp-ref-0004', '00000000-0000-0000-0000-0000000000b1', null, null, current_date, 80, 'CASH', 'NoPerm', null, 'PAID', null) $$) = '42501');
SELECT as_user(:'T1', 'expenses.record payments.record inventory.adjust sales.create');

-- ---- customer payments ----
SELECT chk('payment: first call ok', try($$ SELECT pos_apply_customer_payment('pay-ref-0001', '00000000-0000-0000-0000-0000000000b1', null, '00000000-0000-0000-0000-0000000000c1', 200, 'CASH', null, null, null) $$) = 'OK');
SELECT chk('payment: retry does nothing', try($$ SELECT pos_apply_customer_payment('pay-ref-0001', '00000000-0000-0000-0000-0000000000b1', null, '00000000-0000-0000-0000-0000000000c1', 200, 'CASH', null, null, null) $$) = 'OK');
SELECT chk('payment: balance reduced ONCE (1000 -> 800) and one payment row',
  (SELECT outstanding_balance FROM lb_customers WHERE name = 'Wanjiru') = 800 AND (SELECT count(*) FROM lb_customer_payments) = 1);
SELECT chk('payment: a reference used for an expense cannot be reused for a payment (P0409)',
  try($$ SELECT pos_apply_customer_payment('exp-ref-0001', '00000000-0000-0000-0000-0000000000b1', null, '00000000-0000-0000-0000-0000000000c1', 200, 'CASH', null, null, null) $$) = 'P0409');
SELECT chk('payment: another business''s customer is refused and its balance untouched',
  try($$ SELECT pos_apply_customer_payment('pay-ref-0002', '00000000-0000-0000-0000-0000000000b1', null, '00000000-0000-0000-0000-0000000000c2', 100, 'CASH', null, null, null) $$) = '42501'
  AND (SELECT outstanding_balance FROM lb_customers WHERE name = 'Other shop customer') = 500);

-- ---- new customer, then a payment queued for it (order: customer first) ----
SELECT chk('customer: created with the phone''s own id', try($$ SELECT pos_create_customer('cus-ref-0001', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', 'Njeri', '0712000111', null, null, 'CREDIT', 5000, null) $$) = 'OK');
SELECT chk('customer: retry creates no second row', try($$ SELECT pos_create_customer('cus-ref-0001', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', 'Njeri', '0712000111', null, null, 'CREDIT', 5000, null) $$) = 'OK'
  AND (SELECT count(*) FROM lb_customers WHERE name = 'Njeri') = 1);
SELECT chk('customer: a payment for the new customer works', try($$ SELECT pos_apply_customer_payment('pay-ref-0003', '00000000-0000-0000-0000-0000000000b1', null, '00000000-0000-0000-0000-0000000000f1', 50, 'CASH', null, null, null) $$) = 'OK');
SELECT chk('customer: a payment for a customer that does not exist (yet) is refused, not lost silently', try($$ SELECT pos_apply_customer_payment('pay-ref-0004', '00000000-0000-0000-0000-0000000000b1', null, '00000000-0000-0000-0000-0000000000ff', 50, 'CASH', null, null, null) $$) = '42501');

-- ---- stock adjustments ----
SELECT chk('stock: +10 on a new item', try($$ SELECT pos_apply_stock_adjustment('stk-ref-0001', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1', 'STOCK_ADJUSTMENT', 10, 'found', null) $$) = 'OK');
SELECT chk('stock: the same reference again changes nothing', try($$ SELECT pos_apply_stock_adjustment('stk-ref-0001', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1', 'STOCK_ADJUSTMENT', 10, 'found', null) $$) = 'OK'
  AND (SELECT quantity FROM lb_inventory WHERE product_id = '00000000-0000-0000-0000-0000000000d1') = 10);
SELECT try($$ SELECT pos_apply_stock_adjustment('stk-ref-0002', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1', 'DAMAGED', -4, 'dropped', null) $$) AS s2 \gset
SELECT chk('stock: a second phone''s change ADDS UP (10 - 4 = 6), not overwrites', :'s2' = 'OK' AND (SELECT quantity FROM lb_inventory WHERE product_id = '00000000-0000-0000-0000-0000000000d1') = 6);
SELECT pos_apply_stock_adjustment('stk-ref-0003', :'B1', '00000000-0000-0000-0000-0000000000d1', 'STOCK_ADJUSTMENT', -20, 'count correction', null) AS sneg \gset
SELECT chk('stock: going below zero is ACCEPTED and flagged negative=true', (:'sneg'::jsonb ->> 'negative') = 'true' AND (:'sneg'::jsonb ->> 'quantity') = '-14');
SELECT chk('stock: stored quantity always equals the sum of its movements', (SELECT quantity FROM lb_inventory WHERE product_id = '00000000-0000-0000-0000-0000000000d1') = (SELECT sum(quantity) FROM lb_stock_movements WHERE product_id = '00000000-0000-0000-0000-0000000000d1') AND (SELECT count(*) FROM lb_stock_movements) = 3);
SELECT chk('stock: DAMAGED with a positive quantity is refused', try($$ SELECT pos_apply_stock_adjustment('stk-ref-0004', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1', 'DAMAGED', 5, 'x', null) $$) = '22023');
SELECT chk('stock: an item that is not tracked is skipped, no stock row made', try($$ SELECT pos_apply_stock_adjustment('stk-ref-0005', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d2', 'STOCK_ADJUSTMENT', 3, 'x', null) $$) = 'OK'
  AND (SELECT count(*) FROM lb_inventory WHERE product_id = '00000000-0000-0000-0000-0000000000d2') = 0);
SELECT chk('stock: another business''s item is refused', try($$ SELECT pos_apply_stock_adjustment('stk-ref-0006', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d3', 'STOCK_ADJUSTMENT', 3, 'x', null) $$) = '42501'
  AND (SELECT count(*) FROM lb_inventory WHERE product_id = '00000000-0000-0000-0000-0000000000d3') = 0);
SELECT as_user(:'T1', 'sales.create expenses.record');
SELECT chk('stock: no inventory.adjust permission => refused', try($$ SELECT pos_apply_stock_adjustment('stk-ref-0007', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1', 'STOCK_ADJUSTMENT', 1, 'x', null) $$) = '42501');

-- ---- tenant isolation of the ledger ----
SELECT as_user(:'T2', 'expenses.record payments.record inventory.adjust sales.create');
SELECT pos_apply_expense('exp-ref-0001', :'B2', null, null, current_date, 70, 'CASH', 'Shop2 expense', null, 'PAID', null) ->> 'duplicate' AS dup2 \gset
SELECT chk('isolation: business 2 may use the SAME reference text as business 1 and gets its OWN expense',
  :'dup2' = 'false' AND (SELECT count(*) FROM lb_expenses WHERE tenant_id = '00000000-0000-0000-0000-0000000000a2') = 1 AND (SELECT count(*) FROM lb_expenses WHERE tenant_id = '00000000-0000-0000-0000-0000000000a1') = 2);
SELECT chk('isolation: the unique key is per business', (SELECT count(*) FROM pos_client_ops WHERE client_reference = 'exp-ref-0001') = 2);
SELECT as_user('', 'expenses.record');
SELECT chk('isolation: a session with NO business is refused', try($$ SELECT pos_apply_expense('exp-ref-0009', '00000000-0000-0000-0000-0000000000b1', null, null, current_date, 80, 'CASH', 'x', null, 'PAID', null) $$) = '42501');
SELECT as_user(:'T1', 'expenses.record payments.record inventory.adjust sales.create');

-- ---- who can touch what (real database roles) ----
SET ROLE authenticated;
SELECT chk('access: a signed-in user cannot read the ledger table directly', try($$ SELECT * FROM pos_client_ops $$) = '42501');
SELECT chk('access: a signed-in user cannot write the ledger table directly', try($$ INSERT INTO pos_client_ops (tenant_id, client_reference, kind, request_hash) VALUES (gen_random_uuid(), 'hack-ref-001', 'expense', 'x') $$) = '42501');
SELECT chk('access: a signed-in user cannot call the internal claim function', try($$ SELECT _pos_claim_op('expense', 'hack-ref-002', 'x') $$) = '42501');
SELECT chk('access: a signed-in user CAN call the wrapper', try($$ SELECT pos_apply_expense('exp-ref-0010', '00000000-0000-0000-0000-0000000000b1', null, null, current_date, 15, 'CASH', 'viaAuth', null, 'PAID', null) $$) = 'OK');
SET ROLE anon;
SELECT chk('access: anonymous callers cannot call the wrapper', try($$ SELECT pos_apply_expense('exp-ref-0011', '00000000-0000-0000-0000-0000000000b1', null, null, current_date, 15, 'CASH', 'viaAnon', null, 'PAID', null) $$) = '42501');
SELECT chk('access: anonymous callers cannot call the stock wrapper', try($$ SELECT pos_apply_stock_adjustment('stk-ref-0012', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1', 'STOCK_ADJUSTMENT', 1, 'x', null) $$) = '42501');
RESET ROLE;
