-- ============================================================================
-- ELIMU FINANCE  E011  Hardening sweep (run LAST, safe to re-run).
--  1. Every internal helper (_elimu_fin_*) is closed to API roles (Postgres grants EXECUTE to PUBLIC by default).
--  2. Every elimu_fin_* table must have RLS enabled and no write grants for API roles; otherwise this migration FAILS loudly.
-- ============================================================================
DO $$ DECLARE r record; v_bad text := '';
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE '\_elimu\_fin\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
  FOR r IN SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'elimu\_fin\_%' LOOP
    IF NOT r.relrowsecurity THEN v_bad := v_bad || ' ' || r.relname || '(no RLS)'; END IF;
    IF has_table_privilege('authenticated', format('public.%I', r.relname), 'INSERT,UPDATE,DELETE') THEN v_bad := v_bad || ' ' || r.relname || '(writable)'; END IF;
    IF has_table_privilege('anon', format('public.%I', r.relname), 'SELECT') THEN v_bad := v_bad || ' ' || r.relname || '(anon read)'; END IF;
  END LOOP;
  IF v_bad <> '' THEN RAISE EXCEPTION 'Elimu finance hardening failed:%', v_bad; END IF;
END $$;
