-- READ-ONLY checks for double posting. Safe to run in the Supabase SQL editor (SELECT only).
-- Run each block separately and send me the results if anything looks wrong.

-- 1. Sales that look doubled: same cashier, same total, same items count, created within 60 seconds of each other.
SELECT a.id AS sale_a, b.id AS sale_b, a.sale_number AS number_a, b.sale_number AS number_b,
       a.total_amount, a.cashier_id, a.folio_id, a.created_at AS time_a, b.created_at AS time_b
  FROM lb_sales a JOIN lb_sales b
    ON a.id < b.id AND a.tenant_id = b.tenant_id AND a.cashier_id IS NOT DISTINCT FROM b.cashier_id
   AND a.total_amount = b.total_amount AND a.customer_id IS NOT DISTINCT FROM b.customer_id
   AND a.folio_id IS NOT DISTINCT FROM b.folio_id
   AND abs(extract(epoch FROM (a.created_at - b.created_at))) < 60
 WHERE a.status::text <> 'VOIDED' AND b.status::text <> 'VOIDED'
 ORDER BY a.created_at DESC LIMIT 100;

-- 2. Folio lines that look doubled: same folio, description, quantity, amount, within 60 seconds.
SELECT a.folio_id, a.description, a.quantity, a.amount, a.id AS line_a, b.id AS line_b, a.sale_id AS sale_a, b.sale_id AS sale_b, a.created_at, b.created_at
  FROM lb_folio_lines a JOIN lb_folio_lines b
    ON a.id < b.id AND a.folio_id = b.folio_id AND a.description = b.description AND a.quantity = b.quantity AND a.amount = b.amount
   AND abs(extract(epoch FROM (a.created_at - b.created_at))) < 60
 WHERE a.status = 'POSTED' AND b.status = 'POSTED'
 ORDER BY a.created_at DESC LIMIT 100;

-- 3. Stock movements that look doubled: same product, type, quantity and reference, within 60 seconds.
SELECT a.product_id, a.movement_type, a.quantity, a.reference_type, a.reference_id, a.id AS move_a, b.id AS move_b, a.created_at, b.created_at
  FROM lb_stock_movements a JOIN lb_stock_movements b
    ON a.id < b.id AND a.tenant_id = b.tenant_id AND a.product_id = b.product_id AND a.movement_type = b.movement_type
   AND a.quantity = b.quantity AND a.reference_id IS NOT DISTINCT FROM b.reference_id
   AND abs(extract(epoch FROM (a.created_at - b.created_at))) < 60
 ORDER BY a.created_at DESC LIMIT 100;

-- 4. ONE sale with MORE than one stock movement of type SALE per item (a trigger plus the app both posting).
SELECT si.sale_id, si.product_id, count(m.*) AS sale_movements, sum(si.quantity) AS qty_sold
  FROM lb_sale_items si
  JOIN lb_stock_movements m ON m.reference_id = si.sale_id AND m.product_id = si.product_id AND m.movement_type::text = 'SALE'
 GROUP BY si.sale_id, si.product_id
HAVING count(m.*) > count(DISTINCT si.id)
 LIMIT 100;

-- 5. Does the database ALSO post stock or folio lines by itself (a trigger on top of what the app does)?
SELECT c.relname AS table_name, t.tgname AS trigger_name, pg_get_triggerdef(t.oid) AS definition
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
 WHERE NOT t.tgisinternal
   AND c.relname IN ('lb_sales','lb_sale_items','lb_payments','lb_stock_movements','lb_inventory','lb_folio_lines','lb_customer_credit_transactions')
 ORDER BY 1, 2;

-- 6. Stock that disagrees with its own movements (a doubled adjustment shows up here).
SELECT i.product_id, p.name, i.quantity AS shown_quantity, coalesce(sum(m.quantity),0) AS sum_of_movements
  FROM lb_inventory i
  JOIN lb_products p ON p.id = i.product_id
  LEFT JOIN lb_stock_movements m ON m.product_id = i.product_id AND m.warehouse_id = i.warehouse_id
 GROUP BY i.product_id, p.name, i.quantity
HAVING i.quantity <> coalesce(sum(m.quantity),0)
 ORDER BY abs(i.quantity - coalesce(sum(m.quantity),0)) DESC LIMIT 100;
