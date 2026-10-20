\set ON_ERROR_STOP on
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;
create table pos_tenants(id uuid primary key);
create table pos_staff(id uuid primary key, pos_tenant_id uuid, auth_user_id uuid, username text, name text, role text, status text default 'active', must_change_password boolean default false);
create table pos_audit_log(id bigserial primary key, pos_tenant_id uuid, actor_type text, actor_id uuid, action text, entity_type text, entity_id uuid, metadata jsonb, created_at timestamptz default now());
create table lb_businesses(id uuid primary key default gen_random_uuid(), tenant_id uuid, name text, logo_url text);
create table lb_pos_settings(id uuid primary key default gen_random_uuid(), tenant_id uuid, settings jsonb);
