-- ============================================================
-- ELIMU 008 -- daily dashboard, repeated absences, reports
-- Run AFTER 007. Safe to re-run.
--
-- * Everything is bounded by date range / class / pagination: nothing loads a school's whole history.
-- * Report functions are SECURITY INVOKER, so Row Level Security decides what each teacher may see (own classes only).
-- * The overview functions are SECURITY DEFINER because they read the foundation's class list; they apply the same scope
--   check themselves (elimu_att_scope_ok) and the tenant filter.
-- * PERCENTAGE RULE (one definition, used everywhere):
--     attendance % = (PRESENT-group [+ EXCUSED-group if the school ticks "excused counts as present"])
--                    / (PRESENT + ABSENT + EXCUSED groups)  of DAILY records.
--     NOT_MARKED and SUSPENDED (NEUTRAL) are left out of the base: an unmarked student is never counted as absent.
-- ============================================================

-- ---------- one row per class/stream for one day ----------
CREATE OR REPLACE FUNCTION elimu_daily_overview(p_date date, p_year uuid DEFAULT NULL, p_term uuid DEFAULT NULL, p_class uuid DEFAULT NULL, p_stream uuid DEFAULT NULL)
RETURNS TABLE (class_id uuid, class_name text, stream_id uuid, stream_name text, session_id uuid, session_status text, completion_state text,
               enrolled integer, expected integer, marked integer, present integer, absent integer, late integer, excused integer, left_early integer, not_marked integer, neutral integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t uuid := elimu_tenant();
BEGIN
  IF NOT (elimu_can('attendance.view_all') OR elimu_can('attendance.take_own')) THEN RAISE EXCEPTION 'You do not have permission to do that (attendance).' USING ERRCODE = '42501'; END IF;
  IF to_regclass('public.elimu_v_class_streams') IS NULL OR to_regclass('public.elimu_v_roster') IS NULL THEN
    RAISE EXCEPTION 'FOUNDATION_NOT_CONNECTED: elimu_v_class_streams / elimu_v_roster are missing (see elimu/INTEGRATION.md).' USING ERRCODE = '55000';
  END IF;
  RETURN QUERY
  WITH cs AS (
    SELECT c.class_id, c.class_name, c.stream_id, c.stream_name, c.sort_order FROM elimu_v_class_streams c
     WHERE c.tenant_id = v_t AND (p_year IS NULL OR c.academic_year_id = p_year) AND (p_class IS NULL OR c.class_id = p_class) AND (p_stream IS NULL OR c.stream_id = p_stream)
       AND elimu_att_scope_ok(c.class_id, c.stream_id, NULL, NULL)),
  ros AS (
    SELECT r.class_id, r.stream_id, count(*)::int AS n FROM elimu_v_roster r
     WHERE r.tenant_id = v_t AND upper(r.status) = 'ACTIVE' AND (r.enrolled_from IS NULL OR r.enrolled_from <= p_date) AND (r.enrolled_to IS NULL OR r.enrolled_to >= p_date)
     GROUP BY r.class_id, r.stream_id),
  ses AS (
    SELECT s.* FROM elimu_attendance_sessions s
     WHERE s.tenant_id = v_t AND s.session_date = p_date AND s.session_kind = 'DAILY' AND (p_term IS NULL OR s.term_id = p_term)),
  cnt AS (
    SELECT r.session_id,
           count(*) FILTER (WHERE r.status = 'PRESENT')::int AS present, count(*) FILTER (WHERE r.status_group = 'ABSENT')::int AS absent,
           count(*) FILTER (WHERE r.status = 'LATE')::int AS late, count(*) FILTER (WHERE r.status_group = 'EXCUSED')::int AS excused,
           count(*) FILTER (WHERE r.status = 'LEFT_EARLY' OR r.early_minutes > 0)::int AS left_early,
           count(*) FILTER (WHERE r.status = 'NOT_MARKED')::int AS not_marked, count(*) FILTER (WHERE r.status_group = 'NEUTRAL')::int AS neutral
      FROM elimu_attendance_records r WHERE r.tenant_id = v_t AND r.attendance_date = p_date AND r.session_kind = 'DAILY' GROUP BY r.session_id)
  SELECT cs.class_id, cs.class_name, cs.stream_id, cs.stream_name, s.id, s.status,
         CASE WHEN s.id IS NULL THEN 'NOT_TAKEN' WHEN s.status = 'AMENDED' THEN 'AMENDED' WHEN s.status = 'SUBMITTED' THEN 'SUBMITTED'
              WHEN s.marked_count = 0 THEN 'NOT_STARTED' WHEN s.marked_count < s.expected_count THEN 'PARTIAL' ELSE 'COMPLETE' END,
         coalesce(ros.n, 0), coalesce(s.expected_count, 0), coalesce(s.marked_count, 0),
         coalesce(cnt.present, 0), coalesce(cnt.absent, 0), coalesce(cnt.late, 0), coalesce(cnt.excused, 0), coalesce(cnt.left_early, 0),
         CASE WHEN s.id IS NULL THEN coalesce(ros.n, 0) ELSE coalesce(cnt.not_marked, 0) END, coalesce(cnt.neutral, 0)
    FROM cs
    LEFT JOIN ses s ON s.class_id = cs.class_id AND COALESCE(s.stream_id, elimu_nil()) = COALESCE(cs.stream_id, elimu_nil())
    LEFT JOIN cnt ON cnt.session_id = s.id
    LEFT JOIN ros ON ros.class_id = cs.class_id AND COALESCE(ros.stream_id, elimu_nil()) = COALESCE(cs.stream_id, elimu_nil())
   ORDER BY cs.sort_order NULLS LAST, cs.class_name, cs.stream_name NULLS FIRST;
END $$;
GRANT EXECUTE ON FUNCTION elimu_daily_overview(date, uuid, uuid, uuid, uuid) TO authenticated;

-- ---------- the dashboard's headline numbers ----------
CREATE OR REPLACE FUNCTION elimu_daily_summary(p_date date, p_year uuid DEFAULT NULL, p_term uuid DEFAULT NULL, p_class uuid DEFAULT NULL, p_stream uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE o jsonb; v_units integer; v_done integer; v_open integer; v_rep integer; v_set elimu_attendance_settings := elimu_get_attendance_settings();
BEGIN
  SELECT jsonb_build_object(
      'total_enrolled', coalesce(sum(enrolled), 0), 'present', coalesce(sum(present), 0), 'absent', coalesce(sum(absent), 0), 'late', coalesce(sum(late), 0),
      'excused', coalesce(sum(excused), 0), 'left_early', coalesce(sum(left_early), 0), 'not_marked', coalesce(sum(not_marked), 0),
      'classes_total', count(*), 'classes_submitted', count(*) FILTER (WHERE completion_state IN ('SUBMITTED','AMENDED')),
      'classes_not_taken', count(*) FILTER (WHERE completion_state = 'NOT_TAKEN'),
      'classes_incomplete', count(*) FILTER (WHERE completion_state IN ('NOT_TAKEN','NOT_STARTED','PARTIAL','COMPLETE')),
      'incomplete_list', coalesce(jsonb_agg(jsonb_build_object('class_id', class_id, 'class_name', class_name, 'stream_id', stream_id, 'stream_name', stream_name,
                                'state', completion_state, 'marked', marked, 'expected', expected, 'enrolled', enrolled, 'session_id', session_id))
                                FILTER (WHERE completion_state IN ('NOT_TAKEN','NOT_STARTED','PARTIAL','COMPLETE')), '[]'::jsonb))
    INTO o FROM elimu_daily_overview(p_date, p_year, p_term, p_class, p_stream);
  v_units := (o->>'classes_total')::int; v_done := (o->>'classes_submitted')::int;
  SELECT count(*) INTO v_open FROM elimu_absence_followups f
   WHERE f.tenant_id = elimu_tenant() AND f.status IN ('OPEN','IN_PROGRESS') AND f.absence_date <= p_date
     AND (p_class IS NULL OR f.class_id = p_class) AND (p_stream IS NULL OR f.stream_id = p_stream) AND elimu_att_scope_ok(f.class_id, f.stream_id, NULL, NULL);
  SELECT count(*) INTO v_rep FROM elimu_repeated_absences(p_date, p_class, p_stream, 500);
  RETURN o || jsonb_build_object('completion_pct', CASE WHEN v_units = 0 THEN 0 ELSE round(100.0 * v_done / v_units, 1) END,
                                 'unresolved_absence_cases', v_open, 'repeated_absence_students', v_rep, 'attendance_deadline', v_set.attendance_deadline, 'date', p_date);
END $$;
GRANT EXECUTE ON FUNCTION elimu_daily_summary(date, uuid, uuid, uuid, uuid) TO authenticated;

-- ---------- repeated absences ----------
-- A student appears when EITHER the current run of consecutive absent school days reaches the school's threshold, OR their absences
-- inside the look-back window reach the school's count. Only days attendance was actually taken count; unmarked days are skipped, not absent.
CREATE OR REPLACE FUNCTION elimu_repeated_absences(p_as_of date, p_class uuid DEFAULT NULL, p_stream uuid DEFAULT NULL, p_limit integer DEFAULT 200)
RETURNS TABLE (student_id uuid, student_name text, admission_number text, class_id uuid, stream_id uuid, consecutive_absent_days integer, absences_in_window integer, last_absent_date date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_set elimu_attendance_settings := elimu_get_attendance_settings(); v_t uuid := elimu_tenant();
BEGIN
  IF NOT (elimu_can('attendance.view_all') OR elimu_can('attendance.take_own')) THEN RAISE EXCEPTION 'You do not have permission to do that (attendance).' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH r AS (
    SELECT rr.student_id, rr.student_name, rr.admission_number, rr.class_id, rr.stream_id, rr.attendance_date, (rr.status_group = 'ABSENT') AS is_abs
      FROM elimu_attendance_records rr
     WHERE rr.tenant_id = v_t AND rr.session_kind = 'DAILY' AND rr.status_group IN ('PRESENT','ABSENT','EXCUSED')
       AND rr.attendance_date BETWEEN p_as_of - v_set.repeated_absence_window_days AND p_as_of
       AND (p_class IS NULL OR rr.class_id = p_class) AND (p_stream IS NULL OR rr.stream_id = p_stream)
       AND elimu_att_scope_ok(rr.class_id, rr.stream_id, NULL, NULL)),
  g AS (SELECT r.*, row_number() OVER (PARTITION BY r.student_id ORDER BY r.attendance_date) - row_number() OVER (PARTITION BY r.student_id, r.is_abs ORDER BY r.attendance_date) AS grp FROM r),
  runs AS (SELECT g.student_id, g.is_abs, g.grp, count(*)::int AS len, max(g.attendance_date) AS last_d FROM g GROUP BY g.student_id, g.is_abs, g.grp),
  latest AS (SELECT g.student_id, max(g.attendance_date) AS d FROM g GROUP BY g.student_id),
  cur AS (SELECT runs.student_id, runs.len FROM runs JOIN latest l ON l.student_id = runs.student_id AND l.d = runs.last_d WHERE runs.is_abs),
  tot AS (SELECT g.student_id, count(*) FILTER (WHERE g.is_abs)::int AS n, max(g.attendance_date) FILTER (WHERE g.is_abs) AS last_abs FROM g GROUP BY g.student_id),
  who AS (SELECT DISTINCT ON (g.student_id) g.student_id, g.student_name, g.admission_number, g.class_id, g.stream_id FROM g ORDER BY g.student_id, g.attendance_date DESC)
  SELECT who.student_id, who.student_name, who.admission_number, who.class_id, who.stream_id, coalesce(cur.len, 0), tot.n, tot.last_abs
    FROM who JOIN tot ON tot.student_id = who.student_id LEFT JOIN cur ON cur.student_id = who.student_id
   WHERE coalesce(cur.len, 0) >= v_set.repeated_absence_threshold OR tot.n >= v_set.repeated_absence_count
   ORDER BY coalesce(cur.len, 0) DESC, tot.n DESC, who.student_name
   LIMIT greatest(1, least(p_limit, 1000));
END $$;
GRANT EXECUTE ON FUNCTION elimu_repeated_absences(date, uuid, uuid, integer) TO authenticated;

-- ---------- reports (SECURITY INVOKER: RLS decides what the caller sees) ----------
-- Register / absentee / late / early-departure / student history, depending on the filters. Paged.
CREATE OR REPLACE FUNCTION elimu_report_records(
  p_from date, p_to date, p_class uuid DEFAULT NULL, p_stream uuid DEFAULT NULL, p_term uuid DEFAULT NULL, p_student uuid DEFAULT NULL,
  p_status_group text DEFAULT NULL, p_statuses text[] DEFAULT NULL, p_kind text DEFAULT 'DAILY', p_early_only boolean DEFAULT false,
  p_limit integer DEFAULT 500, p_offset integer DEFAULT 0)
RETURNS TABLE (record_id uuid, attendance_date date, student_id uuid, student_name text, admission_number text, class_id uuid, class_name text, stream_id uuid, stream_name text,
               status text, status_group text, scheduled_start time, arrival_time time, late_minutes integer, departure_time time, early_minutes integer,
               early_departure_approval text, reason_label text, reason_category text, reason_note text, session_status text, total_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT r.id, r.attendance_date, r.student_id, r.student_name, r.admission_number, r.class_id, s.class_name, r.stream_id, s.stream_name,
         r.status, r.status_group, r.scheduled_start, r.arrival_time, r.late_minutes, r.departure_time, r.early_minutes, r.early_departure_approval,
         x.label, x.category, r.reason_note, s.status, count(*) OVER ()
    FROM elimu_attendance_records r
    JOIN elimu_attendance_sessions s ON s.id = r.session_id
    LEFT JOIN elimu_attendance_reasons x ON x.id = r.reason_id
   WHERE r.tenant_id = get_current_tenant_id() AND r.attendance_date BETWEEN p_from AND p_to
     AND (p_kind IS NULL OR r.session_kind = p_kind)
     AND (p_class IS NULL OR r.class_id = p_class) AND (p_stream IS NULL OR r.stream_id = p_stream) AND (p_term IS NULL OR r.term_id = p_term)
     AND (p_student IS NULL OR r.student_id = p_student)
     AND (p_status_group IS NULL OR r.status_group = p_status_group) AND (p_statuses IS NULL OR r.status = ANY (p_statuses))
     AND (NOT p_early_only OR r.early_minutes > 0)
   ORDER BY r.attendance_date DESC, s.class_name, s.stream_name, r.student_name
   LIMIT greatest(1, least(p_limit, 2000)) OFFSET greatest(0, p_offset)
$$;
GRANT EXECUTE ON FUNCTION elimu_report_records(date, date, uuid, uuid, uuid, uuid, text, text[], text, boolean, integer, integer) TO authenticated;

-- Attendance % per student over a period (class attendance register totals, student %).
CREATE OR REPLACE FUNCTION elimu_report_student_percentages(p_from date, p_to date, p_class uuid DEFAULT NULL, p_stream uuid DEFAULT NULL, p_term uuid DEFAULT NULL, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0)
RETURNS TABLE (student_id uuid, student_name text, admission_number text, class_id uuid, stream_id uuid, days_marked integer, present integer, late integer, absent integer, excused integer, not_marked integer, attendance_pct numeric, total_count bigint)
LANGUAGE sql STABLE AS $$
  WITH s AS (SELECT excused_counts_as_present AS ex FROM elimu_get_attendance_settings()),
  base AS (
    SELECT r.student_id, (array_agg(r.student_name ORDER BY r.attendance_date DESC))[1] AS student_name, (array_agg(r.admission_number ORDER BY r.attendance_date DESC))[1] AS admission_number,
           (array_agg(r.class_id ORDER BY r.attendance_date DESC))[1] AS class_id, (array_agg(r.stream_id ORDER BY r.attendance_date DESC))[1] AS stream_id,
           count(*) FILTER (WHERE r.status_group IN ('PRESENT','ABSENT','EXCUSED'))::int AS days_marked,
           count(*) FILTER (WHERE r.status_group = 'PRESENT')::int AS present, count(*) FILTER (WHERE r.status = 'LATE')::int AS late,
           count(*) FILTER (WHERE r.status_group = 'ABSENT')::int AS absent, count(*) FILTER (WHERE r.status_group = 'EXCUSED')::int AS excused,
           count(*) FILTER (WHERE r.status = 'NOT_MARKED')::int AS not_marked
      FROM elimu_attendance_records r
     WHERE r.tenant_id = get_current_tenant_id() AND r.session_kind = 'DAILY' AND r.attendance_date BETWEEN p_from AND p_to
       AND (p_class IS NULL OR r.class_id = p_class) AND (p_stream IS NULL OR r.stream_id = p_stream) AND (p_term IS NULL OR r.term_id = p_term)
     GROUP BY r.student_id)
  SELECT b.student_id, b.student_name, b.admission_number, b.class_id, b.stream_id, b.days_marked, b.present, b.late, b.absent, b.excused, b.not_marked,
         CASE WHEN b.days_marked = 0 THEN NULL ELSE round(100.0 * (b.present + CASE WHEN s.ex THEN b.excused ELSE 0 END) / b.days_marked, 1) END, count(*) OVER ()
    FROM base b, s ORDER BY b.student_name LIMIT greatest(1, least(p_limit, 2000)) OFFSET greatest(0, p_offset)
$$;
GRANT EXECUTE ON FUNCTION elimu_report_student_percentages(date, date, uuid, uuid, uuid, integer, integer) TO authenticated;

-- Attendance % per class/stream. A student who moved class is counted in the class they were in ON EACH DAY (snapshot columns).
CREATE OR REPLACE FUNCTION elimu_report_class_percentages(p_from date, p_to date, p_term uuid DEFAULT NULL)
RETURNS TABLE (class_id uuid, class_name text, stream_id uuid, stream_name text, school_days integer, student_days integer, present integer, absent integer, excused integer, attendance_pct numeric)
LANGUAGE sql STABLE AS $$
  WITH s AS (SELECT excused_counts_as_present AS ex FROM elimu_get_attendance_settings())
  SELECT r.class_id, max(x.class_name), r.stream_id, max(x.stream_name), count(DISTINCT r.attendance_date)::int,
         count(*) FILTER (WHERE r.status_group IN ('PRESENT','ABSENT','EXCUSED'))::int,
         count(*) FILTER (WHERE r.status_group = 'PRESENT')::int, count(*) FILTER (WHERE r.status_group = 'ABSENT')::int, count(*) FILTER (WHERE r.status_group = 'EXCUSED')::int,
         CASE WHEN count(*) FILTER (WHERE r.status_group IN ('PRESENT','ABSENT','EXCUSED')) = 0 THEN NULL
              ELSE round(100.0 * (count(*) FILTER (WHERE r.status_group = 'PRESENT') + CASE WHEN (SELECT ex FROM s) THEN count(*) FILTER (WHERE r.status_group = 'EXCUSED') ELSE 0 END)
                         / count(*) FILTER (WHERE r.status_group IN ('PRESENT','ABSENT','EXCUSED')), 1) END
    FROM elimu_attendance_records r JOIN elimu_attendance_sessions x ON x.id = r.session_id
   WHERE r.tenant_id = get_current_tenant_id() AND r.session_kind = 'DAILY' AND r.attendance_date BETWEEN p_from AND p_to AND (p_term IS NULL OR r.term_id = p_term)
   GROUP BY r.class_id, r.stream_id ORDER BY max(x.class_name), max(x.stream_name)
$$;
GRANT EXECUTE ON FUNCTION elimu_report_class_percentages(date, date, uuid) TO authenticated;

-- Month-by-month totals (monthly summary) and a term summary is the same function with the term's date range.
CREATE OR REPLACE FUNCTION elimu_report_monthly_summary(p_from date, p_to date, p_class uuid DEFAULT NULL, p_stream uuid DEFAULT NULL, p_term uuid DEFAULT NULL)
RETURNS TABLE (month date, school_days integer, present integer, late integer, absent integer, excused integer, not_marked integer, attendance_pct numeric)
LANGUAGE sql STABLE AS $$
  WITH s AS (SELECT excused_counts_as_present AS ex FROM elimu_get_attendance_settings())
  SELECT date_trunc('month', r.attendance_date)::date, count(DISTINCT r.attendance_date)::int,
         count(*) FILTER (WHERE r.status_group = 'PRESENT')::int, count(*) FILTER (WHERE r.status = 'LATE')::int,
         count(*) FILTER (WHERE r.status_group = 'ABSENT')::int, count(*) FILTER (WHERE r.status_group = 'EXCUSED')::int, count(*) FILTER (WHERE r.status = 'NOT_MARKED')::int,
         CASE WHEN count(*) FILTER (WHERE r.status_group IN ('PRESENT','ABSENT','EXCUSED')) = 0 THEN NULL
              ELSE round(100.0 * (count(*) FILTER (WHERE r.status_group = 'PRESENT') + CASE WHEN (SELECT ex FROM s) THEN count(*) FILTER (WHERE r.status_group = 'EXCUSED') ELSE 0 END)
                         / count(*) FILTER (WHERE r.status_group IN ('PRESENT','ABSENT','EXCUSED')), 1) END
    FROM elimu_attendance_records r
   WHERE r.tenant_id = get_current_tenant_id() AND r.session_kind = 'DAILY' AND r.attendance_date BETWEEN p_from AND p_to
     AND (p_class IS NULL OR r.class_id = p_class) AND (p_stream IS NULL OR r.stream_id = p_stream) AND (p_term IS NULL OR r.term_id = p_term)
   GROUP BY 1 ORDER BY 1
$$;
GRANT EXECUTE ON FUNCTION elimu_report_monthly_summary(date, date, uuid, uuid, uuid) TO authenticated;

-- Reports "generated" are audited (called when someone prints / exports).
CREATE OR REPLACE FUNCTION elimu_log_report_generated(p_report text, p_filters jsonb DEFAULT '{}'::jsonb, p_format text DEFAULT 'SCREEN')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM elimu_require('reports.view');
  PERFORM elimu_audit('ELIMU_ATTENDANCE_REPORT_GENERATED', 'elimu_report', NULL, NULL, jsonb_build_object('report', p_report, 'filters', p_filters, 'format', p_format));
END $$;
GRANT EXECUTE ON FUNCTION elimu_log_report_generated(text, jsonb, text) TO authenticated;
