-- ============================================================
-- ELIMU Report cards — 42 REPORT-CARD WORKFLOW FUNCTIONS. Run after 41_compute_results.sql. Re-runnable.
--
-- DRAFT -> REVIEW -> APPROVED -> PUBLISHED (-> SUPERSEDED by a corrected revision)
--   REVIEW  : needs complete results (or an explicit allow-incomplete by someone who may review)
--   APPROVED: builds the frozen SNAPSHOT and LOCKS the term + subject results (nobody can change them any more)
--   PUBLISHED: guardians may be notified. From here only elimu_open_correction / elimu_correct_published_mark can change anything,
--              they need 'reportcard.correct' + a reason, create revision n+1 and keep the old one. Everything is audited.
-- ============================================================

CREATE OR REPLACE FUNCTION elimu_report_payload(p_term_result uuid, p_card uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id(); tr elimu_term_results; c elimu_report_cards; st elimu_academic_settings; biz record; stu record; yr text; tmn text; cls text; strm text;
  subs jsonb; bands jsonb; ct_name text; hd_name text; ct_staff uuid; sch record;
BEGIN
  SELECT * INTO tr FROM elimu_term_results WHERE id = p_term_result AND tenant_id = t;
  IF tr.id IS NULL THEN RETURN NULL; END IF;
  IF p_card IS NOT NULL THEN SELECT * INTO c FROM elimu_report_cards WHERE id = p_card AND tenant_id = t; END IF;
  SELECT * INTO st FROM elimu_academic_settings WHERE tenant_id = t;
  SELECT coalesce(nullif(btrim(b.name), ''), pt.business_name) AS name, b.logo_url, b.address, coalesce(b.phone, pt.phone) AS phone, coalesce(b.email, pt.email) AS email INTO biz
    FROM pos_tenants pt LEFT JOIN lb_businesses b ON b.tenant_id = pt.id WHERE pt.id = t LIMIT 1;
  SELECT admission_number, full_name INTO stu FROM elimu_ref_students WHERE id = tr.student_id AND tenant_id = t;
  SELECT name INTO yr FROM elimu_ref_academic_years WHERE id = tr.academic_year_id AND tenant_id = t;
  SELECT name INTO tmn FROM elimu_ref_terms WHERE id = tr.term_id AND tenant_id = t;
  SELECT name INTO cls FROM elimu_ref_classes WHERE id = tr.class_id AND tenant_id = t;
  SELECT name INTO strm FROM elimu_ref_streams WHERE id = tr.stream_id AND tenant_id = t;
  SELECT coalesce(jsonb_agg(jsonb_build_object('subject_id', sr.subject_id, 'code', s.code, 'name', s.name, 'completeness', sr.completeness, 'percentage', sr.percentage,
            'grade', sr.grade, 'grade_point', sr.grade_point, 'descriptor', sr.grade_descriptor, 'remark', sr.grade_remark, 'is_pass', sr.is_pass, 'teacher_remark', sr.teacher_remark,
            'raw_obtained', sr.raw_obtained, 'raw_max', sr.raw_max, 'breakdown', sr.breakdown) ORDER BY s.sort_order, s.name), '[]') INTO subs
    FROM elimu_subject_results sr JOIN elimu_subjects s ON s.id = sr.subject_id WHERE sr.term_result_id = tr.id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('grade', r.grade, 'min', r.min_percent, 'max', r.max_percent, 'grade_point', r.grade_point, 'descriptor', r.descriptor) ORDER BY r.min_percent DESC), '[]') INTO bands
    FROM elimu_grading_rules r WHERE r.scheme_id = tr.grading_scheme_id;
  SELECT name, version INTO sch FROM elimu_grading_schemes WHERE id = tr.grading_scheme_id;
  ct_staff := coalesce(c.class_teacher_staff_id, (SELECT teacher_staff_id FROM elimu_class_teachers WHERE tenant_id = t AND status = 'ACTIVE' AND academic_year_id = tr.academic_year_id
                AND class_id = tr.class_id AND (stream_id IS NULL OR stream_id = tr.stream_id) ORDER BY stream_id NULLS LAST LIMIT 1));
  SELECT name INTO ct_name FROM pos_staff WHERE id = ct_staff;
  hd_name := coalesce((SELECT name FROM pos_staff WHERE id = c.head_staff_id), st.headteacher_name);
  RETURN jsonb_build_object(
    'school', jsonb_build_object('name', biz.name, 'logo_url', biz.logo_url, 'address', biz.address, 'phone', biz.phone, 'email', biz.email, 'motto', st.school_motto,
                                 'footer', st.report_footer, 'headteacher_name', coalesce(hd_name, st.headteacher_name), 'headteacher_title', coalesce(st.headteacher_title, 'Head Teacher')),
    'student', jsonb_build_object('id', tr.student_id, 'admission_number', stu.admission_number, 'full_name', stu.full_name, 'enrollment_id', tr.enrollment_id),
    'academic_year', jsonb_build_object('id', tr.academic_year_id, 'name', yr), 'term', jsonb_build_object('id', tr.term_id, 'name', tmn),
    'class', jsonb_build_object('id', tr.class_id, 'name', cls), 'stream', jsonb_build_object('id', tr.stream_id, 'name', strm),
    'subjects', subs,
    'overall', jsonb_build_object('mean_percentage', tr.mean_percentage, 'total_percentage', tr.total_percentage, 'grade', tr.overall_grade, 'grade_point', tr.overall_grade_point,
        'descriptor', tr.overall_descriptor, 'remark', tr.overall_remark, 'class_position', tr.class_position, 'class_size', tr.class_size, 'stream_position', tr.stream_position,
        'stream_size', tr.stream_size, 'subjects_expected', tr.subjects_expected, 'subjects_complete', tr.subjects_complete, 'is_complete', tr.is_complete),
    'remarks', jsonb_build_object('class_teacher', c.class_teacher_remarks, 'class_teacher_name', ct_name, 'head', c.head_remarks, 'head_name', hd_name),
    'grading', jsonb_build_object('scheme_name', sch.name, 'version', sch.version, 'bands', bands),
    'display', jsonb_build_object('show_positions', coalesce(st.show_positions, true), 'show_grade_points', coalesce(st.show_grade_points, true)),
    'card', jsonb_build_object('id', c.id, 'status', c.status, 'revision_no', c.revision_no, 'published_at', c.published_at, 'approved_at', c.approved_at),
    'term_result_id', tr.id, 'generated_at', now());
END $$;

CREATE OR REPLACE FUNCTION elimu_generate_report_cards(p_year uuid, p_term uuid, p_class uuid, p_stream uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id(); n int := 0; r record; v_ct uuid;
BEGIN
  IF NOT (elimu_can('results.compute') OR elimu_can('reportcard.review')) THEN RAISE EXCEPTION 'You do not have permission to create report cards.' USING ERRCODE = '42501'; END IF;
  FOR r IN SELECT tr.* FROM elimu_term_results tr
            WHERE tr.tenant_id = t AND tr.academic_year_id = p_year AND tr.term_id = p_term AND tr.class_id = p_class AND tr.is_current AND (p_stream IS NULL OR tr.stream_id = p_stream)
              AND NOT EXISTS (SELECT 1 FROM elimu_report_cards c WHERE c.term_result_id = tr.id) LOOP
    SELECT teacher_staff_id INTO v_ct FROM elimu_class_teachers WHERE tenant_id = t AND status = 'ACTIVE' AND academic_year_id = r.academic_year_id AND class_id = r.class_id
       AND (stream_id IS NULL OR stream_id = r.stream_id) ORDER BY stream_id NULLS LAST LIMIT 1;
    INSERT INTO elimu_report_cards (tenant_id, term_result_id, enrollment_id, student_id, academic_year_id, term_id, class_id, stream_id, revision_no, class_teacher_staff_id)
    VALUES (t, r.id, r.enrollment_id, r.student_id, r.academic_year_id, r.term_id, r.class_id, r.stream_id,
            coalesce((SELECT max(revision_no) FROM elimu_report_cards WHERE enrollment_id = r.enrollment_id AND term_id = r.term_id), 0) + 1, v_ct);
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'created', n);
END $$;

CREATE OR REPLACE FUNCTION elimu_save_report_remarks(p_card uuid, p_class_teacher text DEFAULT NULL, p_head text DEFAULT NULL, p_set_ct boolean DEFAULT false, p_set_head boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c elimu_report_cards;
BEGIN
  SELECT * INTO c FROM elimu_report_cards WHERE id = p_card AND tenant_id = get_current_tenant_id();
  IF c.id IS NULL THEN RAISE EXCEPTION 'Report card not found.' USING ERRCODE = 'P0002'; END IF;
  IF p_set_ct AND NOT (elimu_can('reportcard.review') OR elimu_is_class_teacher(c.academic_year_id, c.class_id, c.stream_id)) THEN
    RAISE EXCEPTION 'Only the class teacher (or an exams officer / administrator) can write the class teacher remarks.' USING ERRCODE = '42501';
  END IF;
  IF p_set_head AND NOT elimu_can('remarks.head') THEN RAISE EXCEPTION 'Only the head teacher can write the head teacher remarks.' USING ERRCODE = '42501'; END IF;
  UPDATE elimu_report_cards SET
    class_teacher_remarks = CASE WHEN p_set_ct THEN nullif(btrim(p_class_teacher), '') ELSE class_teacher_remarks END,
    class_teacher_staff_id = CASE WHEN p_set_ct THEN elimu_staff_id() ELSE class_teacher_staff_id END,
    head_remarks = CASE WHEN p_set_head THEN nullif(btrim(p_head), '') ELSE head_remarks END,
    head_staff_id = CASE WHEN p_set_head THEN elimu_staff_id() ELSE head_staff_id END
   WHERE id = p_card;                      -- trigger refuses once APPROVED / PUBLISHED
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION elimu_save_subject_remark(p_subject_result uuid, p_remark text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r elimu_subject_results; locked timestamptz;
BEGIN
  SELECT * INTO r FROM elimu_subject_results WHERE id = p_subject_result AND tenant_id = get_current_tenant_id();
  IF r.id IS NULL THEN RAISE EXCEPTION 'Result not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT (elimu_can('reportcard.review') OR elimu_teacher_covers(r.academic_year_id, r.term_id, r.class_id, r.stream_id, r.subject_id, false)) THEN
    RAISE EXCEPTION 'Only the subject teacher (or an exams officer / administrator) can write this remark.' USING ERRCODE = '42501';
  END IF;
  SELECT locked_at INTO locked FROM elimu_term_results WHERE id = r.term_result_id;
  IF locked IS NOT NULL THEN RAISE EXCEPTION 'These results are approved. Remarks can no longer be changed.' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('elimu.result_admin', 'on', true);
  UPDATE elimu_subject_results SET teacher_remark = nullif(btrim(p_remark), ''), teacher_remark_by = elimu_staff_id(), teacher_remark_at = now() WHERE id = p_subject_result;
  PERFORM set_config('elimu.result_admin', 'off', true);
  RETURN jsonb_build_object('ok', true);
END $$;

-- ---------------------------------------------------------------- workflow
CREATE OR REPLACE FUNCTION elimu_report_card_transition(p_card uuid, p_to text, p_reason text DEFAULT NULL, p_allow_incomplete boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id(); c elimu_report_cards; tr elimu_term_results; ok boolean; snap jsonb; ev text; v_reason text := nullif(btrim(p_reason), '');
BEGIN
  SELECT * INTO c FROM elimu_report_cards WHERE id = p_card AND tenant_id = t FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Report card not found.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO tr FROM elimu_term_results WHERE id = c.term_result_id;
  IF NOT tr.is_current THEN RAISE EXCEPTION 'These results were replaced by a correction.' USING ERRCODE = '23514'; END IF;

  ok := CASE
    WHEN c.status = 'DRAFT'    AND p_to = 'REVIEW'    THEN elimu_can('reportcard.review') OR elimu_is_class_teacher(c.academic_year_id, c.class_id, c.stream_id)
    WHEN c.status = 'REVIEW'   AND p_to = 'DRAFT'     THEN elimu_can('reportcard.review')
    WHEN c.status = 'REVIEW'   AND p_to = 'APPROVED'  THEN elimu_can('reportcard.approve')
    WHEN c.status = 'APPROVED' AND p_to = 'REVIEW'    THEN elimu_can('reportcard.approve')
    WHEN c.status = 'APPROVED' AND p_to = 'PUBLISHED' THEN elimu_can('reportcard.publish')
    ELSE NULL END;
  IF ok IS NULL THEN RAISE EXCEPTION 'A report card cannot go from % to %.', c.status, p_to USING ERRCODE = '23514'; END IF;
  IF NOT ok THEN RAISE EXCEPTION 'You do not have permission to move this report card to %.', p_to USING ERRCODE = '42501'; END IF;
  IF c.status = 'APPROVED' AND p_to = 'REVIEW' AND v_reason IS NULL THEN RAISE EXCEPTION 'Please give a reason for taking an approved report card back to review.' USING ERRCODE = '22023'; END IF;

  PERFORM set_config('elimu.reason', coalesce(v_reason, ''), true);
  IF p_to = 'REVIEW' AND c.status = 'DRAFT' THEN
    IF NOT tr.is_complete THEN
      IF NOT (p_allow_incomplete AND elimu_can('reportcard.review')) THEN
        PERFORM set_config('elimu.reason', '', true);
        RETURN jsonb_build_object('ok', false, 'code', 'INCOMPLETE_RESULTS', 'message', 'Some subjects are incomplete (missing or unsubmitted marks).', 'complete', tr.subjects_complete, 'expected', tr.subjects_expected);
      END IF;
    END IF;
    UPDATE elimu_report_cards SET status = 'REVIEW', reviewed_by = elimu_staff_id(), reviewed_at = now() WHERE id = p_card;
    ev := 'RESULT_FINALIZED';
  ELSIF p_to = 'DRAFT' THEN
    UPDATE elimu_report_cards SET status = 'DRAFT' WHERE id = p_card; ev := 'REPORT_CARD_SENT_BACK';
  ELSIF p_to = 'APPROVED' THEN
    IF NOT tr.is_complete THEN RAISE EXCEPTION 'Incomplete results cannot be approved.' USING ERRCODE = '23514'; END IF;
    snap := elimu_report_payload(tr.id, c.id);
    UPDATE elimu_report_cards SET status = 'APPROVED', snapshot = snap, approved_by = elimu_staff_id(), approved_at = now() WHERE id = p_card;
    PERFORM set_config('elimu.result_admin', 'on', true);
    UPDATE elimu_term_results SET locked_at = now(), locked_by = elimu_staff_id() WHERE id = tr.id;
    PERFORM set_config('elimu.result_admin', 'off', true);
    ev := 'RESULT_APPROVED';
  ELSIF c.status = 'APPROVED' AND p_to = 'REVIEW' THEN
    PERFORM set_config('elimu.result_admin', 'on', true);
    UPDATE elimu_term_results SET locked_at = NULL, locked_by = NULL WHERE id = tr.id;
    PERFORM set_config('elimu.result_admin', 'off', true);
    UPDATE elimu_report_cards SET status = 'REVIEW', snapshot = NULL, approved_by = NULL, approved_at = NULL WHERE id = p_card;
    ev := 'RESULT_APPROVAL_WITHDRAWN';
  ELSIF p_to = 'PUBLISHED' THEN
    UPDATE elimu_report_cards SET status = 'PUBLISHED', published_by = elimu_staff_id(), published_at = now() WHERE id = p_card;
    UPDATE elimu_report_cards SET status = 'SUPERSEDED', superseded_by_id = p_card
     WHERE tenant_id = t AND enrollment_id = c.enrollment_id AND term_id = c.term_id AND status = 'PUBLISHED' AND revision_no < c.revision_no;
    ev := 'REPORT_CARD_PUBLISHED';
  END IF;
  PERFORM set_config('elimu.reason', '', true);
  PERFORM elimu_audit(ev, 'elimu_report_cards', p_card, jsonb_build_object('from', c.status, 'to', p_to, 'revision', c.revision_no, 'student_id', c.student_id, 'reason', v_reason));
  RETURN jsonb_build_object('ok', true, 'status', p_to);
END $$;

-- Many cards at once (a class / stream). One failure never blocks the rest.
CREATE OR REPLACE FUNCTION elimu_bulk_transition(p_cards uuid[], p_to text, p_reason text DEFAULT NULL, p_allow_incomplete boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE id uuid; r jsonb; out jsonb := '[]'; n_ok int := 0; n_bad int := 0;
BEGIN
  IF cardinality(p_cards) > 500 THEN RAISE EXCEPTION 'Too many report cards at once (max 500).' USING ERRCODE = '54000'; END IF;
  FOREACH id IN ARRAY p_cards LOOP
    BEGIN
      r := elimu_report_card_transition(id, p_to, p_reason, p_allow_incomplete);
    EXCEPTION WHEN OTHERS THEN r := jsonb_build_object('ok', false, 'code', 'ERROR', 'message', SQLERRM);
    END;
    IF (r->>'ok')::boolean THEN n_ok := n_ok + 1; ELSE n_bad := n_bad + 1; END IF;
    out := out || jsonb_build_object('card_id', id) || r;
  END LOOP;
  RETURN jsonb_build_object('ok', n_bad = 0, 'succeeded', n_ok, 'failed', n_bad, 'results', out);
END $$;

-- ---------------------------------------------------------------- corrections after publication
-- Creates revision n+1 of the term result (copy of the published one, unlocked) and a new DRAFT report card. The published
-- card stays visible and PUBLISHED until the corrected card is itself published (then it becomes SUPERSEDED).
CREATE OR REPLACE FUNCTION elimu_open_correction(p_card uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id(); c elimu_report_cards; o elimu_term_results; n_tr uuid := gen_random_uuid(); n_card uuid := gen_random_uuid();
BEGIN
  IF NOT elimu_can('reportcard.correct') THEN RAISE EXCEPTION 'Only the head teacher (or the owner) can correct a published result.' USING ERRCODE = '42501'; END IF;
  IF nullif(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Please give the reason for the correction.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO c FROM elimu_report_cards WHERE id = p_card AND tenant_id = t FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Report card not found.' USING ERRCODE = 'P0002'; END IF;
  IF c.status <> 'PUBLISHED' THEN RAISE EXCEPTION 'Only a published report card needs a correction (this one is %).', lower(c.status) USING ERRCODE = '23514'; END IF;
  IF EXISTS (SELECT 1 FROM elimu_report_cards WHERE enrollment_id = c.enrollment_id AND term_id = c.term_id AND revision_no > c.revision_no AND status <> 'SUPERSEDED') THEN
    RAISE EXCEPTION 'A correction is already open for this report card.' USING ERRCODE = '23505';
  END IF;
  SELECT * INTO o FROM elimu_term_results WHERE id = c.term_result_id;
  PERFORM set_config('elimu.result_admin', 'on', true); PERFORM set_config('elimu.reason', p_reason, true);
  UPDATE elimu_term_results SET is_current = false, superseded_at = now(), supersede_reason = p_reason WHERE id = o.id;
  INSERT INTO elimu_term_results (id, tenant_id, academic_year_id, term_id, enrollment_id, student_id, class_id, stream_id, revision, is_current, subjects_expected, subjects_complete, is_complete,
      total_percentage, mean_percentage, overall_grade, overall_grade_point, overall_descriptor, overall_remark, grading_scheme_id, class_position, class_size, stream_position, stream_size, computed_by, compute_params)
  SELECT n_tr, tenant_id, academic_year_id, term_id, enrollment_id, student_id, class_id, stream_id, revision + 1, true, subjects_expected, subjects_complete, is_complete,
      total_percentage, mean_percentage, overall_grade, overall_grade_point, overall_descriptor, overall_remark, grading_scheme_id, class_position, class_size, stream_position, stream_size, elimu_staff_id(), compute_params
    FROM elimu_term_results WHERE id = o.id;
  INSERT INTO elimu_subject_results (tenant_id, term_result_id, academic_year_id, term_id, enrollment_id, student_id, class_id, stream_id, subject_id, completeness, raw_obtained, raw_max, weighted_score,
      percentage, grade, grade_point, grade_descriptor, grade_remark, is_pass, grading_scheme_id, grading_rule_id, teacher_remark, teacher_remark_by, teacher_remark_at, breakdown, issues)
  SELECT tenant_id, n_tr, academic_year_id, term_id, enrollment_id, student_id, class_id, stream_id, subject_id, completeness, raw_obtained, raw_max, weighted_score,
      percentage, grade, grade_point, grade_descriptor, grade_remark, is_pass, grading_scheme_id, grading_rule_id, teacher_remark, teacher_remark_by, teacher_remark_at, breakdown, issues
    FROM elimu_subject_results WHERE term_result_id = o.id;
  PERFORM set_config('elimu.result_admin', 'off', true);
  INSERT INTO elimu_report_cards (id, tenant_id, term_result_id, enrollment_id, student_id, academic_year_id, term_id, class_id, stream_id, revision_no,
      class_teacher_remarks, class_teacher_staff_id, head_remarks, head_staff_id, correction_reason)
  VALUES (n_card, t, n_tr, c.enrollment_id, c.student_id, c.academic_year_id, c.term_id, c.class_id, c.stream_id,
      (SELECT max(revision_no) FROM elimu_report_cards WHERE enrollment_id = c.enrollment_id AND term_id = c.term_id) + 1,
      c.class_teacher_remarks, c.class_teacher_staff_id, c.head_remarks, c.head_staff_id, p_reason);
  PERFORM set_config('elimu.reason', '', true);
  PERFORM elimu_audit('PUBLISHED_RESULT_CORRECTION_OPENED', 'elimu_report_cards', n_card, jsonb_build_object('from_card', c.id, 'student_id', c.student_id, 'reason', p_reason));
  RETURN jsonb_build_object('ok', true, 'card_id', n_card, 'term_result_id', n_tr);
END $$;

-- Correct ONE mark behind a published result: opens the correction if needed, changes the mark (history row = CORRECTED, with the reason),
-- recomputes just that student, and leaves the new revision as a DRAFT card to be re-approved and re-published.
CREATE OR REPLACE FUNCTION elimu_correct_published_mark(p_card uuid, p_assessment uuid, p_status text, p_marks numeric, p_remarks text, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id(); c elimu_report_cards; v_card uuid; v_tr uuid; opened jsonb; a elimu_assessments; m elimu_marks; before jsonb; v_status text := upper(p_status);
BEGIN
  IF NOT elimu_can('reportcard.correct') THEN RAISE EXCEPTION 'Only the head teacher (or the owner) can correct a published result.' USING ERRCODE = '42501'; END IF;
  IF nullif(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Please give the reason for the correction.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO c FROM elimu_report_cards WHERE id = p_card AND tenant_id = t;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Report card not found.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO a FROM elimu_assessments WHERE id = p_assessment AND tenant_id = t;
  IF a.id IS NULL OR a.term_id <> c.term_id OR a.class_id <> c.class_id THEN RAISE EXCEPTION 'That assessment is not part of this report card.' USING ERRCODE = '23514'; END IF;
  IF v_status NOT IN ('PRESENT','ABSENT','EXEMPTED','NOT_SUBMITTED') THEN RAISE EXCEPTION 'A correction must state PRESENT, ABSENT, EXEMPTED or NOT_SUBMITTED.' USING ERRCODE = '22023'; END IF;
  IF v_status = 'PRESENT' AND (p_marks IS NULL OR p_marks < 0 OR p_marks > a.max_marks) THEN RAISE EXCEPTION 'Marks must be between 0 and %.', a.max_marks USING ERRCODE = '23514'; END IF;

  IF c.status = 'PUBLISHED' THEN
    opened := elimu_open_correction(p_card, p_reason); v_card := (opened->>'card_id')::uuid; v_tr := (opened->>'term_result_id')::uuid;
  ELSIF c.revision_no > 1 AND c.status IN ('DRAFT','REVIEW') THEN v_card := c.id; v_tr := c.term_result_id;
  ELSE RAISE EXCEPTION 'Only a published report card (or its open correction) can be corrected this way.' USING ERRCODE = '23514'; END IF;

  PERFORM set_config('elimu.correction', 'on', true); PERFORM set_config('elimu.edit_submitted', 'on', true); PERFORM set_config('elimu.reason', p_reason, true);
  SELECT * INTO m FROM elimu_marks WHERE assessment_id = p_assessment AND enrollment_id = c.enrollment_id AND voided_at IS NULL FOR UPDATE;
  IF m.id IS NULL THEN
    INSERT INTO elimu_marks (tenant_id, assessment_id, enrollment_id, student_id, mark_status, obtained_marks, remarks, entry_status, submitted_by, submitted_at)
    VALUES (t, p_assessment, c.enrollment_id, c.student_id, v_status, CASE WHEN v_status = 'PRESENT' THEN p_marks END, nullif(btrim(p_remarks), ''), 'SUBMITTED', elimu_staff_id(), now());
    before := jsonb_build_object('mark_status', 'PENDING');
  ELSE
    before := jsonb_build_object('mark_status', m.mark_status, 'obtained_marks', m.obtained_marks);
    UPDATE elimu_marks SET mark_status = v_status, obtained_marks = CASE WHEN v_status = 'PRESENT' THEN p_marks END, remarks = coalesce(nullif(btrim(p_remarks), ''), remarks), entry_status = 'SUBMITTED' WHERE id = m.id;
  END IF;
  PERFORM set_config('elimu.correction', 'off', true); PERFORM set_config('elimu.edit_submitted', 'off', true); PERFORM set_config('elimu.reason', '', true);

  PERFORM elimu_compute_one(c.enrollment_id, c.term_id);        -- updates the (unlocked) new revision in place
  PERFORM elimu_rank_class(c.academic_year_id, c.term_id, c.class_id);
  PERFORM set_config('elimu.result_admin', 'off', true);
  PERFORM elimu_audit('PUBLISHED_RESULT_CORRECTED', 'elimu_report_cards', v_card, jsonb_build_object('assessment_id', p_assessment, 'student_id', c.student_id,
          'before', before, 'after', jsonb_build_object('mark_status', v_status, 'obtained_marks', p_marks), 'reason', p_reason));
  RETURN jsonb_build_object('ok', true, 'card_id', v_card, 'term_result_id', v_tr);
END $$;

-- ---------------------------------------------------------------- reading
-- Payloads for printing. APPROVED / PUBLISHED / SUPERSEDED cards return their FROZEN snapshot (exactly what was approved); drafts are built live and flagged draft.
CREATE OR REPLACE FUNCTION elimu_get_report_cards(p_cards uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id(); c elimu_report_cards; out jsonb := '[]'; pl jsonb; v_id uuid;
BEGIN
  IF cardinality(p_cards) > 200 THEN RAISE EXCEPTION 'Too many report cards at once (max 200).' USING ERRCODE = '54000'; END IF;
  FOREACH v_id IN ARRAY p_cards LOOP
    SELECT * INTO c FROM elimu_report_cards WHERE id = v_id AND tenant_id = t;
    CONTINUE WHEN c.id IS NULL;
    CONTINUE WHEN NOT (elimu_can('view.all') OR elimu_is_class_teacher(c.academic_year_id, c.class_id, c.stream_id));
    IF c.status IN ('APPROVED','PUBLISHED','SUPERSEDED') THEN
      pl := c.snapshot || jsonb_build_object('draft', false);
    ELSE
      pl := elimu_report_payload(c.term_result_id, c.id) || jsonb_build_object('draft', true);
    END IF;
    pl := jsonb_set(pl, '{card}', jsonb_build_object('id', c.id, 'status', c.status, 'revision_no', c.revision_no, 'published_at', c.published_at, 'approved_at', c.approved_at));
    out := out || jsonb_build_object('card_id', c.id, 'payload', pl);
  END LOOP;
  RETURN out;
END $$;

CREATE OR REPLACE FUNCTION elimu_list_report_cards(p_year uuid, p_term uuid, p_class uuid, p_stream uuid DEFAULT NULL, p_status text DEFAULT NULL,
                                                   p_search text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id(); q text := nullif(btrim(p_search), ''); rows jsonb; total int; v_counts jsonb;
BEGIN
  IF NOT (elimu_can('view.all') OR elimu_is_class_teacher(p_year, p_class, p_stream)) THEN RAISE EXCEPTION 'You do not have permission to see these report cards.' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(jsonb_object_agg(status, n), '{}') INTO v_counts FROM (SELECT status, count(*) AS n FROM elimu_report_cards c
    WHERE c.tenant_id = t AND c.academic_year_id = p_year AND c.term_id = p_term AND c.class_id = p_class AND c.status <> 'SUPERSEDED' AND (p_stream IS NULL OR c.stream_id = p_stream) GROUP BY status) z;
  SELECT count(*) INTO total FROM elimu_report_cards c JOIN elimu_ref_students s ON s.id = c.student_id AND s.tenant_id = t
   WHERE c.tenant_id = t AND c.academic_year_id = p_year AND c.term_id = p_term AND c.class_id = p_class AND c.status <> 'SUPERSEDED' AND (p_stream IS NULL OR c.stream_id = p_stream)
     AND (p_status IS NULL OR c.status = p_status) AND (q IS NULL OR s.full_name ILIKE '%' || q || '%' OR s.admission_number ILIKE '%' || q || '%');
  SELECT coalesce(jsonb_agg(x ORDER BY x.admission_number), '[]') INTO rows FROM (
    SELECT c.id AS card_id, c.status, c.revision_no, c.student_id, s.admission_number, s.full_name AS student_name, c.stream_id, tr.is_complete, tr.mean_percentage, tr.overall_grade, tr.class_position, tr.class_size,
           c.published_at, c.correction_reason, (c.class_teacher_remarks IS NOT NULL) AS has_ct_remarks, (c.head_remarks IS NOT NULL) AS has_head_remarks
      FROM elimu_report_cards c JOIN elimu_ref_students s ON s.id = c.student_id AND s.tenant_id = t JOIN elimu_term_results tr ON tr.id = c.term_result_id
     WHERE c.tenant_id = t AND c.academic_year_id = p_year AND c.term_id = p_term AND c.class_id = p_class AND c.status <> 'SUPERSEDED' AND (p_stream IS NULL OR c.stream_id = p_stream)
       AND (p_status IS NULL OR c.status = p_status) AND (q IS NULL OR s.full_name ILIKE '%' || q || '%' OR s.admission_number ILIKE '%' || q || '%')
     ORDER BY s.admission_number OFFSET greatest(p_offset, 0) LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)) x;
  RETURN jsonb_build_object('ok', true, 'total', total, 'counts', v_counts, 'rows', rows);
END $$;

-- Academic year -> term -> class -> subject -> assessments -> result, for one student. Every entry hangs on its own enrollment, so a class change never
-- rewrites earlier terms. Returns CURRENT revisions only. Staff outside view.all see only classes they are class teacher of.
CREATE OR REPLACE FUNCTION elimu_student_history(p_student uuid, p_published_only boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id(); out jsonb;
BEGIN
  IF NOT elimu_any_role() THEN RAISE EXCEPTION 'You do not have permission to see this.' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(jsonb_agg(e ORDER BY e.year_name, e.term_sequence), '[]') INTO out FROM (
    SELECT ay.id AS academic_year_id, ay.name AS year_name, tm.id AS term_id, tm.name AS term_name, tm.sequence_no AS term_sequence,
           tr.enrollment_id, tr.class_id, cl.name AS class_name, tr.stream_id, st.name AS stream_name, tr.id AS term_result_id, tr.revision,
           tr.mean_percentage, tr.overall_grade, tr.overall_grade_point, tr.class_position, tr.class_size, tr.is_complete,
           (SELECT status FROM elimu_report_cards c WHERE c.term_result_id = tr.id ORDER BY revision_no DESC LIMIT 1) AS card_status,
           (SELECT coalesce(jsonb_agg(jsonb_build_object('subject_id', sr.subject_id, 'subject', s.name, 'code', s.code, 'completeness', sr.completeness, 'percentage', sr.percentage,
                     'grade', sr.grade, 'grade_point', sr.grade_point, 'assessments', sr.breakdown) ORDER BY s.sort_order, s.name), '[]')
              FROM elimu_subject_results sr JOIN elimu_subjects s ON s.id = sr.subject_id WHERE sr.term_result_id = tr.id) AS subjects
      FROM elimu_term_results tr
      JOIN elimu_ref_academic_years ay ON ay.id = tr.academic_year_id AND ay.tenant_id = t
      JOIN elimu_ref_terms tm ON tm.id = tr.term_id AND tm.tenant_id = t
      JOIN elimu_ref_classes cl ON cl.id = tr.class_id AND cl.tenant_id = t
      LEFT JOIN elimu_ref_streams st ON st.id = tr.stream_id AND st.tenant_id = t
     WHERE tr.tenant_id = t AND tr.student_id = p_student AND tr.is_current
       AND (elimu_can('view.all') OR elimu_is_class_teacher(tr.academic_year_id, tr.class_id, tr.stream_id))
       AND (NOT p_published_only OR EXISTS (SELECT 1 FROM elimu_report_cards c WHERE c.term_result_id = tr.id AND c.status = 'PUBLISHED'))) e;
  RETURN jsonb_build_object('ok', true, 'entries', out);
END $$;

-- Mark-level history for one assessment+student (who entered / changed what, when, why).
CREATE OR REPLACE FUNCTION elimu_mark_history_for(p_assessment uuid, p_enrollment uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT elimu_can_see_assessment(p_assessment) THEN RAISE EXCEPTION 'Not found.' USING ERRCODE = 'P0002'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('at', h.at, 'action', h.action, 'old_status', h.old_status, 'new_status', h.new_status, 'old_marks', h.old_marks, 'new_marks', h.new_marks,
            'reason', h.reason, 'by', (SELECT name FROM pos_staff WHERE id = h.actor_staff_id)) ORDER BY h.at)
     FROM elimu_mark_history h WHERE h.assessment_id = p_assessment AND h.enrollment_id = p_enrollment AND h.tenant_id = get_current_tenant_id()), '[]');
END $$;

GRANT EXECUTE ON FUNCTION elimu_report_payload(uuid,uuid), elimu_generate_report_cards(uuid,uuid,uuid,uuid), elimu_save_report_remarks(uuid,text,text,boolean,boolean),
  elimu_save_subject_remark(uuid,text), elimu_report_card_transition(uuid,text,text,boolean), elimu_bulk_transition(uuid[],text,text,boolean),
  elimu_open_correction(uuid,text), elimu_correct_published_mark(uuid,uuid,text,numeric,text,text), elimu_get_report_cards(uuid[]),
  elimu_list_report_cards(uuid,uuid,uuid,uuid,text,text,integer,integer), elimu_student_history(uuid,boolean), elimu_mark_history_for(uuid,uuid) TO authenticated;
