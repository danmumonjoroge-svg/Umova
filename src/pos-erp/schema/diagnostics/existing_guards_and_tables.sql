-- READ-ONLY. One query, one result cell (column "report"). Paste the cell back to me.
select jsonb_pretty(jsonb_build_object(
  'guard_function_definitions', (select coalesce(jsonb_agg(jsonb_build_object('name', p.proname, 'definition', pg_get_functiondef(p.oid))), '[]'::jsonb)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('pos_guard_sale_update','pos_guard_protected_columns','pos_block_direct_change','pos_guard_allowed_columns',
        'pos_guard_sale_discount','pos_guard_zero_on_insert','pos_current_role','pos_require','pos_context','pos_session_live','pos_stamp_audit_row',
        'pos_business_fence','pos_tenant_fence','pos_parent_fence')),
  'other_triggers', (select coalesce(jsonb_agg(jsonb_build_object('table', c.relname, 'def', pg_get_triggerdef(t.oid))), '[]'::jsonb)
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where not t.tgisinternal and n.nspname = 'public'
       and c.relname in ('lb_sales','lb_payments','lb_sale_items','lb_businesses','pos_staff','pos_audit_log','lb_customers','lb_cash_movements','lb_expenses','lb_folio_payments','lb_stock_movements','lb_inventory')
       and pg_get_triggerdef(t.oid) not ilike '%pos_enforce_permission%'),
  'columns', (select jsonb_object_agg(c.relname, (select jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) order by a.attnum)
                 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped))
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname in ('lb_sales','lb_payments','lb_businesses','lb_cash_movements','lb_folio_payments','lb_expenses','lb_mpesa_transactions','pos_tenants')),
  'check_constraints', (select coalesce(jsonb_agg(jsonb_build_object('table', c.relname, 'def', pg_get_constraintdef(k.oid))), '[]'::jsonb)
      from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and k.contype = 'c' and c.relname in ('lb_sales','lb_payments','pos_staff','lb_cash_movements','lb_expenses'))
)) as report;
