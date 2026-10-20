-- Phase 27 scratch-DB tests. Run ONLY on a throwaway database as a superuser.
-- Stand-ins for Supabase pieces (auth.jwt, storage, pos_staff, lb_businesses).
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE pos_staff (id uuid PRIMARY KEY, pos_tenant_id uuid, role text, status text);
CREATE TABLE lb_businesses (id uuid PRIMARY KEY, tenant_id uuid, name text, phone text, email text, address text,
  currency text, time_zone text, logo_url text, updated_at timestamptz);
CREATE OR REPLACE FUNCTION get_current_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(auth.jwt() ->> 'pos_tenant_id','')::uuid $$;

CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid DEFAULT gen_random_uuid(), bucket_id text, name text);
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array(name,'/') $$;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
INSERT INTO storage.buckets VALUES ('business-logos', NULL, NULL);
GRANT USAGE ON SCHEMA public, auth, storage TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public, storage TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth, storage TO authenticated;

-- two tenants / businesses
INSERT INTO lb_businesses VALUES
 ('b1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','Hardware Ltd','1','h@x','Nairobi','KES','Africa/Nairobi',NULL,now()),
 ('b2000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000002','Salon Ltd','2','s@x','Thika','KES','Africa/Nairobi',NULL,now());
INSERT INTO pos_staff VALUES
 ('50000000-0000-0000-0000-00000000000a','a1000000-0000-0000-0000-000000000001','owner','active'),
 ('50000000-0000-0000-0000-00000000000b','a1000000-0000-0000-0000-000000000001','cashier','active'),
 ('50000000-0000-0000-0000-00000000000c','a1000000-0000-0000-0000-000000000001','manager','active'),
 ('50000000-0000-0000-0000-00000000000d','a1000000-0000-0000-0000-000000000001','owner','disabled'),
 ('50000000-0000-0000-0000-0000000000e2','a2000000-0000-0000-0000-000000000002','owner','active');

\i ../phase15_business_logo.sql   -- real upgrade path: phase15 policies first
\i ../phase27_branding.sql

CREATE TEMP TABLE results (n text, pass boolean);
GRANT ALL ON results TO authenticated;

-- helper: run a statement as a given session; expect OK or a specific failure
CREATE OR REPLACE FUNCTION t(name text, staff uuid, tenant uuid, stmt text, expect_ok boolean) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE ok boolean := true; n int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN staff IS NULL AND tenant IS NULL THEN '{}'
         WHEN staff IS NULL THEN json_build_object('pos_tenant_id', tenant)::text
         ELSE json_build_object('pos_staff_id', staff, 'pos_tenant_id', tenant)::text END, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE stmt; GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN ok := false; END IF;      -- RLS filtered the row => treat as denied
  EXCEPTION WHEN OTHERS THEN ok := false; END;
  RESET ROLE;
  INSERT INTO pg_temp.results VALUES (name, ok = expect_ok);
END $$;

-- ---------- fixtures: existing logo objects (inserted as superuser) ----------
INSERT INTO storage.objects(bucket_id,name) VALUES
 ('business-logos','b1000000-0000-0000-0000-000000000001/logo.png'),
 ('business-logos','b2000000-0000-0000-0000-000000000002/logo.png');

\set T1 'a1000000-0000-0000-0000-000000000001'
\set T2 'a2000000-0000-0000-0000-000000000002'
\set OWN '50000000-0000-0000-0000-00000000000a'
\set CSH '50000000-0000-0000-0000-00000000000b'
\set MGR '50000000-0000-0000-0000-00000000000c'
\set DIS '50000000-0000-0000-0000-00000000000d'
\set OWN2 '50000000-0000-0000-0000-0000000000e2'

-- ---------- lb_businesses identity guard ----------
SELECT t('owner CAN rename own business',            :'OWN',:'T1', $$UPDATE lb_businesses SET name='Hardware 2' WHERE id='b1000000-0000-0000-0000-000000000001'$$, true);
SELECT t('cashier CANNOT rename business',           :'CSH',:'T1', $$UPDATE lb_businesses SET name='Hacked' WHERE id='b1000000-0000-0000-0000-000000000001'$$, false);
SELECT t('manager CANNOT change logo_url',           :'MGR',:'T1', $$UPDATE lb_businesses SET logo_url='https://evil/x.png' WHERE id='b1000000-0000-0000-0000-000000000001'$$, false);
SELECT t('cashier CANNOT change phone',              :'CSH',:'T1', $$UPDATE lb_businesses SET phone='999' WHERE id='b1000000-0000-0000-0000-000000000001'$$, false);
SELECT t('disabled owner CANNOT rename',             :'DIS',:'T1', $$UPDATE lb_businesses SET name='Zombie' WHERE id='b1000000-0000-0000-0000-000000000001'$$, false);
SELECT t('cashier CAN touch non-identity column',    :'CSH',:'T1', $$UPDATE lb_businesses SET updated_at=now() WHERE id='b1000000-0000-0000-0000-000000000001'$$, true);
SELECT t('non-POS session (main app) CAN rename',    NULL,   :'T1', $$UPDATE lb_businesses SET name='Main App Edit' WHERE id='b1000000-0000-0000-0000-000000000001'$$, true);

-- ---------- storage: upload ----------
SELECT t('owner CAN upload to own folder',           :'OWN',:'T1', $$INSERT INTO storage.objects(bucket_id,name) VALUES ('business-logos','b1000000-0000-0000-0000-000000000001/logo2.png')$$, true);
SELECT t('cashier CANNOT upload to own folder',      :'CSH',:'T1', $$INSERT INTO storage.objects(bucket_id,name) VALUES ('business-logos','b1000000-0000-0000-0000-000000000001/logo3.png')$$, false);
SELECT t('owner CANNOT upload to OTHER business',    :'OWN',:'T1', $$INSERT INTO storage.objects(bucket_id,name) VALUES ('business-logos','b2000000-0000-0000-0000-000000000002/logo.png')$$, false);
SELECT t('disabled owner CANNOT upload',             :'DIS',:'T1', $$INSERT INTO storage.objects(bucket_id,name) VALUES ('business-logos','b1000000-0000-0000-0000-000000000001/logo4.png')$$, false);
SELECT t('non-POS session CAN upload to own tenant',NULL,   :'T1', $$INSERT INTO storage.objects(bucket_id,name) VALUES ('business-logos','b1000000-0000-0000-0000-000000000001/logo5.png')$$, true);

-- ---------- storage: replace / delete ----------
SELECT t('owner CAN replace own logo',               :'OWN',:'T1', $$UPDATE storage.objects SET name=name WHERE name='b1000000-0000-0000-0000-000000000001/logo.png'$$, true);
SELECT t('cashier CANNOT replace logo',              :'CSH',:'T1', $$UPDATE storage.objects SET name=name WHERE name='b1000000-0000-0000-0000-000000000001/logo.png'$$, false);
SELECT t('owner CANNOT replace OTHER biz logo',      :'OWN',:'T1', $$UPDATE storage.objects SET name=name WHERE name='b2000000-0000-0000-0000-000000000002/logo.png'$$, false);
SELECT t('cashier CANNOT delete logo',               :'CSH',:'T1', $$DELETE FROM storage.objects WHERE name='b1000000-0000-0000-0000-000000000001/logo.png'$$, false);
SELECT t('owner CANNOT delete OTHER biz logo',       :'OWN',:'T1', $$DELETE FROM storage.objects WHERE name='b2000000-0000-0000-0000-000000000002/logo.png'$$, false);
SELECT t('other tenant owner CAN delete own logo',   :'OWN2',:'T2',$$DELETE FROM storage.objects WHERE name='b2000000-0000-0000-0000-000000000002/logo.png'$$, true);
SELECT t('owner CAN delete own logo',                :'OWN',:'T1', $$DELETE FROM storage.objects WHERE name='b1000000-0000-0000-0000-000000000001/logo.png'$$, true);

-- ---------- bucket limits ----------
SELECT 'bucket limits' AS n, (file_size_limit = 2097152 AND allowed_mime_types = ARRAY['image/png','image/jpeg']) AS pass
  FROM storage.buckets WHERE id='business-logos'
UNION ALL SELECT n, pass FROM pg_temp.results;

SELECT CASE WHEN bool_and(pass) THEN 'ALL PASS' ELSE 'FAILURES' END AS summary, count(*) AS checks FROM (
  SELECT (file_size_limit = 2097152 AND allowed_mime_types = ARRAY['image/png','image/jpeg']) AS pass FROM storage.buckets WHERE id='business-logos'
  UNION ALL SELECT pass FROM pg_temp.results) x;

-- re-run safety: applying the migration twice must not error
\i ../phase27_branding.sql
