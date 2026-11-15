-- ============================================================================
-- ELIMU 900 -- foundation -> finance sync (replaces "AI 1 must remember to call elimu_fin_sync_student()").
-- elimu_fin_students / elimu_fin_periods stay real tables (finance FKs, %ROWTYPE and per-transaction snapshots depend on that);
-- these triggers keep them in step with AI 1. Finance-owned attributes (boarding, category, sibling group, staff child, due dates)
-- are NEVER overwritten by the sync. Run LAST (after finance E001-E011). Re-runnable. Internal functions: not granted to clients.
-- ============================================================================

CREATE OR REPLACE FUNCTION _elimu_fin_refresh_period(p_term uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t elimu_terms; y elimu_academic_years; v_biz uuid; v_cur boolean;
BEGIN
  SELECT * INTO t FROM elimu_terms WHERE id = p_term; IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO y FROM elimu_academic_years WHERE id = t.academic_year_id;
  v_biz := y.business_id; IF v_biz IS NULL THEN RETURN; END IF;
  v_cur := (y.status = 'CURRENT' AND current_date BETWEEN t.start_date AND t.end_date);
  IF v_cur THEN UPDATE elimu_fin_periods SET is_current = false WHERE business_id = v_biz AND is_current AND external_term_id IS DISTINCT FROM t.id; END IF;
  INSERT INTO elimu_fin_periods (tenant_id, business_id, external_year_id, external_term_id, academic_year, term, term_no, start_date, end_date, is_current)
  VALUES (t.tenant_id, v_biz, y.id, t.id, y.name, t.name, t.term_number, t.start_date, t.end_date, v_cur)
  ON CONFLICT (business_id, external_term_id) WHERE external_term_id IS NOT NULL DO UPDATE SET
    external_year_id = EXCLUDED.external_year_id, academic_year = EXCLUDED.academic_year, term = EXCLUDED.term, term_no = EXCLUDED.term_no,
    start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, is_current = EXCLUDED.is_current, updated_at = now();
END $$;

CREATE OR REPLACE FUNCTION _elimu_fin_refresh_student(p_student uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s elimu_students; v_cat text; v_status text; e elimu_enrollments; v_class text; v_stream text; g record; v_id uuid;
BEGIN
  SELECT * INTO s FROM elimu_students WHERE id = p_student; IF NOT FOUND OR s.business_id IS NULL THEN RETURN; END IF;
  SELECT category INTO v_cat FROM elimu_student_statuses WHERE id = s.status_id;
  IF coalesce(v_cat, 'ACTIVE') = 'APPLICANT' THEN RETURN; END IF;
  v_status := CASE coalesce(v_cat, 'ACTIVE') WHEN 'ACTIVE' THEN 'ACTIVE' WHEN 'SUSPENDED' THEN 'SUSPENDED' WHEN 'GRADUATED' THEN 'GRADUATED' WHEN 'ALUMNI' THEN 'GRADUATED' ELSE 'LEFT' END;
  SELECT x.* INTO e FROM elimu_enrollments x WHERE x.student_id = s.id AND x.status = 'ENROLLED' ORDER BY x.enrolled_on DESC NULLS LAST, x.created_at DESC LIMIT 1;
  IF e.id IS NOT NULL THEN
    SELECT name INTO v_class FROM elimu_classes WHERE id = e.class_id;
    SELECT name INTO v_stream FROM elimu_streams WHERE id = e.stream_id;
  END IF;
  SELECT btrim(concat_ws(' ', gd.first_name, gd.last_name)) AS gname, sg.guardian_id, sg.relationship,
         (SELECT c.value_normalized FROM elimu_guardian_contacts c WHERE c.guardian_id = gd.id AND c.kind = 'PHONE' ORDER BY c.is_primary DESC, c.created_at LIMIT 1) AS phone,
         (SELECT c.value_normalized FROM elimu_guardian_contacts c WHERE c.guardian_id = gd.id AND c.kind = 'EMAIL' ORDER BY c.is_primary DESC, c.created_at LIMIT 1) AS email
    INTO g FROM elimu_student_guardians sg JOIN elimu_guardians gd ON gd.id = sg.guardian_id
   WHERE sg.student_id = s.id AND (sg.ended_on IS NULL OR sg.ended_on >= current_date) AND gd.archived_at IS NULL
   ORDER BY sg.guardian_rank NULLS LAST, sg.created_at LIMIT 1;
  INSERT INTO elimu_fin_students (tenant_id, business_id, student_id, enrollment_id, admission_no, full_name, class_id, class_name, stream_id, stream_name,
      status, guardian_id, guardian_name, guardian_phone, guardian_email, guardian_relationship)
  VALUES (s.tenant_id, s.business_id, s.id, e.id, s.admission_no, btrim(concat_ws(' ', s.first_name, s.middle_name, s.last_name)),
      e.class_id, v_class, e.stream_id, v_stream, v_status, g.guardian_id, g.gname, g.phone, g.email, g.relationship)
  ON CONFLICT (business_id, student_id) DO UPDATE SET
    enrollment_id = EXCLUDED.enrollment_id, admission_no = EXCLUDED.admission_no, full_name = EXCLUDED.full_name,
    class_id = EXCLUDED.class_id, class_name = EXCLUDED.class_name, stream_id = EXCLUDED.stream_id, stream_name = EXCLUDED.stream_name,
    status = EXCLUDED.status, guardian_id = EXCLUDED.guardian_id, guardian_name = EXCLUDED.guardian_name, guardian_phone = EXCLUDED.guardian_phone,
    guardian_email = EXCLUDED.guardian_email, guardian_relationship = EXCLUDED.guardian_relationship, synced_at = now()
  RETURNING id INTO v_id;
  INSERT INTO elimu_fin_accounts (tenant_id, business_id, student_id) VALUES (s.tenant_id, s.business_id, s.id) ON CONFLICT (business_id, student_id) DO NOTHING;
END $$;

-- triggers
CREATE OR REPLACE FUNCTION _elimu_fin_trg_term() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN PERFORM _elimu_fin_refresh_period(NEW.id); RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION _elimu_fin_trg_year() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r uuid; BEGIN FOR r IN SELECT id FROM elimu_terms WHERE academic_year_id = NEW.id LOOP PERFORM _elimu_fin_refresh_period(r); END LOOP; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION _elimu_fin_trg_student() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN PERFORM _elimu_fin_refresh_student(NEW.id); RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION _elimu_fin_trg_student_fk() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN PERFORM _elimu_fin_refresh_student(NEW.student_id); RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION _elimu_fin_trg_guardian() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE gid uuid := CASE TG_TABLE_NAME WHEN 'elimu_guardians' THEN NEW.id ELSE NEW.guardian_id END; r uuid;
BEGIN FOR r IN SELECT student_id FROM elimu_student_guardians WHERE guardian_id = gid LOOP PERFORM _elimu_fin_refresh_student(r); END LOOP; RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_elimu_fin_sync_term ON elimu_terms;
CREATE TRIGGER trg_elimu_fin_sync_term AFTER INSERT OR UPDATE ON elimu_terms FOR EACH ROW EXECUTE FUNCTION _elimu_fin_trg_term();
DROP TRIGGER IF EXISTS trg_elimu_fin_sync_year ON elimu_academic_years;
CREATE TRIGGER trg_elimu_fin_sync_year AFTER UPDATE ON elimu_academic_years FOR EACH ROW EXECUTE FUNCTION _elimu_fin_trg_year();
DROP TRIGGER IF EXISTS trg_elimu_fin_sync_student ON elimu_students;
CREATE TRIGGER trg_elimu_fin_sync_student AFTER INSERT OR UPDATE ON elimu_students FOR EACH ROW EXECUTE FUNCTION _elimu_fin_trg_student();
DROP TRIGGER IF EXISTS trg_elimu_fin_sync_enrol ON elimu_enrollments;
CREATE TRIGGER trg_elimu_fin_sync_enrol AFTER INSERT OR UPDATE ON elimu_enrollments FOR EACH ROW EXECUTE FUNCTION _elimu_fin_trg_student_fk();
DROP TRIGGER IF EXISTS trg_elimu_fin_sync_sg ON elimu_student_guardians;
CREATE TRIGGER trg_elimu_fin_sync_sg AFTER INSERT OR UPDATE ON elimu_student_guardians FOR EACH ROW EXECUTE FUNCTION _elimu_fin_trg_student_fk();
DROP TRIGGER IF EXISTS trg_elimu_fin_sync_guardian ON elimu_guardians;
CREATE TRIGGER trg_elimu_fin_sync_guardian AFTER UPDATE ON elimu_guardians FOR EACH ROW EXECUTE FUNCTION _elimu_fin_trg_guardian();
DROP TRIGGER IF EXISTS trg_elimu_fin_sync_contact ON elimu_guardian_contacts;
CREATE TRIGGER trg_elimu_fin_sync_contact AFTER INSERT OR UPDATE ON elimu_guardian_contacts FOR EACH ROW EXECUTE FUNCTION _elimu_fin_trg_guardian();

REVOKE ALL ON FUNCTION _elimu_fin_refresh_period(uuid), _elimu_fin_refresh_student(uuid) FROM PUBLIC;

-- one-off backfill of existing foundation data (idempotent)
SELECT _elimu_fin_refresh_period(id) FROM elimu_terms;
SELECT _elimu_fin_refresh_student(id) FROM elimu_students;
