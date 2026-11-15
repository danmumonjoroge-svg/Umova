-- ============================================================
-- ELIMU Communication — 60 ACADEMIC MESSAGE LINKS & GUARDIAN CONTACTS. Run after the other elimu schema files. Re-runnable.
--
-- NO new SMS / email / WhatsApp engine and NO new outbox. Academic messages are rows in the POS's existing outbox
-- lb_communication_log (sent / tracked by the existing comm-send function and commEngineService). This file only adds:
--   elimu_academic_message_links  - ties one outbox row to the student / guardian / enrollment / academic record it was about
--   functions that decide WHO MAY SEE a student's guardian contacts, and list notification targets
-- ============================================================

CREATE TABLE IF NOT EXISTS elimu_academic_message_links (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  comm_log_id    uuid NOT NULL REFERENCES lb_communication_log(id),
  student_id     uuid NOT NULL,
  guardian_id    uuid,
  enrollment_id  uuid,
  purpose        text NOT NULL CHECK (purpose LIKE 'ELIMU\_%'),
  reference_type text,                       -- REPORT_CARD | ASSESSMENT | TERM_RESULT | STUDENT
  reference_id   uuid,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comm_log_id)
);
CREATE INDEX IF NOT EXISTS idx_elimu_msglink_student ON elimu_academic_message_links (tenant_id, student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_elimu_msglink_ref ON elimu_academic_message_links (tenant_id, reference_type, reference_id);
ALTER TABLE elimu_academic_message_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_msglink_sel ON elimu_academic_message_links;
CREATE POLICY elimu_msglink_sel ON elimu_academic_message_links FOR SELECT USING (tenant_id = get_current_tenant_id() AND elimu_can('comm.send'));
GRANT SELECT ON elimu_academic_message_links TO authenticated;      -- inserts only via elimu_link_message()

-- Who may see / contact a student's guardians? Admins/exams officers, the student's class teacher, or a teacher allocated to the student's class.
CREATE OR REPLACE FUNCTION elimu_staff_covers_student(p_student uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id();
BEGIN
  IF NOT elimu_can('comm.send') THEN RETURN false; END IF;
  IF elimu_can('view.all') THEN RETURN true; END IF;
  RETURN EXISTS (SELECT 1 FROM elimu_ref_enrollments e WHERE e.tenant_id = t AND e.student_id = p_student AND e.status IN ('ACTIVE','COMPLETED')
     AND (elimu_is_class_teacher(e.academic_year_id, e.class_id, e.stream_id)
          OR EXISTS (SELECT 1 FROM elimu_subject_allocations a WHERE a.tenant_id = t AND a.status = 'ACTIVE' AND a.teacher_staff_id = elimu_staff_id()
                      AND a.academic_year_id = e.academic_year_id AND a.class_id = e.class_id AND (a.stream_id IS NULL OR a.stream_id = e.stream_id))));
END $$;

-- Guardians of one student with the contact details the "Call / SMS / Email / WhatsApp" actions need.
CREATE OR REPLACE FUNCTION elimu_student_contacts(p_student uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id(); stu record; cur record;
BEGIN
  IF NOT elimu_staff_covers_student(p_student) THEN RAISE EXCEPTION 'You do not have permission to contact this student''s guardians.' USING ERRCODE = '42501'; END IF;
  SELECT id, admission_number, full_name INTO stu FROM elimu_ref_students WHERE id = p_student AND tenant_id = t;
  IF stu.id IS NULL THEN RAISE EXCEPTION 'Student not found.' USING ERRCODE = 'P0002'; END IF;
  SELECT e.id AS enrollment_id, c.name AS class_name, s.name AS stream_name INTO cur
    FROM elimu_ref_enrollments e JOIN elimu_ref_classes c ON c.id = e.class_id AND c.tenant_id = t LEFT JOIN elimu_ref_streams s ON s.id = e.stream_id AND s.tenant_id = t
   WHERE e.tenant_id = t AND e.student_id = p_student AND e.status = 'ACTIVE' ORDER BY e.start_date DESC NULLS LAST LIMIT 1;
  RETURN jsonb_build_object('ok', true, 'student', jsonb_build_object('id', stu.id, 'admission_number', stu.admission_number, 'full_name', stu.full_name,
      'enrollment_id', cur.enrollment_id, 'class_name', cur.class_name, 'stream_name', cur.stream_name),
    'guardians', coalesce((SELECT jsonb_agg(jsonb_build_object('guardian_id', g.id, 'full_name', g.full_name, 'phone', g.phone, 'email', g.email, 'relationship', sg.relationship,
         'is_primary', sg.is_primary, 'receives_academic_messages', sg.receives_academic_messages) ORDER BY sg.is_primary DESC, g.full_name)
       FROM elimu_ref_student_guardians sg JOIN elimu_ref_guardians g ON g.id = sg.guardian_id AND g.tenant_id = t WHERE sg.tenant_id = t AND sg.student_id = p_student), '[]'));
END $$;

-- Notification targets for a set of report cards (e.g. "tell guardians the results are published"): one row per card x guardian,
-- skipping guardians who opted out, with the status of any earlier message for the same purpose so nobody is told twice by accident.
CREATE OR REPLACE FUNCTION elimu_guardian_targets(p_cards uuid[], p_purpose text DEFAULT 'ELIMU_RESULT_PUBLISHED') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id();
BEGIN
  IF NOT elimu_can('comm.send') THEN RAISE EXCEPTION 'You do not have permission to send messages.' USING ERRCODE = '42501'; END IF;
  IF cardinality(p_cards) > 500 THEN RAISE EXCEPTION 'Too many report cards at once (max 500).' USING ERRCODE = '54000'; END IF;
  RETURN jsonb_build_object('ok', true, 'targets', coalesce((
    SELECT jsonb_agg(jsonb_build_object('card_id', c.id, 'status', c.status, 'student_id', s.id, 'admission_number', s.admission_number, 'student_name', s.full_name, 'enrollment_id', c.enrollment_id,
        'guardian_id', g.id, 'guardian_name', g.full_name, 'phone', g.phone, 'email', g.email, 'relationship', sg.relationship, 'is_primary', sg.is_primary,
        'class_name', cl.name, 'stream_name', st.name, 'term_name', tm.name, 'academic_year', ay.name,
        'last_message', (SELECT jsonb_build_object('status', l.status, 'channel', l.channel, 'at', l.created_at) FROM elimu_academic_message_links ml JOIN lb_communication_log l ON l.id = ml.comm_log_id
                          WHERE ml.tenant_id = t AND ml.reference_type = 'REPORT_CARD' AND ml.reference_id = c.id AND ml.guardian_id = g.id AND ml.purpose = p_purpose ORDER BY ml.created_at DESC LIMIT 1))
      ORDER BY cl.name, s.admission_number, sg.is_primary DESC)
    FROM elimu_report_cards c
    JOIN elimu_ref_students s ON s.id = c.student_id AND s.tenant_id = t
    JOIN elimu_ref_student_guardians sg ON sg.student_id = s.id AND sg.tenant_id = t AND sg.receives_academic_messages
    JOIN elimu_ref_guardians g ON g.id = sg.guardian_id AND g.tenant_id = t
    JOIN elimu_ref_classes cl ON cl.id = c.class_id AND cl.tenant_id = t
    LEFT JOIN elimu_ref_streams st ON st.id = c.stream_id AND st.tenant_id = t
    JOIN elimu_ref_terms tm ON tm.id = c.term_id AND tm.tenant_id = t
    JOIN elimu_ref_academic_years ay ON ay.id = c.academic_year_id AND ay.tenant_id = t
    WHERE c.tenant_id = t AND c.id = ANY (p_cards)
      AND (elimu_can('view.all') OR elimu_is_class_teacher(c.academic_year_id, c.class_id, c.stream_id))), '[]'));
END $$;

-- After the app inserts the outbox row (lb_communication_log) it links it to the academic context.
CREATE OR REPLACE FUNCTION elimu_link_message(p_comm_log uuid, p_student uuid, p_guardian uuid, p_enrollment uuid, p_purpose text, p_ref_type text DEFAULT NULL, p_ref_id uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_current_tenant_id(); v_id uuid;
BEGIN
  IF NOT elimu_staff_covers_student(p_student) THEN RAISE EXCEPTION 'You do not have permission to contact this student''s guardians.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM lb_communication_log WHERE id = p_comm_log AND tenant_id = t) THEN RAISE EXCEPTION 'Message not found.' USING ERRCODE = 'P0002'; END IF;
  IF p_guardian IS NOT NULL AND NOT EXISTS (SELECT 1 FROM elimu_ref_student_guardians WHERE tenant_id = t AND student_id = p_student AND guardian_id = p_guardian) THEN
    RAISE EXCEPTION 'That guardian is not linked to this student.' USING ERRCODE = '23514';
  END IF;
  INSERT INTO elimu_academic_message_links (tenant_id, comm_log_id, student_id, guardian_id, enrollment_id, purpose, reference_type, reference_id, created_by)
  VALUES (t, p_comm_log, p_student, p_guardian, p_enrollment, p_purpose, p_ref_type, p_ref_id, elimu_staff_id()) ON CONFLICT (comm_log_id) DO NOTHING RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Academic message history for one student, with the REAL delivery state straight from the outbox (never "sent" unless the outbox says so).
CREATE OR REPLACE FUNCTION elimu_message_history(p_student uuid, p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT elimu_staff_covers_student(p_student) THEN RAISE EXCEPTION 'You do not have permission to see this.' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
    SELECT ml.purpose, ml.reference_type, ml.reference_id, ml.guardian_id, l.id AS message_id, l.channel, l.recipient, l.recipient_name, l.rendered_message AS message, l.status, l.failure_reason,
           l.created_at, l.sent_at, l.delivered_at, l.attempts, (SELECT name FROM pos_staff WHERE id = ml.created_by) AS sent_by
      FROM elimu_academic_message_links ml JOIN lb_communication_log l ON l.id = ml.comm_log_id
     WHERE ml.tenant_id = get_current_tenant_id() AND ml.student_id = p_student ORDER BY l.created_at DESC LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)) x), '[]');
END $$;

GRANT EXECUTE ON FUNCTION elimu_staff_covers_student(uuid), elimu_student_contacts(uuid), elimu_guardian_targets(uuid[], text),
  elimu_link_message(uuid,uuid,uuid,uuid,text,text,uuid), elimu_message_history(uuid,integer) TO authenticated;
