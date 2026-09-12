-- ============================================================
-- UMOVA POS ERP — Phase 1 migration: link pos_tenants to a real
-- lb_businesses / lb_warehouses pair.
--
-- WHY: get_current_tenant_id() already reads `pos_tenant_id` off the
-- JWT (set by pos_custom_access_token_hook at login), and every lb_*
-- table's RLS policy already gates on tenant_id = get_current_tenant_id().
-- That machinery is correct and untouched by this migration. What's
-- missing is data: no lb_businesses row has ever existed with
-- tenant_id = <a pos_tenants.id>, so every POS tenant's RLS-scoped
-- view of lb_products/lb_sales/etc. has always been empty, and every
-- insert into those tables (which require tenant_id NOT NULL) had
-- nothing valid to stamp.
--
-- This migration:
--   1. Extends register_pos_tenant() to create a matching lb_businesses
--      row (tenant_id = the new pos_tenants.id) and a default
--      lb_warehouses row, for every new signup going forward.
--   2. Extends get_pos_profile() to return that business_id/warehouse_id
--      in the tenant object, matching what hooks/useProducts.js (and
--      the rest of services/*.js) already expects.
--   3. Backfills the 4 existing approved pos_tenants rows that predate
--      this migration, so they don't have to re-register.
--
-- Idempotent: safe to re-run (register_pos_tenant/get_pos_profile are
-- CREATE OR REPLACE; the backfill only inserts for tenants that don't
-- already have a linked business).
-- ============================================================

-- 1. register_pos_tenant() — create lb_businesses + lb_warehouses ---------

CREATE OR REPLACE FUNCTION public.register_pos_tenant(
  p_business_name text, p_owner_name text, p_phone text, p_email text,
  p_business_code text, p_username text, p_password text,
  p_business_type text DEFAULT NULL::text, p_address text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_code             text := upper(trim(p_business_code));
  v_tenant_id        uuid;
  v_auth_id          uuid := gen_random_uuid();
  v_staff_id         uuid;
  v_synth_email      text;
  v_business_id      uuid;
  v_business_type_id uuid;
  v_warehouse_id     uuid;
begin
  if length(coalesce(p_password, '')) < 8 then
    return jsonb_build_object('ok', false, 'reason', 'WEAK_PASSWORD');
  end if;
  if exists (select 1 from pos_tenants where business_code = v_code) then
    return jsonb_build_object('ok', false, 'reason', 'BUSINESS_CODE_TAKEN');
  end if;

  v_synth_email := lower(p_username) || '+' || v_code || '@pos.internal';

  insert into pos_tenants (business_code, business_name, owner_name, phone, email, address, business_type, status)
  values (v_code, p_business_name, p_owner_name, p_phone, p_email, p_address, p_business_type, 'pending')
  returning id into v_tenant_id;

  insert into auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, aud, role,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token,
    is_sso_user, is_anonymous,
    created_at, updated_at
  )
  values (
    v_auth_id, '00000000-0000-0000-0000-000000000000', v_synth_email,
    crypt(p_password, gen_salt('bf')), now(),
    jsonb_build_object('provider','pos','providers', array['pos']),
    jsonb_build_object('full_name', p_owner_name),
    'authenticated', 'authenticated',
    '', '', '', '',
    '', '', '', '',
    false, false,
    now(), now()
  );
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), v_auth_id, v_auth_id::text,
    jsonb_build_object('sub', v_auth_id::text, 'email', v_synth_email),
    'email', now(), now(), now()
  );

  -- NEW: matching lb_businesses row. tenant_id = pos_tenants.id is the
  -- join get_current_tenant_id()/RLS already expects — no bridge table,
  -- no new column on pos_tenants needed.
  select id into v_business_type_id
    from lb_business_types
   where code = lower(trim(coalesce(p_business_type, '')))
   limit 1; -- soft match; stays NULL (column is nullable) if no such code exists

  insert into lb_businesses (tenant_id, business_type_id, name, phone, email, address, currency, time_zone)
  values (v_tenant_id, v_business_type_id, p_business_name, p_phone, p_email, p_address, 'KES', 'Africa/Nairobi')
  returning id into v_business_id;

  -- NEW: default warehouse. lb_inventory.warehouse_id is NOT NULL, so
  -- without this, receiving/selling stock has nowhere to post to.
  -- is_default = true is REQUIRED, not cosmetic: purchaseService.js's
  -- getDefaultWarehouseId() (used by saleService.js and purchaseService.js
  -- for every sale/GRN/purchase-return) selects on
  -- lb_warehouses.is_default = true specifically and throws if none is
  -- found — a plain insert without it would leave sales/purchasing still
  -- broken even after this migration runs. branch_id left NULL — this
  -- brief's target is single-location small businesses; branches are
  -- optional (§44 "not large-property lease management" applies equally
  -- here).
  insert into lb_warehouses (tenant_id, business_id, name, code, is_default)
  values (v_tenant_id, v_business_id, 'Main Store', 'MAIN', true)
  returning id into v_warehouse_id;

  insert into pos_staff (pos_tenant_id, auth_user_id, username, name, phone, email, role, status)
  values (v_tenant_id, v_auth_id, lower(trim(p_username)), p_owner_name, p_phone, p_email, 'owner', 'active')
  returning id into v_staff_id;

  insert into pos_audit_log (pos_tenant_id, actor_type, actor_id, action, entity_type, entity_id)
  values (v_tenant_id, 'system', v_staff_id, 'TENANT_REGISTERED', 'pos_tenants', v_tenant_id);

  return jsonb_build_object('ok', true, 'tenant_id', v_tenant_id, 'business_code', v_code);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'DUPLICATE');
end;
$function$;

-- 2. get_pos_profile() — return business_id/warehouse_id ------------------

CREATE OR REPLACE FUNCTION public.get_pos_profile()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_staff_id uuid := (auth.jwt()->>'pos_staff_id')::uuid;
        r record;
begin
  if v_staff_id is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_POS_SESSION');
  end if;

  select s.id, s.name, s.role, s.status, s.must_change_password,
         t.id as tenant_id, t.business_code, t.business_name, t.status as tenant_status,
         t.rejection_reason, t.suspension_reason,
         b.id as business_id, w.id as warehouse_id
    into r
    from pos_staff s
    join pos_tenants t on t.id = s.pos_tenant_id
    left join lb_businesses b on b.tenant_id = t.id
    left join lb_warehouses w on w.business_id = b.id and w.is_default = true
   where s.id = v_staff_id;

  if r is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_POS_SESSION');
  end if;

  if r.tenant_status = 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'TENANT_NOT_APPROVED',
      'tenant', jsonb_build_object('business_code', r.business_code, 'business_name', r.business_name));
  end if;
  if r.tenant_status = 'rejected' then
    return jsonb_build_object('ok', false, 'reason', 'TENANT_REJECTED', 'detail', r.rejection_reason,
      'tenant', jsonb_build_object('business_code', r.business_code, 'business_name', r.business_name));
  end if;
  if r.tenant_status = 'suspended' then
    return jsonb_build_object('ok', false, 'reason', 'TENANT_SUSPENDED', 'detail', r.suspension_reason,
      'tenant', jsonb_build_object('business_code', r.business_code, 'business_name', r.business_name));
  end if;
  if r.status = 'disabled' then
    return jsonb_build_object('ok', false, 'reason', 'STAFF_DISABLED');
  end if;

  return jsonb_build_object('ok', true, 'staff', jsonb_build_object(
      'id', r.id, 'auth_user_id', auth.uid(), 'name', r.name, 'role', r.role, 'must_change_password', r.must_change_password),
    'tenant', jsonb_build_object(
      'id', r.tenant_id, 'business_code', r.business_code, 'business_name', r.business_name,
      'business_id', r.business_id, 'warehouse_id', r.warehouse_id));
end; $function$;

-- 3. Backfill existing pos_tenants that predate this migration ------------
-- (your 4 test tenants: TEST-01, 2201, 2202, 2203)

do $$
declare
  t record;
  v_business_id uuid;
begin
  for t in
    select id, business_name, phone, email, address
    from pos_tenants
    where not exists (select 1 from lb_businesses b where b.tenant_id = pos_tenants.id)
  loop
    insert into lb_businesses (tenant_id, name, phone, email, address, currency, time_zone)
    values (t.id, t.business_name, t.phone, t.email, t.address, 'KES', 'Africa/Nairobi')
    returning id into v_business_id;

    insert into lb_warehouses (tenant_id, business_id, name, code, is_default)
    values (t.id, v_business_id, 'Main Store', 'MAIN', true);
  end loop;
end $$;

-- Sanity check — every pos_tenant should now have exactly one lb_businesses
-- row and one MAIN warehouse:
--
-- select pt.business_code, pt.business_name, lb.id as business_id, w.id as warehouse_id
-- from pos_tenants pt
-- left join lb_businesses lb on lb.tenant_id = pt.id
-- left join lb_warehouses w on w.business_id = lb.id and w.is_default = true;
