-- ============================================================
-- ELIMU Report cards — 41 RESULT COMPUTATION. Run after 40_results_reportcards.sql (+ 20, 30, 31). Re-runnable.
--
-- RULES (mirrored by report_cards/utils/resultEngine.js, which the JS tests keep in step with this file):
--   * A subject result uses the assessments that apply to the student: same year/term/class, stream NULL or the student's stream,
--     status <> CANCELLED, weight > 0.  Their weights must add up to 100 (school tolerance) else WEIGHTS_INVALID.
--   * Only SUBMITTED marks count. No row / PENDING / still DRAFT  =>  the subject is INCOMPLETE (no percentage, no grade).
--   * EXEMPTED is left out and the remaining weights are re-scaled. ABSENT and NOT_SUBMITTED follow the school settings
--     (ZERO = counts as 0, EXCLUDE = left out). A blank is never turned into zero silently.
--   * percentage = sum(percent_i * weight_i) / sum(weights counted);  percent_i = obtained / max * 100.
--   * Grade/points come from elimu_grade_lookup() on the scheme resolved for (subject, class). The literal values are stored.
--   * Overall = mean of COMPLETE subject percentages; overall grade only when EVERY expected subject is complete.
--   * Locked (approved) results are skipped. Positions only rank students whose results are complete.
-- ============================================================

CREATE OR REPLACE FUNCTION elimu_compute_one(p_enrollment uuid, p_term uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t uuid := get_current_tenant_id(); en record; st elimu_academic_settings; tr elimu_term_results; tm record;
  sub record; asm record; comps jsonb; issues jsonb; w_total numeric; w_incl numeric; acc numeric; raw_o numeric; raw_m numeric; pct numeric;
  compl text; v_scheme uuid; v_rule uuid; v_grade text; v_gp numeric; v_desc text; v_rem text; v_pass boolean; v_state text; v_pc numeric; v_included boolean;
  v_all_exempt boolean; v_incomplete boolean; seen uuid[] := ARRAY[]::uuid[];
  n_expected int := 0; n_complete int := 0; sum_pct numeric := 0; sum_gp numeric := 0; n_gp int := 0; mean numeric; o_scheme uuid; o_grade text; o_gp numeric; o_desc text; o_rem text;
BEGIN
  SELECT id, student_id, academic_year_id, class_id, stream_id INTO en FROM elimu_ref_enrollments WHERE id = p_enrollment AND tenant_id = t;
  IF en.id IS NULL THEN RAISE EXCEPTION 'Unknown enrollment.' USING ERRCODE = '23503'; END IF;
  SELECT id, academic_year_id INTO tm FROM elimu_ref_terms WHERE id = p_term AND tenant_id = t;
  IF tm.id IS NULL OR tm.academic_year_id <> en.academic_year_id THEN RAISE EXCEPTION 'That term does not belong to the student''s academic year.' USING ERRCODE = '23514'; END IF;
  INSERT INTO elimu_academic_settings (tenant_id) VALUES (t) ON CONFLICT DO NOTHING;
  SELECT * INTO st FROM elimu_academic_settings WHERE tenant_id = t;

  SELECT * INTO tr FROM elimu_term_results WHERE enrollment_id = p_enrollment AND term_id = p_term AND is_current;
  IF tr.id IS NOT NULL AND tr.locked_at IS NOT NULL THEN RETURN 'LOCKED'; END IF;
  PERFORM set_config('elimu.result_admin', 'on', true);
  IF tr.id IS NULL THEN
    INSERT INTO elimu_term_results (tenant_id, academic_year_id, term_id, enrollment_id, student_id, class_id, stream_id, revision, computed_by)
    VALUES (t, en.academic_year_id, p_term, p_enrollment, en.student_id, en.class_id, en.stream_id,
            coalesce((SELECT max(revision) FROM elimu_term_results WHERE enrollment_id = p_enrollment AND term_id = p_term), 0) + 1, elimu_staff_id())
    RETURNING * INTO tr;
  END IF;

  FOR sub IN
    SELECT s.id, s.code, s.name,
           coalesce((SELECT al.is_compulsory FROM elimu_subject_allocations al WHERE al.tenant_id = t AND al.status = 'ACTIVE' AND al.academic_year_id = en.academic_year_id
                      AND al.class_id = en.class_id AND al.subject_id = s.id AND (al.term_id IS NULL OR al.term_id = p_term) AND al.is_compulsory IS NOT NULL LIMIT 1), s.is_compulsory) AS compulsory
      FROM elimu_subjects s
     WHERE s.tenant_id = t AND s.id IN (
        SELECT a.subject_id FROM elimu_assessments a
         WHERE a.tenant_id = t AND a.academic_year_id = en.academic_year_id AND a.term_id = p_term AND a.class_id = en.class_id
           AND (a.stream_id IS NULL OR a.stream_id = en.stream_id) AND a.status <> 'CANCELLED'
        UNION
        SELECT al.subject_id FROM elimu_subject_allocations al
         WHERE al.tenant_id = t AND al.status = 'ACTIVE' AND al.academic_year_id = en.academic_year_id AND (al.term_id IS NULL OR al.term_id = p_term)
           AND al.class_id = en.class_id AND (al.stream_id IS NULL OR al.stream_id = en.stream_id))
     ORDER BY s.sort_order, s.name
  LOOP
    IF NOT sub.compulsory AND NOT EXISTS (SELECT 1 FROM elimu_student_subject_selections x WHERE x.enrollment_id = p_enrollment AND x.subject_id = sub.id AND x.status = 'ACTIVE' AND (x.term_id IS NULL OR x.term_id = p_term)) THEN
      CONTINUE;                                                -- an elective this student does not take
    END IF;
    comps := '[]'; issues := '[]'; w_total := 0; w_incl := 0; acc := 0; raw_o := 0; raw_m := 0; v_incomplete := false; v_all_exempt := true; pct := NULL;
    v_grade := NULL; v_gp := NULL; v_desc := NULL; v_rem := NULL; v_pass := NULL; v_scheme := NULL; v_rule := NULL;

    FOR asm IN
      SELECT a.id, a.name, a.max_marks, a.weight, a.assessment_date, ty.name AS type_name, m.mark_status, m.obtained_marks, m.entry_status
        FROM elimu_assessments a JOIN elimu_assessment_types ty ON ty.id = a.assessment_type_id
        LEFT JOIN elimu_marks m ON m.assessment_id = a.id AND m.enrollment_id = p_enrollment AND m.voided_at IS NULL
       WHERE a.tenant_id = t AND a.academic_year_id = en.academic_year_id AND a.term_id = p_term AND a.class_id = en.class_id
         AND (a.stream_id IS NULL OR a.stream_id = en.stream_id) AND a.subject_id = sub.id AND a.status <> 'CANCELLED' AND a.weight > 0
       ORDER BY a.assessment_date NULLS LAST, a.created_at
    LOOP
      w_total := w_total + asm.weight; v_pc := NULL; v_included := false;
      IF asm.mark_status IS NULL OR asm.mark_status = 'PENDING' THEN v_state := 'PENDING'; v_incomplete := true; v_all_exempt := false;
        issues := issues || jsonb_build_object('code', 'PENDING', 'assessment', asm.name);
      ELSIF asm.entry_status <> 'SUBMITTED' THEN v_state := 'NOT_FINAL'; v_incomplete := true; v_all_exempt := false;
        issues := issues || jsonb_build_object('code', 'NOT_SUBMITTED_BY_TEACHER', 'assessment', asm.name);
      ELSIF asm.mark_status = 'EXEMPTED' THEN v_state := 'EXEMPTED';
      ELSIF asm.mark_status = 'ABSENT' THEN v_all_exempt := false;
        IF st.absent_policy = 'ZERO' THEN v_state := 'ABSENT_ZERO'; v_pc := 0; v_included := true; ELSE v_state := 'ABSENT_EXCLUDED'; END IF;
      ELSIF asm.mark_status = 'NOT_SUBMITTED' THEN v_all_exempt := false;
        IF st.not_submitted_policy = 'ZERO' THEN v_state := 'NOT_SUBMITTED_ZERO'; v_pc := 0; v_included := true; ELSE v_state := 'NOT_SUBMITTED_EXCLUDED'; END IF;
      ELSE v_state := 'COUNTED'; v_all_exempt := false; v_pc := round(asm.obtained_marks / asm.max_marks * 100, 4); v_included := true;
      END IF;
      IF v_included THEN
        w_incl := w_incl + asm.weight; acc := acc + v_pc * asm.weight; raw_m := raw_m + asm.max_marks; raw_o := raw_o + coalesce(asm.obtained_marks, 0);
      END IF;
      comps := comps || jsonb_build_object('assessment_id', asm.id, 'name', asm.name, 'type', asm.type_name, 'date', asm.assessment_date, 'max_marks', asm.max_marks,
                 'weight', asm.weight, 'mark_status', coalesce(asm.mark_status, 'PENDING'), 'obtained_marks', asm.obtained_marks, 'percent', v_pc, 'included', v_included, 'state', v_state);
    END LOOP;

    IF jsonb_array_length(comps) = 0 THEN compl := 'NO_ASSESSMENTS'; issues := issues || jsonb_build_object('code', 'NO_ASSESSMENTS');
    ELSIF abs(w_total - 100) > st.weight_tolerance THEN compl := 'WEIGHTS_INVALID'; issues := issues || jsonb_build_object('code', 'WEIGHTS_INVALID', 'total', w_total);
    ELSIF v_incomplete THEN compl := 'INCOMPLETE';
    ELSIF v_all_exempt OR w_incl = 0 THEN
      -- every component exempt / excluded: the subject does not apply to this student this term
      IF v_all_exempt THEN
        DELETE FROM elimu_subject_results WHERE term_result_id = tr.id AND subject_id = sub.id;
        CONTINUE;
      END IF;
      compl := 'NO_ASSESSMENTS'; issues := issues || jsonb_build_object('code', 'ALL_EXCLUDED');
    ELSE
      compl := 'COMPLETE'; pct := round(acc / w_incl, 3);
      v_scheme := elimu_resolve_scheme(sub.id, en.class_id);
      IF v_scheme IS NULL THEN issues := issues || jsonb_build_object('code', 'NO_GRADING_SCHEME');
      ELSE SELECT rule_id, grade, grade_point, descriptor, remark, is_pass INTO v_rule, v_grade, v_gp, v_desc, v_rem, v_pass FROM elimu_grade_lookup(v_scheme, pct);
        IF v_grade IS NULL THEN issues := issues || jsonb_build_object('code', 'NO_MATCHING_BAND', 'percentage', pct); END IF;
      END IF;
    END IF;

    seen := seen || sub.id; n_expected := n_expected + 1;
    IF compl = 'COMPLETE' THEN n_complete := n_complete + 1; sum_pct := sum_pct + pct; IF v_gp IS NOT NULL THEN sum_gp := sum_gp + v_gp; n_gp := n_gp + 1; END IF; END IF;

    INSERT INTO elimu_subject_results (tenant_id, term_result_id, academic_year_id, term_id, enrollment_id, student_id, class_id, stream_id, subject_id, completeness,
        raw_obtained, raw_max, weighted_score, percentage, grade, grade_point, grade_descriptor, grade_remark, is_pass, grading_scheme_id, grading_rule_id, breakdown, issues)
    VALUES (t, tr.id, en.academic_year_id, p_term, p_enrollment, en.student_id, en.class_id, en.stream_id, sub.id, compl,
        raw_o, raw_m, CASE WHEN compl = 'COMPLETE' THEN pct END, CASE WHEN compl = 'COMPLETE' THEN pct END, v_grade, v_gp, v_desc, v_rem, v_pass, v_scheme, v_rule, comps, issues)
    ON CONFLICT (term_result_id, subject_id) DO UPDATE SET completeness = EXCLUDED.completeness, raw_obtained = EXCLUDED.raw_obtained, raw_max = EXCLUDED.raw_max,
        weighted_score = EXCLUDED.weighted_score, percentage = EXCLUDED.percentage, grade = EXCLUDED.grade, grade_point = EXCLUDED.grade_point,
        grade_descriptor = EXCLUDED.grade_descriptor, grade_remark = EXCLUDED.grade_remark, is_pass = EXCLUDED.is_pass, grading_scheme_id = EXCLUDED.grading_scheme_id,
        grading_rule_id = EXCLUDED.grading_rule_id, breakdown = EXCLUDED.breakdown, issues = EXCLUDED.issues,
        stream_id = EXCLUDED.stream_id, class_id = EXCLUDED.class_id;       -- teacher_remark is deliberately NOT touched
  END LOOP;

  DELETE FROM elimu_subject_results WHERE term_result_id = tr.id AND subject_id <> ALL (seen);   -- subjects that no longer apply

  IF n_complete > 0 THEN mean := round(sum_pct / n_complete, 3); END IF;
  o_scheme := elimu_resolve_scheme(NULL, en.class_id);
  IF n_expected > 0 AND n_complete = n_expected AND o_scheme IS NOT NULL THEN
    SELECT grade, descriptor, remark INTO o_grade, o_desc, o_rem FROM elimu_grade_lookup(o_scheme, mean);
  END IF;
  IF n_gp > 0 THEN o_gp := round(sum_gp / n_gp, 3); END IF;
  UPDATE elimu_term_results SET subjects_expected = n_expected, subjects_complete = n_complete, is_complete = (n_expected > 0 AND n_complete = n_expected),
      total_percentage = CASE WHEN n_complete > 0 THEN round(sum_pct, 3) END, mean_percentage = mean,
      overall_grade = o_grade, overall_grade_point = CASE WHEN n_expected > 0 AND n_complete = n_expected THEN o_gp END, overall_descriptor = o_desc, overall_remark = o_rem,
      grading_scheme_id = o_scheme, computed_at = now(), computed_by = elimu_staff_id(), class_id = en.class_id, stream_id = en.stream_id,
      compute_params = jsonb_build_object('absent_policy', st.absent_policy, 'not_submitted_policy', st.not_submitted_policy, 'weight_tolerance', st.weight_tolerance)
   WHERE id = tr.id;
  RETURN 'COMPUTED';
END $$;
REVOKE ALL ON FUNCTION elimu_compute_one(uuid, uuid) FROM PUBLIC;

-- Positions: only complete, UNLOCKED results are (re)ranked; locked ones keep the positions they were approved with.
CREATE OR REPLACE FUNCTION elimu_rank_class(p_year uuid, p_term uuid, p_class uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id();
BEGIN
  PERFORM set_config('elimu.result_admin', 'on', true);
  UPDATE elimu_term_results r SET class_position = NULL, class_size = NULL, stream_position = NULL, stream_size = NULL
   WHERE r.tenant_id = t AND r.academic_year_id = p_year AND r.term_id = p_term AND r.class_id = p_class AND r.is_current AND r.locked_at IS NULL AND NOT r.is_complete;
  UPDATE elimu_term_results r SET class_position = x.pos, class_size = x.sz, stream_position = x.spos, stream_size = x.ssz
    FROM (SELECT id, rank() OVER (ORDER BY mean_percentage DESC) AS pos, count(*) OVER () AS sz,
                 rank() OVER (PARTITION BY stream_id ORDER BY mean_percentage DESC) AS spos, count(*) OVER (PARTITION BY stream_id) AS ssz
            FROM elimu_term_results WHERE tenant_id = t AND academic_year_id = p_year AND term_id = p_term AND class_id = p_class AND is_current AND is_complete) x
   WHERE r.id = x.id AND r.locked_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION elimu_rank_class(uuid, uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION elimu_compute_term_results(p_year uuid, p_term uuid, p_class uuid, p_stream uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id(); e record; r text; n_done int := 0; n_locked int := 0; n int := 0; n_complete int := 0; n_incomplete int := 0;
BEGIN
  IF NOT elimu_can('results.compute') THEN RAISE EXCEPTION 'You do not have permission to compute results.' USING ERRCODE = '42501'; END IF;
  IF NOT (elimu_ref_exists('year', p_year) AND elimu_ref_exists('term', p_term) AND elimu_ref_exists('class', p_class)) THEN RAISE EXCEPTION 'Unknown year, term or class.' USING ERRCODE = '23503'; END IF;
  FOR e IN SELECT en.id FROM elimu_ref_enrollments en
            WHERE en.tenant_id = t AND en.academic_year_id = p_year AND en.class_id = p_class AND (p_stream IS NULL OR en.stream_id = p_stream)
              AND (en.status IN ('ACTIVE','COMPLETED') OR EXISTS (SELECT 1 FROM elimu_marks m JOIN elimu_assessments a ON a.id = m.assessment_id WHERE m.enrollment_id = en.id AND a.term_id = p_term AND m.voided_at IS NULL))
            ORDER BY en.id LOOP
    n := n + 1;
    r := elimu_compute_one(e.id, p_term);
    IF r = 'LOCKED' THEN n_locked := n_locked + 1; ELSE n_done := n_done + 1; END IF;
  END LOOP;
  PERFORM elimu_rank_class(p_year, p_term, p_class);
  SELECT count(*) FILTER (WHERE is_complete), count(*) FILTER (WHERE NOT is_complete) INTO n_complete, n_incomplete
    FROM elimu_term_results WHERE tenant_id = t AND academic_year_id = p_year AND term_id = p_term AND class_id = p_class AND is_current AND (p_stream IS NULL OR stream_id = p_stream);
  PERFORM set_config('elimu.result_admin', 'off', true);
  PERFORM elimu_audit('RESULTS_COMPUTED', 'elimu_term_results', p_class, jsonb_build_object('year', p_year, 'term', p_term, 'class', p_class, 'stream', p_stream,
          'students', n, 'computed', n_done, 'skipped_locked', n_locked, 'complete', n_complete, 'incomplete', n_incomplete));
  RETURN jsonb_build_object('ok', true, 'students', n, 'computed', n_done, 'skipped_locked', n_locked, 'complete', n_complete, 'incomplete', n_incomplete);
END $$;

-- Paginated results table for one class/term (what the Term Results screen shows).
CREATE OR REPLACE FUNCTION elimu_list_term_results(p_year uuid, p_term uuid, p_class uuid, p_stream uuid DEFAULT NULL, p_search text DEFAULT NULL,
                                                   p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id(); q text := nullif(btrim(p_search), ''); rows jsonb; total int;
BEGIN
  IF NOT (elimu_can('view.all') OR elimu_is_class_teacher(p_year, p_class, p_stream)) THEN RAISE EXCEPTION 'You do not have permission to see these results.' USING ERRCODE = '42501'; END IF;
  SELECT count(*) INTO total FROM elimu_term_results r JOIN elimu_ref_students s ON s.id = r.student_id AND s.tenant_id = t
   WHERE r.tenant_id = t AND r.academic_year_id = p_year AND r.term_id = p_term AND r.class_id = p_class AND r.is_current AND (p_stream IS NULL OR r.stream_id = p_stream)
     AND (q IS NULL OR s.full_name ILIKE '%' || q || '%' OR s.admission_number ILIKE '%' || q || '%');
  SELECT coalesce(jsonb_agg(x ORDER BY x.class_position NULLS LAST, x.admission_number), '[]') INTO rows FROM (
    SELECT r.id AS term_result_id, r.enrollment_id, r.student_id, s.admission_number, s.full_name AS student_name, r.stream_id, r.is_complete, r.subjects_expected, r.subjects_complete,
           r.mean_percentage, r.overall_grade, r.overall_grade_point, r.class_position, r.class_size, r.stream_position, r.locked_at IS NOT NULL AS locked, r.revision,
           (SELECT jsonb_build_object('id', c.id, 'status', c.status, 'revision_no', c.revision_no) FROM elimu_report_cards c WHERE c.term_result_id = r.id ORDER BY c.revision_no DESC LIMIT 1) AS report_card
      FROM elimu_term_results r JOIN elimu_ref_students s ON s.id = r.student_id AND s.tenant_id = t
     WHERE r.tenant_id = t AND r.academic_year_id = p_year AND r.term_id = p_term AND r.class_id = p_class AND r.is_current AND (p_stream IS NULL OR r.stream_id = p_stream)
       AND (q IS NULL OR s.full_name ILIKE '%' || q || '%' OR s.admission_number ILIKE '%' || q || '%')
     ORDER BY r.class_position NULLS LAST, s.admission_number OFFSET greatest(p_offset, 0) LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)) x;
  RETURN jsonb_build_object('ok', true, 'total', total, 'rows', rows);
END $$;

GRANT EXECUTE ON FUNCTION elimu_compute_term_results(uuid,uuid,uuid,uuid), elimu_list_term_results(uuid,uuid,uuid,uuid,text,integer,integer) TO authenticated;
