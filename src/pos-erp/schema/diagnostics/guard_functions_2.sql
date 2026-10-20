-- READ-ONLY. Changes nothing. Returns ONE cell of JSON: copy it and send it back.
-- Reads the two guard functions not yet seen and every trigger on the tables the new phases touch.
SELECT jsonb_pretty(jsonb_build_object(
  'guard_functions', (SELECT jsonb_agg(jsonb_build_object('name', p.proname, 'definition', pg_get_functiondef(p.oid)))
                        FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('guard_business_identity','guard_pos_staff')),
  'triggers_on_touched_tables', (SELECT jsonb_agg(jsonb_build_object('table', c.relname, 'def', pg_get_triggerdef(t.oid)) ORDER BY c.relname, t.tgname)
                        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                       WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
                         AND c.relname IN ('lb_businesses','lb_sales','lb_payments','pos_audit_log','lb_cash_movements','lb_stock_movements','lb_inventory')),
  'logo_storage_policies', (SELECT jsonb_agg(jsonb_build_object('policy', policyname, 'cmd', cmd, 'permissive', permissive, 'qual', qual, 'check', with_check))
                        FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects')
)) AS report;
