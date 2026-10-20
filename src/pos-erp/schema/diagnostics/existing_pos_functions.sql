-- READ-ONLY. Run in the Supabase SQL editor and send me the result (all rows).
-- Shows functions that phase 28 would create or replace, and anything that already depends on them.
select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as returns,
       p.prosecdef as security_definer,
       pg_get_functiondef(p.oid) as definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('pos_has_permission','pos_current_staff_id','pos_is_pos_session','pos_current_tenant_id',
                     'pos_my_permissions','pos_list_staff','pos_set_staff_role','pos_set_staff_permission','pos_set_staff_status','pos_staff_guard');

-- policies and other objects that call pos_has_permission today
select schemaname, tablename, policyname, cmd, qual, with_check
  from pg_policies
 where coalesce(qual,'') ilike '%pos_has_permission%' or coalesce(with_check,'') ilike '%pos_has_permission%';

select c.relname as table_name, t.tgname as trigger_name
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where not t.tgisinternal and pg_get_triggerdef(t.oid) ilike '%pos_has_permission%';
