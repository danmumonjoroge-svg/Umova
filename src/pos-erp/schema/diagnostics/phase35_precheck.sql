-- phase35_precheck.sql  --  READ-ONLY. Run on STAGING (or a copy of your data) BEFORE phase35. Changes nothing.
-- Read every result. Rows returned = something to look at. (Zero rows = nothing found.)
-- If a query errors because a column name differs in your database, tell me the error; do not edit data to make it pass.

-- 1. Sales keys used more than once (phase33 makes the key unique per business; cross-business repeats are fine, same-business are not)
SELECT tenant_id, client_reference, count(*) FROM lb_sales WHERE client_reference IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1;
-- 1b. Same key in DIFFERENT businesses (explains why the old global index was a problem)
SELECT client_reference, count(DISTINCT tenant_id) AS businesses FROM lb_sales WHERE client_reference IS NOT NULL GROUP BY 1 HAVING count(DISTINCT tenant_id) > 1;

-- 2. Likely double-posted expenses (same business, day, amount, method, text)
SELECT tenant_id, expense_date, amount, payment_method, description, count(*) FROM lb_expenses
GROUP BY 1,2,3,4,5 HAVING count(*) > 1 ORDER BY count(*) DESC LIMIT 50;

-- 3. Likely double-posted customer payments (same customer, amount, reference, within the same minute)
SELECT tenant_id, customer_id, amount, reference_no, date_trunc('minute', created_at) AS minute, count(*) FROM lb_customer_payments
GROUP BY 1,2,3,4,5 HAVING count(*) > 1 ORDER BY count(*) DESC LIMIT 50;

-- 4. Likely double-posted stock movements (same item, type, quantity, minute)
SELECT tenant_id, product_id, movement_type, quantity, date_trunc('minute', created_at) AS minute, count(*) FROM lb_stock_movements
GROUP BY 1,2,3,4,5 HAVING count(*) > 1 ORDER BY count(*) DESC LIMIT 50;

-- 5. Stock rows that disagree with their movements (the read-then-write problem). Only items that have movements.
SELECT i.tenant_id, i.product_id, i.warehouse_id, i.quantity AS stored, m.total AS from_movements
FROM lb_inventory i JOIN (SELECT tenant_id, product_id, warehouse_id, sum(quantity) AS total FROM lb_stock_movements GROUP BY 1,2,3) m
  ON m.tenant_id = i.tenant_id AND m.product_id = i.product_id AND m.warehouse_id = i.warehouse_id
WHERE i.quantity <> m.total LIMIT 100;
-- 5b. Negative stock already present
SELECT tenant_id, product_id, quantity FROM lb_inventory WHERE quantity < 0 LIMIT 100;
-- 5c. More than one stock row for the same item+warehouse (would confuse a stock update)
SELECT product_id, warehouse_id, count(*) FROM lb_inventory GROUP BY 1,2 HAVING count(*) > 1;

-- 6. Customers that look duplicated (same business, same phone)
SELECT tenant_id, phone, count(*) FROM lb_customers WHERE phone IS NOT NULL AND phone <> '' GROUP BY 1,2 HAVING count(*) > 1 LIMIT 50;

-- 7. Who can call the money-moving functions today? (look for anon / PUBLIC / authenticated on confirm_mpesa_payment)
SELECT routine_name, grantee, privilege_type FROM information_schema.routine_privileges
WHERE routine_schema = 'public' AND routine_name IN ('confirm_mpesa_payment','record_expense','record_customer_payment','perform_daily_closing')
ORDER BY routine_name, grantee;

-- 8. Is row security on for the tables that matter?
SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('lb_sales','lb_expenses','lb_customers','lb_customer_payments','lb_inventory','lb_stock_movements','lb_products') ORDER BY relname;

-- 9. Does a stock-adjust permission trigger exist? (phase28 guards expenses/payments/products but NOT lb_inventory/lb_stock_movements)
SELECT event_object_table, trigger_name FROM information_schema.triggers WHERE event_object_table IN ('lb_inventory','lb_stock_movements');
