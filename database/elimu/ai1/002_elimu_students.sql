-- ============================================================
-- ELIMU 002 — students
--
-- Run AFTER 001. Additive and re-runnable.
--
--   elimu_students                 the student record (applicants too: an applicant is a student whose status category is APPLICANT)
--   elimu_student_status_history   append-only: every status change, with reason and date (written by a trigger only)
--   elimu_student_care_notes       OPTIONAL medical-alert / emergency instructions; off by default, separate permission
--   storage bucket                 elimu-student-photos (PRIVATE; objects are read through short-lived signed URLs)
--   elimu_find_duplicate_students  "is this child already registered?"
--
-- PRIVACY CHOICES
--   * No national ID, religion, ethnicity, income, or health diagnosis columns. Gender is optional.
--   * Medical / emergency text lives in its own table with its own permission (students.care) and a school switch
--     (settings.collect_care_notes, default OFF). The emergency CONTACT is a guardian flag (003), not text here.
--   * photo_path holds a storage path, never a URL; a CHECK refuses http(s) values.
--   * Students are never deleted (no DELETE policy). Use status + archived_at.
-- ============================================================

CREATE TABLE IF NOT EXISTS elimu_students (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  business_id    uuid NOT NULL REFERENCES lb_businesses(id),
  admission_no   text,                                   -- NULL only while the student is an applicant
  first_name     text NOT NULL,
  middle_name    text,
  last_name      text NOT NULL,
  preferred_name text,
  date_of_birth  date,
  gender         text CHECK (gender IS NULL OR gender IN ('FEMALE','MALE','OTHER')),
  photo_path     text,
  admission_date date,
  status_id      uuid NOT NULL,
  previous_school text,
  notes          text,
  archived_at    timestamptz,
  created_by     uuid, updated_by uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT elimu_student_names_chk CHECK (length(btrim(first_name)) > 0 AND length(btrim(last_name)) > 0),
  CONSTRAINT elimu_student_dob_chk CHECK (date_of_birth IS NULL OR date_of_birth >= DATE '1900-01-01'),
  CONSTRAINT elimu_student_admdate_chk CHECK (admission_date IS NULL OR admission_date >= DATE '1950-01-01'),
  CONSTRAINT elimu_student_photo_chk CHECK (photo_path IS NULL OR photo_path !~* '^(https?:)?//'),
  FOREIGN KEY (tenant_id, status_id) REFERENCES elimu_student_statuses (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_student_admission_no ON elimu_students (tenant_id, upper(admission_no)) WHERE admission_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_elimu_students_status ON elimu_students (tenant_id, status_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_elimu_students_name ON elimu_students (tenant_id, lower(last_name), lower(first_name));
CREATE INDEX IF NOT EXISTS idx_elimu_students_identity ON elimu_students (tenant_id, lower(first_name), lower(last_name), date_of_birth);
COMMENT ON COLUMN elimu_students.photo_path IS 'Path inside the private bucket elimu-student-photos: <business_id>/<student_id>/<file>. Never a URL.';

CREATE TABLE IF NOT EXISTS elimu_student_status_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  student_id     uuid NOT NULL,
  from_status_id uuid,
  to_status_id   uuid NOT NULL,
  reason         text,
  effective_date date NOT NULL DEFAULT current_date,
  changed_by     uuid,
  changed_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, student_id) REFERENCES elimu_students (tenant_id, id),
  FOREIGN KEY (tenant_id, from_status_id) REFERENCES elimu_student_statuses (tenant_id, id),
  FOREIGN KEY (tenant_id, to_status_id) REFERENCES elimu_student_statuses (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_elimu_status_history_student ON elimu_student_status_history (tenant_id, student_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS elimu_student_care_notes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  student_id             uuid NOT NULL,
  medical_alert          text CHECK (medical_alert IS NULL OR length(medical_alert) <= 500),
  emergency_instructions text CHECK (emergency_instructions IS NULL OR length(emergency_instructions) <= 500),
  updated_by             uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, student_id) REFERENCES elimu_students (tenant_id, id),
  UNIQUE (tenant_id, student_id)
);
COMMENT ON TABLE elimu_student_care_notes IS 'Optional. Keep to what staff genuinely need in an emergency (for example "carries an inhaler"), not medical history.';

-- ---------- rules ----------
CREATE OR REPLACE FUNCTION elimu_student_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_cat text; v_active boolean;
BEGIN
  NEW.first_name     := btrim(NEW.first_name);
  NEW.last_name      := btrim(NEW.last_name);
  NEW.middle_name    := nullif(btrim(coalesce(NEW.middle_name, '')), '');
  NEW.preferred_name := nullif(btrim(coalesce(NEW.preferred_name, '')), '');
  NEW.previous_school:= nullif(btrim(coalesce(NEW.previous_school, '')), '');
  NEW.admission_no   := nullif(upper(btrim(coalesce(NEW.admission_no, ''))), '');
  IF NEW.date_of_birth IS NOT NULL AND NEW.date_of_birth > current_date THEN
    RAISE EXCEPTION 'Date of birth cannot be in the future.' USING ERRCODE = '23514';
  END IF;
  SELECT category, is_active INTO v_cat, v_active FROM elimu_student_statuses WHERE tenant_id = NEW.tenant_id AND id = NEW.status_id;
  IF TG_OP = 'INSERT' OR NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    IF NOT coalesce(v_active, false) THEN RAISE EXCEPTION 'That student status is switched off.' USING ERRCODE = '23514'; END IF;
  END IF;
  IF v_cat IS DISTINCT FROM 'APPLICANT' AND NEW.admission_no IS NULL THEN
    RAISE EXCEPTION 'An admission number is required once a student is no longer an applicant.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- Append-only status history. SECURITY DEFINER: API users can read it but never write it.
CREATE OR REPLACE FUNCTION elimu_student_status_log() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_eff date := coalesce(nullif(current_setting('elimu.status_effective', true), '')::date, current_date);
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status_id IS NOT DISTINCT FROM OLD.status_id THEN RETURN NEW; END IF;
  INSERT INTO elimu_student_status_history (tenant_id, student_id, from_status_id, to_status_id, reason, effective_date, changed_by)
  VALUES (NEW.tenant_id, NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status_id END, NEW.status_id,
          nullif(current_setting('elimu.status_reason', true), ''), v_eff, auth.uid());
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION elimu_care_notes_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT elimu_setting_bool('collect_care_notes', false, NEW.tenant_id) THEN
    RAISE EXCEPTION 'Medical and emergency notes are switched off in the school settings.' USING ERRCODE = '23514';
  END IF;
  NEW.medical_alert := nullif(btrim(coalesce(NEW.medical_alert, '')), '');
  NEW.emergency_instructions := nullif(btrim(coalesce(NEW.emergency_instructions, '')), '');
  NEW.updated_by := auth.uid();
  RETURN NEW;
END $$;

-- ---------- triggers ----------
DROP TRIGGER IF EXISTS trg_elimu_students_1tenant ON elimu_students;
CREATE TRIGGER trg_elimu_students_1tenant BEFORE INSERT OR UPDATE ON elimu_students FOR EACH ROW EXECUTE FUNCTION elimu_tenant_guard();
DROP TRIGGER IF EXISTS trg_elimu_students_2perm ON elimu_students;
CREATE TRIGGER trg_elimu_students_2perm BEFORE INSERT OR UPDATE OR DELETE ON elimu_students FOR EACH ROW EXECUTE FUNCTION elimu_enforce('students.manage');
DROP TRIGGER IF EXISTS trg_elimu_students_3guard ON elimu_students;
CREATE TRIGGER trg_elimu_students_3guard BEFORE INSERT OR UPDATE ON elimu_students FOR EACH ROW EXECUTE FUNCTION elimu_student_guard();
DROP TRIGGER IF EXISTS trg_elimu_students_4updated ON elimu_students;
CREATE TRIGGER trg_elimu_students_4updated BEFORE UPDATE ON elimu_students FOR EACH ROW EXECUTE FUNCTION elimu_set_updated_at();
DROP TRIGGER IF EXISTS trg_elimu_students_statuslog ON elimu_students;
CREATE TRIGGER trg_elimu_students_statuslog AFTER INSERT OR UPDATE OF status_id ON elimu_students FOR EACH ROW EXECUTE FUNCTION elimu_student_status_log();
DROP TRIGGER IF EXISTS trg_elimu_students_audit ON elimu_students;
CREATE TRIGGER trg_elimu_students_audit AFTER INSERT OR UPDATE ON elimu_students FOR EACH ROW EXECUTE FUNCTION elimu_audit('student', 'status_id');

DROP TRIGGER IF EXISTS trg_elimu_status_history_1tenant ON elimu_student_status_history;
CREATE TRIGGER trg_elimu_status_history_1tenant BEFORE INSERT ON elimu_student_status_history FOR EACH ROW EXECUTE FUNCTION elimu_tenant_guard();

DROP TRIGGER IF EXISTS trg_elimu_care_notes_1tenant ON elimu_student_care_notes;
CREATE TRIGGER trg_elimu_care_notes_1tenant BEFORE INSERT OR UPDATE ON elimu_student_care_notes FOR EACH ROW EXECUTE FUNCTION elimu_tenant_guard();
DROP TRIGGER IF EXISTS trg_elimu_care_notes_2perm ON elimu_student_care_notes;
CREATE TRIGGER trg_elimu_care_notes_2perm BEFORE INSERT OR UPDATE OR DELETE ON elimu_student_care_notes FOR EACH ROW EXECUTE FUNCTION elimu_enforce('students.care');
DROP TRIGGER IF EXISTS trg_elimu_care_notes_3guard ON elimu_student_care_notes;
CREATE TRIGGER trg_elimu_care_notes_3guard BEFORE INSERT OR UPDATE ON elimu_student_care_notes FOR EACH ROW EXECUTE FUNCTION elimu_care_notes_guard();
DROP TRIGGER IF EXISTS trg_elimu_care_notes_4updated ON elimu_student_care_notes;
CREATE TRIGGER trg_elimu_care_notes_4updated BEFORE UPDATE ON elimu_student_care_notes FOR EACH ROW EXECUTE FUNCTION elimu_set_updated_at();
DROP TRIGGER IF EXISTS trg_elimu_care_notes_audit ON elimu_student_care_notes;
CREATE TRIGGER trg_elimu_care_notes_audit AFTER INSERT OR UPDATE ON elimu_student_care_notes FOR EACH ROW EXECUTE FUNCTION elimu_audit('student_care_note');

-- ---------- row level security ----------
ALTER TABLE elimu_students ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_students_select ON elimu_students;
CREATE POLICY elimu_students_select ON elimu_students FOR SELECT USING (tenant_id = (SELECT get_current_tenant_id()) AND (SELECT elimu_can('students.view')));
DROP POLICY IF EXISTS elimu_students_insert ON elimu_students;
CREATE POLICY elimu_students_insert ON elimu_students FOR INSERT WITH CHECK (tenant_id = (SELECT get_current_tenant_id()));
DROP POLICY IF EXISTS elimu_students_update ON elimu_students;
CREATE POLICY elimu_students_update ON elimu_students FOR UPDATE USING (tenant_id = (SELECT get_current_tenant_id())) WITH CHECK (tenant_id = (SELECT get_current_tenant_id()));
-- deliberately NO delete policy

ALTER TABLE elimu_student_status_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_status_history_select ON elimu_student_status_history;
CREATE POLICY elimu_status_history_select ON elimu_student_status_history FOR SELECT USING (tenant_id = (SELECT get_current_tenant_id()) AND (SELECT elimu_can('students.view')));
-- deliberately NO insert / update / delete policy: only the SECURITY DEFINER trigger writes here

ALTER TABLE elimu_student_care_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_care_notes_select ON elimu_student_care_notes;
CREATE POLICY elimu_care_notes_select ON elimu_student_care_notes FOR SELECT USING (tenant_id = (SELECT get_current_tenant_id()) AND (SELECT elimu_can('students.care')));
DROP POLICY IF EXISTS elimu_care_notes_insert ON elimu_student_care_notes;
CREATE POLICY elimu_care_notes_insert ON elimu_student_care_notes FOR INSERT WITH CHECK (tenant_id = (SELECT get_current_tenant_id()));
DROP POLICY IF EXISTS elimu_care_notes_update ON elimu_student_care_notes;
CREATE POLICY elimu_care_notes_update ON elimu_student_care_notes FOR UPDATE USING (tenant_id = (SELECT get_current_tenant_id())) WITH CHECK (tenant_id = (SELECT get_current_tenant_id()));
DROP POLICY IF EXISTS elimu_care_notes_delete ON elimu_student_care_notes;
CREATE POLICY elimu_care_notes_delete ON elimu_student_care_notes FOR DELETE USING (tenant_id = (SELECT get_current_tenant_id()));

-- ---------- duplicate check ----------
-- Same first + last name (any case) and the same date of birth, or the same name when either birth date is unknown.
-- SECURITY INVOKER: only the caller's own school is searched, through RLS.
CREATE OR REPLACE FUNCTION elimu_find_duplicate_students(p_first text, p_last text, p_dob date DEFAULT NULL, p_exclude uuid DEFAULT NULL)
RETURNS TABLE (id uuid, admission_no text, first_name text, last_name text, date_of_birth date, status_id uuid)
LANGUAGE sql STABLE AS $$
  SELECT s.id, s.admission_no, s.first_name, s.last_name, s.date_of_birth, s.status_id
    FROM elimu_students s
   WHERE s.tenant_id = (SELECT get_current_tenant_id())
     AND lower(s.first_name) = lower(btrim(p_first)) AND lower(s.last_name) = lower(btrim(p_last))
     AND (p_exclude IS NULL OR s.id <> p_exclude)
     AND (p_dob IS NULL OR s.date_of_birth IS NULL OR s.date_of_birth = p_dob)
   ORDER BY s.created_at
   LIMIT 10
$$;

-- ---------- private photo bucket (Supabase Storage) ----------
-- Path convention  <business_id>/<student_id>/<file>.  Read = students.view, write = students.manage. Same shape as the
-- existing business-logos policies in phase28, but the bucket is PRIVATE: the app asks for signed URLs that expire.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL AND to_regclass('storage.objects') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public) VALUES ('elimu-student-photos', 'elimu-student-photos', false) ON CONFLICT (id) DO NOTHING;
    UPDATE storage.buckets SET public = false WHERE id = 'elimu-student-photos';

    DROP POLICY IF EXISTS elimu_photos_select ON storage.objects;
    CREATE POLICY elimu_photos_select ON storage.objects FOR SELECT USING (
      bucket_id = 'elimu-student-photos' AND elimu_can('students.view')
      AND (storage.foldername(name))[1] IN (SELECT id::text FROM lb_businesses WHERE tenant_id = get_current_tenant_id()));
    DROP POLICY IF EXISTS elimu_photos_insert ON storage.objects;
    CREATE POLICY elimu_photos_insert ON storage.objects FOR INSERT WITH CHECK (
      bucket_id = 'elimu-student-photos' AND elimu_can('students.manage')
      AND (storage.foldername(name))[1] IN (SELECT id::text FROM lb_businesses WHERE tenant_id = get_current_tenant_id()));
    DROP POLICY IF EXISTS elimu_photos_update ON storage.objects;
    CREATE POLICY elimu_photos_update ON storage.objects FOR UPDATE USING (
      bucket_id = 'elimu-student-photos' AND elimu_can('students.manage')
      AND (storage.foldername(name))[1] IN (SELECT id::text FROM lb_businesses WHERE tenant_id = get_current_tenant_id()));
    DROP POLICY IF EXISTS elimu_photos_delete ON storage.objects;
    CREATE POLICY elimu_photos_delete ON storage.objects FOR DELETE USING (
      bucket_id = 'elimu-student-photos' AND elimu_can('students.manage')
      AND (storage.foldername(name))[1] IN (SELECT id::text FROM lb_businesses WHERE tenant_id = get_current_tenant_id()));
  ELSE
    RAISE NOTICE 'storage schema not found: create a PRIVATE bucket named elimu-student-photos and its policies by hand (see INTEGRATION.md).';
  END IF;
END $$;

SELECT elimu_apply_grants();
