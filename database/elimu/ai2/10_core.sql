-- ============================================================
-- ELIMU Academic — 10 CORE: helpers, academic roles, settings, subjects, allocations
--
-- Run AFTER 00_prereq_check.sql shows no failures. Re-runnable (IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS).
--
-- WHAT THIS FILE CREATES (tables):
--   elimu_academic_settings, elimu_subjects, elimu_subject_allocations,
--   elimu_class_teachers, elimu_student_subject_selections
-- WHAT IT EXPECTS FROM THE POS (existing, untouched): get_current_tenant_id(), is_pos_session(), is_pos_owner(),
--   pos_staff, pos_tenants, pos_audit_log.
-- WHAT IT EXPECTS FROM THE ELIMU FOUNDATION: the elimu_ref_* adapter views (05_*). They are only read at RUN TIME
--   (inside plpgsql), so this file installs even before the adapter exists; writes that need them fail closed.
--
-- TENANCY: tenant_id = pos_tenants.id = the school = get_current_tenant_id() (JWT claim pos_tenant_id).
-- IDENTITY: every *_by column holds pos_staff.id (same convention as pos_audit_log.actor_id).
-- SECURITY MODEL: reads by tenant (+ row scope for marks/results); config tables writable via RLS only by
--   elimu_can('config.manage'); allocations / marks / results / report cards are written ONLY by the
--   SECURITY DEFINER functions in the later files (no direct write policy exists for them).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- (merged install) roles, elimu_staff_id/staff_ok/is_owner/has_role, elimu_can, elimu_any_role, elimu_audit, elimu_touch and
-- elimu_block_delete now live in ../elimu_000_core.sql (one definition for all four modules).

-- Does a foundation row exist for THIS tenant? One place so adapter problems fail with a clear message.
CREATE OR REPLACE FUNCTION elimu_ref_exists(p_kind text, p_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v boolean; t uuid := get_current_tenant_id();
BEGIN
  IF p_id IS NULL THEN RETURN false; END IF;
  IF p_kind = 'year'       THEN SELECT EXISTS (SELECT 1 FROM elimu_ref_academic_years WHERE id = p_id AND tenant_id = t) INTO v;
  ELSIF p_kind = 'term'    THEN SELECT EXISTS (SELECT 1 FROM elimu_ref_terms          WHERE id = p_id AND tenant_id = t) INTO v;
  ELSIF p_kind = 'class'   THEN SELECT EXISTS (SELECT 1 FROM elimu_ref_classes        WHERE id = p_id AND tenant_id = t) INTO v;
  ELSIF p_kind = 'stream'  THEN SELECT EXISTS (SELECT 1 FROM elimu_ref_streams        WHERE id = p_id AND tenant_id = t) INTO v;
  ELSIF p_kind = 'student' THEN SELECT EXISTS (SELECT 1 FROM elimu_ref_students       WHERE id = p_id AND tenant_id = t) INTO v;
  ELSIF p_kind = 'enrollment' THEN SELECT EXISTS (SELECT 1 FROM elimu_ref_enrollments WHERE id = p_id AND tenant_id = t) INTO v;
  ELSE RAISE EXCEPTION 'unknown reference kind %', p_kind; END IF;
  RETURN v;
EXCEPTION WHEN undefined_table THEN
  RAISE EXCEPTION 'The Elimu foundation adapter views (elimu_ref_*) are not installed. See elimu/INTEGRATION.md.' USING ERRCODE = '55000';
END $$;

-- ---------------------------------------------------------------- settings (one row per school)
CREATE TABLE IF NOT EXISTS elimu_academic_settings (
  tenant_id            uuid PRIMARY KEY,
  -- how a non-PRESENT mark counts in a subject result (PENDING always makes the subject INCOMPLETE; EXEMPTED is always left out)
  absent_policy        text NOT NULL DEFAULT 'ZERO'  CHECK (absent_policy IN ('ZERO','EXCLUDE')),
  not_submitted_policy text NOT NULL DEFAULT 'ZERO'  CHECK (not_submitted_policy IN ('ZERO','EXCLUDE')),
  weight_tolerance     numeric(6,3) NOT NULL DEFAULT 0.010 CHECK (weight_tolerance >= 0 AND weight_tolerance <= 5),
  headteacher_name     text,
  headteacher_title    text NOT NULL DEFAULT 'Head Teacher',
  school_motto         text,
  report_footer        text,
  show_positions       boolean NOT NULL DEFAULT true,
  show_grade_points    boolean NOT NULL DEFAULT true,
  updated_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- subjects
CREATE TABLE IF NOT EXISTS elimu_subjects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  code          text NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 20),
  name          text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  short_name    text,
  category      text,                                   -- free text, e.g. Languages, Sciences, Humanities (not hard-coded)
  is_compulsory boolean NOT NULL DEFAULT true,          -- default; an allocation may override per class
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  applicable_levels text[],                             -- NULL = every level. Values match elimu_ref_classes.level_code
  description   text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_elimu_subjects_code ON elimu_subjects (tenant_id, lower(btrim(code)));
CREATE INDEX IF NOT EXISTS idx_elimu_subjects_list ON elimu_subjects (tenant_id, is_active, sort_order, name);

-- ---------------------------------------------------------------- allocations (subject -> class/stream/year[/term], with a teacher)
-- HISTORY RULE: rows are never edited to point at something else and never deleted. Changing the teacher ENDS the row
-- (status ENDED, ended_at, reason) and a new ACTIVE row starts. The (subject,class,stream,year,term,teacher) key is frozen.
CREATE TABLE IF NOT EXISTS elimu_subject_allocations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  term_id          uuid,                               -- NULL = whole academic year
  class_id         uuid NOT NULL,
  stream_id        uuid,                               -- NULL = every stream of the class
  subject_id       uuid NOT NULL REFERENCES elimu_subjects(id),
  teacher_staff_id uuid REFERENCES pos_staff(id),      -- NULL = subject offered, nobody assigned yet
  is_compulsory    boolean,                            -- NULL = use the subject's default
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ENDED')),
  started_at       timestamptz NOT NULL DEFAULT now(),
  ended_at         timestamptz,
  ended_by         uuid,
  ended_reason     text,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT elimu_alloc_end_chk CHECK ((status = 'ENDED') = (ended_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_elimu_alloc_active ON elimu_subject_allocations
  (tenant_id, academic_year_id, coalesce(term_id, '00000000-0000-0000-0000-000000000000'::uuid), class_id,
   coalesce(stream_id, '00000000-0000-0000-0000-000000000000'::uuid), subject_id,
   coalesce(teacher_staff_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_elimu_alloc_scope   ON elimu_subject_allocations (tenant_id, academic_year_id, class_id, subject_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_elimu_alloc_teacher ON elimu_subject_allocations (tenant_id, teacher_staff_id, status);

-- ---------------------------------------------------------------- class teachers (teacher -> class/stream, for remarks and oversight)
CREATE TABLE IF NOT EXISTS elimu_class_teachers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  class_id         uuid NOT NULL,
  stream_id        uuid,
  teacher_staff_id uuid NOT NULL REFERENCES pos_staff(id),
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ENDED')),
  started_at       timestamptz NOT NULL DEFAULT now(),
  ended_at         timestamptz,
  ended_by         uuid,
  ended_reason     text,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT elimu_ct_end_chk CHECK ((status = 'ENDED') = (ended_at IS NOT NULL))
);
-- one active class teacher per class(+stream) per year
CREATE UNIQUE INDEX IF NOT EXISTS ux_elimu_ct_active ON elimu_class_teachers
  (tenant_id, academic_year_id, class_id, coalesce(stream_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_elimu_ct_teacher ON elimu_class_teachers (tenant_id, teacher_staff_id, status);

-- ---------------------------------------------------------------- elective choices (which students take an elective)
-- Compulsory subjects need no rows: every enrolled student takes them. Elective assessments are only for students listed here.
CREATE TABLE IF NOT EXISTS elimu_student_subject_selections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  enrollment_id    uuid NOT NULL,
  student_id       uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  subject_id       uuid NOT NULL REFERENCES elimu_subjects(id),
  term_id          uuid,                               -- NULL = whole year
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ENDED')),
  started_at       timestamptz NOT NULL DEFAULT now(),
  ended_at         timestamptz,
  created_by       uuid,
  CONSTRAINT elimu_sel_end_chk CHECK ((status = 'ENDED') = (ended_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_elimu_sel_active ON elimu_student_subject_selections
  (enrollment_id, subject_id, coalesce(term_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_elimu_sel_subject ON elimu_student_subject_selections (tenant_id, academic_year_id, subject_id) WHERE status = 'ACTIVE';

-- ================================================================ GUARDS
CREATE OR REPLACE FUNCTION elimu_guard_subject() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN RAISE EXCEPTION 'tenant cannot change' USING ERRCODE = '42501'; END IF;
  NEW.code := btrim(NEW.code); NEW.name := btrim(NEW.name);
  IF NEW.applicable_levels IS NOT NULL AND cardinality(NEW.applicable_levels) = 0 THEN NEW.applicable_levels := NULL; END IF;
  IF is_pos_session() THEN
    IF TG_OP = 'INSERT' THEN NEW.created_by := elimu_staff_id(); END IF;
    NEW.updated_by := elimu_staff_id();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_subject_guard ON elimu_subjects;
CREATE TRIGGER trg_elimu_subject_guard BEFORE INSERT OR UPDATE ON elimu_subjects FOR EACH ROW EXECUTE FUNCTION elimu_guard_subject();
DROP TRIGGER IF EXISTS trg_elimu_subject_nodelete ON elimu_subjects;
CREATE TRIGGER trg_elimu_subject_nodelete BEFORE DELETE ON elimu_subjects FOR EACH ROW EXECUTE FUNCTION elimu_block_delete();

CREATE OR REPLACE FUNCTION elimu_guard_allocation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; c record; stream_class uuid; term_year uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- history is frozen: only the ENDING fields (and the compulsory override) may change
    IF (NEW.tenant_id, NEW.academic_year_id, NEW.term_id, NEW.class_id, NEW.stream_id, NEW.subject_id, NEW.teacher_staff_id, NEW.started_at)
       IS DISTINCT FROM (OLD.tenant_id, OLD.academic_year_id, OLD.term_id, OLD.class_id, OLD.stream_id, OLD.subject_id, OLD.teacher_staff_id, OLD.started_at) THEN
      RAISE EXCEPTION 'An assignment cannot be edited. End it and create a new one so the history is kept.' USING ERRCODE = '42501';
    END IF;
    IF OLD.status = 'ENDED' THEN RAISE EXCEPTION 'An ended assignment cannot be changed.' USING ERRCODE = '42501'; END IF;
    RETURN NEW;
  END IF;
  -- INSERT
  IF NOT elimu_ref_exists('year', NEW.academic_year_id) THEN RAISE EXCEPTION 'Unknown academic year.' USING ERRCODE = '23503'; END IF;
  IF NOT elimu_ref_exists('class', NEW.class_id) THEN RAISE EXCEPTION 'Unknown class.' USING ERRCODE = '23503'; END IF;
  IF NEW.term_id IS NOT NULL THEN
    SELECT academic_year_id INTO term_year FROM elimu_ref_terms WHERE id = NEW.term_id AND tenant_id = NEW.tenant_id;
    IF term_year IS NULL THEN RAISE EXCEPTION 'Unknown term.' USING ERRCODE = '23503'; END IF;
    IF term_year <> NEW.academic_year_id THEN RAISE EXCEPTION 'That term belongs to a different academic year.' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NEW.stream_id IS NOT NULL THEN
    SELECT class_id INTO stream_class FROM elimu_ref_streams WHERE id = NEW.stream_id AND tenant_id = NEW.tenant_id;
    IF stream_class IS NULL THEN RAISE EXCEPTION 'Unknown stream.' USING ERRCODE = '23503'; END IF;
    IF stream_class <> NEW.class_id THEN RAISE EXCEPTION 'That stream belongs to a different class.' USING ERRCODE = '23514'; END IF;
  END IF;
  SELECT * INTO s FROM elimu_subjects WHERE id = NEW.subject_id;
  IF s.tenant_id IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'Unknown subject.' USING ERRCODE = '23503'; END IF;
  IF NOT s.is_active THEN RAISE EXCEPTION 'This subject is inactive.' USING ERRCODE = '23514'; END IF;
  SELECT level_code INTO c FROM elimu_ref_classes WHERE id = NEW.class_id AND tenant_id = NEW.tenant_id;
  IF s.applicable_levels IS NOT NULL AND c.level_code IS NOT NULL AND NOT (c.level_code = ANY (s.applicable_levels)) THEN
    RAISE EXCEPTION '% is not offered at level %.', s.name, c.level_code USING ERRCODE = '23514';
  END IF;
  IF NEW.teacher_staff_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pos_staff WHERE id = NEW.teacher_staff_id AND pos_tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'That teacher is not a staff member of this school.' USING ERRCODE = '23503';
  END IF;
  IF is_pos_session() THEN NEW.created_by := elimu_staff_id(); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_alloc_guard ON elimu_subject_allocations;
CREATE TRIGGER trg_elimu_alloc_guard BEFORE INSERT OR UPDATE ON elimu_subject_allocations FOR EACH ROW EXECUTE FUNCTION elimu_guard_allocation();
DROP TRIGGER IF EXISTS trg_elimu_alloc_nodelete ON elimu_subject_allocations;
CREATE TRIGGER trg_elimu_alloc_nodelete BEFORE DELETE ON elimu_subject_allocations FOR EACH ROW EXECUTE FUNCTION elimu_block_delete();

CREATE OR REPLACE FUNCTION elimu_guard_class_teacher() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE stream_class uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.tenant_id, NEW.academic_year_id, NEW.class_id, NEW.stream_id, NEW.teacher_staff_id, NEW.started_at)
       IS DISTINCT FROM (OLD.tenant_id, OLD.academic_year_id, OLD.class_id, OLD.stream_id, OLD.teacher_staff_id, OLD.started_at) THEN
      RAISE EXCEPTION 'A class-teacher assignment cannot be edited. End it and create a new one.' USING ERRCODE = '42501';
    END IF;
    IF OLD.status = 'ENDED' THEN RAISE EXCEPTION 'An ended assignment cannot be changed.' USING ERRCODE = '42501'; END IF;
    RETURN NEW;
  END IF;
  IF NOT elimu_ref_exists('year', NEW.academic_year_id) THEN RAISE EXCEPTION 'Unknown academic year.' USING ERRCODE = '23503'; END IF;
  IF NOT elimu_ref_exists('class', NEW.class_id) THEN RAISE EXCEPTION 'Unknown class.' USING ERRCODE = '23503'; END IF;
  IF NEW.stream_id IS NOT NULL THEN
    SELECT class_id INTO stream_class FROM elimu_ref_streams WHERE id = NEW.stream_id AND tenant_id = NEW.tenant_id;
    IF stream_class IS DISTINCT FROM NEW.class_id THEN RAISE EXCEPTION 'That stream does not belong to this class.' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pos_staff WHERE id = NEW.teacher_staff_id AND pos_tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'That teacher is not a staff member of this school.' USING ERRCODE = '23503';
  END IF;
  IF is_pos_session() THEN NEW.created_by := elimu_staff_id(); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_ct_guard ON elimu_class_teachers;
CREATE TRIGGER trg_elimu_ct_guard BEFORE INSERT OR UPDATE ON elimu_class_teachers FOR EACH ROW EXECUTE FUNCTION elimu_guard_class_teacher();
DROP TRIGGER IF EXISTS trg_elimu_ct_nodelete ON elimu_class_teachers;
CREATE TRIGGER trg_elimu_ct_nodelete BEFORE DELETE ON elimu_class_teachers FOR EACH ROW EXECUTE FUNCTION elimu_block_delete();
DROP TRIGGER IF EXISTS trg_elimu_sel_nodelete ON elimu_student_subject_selections;
CREATE TRIGGER trg_elimu_sel_nodelete BEFORE DELETE ON elimu_student_subject_selections FOR EACH ROW EXECUTE FUNCTION elimu_block_delete();

-- ================================================================ RLS
ALTER TABLE elimu_academic_settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE elimu_subjects                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE elimu_subject_allocations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE elimu_class_teachers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE elimu_student_subject_selections ENABLE ROW LEVEL SECURITY;

-- settings: any academic user reads; config.manage writes
DROP POLICY IF EXISTS elimu_settings_sel ON elimu_academic_settings;
CREATE POLICY elimu_settings_sel ON elimu_academic_settings FOR SELECT USING (tenant_id = get_current_tenant_id() AND elimu_any_role());
DROP POLICY IF EXISTS elimu_settings_ins ON elimu_academic_settings;
CREATE POLICY elimu_settings_ins ON elimu_academic_settings FOR INSERT WITH CHECK (tenant_id = get_current_tenant_id() AND elimu_can('config.manage'));
DROP POLICY IF EXISTS elimu_settings_upd ON elimu_academic_settings;
CREATE POLICY elimu_settings_upd ON elimu_academic_settings FOR UPDATE
  USING (tenant_id = get_current_tenant_id() AND elimu_can('config.manage')) WITH CHECK (tenant_id = get_current_tenant_id() AND elimu_can('config.manage'));

-- subjects: any academic user reads; config.manage writes (no delete policy: deactivate instead)
DROP POLICY IF EXISTS elimu_subjects_sel ON elimu_subjects;
CREATE POLICY elimu_subjects_sel ON elimu_subjects FOR SELECT USING (tenant_id = get_current_tenant_id() AND elimu_any_role());
DROP POLICY IF EXISTS elimu_subjects_ins ON elimu_subjects;
CREATE POLICY elimu_subjects_ins ON elimu_subjects FOR INSERT WITH CHECK (tenant_id = get_current_tenant_id() AND elimu_can('config.manage'));
DROP POLICY IF EXISTS elimu_subjects_upd ON elimu_subjects;
CREATE POLICY elimu_subjects_upd ON elimu_subjects FOR UPDATE
  USING (tenant_id = get_current_tenant_id() AND elimu_can('config.manage')) WITH CHECK (tenant_id = get_current_tenant_id() AND elimu_can('config.manage'));

-- allocations / class teachers / selections: academic users read; writes only through the RPCs in 40_*
DROP POLICY IF EXISTS elimu_alloc_sel ON elimu_subject_allocations;
CREATE POLICY elimu_alloc_sel ON elimu_subject_allocations FOR SELECT USING (tenant_id = get_current_tenant_id() AND elimu_any_role());
DROP POLICY IF EXISTS elimu_ct_sel ON elimu_class_teachers;
CREATE POLICY elimu_ct_sel ON elimu_class_teachers FOR SELECT USING (tenant_id = get_current_tenant_id() AND elimu_any_role());
DROP POLICY IF EXISTS elimu_sel_sel ON elimu_student_subject_selections;
CREATE POLICY elimu_sel_sel ON elimu_student_subject_selections FOR SELECT USING (tenant_id = get_current_tenant_id() AND elimu_any_role());

GRANT SELECT ON elimu_academic_settings, elimu_subjects, elimu_subject_allocations,
                elimu_class_teachers, elimu_student_subject_selections TO authenticated;
GRANT INSERT, UPDATE ON elimu_academic_settings, elimu_subjects TO authenticated;
GRANT EXECUTE ON FUNCTION elimu_staff_id(), elimu_staff_ok(), elimu_is_owner(), elimu_has_role(text), elimu_can(text), elimu_any_role() TO authenticated;
