-- ============================================================
-- ELIMU 006 -- attendance sessions, records, amendments, and the RPCs that are the ONLY way staff change them
-- Run AFTER 005 (and after the Elimu foundation adapter views from 009 exist, for the roster RPCs to work).
-- Safe to re-run.
--
-- KEY RULES (each enforced in the database, not only in the screen):
--   1. One record per student per session            UNIQUE (session_id, enrollment_id) and (session_id, student_id)
--   2. One session per class/stream/date/kind/lesson UNIQUE index below; opening twice returns the same session.
--   3. A student nobody has marked stays NOT_MARKED. Nothing in this module ever turns NOT_MARKED into ABSENT.
--   4. A submitted session is locked; the only way to change it is elimu_amend_attendance (reason + history + audit).
--   5. Staff sessions have NO direct insert/update/delete on sessions or records (no policy). RPCs only.
--   6. Each record keeps enrollment_id AND a snapshot of name / admission no. / class / stream, so history survives
--      a student changing class, being renamed, or leaving.
-- ============================================================

CREATE OR REPLACE FUNCTION elimu_today() RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (now() AT TIME ZONE coalesce((SELECT b.time_zone FROM lb_businesses b WHERE b.tenant_id = get_current_tenant_id() LIMIT 1), 'Africa/Nairobi'))::date
$$;
GRANT EXECUTE ON FUNCTION elimu_today() TO authenticated;

CREATE TABLE IF NOT EXISTS elimu_attendance_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid,
  academic_year_id uuid,
  term_id uuid,
  session_date date NOT NULL,
  session_kind text NOT NULL DEFAULT 'DAILY' CHECK (session_kind IN ('DAILY','LESSON')),
  class_id uuid NOT NULL,
  stream_id uuid,
  class_name text, stream_name text,                                     -- snapshots for history
  timetable_entry_id uuid REFERENCES elimu_timetable_entries(id) ON DELETE SET NULL,
  subject_id uuid,
  teacher_id uuid,                                                       -- the lesson's teacher when a LESSON session
  scheduled_start time, scheduled_end time,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','AMENDED')),
  expected_count integer NOT NULL DEFAULT 0 CHECK (expected_count >= 0),
  marked_count integer NOT NULL DEFAULT 0 CHECK (marked_count >= 0),
  version integer NOT NULL DEFAULT 1,
  opened_by uuid, opened_at timestamptz NOT NULL DEFAULT now(),
  submitted_by uuid, submitted_at timestamptz,
  submitted_unmarked_count integer,                                      -- how many were left NOT_MARKED at submission (not absent!)
  last_amended_by uuid, last_amended_at timestamptz, amendment_count integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT elimu_session_lesson_chk CHECK (session_kind = 'DAILY' OR timetable_entry_id IS NOT NULL OR subject_id IS NOT NULL),
  CONSTRAINT elimu_session_counts_chk CHECK (marked_count <= expected_count)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_session ON elimu_attendance_sessions
  (tenant_id, session_date, class_id, COALESCE(stream_id, elimu_nil()), session_kind, COALESCE(timetable_entry_id, elimu_nil()));
CREATE INDEX IF NOT EXISTS idx_elimu_session_date ON elimu_attendance_sessions (tenant_id, session_date, class_id);
CREATE INDEX IF NOT EXISTS idx_elimu_session_status ON elimu_attendance_sessions (tenant_id, status, session_date);
CREATE INDEX IF NOT EXISTS idx_elimu_session_term ON elimu_attendance_sessions (tenant_id, term_id, session_date);

CREATE TABLE IF NOT EXISTS elimu_attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid,
  session_id uuid NOT NULL REFERENCES elimu_attendance_sessions(id) ON DELETE RESTRICT,
  -- identity: the enrollment that was active on the day (AI 1's enrollment id) and the student
  enrollment_id uuid NOT NULL,
  student_id uuid NOT NULL,
  -- snapshots (history must not change when the student moves class or is renamed)
  student_name text NOT NULL,
  admission_number text,
  class_id uuid NOT NULL, stream_id uuid,
  academic_year_id uuid, term_id uuid,
  attendance_date date NOT NULL,
  session_kind text NOT NULL DEFAULT 'DAILY',
  status text NOT NULL DEFAULT 'NOT_MARKED',
  status_group text NOT NULL DEFAULT 'NOT_MARKED' CHECK (status_group IN ('PRESENT','ABSENT','EXCUSED','NEUTRAL','NOT_MARKED')),
  scheduled_start time,
  arrival_time time,
  late_minutes integer CHECK (late_minutes IS NULL OR late_minutes >= 0),
  departure_time time,
  early_minutes integer CHECK (early_minutes IS NULL OR early_minutes >= 0),
  early_departure_approval text NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (early_departure_approval IN ('NOT_REQUIRED','PENDING','APPROVED','REJECTED')),
  early_approved_by uuid, early_approved_at timestamptz,
  reason_id uuid REFERENCES elimu_attendance_reasons(id),
  reason_note text,
  marked_by uuid, marked_at timestamptz,
  client_marked_at timestamptz,                                          -- when the teacher tapped it (offline devices)
  source text NOT NULL DEFAULT 'WEB' CHECK (source IN ('WEB','OFFLINE','IMPORT','SYSTEM')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, enrollment_id),
  UNIQUE (session_id, student_id),
  CONSTRAINT elimu_rec_departure_chk CHECK (departure_time IS NULL OR arrival_time IS NULL OR departure_time >= arrival_time),
  CONSTRAINT elimu_rec_notmarked_chk CHECK (status <> 'NOT_MARKED' OR (arrival_time IS NULL AND departure_time IS NULL AND reason_id IS NULL AND marked_by IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_elimu_rec_student ON elimu_attendance_records (tenant_id, student_id, attendance_date DESC);
CREATE INDEX IF NOT EXISTS idx_elimu_rec_date_status ON elimu_attendance_records (tenant_id, attendance_date, status_group);
CREATE INDEX IF NOT EXISTS idx_elimu_rec_class_date ON elimu_attendance_records (tenant_id, class_id, stream_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_elimu_rec_session ON elimu_attendance_records (session_id);
CREATE INDEX IF NOT EXISTS idx_elimu_rec_term ON elimu_attendance_records (tenant_id, term_id, student_id);

CREATE TABLE IF NOT EXISTS elimu_attendance_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES elimu_attendance_sessions(id) ON DELETE RESTRICT,
  record_id uuid NOT NULL REFERENCES elimu_attendance_records(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('AMENDED','EARLY_DEPARTURE_DECISION')),
  previous_value jsonb NOT NULL,
  new_value jsonb NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  amended_by uuid,
  amended_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_elimu_amend_record ON elimu_attendance_amendments (tenant_id, record_id, amended_at DESC);
CREATE INDEX IF NOT EXISTS idx_elimu_amend_session ON elimu_attendance_amendments (session_id);

DROP TRIGGER IF EXISTS trg_elimu_session_upd ON elimu_attendance_sessions;
CREATE TRIGGER trg_elimu_session_upd BEFORE UPDATE ON elimu_attendance_sessions FOR EACH ROW EXECUTE FUNCTION elimu_set_updated_at();
DROP TRIGGER IF EXISTS trg_elimu_rec_upd ON elimu_attendance_records;
CREATE TRIGGER trg_elimu_rec_upd BEFORE UPDATE ON elimu_attendance_records FOR EACH ROW EXECUTE FUNCTION elimu_set_updated_at();

-- ---------- guard: status validity, group, locking ----------
CREATE OR REPLACE FUNCTION elimu_rec_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sess text; v_group text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF auth.role() = 'service_role' AND current_setting('elimu.allow_delete', true) = '1' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Attendance records are history and cannot be deleted.' USING ERRCODE = '42501';
  END IF;
  v_group := elimu_status_group(NEW.tenant_id, NEW.status);
  IF v_group IS NULL THEN RAISE EXCEPTION 'Unknown attendance status "%".', NEW.status USING ERRCODE = '22023'; END IF;
  NEW.status_group := v_group;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id <> OLD.tenant_id OR NEW.session_id <> OLD.session_id OR NEW.enrollment_id <> OLD.enrollment_id OR NEW.student_id <> OLD.student_id
       OR NEW.attendance_date <> OLD.attendance_date OR NEW.class_id <> OLD.class_id OR NEW.stream_id IS DISTINCT FROM OLD.stream_id THEN
      RAISE EXCEPTION 'Who and when an attendance record belongs to cannot be changed.' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT s.status INTO v_sess FROM elimu_attendance_sessions s WHERE s.id = NEW.session_id;
  IF v_sess IS DISTINCT FROM 'DRAFT' AND current_setting('elimu.attendance_amend', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'This attendance has been submitted. Use "Amend" with a reason to change it.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_rec_guard ON elimu_attendance_records;
CREATE TRIGGER trg_elimu_rec_guard BEFORE INSERT OR UPDATE OR DELETE ON elimu_attendance_records FOR EACH ROW EXECUTE FUNCTION elimu_rec_guard();

CREATE OR REPLACE FUNCTION elimu_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Attendance sessions are history and cannot be deleted.' USING ERRCODE = '42501'; END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.session_date <> OLD.session_date OR NEW.class_id <> OLD.class_id OR NEW.stream_id IS DISTINCT FROM OLD.stream_id OR NEW.session_kind <> OLD.session_kind THEN
    RAISE EXCEPTION 'Which class and day a session belongs to cannot be changed.' USING ERRCODE = '42501'; END IF;
  IF OLD.status <> 'DRAFT' AND NEW.status = 'DRAFT' THEN RAISE EXCEPTION 'A submitted session cannot go back to draft.' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_session_guard ON elimu_attendance_sessions;
CREATE TRIGGER trg_elimu_session_guard BEFORE UPDATE OR DELETE ON elimu_attendance_sessions FOR EACH ROW EXECUTE FUNCTION elimu_session_guard();

-- ---------- scope & RLS ----------
-- May the caller see / work on this class (and lesson)?  take_any/view_all = whole school; otherwise only their own classes or lessons.
CREATE OR REPLACE FUNCTION elimu_att_scope_ok(p_class uuid, p_stream uuid, p_subject uuid, p_entry uuid, p_for_write boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT elimu_can('attendance.take_any')
      OR (NOT p_for_write AND elimu_can('attendance.view_all'))
      OR (elimu_can('attendance.take_own') AND (
            elimu_is_allocated(p_class, p_stream, p_subject)
            OR (p_entry IS NOT NULL AND EXISTS (SELECT 1 FROM elimu_timetable_entries e WHERE e.id = p_entry AND e.tenant_id = get_current_tenant_id() AND e.teacher_id = elimu_staff_id()))))
$$;
GRANT EXECUTE ON FUNCTION elimu_att_scope_ok(uuid, uuid, uuid, uuid, boolean) TO authenticated;

ALTER TABLE elimu_attendance_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_session_read ON elimu_attendance_sessions;
CREATE POLICY elimu_session_read ON elimu_attendance_sessions FOR SELECT
  USING (tenant_id = get_current_tenant_id() AND elimu_att_scope_ok(class_id, stream_id, subject_id, timetable_entry_id));
ALTER TABLE elimu_attendance_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_rec_read ON elimu_attendance_records;
CREATE POLICY elimu_rec_read ON elimu_attendance_records FOR SELECT
  USING (tenant_id = get_current_tenant_id() AND EXISTS (SELECT 1 FROM elimu_attendance_sessions s WHERE s.id = session_id));   -- inherits the session's scope
ALTER TABLE elimu_attendance_amendments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_amend_read ON elimu_attendance_amendments;
CREATE POLICY elimu_amend_read ON elimu_attendance_amendments FOR SELECT
  USING (tenant_id = get_current_tenant_id() AND EXISTS (SELECT 1 FROM elimu_attendance_sessions s WHERE s.id = session_id));
-- (no INSERT/UPDATE/DELETE policy on any of the three for staff sessions)

-- ---------- helpers ----------
-- minutes after the scheduled start, never negative
CREATE OR REPLACE FUNCTION elimu_minutes_after(p_start time, p_at time) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT greatest(0, floor(EXTRACT(EPOCH FROM (p_at - p_start)) / 60)::int)
$$;

CREATE OR REPLACE FUNCTION _elimu_refresh_counts(p_session uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE elimu_attendance_sessions s SET
    expected_count = (SELECT count(*) FROM elimu_attendance_records r WHERE r.session_id = s.id),
    marked_count   = (SELECT count(*) FROM elimu_attendance_records r WHERE r.session_id = s.id AND r.status <> 'NOT_MARKED')
  WHERE s.id = p_session
$$;
REVOKE ALL ON FUNCTION _elimu_refresh_counts(uuid) FROM PUBLIC;

-- Pulls the students enrolled on that date from the foundation adapter view and adds any not yet in the session.
CREATE OR REPLACE FUNCTION _elimu_add_roster(p_session elimu_attendance_sessions) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n integer;
BEGIN
  IF to_regclass('public.elimu_v_roster') IS NULL THEN
    RAISE EXCEPTION 'FOUNDATION_NOT_CONNECTED: the student roster view elimu_v_roster does not exist yet (see elimu/INTEGRATION.md).' USING ERRCODE = '55000';
  END IF;
  INSERT INTO elimu_attendance_records (tenant_id, business_id, session_id, enrollment_id, student_id, student_name, admission_number, class_id, stream_id,
                                        academic_year_id, term_id, attendance_date, session_kind, scheduled_start, status)
  SELECT p_session.tenant_id, p_session.business_id, p_session.id, r.enrollment_id, r.student_id, r.student_name, r.admission_number, r.class_id, r.stream_id,
         p_session.academic_year_id, p_session.term_id, p_session.session_date, p_session.session_kind, p_session.scheduled_start, 'NOT_MARKED'
    FROM elimu_v_roster r
   WHERE r.tenant_id = p_session.tenant_id AND r.class_id = p_session.class_id
     AND (p_session.stream_id IS NULL OR r.stream_id = p_session.stream_id)
     AND upper(r.status) = 'ACTIVE'
     AND (r.enrolled_from IS NULL OR r.enrolled_from <= p_session.session_date)
     AND (r.enrolled_to IS NULL OR r.enrolled_to >= p_session.session_date)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM _elimu_refresh_counts(p_session.id);
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION _elimu_add_roster(elimu_attendance_sessions) FROM PUBLIC;

CREATE OR REPLACE FUNCTION _elimu_roster_count(p_tenant uuid, p_class uuid, p_stream uuid, p_date date) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF to_regclass('public.elimu_v_roster') IS NULL THEN
    RAISE EXCEPTION 'FOUNDATION_NOT_CONNECTED: the student roster view elimu_v_roster does not exist yet (see elimu/INTEGRATION.md).' USING ERRCODE = '55000';
  END IF;
  SELECT count(*) INTO n FROM elimu_v_roster r
   WHERE r.tenant_id = p_tenant AND r.class_id = p_class AND (p_stream IS NULL OR r.stream_id = p_stream) AND upper(r.status) = 'ACTIVE'
     AND (r.enrolled_from IS NULL OR r.enrolled_from <= p_date) AND (r.enrolled_to IS NULL OR r.enrolled_to >= p_date);
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION _elimu_roster_count(uuid, uuid, uuid, date) FROM PUBLIC;

-- ---------- open (or re-open) a session ----------
CREATE OR REPLACE FUNCTION elimu_open_attendance_session(
  p_date date, p_class uuid, p_stream uuid DEFAULT NULL, p_kind text DEFAULT 'DAILY', p_entry uuid DEFAULT NULL,
  p_academic_year uuid DEFAULT NULL, p_term uuid DEFAULT NULL, p_class_name text DEFAULT NULL, p_stream_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_t uuid := elimu_tenant(); v_b uuid := elimu_business(); s elimu_attendance_sessions; v_set elimu_attendance_settings := elimu_get_attendance_settings();
  v_e elimu_timetable_entries; v_created boolean := false; v_added integer := 0; v_subject uuid; v_start time; v_end time; v_teacher uuid;
BEGIN
  IF p_kind NOT IN ('DAILY','LESSON') THEN RAISE EXCEPTION 'Unknown session kind.' USING ERRCODE = '22023'; END IF;
  IF p_date > elimu_today() THEN RETURN jsonb_build_object('ok', false, 'reason', 'FUTURE_DATE', 'message', 'Attendance cannot be taken for a future date.'); END IF;
  IF p_kind = 'LESSON' THEN
    IF p_entry IS NULL THEN RAISE EXCEPTION 'A lesson register needs the timetable lesson.' USING ERRCODE = '22023'; END IF;
    SELECT * INTO v_e FROM elimu_timetable_entries WHERE id = p_entry AND tenant_id = v_t;
    IF NOT FOUND OR v_e.status <> 'ACTIVE' THEN RETURN jsonb_build_object('ok', false, 'reason', 'LESSON_NOT_FOUND', 'message', 'That lesson is not on the timetable.'); END IF;
    IF extract(isodow FROM p_date)::int <> v_e.day_of_week OR p_date < coalesce(v_e.valid_from, p_date) OR p_date > coalesce(v_e.valid_to, p_date) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'LESSON_NOT_ON_DATE', 'message', 'That lesson does not take place on this date.'); END IF;
    IF EXISTS (SELECT 1 FROM elimu_timetable_exceptions x WHERE x.entry_id = p_entry AND x.exception_date = p_date AND x.kind = 'CANCELLED') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'LESSON_CANCELLED', 'message', 'That lesson was cancelled on this date.'); END IF;
    v_subject := v_e.subject_id; v_start := v_e.start_time; v_end := v_e.end_time; v_teacher := v_e.teacher_id;
    SELECT x.new_teacher_id INTO v_teacher FROM elimu_timetable_exceptions x WHERE x.entry_id = p_entry AND x.exception_date = p_date AND x.kind = 'TEACHER_CHANGED';
    v_teacher := coalesce(v_teacher, v_e.teacher_id);
    p_class := v_e.class_id; p_stream := v_e.stream_id;
  ELSE
    p_entry := NULL; v_start := v_set.opening_time; v_end := v_set.closing_time;
  END IF;

  IF NOT (elimu_can('attendance.take_any') OR (elimu_can('attendance.take_own') AND
          (elimu_is_allocated(p_class, p_stream, v_subject) OR (p_entry IS NOT NULL AND v_teacher = elimu_staff_id())))) THEN
    RAISE EXCEPTION 'You are not assigned to take attendance for this class.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO s FROM elimu_attendance_sessions WHERE tenant_id = v_t AND session_date = p_date AND class_id = p_class
     AND COALESCE(stream_id, elimu_nil()) = COALESCE(p_stream, elimu_nil()) AND session_kind = p_kind AND COALESCE(timetable_entry_id, elimu_nil()) = COALESCE(p_entry, elimu_nil());
  IF NOT FOUND THEN
    IF _elimu_roster_count(v_t, p_class, p_stream, p_date) = 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'NO_ENROLLED_STUDENTS', 'message', 'No students are enrolled in this class on that date.');
    END IF;
    INSERT INTO elimu_attendance_sessions (tenant_id, business_id, academic_year_id, term_id, session_date, session_kind, class_id, stream_id, class_name, stream_name,
        timetable_entry_id, subject_id, teacher_id, scheduled_start, scheduled_end, opened_by)
    VALUES (v_t, v_b, p_academic_year, p_term, p_date, p_kind, p_class, p_stream, p_class_name, p_stream_name, p_entry, v_subject, v_teacher, v_start, v_end, elimu_staff_id())
    ON CONFLICT (tenant_id, session_date, class_id, (COALESCE(stream_id, elimu_nil())), session_kind, (COALESCE(timetable_entry_id, elimu_nil()))) DO NOTHING
    RETURNING * INTO s;
    IF FOUND THEN
      v_created := true;
      v_added := _elimu_add_roster(s);
      PERFORM elimu_audit('ELIMU_ATTENDANCE_CREATED', 'elimu_attendance_sessions', s.id, NULL,
        jsonb_build_object('date', p_date, 'class_id', p_class, 'stream_id', p_stream, 'kind', p_kind, 'expected', v_added));
    ELSE
      SELECT * INTO s FROM elimu_attendance_sessions WHERE tenant_id = v_t AND session_date = p_date AND class_id = p_class
         AND COALESCE(stream_id, elimu_nil()) = COALESCE(p_stream, elimu_nil()) AND session_kind = p_kind AND COALESCE(timetable_entry_id, elimu_nil()) = COALESCE(p_entry, elimu_nil());
    END IF;
  ELSIF s.status = 'DRAFT' THEN
    v_added := _elimu_add_roster(s);                                  -- students who joined since it was opened
  END IF;
  SELECT * INTO s FROM elimu_attendance_sessions WHERE id = s.id;
  RETURN jsonb_build_object('ok', true, 'created', v_created, 'late_joiners_added', CASE WHEN v_created THEN 0 ELSE v_added END,
                            'session', to_jsonb(s), 'is_school_day', elimu_is_school_day(p_date));
END $$;
GRANT EXECUTE ON FUNCTION elimu_open_attendance_session(date, uuid, uuid, text, uuid, uuid, uuid, text, text) TO authenticated;

-- ---------- internal: may the caller write to this session? ----------
CREATE OR REPLACE FUNCTION _elimu_can_write_session(p_session elimu_attendance_sessions) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_session.tenant_id = get_current_tenant_id() AND elimu_att_scope_ok(p_session.class_id, p_session.stream_id, p_session.subject_id, p_session.timetable_entry_id, true)
$$;
REVOKE ALL ON FUNCTION _elimu_can_write_session(elimu_attendance_sessions) FROM PUBLIC;

-- ---------- save marks (draft) ----------
-- p_marks: [{enrollment_id, status, arrival_time?, departure_time?, reason_id?, reason_note?, marked_at?, base_updated_at?}]
-- base_updated_at = the record's updated_at the device last saw. If someone else changed that record since, it is NOT overwritten:
-- it comes back in `conflicts` so the teacher can decide. Re-sending the same marks is harmless (idempotent).
CREATE OR REPLACE FUNCTION elimu_save_attendance_marks(p_session_id uuid, p_marks jsonb, p_source text DEFAULT 'WEB')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s elimu_attendance_sessions; v_set elimu_attendance_settings := elimu_get_attendance_settings(); m jsonb; rec elimu_attendance_records;
  v_status text; v_arr time; v_dep time; v_late integer; v_early integer; v_appr text; v_saved integer := 0; v_conf jsonb := '[]'::jsonb; v_rej jsonb := '[]'::jsonb;
  v_base timestamptz; v_end time; v_reason uuid; v_me uuid := elimu_staff_id(); v_src text := CASE WHEN p_source = 'OFFLINE' THEN 'OFFLINE' ELSE 'WEB' END;
BEGIN
  SELECT * INTO s FROM elimu_attendance_sessions WHERE id = p_session_id AND tenant_id = elimu_tenant() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That attendance session was not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT _elimu_can_write_session(s) THEN RAISE EXCEPTION 'You are not assigned to take attendance for this class.' USING ERRCODE = '42501'; END IF;
  IF s.status <> 'DRAFT' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'SESSION_LOCKED', 'message', 'This attendance was already submitted. Ask an authorised person to amend it.', 'status', s.status);
  END IF;
  v_end := coalesce(s.scheduled_end, v_set.closing_time);

  FOR m IN SELECT * FROM jsonb_array_elements(coalesce(p_marks, '[]'::jsonb)) LOOP
    SELECT * INTO rec FROM elimu_attendance_records WHERE session_id = s.id AND enrollment_id = (m->>'enrollment_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN v_rej := v_rej || jsonb_build_object('enrollment_id', m->>'enrollment_id', 'reason', 'NOT_IN_SESSION'); CONTINUE; END IF;
    v_status := upper(coalesce(m->>'status', 'NOT_MARKED'));
    IF elimu_status_group(s.tenant_id, v_status) IS NULL THEN v_rej := v_rej || jsonb_build_object('enrollment_id', m->>'enrollment_id', 'reason', 'UNKNOWN_STATUS', 'status', v_status); CONTINUE; END IF;
    v_base := nullif(m->>'base_updated_at', '')::timestamptz;
    IF v_base IS NOT NULL AND rec.updated_at > v_base AND rec.status <> 'NOT_MARKED' AND rec.status <> v_status AND rec.marked_by IS DISTINCT FROM v_me THEN
      v_conf := v_conf || jsonb_build_object('enrollment_id', rec.enrollment_id, 'student_name', rec.student_name, 'server_status', rec.status, 'your_status', v_status, 'server_updated_at', rec.updated_at);
      CONTINUE;
    END IF;

    v_arr := nullif(m->>'arrival_time', '')::time; v_dep := nullif(m->>'departure_time', '')::time; v_late := NULL; v_early := NULL; v_appr := 'NOT_REQUIRED';
    v_reason := nullif(m->>'reason_id', '')::uuid;
    IF v_reason IS NOT NULL AND NOT EXISTS (SELECT 1 FROM elimu_attendance_reasons x WHERE x.id = v_reason AND x.tenant_id = s.tenant_id) THEN
      v_rej := v_rej || jsonb_build_object('enrollment_id', m->>'enrollment_id', 'reason', 'UNKNOWN_REASON'); CONTINUE; END IF;

    IF v_status = 'NOT_MARKED' THEN                                   -- "clear marks"
      v_arr := NULL; v_dep := NULL; v_reason := NULL;
      UPDATE elimu_attendance_records SET status = 'NOT_MARKED', arrival_time = NULL, late_minutes = NULL, departure_time = NULL, early_minutes = NULL,
          early_departure_approval = 'NOT_REQUIRED', early_approved_by = NULL, early_approved_at = NULL, reason_id = NULL, reason_note = NULL,
          marked_by = NULL, marked_at = NULL, client_marked_at = NULL, source = v_src WHERE id = rec.id;
    ELSE
      IF v_status IN ('ABSENT','SICK','EXCUSED','SUSPENDED') THEN v_arr := NULL; v_dep := NULL; END IF;        -- an absent student has no times
      IF v_arr IS NOT NULL AND v_status IN ('PRESENT','LATE') THEN
        v_late := elimu_minutes_after(coalesce(s.scheduled_start, v_set.opening_time), v_arr);
        v_status := CASE WHEN v_late > v_set.grace_minutes THEN 'LATE' ELSE 'PRESENT' END;                     -- the school's grace period decides
        IF v_status = 'PRESENT' THEN v_late := 0; END IF;
      END IF;
      IF v_dep IS NOT NULL THEN
        IF v_dep < v_end THEN
          v_early := floor(EXTRACT(EPOCH FROM (v_end - v_dep)) / 60)::int;
          IF v_status = 'PRESENT' THEN v_status := 'LEFT_EARLY'; END IF;
          v_appr := CASE WHEN v_set.early_departure_requires_approval AND (v_set.early_departure_approval_before IS NULL OR v_dep < v_set.early_departure_approval_before) THEN 'PENDING' ELSE 'NOT_REQUIRED' END;
          IF rec.early_departure_approval IN ('APPROVED','REJECTED') AND rec.departure_time = v_dep THEN v_appr := rec.early_departure_approval; END IF;
        ELSE v_dep := NULL; END IF;
      END IF;
      IF v_status = 'LEFT_EARLY' AND v_dep IS NULL AND rec.departure_time IS NOT NULL THEN v_dep := rec.departure_time; END IF;
      UPDATE elimu_attendance_records SET status = v_status, arrival_time = v_arr, late_minutes = v_late, departure_time = v_dep, early_minutes = v_early,
          early_departure_approval = v_appr,
          early_approved_by = CASE WHEN v_appr IN ('APPROVED','REJECTED') THEN rec.early_approved_by END, early_approved_at = CASE WHEN v_appr IN ('APPROVED','REJECTED') THEN rec.early_approved_at END,
          reason_id = v_reason, reason_note = nullif(btrim(m->>'reason_note'), ''), marked_by = v_me, marked_at = now(),
          client_marked_at = nullif(m->>'marked_at', '')::timestamptz, source = v_src WHERE id = rec.id;
    END IF;
    v_saved := v_saved + 1;
  END LOOP;

  PERFORM _elimu_refresh_counts(s.id);
  UPDATE elimu_attendance_sessions SET version = version + 1 WHERE id = s.id RETURNING * INTO s;
  RETURN jsonb_build_object('ok', true, 'saved', v_saved, 'conflicts', v_conf, 'rejected', v_rej,
                            'expected_count', s.expected_count, 'marked_count', s.marked_count, 'version', s.version);
END $$;
GRANT EXECUTE ON FUNCTION elimu_save_attendance_marks(uuid, jsonb, text) TO authenticated;

-- ---------- submit ----------
-- Unmarked students are NEVER turned into absentees. If some remain unmarked the caller must pass p_confirm_unmarked=true
-- (the screen says "N students stay NOT MARKED - they are not recorded as absent"), unless the school requires a full register.
CREATE OR REPLACE FUNCTION elimu_submit_attendance(p_session_id uuid, p_confirm_unmarked boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s elimu_attendance_sessions; v_set elimu_attendance_settings := elimu_get_attendance_settings(); v_unmarked integer; v_summary jsonb; v_flags jsonb;
BEGIN
  SELECT * INTO s FROM elimu_attendance_sessions WHERE id = p_session_id AND tenant_id = elimu_tenant() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That attendance session was not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT _elimu_can_write_session(s) THEN RAISE EXCEPTION 'You are not assigned to take attendance for this class.' USING ERRCODE = '42501'; END IF;
  IF s.status <> 'DRAFT' THEN RETURN jsonb_build_object('ok', true, 'already_submitted', true, 'status', s.status); END IF;
  SELECT count(*) INTO v_unmarked FROM elimu_attendance_records WHERE session_id = s.id AND status = 'NOT_MARKED';
  IF v_unmarked > 0 AND v_set.require_submit_all_marked THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'UNMARKED_REMAIN', 'unmarked', v_unmarked, 'message', 'This school requires every student to be marked before submitting.');
  END IF;
  IF v_unmarked > 0 AND NOT p_confirm_unmarked THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NEEDS_CONFIRMATION', 'unmarked', v_unmarked,
      'message', format('%s student(s) are not marked. They will stay "Not marked" - they will NOT be recorded as absent.', v_unmarked));
  END IF;
  UPDATE elimu_attendance_sessions SET status = 'SUBMITTED', submitted_by = elimu_staff_id(), submitted_at = now(), submitted_unmarked_count = v_unmarked, version = version + 1
   WHERE id = s.id RETURNING * INTO s;
  -- open an absence case for each absent / sick student (not for NOT_MARKED)
  INSERT INTO elimu_absence_followups (tenant_id, business_id, record_id, session_id, student_id, enrollment_id, absence_date, class_id, stream_id)
  SELECT r.tenant_id, r.business_id, r.id, r.session_id, r.student_id, r.enrollment_id, r.attendance_date, r.class_id, r.stream_id
    FROM elimu_attendance_records r WHERE r.session_id = s.id AND r.status IN ('ABSENT','SICK') AND s.session_kind = 'DAILY'
  ON CONFLICT (record_id) DO NOTHING;
  SELECT jsonb_object_agg(status, n) INTO v_summary FROM (SELECT status, count(*) n FROM elimu_attendance_records WHERE session_id = s.id GROUP BY status) x;
  SELECT jsonb_build_object(
      'absent',     coalesce((SELECT jsonb_agg(r.id) FROM elimu_attendance_records r WHERE r.session_id = s.id AND r.status IN ('ABSENT','SICK')), '[]'::jsonb),
      'late',       coalesce((SELECT jsonb_agg(r.id) FROM elimu_attendance_records r WHERE r.session_id = s.id AND r.status = 'LATE'), '[]'::jsonb),
      'left_early', coalesce((SELECT jsonb_agg(r.id) FROM elimu_attendance_records r WHERE r.session_id = s.id AND (r.status = 'LEFT_EARLY' OR r.early_minutes > 0)), '[]'::jsonb)) INTO v_flags;
  PERFORM elimu_audit('ELIMU_ATTENDANCE_SUBMITTED', 'elimu_attendance_sessions', s.id, NULL,
    jsonb_build_object('summary', v_summary, 'unmarked', v_unmarked, 'late_submission', (s.submitted_at AT TIME ZONE 'Africa/Nairobi')::time > v_set.attendance_deadline AND s.session_kind = 'DAILY'));
  RETURN jsonb_build_object('ok', true, 'status', s.status, 'unmarked', v_unmarked, 'summary', coalesce(v_summary, '{}'::jsonb), 'notify_candidates', v_flags, 'version', s.version);
END $$;
GRANT EXECUTE ON FUNCTION elimu_submit_attendance(uuid, boolean) TO authenticated;

-- ---------- amend a submitted record ----------
-- p_changes: {status?, arrival_time?, departure_time?, reason_id?, reason_note?}
CREATE OR REPLACE FUNCTION elimu_amend_attendance(p_record_id uuid, p_changes jsonb, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s elimu_attendance_sessions; rec elimu_attendance_records; v_set elimu_attendance_settings := elimu_get_attendance_settings();
  v_new_status text; v_reason text := nullif(btrim(p_reason), ''); v_prev jsonb; v_arr time; v_dep time; v_late integer; v_early integer; v_end time;
  v_was_absent boolean; v_now_absent boolean; v_contacted boolean := false; v_status text;
BEGIN
  PERFORM elimu_require('attendance.amend');
  SELECT * INTO rec FROM elimu_attendance_records WHERE id = p_record_id AND tenant_id = elimu_tenant() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That attendance record was not found.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO s FROM elimu_attendance_sessions WHERE id = rec.session_id FOR UPDATE;
  IF s.status = 'DRAFT' THEN RAISE EXCEPTION 'This attendance has not been submitted yet. Change it directly and submit.' USING ERRCODE = '22023'; END IF;
  IF v_set.amendment_requires_reason AND v_reason IS NULL THEN RAISE EXCEPTION 'Give a reason for the correction.' USING ERRCODE = '22023'; END IF;
  IF v_reason IS NULL THEN v_reason := 'Correction'; END IF;
  IF v_set.amendment_window_days IS NOT NULL AND rec.attendance_date < elimu_today() - v_set.amendment_window_days AND NOT elimu_can('settings.manage') THEN
    RAISE EXCEPTION 'This attendance is older than % days. Only the principal or administrator can correct it.', v_set.amendment_window_days USING ERRCODE = '42501';
  END IF;

  v_status := upper(coalesce(p_changes->>'status', rec.status));
  IF v_status = 'NOT_MARKED' THEN RAISE EXCEPTION 'A submitted record cannot be set back to Not marked.' USING ERRCODE = '22023'; END IF;
  IF elimu_status_group(rec.tenant_id, v_status) IS NULL THEN RAISE EXCEPTION 'Unknown attendance status.' USING ERRCODE = '22023'; END IF;
  v_arr := CASE WHEN p_changes ? 'arrival_time' THEN nullif(p_changes->>'arrival_time','')::time ELSE rec.arrival_time END;
  v_dep := CASE WHEN p_changes ? 'departure_time' THEN nullif(p_changes->>'departure_time','')::time ELSE rec.departure_time END;
  IF v_status IN ('ABSENT','SICK','EXCUSED','SUSPENDED') THEN v_arr := NULL; v_dep := NULL; END IF;
  v_end := coalesce(s.scheduled_end, v_set.closing_time);
  v_late := NULL; v_early := NULL;
  IF v_arr IS NOT NULL AND v_status IN ('PRESENT','LATE') THEN
    v_late := elimu_minutes_after(coalesce(s.scheduled_start, v_set.opening_time), v_arr);
    v_status := CASE WHEN v_late > v_set.grace_minutes THEN 'LATE' ELSE 'PRESENT' END; IF v_status = 'PRESENT' THEN v_late := 0; END IF;
  END IF;
  IF v_dep IS NOT NULL AND v_dep < v_end THEN v_early := floor(EXTRACT(EPOCH FROM (v_end - v_dep)) / 60)::int; END IF;

  v_prev := jsonb_build_object('status', rec.status, 'arrival_time', rec.arrival_time, 'late_minutes', rec.late_minutes, 'departure_time', rec.departure_time,
                               'reason_id', rec.reason_id, 'reason_note', rec.reason_note);
  v_was_absent := rec.status IN ('ABSENT','SICK');
  PERFORM set_config('elimu.attendance_amend', '1', true);
  UPDATE elimu_attendance_records SET status = v_status, arrival_time = v_arr, late_minutes = v_late, departure_time = v_dep, early_minutes = v_early,
      early_departure_approval = CASE WHEN v_dep IS NULL THEN 'NOT_REQUIRED' ELSE early_departure_approval END,
      reason_id = CASE WHEN p_changes ? 'reason_id' THEN nullif(p_changes->>'reason_id','')::uuid ELSE reason_id END,
      reason_note = CASE WHEN p_changes ? 'reason_note' THEN nullif(btrim(p_changes->>'reason_note'),'') ELSE reason_note END,
      marked_by = elimu_staff_id(), marked_at = now()
   WHERE id = rec.id RETURNING * INTO rec;
  v_now_absent := rec.status IN ('ABSENT','SICK');
  INSERT INTO elimu_attendance_amendments (tenant_id, session_id, record_id, kind, previous_value, new_value, reason, amended_by)
  VALUES (rec.tenant_id, rec.session_id, rec.id, 'AMENDED', v_prev,
          jsonb_build_object('status', rec.status, 'arrival_time', rec.arrival_time, 'late_minutes', rec.late_minutes, 'departure_time', rec.departure_time, 'reason_id', rec.reason_id, 'reason_note', rec.reason_note),
          v_reason, elimu_staff_id());
  UPDATE elimu_attendance_sessions SET status = 'AMENDED', last_amended_by = elimu_staff_id(), last_amended_at = now(), amendment_count = amendment_count + 1, version = version + 1 WHERE id = s.id;
  PERFORM _elimu_refresh_counts(s.id);
  PERFORM elimu_audit('ELIMU_ATTENDANCE_AMENDED', 'elimu_attendance_records', rec.id, v_prev, jsonb_build_object('status', rec.status, 'arrival_time', rec.arrival_time, 'departure_time', rec.departure_time), v_reason);
  IF (v_prev->>'reason_id') IS DISTINCT FROM rec.reason_id::text OR (v_prev->>'reason_note') IS DISTINCT FROM rec.reason_note THEN
    PERFORM elimu_audit('ELIMU_ABSENCE_REASON_CHANGED', 'elimu_attendance_records', rec.id,
      jsonb_build_object('reason_id', v_prev->'reason_id', 'reason_note', v_prev->'reason_note'), jsonb_build_object('reason_id', rec.reason_id, 'reason_note', rec.reason_note), v_reason);
  END IF;
  -- follow-up bookkeeping: a corrected absence closes its case; a new absence opens one
  IF v_now_absent AND s.session_kind = 'DAILY' THEN
    INSERT INTO elimu_absence_followups (tenant_id, business_id, record_id, session_id, student_id, enrollment_id, absence_date, class_id, stream_id)
    VALUES (rec.tenant_id, rec.business_id, rec.id, rec.session_id, rec.student_id, rec.enrollment_id, rec.attendance_date, rec.class_id, rec.stream_id) ON CONFLICT (record_id) DO NOTHING;
  ELSIF v_was_absent AND NOT v_now_absent THEN
    SELECT guardian_contacted INTO v_contacted FROM elimu_absence_followups WHERE record_id = rec.id;
    UPDATE elimu_absence_followups SET status = 'CLOSED', closed_reason = 'CORRECTED', closed_at = now(), closed_by = elimu_staff_id() WHERE record_id = rec.id AND status <> 'CLOSED';
  END IF;
  RETURN jsonb_build_object('ok', true, 'record', to_jsonb(rec), 'correction_notice_suggested', coalesce(v_contacted, false) AND v_was_absent AND NOT v_now_absent);
END $$;
GRANT EXECUTE ON FUNCTION elimu_amend_attendance(uuid, jsonb, text) TO authenticated;

-- ---------- approve / reject an early departure ----------
CREATE OR REPLACE FUNCTION elimu_decide_early_departure(p_record_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rec elimu_attendance_records; v_prev text;
BEGIN
  PERFORM elimu_require('absence.approve');
  SELECT * INTO rec FROM elimu_attendance_records WHERE id = p_record_id AND tenant_id = elimu_tenant() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That attendance record was not found.' USING ERRCODE = 'P0002'; END IF;
  IF rec.departure_time IS NULL OR rec.early_minutes IS NULL OR rec.early_minutes = 0 THEN RAISE EXCEPTION 'This record has no early departure.' USING ERRCODE = '22023'; END IF;
  v_prev := rec.early_departure_approval;
  PERFORM set_config('elimu.attendance_amend', '1', true);
  UPDATE elimu_attendance_records SET early_departure_approval = CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END, early_approved_by = elimu_staff_id(), early_approved_at = now(),
         reason_note = coalesce(nullif(btrim(p_note),''), reason_note) WHERE id = rec.id RETURNING * INTO rec;
  INSERT INTO elimu_attendance_amendments (tenant_id, session_id, record_id, kind, previous_value, new_value, reason, amended_by)
  VALUES (rec.tenant_id, rec.session_id, rec.id, 'EARLY_DEPARTURE_DECISION', jsonb_build_object('approval', v_prev), jsonb_build_object('approval', rec.early_departure_approval), coalesce(nullif(btrim(p_note),''), 'Decision'), elimu_staff_id());
  PERFORM elimu_audit('ELIMU_EARLY_DEPARTURE_DECIDED', 'elimu_attendance_records', rec.id, jsonb_build_object('approval', v_prev), jsonb_build_object('approval', rec.early_departure_approval), p_note);
  RETURN jsonb_build_object('ok', true, 'approval', rec.early_departure_approval);
END $$;
GRANT EXECUTE ON FUNCTION elimu_decide_early_departure(uuid, boolean, text) TO authenticated;

-- ---------- completion state (one definition, used by every screen) ----------
CREATE OR REPLACE VIEW elimu_v_attendance_sessions WITH (security_invoker = true) AS
  SELECT s.*,
         CASE WHEN s.status = 'AMENDED' THEN 'AMENDED'
              WHEN s.status = 'SUBMITTED' THEN 'SUBMITTED'
              WHEN s.marked_count = 0 THEN 'NOT_STARTED'
              WHEN s.marked_count < s.expected_count THEN 'PARTIAL'
              ELSE 'COMPLETE' END AS completion_state
    FROM elimu_attendance_sessions s;
GRANT SELECT ON elimu_v_attendance_sessions TO authenticated;
