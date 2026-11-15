-- ============================================================================
-- ELIMU ADAPTER VIEWS -- the single place AI 2 / AI 3 / AI 4 read AI 1's foundation (students, structure, enrolments, guardians).
-- Run AFTER AI 1 (001-006) and BEFORE AI 2 / 3 / 4. Re-runnable. All views are security_invoker (callers' RLS still applies);
-- every consumer also filters tenant_id explicitly.
-- Mapping decisions (verified by tests/unified_tests.sql):
--   enrolment status  ENROLLED -> ACTIVE (others unchanged)       dates   enrolled_on/ended_on -> start_date/end_date
--   year-long enrolments have term_id NULL in AI 1 and stay NULL here (consumers pick the term from the calendar)
--   student status    AI 1 status CATEGORY -> ACTIVE|SUSPENDED|TRANSFERRED|GRADUATED|WITHDRAWN|ALUMNI|APPLICANT
-- ============================================================================

-- ------------------------------------------------ AI 2 contract: elimu_ref_*
CREATE OR REPLACE VIEW elimu_ref_academic_years WITH (security_invoker = true) AS
  SELECT id, tenant_id, name, start_date, end_date, (status = 'CURRENT') AS is_current FROM elimu_academic_years;

CREATE OR REPLACE VIEW elimu_ref_terms WITH (security_invoker = true) AS
  SELECT t.id, t.tenant_id, t.academic_year_id, t.name, t.term_number AS sequence_no, t.start_date, t.end_date,
         (y.status = 'CURRENT' AND current_date BETWEEN t.start_date AND t.end_date) AS is_current
    FROM elimu_terms t JOIN elimu_academic_years y ON y.id = t.academic_year_id AND y.tenant_id = t.tenant_id;

CREATE OR REPLACE VIEW elimu_ref_classes WITH (security_invoker = true) AS
  -- level_code is NULL: AI 1 has no school-level (PRIMARY/SECONDARY ...) field. AI 2's subject 'applicable_levels' check skips NULL, so that
  -- restriction is INERT until AI 1 gains a level column (open item, see integration report).
  SELECT id, tenant_id, name, NULL::text AS level_code, level_order AS sort_order FROM elimu_classes;

CREATE OR REPLACE VIEW elimu_ref_streams WITH (security_invoker = true) AS
  SELECT id, tenant_id, class_id, name FROM elimu_streams;

CREATE OR REPLACE VIEW elimu_ref_students WITH (security_invoker = true) AS
  SELECT s.id, s.tenant_id, s.admission_no AS admission_number,
         btrim(concat_ws(' ', s.first_name, s.middle_name, s.last_name)) AS full_name,
         coalesce(st.category, 'ACTIVE') AS status
    FROM elimu_students s LEFT JOIN elimu_student_statuses st ON st.id = s.status_id;

CREATE OR REPLACE VIEW elimu_ref_enrollments WITH (security_invoker = true) AS
  SELECT id, tenant_id, student_id, academic_year_id, class_id, stream_id,
         CASE status WHEN 'ENROLLED' THEN 'ACTIVE' ELSE status END AS status,
         enrolled_on AS start_date, ended_on AS end_date, term_id
    FROM elimu_enrollments;

CREATE OR REPLACE VIEW elimu_ref_guardians WITH (security_invoker = true) AS
  SELECT g.id, g.tenant_id, btrim(concat_ws(' ', g.first_name, g.last_name)) AS full_name,
         (SELECT c.value_normalized FROM elimu_guardian_contacts c WHERE c.guardian_id = g.id AND c.kind = 'PHONE' ORDER BY c.is_primary DESC, c.created_at LIMIT 1) AS phone,
         (SELECT c.value_normalized FROM elimu_guardian_contacts c WHERE c.guardian_id = g.id AND c.kind = 'EMAIL' ORDER BY c.is_primary DESC, c.created_at LIMIT 1) AS email
    FROM elimu_guardians g WHERE g.archived_at IS NULL;

CREATE OR REPLACE VIEW elimu_ref_student_guardians WITH (security_invoker = true) AS
  SELECT tenant_id, student_id, guardian_id, relationship, (guardian_rank = 1) AS is_primary,
         receives_academic_communications AS receives_academic_messages
    FROM elimu_student_guardians WHERE ended_on IS NULL OR ended_on >= current_date;

-- ------------------------------------------------ AI 3 contract: elimu_v_*
CREATE OR REPLACE VIEW elimu_v_roster WITH (security_invoker = true) AS
  SELECT e.tenant_id, e.id AS enrollment_id, e.student_id, s.admission_number, s.full_name AS student_name,
         e.class_id, e.stream_id, e.academic_year_id, e.term_id, e.start_date AS enrolled_from, e.end_date AS enrolled_to, e.status
    FROM elimu_ref_enrollments e JOIN elimu_ref_students s ON s.id = e.student_id AND s.tenant_id = e.tenant_id;

CREATE OR REPLACE VIEW elimu_v_class_streams WITH (security_invoker = true) AS
  SELECT c.tenant_id, c.id AS class_id, c.name AS class_name, s.id AS stream_id, s.name AS stream_name,
         y.id AS academic_year_id, c.level_order AS sort_order
    FROM elimu_classes c
    CROSS JOIN LATERAL (SELECT id FROM elimu_academic_years y WHERE y.tenant_id = c.tenant_id AND y.status = 'CURRENT' LIMIT 1) y
    LEFT JOIN elimu_streams s ON s.class_id = c.id AND s.tenant_id = c.tenant_id AND s.is_active
   WHERE c.is_active;

CREATE OR REPLACE VIEW elimu_v_terms WITH (security_invoker = true) AS
  SELECT t.tenant_id, t.id AS term_id, t.academic_year_id, t.name AS term_name, y.name AS year_name, t.start_date, t.end_date,
         (y.status = 'CURRENT' AND current_date BETWEEN t.start_date AND t.end_date) AS is_current
    FROM elimu_terms t JOIN elimu_academic_years y ON y.id = t.academic_year_id AND y.tenant_id = t.tenant_id;

-- Guardians with contact details; may receive attendance alerts = general communications switched on, a phone on record, SMS not opted out.
CREATE OR REPLACE VIEW elimu_v_guardians WITH (security_invoker = true) AS
  SELECT sg.tenant_id, g.id AS guardian_id, sg.student_id, btrim(concat_ws(' ', g.first_name, g.last_name)) AS guardian_name,
         sg.relationship,
         (SELECT c.value_normalized FROM elimu_guardian_contacts c WHERE c.guardian_id = g.id AND c.kind = 'PHONE' ORDER BY c.is_primary DESC, c.created_at LIMIT 1) AS phone,
         (SELECT c.value_normalized FROM elimu_guardian_contacts c WHERE c.guardian_id = g.id AND c.kind = 'EMAIL' ORDER BY c.is_primary DESC, c.created_at LIMIT 1) AS email,
         (SELECT c.value_normalized FROM elimu_guardian_contacts c WHERE c.guardian_id = g.id AND c.kind = 'PHONE' AND c.is_whatsapp ORDER BY c.is_primary DESC, c.created_at LIMIT 1) AS whatsapp_phone,
         (sg.guardian_rank = 1) AS is_primary,
         (sg.receives_general_communications
          AND EXISTS (SELECT 1 FROM elimu_guardian_contacts c WHERE c.guardian_id = g.id AND c.kind = 'PHONE')
          AND coalesce((SELECT k.status FROM elimu_guardian_channel_consent k WHERE k.guardian_id = g.id AND k.channel = 'SMS'), 'NOT_ASKED') <> 'OPTED_OUT') AS can_receive_attendance_alerts
    FROM elimu_student_guardians sg JOIN elimu_guardians g ON g.id = sg.guardian_id AND g.tenant_id = sg.tenant_id
   WHERE g.archived_at IS NULL AND (sg.ended_on IS NULL OR sg.ended_on >= current_date);

-- Subjects and teachers are created AFTER this file (AI 2 / POS); their views live in elimu_adapter_views_post.sql.

GRANT SELECT ON elimu_ref_academic_years, elimu_ref_terms, elimu_ref_classes, elimu_ref_streams, elimu_ref_students,
  elimu_ref_enrollments, elimu_ref_guardians, elimu_ref_student_guardians,
  elimu_v_roster, elimu_v_class_streams, elimu_v_terms, elimu_v_guardians TO authenticated;
