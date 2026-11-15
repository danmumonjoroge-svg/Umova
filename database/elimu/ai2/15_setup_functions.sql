-- ============================================================
-- ELIMU Academic — 15 SET-UP FUNCTIONS (RPCs). Run after 10_core.sql, 20_grading.sql, 30_exams.sql. Re-runnable.
-- All are SECURITY DEFINER, tenant-scoped by get_current_tenant_id(), and check elimu_can() themselves.
-- ============================================================

-- What may the signed-in person do? (UI uses this only to decide what to SHOW; the database decides every write.)
-- UNIFIED shape: AI 2's `can` map + AI 3's `actions` list, over the single elimu_staff_roles table.
CREATE OR REPLACE FUNCTION elimu_my_access() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE acts text[] := ARRAY['config.manage','view.all','marks.manage_all','assessment.create','marks.enter','marks.unlock','assessment.lock',
  'results.compute','reportcard.review','reportcard.approve','reportcard.publish','reportcard.correct','remarks.head','comm.send']; a text; can jsonb := '{}';
  v_roles text[]; v_owner boolean; v_actions text[]; t uuid := get_current_tenant_id();
BEGIN
  IF NOT elimu_staff_ok() THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_STAFF'); END IF;
  v_owner := is_pos_owner();
  FOREACH a IN ARRAY acts LOOP can := can || jsonb_build_object(a, elimu_can(a)); END LOOP;
  SELECT coalesce(array_agg(DISTINCT r.role), '{}') INTO v_roles FROM elimu_staff_roles r WHERE r.staff_id = elimu_staff_id() AND r.tenant_id = t;
  IF v_owner THEN
    SELECT array_agg(DISTINCT x) INTO v_actions FROM unnest(elimu_role_actions('school_admin') || elimu_role_actions('principal') || elimu_role_actions('bursar') || ARRAY['roles.manage']) x;
  ELSE
    SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_actions FROM unnest(v_roles) ro, LATERAL unnest(elimu_role_actions(ro)) x;
  END IF;
  RETURN jsonb_build_object('ok', true, 'staff_id', elimu_staff_id(), 'tenant_id', t, 'is_owner', v_owner, 'roles', to_jsonb(v_roles),
    'actions', to_jsonb(coalesce(v_actions, '{}')),
    'is_teacher', EXISTS (SELECT 1 FROM elimu_subject_allocations WHERE tenant_id = t AND teacher_staff_id = elimu_staff_id() AND status = 'ACTIVE'),
    'is_class_teacher', EXISTS (SELECT 1 FROM elimu_class_teachers WHERE tenant_id = t AND teacher_staff_id = elimu_staff_id() AND status = 'ACTIVE'),
    'can', can);
END $$;

-- Owner-only: give / take an academic role. Kept for AI 2's UI; maps the old names onto the unified role table.
CREATE OR REPLACE FUNCTION elimu_set_academic_role(p_staff uuid, p_role text, p_granted boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v text;
BEGIN
  v := CASE upper(p_role) WHEN 'ACADEMIC_ADMIN' THEN 'academic_admin' WHEN 'HEADTEACHER' THEN 'headteacher'
                          WHEN 'EXAMS_OFFICER' THEN 'exams_officer' WHEN 'TEACHER' THEN 'subject_teacher' ELSE NULL END;
  IF v IS NULL THEN RAISE EXCEPTION 'Unknown role.' USING ERRCODE = '22023'; END IF;
  RETURN elimu_set_role(p_staff, v, p_granted);
END $$;

-- Staff directory for pickers (teachers, class teachers). Only id/name/phone/role: nothing sensitive.
CREATE OR REPLACE FUNCTION elimu_list_staff() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (elimu_can('config.manage') OR elimu_can('marks.manage_all')) THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'phone', s.phone, 'pos_role', s.role, 'status', s.status,
           'academic_roles', (SELECT coalesce(jsonb_agg(r.role ORDER BY r.role), '[]') FROM elimu_staff_roles r WHERE r.staff_id = s.id AND r.tenant_id = s.pos_tenant_id)) ORDER BY s.name)
     FROM pos_staff s WHERE s.pos_tenant_id = get_current_tenant_id() AND s.status = 'active'), '[]');
END $$;

CREATE OR REPLACE FUNCTION elimu_get_settings() RETURNS elimu_academic_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r elimu_academic_settings;
BEGIN
  IF NOT elimu_any_role() THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  INSERT INTO elimu_academic_settings (tenant_id) VALUES (get_current_tenant_id()) ON CONFLICT DO NOTHING;
  SELECT * INTO r FROM elimu_academic_settings WHERE tenant_id = get_current_tenant_id();
  RETURN r;
END $$;

-- First-run data: editable examples, NOT rules of the system. Only fills what is missing; never overwrites.
CREATE OR REPLACE FUNCTION elimu_seed_defaults() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id(); n_types int := 0; sid uuid; r int;
BEGIN
  IF NOT elimu_can('config.manage') THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  INSERT INTO elimu_academic_settings (tenant_id) VALUES (t) ON CONFLICT DO NOTHING;
  INSERT INTO elimu_assessment_types (tenant_id, code, name, is_examination, sort_order) VALUES
    (t,'CAT','Continuous Assessment Test',false,10), (t,'QUIZ','Quiz',false,20), (t,'ASSIGN','Assignment',false,30), (t,'PROJECT','Project',false,40),
    (t,'PRACTICAL','Practical',false,50), (t,'MIDTERM','Mid-Term Exam',true,60), (t,'ENDTERM','End-Term Exam',true,70), (t,'EXAM','Examination',true,80),
    (t,'CA','Continuous Assessment',false,90), (t,'OTHER','Other',false,100)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n_types = ROW_COUNT;
  IF NOT EXISTS (SELECT 1 FROM elimu_grading_schemes WHERE tenant_id = t) THEN
    sid := gen_random_uuid();
    INSERT INTO elimu_grading_schemes (id, tenant_id, name, description, is_default, percent_decimals)
      VALUES (sid, t, 'Standard A-E (example - edit to match your school)', 'Example scheme created on first run. Change it, or create your own.', true, 0);
    INSERT INTO elimu_grading_rules (tenant_id, scheme_id, grade, min_percent, max_percent, grade_point, descriptor, remark, is_pass, sort_order) VALUES
      (t,sid,'A',80,100,4,'Excellent','Excellent work. Keep it up.',true,1),
      (t,sid,'B',70,79,3,'Very Good','Very good performance.',true,2),
      (t,sid,'C',60,69,2,'Good','Good. Aim higher.',true,3),
      (t,sid,'D',50,59,1,'Fair','Fair. More effort is needed.',true,4),
      (t,sid,'E',0,49,0,'Needs Improvement','Needs urgent improvement.',false,5);
    GET DIAGNOSTICS r = ROW_COUNT;
  END IF;
  PERFORM elimu_audit('ACADEMIC_DEFAULTS_SEEDED', 'elimu_academic_settings', t, jsonb_build_object('assessment_types_added', n_types));
  RETURN jsonb_build_object('ok', true, 'assessment_types_added', n_types, 'scheme_created', sid IS NOT NULL);
END $$;

-- ---------------------------------------------------------------- allocations
-- Assign a subject to a class (/stream) for a year (/term), optionally with a teacher.
-- p_replace = true (default): any ACTIVE assignment for the same subject + scope held by a DIFFERENT teacher (or nobody) is ENDED
-- (kept as history). p_replace = false adds a co-teacher.
CREATE OR REPLACE FUNCTION elimu_assign_subject(p_year uuid, p_term uuid, p_class uuid, p_stream uuid, p_subject uuid, p_teacher uuid,
                                               p_compulsory boolean DEFAULT NULL, p_replace boolean DEFAULT true) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id(); v_id uuid; ended int := 0; nil uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
  IF NOT elimu_can('config.manage') THEN RAISE EXCEPTION 'You do not have permission to assign subjects.' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_id FROM elimu_subject_allocations
   WHERE tenant_id = t AND status = 'ACTIVE' AND academic_year_id = p_year AND coalesce(term_id, nil) = coalesce(p_term, nil) AND class_id = p_class
     AND coalesce(stream_id, nil) = coalesce(p_stream, nil) AND subject_id = p_subject AND coalesce(teacher_staff_id, nil) = coalesce(p_teacher, nil);
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;                       -- already exactly this: idempotent
  IF p_replace THEN
    UPDATE elimu_subject_allocations SET status = 'ENDED', ended_at = now(), ended_by = elimu_staff_id(), ended_reason = 'Replaced by a new assignment'
     WHERE tenant_id = t AND status = 'ACTIVE' AND academic_year_id = p_year AND coalesce(term_id, nil) = coalesce(p_term, nil) AND class_id = p_class
       AND coalesce(stream_id, nil) = coalesce(p_stream, nil) AND subject_id = p_subject;
    GET DIAGNOSTICS ended = ROW_COUNT;
  END IF;
  INSERT INTO elimu_subject_allocations (tenant_id, academic_year_id, term_id, class_id, stream_id, subject_id, teacher_staff_id, is_compulsory)
  VALUES (t, p_year, p_term, p_class, p_stream, p_subject, p_teacher, p_compulsory) RETURNING id INTO v_id;
  PERFORM elimu_audit('SUBJECT_ALLOCATED', 'elimu_subject_allocations', v_id, jsonb_build_object('class_id', p_class, 'stream_id', p_stream, 'subject_id', p_subject, 'teacher_staff_id', p_teacher, 'ended_previous', ended));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION elimu_end_allocation(p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT elimu_can('config.manage') THEN RAISE EXCEPTION 'You do not have permission to change assignments.' USING ERRCODE = '42501'; END IF;
  UPDATE elimu_subject_allocations SET status = 'ENDED', ended_at = now(), ended_by = elimu_staff_id(), ended_reason = coalesce(nullif(btrim(p_reason), ''), 'Ended')
   WHERE id = p_id AND tenant_id = get_current_tenant_id() AND status = 'ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION 'Active assignment not found.' USING ERRCODE = 'P0002'; END IF;
  PERFORM elimu_audit('SUBJECT_ALLOCATION_ENDED', 'elimu_subject_allocations', p_id, jsonb_build_object('reason', p_reason));
END $$;

CREATE OR REPLACE FUNCTION elimu_set_class_teacher(p_year uuid, p_class uuid, p_stream uuid, p_teacher uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id(); v_id uuid; nil uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
  IF NOT elimu_can('config.manage') THEN RAISE EXCEPTION 'You do not have permission to assign class teachers.' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_id FROM elimu_class_teachers WHERE tenant_id = t AND status = 'ACTIVE' AND academic_year_id = p_year AND class_id = p_class
     AND coalesce(stream_id, nil) = coalesce(p_stream, nil) AND teacher_staff_id = p_teacher;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  UPDATE elimu_class_teachers SET status = 'ENDED', ended_at = now(), ended_by = elimu_staff_id(), ended_reason = 'Replaced'
   WHERE tenant_id = t AND status = 'ACTIVE' AND academic_year_id = p_year AND class_id = p_class AND coalesce(stream_id, nil) = coalesce(p_stream, nil);
  INSERT INTO elimu_class_teachers (tenant_id, academic_year_id, class_id, stream_id, teacher_staff_id) VALUES (t, p_year, p_class, p_stream, p_teacher) RETURNING id INTO v_id;
  PERFORM elimu_audit('CLASS_TEACHER_ASSIGNED', 'elimu_class_teachers', v_id, jsonb_build_object('class_id', p_class, 'stream_id', p_stream, 'teacher_staff_id', p_teacher));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION elimu_end_class_teacher(p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT elimu_can('config.manage') THEN RAISE EXCEPTION 'You do not have permission to assign class teachers.' USING ERRCODE = '42501'; END IF;
  UPDATE elimu_class_teachers SET status = 'ENDED', ended_at = now(), ended_by = elimu_staff_id(), ended_reason = coalesce(nullif(btrim(p_reason), ''), 'Ended')
   WHERE id = p_id AND tenant_id = get_current_tenant_id() AND status = 'ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION 'Active assignment not found.' USING ERRCODE = 'P0002'; END IF;
END $$;

-- ---------------------------------------------------------------- elective choices
CREATE OR REPLACE FUNCTION elimu_select_elective(p_enrollment uuid, p_subject uuid, p_term uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id(); e record; v_id uuid;
BEGIN
  IF NOT (elimu_can('config.manage') OR elimu_can('marks.manage_all')) THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  SELECT student_id, academic_year_id INTO e FROM elimu_ref_enrollments WHERE id = p_enrollment AND tenant_id = t;
  IF e.student_id IS NULL THEN RAISE EXCEPTION 'Unknown enrollment.' USING ERRCODE = '23503'; END IF;
  IF NOT EXISTS (SELECT 1 FROM elimu_subjects WHERE id = p_subject AND tenant_id = t AND is_active) THEN RAISE EXCEPTION 'Unknown or inactive subject.' USING ERRCODE = '23503'; END IF;
  INSERT INTO elimu_student_subject_selections (tenant_id, enrollment_id, student_id, academic_year_id, subject_id, term_id, created_by)
  VALUES (t, p_enrollment, e.student_id, e.academic_year_id, p_subject, p_term, elimu_staff_id())
  ON CONFLICT (enrollment_id, subject_id, coalesce(term_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE status = 'ACTIVE' DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION elimu_end_elective(p_enrollment uuid, p_subject uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF NOT (elimu_can('config.manage') OR elimu_can('marks.manage_all')) THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  UPDATE elimu_student_subject_selections SET status = 'ENDED', ended_at = now()
   WHERE tenant_id = get_current_tenant_id() AND enrollment_id = p_enrollment AND subject_id = p_subject AND status = 'ACTIVE';
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION elimu_my_access(), elimu_set_academic_role(uuid,text,boolean), elimu_list_staff(), elimu_get_settings(), elimu_seed_defaults(),
  elimu_assign_subject(uuid,uuid,uuid,uuid,uuid,uuid,boolean,boolean), elimu_end_allocation(uuid,text), elimu_set_class_teacher(uuid,uuid,uuid,uuid),
  elimu_end_class_teacher(uuid,text), elimu_select_elective(uuid,uuid,uuid), elimu_end_elective(uuid,uuid) TO authenticated;
