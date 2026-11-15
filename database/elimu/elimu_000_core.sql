-- ============================================================================
-- ELIMU 000 -- UNIFIED CORE (identity, roles, permission check, audit, shared helpers)
--
-- Run FIRST, before every other Elimu file. Re-runnable. Creates only elimu_* objects; READS (never alters) the POS objects
--   get_current_tenant_id(), is_pos_session(), is_pos_owner(), pos_staff, pos_tenants, pos_audit_log, lb_businesses.
--
-- WHY THIS FILE EXISTS: AI 1-4 each shipped their own elimu_can / elimu_require / elimu_audit / role table / helpers with
-- DIFFERENT behaviour under the same names (matrix C1-C15). Installing them in sequence silently replaced one another.
-- There is now exactly ONE of each, here:
--   * ONE role table            elimu_staff_roles           (owner-managed)
--   * ONE role -> action map    elimu_role_actions(role)    (every action string any module asks for)
--   * ONE permission check      elimu_can(action)
--   * ONE guard                 elimu_require(VARIADIC actions)   -- ANY-OF
--   * audit overloads           elimu_audit()  trigger form (AI 1)
--                               elimu_audit(text,text,uuid,jsonb)                 meta form (AI 2)
--                               elimu_audit(text,text,uuid,jsonb,jsonb,text)      previous/new/reason form (AI 3)
--
-- DECISION D2 (Option A): every Elimu action -- including finance -- is granted through Elimu roles. Existing POS staff
-- permission keys (payments.record ...) no longer decide anything inside Elimu. The business OWNER always passes.
-- DECISION D1: fail CLOSED. Rules, in order:
--     1. Supabase service role (JWT role or database role)           -> allowed
--     2. a trusted DIRECT database connection (session role "none":   -> allowed   [DEVIATION FROM THE MATRIX: needed so
--        migrations, the SQL editor and test fixtures can run;          that migrations/seeding work. The API never runs as
--        PostgREST always does SET ROLE authenticated|anon)             'none'. Remove this line to be stricter.]
--     3. any other non-POS session (anon, a parent portal, ...)      -> DENIED
--     4. POS owner of the tenant                                     -> allowed
--     5. active staff with an Elimu role granting the action         -> allowed
--     6. everything else                                             -> DENIED
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.get_current_tenant_id()') IS NULL
     OR to_regprocedure('public.is_pos_session()') IS NULL
     OR to_regprocedure('public.is_pos_owner()') IS NULL
     OR to_regclass('public.pos_staff') IS NULL
     OR to_regclass('public.pos_tenants') IS NULL
     OR to_regclass('public.pos_audit_log') IS NULL
     OR to_regclass('public.lb_businesses') IS NULL THEN
    RAISE EXCEPTION 'The POS tenant/permission objects were not found. Elimu builds on them and must not run without them.';
  END IF;
END $$;


-- ---------------------------------------------------------------- small shared helpers
CREATE OR REPLACE FUNCTION elimu_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION elimu_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION elimu_staff_id() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(auth.jwt() ->> 'pos_staff_id', '')::uuid $$;

-- no-collision sentinel so NULL can take part in a UNIQUE index
CREATE OR REPLACE FUNCTION elimu_nil() RETURNS uuid LANGUAGE sql IMMUTABLE
AS $$ SELECT '00000000-0000-0000-0000-000000000000'::uuid $$;

-- Academic records are never deleted by a signed-in POS session (history must survive). Deactivate / end / void instead.
CREATE OR REPLACE FUNCTION elimu_block_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF is_pos_session() THEN
    RAISE EXCEPTION 'Records cannot be deleted. Deactivate or end them instead (%).', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;

-- The signed-in session's tenant, or an error. RPCs never trust a tenant passed in by the client.
CREATE OR REPLACE FUNCTION elimu_tenant() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id();
BEGIN
  IF t IS NULL THEN RAISE EXCEPTION 'No school (tenant) on this session.' USING ERRCODE = '42501'; END IF;
  RETURN t;
END $$;
GRANT EXECUTE ON FUNCTION elimu_tenant() TO authenticated;

-- The school (lb_businesses row) of the tenant. D3: ONE SCHOOL PER TENANT -- this returns the earliest business.
CREATE OR REPLACE FUNCTION elimu_business() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM lb_businesses WHERE tenant_id = get_current_tenant_id() ORDER BY id LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION elimu_business() TO authenticated;

-- ---------------------------------------------------------------- roles
CREATE TABLE IF NOT EXISTS elimu_staff_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  business_id uuid,
  staff_id    uuid NOT NULL REFERENCES pos_staff(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN (
    'school_admin','principal','deputy','headteacher','academic_admin','exams_officer','class_teacher','subject_teacher',
    'attendance_officer','registrar','secretary','bursar','accountant','cashier','auditor','staff')),
  granted_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, staff_id, role)
);
CREATE INDEX IF NOT EXISTS idx_elimu_staff_roles_staff ON elimu_staff_roles (tenant_id, staff_id);

-- FINANCE CONFIGURATION (fee items, structures, settings) is deliberately NOT held by bursar/accountant: it was settings.manage in the
-- POS-key mapping (owner/manager only); here it is school_admin + principal + the owner. Grant it explicitly if a school wants a bursar to configure.
-- Action sets are built from named groups so the table below stays readable. Every action string any module checks is in
-- exactly one group. Unknown action => false.
CREATE OR REPLACE FUNCTION elimu_role_actions(p_role text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  WITH g AS (SELECT
    -- AI 1 foundation
    ARRAY['students.view','guardians.view','admissions.view','structure.view','enrollment.view','comms.history'] AS found_view,
    ARRAY['students.manage','students.care','guardians.manage','admissions.manage','enrollment.manage'] AS found_records,
    ARRAY['structure.manage','admissions.decide','settings.manage'] AS found_admin,
    -- messaging (AI 1 / AI 3 spell it comms.send, AI 2 spells it comm.send; both stay valid)
    ARRAY['comms.send','comm.send'] AS msg,
    -- AI 2 academics
    ARRAY['academic.access','view.all','marks.manage_all','assessment.create','marks.enter','marks.unlock','assessment.lock','results.compute','reportcard.review'] AS acad_ops,
    ARRAY['config.manage','reportcard.approve','reportcard.publish'] AS acad_lead,
    ARRAY['reportcard.correct','remarks.head'] AS acad_head,
    ARRAY['academic.access','comm.send','assessment.create','marks.enter'] AS acad_teach,
    -- AI 3 attendance / timetable / calendar
    ARRAY['attendance.take_any','attendance.take_own','attendance.view_all','attendance.amend','absence.manage','absence.approve',
          'reports.view','timetable.view','timetable.manage','timetable.override','calendar.view','calendar.manage','roles.view'] AS att_all,
    ARRAY['attendance.take_own','timetable.view','calendar.view'] AS att_own,
    -- AI 4 finance
    ARRAY['finance.view','finance.report'] AS fin_read,
    ARRAY['finance.collect'] AS fin_collect,
    ARRAY['finance.bill','finance.approve','finance.reconcile','finance.expense','finance.audit'] AS fin_manage
  )
  SELECT CASE p_role
    WHEN 'school_admin'  THEN (SELECT found_view||found_records||found_admin||msg||acad_ops||acad_lead||att_all||fin_read||ARRAY['finance.configure'] FROM g)
    WHEN 'principal'     THEN (SELECT found_view||found_records||found_admin||msg||acad_ops||acad_lead||acad_head||att_all||fin_read||ARRAY['finance.configure','finance.approve','finance.audit'] FROM g)
    WHEN 'headteacher'   THEN (SELECT found_view||found_records||found_admin||msg||acad_ops||acad_lead||acad_head||att_all||fin_read FROM g)
    WHEN 'deputy'        THEN (SELECT found_view||found_records||msg||acad_ops||att_all FROM g)
    WHEN 'academic_admin' THEN (SELECT found_view||msg||acad_ops||acad_lead||ARRAY['timetable.view','calendar.view','attendance.view_all','reports.view'] FROM g)
    WHEN 'exams_officer' THEN (SELECT found_view||msg||acad_ops||ARRAY['timetable.view','calendar.view'] FROM g)
    WHEN 'class_teacher' THEN (SELECT ARRAY['students.view','guardians.view','structure.view','enrollment.view','comms.history']||msg||acad_teach||ARRAY['attendance.take_own','absence.manage','timetable.view','calendar.view'] FROM g)
    WHEN 'subject_teacher' THEN (SELECT ARRAY['students.view','structure.view','enrollment.view']||acad_teach||att_own FROM g)
    WHEN 'attendance_officer' THEN (SELECT found_view||msg||ARRAY['attendance.take_any','attendance.take_own','attendance.view_all','absence.manage','reports.view','timetable.view','calendar.view'] FROM g)
    WHEN 'registrar'     THEN (SELECT found_view||found_records||msg||ARRAY['structure.manage','admissions.decide','calendar.view'] FROM g)
    WHEN 'secretary'     THEN (SELECT found_view||msg||ARRAY['students.manage','guardians.manage','admissions.manage','calendar.view','calendar.manage'] FROM g)
    WHEN 'bursar'        THEN (SELECT ARRAY['students.view','guardians.view','structure.view','enrollment.view']||fin_read||fin_collect||fin_manage FROM g)
    WHEN 'accountant'    THEN (SELECT ARRAY['students.view','structure.view','enrollment.view']||fin_read||ARRAY['finance.reconcile','finance.expense','finance.audit'] FROM g)
    WHEN 'cashier'       THEN (SELECT ARRAY['students.view','structure.view','enrollment.view','finance.view']||fin_collect FROM g)
    WHEN 'auditor'       THEN (SELECT ARRAY['students.view','structure.view','finance.view','finance.report','finance.audit','reports.view'] FROM g)
    WHEN 'staff'         THEN (SELECT ARRAY['timetable.view','calendar.view'] FROM g)
    ELSE ARRAY[]::text[]
  END
$$;

-- ---------------------------------------------------------------- identity checks
-- Signed in as an ACTIVE staff member of an APPROVED business, and the JWT tenant matches the staff row.
CREATE OR REPLACE FUNCTION elimu_staff_ok() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM pos_staff s JOIN pos_tenants t ON t.id = s.pos_tenant_id
     WHERE s.id = elimu_staff_id()
       AND s.status = 'active'
       AND coalesce(t.status, 'active') NOT IN ('pending', 'rejected', 'suspended')
       AND s.pos_tenant_id = get_current_tenant_id())
$$;

CREATE OR REPLACE FUNCTION elimu_is_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT elimu_staff_ok() AND is_pos_owner() $$;

CREATE OR REPLACE FUNCTION elimu_has_role(p_role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT elimu_staff_ok() AND EXISTS (
    SELECT 1 FROM elimu_staff_roles r
     WHERE r.staff_id = elimu_staff_id() AND r.tenant_id = get_current_tenant_id() AND r.role = lower(p_role))
$$;

-- ---------------------------------------------------------------- THE permission check
CREATE OR REPLACE FUNCTION elimu_can(p_action text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_db_role text := coalesce(nullif(current_setting('role', true), ''), 'none');
BEGIN
  IF v_db_role = 'service_role' OR coalesce(auth.jwt() ->> 'role', '') = 'service_role' THEN RETURN true; END IF;
  IF NOT is_pos_session() THEN
    RETURN v_db_role = 'none';              -- trusted direct connection only; anon/authenticated non-POS sessions fail closed
  END IF;
  IF NOT elimu_staff_ok() THEN RETURN false; END IF;
  IF is_pos_owner() THEN RETURN true; END IF;
  RETURN EXISTS (
    SELECT 1 FROM elimu_staff_roles r
     WHERE r.staff_id = elimu_staff_id() AND r.tenant_id = get_current_tenant_id()
       AND p_action = ANY (elimu_role_actions(r.role)));
END $$;
REVOKE ALL ON FUNCTION elimu_can(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION elimu_can(text) TO authenticated;

-- Raise 42501 unless the caller may do ANY of the actions.
CREATE OR REPLACE FUNCTION elimu_require(VARIADIC p_actions text[]) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a text;
BEGIN
  FOREACH a IN ARRAY p_actions LOOP
    IF elimu_can(a) THEN RETURN; END IF;
  END LOOP;
  RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION elimu_require(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION elimu_require(text[]) TO authenticated;

-- AI 2's "any academic role at all" hook (read access to academic set-up data); the 'academic.access' action is held by every academic role
CREATE OR REPLACE FUNCTION elimu_any_role() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT elimu_can('academic.access') $$;

-- Finance bridge: the finance module's action words map 1:1 onto 'finance.<action>'.
CREATE OR REPLACE FUNCTION elimu_fin_can(p_action text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT elimu_can('finance.' || lower(p_action)) $$;

-- ---------------------------------------------------------------- audit (reuses pos_audit_log; nothing new)
-- A. AI 2 meta form
CREATE OR REPLACE FUNCTION elimu_audit(p_action text, p_entity_type text, p_entity_id uuid, p_meta jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO pos_audit_log (pos_tenant_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (get_current_tenant_id(), 'staff', elimu_staff_id(), p_action, p_entity_type, p_entity_id, coalesce(p_meta, '{}'::jsonb))
$$;
-- B. AI 3 previous/new/reason form.  p_new has NO default so a 4-argument call can only mean form A.
CREATE OR REPLACE FUNCTION elimu_audit(p_action text, p_entity_type text, p_entity_id uuid, p_previous jsonb, p_new jsonb, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO pos_audit_log (pos_tenant_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (elimu_tenant(), 'staff', elimu_staff_id(), p_action, p_entity_type, p_entity_id,
          jsonb_strip_nulls(jsonb_build_object('previous', p_previous, 'new', p_new, 'reason', p_reason, 'module', 'elimu')));
END $$;
REVOKE ALL ON FUNCTION elimu_audit(text, text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION elimu_audit(text, text, uuid, jsonb, jsonb, text) FROM PUBLIC;
-- C. the AI 1 TRIGGER form elimu_audit() is created in 001_elimu_academic_structure.sql (different signature; no clash).

-- ---------------------------------------------------------------- RLS on roles
-- Read: own roles, or anyone who may view roles. Write: OWNER (or service role) only.
ALTER TABLE elimu_staff_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_roles_read ON elimu_staff_roles;
CREATE POLICY elimu_roles_read ON elimu_staff_roles FOR SELECT
  USING (tenant_id = get_current_tenant_id() AND (staff_id = elimu_staff_id() OR elimu_can('roles.view')));
DROP POLICY IF EXISTS elimu_roles_owner_write ON elimu_staff_roles;
CREATE POLICY elimu_roles_owner_write ON elimu_staff_roles FOR ALL
  USING (tenant_id = get_current_tenant_id() AND (is_pos_owner() OR coalesce(auth.jwt() ->> 'role', '') = 'service_role'))
  WITH CHECK (tenant_id = get_current_tenant_id() AND (is_pos_owner() OR coalesce(auth.jwt() ->> 'role', '') = 'service_role'));
GRANT SELECT, INSERT, UPDATE, DELETE ON elimu_staff_roles TO authenticated;

-- Owner-only: grant / revoke an Elimu role. (AI 2's elimu_set_academic_role and AI 3's role UI both call this.)
CREATE OR REPLACE FUNCTION elimu_set_role(p_staff uuid, p_role text, p_granted boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text := lower(p_role); t uuid := get_current_tenant_id();
BEGIN
  IF NOT (elimu_is_owner() OR elimu_can('roles.manage') AND NOT is_pos_session()) THEN
    RAISE EXCEPTION 'Only the business owner can give Elimu roles.' USING ERRCODE = '42501';
  END IF;
  IF elimu_role_actions(v_role) = ARRAY[]::text[] THEN RAISE EXCEPTION 'Unknown role.' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pos_staff WHERE id = p_staff AND pos_tenant_id = t) THEN RAISE EXCEPTION 'Staff member not found.' USING ERRCODE = 'P0002'; END IF;
  IF p_granted THEN
    INSERT INTO elimu_staff_roles (tenant_id, business_id, staff_id, role, granted_by) VALUES (t, elimu_business(), p_staff, v_role, elimu_staff_id()) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM elimu_staff_roles WHERE staff_id = p_staff AND role = v_role AND tenant_id = t;
  END IF;
  PERFORM elimu_audit('ELIMU_ROLE_CHANGED', 'pos_staff', p_staff, jsonb_build_object('role', v_role, 'granted', p_granted));
  RETURN jsonb_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION elimu_set_role(uuid, text, boolean) TO authenticated;

-- ---------------------------------------------------------------- privileges for the core objects only
-- (each module scopes its own grants; nothing sweeps other modules' objects)
DO $$
DECLARE f text; has_anon boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
        has_auth boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  FOREACH f IN ARRAY ARRAY['elimu_staff_id()','elimu_nil()','elimu_staff_ok()','elimu_is_owner()','elimu_has_role(text)','elimu_role_actions(text)',
                           'elimu_any_role()','elimu_fin_can(text)','elimu_set_role(uuid,text,boolean)','elimu_tenant()','elimu_business()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF has_anon THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f); END IF;
    IF has_auth THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f); END IF;
  END LOOP;
  EXECUTE 'REVOKE ALL ON elimu_staff_roles FROM PUBLIC';
  IF has_anon THEN EXECUTE 'REVOKE ALL ON elimu_staff_roles FROM anon'; END IF;
END $$;
