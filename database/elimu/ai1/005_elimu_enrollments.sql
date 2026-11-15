-- ============================================================
-- ELIMU 005 — enrolment (history-safe), admit workflow, reporting views
--
-- Run AFTER 004. Additive and re-runnable.
--
--   elimu_enrollments         one row per student per academic year per PERIOD (a term, or NULL = the whole year).
--                             A student's class for 2027 is a different row from 2026: nothing is overwritten.
--   elimu_enrollment_history  append-only snapshots (class/stream/status over time) for "where was this student on date X"
--   elimu_change_student_status / elimu_move_enrollment / elimu_enroll_students / elimu_admit_application   (RPCs)
--   v_elimu_current_period, v_elimu_student_directory, v_elimu_enrollment_history,
--   v_elimu_data_quality, elimu_dashboard_summary()    (read models every other Elimu module and report builds on)
--
-- RULES THE DATABASE ENFORCES
--   * One live enrolment per student + academic year + period (partial unique indexes; cancelled rows don't count).
--   * A student is enrolled for the whole year OR by term in a given year, never both.
--   * Stream must belong to the class (composite FK); term must belong to the year (composite FK).
--   * Only students whose status category is ACTIVE can be enrolled.
--   * student, year and term of an enrolment never change; a class / stream correction is allowed only while ENROLLED and the
--     year is open, and every change leaves a history row. Leaving a period = status change, not delete (no DELETE policy).
-- ============================================================

CREATE TABLE IF NOT EXISTS elimu_enrollments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  student_id       uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  term_id          uuid,                       -- NULL = enrolled for the whole academic year
  class_id         uuid NOT NULL,
  stream_id        uuid,
  status           text NOT NULL DEFAULT 'ENROLLED' CHECK (status IN ('ENROLLED','COMPLETED','WITHDRAWN','TRANSFERRED_OUT','CANCELLED')),
  enrolled_on      date NOT NULL DEFAULT current_date,
  ended_on         date,
  source           text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','ADMISSION','PROMOTION','IMPORT')),
  notes            text,
  created_by uuid, updated_by uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT elimu_enrollment_dates_chk CHECK (ended_on IS NULL OR ended_on >= enrolled_on),
  FOREIGN KEY (tenant_id, student_id) REFERENCES elimu_students (tenant_id, id),
  FOREIGN KEY (tenant_id, academic_year_id) REFERENCES elimu_academic_years (tenant_id, id),
  FOREIGN KEY (tenant_id, academic_year_id, term_id) REFERENCES elimu_terms (tenant_id, academic_year_id, id),   -- skipped while term_id is NULL
  FOREIGN KEY (tenant_id, class_id) REFERENCES elimu_classes (tenant_id, id),
  FOREIGN KEY (tenant_id, class_id, stream_id) REFERENCES elimu_streams (tenant_id, class_id, id),               -- skipped while stream_id is NULL
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_enrollment_term ON elimu_enrollments (tenant_id, student_id, academic_year_id, term_id) WHERE term_id IS NOT NULL AND status <> 'CANCELLED';
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_enrollment_year ON elimu_enrollments (tenant_id, student_id, academic_year_id) WHERE term_id IS NULL AND status <> 'CANCELLED';
CREATE INDEX IF NOT EXISTS idx_elimu_enrollment_roster ON elimu_enrollments (tenant_id, academic_year_id, class_id, stream_id) WHERE status = 'ENROLLED';
CREATE INDEX IF NOT EXISTS idx_elimu_enrollment_student ON elimu_enrollments (tenant_id, student_id, academic_year_id);

-- the application points at its resulting enrolment
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'elimu_application_enrollment_fk') THEN
    ALTER TABLE elimu_admission_applications ADD CONSTRAINT elimu_application_enrollment_fk
      FOREIGN KEY (tenant_id, enrollment_id) REFERENCES elimu_enrollments (tenant_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS elimu_enrollment_history (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  enrollment_id    uuid NOT NULL,
  student_id       uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  term_id          uuid,
  class_id         uuid NOT NULL,
  stream_id        uuid,
  status           text NOT NULL,
  reason           text,
  changed_by       uuid,
  changed_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, enrollment_id) REFERENCES elimu_enrollments (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_elimu_enrollment_history ON elimu_enrollment_history (tenant_id, student_id, changed_at);

-- ---------- rules ----------
CREATE OR REPLACE FUNCTION elimu_enrollment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_cat text; v_year_status text; v_class_active boolean; v_stream_active boolean;
BEGIN
  SELECT status INTO v_year_status FROM elimu_academic_years WHERE tenant_id = NEW.tenant_id AND id = NEW.academic_year_id;
  IF TG_OP = 'INSERT' THEN
    SELECT st.category INTO v_cat FROM elimu_students s JOIN elimu_student_statuses st ON st.tenant_id = s.tenant_id AND st.id = s.status_id
     WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.student_id;
    IF NEW.status <> 'CANCELLED' AND v_cat IS DISTINCT FROM 'ACTIVE' AND NEW.source <> 'IMPORT' THEN
      RAISE EXCEPTION 'Only a student whose status is Active can be enrolled.' USING ERRCODE = '23514';
    END IF;
    IF v_year_status = 'CLOSED' AND NEW.source <> 'IMPORT' THEN RAISE EXCEPTION 'That academic year is closed.' USING ERRCODE = '23514'; END IF;
    SELECT is_active INTO v_class_active FROM elimu_classes WHERE tenant_id = NEW.tenant_id AND id = NEW.class_id;
    IF NOT coalesce(v_class_active, false) AND NEW.source <> 'IMPORT' THEN RAISE EXCEPTION 'That class is not active.' USING ERRCODE = '23514'; END IF;
    IF NEW.stream_id IS NOT NULL THEN
      SELECT is_active INTO v_stream_active FROM elimu_streams WHERE tenant_id = NEW.tenant_id AND id = NEW.stream_id;
      IF NOT coalesce(v_stream_active, false) AND NEW.source <> 'IMPORT' THEN RAISE EXCEPTION 'That stream is not active.' USING ERRCODE = '23514'; END IF;
    END IF;
    IF NEW.status <> 'CANCELLED' AND EXISTS (
         SELECT 1 FROM elimu_enrollments e WHERE e.tenant_id = NEW.tenant_id AND e.student_id = NEW.student_id AND e.academic_year_id = NEW.academic_year_id
            AND e.status <> 'CANCELLED' AND e.id <> NEW.id AND (e.term_id IS NULL) <> (NEW.term_id IS NULL)) THEN
      RAISE EXCEPTION 'In one academic year a student is enrolled either for the whole year or term by term, not both.' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.student_id IS DISTINCT FROM OLD.student_id OR NEW.academic_year_id IS DISTINCT FROM OLD.academic_year_id OR NEW.term_id IS DISTINCT FROM OLD.term_id THEN
      RAISE EXCEPTION 'An enrolment cannot be moved to another student, year or term. Cancel it and enrol again.' USING ERRCODE = '23514';
    END IF;
    IF OLD.status <> 'ENROLLED' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.class_id IS DISTINCT FROM OLD.class_id OR NEW.stream_id IS DISTINCT FROM OLD.stream_id) THEN
      RAISE EXCEPTION 'This enrolment is finished and its record is kept as it was.' USING ERRCODE = '23514';
    END IF;
    IF (NEW.class_id IS DISTINCT FROM OLD.class_id OR NEW.stream_id IS DISTINCT FROM OLD.stream_id) AND v_year_status = 'CLOSED' THEN
      RAISE EXCEPTION 'That academic year is closed.' USING ERRCODE = '23514';
    END IF;
    IF NEW.status <> 'ENROLLED' AND NEW.ended_on IS NULL THEN NEW.ended_on := greatest(current_date, NEW.enrolled_on); END IF;
  END IF;
  NEW.notes := nullif(btrim(coalesce(NEW.notes, '')), '');
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION elimu_enrollment_log() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.class_id IS NOT DISTINCT FROM OLD.class_id AND NEW.stream_id IS NOT DISTINCT FROM OLD.stream_id AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  INSERT INTO elimu_enrollment_history (tenant_id, enrollment_id, student_id, academic_year_id, term_id, class_id, stream_id, status, reason, changed_by)
  VALUES (NEW.tenant_id, NEW.id, NEW.student_id, NEW.academic_year_id, NEW.term_id, NEW.class_id, NEW.stream_id, NEW.status,
          nullif(current_setting('elimu.change_reason', true), ''), auth.uid());
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_elimu_enrollments_1tenant ON elimu_enrollments;
CREATE TRIGGER trg_elimu_enrollments_1tenant BEFORE INSERT OR UPDATE ON elimu_enrollments FOR EACH ROW EXECUTE FUNCTION elimu_tenant_guard();
DROP TRIGGER IF EXISTS trg_elimu_enrollments_2perm ON elimu_enrollments;
CREATE TRIGGER trg_elimu_enrollments_2perm BEFORE INSERT OR UPDATE OR DELETE ON elimu_enrollments FOR EACH ROW EXECUTE FUNCTION elimu_enforce('enrollment.manage');
DROP TRIGGER IF EXISTS trg_elimu_enrollments_3guard ON elimu_enrollments;
CREATE TRIGGER trg_elimu_enrollments_3guard BEFORE INSERT OR UPDATE ON elimu_enrollments FOR EACH ROW EXECUTE FUNCTION elimu_enrollment_guard();
DROP TRIGGER IF EXISTS trg_elimu_enrollments_4updated ON elimu_enrollments;
CREATE TRIGGER trg_elimu_enrollments_4updated BEFORE UPDATE ON elimu_enrollments FOR EACH ROW EXECUTE FUNCTION elimu_set_updated_at();
DROP TRIGGER IF EXISTS trg_elimu_enrollments_log ON elimu_enrollments;
CREATE TRIGGER trg_elimu_enrollments_log AFTER INSERT OR UPDATE ON elimu_enrollments FOR EACH ROW EXECUTE FUNCTION elimu_enrollment_log();
DROP TRIGGER IF EXISTS trg_elimu_enrollments_audit ON elimu_enrollments;
CREATE TRIGGER trg_elimu_enrollments_audit AFTER INSERT OR UPDATE ON elimu_enrollments FOR EACH ROW EXECUTE FUNCTION elimu_audit('enrollment', 'status', 'class_id', 'stream_id');
DROP TRIGGER IF EXISTS trg_elimu_enrollment_history_1tenant ON elimu_enrollment_history;
CREATE TRIGGER trg_elimu_enrollment_history_1tenant BEFORE INSERT ON elimu_enrollment_history FOR EACH ROW EXECUTE FUNCTION elimu_tenant_guard();

ALTER TABLE elimu_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_enrollments_select ON elimu_enrollments;
CREATE POLICY elimu_enrollments_select ON elimu_enrollments FOR SELECT USING (tenant_id = (SELECT get_current_tenant_id()) AND (SELECT elimu_can('enrollment.view')));
DROP POLICY IF EXISTS elimu_enrollments_insert ON elimu_enrollments;
CREATE POLICY elimu_enrollments_insert ON elimu_enrollments FOR INSERT WITH CHECK (tenant_id = (SELECT get_current_tenant_id()));
DROP POLICY IF EXISTS elimu_enrollments_update ON elimu_enrollments;
CREATE POLICY elimu_enrollments_update ON elimu_enrollments FOR UPDATE USING (tenant_id = (SELECT get_current_tenant_id())) WITH CHECK (tenant_id = (SELECT get_current_tenant_id()));
ALTER TABLE elimu_enrollment_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_enrollment_history_select ON elimu_enrollment_history;
CREATE POLICY elimu_enrollment_history_select ON elimu_enrollment_history FOR SELECT USING (tenant_id = (SELECT get_current_tenant_id()) AND (SELECT elimu_can('enrollment.view')));

-- ---------- RPCs ----------
-- Change a student's status with a reason and an effective date; closes still-open enrolments when the student has left.
CREATE OR REPLACE FUNCTION elimu_change_student_status(p_student uuid, p_status_id uuid, p_reason text DEFAULT NULL, p_effective_date date DEFAULT NULL, p_close_enrollments boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE s elimu_students; v_cat text; v_eff date := coalesce(p_effective_date, current_date); v_closed int := 0;
BEGIN
  PERFORM elimu_require('students.manage');
  SELECT * INTO s FROM elimu_students WHERE tenant_id = get_current_tenant_id() AND id = p_student FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student not found.' USING ERRCODE = 'P0002'; END IF;
  SELECT category INTO v_cat FROM elimu_student_statuses WHERE tenant_id = s.tenant_id AND id = p_status_id;
  IF v_cat IS NULL THEN RAISE EXCEPTION 'Unknown student status.' USING ERRCODE = 'P0002'; END IF;
  IF s.status_id = p_status_id THEN RETURN jsonb_build_object('changed', false); END IF;
  PERFORM set_config('elimu.status_reason', coalesce(p_reason, ''), true);
  PERFORM set_config('elimu.status_effective', v_eff::text, true);
  UPDATE elimu_students SET status_id = p_status_id, updated_by = auth.uid() WHERE id = s.id;
  IF p_close_enrollments AND v_cat IN ('TRANSFERRED','WITHDRAWN','GRADUATED','ALUMNI') THEN
    PERFORM set_config('elimu.change_reason', coalesce(nullif(p_reason, ''), 'Student status changed'), true);
    UPDATE elimu_enrollments e
       SET status = CASE v_cat WHEN 'TRANSFERRED' THEN 'TRANSFERRED_OUT' WHEN 'WITHDRAWN' THEN 'WITHDRAWN' ELSE 'COMPLETED' END,
           ended_on = greatest(v_eff, e.enrolled_on)
     WHERE e.tenant_id = s.tenant_id AND e.student_id = s.id AND e.status = 'ENROLLED'
       AND coalesce((SELECT t.end_date FROM elimu_terms t WHERE t.tenant_id = e.tenant_id AND t.id = e.term_id),
                    (SELECT y.end_date FROM elimu_academic_years y WHERE y.tenant_id = e.tenant_id AND y.id = e.academic_year_id)) >= v_eff;
    GET DIAGNOSTICS v_closed = ROW_COUNT;
    PERFORM set_config('elimu.change_reason', '', true);
  END IF;
  PERFORM set_config('elimu.status_reason', '', true);
  PERFORM set_config('elimu.status_effective', '', true);
  RETURN jsonb_build_object('changed', true, 'closed_enrollments', v_closed);
END $$;

-- Move a student to another class / stream within the SAME period. The old placement stays in elimu_enrollment_history.
CREATE OR REPLACE FUNCTION elimu_move_enrollment(p_enrollment uuid, p_class_id uuid, p_stream_id uuid DEFAULT NULL, p_reason text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM elimu_require('enrollment.manage');
  PERFORM set_config('elimu.change_reason', coalesce(p_reason, ''), true);
  UPDATE elimu_enrollments SET class_id = p_class_id, stream_id = p_stream_id, updated_by = auth.uid() WHERE tenant_id = get_current_tenant_id() AND id = p_enrollment;
  IF NOT FOUND THEN RAISE EXCEPTION 'Enrolment not found.' USING ERRCODE = 'P0002'; END IF;
  PERFORM set_config('elimu.change_reason', '', true);
END $$;

-- Enrol many students into one class/stream/period. One student failing (already enrolled, not active...) does not stop the rest.
CREATE OR REPLACE FUNCTION elimu_enroll_students(p_academic_year_id uuid, p_term_id uuid, p_class_id uuid, p_stream_id uuid, p_student_ids uuid[], p_source text DEFAULT 'MANUAL')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE sid uuid; v_ok int := 0; v_skipped jsonb := '[]'::jsonb;
BEGIN
  PERFORM elimu_require('enrollment.manage');
  IF p_source NOT IN ('MANUAL','PROMOTION') THEN RAISE EXCEPTION 'Bad source.' USING ERRCODE = '22023'; END IF;
  FOREACH sid IN ARRAY coalesce(p_student_ids, ARRAY[]::uuid[]) LOOP
    BEGIN
      INSERT INTO elimu_enrollments (tenant_id, student_id, academic_year_id, term_id, class_id, stream_id, source, created_by)
      VALUES (get_current_tenant_id(), sid, p_academic_year_id, p_term_id, p_class_id, p_stream_id, p_source, auth.uid());
      v_ok := v_ok + 1;
    EXCEPTION WHEN unique_violation OR check_violation OR foreign_key_violation THEN
      v_skipped := v_skipped || jsonb_build_object('student_id', sid, 'reason', SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('enrolled', v_ok, 'skipped', v_skipped);
END $$;

-- The last step of the admission workflow, atomic and repeatable: accepted application -> admission number -> Active student -> enrolment.
CREATE OR REPLACE FUNCTION elimu_admit_application(p_application uuid, p_class_id uuid DEFAULT NULL, p_stream_id uuid DEFAULT NULL, p_academic_year_id uuid DEFAULT NULL,
                                                   p_term_id uuid DEFAULT NULL, p_admission_no text DEFAULT NULL, p_admission_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  a elimu_admission_applications; v_cat text; v_active uuid; v_admitted uuid; v_enr uuid; v_no text; v_year uuid; v_class uuid; v_term uuid; v_date date;
BEGIN
  PERFORM elimu_require('admissions.decide');
  PERFORM elimu_require('enrollment.manage');
  SELECT * INTO a FROM elimu_admission_applications WHERE tenant_id = get_current_tenant_id() AND id = p_application FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found.' USING ERRCODE = 'P0002'; END IF;
  SELECT category INTO v_cat FROM elimu_admission_statuses WHERE tenant_id = a.tenant_id AND id = a.status_id;
  IF v_cat = 'ADMITTED' THEN
    RETURN jsonb_build_object('already_admitted', true, 'student_id', a.student_id, 'enrollment_id', a.enrollment_id);
  END IF;
  IF v_cat <> 'ACCEPTED' THEN RAISE EXCEPTION 'Only an accepted application can be admitted.' USING ERRCODE = '23514'; END IF;
  IF elimu_setting_bool('require_guardian_for_admission', true, a.tenant_id)
     AND NOT EXISTS (SELECT 1 FROM elimu_student_guardians WHERE tenant_id = a.tenant_id AND student_id = a.student_id AND ended_on IS NULL) THEN
    RAISE EXCEPTION 'Add at least one guardian before admitting this student.' USING ERRCODE = '23514';
  END IF;
  v_class := coalesce(p_class_id, a.requested_class_id);
  v_year  := coalesce(p_academic_year_id, a.requested_academic_year_id);
  v_term  := CASE WHEN p_academic_year_id IS NULL THEN coalesce(p_term_id, a.requested_term_id) ELSE p_term_id END;
  v_date  := coalesce(p_admission_date, current_date);
  SELECT coalesce(nullif(btrim(p_admission_no), ''), s.admission_no) INTO v_no FROM elimu_students s WHERE s.tenant_id = a.tenant_id AND s.id = a.student_id;
  IF v_no IS NULL THEN v_no := elimu_next_number('ADMISSION', a.tenant_id); END IF;
  SELECT id INTO v_active FROM elimu_student_statuses WHERE tenant_id = a.tenant_id AND category = 'ACTIVE' AND is_default AND is_active LIMIT 1;
  SELECT id INTO v_admitted FROM elimu_admission_statuses WHERE tenant_id = a.tenant_id AND category = 'ADMITTED' AND is_default AND is_active LIMIT 1;
  IF v_active IS NULL OR v_admitted IS NULL THEN RAISE EXCEPTION 'The default Active / Admitted statuses are missing; run elimu_ensure_setup().' USING ERRCODE = '22023'; END IF;

  PERFORM set_config('elimu.status_reason', 'Admitted (' || a.application_no || ')', true);
  UPDATE elimu_students SET admission_no = v_no, admission_date = v_date, status_id = v_active, updated_by = auth.uid() WHERE tenant_id = a.tenant_id AND id = a.student_id;
  INSERT INTO elimu_enrollments (tenant_id, student_id, academic_year_id, term_id, class_id, stream_id, source, created_by)
  VALUES (a.tenant_id, a.student_id, v_year, v_term, v_class, p_stream_id, 'ADMISSION', auth.uid()) RETURNING id INTO v_enr;
  PERFORM set_config('elimu.admitting', 'on', true);
  UPDATE elimu_admission_applications SET status_id = v_admitted, admission_date = v_date, enrollment_id = v_enr, updated_by = auth.uid() WHERE id = a.id;
  PERFORM set_config('elimu.admitting', 'off', true);
  PERFORM set_config('elimu.status_reason', '', true);
  RETURN jsonb_build_object('already_admitted', false, 'student_id', a.student_id, 'admission_no', v_no, 'enrollment_id', v_enr);
END $$;

-- ---------- read models (SECURITY INVOKER: the caller's own RLS and permissions apply) ----------
CREATE OR REPLACE VIEW v_elimu_current_period WITH (security_invoker = true) AS
SELECT y.tenant_id, y.business_id, y.id AS academic_year_id, y.name AS academic_year_name, y.start_date AS year_start, y.end_date AS year_end,
       t.id AS term_id, t.name AS term_name
  FROM elimu_academic_years y
  LEFT JOIN elimu_terms t ON t.tenant_id = y.tenant_id AND t.academic_year_id = y.id AND current_date BETWEEN t.start_date AND t.end_date
 WHERE y.status = 'CURRENT';

-- One row per student with status, current class/stream, primary guardian and primary phone. The base of student lists and reports.
CREATE OR REPLACE VIEW v_elimu_student_directory WITH (security_invoker = true) AS
SELECT s.id AS student_id, s.tenant_id, s.business_id, s.admission_no, s.first_name, s.middle_name, s.last_name, s.preferred_name,
       trim(s.first_name || ' ' || s.last_name) AS full_name, s.date_of_birth, s.gender, s.photo_path, s.admission_date, s.archived_at,
       st.id AS status_id, st.code AS status_code, st.label AS status_label, st.category AS status_category,
       e.id AS enrollment_id, e.academic_year_id, e.term_id, e.class_id, c.name AS class_name, c.level_order, e.stream_id, sm.name AS stream_name,
       pg.guardian_id AS primary_guardian_id, pg.guardian_name AS primary_guardian_name, pg.phone AS primary_guardian_phone
  FROM elimu_students s
  JOIN elimu_student_statuses st ON st.tenant_id = s.tenant_id AND st.id = s.status_id
  LEFT JOIN v_elimu_current_period cp ON cp.tenant_id = s.tenant_id AND cp.business_id = s.business_id
  LEFT JOIN LATERAL (
    SELECT x.* FROM elimu_enrollments x
     WHERE x.tenant_id = s.tenant_id AND x.student_id = s.id AND x.academic_year_id = cp.academic_year_id AND x.status = 'ENROLLED'
       AND (x.term_id IS NULL OR cp.term_id IS NULL OR x.term_id = cp.term_id)
     ORDER BY (x.term_id IS NOT NULL) DESC, x.enrolled_on DESC LIMIT 1) e ON true
  LEFT JOIN elimu_classes c ON c.tenant_id = e.tenant_id AND c.id = e.class_id
  LEFT JOIN elimu_streams sm ON sm.tenant_id = e.tenant_id AND sm.id = e.stream_id
  LEFT JOIN LATERAL (
    SELECT g.id AS guardian_id, g.first_name || ' ' || g.last_name AS guardian_name,
           (SELECT ct.value FROM elimu_guardian_contacts ct WHERE ct.tenant_id = g.tenant_id AND ct.guardian_id = g.id AND ct.kind = 'PHONE' ORDER BY ct.is_primary DESC, ct.created_at LIMIT 1) AS phone
      FROM elimu_student_guardians sg JOIN elimu_guardians g ON g.tenant_id = sg.tenant_id AND g.id = sg.guardian_id
     WHERE sg.tenant_id = s.tenant_id AND sg.student_id = s.id AND sg.ended_on IS NULL AND sg.guardian_rank = 1 LIMIT 1) pg ON true;

-- Full placement history, newest first: "which class was this student in, in which year / term".
CREATE OR REPLACE VIEW v_elimu_enrollment_history WITH (security_invoker = true) AS
SELECT e.tenant_id, e.student_id, e.id AS enrollment_id, y.name AS academic_year_name, y.start_date AS year_start, t.name AS term_name,
       c.name AS class_name, sm.name AS stream_name, e.status, e.enrolled_on, e.ended_on, e.source,
       e.academic_year_id, e.term_id, e.class_id, e.stream_id
  FROM elimu_enrollments e
  JOIN elimu_academic_years y ON y.tenant_id = e.tenant_id AND y.id = e.academic_year_id
  LEFT JOIN elimu_terms t ON t.tenant_id = e.tenant_id AND t.id = e.term_id
  JOIN elimu_classes c ON c.tenant_id = e.tenant_id AND c.id = e.class_id
  LEFT JOIN elimu_streams sm ON sm.tenant_id = e.tenant_id AND sm.id = e.stream_id
 WHERE e.status <> 'CANCELLED';

-- Records that need attention, in one list the dashboard and the settings page can show.
CREATE OR REPLACE VIEW v_elimu_data_quality WITH (security_invoker = true) AS
SELECT s.tenant_id, 'STUDENT_NO_GUARDIAN'::text AS issue, 'STUDENT'::text AS entity_type, s.id AS entity_id, trim(s.first_name || ' ' || s.last_name) AS label
  FROM elimu_students s JOIN elimu_student_statuses st ON st.tenant_id = s.tenant_id AND st.id = s.status_id
 WHERE st.category = 'ACTIVE' AND s.archived_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM elimu_student_guardians g WHERE g.tenant_id = s.tenant_id AND g.student_id = s.id AND g.ended_on IS NULL)
UNION ALL
SELECT s.tenant_id, 'STUDENT_NO_EMERGENCY_CONTACT', 'STUDENT', s.id, trim(s.first_name || ' ' || s.last_name)
  FROM elimu_students s JOIN elimu_student_statuses st ON st.tenant_id = s.tenant_id AND st.id = s.status_id
 WHERE st.category = 'ACTIVE' AND s.archived_at IS NULL
   AND EXISTS (SELECT 1 FROM elimu_student_guardians g WHERE g.tenant_id = s.tenant_id AND g.student_id = s.id AND g.ended_on IS NULL)
   AND NOT EXISTS (SELECT 1 FROM elimu_student_guardians g WHERE g.tenant_id = s.tenant_id AND g.student_id = s.id AND g.ended_on IS NULL AND g.is_emergency_contact)
UNION ALL
SELECT d.tenant_id, 'STUDENT_NOT_ENROLLED', 'STUDENT', d.student_id, d.full_name
  FROM v_elimu_student_directory d
 WHERE d.status_category = 'ACTIVE' AND d.archived_at IS NULL AND d.enrollment_id IS NULL
   AND EXISTS (SELECT 1 FROM v_elimu_current_period cp WHERE cp.tenant_id = d.tenant_id)
UNION ALL
SELECT g.tenant_id, 'GUARDIAN_NO_CONTACT', 'GUARDIAN', g.id, g.first_name || ' ' || g.last_name
  FROM elimu_guardians g
 WHERE g.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM elimu_guardian_contacts c WHERE c.tenant_id = g.tenant_id AND c.guardian_id = g.id)
UNION ALL
SELECT g.tenant_id, 'GUARDIAN_NO_STUDENT', 'GUARDIAN', g.id, g.first_name || ' ' || g.last_name
  FROM elimu_guardians g
 WHERE g.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM elimu_student_guardians l WHERE l.tenant_id = g.tenant_id AND l.guardian_id = g.id AND l.ended_on IS NULL);

CREATE OR REPLACE FUNCTION elimu_dashboard_summary() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'students_by_category', coalesce((SELECT jsonb_object_agg(category, n) FROM (
        SELECT st.category, count(*) AS n FROM elimu_students s JOIN elimu_student_statuses st ON st.tenant_id = s.tenant_id AND st.id = s.status_id
         WHERE s.archived_at IS NULL GROUP BY st.category) q), '{}'::jsonb),
    'applications_by_category', coalesce((SELECT jsonb_object_agg(category, n) FROM (
        SELECT st.category, count(*) AS n FROM elimu_admission_applications a JOIN elimu_admission_statuses st ON st.tenant_id = a.tenant_id AND st.id = a.status_id
         GROUP BY st.category) q), '{}'::jsonb),
    'guardians', (SELECT count(*) FROM elimu_guardians WHERE archived_at IS NULL),
    'current_period', (SELECT to_jsonb(cp) FROM v_elimu_current_period cp LIMIT 1),
    'enrolment_by_class', coalesce((SELECT jsonb_agg(row_to_json(q) ORDER BY q.level_order, q.class_name) FROM (
        SELECT class_name, level_order, count(*) AS students FROM v_elimu_student_directory
         WHERE enrollment_id IS NOT NULL AND archived_at IS NULL GROUP BY class_name, level_order) q), '[]'::jsonb),
    'data_quality', coalesce((SELECT jsonb_object_agg(issue, n) FROM (SELECT issue, count(*) AS n FROM v_elimu_data_quality GROUP BY issue) q), '{}'::jsonb)
  )
$$;

SELECT elimu_apply_grants();
