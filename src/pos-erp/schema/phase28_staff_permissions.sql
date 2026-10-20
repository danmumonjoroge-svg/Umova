-- ============================================================
-- Phase 28 -- Small additions on top of the EXISTING permission system.
-- NOT DEPLOYED. Review, then run on STAGING first.
--
-- Your database already has a permission system (pos_all_permissions, pos_role_default_permissions,
-- pos_staff.role_template, pos_staff_permission_overrides, pos_has_permission(text), is_pos_session(),
-- pos_enforce_permission(), and the owner-only staff RPCs pos_list_staff / pos_create_staff /
-- pos_set_staff_template / pos_set_staff_permission / pos_set_staff_status / pos_reset_staff_password).
-- This file does NOT replace any of it. It does not redefine or drop any existing function.
--
-- It adds only:
--   1. pos28_staff_id() / pos28_tenant_id()  -- read the signed-in staff and business straight from the login token.
--      (The older pos_current_staff_id()/pos_current_tenant_id() read session settings that are not always set, so the new
--       reports and workflows do not rely on them.)
--   2. pos_my_access()  -- one call returning {ok, is_owner, role, template, permissions[]} for the app's menus.
--   3. lb_businesses: your guard_business_identity() already protects name, phone, email, address, currency, time zone and logo.
--      This adds what it does not cover: receipt footer, tax settings, settings JSON and status (update), and insert/delete.
--      All need 'settings.manage' (staff sessions only). Your trigger keeps running as before.
--   4. Logo uploads: your business_logos_tenant_* policies already require settings.manage, but the older permissive
--      business_logos_insert_own / update_own / delete_own policies let any staff member in. A restrictive policy closes that.
--   5. pos_audit_log: staff sessions can no longer edit or delete audit rows, and can only add rows for their own business.
-- Staff sessions only. Service-role / SQL-editor / RPC-owner code is unaffected (same behaviour as your other permission triggers).
-- ============================================================

DO $$
BEGIN
  IF to_regprocedure('public.is_pos_session()') IS NULL
     OR to_regprocedure('public.pos_has_permission(text)') IS NULL
     OR to_regprocedure('public.pos_all_permissions()') IS NULL
     OR to_regprocedure('public.pos_enforce_permission()') IS NULL THEN
    RAISE EXCEPTION 'Your existing permission functions were not found. Stop: this file builds on them and must not be run on a database without them.';
  END IF;
  IF to_regclass('public.pos_staff') IS NULL OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pos_staff' AND column_name='role_template') THEN
    RAISE EXCEPTION 'pos_staff.role_template was not found. Stop.';
  END IF;
END $$;

-- 1. Token helpers ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pos28_staff_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt() ->> 'pos_staff_id', '')::uuid $$;

CREATE OR REPLACE FUNCTION pos28_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt() ->> 'pos_tenant_id', '')::uuid $$;

-- 2. What can I do? -----------------------------------------------------------
CREATE OR REPLACE FUNCTION pos_my_access() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s record;
BEGIN
  SELECT id, role, role_template, status INTO s FROM pos_staff WHERE id = pos28_staff_id() AND pos_tenant_id = pos28_tenant_id();
  IF s.id IS NULL OR s.status IS DISTINCT FROM 'active' THEN RETURN jsonb_build_object('ok', false, 'reason', 'NO_SESSION'); END IF;
  RETURN jsonb_build_object('ok', true, 'is_owner', s.role = 'owner', 'role', s.role,
    'template', CASE WHEN s.role = 'owner' THEN 'owner' ELSE coalesce(s.role_template, s.role) END,
    'permissions', to_jsonb(pos_my_permissions()));
END $$;
REVOKE ALL ON FUNCTION pos_my_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pos_my_access() TO authenticated;

-- 3. Business profile: the columns guard_business_identity() does not cover ----------------
CREATE OR REPLACE FUNCTION pos28_guard_business_extras() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF is_pos_session() AND NOT pos_has_permission('settings.manage')
     AND (NEW.receipt_footer, NEW.tax_config, NEW.settings, NEW.status::text)
         IS DISTINCT FROM (OLD.receipt_footer, OLD.tax_config, OLD.settings, OLD.status::text) THEN
    RAISE EXCEPTION 'You do not have permission to change business settings.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF to_regclass('public.lb_businesses') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_pos_perm_lb_businesses_insert ON lb_businesses;
    DROP TRIGGER IF EXISTS trg_pos_perm_lb_businesses_update ON lb_businesses;
    DROP TRIGGER IF EXISTS trg_pos_perm_lb_businesses_delete ON lb_businesses;
    DROP TRIGGER IF EXISTS trg_pos28_business_extras ON lb_businesses;
    CREATE TRIGGER trg_pos_perm_lb_businesses_insert BEFORE INSERT ON lb_businesses FOR EACH ROW EXECUTE FUNCTION pos_enforce_permission('settings.manage');
    CREATE TRIGGER trg_pos_perm_lb_businesses_delete BEFORE DELETE ON lb_businesses FOR EACH ROW EXECUTE FUNCTION pos_enforce_permission('settings.manage');
    CREATE TRIGGER trg_pos28_business_extras BEFORE UPDATE ON lb_businesses FOR EACH ROW EXECUTE FUNCTION pos28_guard_business_extras();
  END IF;

  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS r_logo_write ON storage.objects;
    DROP POLICY IF EXISTS r_logo_upd ON storage.objects;
    DROP POLICY IF EXISTS r_logo_del ON storage.objects;
    CREATE POLICY r_logo_write ON storage.objects AS RESTRICTIVE FOR INSERT WITH CHECK (bucket_id <> 'business-logos' OR NOT is_pos_session() OR pos_has_permission('settings.manage'));
    CREATE POLICY r_logo_upd ON storage.objects AS RESTRICTIVE FOR UPDATE USING (bucket_id <> 'business-logos' OR NOT is_pos_session() OR pos_has_permission('settings.manage'));
    CREATE POLICY r_logo_del ON storage.objects AS RESTRICTIVE FOR DELETE USING (bucket_id <> 'business-logos' OR NOT is_pos_session() OR pos_has_permission('settings.manage'));
  END IF;

  -- 5. Audit trail is append-only for staff sessions; rows can only be added for their own business.
  IF to_regclass('public.pos_audit_log') IS NOT NULL THEN
    DROP POLICY IF EXISTS r_audit_ins ON pos_audit_log;
    DROP POLICY IF EXISTS r_audit_upd ON pos_audit_log;
    DROP POLICY IF EXISTS r_audit_del ON pos_audit_log;
    CREATE POLICY r_audit_ins ON pos_audit_log AS RESTRICTIVE FOR INSERT WITH CHECK (NOT is_pos_session() OR pos_tenant_id = pos28_tenant_id());
    CREATE POLICY r_audit_upd ON pos_audit_log AS RESTRICTIVE FOR UPDATE USING (NOT is_pos_session());
    CREATE POLICY r_audit_del ON pos_audit_log AS RESTRICTIVE FOR DELETE USING (NOT is_pos_session());
  END IF;
END $$;
-- ============================================================
