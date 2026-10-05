-- ============================================================
-- UMOVA POS ERP — Phase 18: demo account
--
-- Creates ONE ordinary tenant that anyone can sign into for a tour:
--     Business code : DEMO
--     Username      : demo
--     Password      : Demo@1234     (public on purpose — sample data only)
--
-- It goes through the real register_pos_tenant() (phase1 version), so the
-- auth.users row, pos_staff owner, lb_businesses row and default warehouse
-- are created exactly as for any signup. No change to login, auth, RLS or
-- tenant isolation. Sample products/customers/sales are NOT inserted here —
-- the app seeds them on first demo login through its own services
-- (auth/demoAccount.js), so column names never have to be guessed in SQL.
--
-- Idempotent: safe to re-run. Requires phase1_tenant_business_link.sql first.
-- ============================================================

do $$
declare
  v_res jsonb;
  v_tenant_id uuid;
begin
  if not exists (select 1 from pos_tenants where business_code = 'DEMO') then
    v_res := public.register_pos_tenant(
      'Demo Duka',            -- p_business_name
      'Demo Owner',           -- p_owner_name
      '0700000000',           -- p_phone
      'demo@umova.invalid',   -- p_email (non-routable on purpose)
      'DEMO',                 -- p_business_code
      'demo',                 -- p_username
      'Demo@1234',            -- p_password
      'retail',               -- p_business_type (soft match; NULL if no such code)
      'Nairobi, Kenya'        -- p_address
    );
    if coalesce((v_res->>'ok')::boolean, false) is not true then
      raise exception 'Demo tenant registration failed: %', v_res;
    end if;
  end if;

  select id into v_tenant_id from pos_tenants where business_code = 'DEMO';

  -- Registration leaves new tenants 'pending' for admin approval; the demo
  -- must work immediately. (Assumes 'approved' is the live status value —
  -- check: select distinct status from pos_tenants;)
  update pos_tenants set status = 'approved' where id = v_tenant_id and status <> 'approved';

  -- Demo owner must never be forced through the change-password screen.
  update pos_staff set must_change_password = false
   where pos_tenant_id = v_tenant_id and username = 'demo';
end $$;

-- Verify:
-- select t.business_code, t.status, s.username, s.role, s.must_change_password,
--        b.id as business_id, w.id as warehouse_id
--   from pos_tenants t
--   join pos_staff s on s.pos_tenant_id = t.id
--   left join lb_businesses b on b.tenant_id = t.id
--   left join lb_warehouses w on w.business_id = b.id and w.is_default
--  where t.business_code = 'DEMO';
