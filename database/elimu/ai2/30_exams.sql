-- ============================================================
-- ELIMU Exams — 30 ASSESSMENTS & MARKS (schema + guards)
-- Run after academic/schema/10_core.sql and grading/schema/20_grading.sql. Re-runnable.
--
-- Tables created: elimu_assessment_types, elimu_assessments, elimu_marks, elimu_mark_history
--
-- DESIGN NOTES
--  * No separate "weights" table: the weight (% of the subject's term result) is an attribute of the assessment instance,
--    and every computed result stores a BREAKDOWN snapshot (assessment, max, obtained, percent, weight, contribution), so a
--    later change of weights can never rewrite a past result.
--  * A blank mark is NOT zero. mark_status says what the blank means:
--      PRESENT (marks required) | ABSENT | EXEMPTED | NOT_SUBMITTED | PENDING (not entered yet; also "no row at all")
--    CHECK: obtained_marks IS NOT NULL exactly when mark_status = 'PRESENT'.
--  * Marks are written ONLY by the SECURITY DEFINER functions in 31_marks_functions.sql (no write RLS policy exists). The
--    triggers here are the last line of defence: marks > max, roster membership, locked assessments, frozen results,
--    editing submitted marks, versioning, and the append-only history.
-- ============================================================

CREATE TABLE IF NOT EXISTS elimu_assessment_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  code        text NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 20),
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  is_examination boolean NOT NULL DEFAULT false,
  default_max_marks numeric(8,2) CHECK (default_max_marks IS NULL OR default_max_marks > 0),
  default_weight    numeric(6,3) CHECK (default_weight IS NULL OR default_weight BETWEEN 0 AND 100),
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_elimu_atype_code ON elimu_assessment_types (tenant_id, lower(btrim(code)));

CREATE TABLE IF NOT EXISTS elimu_assessments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  academic_year_id   uuid NOT NULL,
  term_id            uuid NOT NULL,
  class_id           uuid NOT NULL,
  stream_id          uuid,                                   -- NULL = every stream of the class
  subject_id         uuid NOT NULL REFERENCES elimu_subjects(id),
  assessment_type_id uuid NOT NULL REFERENCES elimu_assessment_types(id),
  name               text NOT NULL CHECK (length(btrim(name)) > 0),
  assessment_date    date,
  max_marks          numeric(8,2) NOT NULL CHECK (max_marks > 0),
  weight             numeric(6,3) NOT NULL CHECK (weight >= 0 AND weight <= 100),   -- 0 = recorded but not counted
  description        text,
  status             text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','OPEN','LOCKED','CANCELLED')),
  locked_at          timestamptz, locked_by uuid,
  cancelled_reason   text,
  version            integer NOT NULL DEFAULT 1,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
-- no duplicate assessment names in the same subject / class / stream / term (cancelled ones do not count)
CREATE UNIQUE INDEX IF NOT EXISTS ux_elimu_assessment_name ON elimu_assessments
  (tenant_id, academic_year_id, term_id, class_id, coalesce(stream_id, '00000000-0000-0000-0000-000000000000'::uuid), subject_id, lower(btrim(name)))
  WHERE status <> 'CANCELLED';
CREATE INDEX IF NOT EXISTS idx_elimu_assess_scope   ON elimu_assessments (tenant_id, academic_year_id, term_id, class_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_elimu_assess_status  ON elimu_assessments (tenant_id, status, assessment_date DESC);

CREATE TABLE IF NOT EXISTS elimu_marks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  assessment_id  uuid NOT NULL REFERENCES elimu_assessments(id),
  enrollment_id  uuid NOT NULL,          -- foundation enrollment (the student's placement for that year/class/stream)
  student_id     uuid NOT NULL,
  mark_status    text NOT NULL DEFAULT 'PENDING' CHECK (mark_status IN ('PRESENT','ABSENT','EXEMPTED','NOT_SUBMITTED','PENDING')),
  obtained_marks numeric(8,2) CHECK (obtained_marks IS NULL OR obtained_marks >= 0),
  remarks        text,
  entry_status   text NOT NULL DEFAULT 'DRAFT' CHECK (entry_status IN ('DRAFT','SUBMITTED')),
  version        integer NOT NULL DEFAULT 1,
  entered_by     uuid, entered_at timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid, updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_by   uuid, submitted_at timestamptz,
  voided_at      timestamptz, voided_by uuid, void_reason text,
  CONSTRAINT elimu_marks_value_chk CHECK ((mark_status = 'PRESENT') = (obtained_marks IS NOT NULL)),
  CONSTRAINT elimu_marks_void_chk  CHECK ((voided_at IS NULL) = (void_reason IS NULL))
);
-- the duplicate-mark protection: one live mark per student per assessment (a voided mark may be replaced)
CREATE UNIQUE INDEX IF NOT EXISTS ux_elimu_marks_student ON elimu_marks (assessment_id, student_id)    WHERE voided_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_elimu_marks_enroll  ON elimu_marks (assessment_id, enrollment_id) WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_elimu_marks_assess  ON elimu_marks (assessment_id) WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_elimu_marks_enroll  ON elimu_marks (tenant_id, enrollment_id) WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_elimu_marks_student ON elimu_marks (tenant_id, student_id)    WHERE voided_at IS NULL;

CREATE TABLE IF NOT EXISTS elimu_mark_history (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL,
  mark_id       uuid NOT NULL,
  assessment_id uuid NOT NULL,
  enrollment_id uuid NOT NULL,
  student_id    uuid NOT NULL,
  action        text NOT NULL CHECK (action IN ('CREATED','EDITED','SUBMITTED','UNLOCKED','VOIDED','CORRECTED')),
  old_status    text, new_status text,
  old_marks     numeric(8,2), new_marks numeric(8,2),
  old_remarks   text, new_remarks text,
  old_entry_status text, new_entry_status text,
  version       integer NOT NULL,
  reason        text,
  actor_staff_id uuid,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_elimu_mhist_mark ON elimu_mark_history (mark_id, at);
CREATE INDEX IF NOT EXISTS idx_elimu_mhist_assess ON elimu_mark_history (tenant_id, assessment_id, at DESC);

-- ================================================================ scope helpers (who may see / enter what)
-- Does the signed-in teacher hold an ACTIVE allocation covering this scope?
--   p_strict: an assessment for the WHOLE class (stream NULL) needs a whole-class allocation; a stream-only teacher is not enough.
CREATE OR REPLACE FUNCTION elimu_teacher_covers(p_year uuid, p_term uuid, p_class uuid, p_stream uuid, p_subject uuid, p_strict boolean DEFAULT true)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT elimu_staff_ok() AND EXISTS (
    SELECT 1 FROM elimu_subject_allocations a
     WHERE a.tenant_id = get_current_tenant_id() AND a.status = 'ACTIVE' AND a.teacher_staff_id = elimu_staff_id()
       AND a.academic_year_id = p_year AND (a.term_id IS NULL OR a.term_id = p_term)
       AND a.class_id = p_class AND a.subject_id = p_subject
       AND (a.stream_id IS NULL OR a.stream_id = p_stream OR (NOT p_strict AND p_stream IS NULL)))
$$;

CREATE OR REPLACE FUNCTION elimu_is_class_teacher(p_year uuid, p_class uuid, p_stream uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT elimu_staff_ok() AND EXISTS (
    SELECT 1 FROM elimu_class_teachers c
     WHERE c.tenant_id = get_current_tenant_id() AND c.status = 'ACTIVE' AND c.teacher_staff_id = elimu_staff_id()
       AND c.academic_year_id = p_year AND c.class_id = p_class AND (c.stream_id IS NULL OR c.stream_id = p_stream OR p_stream IS NULL))
$$;

CREATE OR REPLACE FUNCTION elimu_can_see_assessment(p_assessment uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a elimu_assessments;
BEGIN
  IF elimu_can('view.all') THEN RETURN true; END IF;
  SELECT * INTO a FROM elimu_assessments WHERE id = p_assessment AND tenant_id = get_current_tenant_id();
  IF a.id IS NULL THEN RETURN false; END IF;
  RETURN elimu_teacher_covers(a.academic_year_id, a.term_id, a.class_id, a.stream_id, a.subject_id, false)
      OR elimu_is_class_teacher(a.academic_year_id, a.class_id, a.stream_id);
END $$;

-- May the caller write the mark of a student whose enrollment is in p_enroll_stream? (manage_all, or an allocation covering that stream)
CREATE OR REPLACE FUNCTION elimu_can_mark(p_assessment uuid, p_enroll_stream uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a elimu_assessments;
BEGIN
  IF NOT elimu_can('marks.enter') THEN RETURN false; END IF;
  IF elimu_can('marks.manage_all') THEN RETURN true; END IF;
  SELECT * INTO a FROM elimu_assessments WHERE id = p_assessment AND tenant_id = get_current_tenant_id();
  IF a.id IS NULL THEN RETURN false; END IF;
  RETURN elimu_teacher_covers(a.academic_year_id, a.term_id, a.class_id, p_enroll_stream, a.subject_id, true);
END $$;

-- Has a term result for this enrollment+term been approved/published (frozen)? Then marks may only change through a correction.
CREATE OR REPLACE FUNCTION elimu_result_locked(p_enrollment uuid, p_term uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF to_regclass('public.elimu_term_results') IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM elimu_term_results WHERE enrollment_id = p_enrollment AND term_id = p_term AND is_current AND locked_at IS NOT NULL);
END $$;

-- ================================================================ guards
CREATE OR REPLACE FUNCTION elimu_guard_assessment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid; term_year uuid; stream_class uuid; s elimu_subjects; ty elimu_assessment_types; v_corr boolean := coalesce(current_setting('elimu.correction', true), '') = 'on';
        v_marks int; v_max numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    t := NEW.tenant_id;
    IF NOT elimu_ref_exists('year', NEW.academic_year_id) THEN RAISE EXCEPTION 'Unknown academic year.' USING ERRCODE = '23503'; END IF;
    IF NOT elimu_ref_exists('class', NEW.class_id) THEN RAISE EXCEPTION 'Unknown class.' USING ERRCODE = '23503'; END IF;
    SELECT academic_year_id INTO term_year FROM elimu_ref_terms WHERE id = NEW.term_id AND tenant_id = t;
    IF term_year IS NULL THEN RAISE EXCEPTION 'Unknown term.' USING ERRCODE = '23503'; END IF;
    IF term_year <> NEW.academic_year_id THEN RAISE EXCEPTION 'That term belongs to a different academic year.' USING ERRCODE = '23514'; END IF;
    IF NEW.stream_id IS NOT NULL THEN
      SELECT class_id INTO stream_class FROM elimu_ref_streams WHERE id = NEW.stream_id AND tenant_id = t;
      IF stream_class IS DISTINCT FROM NEW.class_id THEN RAISE EXCEPTION 'That stream does not belong to this class.' USING ERRCODE = '23514'; END IF;
    END IF;
    SELECT * INTO s FROM elimu_subjects WHERE id = NEW.subject_id;
    IF s.tenant_id IS DISTINCT FROM t THEN RAISE EXCEPTION 'Unknown subject.' USING ERRCODE = '23503'; END IF;
    IF NOT s.is_active THEN RAISE EXCEPTION 'This subject is inactive.' USING ERRCODE = '23514'; END IF;
    SELECT * INTO ty FROM elimu_assessment_types WHERE id = NEW.assessment_type_id;
    IF ty.tenant_id IS DISTINCT FROM t THEN RAISE EXCEPTION 'Unknown assessment type.' USING ERRCODE = '23503'; END IF;
    IF NOT ty.is_active THEN RAISE EXCEPTION 'This assessment type is inactive.' USING ERRCODE = '23514'; END IF;
    IF is_pos_session() THEN NEW.created_by := elimu_staff_id(); NEW.updated_by := elimu_staff_id(); END IF;
    NEW.name := btrim(NEW.name);
    RETURN NEW;
  END IF;

  -- UPDATE ------------------------------------------------------------
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN RAISE EXCEPTION 'tenant cannot change' USING ERRCODE = '42501'; END IF;
  SELECT count(*), max(obtained_marks) INTO v_marks, v_max FROM elimu_marks WHERE assessment_id = OLD.id AND voided_at IS NULL AND mark_status <> 'PENDING';
  IF (NEW.academic_year_id, NEW.term_id, NEW.class_id, NEW.stream_id, NEW.subject_id)
     IS DISTINCT FROM (OLD.academic_year_id, OLD.term_id, OLD.class_id, OLD.stream_id, OLD.subject_id) AND v_marks > 0 THEN
    RAISE EXCEPTION 'The class, stream, subject and term cannot change once marks have been entered. Cancel this assessment and create a new one.' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'CANCELLED' THEN RAISE EXCEPTION 'A cancelled assessment cannot be changed.' USING ERRCODE = '42501'; END IF;
  IF OLD.status = 'LOCKED' AND NOT v_corr
     AND (NEW.max_marks, NEW.weight, NEW.assessment_type_id, NEW.name) IS DISTINCT FROM (OLD.max_marks, OLD.weight, OLD.assessment_type_id, OLD.name) THEN
    RAISE EXCEPTION 'This assessment is locked. Reopen it (or use a correction) before changing its marks, weight or name.' USING ERRCODE = '42501';
  END IF;
  IF (NEW.max_marks IS DISTINCT FROM OLD.max_marks OR NEW.weight IS DISTINCT FROM OLD.weight) AND NOT v_corr
     AND to_regclass('public.elimu_term_results') IS NOT NULL
     AND EXISTS (SELECT 1 FROM elimu_term_results r WHERE r.tenant_id = OLD.tenant_id AND r.term_id = OLD.term_id AND r.class_id = OLD.class_id AND r.is_current AND r.locked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Results for this class and term are already approved. Changing max marks or weight needs a correction.' USING ERRCODE = '42501';
  END IF;
  IF NEW.max_marks < OLD.max_marks AND v_max IS NOT NULL AND v_max > NEW.max_marks THEN
    RAISE EXCEPTION 'A mark of % is already entered, which is more than the new maximum of %.', v_max, NEW.max_marks USING ERRCODE = '23514';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'DRAFT' AND NEW.status IN ('OPEN','CANCELLED')) OR
       (OLD.status = 'OPEN'  AND NEW.status IN ('LOCKED','CANCELLED','DRAFT')) OR
       (OLD.status = 'LOCKED' AND NEW.status = 'OPEN')) THEN
    RAISE EXCEPTION 'An assessment cannot go from % to %.', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED' AND v_marks > 0 THEN
    RAISE EXCEPTION 'This assessment already has marks. Void them first or keep it.' USING ERRCODE = '23514';
  END IF;
  NEW.name := btrim(NEW.name);
  NEW.version := OLD.version + 1; NEW.updated_at := now();
  IF is_pos_session() THEN NEW.updated_by := elimu_staff_id(); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_assess_guard ON elimu_assessments;
CREATE TRIGGER trg_elimu_assess_guard BEFORE INSERT OR UPDATE ON elimu_assessments FOR EACH ROW EXECUTE FUNCTION elimu_guard_assessment();
DROP TRIGGER IF EXISTS trg_elimu_assess_nodelete ON elimu_assessments;
CREATE TRIGGER trg_elimu_assess_nodelete BEFORE DELETE ON elimu_assessments FOR EACH ROW EXECUTE FUNCTION elimu_block_delete();

CREATE OR REPLACE FUNCTION elimu_guard_type() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN RAISE EXCEPTION 'tenant cannot change' USING ERRCODE = '42501'; END IF;
  NEW.code := upper(btrim(NEW.code)); NEW.name := btrim(NEW.name); NEW.updated_at := now();
  IF TG_OP = 'INSERT' AND is_pos_session() THEN NEW.created_by := elimu_staff_id(); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_type_guard ON elimu_assessment_types;
CREATE TRIGGER trg_elimu_type_guard BEFORE INSERT OR UPDATE ON elimu_assessment_types FOR EACH ROW EXECUTE FUNCTION elimu_guard_type();
DROP TRIGGER IF EXISTS trg_elimu_type_nodelete ON elimu_assessment_types;
CREATE TRIGGER trg_elimu_type_nodelete BEFORE DELETE ON elimu_assessment_types FOR EACH ROW EXECUTE FUNCTION elimu_block_delete();

-- Marks: the database-level rules. GUC flags (set only inside the SECURITY DEFINER functions, transaction-local):
--   elimu.edit_submitted = on  -> a submitted mark may be edited (set by unlock / correction)
--   elimu.correction     = on  -> locked assessment / frozen result may be edited (set by the published-correction function)
--   elimu.reason         = text, copied to the history row
CREATE OR REPLACE FUNCTION elimu_guard_mark() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a elimu_assessments; e record; v_corr boolean := coalesce(current_setting('elimu.correction', true), '') = 'on';
        v_edit boolean := coalesce(current_setting('elimu.edit_submitted', true), '') = 'on';
BEGIN
  SELECT * INTO a FROM elimu_assessments WHERE id = NEW.assessment_id;
  IF a.id IS NULL OR a.tenant_id IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'Unknown assessment.' USING ERRCODE = '23503'; END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (NEW.tenant_id, NEW.assessment_id, NEW.enrollment_id, NEW.student_id) IS DISTINCT FROM (OLD.tenant_id, OLD.assessment_id, OLD.enrollment_id, OLD.student_id) THEN
      RAISE EXCEPTION 'A mark cannot be moved to another student or assessment. Void it and enter a new one.' USING ERRCODE = '42501';
    END IF;
    IF OLD.voided_at IS NOT NULL THEN RAISE EXCEPTION 'A voided mark cannot be changed.' USING ERRCODE = '42501'; END IF;
  END IF;

  IF a.status = 'CANCELLED' THEN RAISE EXCEPTION 'This assessment is cancelled.' USING ERRCODE = '23514'; END IF;
  IF NEW.voided_at IS NULL AND NOT v_corr THEN
    IF a.status <> 'OPEN' THEN RAISE EXCEPTION 'Marks can only be entered while the assessment is open (it is %).', lower(a.status) USING ERRCODE = '23514'; END IF;
  END IF;
  IF NOT v_corr AND elimu_result_locked(NEW.enrollment_id, a.term_id) THEN
    RAISE EXCEPTION 'The results for this student and term are approved or published. Use a correction.' USING ERRCODE = '42501';
  END IF;

  IF NEW.mark_status = 'PRESENT' AND NEW.obtained_marks > a.max_marks THEN
    RAISE EXCEPTION 'Marks cannot be more than the maximum of % for "%".', a.max_marks, a.name USING ERRCODE = '23514';
  END IF;
  IF NEW.obtained_marks < 0 THEN RAISE EXCEPTION 'Marks cannot be negative.' USING ERRCODE = '23514'; END IF;

  IF TG_OP = 'INSERT' THEN
    -- roster: the enrollment must be this student's placement in the assessment's year / class (/ stream)
    SELECT student_id, academic_year_id, class_id, stream_id INTO e FROM elimu_ref_enrollments WHERE id = NEW.enrollment_id AND tenant_id = NEW.tenant_id;
    IF e.student_id IS NULL THEN RAISE EXCEPTION 'Unknown enrollment.' USING ERRCODE = '23503'; END IF;
    IF e.student_id <> NEW.student_id THEN RAISE EXCEPTION 'That enrollment belongs to a different student.' USING ERRCODE = '23514'; END IF;
    IF e.academic_year_id <> a.academic_year_id OR e.class_id <> a.class_id OR (a.stream_id IS NOT NULL AND e.stream_id IS DISTINCT FROM a.stream_id) THEN
      RAISE EXCEPTION 'This student is not in the class / stream of this assessment.' USING ERRCODE = '23514';
    END IF;
    IF is_pos_session() THEN NEW.entered_by := elimu_staff_id(); END IF;
    NEW.version := 1;
  ELSE
    IF OLD.entry_status = 'SUBMITTED' AND NEW.entry_status = 'SUBMITTED' AND NOT v_edit AND NOT v_corr
       AND (NEW.mark_status, NEW.obtained_marks, NEW.remarks) IS DISTINCT FROM (OLD.mark_status, OLD.obtained_marks, OLD.remarks) AND NEW.voided_at IS NULL THEN
      RAISE EXCEPTION 'Submitted marks are final. Ask for the marks to be unlocked to change them.' USING ERRCODE = '42501';
    END IF;
    IF OLD.entry_status = 'SUBMITTED' AND NEW.entry_status = 'DRAFT' AND NOT v_edit AND NOT v_corr THEN
      RAISE EXCEPTION 'Only an authorised unlock can reopen submitted marks.' USING ERRCODE = '42501';
    END IF;
    NEW.version := OLD.version + 1;
    IF is_pos_session() THEN NEW.updated_by := elimu_staff_id(); END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_mark_guard ON elimu_marks;
CREATE TRIGGER trg_elimu_mark_guard BEFORE INSERT OR UPDATE ON elimu_marks FOR EACH ROW EXECUTE FUNCTION elimu_guard_mark();
DROP TRIGGER IF EXISTS trg_elimu_mark_nodelete ON elimu_marks;
CREATE TRIGGER trg_elimu_mark_nodelete BEFORE DELETE ON elimu_marks FOR EACH ROW EXECUTE FUNCTION elimu_block_delete();

-- append-only history, written by the database itself so no code path can skip it
CREATE OR REPLACE FUNCTION elimu_mark_history_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_action text; v_reason text := nullif(current_setting('elimu.reason', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN v_action := 'CREATED';
  ELSIF NEW.voided_at IS NOT NULL AND OLD.voided_at IS NULL THEN v_action := 'VOIDED';
  ELSIF coalesce(current_setting('elimu.correction', true), '') = 'on' THEN v_action := 'CORRECTED';
  ELSIF OLD.entry_status = 'DRAFT' AND NEW.entry_status = 'SUBMITTED' THEN v_action := 'SUBMITTED';
  ELSIF OLD.entry_status = 'SUBMITTED' AND NEW.entry_status = 'DRAFT' THEN v_action := 'UNLOCKED';
  ELSE v_action := 'EDITED'; END IF;
  INSERT INTO elimu_mark_history (tenant_id, mark_id, assessment_id, enrollment_id, student_id, action,
      old_status, new_status, old_marks, new_marks, old_remarks, new_remarks, old_entry_status, new_entry_status, version, reason, actor_staff_id)
  VALUES (NEW.tenant_id, NEW.id, NEW.assessment_id, NEW.enrollment_id, NEW.student_id, v_action,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.mark_status END, NEW.mark_status,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.obtained_marks END, NEW.obtained_marks,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.remarks END, NEW.remarks,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.entry_status END, NEW.entry_status,
      NEW.version, coalesce(v_reason, NEW.void_reason), elimu_staff_id());
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_mark_history ON elimu_marks;
CREATE TRIGGER trg_elimu_mark_history AFTER INSERT OR UPDATE ON elimu_marks FOR EACH ROW EXECUTE FUNCTION elimu_mark_history_write();

CREATE OR REPLACE FUNCTION elimu_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'History records cannot be changed or deleted.' USING ERRCODE = '42501'; END $$;
DROP TRIGGER IF EXISTS trg_elimu_mhist_immutable ON elimu_mark_history;
CREATE TRIGGER trg_elimu_mhist_immutable BEFORE UPDATE OR DELETE ON elimu_mark_history FOR EACH ROW EXECUTE FUNCTION elimu_history_immutable();

-- ================================================================ RLS
ALTER TABLE elimu_assessment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE elimu_assessments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE elimu_marks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE elimu_mark_history     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS elimu_atype_sel ON elimu_assessment_types;
CREATE POLICY elimu_atype_sel ON elimu_assessment_types FOR SELECT USING (tenant_id = get_current_tenant_id() AND elimu_any_role());
DROP POLICY IF EXISTS elimu_atype_ins ON elimu_assessment_types;
CREATE POLICY elimu_atype_ins ON elimu_assessment_types FOR INSERT WITH CHECK (tenant_id = get_current_tenant_id() AND elimu_can('config.manage'));
DROP POLICY IF EXISTS elimu_atype_upd ON elimu_assessment_types;
CREATE POLICY elimu_atype_upd ON elimu_assessment_types FOR UPDATE
  USING (tenant_id = get_current_tenant_id() AND elimu_can('config.manage')) WITH CHECK (tenant_id = get_current_tenant_id() AND elimu_can('config.manage'));

-- assessments / marks / history: READ only, row-scoped (all for admins/exams officers; own subjects for teachers; class teachers see their class).
-- WRITES: none from the API directly. Functions in 31_marks_functions.sql do them with full checks.
DROP POLICY IF EXISTS elimu_assess_sel ON elimu_assessments;
CREATE POLICY elimu_assess_sel ON elimu_assessments FOR SELECT USING (tenant_id = get_current_tenant_id() AND elimu_can_see_assessment(id));
DROP POLICY IF EXISTS elimu_marks_sel ON elimu_marks;
CREATE POLICY elimu_marks_sel ON elimu_marks FOR SELECT USING (tenant_id = get_current_tenant_id() AND elimu_can_see_assessment(assessment_id));
DROP POLICY IF EXISTS elimu_mhist_sel ON elimu_mark_history;
CREATE POLICY elimu_mhist_sel ON elimu_mark_history FOR SELECT USING (tenant_id = get_current_tenant_id() AND elimu_can_see_assessment(assessment_id));

GRANT SELECT ON elimu_assessments, elimu_marks, elimu_mark_history TO authenticated;
GRANT SELECT, INSERT, UPDATE ON elimu_assessment_types TO authenticated;
GRANT EXECUTE ON FUNCTION elimu_teacher_covers(uuid,uuid,uuid,uuid,uuid,boolean), elimu_is_class_teacher(uuid,uuid,uuid),
  elimu_can_see_assessment(uuid), elimu_can_mark(uuid,uuid), elimu_result_locked(uuid,uuid) TO authenticated;
