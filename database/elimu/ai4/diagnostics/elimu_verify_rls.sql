-- ELIMU FINANCE - POST-MIGRATION RLS/GRANT AUDIT. Read-only. Run after E011. Expect zero rows from each query.
-- 1) tables without RLS
SELECT c.relname AS table_without_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'elimu\_fin\_%' AND NOT c.relrowsecurity;
-- 2) tables an API role can write directly
SELECT c.relname AS api_writable_table, r.rolname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_roles r
 WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'elimu\_fin\_%' AND r.rolname IN ('anon','authenticated') AND has_table_privilege(r.rolname, c.oid, 'INSERT,UPDATE,DELETE');
-- 3) anon can read
SELECT c.relname AS anon_readable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'elimu\_fin\_%' AND has_table_privilege('anon', c.oid, 'SELECT');
-- 4) internal helpers an API role can execute
SELECT p.oid::regprocedure AS callable_internal FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN pg_roles r
 WHERE n.nspname='public' AND p.proname LIKE '\_elimu\_fin\_%' AND r.rolname IN ('anon','authenticated') AND has_function_privilege(r.rolname, p.oid, 'EXECUTE');
-- 5) public functions anon can execute
SELECT p.oid::regprocedure AS anon_callable FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'elimu\_fin\_%' AND has_function_privilege('anon', p.oid, 'EXECUTE');
-- 6) SECURITY DEFINER functions without a pinned search_path
SELECT p.oid::regprocedure AS definer_without_search_path FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE '%elimu\_fin\_%' AND p.prosecdef AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%');
