-- network_precheck.sql   READ-ONLY. Run on STAGING before phase36_network.sql and send me every result.
-- It changes nothing. It confirms the live shapes that phase36 relies on, and gives me what I still cannot see in the repo
-- (the base lb_* table definitions) for Phase 6 (buyer purchase order / supplier sale integration).

-- 1. Things phase36 REQUIRES (each must say true) -------------------------------------------------------------
SELECT 'phase28 pos_require'           AS needs, to_regprocedure('pos_require(text[])') IS NOT NULL AS present
UNION ALL SELECT 'phase35 _pos_claim_op',  to_regprocedure('_pos_claim_op(text,text,text)') IS NOT NULL
UNION ALL SELECT 'phase35 _pos_finish_op', to_regprocedure('_pos_finish_op(text,jsonb)') IS NOT NULL
UNION ALL SELECT 'get_current_tenant_id',  to_regprocedure('get_current_tenant_id()') IS NOT NULL
UNION ALL SELECT 'pos_audit_log table',    to_regclass('public.pos_audit_log') IS NOT NULL
UNION ALL SELECT 'pos_tenants table',      to_regclass('public.pos_tenants') IS NOT NULL;

-- 2. Columns phase36 reads (confirm names + types) ------------------------------------------------------------
SELECT table_name, column_name, data_type, udt_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ( (table_name = 'pos_tenants'          AND column_name IN ('id','business_name','phone','status'))
     OR (table_name = 'lb_products'          AND column_name IN ('id','tenant_id','name','barcode','image_url','category_id','unit_id','track_inventory','reorder_level','is_active'))
     OR (table_name = 'lb_product_categories' AND column_name IN ('id','name'))
     OR (table_name = 'lb_product_units'     AND column_name IN ('id','name','code'))
     OR (table_name = 'lb_warehouses'        AND column_name IN ('id','tenant_id','is_default'))
     OR (table_name = 'lb_inventory'         AND column_name IN ('tenant_id','warehouse_id','product_id','quantity','last_movement_at')) )
ORDER BY table_name, column_name;

-- 3. Distinct values phase36 compares against -----------------------------------------------------------------
SELECT 'pos_tenants.status' AS what, status::text AS value, count(*) FROM pos_tenants GROUP BY 1,2
UNION ALL SELECT 'lb_products.is_active', is_active::text, count(*) FROM lb_products GROUP BY 1,2;

-- 4. For Phase 6 (NOT used by phase36): the purchasing / sales / accounting shapes I must integrate with ---------
SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('lb_purchase_orders','lb_purchase_order_items','lb_goods_received_notes','lb_grn_items',
                     'lb_suppliers','lb_supplier_payments','lb_sales','lb_sale_items','lb_stock_movements','lb_customers')
ORDER BY table_name, ordinal_position;

-- 5. Enum values (movement types, PO / sale statuses) ---------------------------------------------------------
SELECT t.typname, string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS labels
FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = 'public'
GROUP BY t.typname ORDER BY t.typname;

-- 6. RLS + policies on the tables above -----------------------------------------------------------------------
SELECT c.relname, c.relrowsecurity AS rls_on
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.relname IN ('lb_products','lb_inventory','lb_suppliers','lb_purchase_orders','lb_goods_received_notes','lb_sales','lb_stock_movements','pos_tenants','pos_audit_log')
ORDER BY 1;
SELECT tablename, policyname, cmd, roles, qual, with_check FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('lb_products','lb_inventory','lb_suppliers','lb_purchase_orders','lb_sales','pos_tenants')
ORDER BY tablename, policyname;

-- 7. Triggers that fire on those tables (they also fire for my functions) -------------------------------------
SELECT event_object_table, trigger_name, action_timing, event_manipulation, action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table IN ('lb_products','lb_inventory','lb_purchase_orders','lb_goods_received_notes','lb_sales','lb_stock_movements','lb_suppliers')
ORDER BY 1, 2;
