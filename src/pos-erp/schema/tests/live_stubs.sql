\set ON_ERROR_STOP on
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;
create table pos_tenants(id uuid primary key, status text default 'active');
create table pos_staff(id uuid primary key, pos_tenant_id uuid, auth_user_id uuid, username text, name text, phone text, email text, role text check (role in ('owner','manager','cashier')), status text default 'active' check (status in ('active','disabled')), last_login_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(), must_change_password boolean default false, role_template text);
create table pos_staff_permission_overrides(staff_id uuid, pos_tenant_id uuid, permission text, granted boolean, set_by uuid, set_at timestamptz, primary key(staff_id, permission));
create table pos_audit_log(id bigserial primary key, pos_tenant_id uuid, actor_type text, actor_id uuid, action text, entity_type text, entity_id uuid, metadata jsonb, created_at timestamptz default now());
create table lb_businesses(id uuid primary key default gen_random_uuid(), tenant_id uuid, name text, phone text, email text, address text, currency text, tax_config jsonb, time_zone text, logo_url text, receipt_footer text, settings jsonb, status text default 'ACTIVE');
create table lb_pos_settings(id uuid primary key default gen_random_uuid(), tenant_id uuid, settings jsonb);
CREATE OR REPLACE FUNCTION public.get_current_tenant_id()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    RETURN (current_setting('request.jwt.claims', true)::json->>'pos_tenant_id')::UUID;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$function$;
CREATE OR REPLACE FUNCTION public.pos_all_permissions()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT ARRAY[
    'sales.view','sales.create','sales.discount','refunds.request','refunds.approve',
    'products.manage','inventory.view','inventory.scan','inventory.receive','inventory.adjust',
    'inventory.stocktake','inventory.transfer','purchases.create',
    'finance.view','balances.view','expenses.record','payments.record','payments.approve','reports.export',
    'employees.manage','payroll.access',
    'settings.manage','audit.view','operations.use'
  ]
$function$;
CREATE OR REPLACE FUNCTION public.pos_role_default_permissions(p_template text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
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
$function$;
CREATE OR REPLACE FUNCTION public._pos_staff_has(p_staff uuid, p_perm text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;
CREATE OR REPLACE FUNCTION public.pos_has_permission(p_perm text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ SELECT _pos_staff_has(nullif(auth.jwt() ->> 'pos_staff_id','')::uuid, p_perm) $function$;
CREATE OR REPLACE FUNCTION public.is_pos_session()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$ SELECT nullif(auth.jwt() ->> 'pos_staff_id', '') IS NOT NULL $function$;
CREATE OR REPLACE FUNCTION public.pos_my_permissions()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::text[])
    FROM unnest(pos_all_permissions()) k WHERE pos_has_permission(k)
$function$;
CREATE OR REPLACE FUNCTION public.pos_enforce_permission()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
END $function$;
CREATE OR REPLACE FUNCTION public._pos_owner_caller()
 RETURNS pos_staff
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r pos_staff;
BEGIN
  SELECT * INTO r FROM pos_staff
   WHERE id = nullif(auth.jwt() ->> 'pos_staff_id','')::uuid AND role = 'owner' AND status = 'active';
  RETURN r;   -- NULL fields when not an owner; callers check r.id IS NULL
END $function$;
CREATE OR REPLACE FUNCTION public._pos_target(p_me pos_staff, p_target uuid)
 RETURNS pos_staff
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE t pos_staff;
BEGIN
  SELECT * INTO t FROM pos_staff WHERE id = p_target AND pos_tenant_id = p_me.pos_tenant_id;
  RETURN t;
END $function$;
CREATE OR REPLACE FUNCTION public._pos_audit(p_tenant uuid, p_actor uuid, p_action text, p_entity uuid, p_meta jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO pos_audit_log (pos_tenant_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (p_tenant, 'staff', p_actor, p_action, 'pos_staff', p_entity, p_meta)
$function$;
CREATE OR REPLACE FUNCTION public.pos_set_staff_permission(p_staff_id uuid, p_perm text, p_granted boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;
CREATE OR REPLACE FUNCTION public.guard_business_identity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF is_pos_session() AND NOT pos_has_permission('settings.manage') THEN
    IF (NEW.name, NEW.phone, NEW.email, NEW.address, NEW.currency, NEW.time_zone, NEW.logo_url)
       IS DISTINCT FROM
       (OLD.name, OLD.phone, OLD.email, OLD.address, OLD.currency, OLD.time_zone, OLD.logo_url) THEN
      RAISE EXCEPTION 'You do not have permission to change business details.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_guard_business_identity BEFORE UPDATE ON public.lb_businesses FOR EACH ROW EXECUTE FUNCTION guard_business_identity();
