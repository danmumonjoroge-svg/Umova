-- ============================================================
-- NOTE ON TRIGGER NAMES: Postgres fires triggers of one event in alphabetical order, so the BEFORE triggers are numbered
-- _1tenant (stamp/check tenant) -> _2perm (permission) -> _3guard (business rules) -> _4updated. Keep that order in later migrations.
-- ELIMU 001 — shared helpers, school settings, configurable lookups, academic structure
--
-- Run AFTER the Umova POS migrations phase1, phase7, phase8, phase10, phase28, phase50a, phase50.
-- Additive and re-runnable. Creates NOTHING outside the elimu_* namespace and replaces NO existing function.
--
-- WHAT IS HERE
--   0. Preconditions (stops early, with a readable message, if the core platform pieces are missing)
--   1. Helper functions: elimu_can / elimu_require (permissions), tenant+business stamping, audit, numbering
--   2. elimu_settings           per-school switches (the same pattern as lb_comm_preferences)
--   3. elimu_student_statuses   configurable student statuses (each maps to a fixed CATEGORY the rules rely on)
--      elimu_admission_statuses configurable admission stages (same idea)
--      elimu_number_sequences   admission / application number generators
--   4. elimu_academic_years, elimu_terms, elimu_classes, elimu_streams, elimu_class_teachers
--   5. elimu_ensure_setup()     seeds the default statuses / numbering for the signed-in school
--
-- TENANCY (read this once)
--   * Every table carries tenant_id (= pos_tenants.id = what get_current_tenant_id() returns). Top-level tables also carry
--     business_id (FK lb_businesses). No second tenant system exists here.
--   * Parent tables expose UNIQUE (tenant_id, id). Children reference parents with a COMPOSITE foreign key
--     (tenant_id, parent_id), so a row of school A can never point at a row of school B, even through a bug or a forged id.
--   * Row level security is ON for every table: rows are visible/writable only when tenant_id = get_current_tenant_id().
--   * Student records are never deleted: no DELETE policy exists on them; use archived_at / status.
-- PERMISSIONS
--   * elimu_can('<area>.<action>') uses a native key 'elimu.<area>.<action>' if the core catalogue (pos_all_permissions())
--     has been extended to include it, and otherwise falls back to existing keys. See INTEGRATION.md, "Permissions".
--   * Non-POS sessions (service role, migrations, the main Umova app) pass the permission check, exactly like
--     pos_enforce_permission(); RLS still limits what they can see to their own tenant claim.
-- ============================================================

-- ---------- 0. preconditions ----------
DO $$
DECLARE m text; missing text[] := ARRAY[]::text[];
BEGIN
  FOREACH m IN ARRAY ARRAY['get_current_tenant_id()','is_pos_session()','pos_has_permission(text)','pos_all_permissions()'] LOOP
    IF to_regprocedure(m) IS NULL THEN missing := missing || m; END IF;
  END LOOP;
  FOREACH m IN ARRAY ARRAY['lb_businesses','pos_staff','pos_audit_log'] LOOP
    IF to_regclass(m) IS NULL THEN missing := missing || m; END IF;
  END LOOP;
  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION 'ELIMU needs the Umova POS platform first (phase1 + phase28). Missing: %', array_to_string(missing, ', ');
  END IF;
END $$;

-- ---------- 1. helpers ----------

-- (merged install) elimu_set_updated_at / elimu_can / elimu_require now live in elimu_000_core.sql

-- Table-level write guard.  CREATE TRIGGER ... EXECUTE FUNCTION elimu_enforce('students.manage')
-- elimu.trusted = 'on' is set (transaction-local) only inside the SECURITY DEFINER functions of this module, AFTER they have
-- checked the caller's permission themselves (same pattern as pos.staff_admin in phase28). It is not reachable from the API.
CREATE OR REPLACE FUNCTION elimu_enforce() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('elimu.trusted', true), '') <> 'on' THEN
    PERFORM elimu_require(VARIADIC TG_ARGV);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- Stamp / check tenant (and business) on write.
--   * a POS session may only ever write its own tenant (RLS WITH CHECK also enforces it)
--   * business_id, when the table has one, must belong to that tenant
--   * tenant_id and business_id never change after insert
CREATE OR REPLACE FUNCTION elimu_tenant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_biz uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.tenant_id IS NULL AND is_pos_session() THEN NEW.tenant_id := get_current_tenant_id(); END IF;
    IF NEW.tenant_id IS NULL THEN RAISE EXCEPTION 'tenant_id is required.' USING ERRCODE = '23502'; END IF;
    v_biz := nullif(to_jsonb(NEW) ->> 'business_id', '')::uuid;
    IF v_biz IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lb_businesses b WHERE b.id = v_biz AND b.tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'That school does not belong to this tenant.' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN RAISE EXCEPTION 'tenant_id cannot be changed.' USING ERRCODE = '23514'; END IF;
    IF to_jsonb(NEW) ->> 'business_id' IS DISTINCT FROM to_jsonb(OLD) ->> 'business_id' THEN
      RAISE EXCEPTION 'business_id cannot be changed.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Audit trail into the EXISTING pos_audit_log. Writes only column NAMES that changed (never names, phones or notes), plus
-- the old/new value of any non-personal columns listed as extra trigger arguments (status ids, ranks, channels...).
--   CREATE TRIGGER ... EXECUTE FUNCTION elimu_audit('student', 'status_id')
CREATE OR REPLACE FUNCTION elimu_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row jsonb; v_old jsonb; v_changed text[]; v_meta jsonb; v_actor uuid; v_i int; v_col text;
BEGIN
  v_row := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  v_actor := nullif(auth.jwt() ->> 'pos_staff_id', '')::uuid;
  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    SELECT array_agg(n.key ORDER BY n.key) INTO v_changed
      FROM jsonb_each(v_row) n JOIN jsonb_each(v_old) o USING (key)
     WHERE n.value IS DISTINCT FROM o.value AND n.key NOT IN ('updated_at', 'updated_by');
    IF v_changed IS NULL THEN RETURN NEW; END IF;
    v_meta := jsonb_build_object('changed', to_jsonb(v_changed));
    FOR v_i IN 1 .. coalesce(array_length(TG_ARGV, 1), 0) - 1 LOOP
      v_col := TG_ARGV[v_i];
      IF v_col = ANY (v_changed) THEN
        v_meta := v_meta || jsonb_build_object(v_col, jsonb_build_object('from', v_old -> v_col, 'to', v_row -> v_col));
      END IF;
    END LOOP;
  ELSE
    v_meta := '{}'::jsonb;
    FOR v_i IN 1 .. coalesce(array_length(TG_ARGV, 1), 0) - 1 LOOP
      v_col := TG_ARGV[v_i];
      v_meta := v_meta || jsonb_build_object(v_col, v_row -> v_col);
    END LOOP;
  END IF;
  INSERT INTO pos_audit_log (pos_tenant_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES ((v_row ->> 'tenant_id')::uuid, CASE WHEN v_actor IS NULL THEN 'system' ELSE 'staff' END, v_actor,
          'ELIMU_' || upper(TG_ARGV[0]) || '_' || CASE TG_OP WHEN 'INSERT' THEN 'CREATED' WHEN 'UPDATE' THEN 'UPDATED' ELSE 'DELETED' END,
          'elimu_' || TG_ARGV[0], nullif(v_row ->> 'id', '')::uuid, v_meta);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

-- ---------- 2. settings (one row per school) ----------
CREATE TABLE IF NOT EXISTS elimu_settings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,   -- shape + defaults: elimu/utils/settings.js and elimu_setting_bool() below
  updated_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id),
  UNIQUE (tenant_id, id)
);
COMMENT ON TABLE elimu_settings IS 'Per-school Elimu switches. Keys used by the database: collect_care_notes, require_guardian_for_admission, require_explicit_consent, emergency_overrides_opt_out.';

-- Reads one boolean switch for the signed-in school (or the given tenant), falling back to the default given.
CREATE OR REPLACE FUNCTION elimu_setting_bool(p_key text, p_default boolean, p_tenant uuid DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT (s.settings ->> p_key)::boolean FROM elimu_settings s
      WHERE s.tenant_id = coalesce(p_tenant, get_current_tenant_id()) AND s.settings ? p_key LIMIT 1),
    p_default)
$$;

-- ---------- 3. configurable lookups ----------
-- A school may rename a status or add its own ("Deferred", "Interview booked"), but every status maps to ONE of a small fixed
-- set of CATEGORIES. The rules in the database and in reports (who may be enrolled, what "admitted" means) read the category,
-- never the label.
CREATE TABLE IF NOT EXISTS elimu_student_statuses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  code       text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  label      text NOT NULL CHECK (length(btrim(label)) > 0),
  category   text NOT NULL CHECK (category IN ('APPLICANT','ACTIVE','SUSPENDED','TRANSFERRED','GRADUATED','WITHDRAWN','ALUMNI')),
  is_default boolean NOT NULL DEFAULT false,   -- the status new records of this category start with
  is_system  boolean NOT NULL DEFAULT false,   -- seeded; cannot be deactivated
  is_active  boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_student_status_default ON elimu_student_statuses (tenant_id, business_id, category) WHERE is_default;

CREATE TABLE IF NOT EXISTS elimu_admission_statuses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  code       text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  label      text NOT NULL CHECK (length(btrim(label)) > 0),
  category   text NOT NULL CHECK (category IN ('SUBMITTED','IN_REVIEW','ACCEPTED','REJECTED','WAITLISTED','ADMITTED','WITHDRAWN')),
  is_default boolean NOT NULL DEFAULT false,
  is_system  boolean NOT NULL DEFAULT false,
  is_active  boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_admission_status_default ON elimu_admission_statuses (tenant_id, business_id, category) WHERE is_default;

CREATE TABLE IF NOT EXISTS elimu_number_sequences (
  tenant_id  uuid NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('ADMISSION','APPLICATION')),
  prefix     text NOT NULL DEFAULT '' CHECK (length(prefix) <= 12),
  padding    integer NOT NULL DEFAULT 4 CHECK (padding BETWEEN 1 AND 10),
  next_value bigint NOT NULL DEFAULT 1 CHECK (next_value >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, kind)
);

-- ---------- 4. academic structure ----------
CREATE TABLE IF NOT EXISTS elimu_academic_years (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  name        text NOT NULL CHECK (length(btrim(name)) > 0),          -- "2027 Academic Year"
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  status      text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','CURRENT','CLOSED')),
  created_by  uuid, updated_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT elimu_year_dates_chk CHECK (end_date > start_date),
  UNIQUE (tenant_id, business_id, name),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_one_current_year ON elimu_academic_years (tenant_id, business_id) WHERE status = 'CURRENT';

CREATE TABLE IF NOT EXISTS elimu_terms (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  term_number      smallint NOT NULL CHECK (term_number BETWEEN 1 AND 12),
  name             text NOT NULL CHECK (length(btrim(name)) > 0),     -- "Term 1"
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT elimu_term_dates_chk CHECK (end_date > start_date),
  FOREIGN KEY (tenant_id, academic_year_id) REFERENCES elimu_academic_years (tenant_id, id),
  UNIQUE (tenant_id, academic_year_id, term_number),
  UNIQUE (tenant_id, academic_year_id, id),      -- lets enrolments and applications prove "this term belongs to that year"
  UNIQUE (tenant_id, id)
);

-- A class is a LEVEL that persists across years (Grade 1, Form 3). Streams (1A, 1B) divide a class.
CREATE TABLE IF NOT EXISTS elimu_classes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  code        text NOT NULL CHECK (length(btrim(code)) > 0),
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  level_order integer NOT NULL DEFAULT 0,        -- Grade 1 < Grade 2 ...; used for promotion and sorting
  is_active   boolean NOT NULL DEFAULT true,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_class_code ON elimu_classes (tenant_id, business_id, lower(btrim(code)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_class_name ON elimu_classes (tenant_id, business_id, lower(btrim(name)));

CREATE TABLE IF NOT EXISTS elimu_streams (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  class_id  uuid NOT NULL,
  name      text NOT NULL CHECK (length(btrim(name)) > 0),               -- "1A"
  capacity  integer CHECK (capacity IS NULL OR capacity > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, class_id) REFERENCES elimu_classes (tenant_id, id),
  UNIQUE (tenant_id, class_id, id),            -- lets enrolments prove "this stream belongs to that class"
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_stream_name ON elimu_streams (tenant_id, class_id, lower(btrim(name)));

-- (merged install) class teachers: AI 2's elimu_class_teachers (history-preserving) is the single table; created in academic/10_core.sql

-- ---------- 4b. structure rules ----------
-- Years of one school may not overlap; terms must sit inside their year and may not overlap each other.
CREATE OR REPLACE FUNCTION elimu_year_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM elimu_academic_years y
              WHERE y.tenant_id = NEW.tenant_id AND y.business_id = NEW.business_id AND y.id <> NEW.id
                AND daterange(y.start_date, y.end_date, '[]') && daterange(NEW.start_date, NEW.end_date, '[]')) THEN
    RAISE EXCEPTION 'This academic year overlaps another academic year.' USING ERRCODE = '23P01';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'CLOSED' AND NEW.status <> 'CLOSED' THEN
    PERFORM elimu_require('structure.manage');   -- re-opening a closed year is a deliberate, privileged act
  END IF;
  -- when dates move, every term must still fit
  IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM elimu_terms t WHERE t.academic_year_id = NEW.id AND (t.start_date < NEW.start_date OR t.end_date > NEW.end_date)) THEN
    RAISE EXCEPTION 'A term of this year would fall outside the new year dates.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION elimu_term_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE y elimu_academic_years;
BEGIN
  SELECT * INTO y FROM elimu_academic_years WHERE tenant_id = NEW.tenant_id AND id = NEW.academic_year_id;
  IF NEW.start_date < y.start_date OR NEW.end_date > y.end_date THEN
    RAISE EXCEPTION 'A term must fall inside its academic year (% to %).', y.start_date, y.end_date USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM elimu_terms t WHERE t.tenant_id = NEW.tenant_id AND t.academic_year_id = NEW.academic_year_id AND t.id <> NEW.id
               AND daterange(t.start_date, t.end_date, '[]') && daterange(NEW.start_date, NEW.end_date, '[]')) THEN
    RAISE EXCEPTION 'This term overlaps another term of the same year.' USING ERRCODE = '23P01';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.academic_year_id IS DISTINCT FROM OLD.academic_year_id THEN
    RAISE EXCEPTION 'A term cannot be moved to another academic year.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION elimu_class_teacher_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pos_staff s WHERE s.id = NEW.staff_id AND s.pos_tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'That staff member does not belong to this school.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- Keeps one default per category in step: marking a new default clears the old one.
CREATE OR REPLACE FUNCTION elimu_lookup_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.category IS DISTINCT FROM OLD.category AND OLD.is_system THEN RAISE EXCEPTION 'The category of a built-in status cannot change.' USING ERRCODE = '23514'; END IF;
    IF OLD.is_system AND NOT NEW.is_active THEN RAISE EXCEPTION 'A built-in status cannot be switched off.' USING ERRCODE = '23514'; END IF;
    IF NEW.code IS DISTINCT FROM OLD.code AND OLD.is_system THEN RAISE EXCEPTION 'The code of a built-in status cannot change.' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NEW.is_default THEN
    EXECUTE format('UPDATE %I SET is_default = false WHERE tenant_id = $1 AND business_id = $2 AND category = $3 AND is_default AND id <> $4', TG_TABLE_NAME)
      USING NEW.tenant_id, NEW.business_id, NEW.category, NEW.id;
  END IF;
  RETURN NEW;
END $$;

-- ---------- 4c. numbering ----------
-- Next admission / application number for the signed-in school (or an explicit tenant when called by the service role).
-- Skips any number that is already taken, so a hand-typed number can never make the generator collide.
CREATE OR REPLACE FUNCTION elimu_next_number(p_kind text, p_tenant uuid DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid; r elimu_number_sequences; v_no text; v_taken boolean;
BEGIN
  IF p_kind NOT IN ('ADMISSION','APPLICATION') THEN RAISE EXCEPTION 'Unknown number kind.' USING ERRCODE = '22023'; END IF;
  IF is_pos_session() THEN
    IF p_tenant IS NOT NULL AND p_tenant IS DISTINCT FROM get_current_tenant_id() THEN RAISE EXCEPTION 'Wrong school.' USING ERRCODE = '42501'; END IF;
    PERFORM elimu_require(CASE p_kind WHEN 'ADMISSION' THEN 'students.manage' ELSE 'admissions.manage' END, 'admissions.manage');
    v_tenant := get_current_tenant_id();
  ELSE
    v_tenant := coalesce(p_tenant, get_current_tenant_id());
  END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No school selected.' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('elimu.trusted', 'on', true);
  INSERT INTO elimu_number_sequences (tenant_id, kind, prefix)
  VALUES (v_tenant, p_kind, CASE p_kind WHEN 'ADMISSION' THEN 'ADM-' ELSE 'APP-' END) ON CONFLICT DO NOTHING;
  LOOP
    UPDATE elimu_number_sequences SET next_value = next_value + 1, updated_at = now()
     WHERE tenant_id = v_tenant AND kind = p_kind RETURNING * INTO r;
    v_no := r.prefix || lpad((r.next_value - 1)::text, r.padding, '0');
    IF p_kind = 'ADMISSION' THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM elimu_students WHERE tenant_id = $1 AND upper(admission_no) = upper($2))' INTO v_taken USING v_tenant, v_no;
    ELSE
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM elimu_admission_applications WHERE tenant_id = $1 AND upper(application_no) = upper($2))' INTO v_taken USING v_tenant, v_no;
    END IF;
    EXIT WHEN NOT v_taken;
  END LOOP;
  PERFORM set_config('elimu.trusted', 'off', true);
  RETURN v_no;
END $$;

-- ---------- 5. triggers ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['elimu_settings','elimu_student_statuses','elimu_admission_statuses','elimu_academic_years','elimu_terms',
                           'elimu_classes','elimu_streams','elimu_number_sequences'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_1tenant ON %1$s', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_1tenant BEFORE INSERT OR UPDATE ON %1$s FOR EACH ROW EXECUTE FUNCTION elimu_tenant_guard()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['elimu_settings','elimu_student_statuses','elimu_admission_statuses','elimu_academic_years','elimu_terms','elimu_classes','elimu_streams'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_4updated ON %1$s', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_4updated BEFORE UPDATE ON %1$s FOR EACH ROW EXECUTE FUNCTION elimu_set_updated_at()', t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_elimu_settings_2perm ON elimu_settings;
CREATE TRIGGER trg_elimu_settings_2perm BEFORE INSERT OR UPDATE OR DELETE ON elimu_settings FOR EACH ROW EXECUTE FUNCTION elimu_enforce('settings.manage');
DROP TRIGGER IF EXISTS trg_elimu_student_statuses_2perm ON elimu_student_statuses;
CREATE TRIGGER trg_elimu_student_statuses_2perm BEFORE INSERT OR UPDATE OR DELETE ON elimu_student_statuses FOR EACH ROW EXECUTE FUNCTION elimu_enforce('settings.manage');
DROP TRIGGER IF EXISTS trg_elimu_student_statuses_3guard ON elimu_student_statuses;
CREATE TRIGGER trg_elimu_student_statuses_3guard BEFORE INSERT OR UPDATE ON elimu_student_statuses FOR EACH ROW EXECUTE FUNCTION elimu_lookup_guard();
DROP TRIGGER IF EXISTS trg_elimu_admission_statuses_2perm ON elimu_admission_statuses;
CREATE TRIGGER trg_elimu_admission_statuses_2perm BEFORE INSERT OR UPDATE OR DELETE ON elimu_admission_statuses FOR EACH ROW EXECUTE FUNCTION elimu_enforce('settings.manage');
DROP TRIGGER IF EXISTS trg_elimu_admission_statuses_3guard ON elimu_admission_statuses;
CREATE TRIGGER trg_elimu_admission_statuses_3guard BEFORE INSERT OR UPDATE ON elimu_admission_statuses FOR EACH ROW EXECUTE FUNCTION elimu_lookup_guard();
DROP TRIGGER IF EXISTS trg_elimu_number_sequences_2perm ON elimu_number_sequences;
CREATE TRIGGER trg_elimu_number_sequences_2perm BEFORE INSERT OR UPDATE OR DELETE ON elimu_number_sequences FOR EACH ROW EXECUTE FUNCTION elimu_enforce('settings.manage');

DROP TRIGGER IF EXISTS trg_elimu_academic_years_2perm ON elimu_academic_years;
CREATE TRIGGER trg_elimu_academic_years_2perm BEFORE INSERT OR UPDATE OR DELETE ON elimu_academic_years FOR EACH ROW EXECUTE FUNCTION elimu_enforce('structure.manage');
DROP TRIGGER IF EXISTS trg_elimu_academic_years_3guard ON elimu_academic_years;
CREATE TRIGGER trg_elimu_academic_years_3guard BEFORE INSERT OR UPDATE ON elimu_academic_years FOR EACH ROW EXECUTE FUNCTION elimu_year_guard();
DROP TRIGGER IF EXISTS trg_elimu_terms_2perm ON elimu_terms;
CREATE TRIGGER trg_elimu_terms_2perm BEFORE INSERT OR UPDATE OR DELETE ON elimu_terms FOR EACH ROW EXECUTE FUNCTION elimu_enforce('structure.manage');
DROP TRIGGER IF EXISTS trg_elimu_terms_3guard ON elimu_terms;
CREATE TRIGGER trg_elimu_terms_3guard BEFORE INSERT OR UPDATE ON elimu_terms FOR EACH ROW EXECUTE FUNCTION elimu_term_guard();
DROP TRIGGER IF EXISTS trg_elimu_classes_2perm ON elimu_classes;
CREATE TRIGGER trg_elimu_classes_2perm BEFORE INSERT OR UPDATE OR DELETE ON elimu_classes FOR EACH ROW EXECUTE FUNCTION elimu_enforce('structure.manage');
DROP TRIGGER IF EXISTS trg_elimu_streams_2perm ON elimu_streams;
CREATE TRIGGER trg_elimu_streams_2perm BEFORE INSERT OR UPDATE OR DELETE ON elimu_streams FOR EACH ROW EXECUTE FUNCTION elimu_enforce('structure.manage');

DROP TRIGGER IF EXISTS trg_elimu_academic_years_audit ON elimu_academic_years;
CREATE TRIGGER trg_elimu_academic_years_audit AFTER INSERT OR UPDATE ON elimu_academic_years FOR EACH ROW EXECUTE FUNCTION elimu_audit('academic_year', 'status');
DROP TRIGGER IF EXISTS trg_elimu_classes_audit ON elimu_classes;
CREATE TRIGGER trg_elimu_classes_audit AFTER INSERT OR UPDATE ON elimu_classes FOR EACH ROW EXECUTE FUNCTION elimu_audit('class');
DROP TRIGGER IF EXISTS trg_elimu_settings_audit ON elimu_settings;
CREATE TRIGGER trg_elimu_settings_audit AFTER INSERT OR UPDATE ON elimu_settings FOR EACH ROW EXECUTE FUNCTION elimu_audit('settings');
DROP TRIGGER IF EXISTS trg_elimu_student_statuses_audit ON elimu_student_statuses;
CREATE TRIGGER trg_elimu_student_statuses_audit AFTER INSERT OR UPDATE ON elimu_student_statuses FOR EACH ROW EXECUTE FUNCTION elimu_audit('student_status', 'code', 'category', 'is_active');
DROP TRIGGER IF EXISTS trg_elimu_admission_statuses_audit ON elimu_admission_statuses;
CREATE TRIGGER trg_elimu_admission_statuses_audit AFTER INSERT OR UPDATE ON elimu_admission_statuses FOR EACH ROW EXECUTE FUNCTION elimu_audit('admission_status', 'code', 'category', 'is_active');

-- ---------- 6. indexes ----------
CREATE INDEX IF NOT EXISTS idx_elimu_terms_year ON elimu_terms (tenant_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_elimu_streams_class ON elimu_streams (tenant_id, class_id);

-- ---------- 7. row level security ----------
-- Pattern: a SELECT policy gated by the VIEW permission; INSERT / UPDATE (and DELETE where deleting makes sense) gated by tenant
-- here and by the permission trigger above. The (select ...) wrapper lets Postgres evaluate each helper once per statement.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('elimu_settings','structure.view'), ('elimu_student_statuses','structure.view'), ('elimu_admission_statuses','structure.view'),
      ('elimu_number_sequences','structure.view'), ('elimu_academic_years','structure.view'), ('elimu_terms','structure.view'),
      ('elimu_classes','structure.view'), ('elimu_streams','structure.view')
    ) AS v(tbl, view_action)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.tbl || '_select', r.tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (tenant_id = (SELECT get_current_tenant_id()) AND (SELECT elimu_can(%L)))', r.tbl || '_select', r.tbl, r.view_action);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.tbl || '_insert', r.tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (tenant_id = (SELECT get_current_tenant_id()))', r.tbl || '_insert', r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.tbl || '_update', r.tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (tenant_id = (SELECT get_current_tenant_id())) WITH CHECK (tenant_id = (SELECT get_current_tenant_id()))', r.tbl || '_update', r.tbl);
  END LOOP;
END $$;

-- ---------- 8. first-use setup ----------
-- Seeds the default statuses, numbering and settings row for the signed-in school. Idempotent; never overwrites a school's own
-- edits. Safe for anyone who can see school records to call because it only inserts the standard defaults.
CREATE OR REPLACE FUNCTION elimu_ensure_setup(p_business_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid := get_current_tenant_id(); v_biz uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No school selected.' USING ERRCODE = '22023'; END IF;
  IF is_pos_session() THEN PERFORM elimu_require('structure.view', 'settings.manage'); END IF;
  SELECT b.id INTO v_biz FROM lb_businesses b WHERE b.tenant_id = v_tenant AND (p_business_id IS NULL OR b.id = p_business_id) ORDER BY b.id LIMIT 1;
  IF v_biz IS NULL THEN RAISE EXCEPTION 'This tenant has no business record.' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('elimu.trusted', 'on', true);

  INSERT INTO elimu_student_statuses (tenant_id, business_id, code, label, category, is_default, is_system, sort_order)
  SELECT v.* FROM (VALUES
    (v_tenant, v_biz, 'APPLICANT',   'Applicant',   'APPLICANT',   true, true, 10),
    (v_tenant, v_biz, 'ACTIVE',      'Active',      'ACTIVE',      true, true, 20),
    (v_tenant, v_biz, 'SUSPENDED',   'Suspended',   'SUSPENDED',   true, true, 30),
    (v_tenant, v_biz, 'TRANSFERRED', 'Transferred', 'TRANSFERRED', true, true, 40),
    (v_tenant, v_biz, 'GRADUATED',   'Graduated',   'GRADUATED',   true, true, 50),
    (v_tenant, v_biz, 'WITHDRAWN',   'Withdrawn',   'WITHDRAWN',   true, true, 60),
    (v_tenant, v_biz, 'ALUMNI',      'Alumni',      'ALUMNI',      true, true, 70)
  ) AS v(tenant_id, business_id, code, label, category, is_default, is_system, sort_order)
   WHERE NOT EXISTS (SELECT 1 FROM elimu_student_statuses x WHERE x.tenant_id = v.tenant_id AND x.code = v.code);  -- NOT ON CONFLICT: the default-flag guard would demote existing defaults before the conflict is detected

  INSERT INTO elimu_admission_statuses (tenant_id, business_id, code, label, category, is_default, is_system, sort_order)
  SELECT v.* FROM (VALUES
    (v_tenant, v_biz, 'SUBMITTED',  'Application received', 'SUBMITTED',  true, true, 10),
    (v_tenant, v_biz, 'IN_REVIEW',  'Under review',         'IN_REVIEW',  true, true, 20),
    (v_tenant, v_biz, 'ACCEPTED',   'Accepted',             'ACCEPTED',   true, true, 30),
    (v_tenant, v_biz, 'WAITLISTED', 'Waitlisted',           'WAITLISTED', true, true, 40),
    (v_tenant, v_biz, 'REJECTED',   'Rejected',             'REJECTED',   true, true, 50),
    (v_tenant, v_biz, 'ADMITTED',   'Admitted',             'ADMITTED',   true, true, 60),
    (v_tenant, v_biz, 'WITHDRAWN',  'Withdrawn',            'WITHDRAWN',  true, true, 70)
  ) AS v(tenant_id, business_id, code, label, category, is_default, is_system, sort_order)
   WHERE NOT EXISTS (SELECT 1 FROM elimu_admission_statuses x WHERE x.tenant_id = v.tenant_id AND x.code = v.code);  -- NOT ON CONFLICT: the default-flag guard would demote existing defaults before the conflict is detected

  INSERT INTO elimu_number_sequences (tenant_id, kind, prefix) VALUES (v_tenant, 'ADMISSION', 'ADM-'), (v_tenant, 'APPLICATION', 'APP-') ON CONFLICT DO NOTHING;
  INSERT INTO elimu_settings (tenant_id, business_id) VALUES (v_tenant, v_biz) ON CONFLICT (business_id) DO NOTHING;
  PERFORM set_config('elimu.trusted', 'off', true);
  RETURN jsonb_build_object('ok', true, 'tenant_id', v_tenant, 'business_id', v_biz);
END $$;

-- ---------- 9. privileges ----------
-- Re-applied at the end of every Elimu migration. Supabase grants new public objects to anon/authenticated by default; Elimu
-- holds children's records, so nothing is left to anon or PUBLIC. RLS and the permission triggers still decide what a signed-in
-- member of staff can do. History tables are read-only for every API role: only SECURITY DEFINER triggers write them.
CREATE OR REPLACE FUNCTION elimu_apply_grants() RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record; has_anon boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
        has_auth boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
        -- (merged install) ONLY AI 1's own objects are touched. The old '^elimu_' sweep re-granted full DML on AI 2/3/4 tables on every re-run.
        v_rels text[] := ARRAY['elimu_academic_years','elimu_admission_applications','elimu_admission_status_history','elimu_admission_statuses','elimu_call_log','elimu_classes','elimu_enrollment_history','elimu_enrollments','elimu_guardian_channel_consent','elimu_guardian_contacts','elimu_guardians','elimu_message_links','elimu_notification_rules','elimu_notifications','elimu_number_sequences','elimu_settings','elimu_streams','elimu_student_care_notes','elimu_student_guardians','elimu_student_status_history','elimu_student_statuses','elimu_students','elimu_terms','v_elimu_communication_history','v_elimu_current_period','v_elimu_data_quality','v_elimu_enrollment_history','v_elimu_student_directory'];
        v_fns text[] := ARRAY['elimu_admission_transition_ok','elimu_admit_application','elimu_application_guard','elimu_application_notify','elimu_application_status_log','elimu_apply_grants','elimu_audit','elimu_call_guard','elimu_care_notes_guard','elimu_change_student_status','elimu_class_teacher_guard','elimu_consent_guard','elimu_contact_eligibility','elimu_contact_guard','elimu_dashboard_summary','elimu_enforce','elimu_enroll_students','elimu_enrollment_guard','elimu_enrollment_log','elimu_ensure_setup','elimu_find_duplicate_students','elimu_find_guardian_matches','elimu_guardian_guard','elimu_log_call_intent','elimu_lookup_guard','elimu_mark_message','elimu_message_link_guard','elimu_move_enrollment','elimu_next_number','elimu_normalize_email','elimu_normalize_msisdn','elimu_notify','elimu_record_call_outcome','elimu_record_message','elimu_resolve_notification','elimu_seed_notification_rules','elimu_set_primary_guardian','elimu_setting_bool','elimu_sg_guard','elimu_sg_rank_required','elimu_student_guard','elimu_student_status_log','elimu_submit_application','elimu_tenant_guard','elimu_term_guard','elimu_year_guard'];
BEGIN
  FOR r IN SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r','v') AND c.relname = ANY (v_rels)
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', r.relname);
    IF has_anon THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon', r.relname); END IF;
    IF has_auth THEN
      IF r.relkind = 'v' OR r.relname ~ '_history$' THEN EXECUTE format('GRANT SELECT ON public.%I TO authenticated', r.relname);
      ELSE EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', r.relname); END IF;
    END IF;
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = ANY (v_fns) AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    IF has_anon THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig); END IF;
    IF has_auth THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig); END IF;
  END LOOP;
END $$;
SELECT elimu_apply_grants();
