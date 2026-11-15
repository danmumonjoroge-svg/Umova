-- =============================================================================
-- CHAMA ERP — AUTH & LICENSING SCHEMA
-- =============================================================================
-- Implements the recommended flow:
--
--   Phone Number -> Password -> Login -> system finds the phone number
--     -> 1 chama  -> check license -> open dashboard
--     -> 2+ chamas -> show chama list -> user selects -> check license -> open dashboard
--
-- Design choice: rather than a separate `memberships` table duplicating
-- what `chama_members` already tracks (chama_id, role, status), we add a
-- single `user_id` column to your existing `chama_members` table. Each
-- chama_members row already IS a membership row (one per person per chama,
-- carrying their role/status/savings for that chama) — it just didn't have
-- a link back to a single global login identity yet. This also means every
-- table that already references chama_members(id) as member_id (loans,
-- contributions, welfare — all delivered in migration 001) keeps working
-- unchanged; a member's identity across chamas is unified without touching
-- any of that.
--
-- Run this AFTER 001_schema_upgrade.sql. Safe to re-run.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. GLOBAL USERS — one account per phone number, across all chamas
-- -----------------------------------------------------------------------------
create table if not exists chama_users (
  id uuid primary key default gen_random_uuid(),
  phone_number text not null unique,
  password_hash text not null,          -- bcrypt via pgcrypto, never sent to the client
  full_name text,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  last_login_at timestamptz
);

-- Lock the table down completely at the row level — the ONLY way in or out
-- is through the SECURITY DEFINER functions below. No client, anon or
-- authenticated, can ever run a raw select against chama_users.
alter table chama_users enable row level security;
-- (No policies created = default deny for everyone except functions running
-- as the table owner, which bypass RLS by default in Postgres.)

-- -----------------------------------------------------------------------------
-- 2. MEMBERSHIPS — chama_members becomes the membership table once linked
--    to a global user via user_id.
-- -----------------------------------------------------------------------------
alter table chama_members add column if not exists user_id uuid references chama_users(id);
create index if not exists idx_chama_members_user on chama_members(user_id);

-- A phone number should only be a member of a given chama once.
create unique index if not exists uniq_user_per_chama
  on chama_members(chama_id, user_id)
  where user_id is not null;

-- -----------------------------------------------------------------------------
-- 3. CHAMAS — add licensing fields (table already exists per ChamaRegister.js)
-- -----------------------------------------------------------------------------
alter table chamas add column if not exists license_status text not null default 'active';
  -- active | suspended | expired | trial
alter table chamas add column if not exists license_expiry date;
alter table chamas add column if not exists license_plan text default 'standard';
alter table chamas add column if not exists created_at timestamptz default now();

-- =============================================================================
-- 4. FUNCTIONS — the only supported way to register, authenticate, and look
--    up a user's chamas. All SECURITY DEFINER, all server-side password
--    handling — a plaintext password never gets compared in JavaScript and
--    a password_hash never leaves the database.
-- =============================================================================

-- Register a brand-new login identity (used the first time someone gets a
-- phone+password set up — by themselves, or by a secretary/admin during
-- member onboarding). Optionally links immediately to an existing
-- chama_members row (e.g. a member who was added to the chama by an
-- official before they ever logged in).
create or replace function register_user(
  p_phone text,
  p_password text,
  p_full_name text,
  p_link_chama_member_id uuid default null
)
returns table (user_id uuid, full_name text, phone_number text)
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
begin
  if exists (select 1 from chama_users cu where cu.phone_number = p_phone) then
    raise exception 'An account already exists for this phone number';
  end if;
  if length(p_password) < 6 then
    raise exception 'Password must be at least 6 characters';
  end if;

  insert into chama_users (phone_number, password_hash, full_name)
  values (p_phone, crypt(p_password, gen_salt('bf')), p_full_name)
  returning id into v_user_id;

  if p_link_chama_member_id is not null then
    update chama_members cm set user_id = v_user_id where cm.id = p_link_chama_member_id and cm.user_id is null;
  else
    -- Auto-link: if an official already added this person to one or more
    -- chamas by phone number before they ever registered a login, connect
    -- every matching chama_members row to this new account automatically.
    -- This is what actually makes "register with the same phone number
    -- you were added under" work without the UI having to look up a
    -- chama_member_id first.
    update chama_members cm set user_id = v_user_id where cm.phone = p_phone and cm.user_id is null;
  end if;

  return query select v_user_id, p_full_name, p_phone;
end;
$$;

-- Step 1 of login: phone + password -> verified user, or a clean exception.
-- Deliberately returns the SAME error for "no such phone" and "wrong
-- password" so the login form can't be used to enumerate registered numbers.
create or replace function authenticate_user(p_phone text, p_password text)
returns table (user_id uuid, full_name text, phone_number text)
language plpgsql
security definer
as $$
declare
  v_row chama_users%rowtype;
begin
  select cu.* into v_row from chama_users cu where cu.phone_number = p_phone and cu.is_active = true;

  if v_row.id is null or v_row.password_hash <> crypt(p_password, v_row.password_hash) then
    raise exception 'Incorrect phone number or password';
  end if;

  update chama_users cu set last_login_at = now() where cu.id = v_row.id;

  return query select v_row.id, v_row.full_name, v_row.phone_number;
end;
$$;

-- Step 2: given an authenticated user, list every chama they belong to,
-- with the license fields needed to gate access before the dashboard opens.
create or replace function get_user_memberships(p_user_id uuid)
returns table (
  chama_member_id uuid,
  chama_id uuid,
  chama_name text,
  chama_no text,
  role text,
  status text,
  license_status text,
  license_expiry date
)
language sql
security definer
stable
as $$
  select
    cm.id as chama_member_id,
    c.id as chama_id,
    c.name as chama_name,
    c.chama_no,
    cm.role,
    cm.status,
    c.license_status,
    c.license_expiry
  from chama_members cm
  join chamas c on c.id = cm.chama_id
  where cm.user_id = p_user_id
  order by c.name;
$$;

-- Password change — requires the current password, same server-side
-- comparison as authenticate_user.
create or replace function change_password(p_user_id uuid, p_old_password text, p_new_password text)
returns void
language plpgsql
security definer
as $$
declare
  v_row chama_users%rowtype;
begin
  select * into v_row from chama_users where id = p_user_id;
  if v_row.id is null or v_row.password_hash <> crypt(p_old_password, v_row.password_hash) then
    raise exception 'Current password is incorrect';
  end if;
  if length(p_new_password) < 6 then
    raise exception 'New password must be at least 6 characters';
  end if;
  update chama_users set password_hash = crypt(p_new_password, gen_salt('bf')) where id = p_user_id;
end;
$$;

-- Convenience check used by the app before opening a dashboard — mirrors
-- the same rule client-side (see auth/licensing.js) so it's enforced in
-- exactly one place either way, but exposed here too for server-side jobs
-- (e.g. a nightly check) that want the same definition of "licensed".
create or replace function is_chama_licensed(p_chama_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select
    c.license_status = 'active'
    and (c.license_expiry is null or c.license_expiry >= current_date)
  from chamas c
  where c.id = p_chama_id;
$$;

-- =============================================================================
-- 5. GRANTS
--    Only the functions are reachable by the client roles Supabase issues
--    for anonymous/logged-in requests. Direct table access to chama_users
--    stays denied by RLS with no policies.
-- =============================================================================
grant execute on function register_user(text, text, text, uuid) to anon, authenticated;
grant execute on function authenticate_user(text, text) to anon, authenticated;
grant execute on function get_user_memberships(uuid) to anon, authenticated;
grant execute on function is_chama_licensed(uuid) to anon, authenticated;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
