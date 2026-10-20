-- ============================================================
-- Phase 28 -- Staff roles + configurable permissions, enforced in the database
--
-- NOT YET RUN ANYWHERE. Review on STAGING first. Safe to re-run.
-- Run AFTER phase1, phase15 and phase27.
--
-- MODEL
--   * pos_staff.role stays as it is (owner / manager / cashier) so existing
--     code keeps working. A new nullable pos_staff.role_template carries the
--     finer preset (manager, cashier, storekeeper, accountant, hr_officer).
--     Storekeeper / accountant / hr_officer are stored with the coarse role
--     'cashier' (the least-privileged existing value).
--   * Effective permission = per-staff OVERRIDE if one exists, otherwise the
--     template default. The owner always has every permission.
--   * Overrides live in pos_staff_permission_overrides. Nobody writes to it
--     directly; only the owner-only RPCs below can.
--   * In this release ONLY THE OWNER manages staff, roles and permissions.
--     Delegating that to managers is deliberately not offered yet.
--
-- ENFORCEMENT (database, not just UI)
--   * Guards on pos_staff: a POS session cannot insert/delete staff or change
--     role, role_template, status, tenant, login link or username except
--     through the owner-only RPCs. Nobody can promote themselves.
--   * Triggers on the tables that money/stock/settings flow into. A trigger
--     fires even inside a SECURITY DEFINER function, so this also covers
--     RPC-based writes (record_expense, record_customer_payment, ...)
--     WITHOUT editing function bodies I cannot see.
--   * Only sessions carrying a pos_staff_id claim are checked. The main Umova
--     app, edge functions on the service role (M-Pesa callback) and cron are
--     unaffected.
--
-- NOT ENFORCED HERE (needs work in later steps / function bodies):
--   * lb_stock_movements: one table serves sales, receiving, adjustments, so
--     it cannot be gated by table alone. inventory.adjust / .stocktake /
--     .transfer are UI-gated only for now.
--   * Reads of sales, costs, profit (sales.view, finance.view): UI-gated only.
--     Gating reads at table level would break the till and receipts.
--   * Refund / reversal approval: Step 3.
-- ============================================================

-- ---------- 0. schema additions ----------
ALTER TABLE pos_staff ADD COLUMN IF NOT EXISTS role_template text;

-- ---------- 1. catalogue ----------
CREATE OR REPLACE FUNCTION pos_all_permissions() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'sales.view','sales.create','sales.discount','refunds.request','refunds.approve',
    'products.manage','inventory.view','inventory.scan','inventory.receive','inventory.adjust',
    'inventory.stocktake','inventory.transfer','purchases.create',
    'finance.view','balances.view','expenses.record','payments.record','payments.approve','reports.export',
    'employees.manage','payroll.access',
    'settings.manage','audit.view','operations.use'
  ]
$$;

-- ---------- 2. template defaults (least privilege) ----------
-- KEEP IN SYNC with ROLE_TEMPLATES in utils/permissions.js; tests/permissions.test.mjs
-- parses this function and fails if the two ever differ.
CREATE OR REPLACE FUNCTION pos_role_default_permissions(p_template text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_template
    WHEN 'owner' THEN pos_all_permissions()
    WHEN 'manager' THEN ARRAY[
      'sales.view','sales.create','sales.discount','refunds.request','refunds.approve',
      'products.manage','inventory.view','inventory.scan','inventory.receive','inventory.adjust',
      'inventory.stocktake','inventory.transfer','purchases.create',
      'finance.view','balances.view','expenses.record','payments.record','payments.approve','reports.export',
      'audit.view','operations.use']
    WHEN 'cashier' THEN ARRAY[
      'sales.create','refunds.request','inventory.scan','payments.record','operations.use']
    WHEN 'storekeeper' THEN ARRAY[
      'inventory.view','inventory.scan','inventory.receive','inventory.adjust',
      'inventory.stocktake','inventory.transfer','purchases.create']
    WHEN 'accountant' THEN ARRAY[
      'sales.view','inventory.view','finance.view','balances.view','expenses.record',
      'payments.record','reports.export']
    WHEN 'hr_officer' THEN ARRAY['employees.manage']
    ELSE ARRAY[]::text[]
  END
$$;

-- ---------- 3. overrides table ----------
CREATE TABLE IF NOT EXISTS pos_staff_permission_overrides (
  staff_id      uuid NOT NULL REFERENCES pos_staff(id) ON DELETE CASCADE,
  pos_tenant_id uuid NOT NULL,
  permission    text NOT NULL,
  granted       boolean NOT NULL,
  set_by        uuid,
  set_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, permission),
  CONSTRAINT pos_perm_known CHECK (permission = ANY (pos_all_permissions()))
);
ALTER TABLE pos_staff_permission_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pos_staff_permission_overrides FROM PUBLIC;
GRANT SELECT ON pos_staff_permission_overrides TO authenticated;

-- Staff can read their own overrides; the owner can read the tenant's. NO write policies:
-- writes happen only inside the SECURITY DEFINER RPCs below.
DROP POLICY IF EXISTS pos_overrides_read ON pos_staff_permission_overrides;
CREATE POLICY pos_overrides_read ON pos_staff_permission_overrides FOR SELECT
  USING (pos_tenant_id = get_current_tenant_id()
         AND (staff_id = nullif(auth.jwt() ->> 'pos_staff_id','')::uuid OR is_pos_owner()));

-- ---------- 4. permission checks ----------
-- Internal: effective permission of ANY staff member. Not granted to API roles.
CREATE OR REPLACE FUNCTION _pos_staff_has(p_staff uuid, p_perm text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE s record; v_ov boolean;
BEGIN
  IF p_staff IS NULL OR p_perm IS NULL OR NOT (p_perm = ANY (pos_all_permissions())) THEN RETURN false; END IF;
  SELECT st.role, st.role_template, st.status, tn.status AS tstatus INTO s
    FROM pos_staff st JOIN pos_tenants tn ON tn.id = st.pos_tenant_id
   WHERE st.id = p_staff;
  IF NOT FOUND THEN RETURN false; END IF;
  IF s.status IS DISTINCT FROM 'active' OR s.tstatus IN ('pending','rejected','suspended') THEN RETURN false; END IF;
  IF s.role = 'owner' THEN RETURN true; END IF;
  SELECT granted INTO v_ov FROM pos_staff_permission_overrides WHERE staff_id = p_staff AND permission = p_perm;
  IF FOUND THEN RETURN v_ov; END IF;
  RETURN p_perm = ANY (pos_role_default_permissions(coalesce(s.role_template, s.role)));
END $$;
REVOKE ALL ON FUNCTION _pos_staff_has(uuid, text) FROM PUBLIC;

-- The calling session's own permission. Always false outside a POS session.
CREATE OR REPLACE FUNCTION pos_has_permission(p_perm text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT _pos_staff_has(nullif(auth.jwt() ->> 'pos_staff_id','')::uuid, p_perm) $$;

-- Raise unless the POS caller holds ANY of the listed permissions. Non-POS sessions pass.
-- One-line guard for RPC bodies:  PERFORM pos_require('expenses.record');
CREATE OR REPLACE FUNCTION pos_require(VARIADIC p_perms text[]) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE a text;
BEGIN
  IF NOT is_pos_session() THEN RETURN; END IF;
  FOREACH a IN ARRAY p_perms LOOP
    IF pos_has_permission(a) THEN RETURN; END IF;
  END LOOP;
  RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501';
END $$;

CREATE OR REPLACE FUNCTION pos_my_permissions() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::text[])
    FROM unnest(pos_all_permissions()) k WHERE pos_has_permission(k)
$$;

REVOKE ALL ON FUNCTION pos_has_permission(text), pos_require(text[]), pos_my_permissions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pos_has_permission(text), pos_require(text[]), pos_my_permissions() TO authenticated;

-- ---------- 5. pos_staff anti-escalation guard ----------
CREATE OR REPLACE FUNCTION guard_pos_staff() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF is_pos_session() AND coalesce(current_setting('pos.staff_admin', true), '') <> 'on' THEN
    IF TG_OP IN ('INSERT','DELETE') THEN
      RAISE EXCEPTION 'Staff can only be added or removed by the business owner.' USING ERRCODE = '42501';
    ELSIF (NEW.role, NEW.role_template, NEW.status, NEW.pos_tenant_id, NEW.auth_user_id, NEW.username)
          IS DISTINCT FROM
          (OLD.role, OLD.role_template, OLD.status, OLD.pos_tenant_id, OLD.auth_user_id, OLD.username) THEN
      RAISE EXCEPTION 'Roles, status and sign-in details can only be changed by the business owner.' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_pos_staff ON pos_staff;
CREATE TRIGGER trg_guard_pos_staff BEFORE INSERT OR UPDATE OR DELETE ON pos_staff
  FOR EACH ROW EXECUTE FUNCTION guard_pos_staff();

-- ---------- 6. owner-only staff RPCs ----------
-- Caller must be the active OWNER. Returns the caller's pos_staff row.
CREATE OR REPLACE FUNCTION _pos_owner_caller() RETURNS pos_staff
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r pos_staff;
BEGIN
  SELECT * INTO r FROM pos_staff
   WHERE id = nullif(auth.jwt() ->> 'pos_staff_id','')::uuid AND role = 'owner' AND status = 'active';
  RETURN r;   -- NULL fields when not an owner; callers check r.id IS NULL
END $$;
REVOKE ALL ON FUNCTION _pos_owner_caller() FROM PUBLIC;

CREATE OR REPLACE FUNCTION _pos_audit(p_tenant uuid, p_actor uuid, p_action text, p_entity uuid, p_meta jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO pos_audit_log (pos_tenant_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (p_tenant, 'staff', p_actor, p_action, 'pos_staff', p_entity, p_meta)
$$;
REVOKE ALL ON FUNCTION _pos_audit(uuid, uuid, text, uuid, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION pos_list_staff() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE me pos_staff := _pos_owner_caller();
BEGIN
  IF me.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_OWNER'); END IF;
  RETURN jsonb_build_object('ok', true, 'staff', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', s.id, 'username', s.username, 'name', s.name, 'phone', s.phone, 'email', s.email,
      'role', s.role, 'template', CASE WHEN s.role = 'owner' THEN 'owner' ELSE coalesce(s.role_template, s.role) END,
      'status', s.status, 'must_change_password', s.must_change_password, 'is_self', s.id = me.id,
      'overrides', coalesce((SELECT jsonb_object_agg(o.permission, o.granted)
                               FROM pos_staff_permission_overrides o WHERE o.staff_id = s.id), '{}'::jsonb),
      'permissions', (SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb)
                        FROM unnest(pos_all_permissions()) k WHERE _pos_staff_has(s.id, k))
    ) ORDER BY (s.role = 'owner') DESC, s.name)
    FROM pos_staff s WHERE s.pos_tenant_id = me.pos_tenant_id), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION pos_create_staff(
  p_username text, p_name text, p_phone text, p_email text, p_template text, p_temp_password text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  me pos_staff := _pos_owner_caller();
  v_code text; v_user text := lower(trim(coalesce(p_username, '')));
  v_auth uuid := gen_random_uuid(); v_staff uuid; v_email text; v_role text;
BEGIN
  IF me.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_OWNER'); END IF;
  IF p_template IS NULL OR p_template NOT IN ('manager','cashier','storekeeper','accountant','hr_officer') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BAD_ROLE'); END IF;
  IF v_user !~ '^[a-z0-9._-]{3,30}$' THEN RETURN jsonb_build_object('ok', false, 'reason', 'BAD_USERNAME'); END IF;
  IF length(trim(coalesce(p_name, ''))) < 2 THEN RETURN jsonb_build_object('ok', false, 'reason', 'BAD_NAME'); END IF;
  IF length(coalesce(p_temp_password, '')) < 8 THEN RETURN jsonb_build_object('ok', false, 'reason', 'WEAK_PASSWORD'); END IF;
  IF EXISTS (SELECT 1 FROM pos_staff WHERE pos_tenant_id = me.pos_tenant_id AND lower(username) = v_user) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'USERNAME_TAKEN'); END IF;

  SELECT business_code INTO v_code FROM pos_tenants WHERE id = me.pos_tenant_id;
  v_email := v_user || '+' || v_code || '@pos.internal';   -- same convention as register_pos_tenant()
  v_role  := CASE p_template WHEN 'manager' THEN 'manager' ELSE 'cashier' END;

  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, aud, role,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token,
    is_sso_user, is_anonymous, created_at, updated_at)
  VALUES (
    v_auth, '00000000-0000-0000-0000-000000000000', v_email,
    crypt(p_temp_password, gen_salt('bf')), now(),
    jsonb_build_object('provider','pos','providers', array['pos']),
    jsonb_build_object('full_name', p_name),
    'authenticated', 'authenticated', '', '', '', '', '', '', '', '', false, false, now(), now());
  INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), v_auth, v_auth::text,
          jsonb_build_object('sub', v_auth::text, 'email', v_email), 'email', now(), now(), now());

  PERFORM set_config('pos.staff_admin', 'on', true);
  INSERT INTO pos_staff (pos_tenant_id, auth_user_id, username, name, phone, email, role, role_template, status, must_change_password)
  VALUES (me.pos_tenant_id, v_auth, v_user, trim(p_name), nullif(trim(p_phone), ''), nullif(trim(p_email), ''),
          v_role, p_template, 'active', true)
  RETURNING id INTO v_staff;
  PERFORM set_config('pos.staff_admin', 'off', true);

  PERFORM _pos_audit(me.pos_tenant_id, me.id, 'STAFF_CREATED', v_staff, jsonb_build_object('template', p_template, 'username', v_user));
  RETURN jsonb_build_object('ok', true, 'staff_id', v_staff);
END $$;

-- Shared target check: same tenant, not the caller, not an owner.
CREATE OR REPLACE FUNCTION _pos_target(p_me pos_staff, p_target uuid) RETURNS pos_staff
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE t pos_staff;
BEGIN
  SELECT * INTO t FROM pos_staff WHERE id = p_target AND pos_tenant_id = p_me.pos_tenant_id;
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION _pos_target(pos_staff, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION pos_set_staff_template(p_staff_id uuid, p_template text, p_reset_overrides boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE me pos_staff := _pos_owner_caller(); t pos_staff;
BEGIN
  IF me.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_OWNER'); END IF;
  IF p_template IS NULL OR p_template NOT IN ('manager','cashier','storekeeper','accountant','hr_officer') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BAD_ROLE'); END IF;
  t := _pos_target(me, p_staff_id);
  IF t.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  IF t.id = me.id THEN RETURN jsonb_build_object('ok', false, 'reason', 'CANNOT_CHANGE_SELF'); END IF;
  IF t.role = 'owner' THEN RETURN jsonb_build_object('ok', false, 'reason', 'CANNOT_CHANGE_OWNER'); END IF;

  PERFORM set_config('pos.staff_admin', 'on', true);
  UPDATE pos_staff SET role = CASE p_template WHEN 'manager' THEN 'manager' ELSE 'cashier' END,
                       role_template = p_template WHERE id = t.id;
  PERFORM set_config('pos.staff_admin', 'off', true);
  IF p_reset_overrides THEN DELETE FROM pos_staff_permission_overrides WHERE staff_id = t.id; END IF;

  PERFORM _pos_audit(me.pos_tenant_id, me.id, 'STAFF_ROLE_CHANGED', t.id,
    jsonb_build_object('from', coalesce(t.role_template, t.role), 'to', p_template, 'overrides_reset', p_reset_overrides));
  RETURN jsonb_build_object('ok', true);
END $$;

-- p_granted: true = grant, false = revoke, NULL = remove the override (back to the role default)
CREATE OR REPLACE FUNCTION pos_set_staff_permission(p_staff_id uuid, p_perm text, p_granted boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE me pos_staff := _pos_owner_caller(); t pos_staff;
BEGIN
  IF me.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_OWNER'); END IF;
  IF p_perm IS NULL OR NOT (p_perm = ANY (pos_all_permissions())) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BAD_PERMISSION'); END IF;
  t := _pos_target(me, p_staff_id);
  IF t.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  IF t.id = me.id THEN RETURN jsonb_build_object('ok', false, 'reason', 'CANNOT_CHANGE_SELF'); END IF;
  IF t.role = 'owner' THEN RETURN jsonb_build_object('ok', false, 'reason', 'CANNOT_CHANGE_OWNER'); END IF;

  IF p_granted IS NULL THEN
    DELETE FROM pos_staff_permission_overrides WHERE staff_id = t.id AND permission = p_perm;
  ELSE
    INSERT INTO pos_staff_permission_overrides (staff_id, pos_tenant_id, permission, granted, set_by, set_at)
    VALUES (t.id, t.pos_tenant_id, p_perm, p_granted, me.id, now())
    ON CONFLICT (staff_id, permission) DO UPDATE SET granted = EXCLUDED.granted, set_by = EXCLUDED.set_by, set_at = now();
  END IF;
  PERFORM _pos_audit(me.pos_tenant_id, me.id, 'STAFF_PERMISSION_CHANGED', t.id,
    jsonb_build_object('permission', p_perm, 'granted', p_granted));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION pos_set_staff_status(p_staff_id uuid, p_status text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE me pos_staff := _pos_owner_caller(); t pos_staff;
BEGIN
  IF me.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_OWNER'); END IF;
  IF p_status IS NULL OR p_status NOT IN ('active','disabled') THEN RETURN jsonb_build_object('ok', false, 'reason', 'BAD_STATUS'); END IF;
  t := _pos_target(me, p_staff_id);
  IF t.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  IF t.id = me.id THEN RETURN jsonb_build_object('ok', false, 'reason', 'CANNOT_CHANGE_SELF'); END IF;
  IF t.role = 'owner' THEN RETURN jsonb_build_object('ok', false, 'reason', 'CANNOT_CHANGE_OWNER'); END IF;

  PERFORM set_config('pos.staff_admin', 'on', true);
  UPDATE pos_staff SET status = p_status WHERE id = t.id;
  PERFORM set_config('pos.staff_admin', 'off', true);
  IF p_status = 'disabled' AND to_regclass('auth.sessions') IS NOT NULL THEN
    EXECUTE 'DELETE FROM auth.sessions WHERE user_id = $1' USING t.auth_user_id;   -- sign them out now
  END IF;
  PERFORM _pos_audit(me.pos_tenant_id, me.id, CASE p_status WHEN 'disabled' THEN 'STAFF_DISABLED' ELSE 'STAFF_ENABLED' END, t.id, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION pos_reset_staff_password(p_staff_id uuid, p_temp_password text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE me pos_staff := _pos_owner_caller(); t pos_staff;
BEGIN
  IF me.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_OWNER'); END IF;
  IF length(coalesce(p_temp_password, '')) < 8 THEN RETURN jsonb_build_object('ok', false, 'reason', 'WEAK_PASSWORD'); END IF;
  t := _pos_target(me, p_staff_id);
  IF t.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  IF t.id = me.id THEN RETURN jsonb_build_object('ok', false, 'reason', 'CANNOT_CHANGE_SELF'); END IF;
  IF t.role = 'owner' THEN RETURN jsonb_build_object('ok', false, 'reason', 'CANNOT_CHANGE_OWNER'); END IF;

  UPDATE auth.users SET encrypted_password = crypt(p_temp_password, gen_salt('bf')), updated_at = now() WHERE id = t.auth_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'LOGIN_RECORD_MISSING'); END IF;  -- never report success for a no-op
  UPDATE pos_staff SET must_change_password = true WHERE id = t.id;
  IF to_regclass('auth.sessions') IS NOT NULL THEN
    EXECUTE 'DELETE FROM auth.sessions WHERE user_id = $1' USING t.auth_user_id;
  END IF;
  PERFORM _pos_audit(me.pos_tenant_id, me.id, 'STAFF_PASSWORD_RESET', t.id, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION pos_list_staff(), pos_create_staff(text,text,text,text,text,text),
  pos_set_staff_template(uuid,text,boolean), pos_set_staff_permission(uuid,text,boolean),
  pos_set_staff_status(uuid,text), pos_reset_staff_password(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pos_list_staff(), pos_create_staff(text,text,text,text,text,text),
  pos_set_staff_template(uuid,text,boolean), pos_set_staff_permission(uuid,text,boolean),
  pos_set_staff_status(uuid,text), pos_reset_staff_password(uuid,text) TO authenticated;

-- ---------- 7. phase27 objects now keyed to a permission instead of "owner" ----------
CREATE OR REPLACE FUNCTION guard_business_identity() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF is_pos_session() AND NOT pos_has_permission('settings.manage') THEN
    IF (NEW.name, NEW.phone, NEW.email, NEW.address, NEW.currency, NEW.time_zone, NEW.logo_url)
       IS DISTINCT FROM
       (OLD.name, OLD.phone, OLD.email, OLD.address, OLD.currency, OLD.time_zone, OLD.logo_url) THEN
      RAISE EXCEPTION 'You do not have permission to change business details.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP POLICY IF EXISTS business_logos_tenant_write ON storage.objects;
CREATE POLICY business_logos_tenant_write ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'business-logos' AND (NOT is_pos_session() OR pos_has_permission('settings.manage'))
  AND (storage.foldername(name))[1] IN (SELECT id::text FROM lb_businesses WHERE tenant_id = get_current_tenant_id()));

DROP POLICY IF EXISTS business_logos_tenant_update ON storage.objects;
CREATE POLICY business_logos_tenant_update ON storage.objects FOR UPDATE USING (
  bucket_id = 'business-logos' AND (NOT is_pos_session() OR pos_has_permission('settings.manage'))
  AND (storage.foldername(name))[1] IN (SELECT id::text FROM lb_businesses WHERE tenant_id = get_current_tenant_id()))
WITH CHECK (
  bucket_id = 'business-logos' AND (NOT is_pos_session() OR pos_has_permission('settings.manage'))
  AND (storage.foldername(name))[1] IN (SELECT id::text FROM lb_businesses WHERE tenant_id = get_current_tenant_id()));

DROP POLICY IF EXISTS business_logos_tenant_delete ON storage.objects;
CREATE POLICY business_logos_tenant_delete ON storage.objects FOR DELETE USING (
  bucket_id = 'business-logos' AND (NOT is_pos_session() OR pos_has_permission('settings.manage'))
  AND (storage.foldername(name))[1] IN (SELECT id::text FROM lb_businesses WHERE tenant_id = get_current_tenant_id()));

-- ---------- 8. table-level enforcement (covers direct writes AND RPC-based writes) ----------
-- Trigger args = permissions, ANY of which allows the write. Non-POS sessions always pass.
CREATE OR REPLACE FUNCTION pos_enforce_permission() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE a text;
BEGIN
  IF is_pos_session() THEN
    FOREACH a IN ARRAY TG_ARGV LOOP
      IF pos_has_permission(a) THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END IF;
    END LOOP;
    RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- A sale line carrying a discount needs sales.discount.
CREATE OR REPLACE FUNCTION pos_guard_sale_discount() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF is_pos_session() AND coalesce(NEW.discount_amount, 0) > 0 AND NOT pos_has_permission('sales.discount') THEN
    RAISE EXCEPTION 'You do not have permission to give discounts.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE
  g record;
  ev text;
BEGIN
  FOR g IN SELECT * FROM (VALUES
    -- table                 events                     permissions (any of)
    ('lb_expenses',          'INSERT,UPDATE,DELETE',    'expenses.record'),
    ('lb_customer_payments', 'INSERT,UPDATE,DELETE',    'payments.record'),
    ('lb_supplier_payments', 'INSERT,UPDATE,DELETE',    'payments.record'),
    ('lb_purchase_orders',   'INSERT,UPDATE,DELETE',    'purchases.create,inventory.receive'),
    ('lb_products',          'INSERT,DELETE',           'products.manage'),
    -- UPDATE also allowed for receiving/adjusting stock: goods receipt updates cost_price
    ('lb_products',          'UPDATE',                  'products.manage,inventory.receive,inventory.adjust'),
    ('lb_pos_settings',      'INSERT,UPDATE,DELETE',    'settings.manage'),
    ('lb_sales',             'INSERT',                  'sales.create')
  ) AS v(tbl, events, perms)
  LOOP
    IF to_regclass('public.' || g.tbl) IS NULL THEN
      RAISE NOTICE 'phase28: % does not exist here, skipped', g.tbl;
      CONTINUE;
    END IF;
    FOREACH ev IN ARRAY string_to_array(g.events, ',') LOOP
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_pos_perm_' || g.tbl || '_' || lower(ev), g.tbl);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE %s ON %I FOR EACH ROW EXECUTE FUNCTION pos_enforce_permission(%s)',
        'trg_pos_perm_' || g.tbl || '_' || lower(ev), ev, g.tbl,
        (SELECT string_agg(quote_literal(p), ',') FROM unnest(string_to_array(g.perms, ',')) p));
    END LOOP;
  END LOOP;

  IF to_regclass('public.lb_sale_items') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_pos_guard_sale_discount ON lb_sale_items;
    CREATE TRIGGER trg_pos_guard_sale_discount BEFORE INSERT OR UPDATE ON lb_sale_items
      FOR EACH ROW EXECUTE FUNCTION pos_guard_sale_discount();
  END IF;

  -- Audit log: only people with audit.view can READ it. Writes by all staff are unchanged.
  IF to_regclass('public.pos_audit_log') IS NOT NULL THEN
    DROP POLICY IF EXISTS pos_audit_view_permission ON pos_audit_log;
    CREATE POLICY pos_audit_view_permission ON pos_audit_log AS RESTRICTIVE FOR SELECT
      USING (NOT is_pos_session() OR pos_has_permission('audit.view'));
  END IF;
END $$;

-- ASSUMPTIONS TO CONFIRM ON STAGING (not verifiable from source):
--   * pos_staff has columns: id, pos_tenant_id, auth_user_id, username, name, phone, email, role,
--     status, must_change_password (all appear in phase1 SQL). role_template is added above.
--   * pos_staff.role has no CHECK/enum that rejects 'manager' / 'cashier' (those are used today).
--   * pos_tenants.status uses 'pending' / 'rejected' / 'suspended' for non-active tenants.
--   * pos_audit_log has pos_tenant_id, actor_type, actor_id, action, entity_type, entity_id, metadata
--     and RLS enabled; lb_sale_items has discount_amount.
--   * pgcrypto crypt()/gen_salt() resolve (register_pos_tenant already relies on them).
--   * RUN THE TILL AS A CASHIER, A STOREKEEPER AND AN ACCOUNTANT ON STAGING before production:
--     a table trigger that is stricter than a real workflow will block that workflow.
