-- ============================================================
-- ELIMU Exams — 31 ASSESSMENT & MARK-ENTRY FUNCTIONS (RPCs). Run after 30_exams.sql. Re-runnable.
-- SECURITY DEFINER + explicit permission and teacher-scope checks. Marks are NEVER written any other way.
-- ============================================================

CREATE OR REPLACE FUNCTION elimu_nilu() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT '00000000-0000-0000-0000-000000000000'::uuid $$;

-- ---------------------------------------------------------------- weights
-- For each stream of the class (or the class as a whole) the weights that count must add up to 100 (within the school's tolerance).
CREATE OR REPLACE FUNCTION elimu_check_weights(p_year uuid, p_term uuid, p_class uuid, p_subject uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id(); tol numeric; res jsonb := '[]'; s record; total numeric;
BEGIN
  IF NOT elimu_any_role() THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  SELECT coalesce((SELECT weight_tolerance FROM elimu_academic_settings WHERE tenant_id = t), 0.01) INTO tol;
  -- views: the class-wide view (assessments with no stream) plus one per stream that has its own assessments or exists in the class
  FOR s IN SELECT NULL::uuid AS stream_id, 'Whole class'::text AS stream_name
           UNION ALL SELECT st.id, st.name FROM elimu_ref_streams st WHERE st.tenant_id = t AND st.class_id = p_class LOOP
    SELECT coalesce(sum(weight), 0) INTO total FROM elimu_assessments
     WHERE tenant_id = t AND academic_year_id = p_year AND term_id = p_term AND class_id = p_class AND subject_id = p_subject AND status <> 'CANCELLED'
       AND (stream_id IS NULL OR stream_id = s.stream_id);
    -- the "whole class" row counts only class-wide assessments
    IF s.stream_id IS NULL THEN
      SELECT coalesce(sum(weight), 0) INTO total FROM elimu_assessments
       WHERE tenant_id = t AND academic_year_id = p_year AND term_id = p_term AND class_id = p_class AND subject_id = p_subject AND status <> 'CANCELLED' AND stream_id IS NULL;
    END IF;
    res := res || jsonb_build_object('stream_id', s.stream_id, 'stream_name', s.stream_name, 'total_weight', total, 'ok', abs(total - 100) <= tol,
             'remaining', 100 - total);
  END LOOP;
  RETURN res;
END $$;

-- ---------------------------------------------------------------- assessments
CREATE OR REPLACE FUNCTION elimu_create_assessment(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id(); v_year uuid := (p->>'academic_year_id')::uuid; v_term uuid := (p->>'term_id')::uuid; v_class uuid := (p->>'class_id')::uuid;
  v_stream uuid := nullif(p->>'stream_id','')::uuid; v_subject uuid := (p->>'subject_id')::uuid; v_type uuid := (p->>'assessment_type_id')::uuid;
  ty elimu_assessment_types; v_max numeric; v_weight numeric; v_id uuid; v_status text; w jsonb;
BEGIN
  IF NOT elimu_can('assessment.create') THEN RAISE EXCEPTION 'You do not have permission to create assessments.' USING ERRCODE = '42501'; END IF;
  IF NOT (elimu_can('marks.manage_all') OR elimu_teacher_covers(v_year, v_term, v_class, v_stream, v_subject, true)) THEN
    RAISE EXCEPTION 'You can only create assessments for subjects and classes assigned to you.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO ty FROM elimu_assessment_types WHERE id = v_type AND tenant_id = t;
  IF ty.id IS NULL THEN RAISE EXCEPTION 'Unknown assessment type.' USING ERRCODE = '23503'; END IF;
  v_max := coalesce(nullif(p->>'max_marks','')::numeric, ty.default_max_marks);
  v_weight := coalesce(nullif(p->>'weight','')::numeric, ty.default_weight);
  IF v_max IS NULL OR v_max <= 0 THEN RAISE EXCEPTION 'Maximum marks must be more than 0.' USING ERRCODE = '23514'; END IF;
  IF v_weight IS NULL OR v_weight < 0 OR v_weight > 100 THEN RAISE EXCEPTION 'Weight must be between 0 and 100.' USING ERRCODE = '23514'; END IF;
  v_status := CASE WHEN coalesce((p->>'open')::boolean, false) THEN 'OPEN' ELSE 'DRAFT' END;
  INSERT INTO elimu_assessments (tenant_id, academic_year_id, term_id, class_id, stream_id, subject_id, assessment_type_id, name, assessment_date, max_marks, weight, description, status)
  VALUES (t, v_year, v_term, v_class, v_stream, v_subject, v_type, coalesce(nullif(btrim(p->>'name'),''), ty.name), nullif(p->>'assessment_date','')::date, v_max, v_weight, p->>'description', v_status)
  RETURNING id INTO v_id;
  PERFORM elimu_audit('ASSESSMENT_CREATED', 'elimu_assessments', v_id, jsonb_build_object('name', p->>'name', 'max_marks', v_max, 'weight', v_weight, 'subject_id', v_subject, 'class_id', v_class, 'term_id', v_term));
  w := elimu_check_weights(v_year, v_term, v_class, v_subject);
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'status', v_status, 'weights', w);
END $$;

CREATE OR REPLACE FUNCTION elimu_update_assessment(p_id uuid, p jsonb, p_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a elimu_assessments; o jsonb; n elimu_assessments;
BEGIN
  SELECT * INTO a FROM elimu_assessments WHERE id = p_id AND tenant_id = get_current_tenant_id();
  IF a.id IS NULL THEN RAISE EXCEPTION 'Assessment not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT elimu_can('assessment.create') OR NOT (elimu_can('marks.manage_all') OR elimu_teacher_covers(a.academic_year_id, a.term_id, a.class_id, a.stream_id, a.subject_id, true)) THEN
    RAISE EXCEPTION 'You do not have permission to change this assessment.' USING ERRCODE = '42501';
  END IF;
  o := jsonb_build_object('name', a.name, 'max_marks', a.max_marks, 'weight', a.weight, 'assessment_date', a.assessment_date, 'assessment_type_id', a.assessment_type_id, 'description', a.description);
  UPDATE elimu_assessments SET
    name = coalesce(nullif(btrim(p->>'name'), ''), name),
    max_marks = coalesce(nullif(p->>'max_marks','')::numeric, max_marks),
    weight = coalesce(nullif(p->>'weight','')::numeric, weight),
    assessment_date = CASE WHEN p ? 'assessment_date' THEN nullif(p->>'assessment_date','')::date ELSE assessment_date END,
    assessment_type_id = coalesce(nullif(p->>'assessment_type_id','')::uuid, assessment_type_id),
    description = CASE WHEN p ? 'description' THEN p->>'description' ELSE description END
   WHERE id = p_id RETURNING * INTO n;
  PERFORM elimu_audit('ASSESSMENT_EDITED', 'elimu_assessments', p_id, jsonb_build_object('before', o,
    'after', jsonb_build_object('name', n.name, 'max_marks', n.max_marks, 'weight', n.weight, 'assessment_date', n.assessment_date), 'reason', p_reason));
  RETURN jsonb_build_object('ok', true, 'version', n.version, 'weights', elimu_check_weights(n.academic_year_id, n.term_id, n.class_id, n.subject_id));
END $$;

CREATE OR REPLACE FUNCTION elimu_set_assessment_status(p_id uuid, p_status text, p_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a elimu_assessments; ok boolean;
BEGIN
  SELECT * INTO a FROM elimu_assessments WHERE id = p_id AND tenant_id = get_current_tenant_id();
  IF a.id IS NULL THEN RAISE EXCEPTION 'Assessment not found.' USING ERRCODE = 'P0002'; END IF;
  IF p_status = 'LOCKED' THEN ok := elimu_can('assessment.lock');
  ELSIF a.status = 'LOCKED' THEN ok := elimu_can('marks.unlock');           -- reopening a locked assessment
  ELSE ok := elimu_can('marks.manage_all') OR (elimu_can('assessment.create') AND elimu_teacher_covers(a.academic_year_id, a.term_id, a.class_id, a.stream_id, a.subject_id, true));
  END IF;
  IF NOT ok THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  IF p_status IN ('CANCELLED') AND nullif(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Please give a reason.' USING ERRCODE = '22023'; END IF;
  IF a.status = 'LOCKED' AND p_status = 'OPEN' AND nullif(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Please give a reason for reopening.' USING ERRCODE = '22023'; END IF;
  UPDATE elimu_assessments SET status = p_status,
     locked_at = CASE WHEN p_status = 'LOCKED' THEN now() ELSE NULL END, locked_by = CASE WHEN p_status = 'LOCKED' THEN elimu_staff_id() ELSE NULL END,
     cancelled_reason = CASE WHEN p_status = 'CANCELLED' THEN p_reason ELSE cancelled_reason END WHERE id = p_id;
  PERFORM elimu_audit('ASSESSMENT_' || p_status, 'elimu_assessments', p_id, jsonb_build_object('from', a.status, 'reason', p_reason));
  RETURN jsonb_build_object('ok', true, 'status', p_status);
END $$;

-- ---------------------------------------------------------------- the mark sheet (roster + marks), paginated
-- (VOLATILE on purpose: it stages the roster in a temp table so the page, the counts and the filters share one query.)
-- Roster = enrollments in the assessment's year / class (/ stream) with status ACTIVE or COMPLETED, plus anyone who already has a live mark.
-- Elective subjects: only students with an ACTIVE selection. A teacher sees only the streams they are allocated.
CREATE OR REPLACE FUNCTION elimu_get_mark_sheet(p_assessment uuid, p_search text DEFAULT NULL, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id(); a elimu_assessments; subj elimu_subjects; v_comp boolean; all_access boolean; rows jsonb; total int; q text := nullif(btrim(p_search), '');
  summ jsonb; v_lim int := least(greatest(coalesce(p_limit, 100), 1), 500);
BEGIN
  SELECT * INTO a FROM elimu_assessments WHERE id = p_assessment AND tenant_id = t;
  IF a.id IS NULL OR NOT elimu_can_see_assessment(p_assessment) THEN RAISE EXCEPTION 'Assessment not found.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO subj FROM elimu_subjects WHERE id = a.subject_id;
  SELECT coalesce((SELECT is_compulsory FROM elimu_subject_allocations al WHERE al.tenant_id = t AND al.status = 'ACTIVE' AND al.academic_year_id = a.academic_year_id
        AND al.class_id = a.class_id AND al.subject_id = a.subject_id AND (al.term_id IS NULL OR al.term_id = a.term_id) AND al.is_compulsory IS NOT NULL LIMIT 1), subj.is_compulsory) INTO v_comp;
  all_access := elimu_can('marks.manage_all') OR elimu_can('view.all') OR elimu_is_class_teacher(a.academic_year_id, a.class_id, a.stream_id);

  CREATE TEMP TABLE IF NOT EXISTS _elimu_roster (enrollment_id uuid, student_id uuid, stream_id uuid, admission_number text, student_name text) ON COMMIT DROP;
  TRUNCATE _elimu_roster;
  INSERT INTO _elimu_roster
  SELECT e.id, e.student_id, e.stream_id, s.admission_number, s.full_name
    FROM elimu_ref_enrollments e JOIN elimu_ref_students s ON s.id = e.student_id AND s.tenant_id = t
   WHERE e.tenant_id = t AND e.academic_year_id = a.academic_year_id AND e.class_id = a.class_id
     AND (a.stream_id IS NULL OR e.stream_id = a.stream_id)
     AND (e.status IN ('ACTIVE','COMPLETED') OR EXISTS (SELECT 1 FROM elimu_marks m WHERE m.assessment_id = a.id AND m.enrollment_id = e.id AND m.voided_at IS NULL))
     AND (v_comp OR EXISTS (SELECT 1 FROM elimu_student_subject_selections x WHERE x.enrollment_id = e.id AND x.subject_id = a.subject_id AND x.status = 'ACTIVE' AND (x.term_id IS NULL OR x.term_id = a.term_id)))
     AND (all_access OR EXISTS (SELECT 1 FROM elimu_subject_allocations al WHERE al.tenant_id = t AND al.status = 'ACTIVE' AND al.teacher_staff_id = elimu_staff_id()
          AND al.academic_year_id = a.academic_year_id AND al.class_id = a.class_id AND al.subject_id = a.subject_id AND (al.term_id IS NULL OR al.term_id = a.term_id)
          AND (al.stream_id IS NULL OR al.stream_id = e.stream_id)))
     AND (q IS NULL OR s.full_name ILIKE '%' || q || '%' OR s.admission_number ILIKE '%' || q || '%');
  SELECT count(*) INTO total FROM _elimu_roster;

  SELECT coalesce(jsonb_agg(r ORDER BY r.admission_number), '[]') INTO rows FROM (
    SELECT ro.enrollment_id, ro.student_id, ro.stream_id, ro.admission_number, ro.student_name,
           m.id AS mark_id, coalesce(m.mark_status, 'PENDING') AS mark_status, m.obtained_marks, m.remarks, coalesce(m.entry_status, 'DRAFT') AS entry_status, coalesce(m.version, 0) AS version,
           (m.id IS NOT NULL) AS has_row
      FROM _elimu_roster ro LEFT JOIN elimu_marks m ON m.assessment_id = a.id AND m.enrollment_id = ro.enrollment_id AND m.voided_at IS NULL
     ORDER BY ro.admission_number OFFSET greatest(p_offset, 0) LIMIT v_lim) r;

  SELECT jsonb_build_object('roster', count(*), 'pending', count(*) FILTER (WHERE m.id IS NULL OR m.mark_status = 'PENDING'),
          'draft', count(*) FILTER (WHERE m.id IS NOT NULL AND m.mark_status <> 'PENDING' AND m.entry_status = 'DRAFT'),
          'submitted', count(*) FILTER (WHERE m.entry_status = 'SUBMITTED'))
    INTO summ FROM _elimu_roster ro LEFT JOIN elimu_marks m ON m.assessment_id = a.id AND m.enrollment_id = ro.enrollment_id AND m.voided_at IS NULL;

  RETURN jsonb_build_object('ok', true,
    'assessment', jsonb_build_object('id', a.id, 'name', a.name, 'status', a.status, 'max_marks', a.max_marks, 'weight', a.weight, 'assessment_date', a.assessment_date,
       'subject_id', a.subject_id, 'subject_name', subj.name, 'class_id', a.class_id, 'stream_id', a.stream_id, 'term_id', a.term_id, 'academic_year_id', a.academic_year_id,
       'version', a.version, 'is_compulsory', v_comp),
    'total', total, 'summary', summ, 'rows', rows);
END $$;

-- ---------------------------------------------------------------- bulk save (drafts), optionally submitting what was saved
-- p_entries: [{enrollment_id, mark_status, obtained_marks, remarks, base_version}]  (base_version = the version the screen/phone last saw; 0/null = new)
-- Every entry is decided on its own: one bad row never loses the others. Result per row: ok, code, message, version.
--   codes: OK | UNCHANGED | CONFLICT | FORBIDDEN | SUBMITTED_LOCKED | VALIDATION | NOT_ON_ROSTER
-- Re-sending the same batch (offline retry) is safe: identical values come back UNCHANGED, never a duplicate.
CREATE OR REPLACE FUNCTION elimu_save_marks(p_assessment uuid, p_entries jsonb, p_submit boolean DEFAULT false, p_client_batch text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id(); a elimu_assessments; en jsonb; out jsonb := '[]'; enr record; m elimu_marks; v_status text; v_marks numeric; v_rem text; v_base int;
  n_ok int := 0; n_bad int := 0; n_same int := 0; code text; msg text; ver int; seen uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT * INTO a FROM elimu_assessments WHERE id = p_assessment AND tenant_id = t;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Assessment not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT elimu_can('marks.enter') THEN RAISE EXCEPTION 'You do not have permission to enter marks.' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_entries) <> 'array' THEN RAISE EXCEPTION 'Entries must be a list.' USING ERRCODE = '22023'; END IF;
  IF jsonb_array_length(p_entries) > 1000 THEN RAISE EXCEPTION 'Too many rows in one save (max 1000).' USING ERRCODE = '54000'; END IF;

  FOR en IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    code := 'OK'; msg := NULL; ver := NULL;
    BEGIN
      SELECT id, student_id, stream_id INTO enr FROM elimu_ref_enrollments WHERE id = (en->>'enrollment_id')::uuid AND tenant_id = t;
      IF enr.id IS NULL THEN code := 'NOT_ON_ROSTER'; msg := 'Unknown student enrollment.'; RAISE EXCEPTION USING ERRCODE = 'P9001', MESSAGE = 'skip'; END IF;
      IF enr.id = ANY (seen) THEN code := 'VALIDATION'; msg := 'This student appears twice in the same save.'; RAISE EXCEPTION USING ERRCODE = 'P9001', MESSAGE = 'skip'; END IF;
      seen := seen || enr.id;
      IF NOT elimu_can_mark(p_assessment, enr.stream_id) THEN code := 'FORBIDDEN'; msg := 'You are not assigned to enter marks for this student.'; RAISE EXCEPTION USING ERRCODE = 'P9001', MESSAGE = 'skip'; END IF;

      v_status := upper(coalesce(nullif(en->>'mark_status',''), CASE WHEN nullif(en->>'obtained_marks','') IS NOT NULL THEN 'PRESENT' ELSE 'PENDING' END));
      v_marks := nullif(en->>'obtained_marks','')::numeric;
      v_rem := nullif(btrim(en->>'remarks'), '');
      v_base := nullif(en->>'base_version','')::int;
      IF v_status NOT IN ('PRESENT','ABSENT','EXEMPTED','NOT_SUBMITTED','PENDING') THEN code := 'VALIDATION'; msg := 'Unknown mark status.'; RAISE EXCEPTION USING ERRCODE = 'P9001', MESSAGE = 'skip'; END IF;
      IF v_status = 'PRESENT' AND v_marks IS NULL THEN code := 'VALIDATION'; msg := 'Enter the marks, or choose Absent, Exempted, Not submitted or Pending. A blank is never counted as zero.'; RAISE EXCEPTION USING ERRCODE = 'P9001', MESSAGE = 'skip'; END IF;
      IF v_status <> 'PRESENT' THEN v_marks := NULL; END IF;       -- a status other than PRESENT carries no marks
      IF v_marks IS NOT NULL AND v_marks < 0 THEN code := 'VALIDATION'; msg := 'Marks cannot be negative.'; RAISE EXCEPTION USING ERRCODE = 'P9001', MESSAGE = 'skip'; END IF;
      IF v_marks IS NOT NULL AND v_marks > a.max_marks THEN code := 'VALIDATION'; msg := format('Marks cannot be more than %s.', a.max_marks); RAISE EXCEPTION USING ERRCODE = 'P9001', MESSAGE = 'skip'; END IF;

      SELECT * INTO m FROM elimu_marks WHERE assessment_id = p_assessment AND enrollment_id = enr.id AND voided_at IS NULL FOR UPDATE;
      IF m.id IS NULL THEN
        IF v_status = 'PENDING' AND v_rem IS NULL THEN code := 'UNCHANGED'; ver := 0;       -- nothing to store for a blank
        ELSE
          INSERT INTO elimu_marks (tenant_id, assessment_id, enrollment_id, student_id, mark_status, obtained_marks, remarks, entry_status)
          VALUES (t, p_assessment, enr.id, enr.student_id, v_status, v_marks, v_rem, 'DRAFT') RETURNING * INTO m;
          ver := m.version;
        END IF;
      ELSE
        IF (m.mark_status, m.obtained_marks, m.remarks) IS NOT DISTINCT FROM (v_status, v_marks, v_rem) THEN code := 'UNCHANGED'; ver := m.version;
        ELSIF v_base IS NOT NULL AND v_base <> m.version THEN
          code := 'CONFLICT'; ver := m.version;
          msg := format('Someone else changed this mark (now %s%s). Review it and save again.', m.mark_status, CASE WHEN m.obtained_marks IS NOT NULL THEN ' ' || m.obtained_marks ELSE '' END);
        ELSIF m.entry_status = 'SUBMITTED' THEN code := 'SUBMITTED_LOCKED'; ver := m.version; msg := 'These marks were submitted. Ask for them to be unlocked to change them.';
        ELSE
          UPDATE elimu_marks SET mark_status = v_status, obtained_marks = v_marks, remarks = v_rem WHERE id = m.id RETURNING * INTO m;
          ver := m.version;
        END IF;
      END IF;
    EXCEPTION
      WHEN SQLSTATE 'P9001' THEN NULL;                           -- decided above (code/msg already set)
      WHEN OTHERS THEN code := 'VALIDATION'; msg := SQLERRM;
    END;
    IF code = 'OK' THEN n_ok := n_ok + 1; ELSIF code = 'UNCHANGED' THEN n_same := n_same + 1; ELSE n_bad := n_bad + 1; END IF;
    out := out || jsonb_build_object('enrollment_id', en->>'enrollment_id', 'ok', code IN ('OK','UNCHANGED'), 'code', code, 'message', msg, 'version', ver);
  END LOOP;

  IF p_submit THEN
    -- submit only what this person may mark and that is actually decided (not PENDING)
    UPDATE elimu_marks SET entry_status = 'SUBMITTED', submitted_by = elimu_staff_id(), submitted_at = now()
     WHERE assessment_id = p_assessment AND voided_at IS NULL AND entry_status = 'DRAFT' AND mark_status <> 'PENDING'
       AND enrollment_id = ANY (ARRAY(SELECT (x->>'enrollment_id')::uuid FROM jsonb_array_elements(p_entries) x)) AND tenant_id = t;
  END IF;
  IF n_ok > 0 OR p_submit THEN
    PERFORM elimu_audit(CASE WHEN p_submit THEN 'MARKS_SAVED_AND_SUBMITTED' ELSE 'MARKS_SAVED' END, 'elimu_assessments', p_assessment,
      jsonb_build_object('saved', n_ok, 'unchanged', n_same, 'rejected', n_bad, 'client_batch', p_client_batch));
  END IF;
  RETURN jsonb_build_object('ok', n_bad = 0, 'saved', n_ok, 'unchanged', n_same, 'rejected', n_bad, 'results', out);
END $$;

-- Finalize: DRAFT -> SUBMITTED for the marks the caller may touch. Refuses while students are still PENDING / have no mark,
-- unless the caller says what the remaining students are (p_mark_remaining_as = NOT_SUBMITTED | ABSENT | EXEMPTED): an explicit decision, never silent zeros.
CREATE OR REPLACE FUNCTION elimu_submit_marks(p_assessment uuid, p_mark_remaining_as text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id(); a elimu_assessments; sheet jsonb; missing jsonb; cnt int := 0;
BEGIN
  SELECT * INTO a FROM elimu_assessments WHERE id = p_assessment AND tenant_id = t;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Assessment not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT elimu_can('marks.enter') THEN RAISE EXCEPTION 'You do not have permission to submit marks.' USING ERRCODE = '42501'; END IF;
  IF a.status <> 'OPEN' THEN RAISE EXCEPTION 'The assessment is %, so marks cannot be submitted.', lower(a.status) USING ERRCODE = '23514'; END IF;
  IF p_mark_remaining_as IS NOT NULL AND p_mark_remaining_as NOT IN ('NOT_SUBMITTED','ABSENT','EXEMPTED') THEN RAISE EXCEPTION 'Choose NOT_SUBMITTED, ABSENT or EXEMPTED.' USING ERRCODE = '22023'; END IF;
  sheet := elimu_get_mark_sheet(p_assessment, NULL, 500, 0);
  SELECT coalesce(jsonb_agg(r), '[]') INTO missing FROM jsonb_to_recordset(sheet->'rows') AS r(enrollment_id uuid, admission_number text, student_name text, mark_status text, stream_id uuid)
   WHERE r.mark_status = 'PENDING';
  IF jsonb_array_length(missing) > 0 THEN
    IF p_mark_remaining_as IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'PENDING_MARKS', 'missing', missing, 'message', 'Some students have no decision yet.'); END IF;
    PERFORM elimu_save_marks(p_assessment, (SELECT jsonb_agg(jsonb_build_object('enrollment_id', x->>'enrollment_id', 'mark_status', p_mark_remaining_as)) FROM jsonb_array_elements(missing) x), false, 'submit-remaining');
  END IF;
  UPDATE elimu_marks SET entry_status = 'SUBMITTED', submitted_by = elimu_staff_id(), submitted_at = now()
   WHERE assessment_id = p_assessment AND tenant_id = t AND voided_at IS NULL AND entry_status = 'DRAFT' AND mark_status <> 'PENDING'
     AND (elimu_can('marks.manage_all') OR elimu_can_mark(p_assessment, (SELECT stream_id FROM elimu_ref_enrollments e WHERE e.id = enrollment_id AND e.tenant_id = t)));
  GET DIAGNOSTICS cnt = ROW_COUNT;
  PERFORM elimu_audit('MARKS_SUBMITTED', 'elimu_assessments', p_assessment, jsonb_build_object('submitted', cnt, 'remaining_marked_as', p_mark_remaining_as));
  RETURN jsonb_build_object('ok', true, 'submitted', cnt);
END $$;

-- Reopen submitted marks for editing (exams officer / admin). Reason mandatory. Fails (by trigger) for students whose results are approved.
CREATE OR REPLACE FUNCTION elimu_unlock_marks(p_assessment uuid, p_reason text, p_enrollments uuid[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id(); n int;
BEGIN
  IF NOT elimu_can('marks.unlock') THEN RAISE EXCEPTION 'You do not have permission to unlock marks.' USING ERRCODE = '42501'; END IF;
  IF nullif(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Please give a reason.' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM elimu_assessments WHERE id = p_assessment AND tenant_id = t) THEN RAISE EXCEPTION 'Assessment not found.' USING ERRCODE = 'P0002'; END IF;
  PERFORM set_config('elimu.edit_submitted', 'on', true); PERFORM set_config('elimu.reason', p_reason, true);
  UPDATE elimu_marks SET entry_status = 'DRAFT', submitted_by = NULL, submitted_at = NULL
   WHERE assessment_id = p_assessment AND tenant_id = t AND voided_at IS NULL AND entry_status = 'SUBMITTED' AND (p_enrollments IS NULL OR enrollment_id = ANY (p_enrollments));
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('elimu.edit_submitted', 'off', true); PERFORM set_config('elimu.reason', '', true);
  PERFORM elimu_audit('MARKS_UNLOCKED', 'elimu_assessments', p_assessment, jsonb_build_object('count', n, 'reason', p_reason));
  RETURN jsonb_build_object('ok', true, 'unlocked', n);
END $$;

-- Void a mark entered in error (kept in history). A submitted mark needs the unlock right.
CREATE OR REPLACE FUNCTION elimu_void_mark(p_mark uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id(); m elimu_marks; v_stream uuid;
BEGIN
  SELECT * INTO m FROM elimu_marks WHERE id = p_mark AND tenant_id = t AND voided_at IS NULL;
  IF m.id IS NULL THEN RAISE EXCEPTION 'Mark not found.' USING ERRCODE = 'P0002'; END IF;
  IF nullif(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Please give a reason.' USING ERRCODE = '22023'; END IF;
  SELECT stream_id INTO v_stream FROM elimu_ref_enrollments WHERE id = m.enrollment_id AND tenant_id = t;
  IF NOT elimu_can_mark(m.assessment_id, v_stream) THEN RAISE EXCEPTION 'You are not assigned to change this mark.' USING ERRCODE = '42501'; END IF;
  IF m.entry_status = 'SUBMITTED' AND NOT elimu_can('marks.unlock') THEN RAISE EXCEPTION 'Submitted marks can only be voided by someone allowed to unlock marks.' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('elimu.edit_submitted', 'on', true); PERFORM set_config('elimu.reason', p_reason, true);
  UPDATE elimu_marks SET voided_at = now(), voided_by = elimu_staff_id(), void_reason = p_reason WHERE id = p_mark;
  PERFORM set_config('elimu.edit_submitted', 'off', true); PERFORM set_config('elimu.reason', '', true);
  PERFORM elimu_audit('MARK_VOIDED', 'elimu_marks', p_mark, jsonb_build_object('assessment_id', m.assessment_id, 'student_id', m.student_id, 'reason', p_reason, 'was', m.mark_status, 'marks', m.obtained_marks));
  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION elimu_check_weights(uuid,uuid,uuid,uuid), elimu_create_assessment(jsonb), elimu_update_assessment(uuid,jsonb,text),
  elimu_set_assessment_status(uuid,text,text), elimu_get_mark_sheet(uuid,text,integer,integer), elimu_save_marks(uuid,jsonb,boolean,text),
  elimu_submit_marks(uuid,text), elimu_unlock_marks(uuid,text,uuid[]), elimu_void_mark(uuid,text) TO authenticated;
