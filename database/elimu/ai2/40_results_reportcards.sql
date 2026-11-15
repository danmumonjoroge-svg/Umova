-- ============================================================
-- ELIMU Report cards — 40 TERM RESULTS, SUBJECT RESULTS, REPORT CARDS (schema + guards)
-- Run after exams/schema/30_exams.sql. Re-runnable.
--
-- Tables created: elimu_term_results, elimu_subject_results, elimu_report_cards, elimu_report_card_history
--
-- HISTORY MODEL
--  * Results hang on ENROLLMENT + TERM (+ the class/stream/year copied at compute time). A student who changes class gets a
--    new enrollment, so the old class's results are never touched and no "current class" is stored on a result.
--  * Results are REVISIONED. Recomputing while a result is unlocked updates it in place. Once its report card is APPROVED
--    the result is LOCKED (locked_at). A correction after that creates revision n+1 (is_current), the old revision stays
--    forever (is_current = false) and the old published card becomes SUPERSEDED once the corrected card is published.
--  * Every subject result stores the literal grade / points / descriptor AND the scheme version it used AND a breakdown of
--    the assessments + weights - so changing a scheme, a weight or a mark later cannot alter a past result.
-- ============================================================

CREATE TABLE IF NOT EXISTS elimu_term_results (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  term_id          uuid NOT NULL,
  enrollment_id    uuid NOT NULL,
  student_id       uuid NOT NULL,
  class_id         uuid NOT NULL,         -- copied from the enrollment AT COMPUTE TIME
  stream_id        uuid,
  revision         integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  is_current       boolean NOT NULL DEFAULT true,
  subjects_expected integer NOT NULL DEFAULT 0,
  subjects_complete integer NOT NULL DEFAULT 0,
  is_complete      boolean NOT NULL DEFAULT false,
  total_percentage numeric(9,3),          -- sum of the subject percentages counted
  mean_percentage  numeric(7,3),
  overall_grade    text, overall_grade_point numeric(6,3), overall_descriptor text, overall_remark text,
  grading_scheme_id uuid REFERENCES elimu_grading_schemes(id),
  class_position   integer, class_size integer, stream_position integer, stream_size integer,
  locked_at        timestamptz, locked_by uuid,
  computed_at      timestamptz NOT NULL DEFAULT now(),
  computed_by      uuid,
  compute_params   jsonb NOT NULL DEFAULT '{}'::jsonb,
  superseded_at    timestamptz, supersede_reason text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, term_id, revision),
  CONSTRAINT elimu_tr_super_chk CHECK (is_current = (superseded_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_elimu_tr_current ON elimu_term_results (enrollment_id, term_id) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_elimu_tr_scope   ON elimu_term_results (tenant_id, academic_year_id, term_id, class_id, stream_id) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_elimu_tr_student ON elimu_term_results (tenant_id, student_id, academic_year_id, term_id);

CREATE TABLE IF NOT EXISTS elimu_subject_results (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  term_result_id   uuid NOT NULL REFERENCES elimu_term_results(id),
  academic_year_id uuid NOT NULL, term_id uuid NOT NULL,
  enrollment_id    uuid NOT NULL, student_id uuid NOT NULL,
  class_id         uuid NOT NULL, stream_id uuid,
  subject_id       uuid NOT NULL REFERENCES elimu_subjects(id),
  completeness     text NOT NULL CHECK (completeness IN ('COMPLETE','INCOMPLETE','NO_ASSESSMENTS','WEIGHTS_INVALID')),
  raw_obtained     numeric(10,2), raw_max numeric(10,2),
  weighted_score   numeric(7,3),
  percentage       numeric(7,3),
  grade text, grade_point numeric(5,2), grade_descriptor text, grade_remark text, is_pass boolean,
  grading_scheme_id uuid REFERENCES elimu_grading_schemes(id),
  grading_rule_id  uuid,
  teacher_remark   text, teacher_remark_by uuid, teacher_remark_at timestamptz,
  breakdown        jsonb NOT NULL DEFAULT '[]'::jsonb,
  issues           jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (term_result_id, subject_id),
  CONSTRAINT elimu_sr_graded_chk CHECK (completeness = 'COMPLETE' OR percentage IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_elimu_sr_enroll ON elimu_subject_results (tenant_id, enrollment_id, term_id);
CREATE INDEX IF NOT EXISTS idx_elimu_sr_subject ON elimu_subject_results (tenant_id, academic_year_id, term_id, class_id, subject_id);

CREATE TABLE IF NOT EXISTS elimu_report_cards (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  term_result_id   uuid NOT NULL REFERENCES elimu_term_results(id),
  enrollment_id    uuid NOT NULL, student_id uuid NOT NULL,
  academic_year_id uuid NOT NULL, term_id uuid NOT NULL,
  class_id         uuid NOT NULL, stream_id uuid,
  revision_no      integer NOT NULL DEFAULT 1,
  status           text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REVIEW','APPROVED','PUBLISHED','SUPERSEDED')),
  class_teacher_remarks text, class_teacher_staff_id uuid,
  head_remarks     text,      head_staff_id uuid,
  snapshot         jsonb,                      -- frozen content, set at APPROVAL; printing an approved/published card uses ONLY this
  reviewed_by uuid, reviewed_at timestamptz,
  approved_by uuid, approved_at timestamptz,
  published_by uuid, published_at timestamptz,
  superseded_by_id uuid REFERENCES elimu_report_cards(id),
  correction_reason text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, term_id, revision_no),
  CONSTRAINT elimu_rc_frozen_chk CHECK (status IN ('DRAFT','REVIEW') OR snapshot IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_elimu_rc_scope ON elimu_report_cards (tenant_id, academic_year_id, term_id, class_id, stream_id, status);
CREATE INDEX IF NOT EXISTS idx_elimu_rc_student ON elimu_report_cards (tenant_id, student_id, academic_year_id, term_id);

CREATE TABLE IF NOT EXISTS elimu_report_card_history (
  id             bigserial PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  report_card_id uuid NOT NULL,
  action         text NOT NULL,              -- CREATED, STATUS_CHANGED, REMARKS_CHANGED, CORRECTION_OPENED
  from_status    text, to_status text,
  reason         text,
  actor_staff_id uuid,
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_elimu_rchist ON elimu_report_card_history (report_card_id, at);

-- ================================================================ guards
CREATE OR REPLACE FUNCTION elimu_guard_term_result() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin boolean := coalesce(current_setting('elimu.result_admin', true), '') = 'on';
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF is_pos_session() THEN RAISE EXCEPTION 'Results cannot be deleted.' USING ERRCODE = '42501'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.tenant_id, NEW.enrollment_id, NEW.term_id, NEW.revision) IS DISTINCT FROM (OLD.tenant_id, OLD.enrollment_id, OLD.term_id, OLD.revision) THEN
      RAISE EXCEPTION 'Result identity cannot change.' USING ERRCODE = '42501';
    END IF;
    IF OLD.locked_at IS NOT NULL AND NOT v_admin THEN RAISE EXCEPTION 'These results are approved and locked.' USING ERRCODE = '42501'; END IF;
    IF OLD.locked_at IS NOT NULL AND v_admin AND NEW.locked_at IS NOT NULL
       AND (NEW.total_percentage, NEW.mean_percentage, NEW.overall_grade, NEW.class_position, NEW.stream_position, NEW.subjects_complete)
           IS DISTINCT FROM (OLD.total_percentage, OLD.mean_percentage, OLD.overall_grade, OLD.class_position, OLD.stream_position, OLD.subjects_complete)
       AND coalesce(current_setting('elimu.correction', true), '') <> 'on' THEN
      RAISE EXCEPTION 'Locked results can only change through a correction (a new revision).' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_tr_guard ON elimu_term_results;
CREATE TRIGGER trg_elimu_tr_guard BEFORE INSERT OR UPDATE OR DELETE ON elimu_term_results FOR EACH ROW EXECUTE FUNCTION elimu_guard_term_result();

CREATE OR REPLACE FUNCTION elimu_guard_subject_result() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin boolean := coalesce(current_setting('elimu.result_admin', true), '') = 'on'; v_locked timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- only a recompute (result_admin) may drop a row, and only while its term result is NOT locked
    SELECT locked_at INTO v_locked FROM elimu_term_results WHERE id = OLD.term_result_id;
    IF is_pos_session() AND (NOT v_admin OR v_locked IS NOT NULL) THEN RAISE EXCEPTION 'Results cannot be deleted.' USING ERRCODE = '42501'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT locked_at INTO v_locked FROM elimu_term_results WHERE id = OLD.term_result_id;
    IF v_locked IS NOT NULL AND NOT v_admin THEN RAISE EXCEPTION 'These results are approved and locked.' USING ERRCODE = '42501'; END IF;
    IF v_locked IS NOT NULL AND (NEW.percentage, NEW.grade, NEW.grade_point, NEW.breakdown, NEW.subject_id) IS DISTINCT FROM (OLD.percentage, OLD.grade, OLD.grade_point, OLD.breakdown, OLD.subject_id) THEN
      RAISE EXCEPTION 'Locked results can only change through a correction (a new revision).' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_sr_guard ON elimu_subject_results;
CREATE TRIGGER trg_elimu_sr_guard BEFORE INSERT OR UPDATE OR DELETE ON elimu_subject_results FOR EACH ROW EXECUTE FUNCTION elimu_guard_subject_result();

-- Report card workflow, enforced by the database:
--   DRAFT -> REVIEW -> APPROVED -> PUBLISHED -> SUPERSEDED ;  REVIEW -> DRAFT (send back) ; APPROVED -> REVIEW (before publishing only)
-- PUBLISHED / SUPERSEDED rows are read-only. Remarks are editable only in DRAFT / REVIEW.
CREATE OR REPLACE FUNCTION elimu_guard_report_card() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF is_pos_session() THEN RAISE EXCEPTION 'Report cards cannot be deleted.' USING ERRCODE = '42501'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN RAISE EXCEPTION 'A report card starts as a draft.' USING ERRCODE = '23514'; END IF;
    IF is_pos_session() THEN NEW.created_by := elimu_staff_id(); END IF;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.enrollment_id, NEW.term_id, NEW.revision_no, NEW.student_id) IS DISTINCT FROM (OLD.tenant_id, OLD.enrollment_id, OLD.term_id, OLD.revision_no, OLD.student_id) THEN
    RAISE EXCEPTION 'Report card identity cannot change.' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'DRAFT' AND NEW.status = 'REVIEW') OR
       (OLD.status = 'REVIEW' AND NEW.status IN ('DRAFT','APPROVED')) OR
       (OLD.status = 'APPROVED' AND NEW.status IN ('REVIEW','PUBLISHED')) OR
       (OLD.status = 'PUBLISHED' AND NEW.status = 'SUPERSEDED')) THEN
    RAISE EXCEPTION 'A report card cannot go from % to %.', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('PUBLISHED','SUPERSEDED') AND NEW.status = OLD.status THEN
    RAISE EXCEPTION 'A published report card is protected. Open a correction to change it.' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'PUBLISHED' AND NEW.status = 'SUPERSEDED'
     AND (NEW.class_teacher_remarks, NEW.head_remarks, NEW.snapshot, NEW.term_result_id) IS DISTINCT FROM (OLD.class_teacher_remarks, OLD.head_remarks, OLD.snapshot, OLD.term_result_id) THEN
    RAISE EXCEPTION 'A published report card cannot be edited.' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'APPROVED' AND NEW.status = 'APPROVED'
     AND (NEW.class_teacher_remarks, NEW.head_remarks, NEW.snapshot, NEW.term_result_id) IS DISTINCT FROM (OLD.class_teacher_remarks, OLD.head_remarks, OLD.snapshot, OLD.term_result_id) THEN
    RAISE EXCEPTION 'An approved report card cannot be edited. Send it back to review first.' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_rc_guard ON elimu_report_cards;
CREATE TRIGGER trg_elimu_rc_guard BEFORE INSERT OR UPDATE OR DELETE ON elimu_report_cards FOR EACH ROW EXECUTE FUNCTION elimu_guard_report_card();

CREATE OR REPLACE FUNCTION elimu_report_card_history_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_reason text := nullif(current_setting('elimu.reason', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO elimu_report_card_history (tenant_id, report_card_id, action, to_status, reason, actor_staff_id)
    VALUES (NEW.tenant_id, NEW.id, CASE WHEN NEW.revision_no > 1 THEN 'CORRECTION_OPENED' ELSE 'CREATED' END, NEW.status, coalesce(v_reason, NEW.correction_reason), elimu_staff_id());
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO elimu_report_card_history (tenant_id, report_card_id, action, from_status, to_status, reason, actor_staff_id)
    VALUES (NEW.tenant_id, NEW.id, 'STATUS_CHANGED', OLD.status, NEW.status, v_reason, elimu_staff_id());
  ELSIF (NEW.class_teacher_remarks, NEW.head_remarks) IS DISTINCT FROM (OLD.class_teacher_remarks, OLD.head_remarks) THEN
    INSERT INTO elimu_report_card_history (tenant_id, report_card_id, action, reason, actor_staff_id)
    VALUES (NEW.tenant_id, NEW.id, 'REMARKS_CHANGED', v_reason, elimu_staff_id());
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_rc_history ON elimu_report_cards;
CREATE TRIGGER trg_elimu_rc_history AFTER INSERT OR UPDATE ON elimu_report_cards FOR EACH ROW EXECUTE FUNCTION elimu_report_card_history_write();
DROP TRIGGER IF EXISTS trg_elimu_rchist_immutable ON elimu_report_card_history;
CREATE TRIGGER trg_elimu_rchist_immutable BEFORE UPDATE OR DELETE ON elimu_report_card_history FOR EACH ROW EXECUTE FUNCTION elimu_history_immutable();

-- ================================================================ RLS (read only; all writes go through functions)
ALTER TABLE elimu_term_results         ENABLE ROW LEVEL SECURITY;
ALTER TABLE elimu_subject_results      ENABLE ROW LEVEL SECURITY;
ALTER TABLE elimu_report_cards         ENABLE ROW LEVEL SECURITY;
ALTER TABLE elimu_report_card_history  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS elimu_tr_sel ON elimu_term_results;
CREATE POLICY elimu_tr_sel ON elimu_term_results FOR SELECT
  USING (tenant_id = get_current_tenant_id() AND (elimu_can('view.all') OR elimu_is_class_teacher(academic_year_id, class_id, stream_id)));
DROP POLICY IF EXISTS elimu_sr_sel ON elimu_subject_results;
CREATE POLICY elimu_sr_sel ON elimu_subject_results FOR SELECT
  USING (tenant_id = get_current_tenant_id() AND (elimu_can('view.all') OR elimu_is_class_teacher(academic_year_id, class_id, stream_id)
         OR elimu_teacher_covers(academic_year_id, term_id, class_id, stream_id, subject_id, false)));
DROP POLICY IF EXISTS elimu_rc_sel ON elimu_report_cards;
CREATE POLICY elimu_rc_sel ON elimu_report_cards FOR SELECT
  USING (tenant_id = get_current_tenant_id() AND (elimu_can('view.all') OR elimu_is_class_teacher(academic_year_id, class_id, stream_id)));
DROP POLICY IF EXISTS elimu_rchist_sel ON elimu_report_card_history;
CREATE POLICY elimu_rchist_sel ON elimu_report_card_history FOR SELECT
  USING (tenant_id = get_current_tenant_id() AND elimu_can('view.all'));

GRANT SELECT ON elimu_term_results, elimu_subject_results, elimu_report_cards, elimu_report_card_history TO authenticated;
