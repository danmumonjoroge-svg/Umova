-- ============================================================
-- ELIMU 004 — admissions
--
-- Run AFTER 003. Additive and re-runnable. (The final step, "admit", needs enrolments and therefore lives in 005.)
--
--   Application -> Review -> Accepted / Rejected / Waitlisted -> Admission -> Student enrolment
--
--   elimu_admission_applications     one application per child per academic year (one LIVE application at a time)
--   elimu_admission_status_history   append-only trail of every stage change
--   elimu_submit_application(jsonb)  creates applicant + guardian + link + application in ONE transaction (no orphans)
--
-- CONFIGURABLE: a school may add stages (elimu_admission_statuses) such as "Interview booked"; each stage maps to one of the
-- fixed categories SUBMITTED, IN_REVIEW, ACCEPTED, REJECTED, WAITLISTED, ADMITTED, WITHDRAWN. The transition rules below work on
-- the CATEGORY, so custom stages cannot bypass them.
--
--   SUBMITTED  -> IN_REVIEW, ACCEPTED, REJECTED, WAITLISTED, WITHDRAWN
--   IN_REVIEW  -> SUBMITTED, ACCEPTED, REJECTED, WAITLISTED, WITHDRAWN
--   WAITLISTED -> IN_REVIEW, ACCEPTED, REJECTED, WITHDRAWN
--   ACCEPTED   -> WITHDRAWN (offer declined), ADMITTED (only through elimu_admit_application)
--   REJECTED   -> IN_REVIEW (re-opened)
--   ADMITTED, WITHDRAWN: final
-- Accepting / rejecting / waitlisting needs admissions.decide; everything else needs admissions.manage.
-- ============================================================

CREATE TABLE IF NOT EXISTS elimu_admission_applications (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL,
  business_id              uuid NOT NULL REFERENCES lb_businesses(id),
  application_no           text NOT NULL,
  student_id               uuid NOT NULL,                  -- the applicant (a student whose status category is APPLICANT)
  primary_guardian_id      uuid,
  requested_class_id       uuid NOT NULL,
  requested_academic_year_id uuid NOT NULL,
  requested_term_id        uuid,
  application_date         date NOT NULL DEFAULT current_date,
  status_id                uuid NOT NULL,
  source                   text,                           -- walk-in, website, referral ...
  notes                    text,
  decision_date            date,
  decision_by              uuid,
  decision_reason          text,
  waitlist_position        integer CHECK (waitlist_position IS NULL OR waitlist_position > 0),
  admission_date           date,
  enrollment_id            uuid,                           -- FK added in 005
  created_by uuid, updated_by uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, student_id)  REFERENCES elimu_students (tenant_id, id),
  FOREIGN KEY (tenant_id, primary_guardian_id) REFERENCES elimu_guardians (tenant_id, id),
  FOREIGN KEY (tenant_id, requested_class_id) REFERENCES elimu_classes (tenant_id, id),
  FOREIGN KEY (tenant_id, requested_academic_year_id) REFERENCES elimu_academic_years (tenant_id, id),
  FOREIGN KEY (tenant_id, requested_academic_year_id, requested_term_id) REFERENCES elimu_terms (tenant_id, academic_year_id, id),
  FOREIGN KEY (tenant_id, status_id) REFERENCES elimu_admission_statuses (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_application_no ON elimu_admission_applications (tenant_id, upper(application_no));
CREATE INDEX IF NOT EXISTS idx_elimu_applications_status ON elimu_admission_applications (tenant_id, status_id, application_date DESC);
CREATE INDEX IF NOT EXISTS idx_elimu_applications_student ON elimu_admission_applications (tenant_id, student_id);
CREATE INDEX IF NOT EXISTS idx_elimu_applications_year_class ON elimu_admission_applications (tenant_id, requested_academic_year_id, requested_class_id);

CREATE TABLE IF NOT EXISTS elimu_admission_status_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  application_id uuid NOT NULL,
  from_status_id uuid,
  to_status_id   uuid NOT NULL,
  note           text,
  changed_by     uuid,
  changed_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, application_id) REFERENCES elimu_admission_applications (tenant_id, id),
  FOREIGN KEY (tenant_id, from_status_id) REFERENCES elimu_admission_statuses (tenant_id, id),
  FOREIGN KEY (tenant_id, to_status_id) REFERENCES elimu_admission_statuses (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_elimu_admission_history ON elimu_admission_status_history (tenant_id, application_id, changed_at);

-- ---------- rules ----------
CREATE OR REPLACE FUNCTION elimu_admission_transition_ok(p_from text, p_to text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_from = p_to OR CASE p_from
    WHEN 'SUBMITTED'  THEN p_to IN ('IN_REVIEW','ACCEPTED','REJECTED','WAITLISTED','WITHDRAWN')
    WHEN 'IN_REVIEW'  THEN p_to IN ('SUBMITTED','ACCEPTED','REJECTED','WAITLISTED','WITHDRAWN')
    WHEN 'WAITLISTED' THEN p_to IN ('IN_REVIEW','ACCEPTED','REJECTED','WITHDRAWN')
    WHEN 'ACCEPTED'   THEN p_to IN ('WITHDRAWN','ADMITTED')
    WHEN 'REJECTED'   THEN p_to IN ('IN_REVIEW')
    ELSE false END
$$;

CREATE OR REPLACE FUNCTION elimu_application_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_new text; v_old text; v_active boolean; v_student_cat text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status_id IS NULL THEN
    SELECT id INTO NEW.status_id FROM elimu_admission_statuses WHERE tenant_id = NEW.tenant_id AND category = 'SUBMITTED' AND is_default AND is_active LIMIT 1;
  END IF;
  SELECT category, is_active INTO v_new, v_active FROM elimu_admission_statuses WHERE tenant_id = NEW.tenant_id AND id = NEW.status_id;
  IF v_new IS NULL THEN RAISE EXCEPTION 'Unknown admission stage.' USING ERRCODE = '23503'; END IF;
  NEW.notes := nullif(btrim(coalesce(NEW.notes, '')), '');
  NEW.application_no := upper(btrim(coalesce(NEW.application_no, '')));
  IF NEW.application_no = '' THEN NEW.application_no := elimu_next_number('APPLICATION', NEW.tenant_id); END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_new <> 'SUBMITTED' THEN RAISE EXCEPTION 'A new application starts at the first stage.' USING ERRCODE = '23514'; END IF;
    SELECT st.category INTO v_student_cat FROM elimu_students s JOIN elimu_student_statuses st ON st.tenant_id = s.tenant_id AND st.id = s.status_id
     WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.student_id;
    IF v_student_cat IN ('ACTIVE','SUSPENDED') THEN RAISE EXCEPTION 'This student is already enrolled at the school.' USING ERRCODE = '23514'; END IF;
    IF EXISTS (SELECT 1 FROM elimu_admission_applications a JOIN elimu_admission_statuses s ON s.tenant_id = a.tenant_id AND s.id = a.status_id
                WHERE a.tenant_id = NEW.tenant_id AND a.student_id = NEW.student_id AND a.requested_academic_year_id = NEW.requested_academic_year_id
                  AND s.category IN ('SUBMITTED','IN_REVIEW','ACCEPTED','WAITLISTED') AND a.id <> NEW.id) THEN
      RAISE EXCEPTION 'This child already has an open application for that academic year.' USING ERRCODE = '23505';
    END IF;
  ELSE
    IF NEW.student_id IS DISTINCT FROM OLD.student_id THEN RAISE EXCEPTION 'An application cannot be moved to another student.' USING ERRCODE = '23514'; END IF;
    SELECT category INTO v_old FROM elimu_admission_statuses WHERE tenant_id = OLD.tenant_id AND id = OLD.status_id;
    IF NEW.status_id IS DISTINCT FROM OLD.status_id THEN
      IF NOT coalesce(v_active, false) THEN RAISE EXCEPTION 'That admission stage is switched off.' USING ERRCODE = '23514'; END IF;
      IF NOT elimu_admission_transition_ok(v_old, v_new) THEN
        RAISE EXCEPTION 'An application cannot go from % to % directly.', v_old, v_new USING ERRCODE = '23514';
      END IF;
      IF v_new = 'ADMITTED' AND coalesce(current_setting('elimu.admitting', true), '') <> 'on' THEN
        RAISE EXCEPTION 'Use "Admit" to complete an admission; it also enrols the student.' USING ERRCODE = '23514';
      END IF;
      IF v_new IN ('ACCEPTED','REJECTED','WAITLISTED') OR v_old = 'REJECTED' THEN PERFORM elimu_require('admissions.decide'); END IF;
      IF v_new IN ('ACCEPTED','REJECTED','WAITLISTED') THEN
        NEW.decision_date := coalesce(NEW.decision_date, current_date);
        NEW.decision_by := auth.uid();
      END IF;
      IF v_new IN ('SUBMITTED','IN_REVIEW') THEN NEW.decision_date := NULL; NEW.decision_by := NULL; NEW.waitlist_position := NULL; END IF;
      IF v_new <> 'WAITLISTED' THEN NEW.waitlist_position := NULL; END IF;
    ELSIF v_old = 'ADMITTED' AND (NEW.requested_class_id IS DISTINCT FROM OLD.requested_class_id OR NEW.requested_academic_year_id IS DISTINCT FROM OLD.requested_academic_year_id) THEN
      RAISE EXCEPTION 'An admitted application can no longer be changed.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION elimu_application_status_log() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status_id IS NOT DISTINCT FROM OLD.status_id THEN RETURN NEW; END IF;
  INSERT INTO elimu_admission_status_history (tenant_id, application_id, from_status_id, to_status_id, note, changed_by)
  VALUES (NEW.tenant_id, NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status_id END, NEW.status_id, nullif(current_setting('elimu.status_reason', true), ''), auth.uid());
  RETURN NEW;
END $$;

-- ---------- triggers ----------
DROP TRIGGER IF EXISTS trg_elimu_admission_applications_1tenant ON elimu_admission_applications;
CREATE TRIGGER trg_elimu_admission_applications_1tenant BEFORE INSERT OR UPDATE ON elimu_admission_applications FOR EACH ROW EXECUTE FUNCTION elimu_tenant_guard();
DROP TRIGGER IF EXISTS trg_elimu_admission_applications_2perm ON elimu_admission_applications;
CREATE TRIGGER trg_elimu_admission_applications_2perm BEFORE INSERT OR UPDATE OR DELETE ON elimu_admission_applications FOR EACH ROW EXECUTE FUNCTION elimu_enforce('admissions.manage', 'admissions.decide');
DROP TRIGGER IF EXISTS trg_elimu_admission_applications_3guard ON elimu_admission_applications;
CREATE TRIGGER trg_elimu_admission_applications_3guard BEFORE INSERT OR UPDATE ON elimu_admission_applications FOR EACH ROW EXECUTE FUNCTION elimu_application_guard();
DROP TRIGGER IF EXISTS trg_elimu_admission_applications_4updated ON elimu_admission_applications;
CREATE TRIGGER trg_elimu_admission_applications_4updated BEFORE UPDATE ON elimu_admission_applications FOR EACH ROW EXECUTE FUNCTION elimu_set_updated_at();
DROP TRIGGER IF EXISTS trg_elimu_admission_applications_statuslog ON elimu_admission_applications;
CREATE TRIGGER trg_elimu_admission_applications_statuslog AFTER INSERT OR UPDATE OF status_id ON elimu_admission_applications FOR EACH ROW EXECUTE FUNCTION elimu_application_status_log();
DROP TRIGGER IF EXISTS trg_elimu_admission_applications_audit ON elimu_admission_applications;
CREATE TRIGGER trg_elimu_admission_applications_audit AFTER INSERT OR UPDATE ON elimu_admission_applications FOR EACH ROW EXECUTE FUNCTION elimu_audit('admission_application', 'status_id');
DROP TRIGGER IF EXISTS trg_elimu_admission_history_1tenant ON elimu_admission_status_history;
CREATE TRIGGER trg_elimu_admission_history_1tenant BEFORE INSERT ON elimu_admission_status_history FOR EACH ROW EXECUTE FUNCTION elimu_tenant_guard();

-- ---------- row level security ----------
ALTER TABLE elimu_admission_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_applications_select ON elimu_admission_applications;
CREATE POLICY elimu_applications_select ON elimu_admission_applications FOR SELECT USING (tenant_id = (SELECT get_current_tenant_id()) AND (SELECT elimu_can('admissions.view')));
DROP POLICY IF EXISTS elimu_applications_insert ON elimu_admission_applications;
CREATE POLICY elimu_applications_insert ON elimu_admission_applications FOR INSERT WITH CHECK (tenant_id = (SELECT get_current_tenant_id()));
DROP POLICY IF EXISTS elimu_applications_update ON elimu_admission_applications;
CREATE POLICY elimu_applications_update ON elimu_admission_applications FOR UPDATE USING (tenant_id = (SELECT get_current_tenant_id())) WITH CHECK (tenant_id = (SELECT get_current_tenant_id()));
-- no delete policy: an application is withdrawn or rejected, never erased

ALTER TABLE elimu_admission_status_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_admission_history_select ON elimu_admission_status_history;
CREATE POLICY elimu_admission_history_select ON elimu_admission_status_history FOR SELECT USING (tenant_id = (SELECT get_current_tenant_id()) AND (SELECT elimu_can('admissions.view')));

-- ---------- one-transaction application ----------
-- p = {
--   student:  { first_name, middle_name?, last_name, preferred_name?, date_of_birth?, gender?, previous_school?, notes? },
--   guardian: { existing_id? | first_name, last_name, preferred_channel?, contacts:[{kind, value, is_whatsapp?, is_primary?}],
--               relationship?, is_emergency_contact? },
--   requested_class_id, requested_academic_year_id, requested_term_id?, application_date?, source?, notes?
-- }
-- INVOKER: the caller needs admissions.manage, students.manage and guardians.manage (the table triggers check each).
CREATE OR REPLACE FUNCTION elimu_submit_application(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_tenant uuid := get_current_tenant_id(); v_biz uuid; v_student uuid; v_guardian uuid; v_app uuid; v_no text;
  v_sstatus uuid; s jsonb := p -> 'student'; g jsonb := p -> 'guardian'; c jsonb;
BEGIN
  PERFORM elimu_require('admissions.manage');
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No school selected.' USING ERRCODE = '22023'; END IF;
  IF s IS NULL OR coalesce(btrim(s ->> 'first_name'), '') = '' OR coalesce(btrim(s ->> 'last_name'), '') = '' THEN
    RAISE EXCEPTION 'The applicant needs a first and last name.' USING ERRCODE = '22023';
  END IF;
  PERFORM elimu_ensure_setup();
  SELECT b.id INTO v_biz FROM lb_businesses b WHERE b.tenant_id = v_tenant ORDER BY b.id LIMIT 1;
  SELECT id INTO v_sstatus FROM elimu_student_statuses WHERE tenant_id = v_tenant AND category = 'APPLICANT' AND is_default AND is_active LIMIT 1;

  INSERT INTO elimu_students (tenant_id, business_id, first_name, middle_name, last_name, preferred_name, date_of_birth, gender, previous_school, notes, status_id, created_by)
  VALUES (v_tenant, v_biz, s ->> 'first_name', s ->> 'middle_name', s ->> 'last_name', s ->> 'preferred_name', nullif(s ->> 'date_of_birth', '')::date,
          nullif(s ->> 'gender', ''), s ->> 'previous_school', s ->> 'notes', v_sstatus, auth.uid())
  RETURNING id INTO v_student;

  IF g IS NOT NULL AND g <> 'null'::jsonb THEN
    IF nullif(g ->> 'existing_id', '') IS NOT NULL THEN
      v_guardian := (g ->> 'existing_id')::uuid;
      IF NOT EXISTS (SELECT 1 FROM elimu_guardians WHERE tenant_id = v_tenant AND id = v_guardian AND archived_at IS NULL) THEN
        RAISE EXCEPTION 'That guardian was not found.' USING ERRCODE = 'P0002';
      END IF;
    ELSE
      INSERT INTO elimu_guardians (tenant_id, business_id, first_name, last_name, preferred_channel, created_by)
      VALUES (v_tenant, v_biz, g ->> 'first_name', g ->> 'last_name', nullif(g ->> 'preferred_channel', ''), auth.uid()) RETURNING id INTO v_guardian;
      FOR c IN SELECT * FROM jsonb_array_elements(coalesce(g -> 'contacts', '[]'::jsonb)) LOOP
        INSERT INTO elimu_guardian_contacts (tenant_id, guardian_id, kind, value, value_normalized, is_primary, is_whatsapp, created_by)
        VALUES (v_tenant, v_guardian, c ->> 'kind', c ->> 'value', 'x', coalesce((c ->> 'is_primary')::boolean, false), coalesce((c ->> 'is_whatsapp')::boolean, false), auth.uid());
      END LOOP;
    END IF;
    INSERT INTO elimu_student_guardians (tenant_id, student_id, guardian_id, relationship, is_emergency_contact, created_by)
    VALUES (v_tenant, v_student, v_guardian, coalesce(nullif(g ->> 'relationship', ''), 'GUARDIAN'), coalesce((g ->> 'is_emergency_contact')::boolean, true), auth.uid());
  END IF;

  INSERT INTO elimu_admission_applications (tenant_id, business_id, application_no, student_id, primary_guardian_id, requested_class_id, requested_academic_year_id,
                                            requested_term_id, application_date, source, notes, status_id, created_by)
  VALUES (v_tenant, v_biz, '', v_student, v_guardian, (p ->> 'requested_class_id')::uuid, (p ->> 'requested_academic_year_id')::uuid,
          nullif(p ->> 'requested_term_id', '')::uuid, coalesce(nullif(p ->> 'application_date', '')::date, current_date), p ->> 'source', p ->> 'notes', NULL, auth.uid())
  RETURNING id, application_no INTO v_app, v_no;

  RETURN jsonb_build_object('application_id', v_app, 'application_no', v_no, 'student_id', v_student, 'guardian_id', v_guardian);
END $$;

SELECT elimu_apply_grants();
