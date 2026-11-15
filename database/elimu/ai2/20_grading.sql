-- ============================================================
-- ELIMU Grading — 20 GRADING ENGINE (schema + functions)
-- Run after academic/schema/10_core.sql. Re-runnable.
--
-- Tables created: elimu_grading_schemes, elimu_grading_rules  (+ column elimu_subjects.grading_scheme_id)
--
-- NOTHING IS HARD-CODED: bands, points, descriptors and remarks are rows. A scheme is a VERSION; once any result has
-- been computed with it, its bands are LOCKED (trigger). To change a locked scheme you create version n+1
-- (elimu_new_scheme_version); old results keep pointing at the version they were graded with, and ALSO store the literal
-- grade / points / descriptor, so history is correct even in the worst case.
--
-- Band semantics: a percentage (rounded to the scheme's percent_decimals) gets the band with the HIGHEST min_percent that
-- is <= it ("floor match"), so 79.6 with bands 70-79 / 80-100 and decimals 2 is still a B. max_percent is the displayed
-- upper edge and is used for overlap prevention (EXCLUDE constraint) and completeness validation.
-- ============================================================

CREATE TABLE IF NOT EXISTS elimu_grading_schemes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  family_id      uuid NOT NULL DEFAULT gen_random_uuid(),     -- same for every version of "the same" scheme
  version        integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  name           text NOT NULL CHECK (length(btrim(name)) > 0),
  description    text,
  applicable_levels text[],                                    -- NULL = any level (matches elimu_ref_classes.level_code)
  is_default     boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true,
  percent_decimals smallint NOT NULL DEFAULT 0 CHECK (percent_decimals BETWEEN 0 AND 2),
  pass_percent   numeric(5,2) CHECK (pass_percent IS NULL OR pass_percent BETWEEN 0 AND 100),
  supersedes_id  uuid REFERENCES elimu_grading_schemes(id),
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, family_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_elimu_scheme_default ON elimu_grading_schemes (tenant_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_elimu_scheme_list ON elimu_grading_schemes (tenant_id, is_active);

CREATE TABLE IF NOT EXISTS elimu_grading_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  scheme_id   uuid NOT NULL REFERENCES elimu_grading_schemes(id) ON DELETE CASCADE,
  grade       text NOT NULL CHECK (length(btrim(grade)) BETWEEN 1 AND 10),
  min_percent numeric(6,3) NOT NULL,
  max_percent numeric(6,3) NOT NULL,
  grade_point numeric(5,2),
  descriptor  text,
  remark      text,
  is_pass     boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  CONSTRAINT elimu_rule_range_chk CHECK (min_percent >= 0 AND max_percent <= 100 AND min_percent <= max_percent),
  CONSTRAINT elimu_rule_unique_grade UNIQUE (scheme_id, grade),
  CONSTRAINT elimu_rule_no_overlap EXCLUDE USING gist (scheme_id WITH =, numrange(min_percent, max_percent, '[]') WITH &&)
);
CREATE INDEX IF NOT EXISTS idx_elimu_rules_scheme ON elimu_grading_rules (scheme_id, min_percent DESC);

ALTER TABLE elimu_subjects ADD COLUMN IF NOT EXISTS grading_scheme_id uuid REFERENCES elimu_grading_schemes(id);

-- ---------------------------------------------------------------- in-use lock
CREATE OR REPLACE FUNCTION elimu_scheme_in_use(p_scheme uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF to_regclass('public.elimu_subject_results') IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM elimu_subject_results WHERE grading_scheme_id = p_scheme)
      OR EXISTS (SELECT 1 FROM elimu_term_results WHERE grading_scheme_id = p_scheme);
END $$;

CREATE OR REPLACE FUNCTION elimu_guard_scheme() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.family_id IS DISTINCT FROM OLD.family_id OR NEW.version IS DISTINCT FROM OLD.version THEN
      RAISE EXCEPTION 'Scheme identity cannot change.' USING ERRCODE = '42501';
    END IF;
    IF (NEW.percent_decimals IS DISTINCT FROM OLD.percent_decimals OR NEW.pass_percent IS DISTINCT FROM OLD.pass_percent) AND elimu_scheme_in_use(OLD.id) THEN
      RAISE EXCEPTION 'This grading scheme has been used for results and is locked. Create a new version instead.' USING ERRCODE = '42501';
    END IF;
    IF NEW.is_default AND NOT OLD.is_default AND NOT NEW.is_active THEN RAISE EXCEPTION 'An inactive scheme cannot be the default.' USING ERRCODE = '23514'; END IF;
  ELSIF is_pos_session() THEN NEW.created_by := elimu_staff_id(); END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_scheme_guard ON elimu_grading_schemes;
CREATE TRIGGER trg_elimu_scheme_guard BEFORE INSERT OR UPDATE ON elimu_grading_schemes FOR EACH ROW EXECUTE FUNCTION elimu_guard_scheme();
DROP TRIGGER IF EXISTS trg_elimu_scheme_nodelete ON elimu_grading_schemes;
CREATE TRIGGER trg_elimu_scheme_nodelete BEFORE DELETE ON elimu_grading_schemes FOR EACH ROW EXECUTE FUNCTION elimu_block_delete();

CREATE OR REPLACE FUNCTION elimu_guard_rule() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_scheme uuid := coalesce(NEW.scheme_id, OLD.scheme_id); v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM elimu_grading_schemes WHERE id = v_scheme;
  IF TG_OP <> 'DELETE' AND NEW.tenant_id IS DISTINCT FROM v_tenant THEN RAISE EXCEPTION 'Rule tenant must match its scheme.' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.scheme_id IS DISTINCT FROM OLD.scheme_id THEN RAISE EXCEPTION 'A rule cannot move to another scheme.' USING ERRCODE = '42501'; END IF;
  IF elimu_scheme_in_use(v_scheme) THEN
    RAISE EXCEPTION 'This grading scheme has been used for results and is locked. Create a new version instead.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  NEW.grade := btrim(NEW.grade);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_rule_guard ON elimu_grading_rules;
CREATE TRIGGER trg_elimu_rule_guard BEFORE INSERT OR UPDATE OR DELETE ON elimu_grading_rules FOR EACH ROW EXECUTE FUNCTION elimu_guard_rule();

-- ---------------------------------------------------------------- engine functions
-- Percentage -> band. Rounds to the scheme's decimals, clamps to 0..100, floor-matches. Returns 0 rows if the scheme has no band at/below it.
CREATE OR REPLACE FUNCTION elimu_grade_lookup(p_scheme uuid, p_pct numeric)
RETURNS TABLE (rule_id uuid, grade text, grade_point numeric, descriptor text, remark text, is_pass boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.grade, r.grade_point, r.descriptor, r.remark, r.is_pass
    FROM elimu_grading_rules r
    JOIN elimu_grading_schemes s ON s.id = r.scheme_id
   WHERE r.scheme_id = p_scheme AND s.tenant_id = get_current_tenant_id()
     AND r.min_percent <= round(least(greatest(p_pct, 0), 100), s.percent_decimals)
   ORDER BY r.min_percent DESC LIMIT 1
$$;

-- Problems that would make a scheme unsafe to use ([] = fine).
CREATE OR REPLACE FUNCTION elimu_validate_scheme(p_scheme uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s elimu_grading_schemes; step numeric; r record; prev_max numeric := NULL; problems jsonb := '[]'::jsonb; n int := 0; first_min numeric; last_max numeric;
BEGIN
  SELECT * INTO s FROM elimu_grading_schemes WHERE id = p_scheme AND tenant_id = get_current_tenant_id();
  IF s.id IS NULL THEN RETURN jsonb_build_array('Scheme not found.'); END IF;
  step := power(10::numeric, -s.percent_decimals);
  FOR r IN SELECT * FROM elimu_grading_rules WHERE scheme_id = p_scheme ORDER BY min_percent LOOP
    n := n + 1;
    IF n = 1 THEN first_min := r.min_percent; END IF;
    IF prev_max IS NOT NULL AND r.min_percent - prev_max > step THEN
      problems := problems || to_jsonb(format('Gap between %s and %s: some percentages would have no clear band.', prev_max, r.min_percent));
    END IF;
    prev_max := r.max_percent; last_max := r.max_percent;
  END LOOP;
  IF n = 0 THEN RETURN jsonb_build_array('The scheme has no grade bands.'); END IF;
  IF first_min <> 0 THEN problems := problems || to_jsonb(format('The lowest band starts at %s, not 0.', first_min)); END IF;
  IF last_max < 100 THEN problems := problems || to_jsonb(format('The highest band ends at %s, not 100.', last_max)); END IF;
  RETURN problems;
END $$;

-- Which scheme grades this subject in this class: subject override -> scheme for the class level -> school default.
CREATE OR REPLACE FUNCTION elimu_resolve_scheme(p_subject uuid, p_class uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id(); v uuid; lvl text;
BEGIN
  IF p_subject IS NOT NULL THEN
    SELECT s.id INTO v FROM elimu_subjects j JOIN elimu_grading_schemes s ON s.id = j.grading_scheme_id
     WHERE j.id = p_subject AND j.tenant_id = t AND s.is_active;
    IF v IS NOT NULL THEN RETURN v; END IF;
  END IF;
  SELECT level_code INTO lvl FROM elimu_ref_classes WHERE id = p_class AND tenant_id = t;
  IF lvl IS NOT NULL THEN
    SELECT id INTO v FROM elimu_grading_schemes
     WHERE tenant_id = t AND is_active AND applicable_levels IS NOT NULL AND lvl = ANY (applicable_levels)
     ORDER BY version DESC, created_at DESC LIMIT 1;
    IF v IS NOT NULL THEN RETURN v; END IF;
  END IF;
  SELECT id INTO v FROM elimu_grading_schemes WHERE tenant_id = t AND is_default AND is_active LIMIT 1;
  RETURN v;
END $$;

-- ---------------------------------------------------------------- RPCs (config.manage)
-- Copy a scheme + bands as version n+1. The old version stays (for history) but is retired; defaults move to the new one.
CREATE OR REPLACE FUNCTION elimu_new_scheme_version(p_scheme uuid, p_name text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o elimu_grading_schemes; n_id uuid := gen_random_uuid(); v_max int;
BEGIN
  IF NOT elimu_can('config.manage') THEN RAISE EXCEPTION 'You do not have permission to change grading schemes.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO o FROM elimu_grading_schemes WHERE id = p_scheme AND tenant_id = get_current_tenant_id();
  IF o.id IS NULL THEN RAISE EXCEPTION 'Scheme not found.' USING ERRCODE = 'P0002'; END IF;
  SELECT max(version) INTO v_max FROM elimu_grading_schemes WHERE family_id = o.family_id;
  UPDATE elimu_grading_schemes SET is_default = false, is_active = false WHERE id = o.id;
  INSERT INTO elimu_grading_schemes (id, tenant_id, family_id, version, name, description, applicable_levels, is_default, is_active, percent_decimals, pass_percent, supersedes_id)
  VALUES (n_id, o.tenant_id, o.family_id, v_max + 1, coalesce(p_name, o.name), o.description, o.applicable_levels, o.is_default, true, o.percent_decimals, o.pass_percent, o.id);
  INSERT INTO elimu_grading_rules (tenant_id, scheme_id, grade, min_percent, max_percent, grade_point, descriptor, remark, is_pass, sort_order)
  SELECT tenant_id, n_id, grade, min_percent, max_percent, grade_point, descriptor, remark, is_pass, sort_order FROM elimu_grading_rules WHERE scheme_id = o.id;
  UPDATE elimu_subjects SET grading_scheme_id = n_id WHERE grading_scheme_id = o.id AND tenant_id = o.tenant_id;
  PERFORM elimu_audit('GRADING_SCHEME_VERSIONED', 'elimu_grading_schemes', n_id, jsonb_build_object('from', o.id, 'version', v_max + 1));
  RETURN n_id;
END $$;

-- Make a scheme the school default (must be valid and active).
CREATE OR REPLACE FUNCTION elimu_set_default_scheme(p_scheme uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE probs jsonb;
BEGIN
  IF NOT elimu_can('config.manage') THEN RAISE EXCEPTION 'You do not have permission to change grading schemes.' USING ERRCODE = '42501'; END IF;
  probs := elimu_validate_scheme(p_scheme);
  IF jsonb_array_length(probs) > 0 THEN RETURN jsonb_build_object('ok', false, 'problems', probs); END IF;
  UPDATE elimu_grading_schemes SET is_default = false WHERE tenant_id = get_current_tenant_id() AND is_default AND id <> p_scheme;
  UPDATE elimu_grading_schemes SET is_default = true WHERE id = p_scheme AND tenant_id = get_current_tenant_id() AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scheme not found or inactive.' USING ERRCODE = 'P0002'; END IF;
  PERFORM elimu_audit('GRADING_DEFAULT_SET', 'elimu_grading_schemes', p_scheme, '{}');
  RETURN jsonb_build_object('ok', true);
END $$;

-- ---------------------------------------------------------------- RLS
ALTER TABLE elimu_grading_schemes ENABLE ROW LEVEL SECURITY;
ALTER TABLE elimu_grading_rules   ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_scheme_sel ON elimu_grading_schemes;
CREATE POLICY elimu_scheme_sel ON elimu_grading_schemes FOR SELECT USING (tenant_id = get_current_tenant_id() AND elimu_any_role());
DROP POLICY IF EXISTS elimu_scheme_ins ON elimu_grading_schemes;
CREATE POLICY elimu_scheme_ins ON elimu_grading_schemes FOR INSERT WITH CHECK (tenant_id = get_current_tenant_id() AND elimu_can('config.manage'));
DROP POLICY IF EXISTS elimu_scheme_upd ON elimu_grading_schemes;
CREATE POLICY elimu_scheme_upd ON elimu_grading_schemes FOR UPDATE
  USING (tenant_id = get_current_tenant_id() AND elimu_can('config.manage')) WITH CHECK (tenant_id = get_current_tenant_id() AND elimu_can('config.manage'));
DROP POLICY IF EXISTS elimu_rule_sel ON elimu_grading_rules;
CREATE POLICY elimu_rule_sel ON elimu_grading_rules FOR SELECT USING (tenant_id = get_current_tenant_id() AND elimu_any_role());
DROP POLICY IF EXISTS elimu_rule_ins ON elimu_grading_rules;
CREATE POLICY elimu_rule_ins ON elimu_grading_rules FOR INSERT WITH CHECK (tenant_id = get_current_tenant_id() AND elimu_can('config.manage'));
DROP POLICY IF EXISTS elimu_rule_upd ON elimu_grading_rules;
CREATE POLICY elimu_rule_upd ON elimu_grading_rules FOR UPDATE
  USING (tenant_id = get_current_tenant_id() AND elimu_can('config.manage')) WITH CHECK (tenant_id = get_current_tenant_id() AND elimu_can('config.manage'));
DROP POLICY IF EXISTS elimu_rule_del ON elimu_grading_rules;
CREATE POLICY elimu_rule_del ON elimu_grading_rules FOR DELETE USING (tenant_id = get_current_tenant_id() AND elimu_can('config.manage'));

GRANT SELECT, INSERT, UPDATE ON elimu_grading_schemes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON elimu_grading_rules TO authenticated;
GRANT EXECUTE ON FUNCTION elimu_grade_lookup(uuid, numeric), elimu_validate_scheme(uuid), elimu_resolve_scheme(uuid, uuid),
  elimu_new_scheme_version(uuid, text), elimu_set_default_scheme(uuid) TO authenticated;
