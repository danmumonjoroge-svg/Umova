-- SCRATCH-ONLY stand-ins for the live tables/functions phase48 depends on. Never run on a real database.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb $$;
CREATE OR REPLACE FUNCTION get_current_tenant_id() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.tenant', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION is_pos_session() RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.pos', true), 'on') = 'on' $$;
CREATE OR REPLACE FUNCTION pos_has_permission(p text) RETURNS boolean LANGUAGE sql AS $$ SELECT position(p in coalesce(current_setting('test.perms', true), '')) > 0 $$;
CREATE OR REPLACE FUNCTION pos_require(VARIADIC p_perms text[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE a text;
BEGIN FOREACH a IN ARRAY p_perms LOOP IF pos_has_permission(a) THEN RETURN; END IF; END LOOP;
  RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END $$;
CREATE TABLE lb_businesses (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);
CREATE TABLE lb_customers (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, business_id uuid, name text);
CREATE TABLE lb_products (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);
CREATE TABLE lb_sales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, status text DEFAULT 'COMPLETED', total_amount numeric);
CREATE TABLE pos_audit_log(id bigserial primary key, pos_tenant_id uuid, actor_type text, actor_id uuid, action text, entity_type text, entity_id uuid, created_at timestamptz default now());
