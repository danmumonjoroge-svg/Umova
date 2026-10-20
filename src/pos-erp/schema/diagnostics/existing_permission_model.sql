-- READ-ONLY. One query, one result row (the Supabase editor only shows the LAST result, so everything is combined).
-- Copy the single cell it returns (column "report") and paste it to me.
select jsonb_pretty(jsonb_build_object(
  'functions', (select coalesce(jsonb_agg(jsonb_build_object('name', p.proname, 'args', pg_get_function_identity_arguments(p.oid), 'definition', pg_get_functiondef(p.oid))), '[]'::jsonb)
                  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public'
                   and (p.proname in ('pos_has_permission','is_pos_session','pos_current_staff_id','pos_is_pos_session','pos_current_tenant_id','get_current_tenant_id')
                        or p.proname ilike '%permission%')),
  'permission_tables', (select coalesce(jsonb_agg(jsonb_build_object('table', c.relname, 'columns',
                          (select jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) order by a.attnum)
                             from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped))), '[]'::jsonb)
                          from pg_class c join pg_namespace n on n.oid = c.relnamespace
                         where n.nspname = 'public' and c.relkind = 'r' and (c.relname ilike '%permission%' or c.relname = 'pos_staff'))
)) as report;
