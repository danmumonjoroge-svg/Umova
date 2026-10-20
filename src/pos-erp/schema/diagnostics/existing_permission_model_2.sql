-- READ-ONLY. One query, one result cell (column "report"). Paste the cell back to me.
select jsonb_pretty(jsonb_build_object(
  'helper_definitions', (select coalesce(jsonb_agg(jsonb_build_object('name', p.proname, 'args', pg_get_function_identity_arguments(p.oid), 'definition', pg_get_functiondef(p.oid))), '[]'::jsonb)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname in ('_pos_staff_has','_pos_owner_caller','_pos_target','_pos_audit')
        or p.proname ilike 'pos\_%staff%' or p.proname ilike 'pos\_list%')
       and p.proname not in ('pos_set_staff_permission','pos_current_staff_id')),
  'all_pos_function_names', (select jsonb_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' order by p.proname)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname ilike 'pos\_%' or p.proname ilike '\_pos\_%')),
  'permission_triggers', (select coalesce(jsonb_agg(jsonb_build_object('table', c.relname, 'trigger', t.tgname, 'def', pg_get_triggerdef(t.oid))), '[]'::jsonb)
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where not t.tgisinternal and (pg_get_triggerdef(t.oid) ilike '%pos_enforce_permission%' or pg_get_triggerdef(t.oid) ilike '%pos_require_permission_direct%')),
  'policies_on_key_tables', (select coalesce(jsonb_agg(jsonb_build_object('table', tablename, 'policy', policyname, 'cmd', cmd, 'permissive', permissive)), '[]'::jsonb)
      from pg_policies where schemaname = 'public' and tablename in ('pos_staff','pos_audit_log','lb_sales','lb_payments','lb_expenses','lb_businesses','lb_pos_settings','pos_staff_permission_overrides')),
  'audit_log_columns', (select jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) order by a.attnum)
      from pg_attribute a where a.attrelid = to_regclass('public.pos_audit_log') and a.attnum > 0 and not a.attisdropped),
  'staff_roles_in_use', (select coalesce(jsonb_agg(distinct s.role || ' / ' || coalesce(s.role_template,'null')), '[]'::jsonb) from public.pos_staff s)
)) as report;
