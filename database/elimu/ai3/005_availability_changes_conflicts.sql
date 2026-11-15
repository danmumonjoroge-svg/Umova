-- ============================================================
-- ELIMU 005 -- teacher availability, timetable exceptions, change history, notices, CONFLICT DETECTION
-- Run AFTER 004. Safe to re-run.
--
-- How a clash is handled:
--   * elimu_timetable_conflicts() lists every clash with a plain-language reason (the screen shows them before saving).
--   * elimu_save_timetable_entry() NEVER silently overwrites: a clash blocks the save unless an authorised user
--     (timetable.override) supplies a reason. The override, the clashes it covered and the reason go to the change
--     history AND the audit log.
--   * A trigger on elimu_timetable_entries is the backstop: even a direct service-role write cannot create a clash
--     unless it goes through the override path.
-- ============================================================

-- ---------- teacher availability ----------
CREATE TABLE IF NOT EXISTS elimu_teacher_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid,
  staff_id uuid NOT NULL,                          -- teacher (pos_staff.id by default)
  kind text NOT NULL CHECK (kind IN ('WORKING_DAY','UNAVAILABLE_PERIOD','LEAVE')),
  day_of_week integer CHECK (day_of_week BETWEEN 1 AND 7),
  start_time time,
  end_time time,
  start_date date,
  end_date date,
  reason text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT elimu_avail_shape_chk CHECK (
       (kind = 'WORKING_DAY' AND day_of_week IS NOT NULL)
    OR (kind = 'UNAVAILABLE_PERIOD' AND day_of_week IS NOT NULL AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
    OR (kind = 'LEAVE' AND start_date IS NOT NULL AND end_date IS NOT NULL AND end_date >= start_date))
);
CREATE INDEX IF NOT EXISTS idx_elimu_avail_staff ON elimu_teacher_availability (tenant_id, staff_id, kind) WHERE is_active;
DROP TRIGGER IF EXISTS trg_elimu_avail_upd ON elimu_teacher_availability;
CREATE TRIGGER trg_elimu_avail_upd BEFORE UPDATE ON elimu_teacher_availability FOR EACH ROW EXECUTE FUNCTION elimu_set_updated_at();

ALTER TABLE elimu_teacher_availability ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_avail_read ON elimu_teacher_availability;
CREATE POLICY elimu_avail_read ON elimu_teacher_availability FOR SELECT
  USING (tenant_id = get_current_tenant_id() AND (staff_id = elimu_staff_id() OR elimu_can('timetable.view')));
DROP POLICY IF EXISTS elimu_avail_write ON elimu_teacher_availability;
CREATE POLICY elimu_avail_write ON elimu_teacher_availability FOR ALL
  USING (tenant_id = get_current_tenant_id() AND elimu_can('timetable.manage'))
  WITH CHECK (tenant_id = get_current_tenant_id() AND elimu_can('timetable.manage'));
DROP TRIGGER IF EXISTS trg_elimu_avail_audit ON elimu_teacher_availability;
CREATE TRIGGER trg_elimu_avail_audit AFTER INSERT OR UPDATE OR DELETE ON elimu_teacher_availability
  FOR EACH ROW WHEN (is_pos_session()) EXECUTE FUNCTION elimu_tt_simple_audit('teacher_availability');

-- ---------- exceptions to a weekly lesson on ONE date ----------
CREATE TABLE IF NOT EXISTS elimu_timetable_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entry_id uuid NOT NULL REFERENCES elimu_timetable_entries(id) ON DELETE CASCADE,
  exception_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('CANCELLED','TEACHER_CHANGED','ROOM_CHANGED')),
  new_teacher_id uuid,
  new_room_id uuid REFERENCES elimu_school_rooms(id),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, exception_date, kind),
  CONSTRAINT elimu_exc_shape_chk CHECK ((kind = 'TEACHER_CHANGED' AND new_teacher_id IS NOT NULL) OR (kind = 'ROOM_CHANGED' AND new_room_id IS NOT NULL) OR kind = 'CANCELLED')
);
CREATE INDEX IF NOT EXISTS idx_elimu_exc_date ON elimu_timetable_exceptions (tenant_id, exception_date);
ALTER TABLE elimu_timetable_exceptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_exc_read ON elimu_timetable_exceptions;
CREATE POLICY elimu_exc_read ON elimu_timetable_exceptions FOR SELECT USING (tenant_id = get_current_tenant_id() AND elimu_can('timetable.view'));

-- ---------- change history (append-only: no write policy; written by RPCs) ----------
CREATE TABLE IF NOT EXISTS elimu_timetable_change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid,
  entry_id uuid REFERENCES elimu_timetable_entries(id) ON DELETE SET NULL,
  change_type text NOT NULL CHECK (change_type IN
    ('CREATED','UPDATED','MOVED','TEACHER_CHANGED','ROOM_CHANGED','CANCELLED','RESTORED','REPLACEMENT_SCHEDULED','CONFLICT_OVERRIDDEN')),
  effective_date date,                              -- NULL = the whole recurring lesson
  class_id uuid, stream_id uuid, teacher_id uuid, previous_teacher_id uuid,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  override_conflicts jsonb,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_elimu_ttchg_entry ON elimu_timetable_change_history (tenant_id, entry_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_elimu_ttchg_time ON elimu_timetable_change_history (tenant_id, changed_at DESC);
ALTER TABLE elimu_timetable_change_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_ttchg_read ON elimu_timetable_change_history;
CREATE POLICY elimu_ttchg_read ON elimu_timetable_change_history FOR SELECT USING (tenant_id = get_current_tenant_id() AND elimu_can('timetable.view'));

-- One notice per (change, audience, recipient, channel): the same change can never be announced twice to the same person.
CREATE TABLE IF NOT EXISTS elimu_timetable_change_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  change_id uuid NOT NULL REFERENCES elimu_timetable_change_history(id) ON DELETE CASCADE,
  audience text NOT NULL CHECK (audience IN ('TEACHER','CLASS','GUARDIAN')),
  recipient_ref text NOT NULL,                       -- staff id / guardian id / class id as text
  channel text NOT NULL CHECK (channel IN ('SMS','EMAIL','WHATSAPP','CALL','INTERNAL')),
  comm_log_id uuid,                                  -- lb_communication_log.id: THE record of the message and its delivery status
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (change_id, audience, recipient_ref, channel)
);
ALTER TABLE elimu_timetable_change_notices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_ttnotice_read ON elimu_timetable_change_notices;
CREATE POLICY elimu_ttnotice_read ON elimu_timetable_change_notices FOR SELECT USING (tenant_id = get_current_tenant_id() AND elimu_can('timetable.view'));

CREATE OR REPLACE FUNCTION elimu_record_timetable_notice(p_change_id uuid, p_audience text, p_recipient_ref text, p_channel text, p_comm_log_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM elimu_require('timetable.manage');
  IF NOT EXISTS (SELECT 1 FROM elimu_timetable_change_history h WHERE h.id = p_change_id AND h.tenant_id = elimu_tenant()) THEN
    RAISE EXCEPTION 'That timetable change was not found.' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO elimu_timetable_change_notices (tenant_id, change_id, audience, recipient_ref, channel, comm_log_id, created_by)
  VALUES (elimu_tenant(), p_change_id, p_audience, p_recipient_ref, p_channel, p_comm_log_id, elimu_staff_id())
  ON CONFLICT (change_id, audience, recipient_ref, channel) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', true, 'duplicate', true); END IF;
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'id', v_id);
END $$;
GRANT EXECUTE ON FUNCTION elimu_record_timetable_notice(uuid, text, text, text, uuid) TO authenticated;

-- Attach the communication-log row once the message has been prepared (the notice row is created first, to claim the slot).
CREATE OR REPLACE FUNCTION elimu_link_timetable_notice(p_notice_id uuid, p_comm_log_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM elimu_require('timetable.manage');
  UPDATE elimu_timetable_change_notices SET comm_log_id = p_comm_log_id WHERE id = p_notice_id AND tenant_id = elimu_tenant() AND comm_log_id IS NULL;
END $$;
GRANT EXECUTE ON FUNCTION elimu_link_timetable_notice(uuid, uuid) TO authenticated;

-- ---------- conflict detection ----------
-- Internal (tenant passed in so the backstop trigger also works for service-role writes).
CREATE OR REPLACE FUNCTION _elimu_tt_conflicts(
  p_tenant uuid, p_exclude uuid, p_term uuid, p_day integer, p_start time, p_end time,
  p_class uuid, p_stream uuid, p_teacher uuid, p_room uuid,
  p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_expected integer DEFAULT NULL)
RETURNS TABLE (code text, severity text, overridable boolean, message text, other_entry_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mins numeric := EXTRACT(EPOCH FROM (p_end - p_start)) / 60;
  v_open time; v_close time; v_cap integer; v_active boolean; v_name text;
  d text[] := ARRAY['','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  r record;
  f date := COALESCE(p_from, DATE '0001-01-01'); t date := COALESCE(p_to, DATE '9999-12-31');
BEGIN
  -- 1. invalid period / duration (never overridable)
  IF p_day IS NULL OR p_day NOT BETWEEN 1 AND 7 THEN
    RETURN QUERY SELECT 'INVALID_DAY', 'BLOCK', false, 'Choose a day of the week from Monday to Sunday.', NULL::uuid; RETURN; END IF;
  IF p_end <= p_start THEN
    RETURN QUERY SELECT 'INVALID_DURATION', 'BLOCK', false, 'The lesson must end after it starts.', NULL::uuid; RETURN; END IF;
  IF v_mins < 5 OR v_mins > 480 THEN
    RETURN QUERY SELECT 'INVALID_DURATION', 'BLOCK', false, format('A lesson of %s minutes is not valid. It must be between 5 minutes and 8 hours.', round(v_mins)), NULL::uuid; END IF;

  -- 2. class (or stream) already has something then; covers "overlapping lesson times"
  FOR r IN SELECT e.id, e.start_time, e.end_time, e.stream_id FROM elimu_timetable_entries e
            WHERE e.tenant_id = p_tenant AND e.status = 'ACTIVE' AND e.id IS DISTINCT FROM p_exclude
              AND e.term_id IS NOT DISTINCT FROM p_term AND e.day_of_week = p_day AND e.class_id = p_class
              AND (e.stream_id IS NULL OR p_stream IS NULL OR e.stream_id = p_stream)
              AND e.start_time < p_end AND e.end_time > p_start
              AND COALESCE(e.valid_from, DATE '0001-01-01') <= t AND COALESCE(e.valid_to, DATE '9999-12-31') >= f LOOP
    RETURN QUERY SELECT 'CLASS_CLASH', 'BLOCK', true,
      format('This class already has a lesson on %s from %s to %s.', d[p_day], to_char(r.start_time,'HH24:MI'), to_char(r.end_time,'HH24:MI')), r.id;
  END LOOP;

  -- 3. teacher in two places at once
  IF p_teacher IS NOT NULL THEN
    SELECT s.name INTO v_name FROM pos_staff s WHERE s.id = p_teacher AND s.pos_tenant_id = p_tenant;
    FOR r IN SELECT e.id, e.start_time, e.end_time FROM elimu_timetable_entries e
              WHERE e.tenant_id = p_tenant AND e.status = 'ACTIVE' AND e.id IS DISTINCT FROM p_exclude
                AND e.term_id IS NOT DISTINCT FROM p_term AND e.day_of_week = p_day AND e.teacher_id = p_teacher
                AND e.start_time < p_end AND e.end_time > p_start
                AND COALESCE(e.valid_from, DATE '0001-01-01') <= t AND COALESCE(e.valid_to, DATE '9999-12-31') >= f LOOP
      RETURN QUERY SELECT 'TEACHER_CLASH', 'BLOCK', true,
        format('%s is already teaching on %s from %s to %s.', COALESCE(v_name, 'This teacher'), d[p_day], to_char(r.start_time,'HH24:MI'), to_char(r.end_time,'HH24:MI')), r.id;
    END LOOP;
  END IF;

  -- 4. room double-booked
  IF p_room IS NOT NULL THEN
    SELECT rm.is_active, rm.capacity, rm.name INTO v_active, v_cap, v_name FROM elimu_school_rooms rm WHERE rm.id = p_room AND rm.tenant_id = p_tenant;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'ROOM_UNKNOWN', 'BLOCK', false, 'That room does not exist in this school.', NULL::uuid;
    ELSE
      IF NOT v_active THEN RETURN QUERY SELECT 'ROOM_INACTIVE', 'BLOCK', false, format('%s is switched off and cannot be used.', v_name), NULL::uuid; END IF;
      FOR r IN SELECT e.id, e.start_time, e.end_time FROM elimu_timetable_entries e
                WHERE e.tenant_id = p_tenant AND e.status = 'ACTIVE' AND e.id IS DISTINCT FROM p_exclude
                  AND e.term_id IS NOT DISTINCT FROM p_term AND e.day_of_week = p_day AND e.room_id = p_room
                  AND e.start_time < p_end AND e.end_time > p_start
                  AND COALESCE(e.valid_from, DATE '0001-01-01') <= t AND COALESCE(e.valid_to, DATE '9999-12-31') >= f LOOP
        RETURN QUERY SELECT 'ROOM_CLASH', 'BLOCK', true,
          format('%s is already booked on %s from %s to %s.', v_name, d[p_day], to_char(r.start_time,'HH24:MI'), to_char(r.end_time,'HH24:MI')), r.id;
      END LOOP;
      -- 5. capacity (a warning: the school decides)
      IF v_cap IS NOT NULL AND p_expected IS NOT NULL AND p_expected > v_cap THEN
        RETURN QUERY SELECT 'ROOM_CAPACITY', 'WARN', true, format('%s seats %s but this lesson expects %s students.', v_name, v_cap, p_expected), NULL::uuid;
      END IF;
    END IF;
  END IF;

  -- 6. outside school operating hours (only checked once the school has saved its hours)
  SELECT s.opening_time, s.closing_time INTO v_open, v_close FROM elimu_attendance_settings s WHERE s.tenant_id = p_tenant;
  IF FOUND AND (p_start < v_open OR p_end > v_close) THEN
    RETURN QUERY SELECT 'OUTSIDE_HOURS', 'BLOCK', true,
      format('This lesson (%s-%s) is outside school hours (%s-%s).', to_char(p_start,'HH24:MI'), to_char(p_end,'HH24:MI'), to_char(v_open,'HH24:MI'), to_char(v_close,'HH24:MI')), NULL::uuid;
  END IF;

  -- 7. runs through a break, lunch or assembly
  FOR r IN SELECT p.name, p.start_time, p.end_time FROM elimu_timetable_periods p
            WHERE p.tenant_id = p_tenant AND p.is_active AND NOT p.is_teaching AND p_day = ANY (p.days)
              AND (p.term_id IS NULL OR p.term_id IS NOT DISTINCT FROM p_term)
              AND p.start_time < p_end AND p.end_time > p_start LOOP
    RETURN QUERY SELECT 'OVERLAPS_BREAK', 'BLOCK', true,
      format('This lesson overlaps "%s" (%s-%s).', r.name, to_char(r.start_time,'HH24:MI'), to_char(r.end_time,'HH24:MI')), NULL::uuid;
  END LOOP;

  -- 8. teacher availability
  IF p_teacher IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM elimu_teacher_availability a WHERE a.tenant_id = p_tenant AND a.staff_id = p_teacher AND a.is_active AND a.kind = 'WORKING_DAY')
       AND NOT EXISTS (SELECT 1 FROM elimu_teacher_availability a WHERE a.tenant_id = p_tenant AND a.staff_id = p_teacher AND a.is_active AND a.kind = 'WORKING_DAY' AND a.day_of_week = p_day) THEN
      RETURN QUERY SELECT 'TEACHER_NOT_WORKING', 'BLOCK', true, format('This teacher does not work on %ss.', d[p_day]), NULL::uuid;
    END IF;
    FOR r IN SELECT a.start_time, a.end_time, a.reason FROM elimu_teacher_availability a
              WHERE a.tenant_id = p_tenant AND a.staff_id = p_teacher AND a.is_active AND a.kind = 'UNAVAILABLE_PERIOD'
                AND a.day_of_week = p_day AND a.start_time < p_end AND a.end_time > p_start LOOP
      RETURN QUERY SELECT 'TEACHER_UNAVAILABLE', 'BLOCK', true,
        format('This teacher is unavailable on %s from %s to %s%s.', d[p_day], to_char(r.start_time,'HH24:MI'), to_char(r.end_time,'HH24:MI'), CASE WHEN r.reason IS NOT NULL THEN ' (' || r.reason || ')' ELSE '' END), NULL::uuid;
    END LOOP;
    IF p_from IS NOT NULL THEN
      FOR r IN SELECT a.start_date, a.end_date FROM elimu_teacher_availability a
                WHERE a.tenant_id = p_tenant AND a.staff_id = p_teacher AND a.is_active AND a.kind = 'LEAVE'
                  AND a.start_date <= COALESCE(p_to, p_from) AND a.end_date >= p_from LOOP
        RETURN QUERY SELECT 'TEACHER_ON_LEAVE', 'BLOCK', true,
          format('This teacher is on leave from %s to %s.', to_char(r.start_date,'DD Mon YYYY'), to_char(r.end_date,'DD Mon YYYY')), NULL::uuid;
      END LOOP;
    END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION _elimu_tt_conflicts(uuid, uuid, uuid, integer, time, time, uuid, uuid, uuid, uuid, date, date, integer) FROM PUBLIC;

-- Public wrapper: the screen calls this to PREVIEW clashes before saving.
CREATE OR REPLACE FUNCTION elimu_timetable_conflicts(
  p_exclude uuid, p_term uuid, p_day integer, p_start time, p_end time,
  p_class uuid, p_stream uuid, p_teacher uuid, p_room uuid,
  p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_expected integer DEFAULT NULL)
RETURNS TABLE (code text, severity text, overridable boolean, message text, other_entry_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM elimu_require('timetable.view');
  RETURN QUERY SELECT * FROM _elimu_tt_conflicts(elimu_tenant(), p_exclude, p_term, p_day, p_start, p_end, p_class, p_stream, p_teacher, p_room, p_from, p_to, p_expected);
END $$;
GRANT EXECUTE ON FUNCTION elimu_timetable_conflicts(uuid, uuid, integer, time, time, uuid, uuid, uuid, uuid, date, date, integer) TO authenticated;

-- ---------- backstop trigger ----------
CREATE OR REPLACE FUNCTION elimu_entry_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; v_msgs text[] := '{}';
BEGIN
  IF NEW.status <> 'ACTIVE' THEN RETURN NEW; END IF;
  IF current_setting('elimu.tt_override', true) = '1' THEN
    -- the override path still refuses the clashes nobody may override
    FOR c IN SELECT * FROM _elimu_tt_conflicts(NEW.tenant_id, NEW.id, NEW.term_id, NEW.day_of_week, NEW.start_time, NEW.end_time, NEW.class_id, NEW.stream_id, NEW.teacher_id, NEW.room_id, NEW.valid_from, NEW.valid_to, NEW.expected_students)
              WHERE severity = 'BLOCK' AND NOT overridable LOOP v_msgs := v_msgs || c.message; END LOOP;
  ELSE
    FOR c IN SELECT * FROM _elimu_tt_conflicts(NEW.tenant_id, NEW.id, NEW.term_id, NEW.day_of_week, NEW.start_time, NEW.end_time, NEW.class_id, NEW.stream_id, NEW.teacher_id, NEW.room_id, NEW.valid_from, NEW.valid_to, NEW.expected_students)
              WHERE severity = 'BLOCK' LOOP v_msgs := v_msgs || c.message; END LOOP;
  END IF;
  IF cardinality(v_msgs) > 0 THEN
    RAISE EXCEPTION 'Timetable clash: %', array_to_string(v_msgs, ' ') USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_entry_guard ON elimu_timetable_entries;
CREATE TRIGGER trg_elimu_entry_guard BEFORE INSERT OR UPDATE ON elimu_timetable_entries FOR EACH ROW EXECUTE FUNCTION elimu_entry_guard();

-- ---------- save an entry (create or edit) ----------
-- p_entry: { id?, expected_version?, academic_year_id, term_id, entry_kind, class_id, stream_id, subject_id, activity_label,
--            teacher_id, room_id, period_id, day_of_week, start_time, end_time, valid_from, valid_to, expected_students, notes }
-- Returns { ok, id, conflicts:[...], overridden, change_id, stale }. ok=false with conflicts = nothing was saved.
CREATE OR REPLACE FUNCTION elimu_save_timetable_entry(p_entry jsonb, p_override_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_t uuid := elimu_tenant(); v_b uuid := elimu_business();
  v_id uuid := nullif(p_entry->>'id','')::uuid;
  v_old elimu_timetable_entries; v_new elimu_timetable_entries;
  v_day integer := (p_entry->>'day_of_week')::int;
  v_start time := (p_entry->>'start_time')::time; v_end time := (p_entry->>'end_time')::time;
  v_from date := nullif(p_entry->>'valid_from','')::date; v_to date := nullif(p_entry->>'valid_to','')::date;
  v_clash jsonb; v_block jsonb; v_hard boolean; v_override boolean := false; v_type text; v_change uuid; v_reason text := nullif(btrim(p_override_reason),'');
BEGIN
  PERFORM elimu_require('timetable.manage');
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_old FROM elimu_timetable_entries WHERE id = v_id AND tenant_id = v_t FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That lesson was not found.' USING ERRCODE = 'P0002'; END IF;
    IF (p_entry->>'expected_version') IS NULL OR (p_entry->>'expected_version')::int <> v_old.version THEN
      RETURN jsonb_build_object('ok', false, 'stale', true, 'message', 'Someone else changed this lesson. Reload it and try again.', 'current_version', v_old.version);
    END IF;
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO v_clash FROM _elimu_tt_conflicts(
    v_t, v_id, nullif(p_entry->>'term_id','')::uuid, v_day, v_start, v_end, (p_entry->>'class_id')::uuid, nullif(p_entry->>'stream_id','')::uuid,
    nullif(p_entry->>'teacher_id','')::uuid, nullif(p_entry->>'room_id','')::uuid, v_from, v_to, nullif(p_entry->>'expected_students','')::int) c;
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_block FROM jsonb_array_elements(v_clash) x WHERE x->>'severity' = 'BLOCK';
  v_hard := EXISTS (SELECT 1 FROM jsonb_array_elements(v_block) x WHERE (x->>'overridable')::boolean = false);

  IF jsonb_array_length(v_block) > 0 THEN
    IF v_hard THEN RETURN jsonb_build_object('ok', false, 'conflicts', v_clash, 'overridable', false); END IF;
    IF v_reason IS NULL OR NOT elimu_can('timetable.override') THEN
      RETURN jsonb_build_object('ok', false, 'conflicts', v_clash, 'overridable', elimu_can('timetable.override'));
    END IF;
    IF length(v_reason) < 5 THEN RAISE EXCEPTION 'Give a reason of at least 5 characters to override a clash.' USING ERRCODE = '22023'; END IF;
    v_override := true;
    PERFORM set_config('elimu.tt_override', '1', true);
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO elimu_timetable_entries (tenant_id, business_id, academic_year_id, term_id, entry_kind, class_id, stream_id, subject_id, activity_label,
        teacher_id, room_id, period_id, day_of_week, start_time, end_time, valid_from, valid_to, expected_students, notes, override_reason, created_by, updated_by)
    VALUES (v_t, v_b, nullif(p_entry->>'academic_year_id','')::uuid, nullif(p_entry->>'term_id','')::uuid, coalesce(p_entry->>'entry_kind','LESSON'),
        (p_entry->>'class_id')::uuid, nullif(p_entry->>'stream_id','')::uuid, nullif(p_entry->>'subject_id','')::uuid, nullif(p_entry->>'activity_label',''),
        nullif(p_entry->>'teacher_id','')::uuid, nullif(p_entry->>'room_id','')::uuid, nullif(p_entry->>'period_id','')::uuid, v_day, v_start, v_end, v_from, v_to,
        nullif(p_entry->>'expected_students','')::int, nullif(p_entry->>'notes',''), CASE WHEN v_override THEN v_reason END, elimu_staff_id(), elimu_staff_id())
    RETURNING * INTO v_new;
    v_type := CASE WHEN v_from IS NOT NULL AND v_from = v_to THEN 'REPLACEMENT_SCHEDULED' ELSE 'CREATED' END;
    PERFORM elimu_audit('ELIMU_TIMETABLE_ENTRY_CREATED', 'elimu_timetable_entries', v_new.id, NULL, to_jsonb(v_new));
  ELSE
    UPDATE elimu_timetable_entries SET
        academic_year_id = nullif(p_entry->>'academic_year_id','')::uuid, term_id = nullif(p_entry->>'term_id','')::uuid,
        entry_kind = coalesce(p_entry->>'entry_kind', entry_kind), class_id = (p_entry->>'class_id')::uuid, stream_id = nullif(p_entry->>'stream_id','')::uuid,
        subject_id = nullif(p_entry->>'subject_id','')::uuid, activity_label = nullif(p_entry->>'activity_label',''),
        teacher_id = nullif(p_entry->>'teacher_id','')::uuid, room_id = nullif(p_entry->>'room_id','')::uuid, period_id = nullif(p_entry->>'period_id','')::uuid,
        day_of_week = v_day, start_time = v_start, end_time = v_end, valid_from = v_from, valid_to = v_to,
        expected_students = nullif(p_entry->>'expected_students','')::int, notes = nullif(p_entry->>'notes',''),
        override_reason = CASE WHEN v_override THEN v_reason ELSE NULL END, version = version + 1, updated_by = elimu_staff_id(), updated_at = now()
      WHERE id = v_id RETURNING * INTO v_new;
    v_type := CASE WHEN v_old.teacher_id IS DISTINCT FROM v_new.teacher_id THEN 'TEACHER_CHANGED'
                   WHEN v_old.room_id IS DISTINCT FROM v_new.room_id AND v_old.day_of_week = v_new.day_of_week AND v_old.start_time = v_new.start_time THEN 'ROOM_CHANGED'
                   WHEN v_old.day_of_week <> v_new.day_of_week OR v_old.start_time <> v_new.start_time OR v_old.end_time <> v_new.end_time THEN 'MOVED'
                   ELSE 'UPDATED' END;
    PERFORM elimu_audit('ELIMU_TIMETABLE_ENTRY_CHANGED', 'elimu_timetable_entries', v_new.id, to_jsonb(v_old), to_jsonb(v_new));
  END IF;

  INSERT INTO elimu_timetable_change_history (tenant_id, business_id, entry_id, change_type, class_id, stream_id, teacher_id, previous_teacher_id, previous_value, new_value, reason, override_conflicts, changed_by)
  VALUES (v_t, v_b, v_new.id, v_type, v_new.class_id, v_new.stream_id, v_new.teacher_id, v_old.teacher_id,
          CASE WHEN v_id IS NOT NULL THEN to_jsonb(v_old) END, to_jsonb(v_new), v_reason, CASE WHEN v_override THEN v_block END, elimu_staff_id())
  RETURNING id INTO v_change;
  IF v_override THEN
    PERFORM elimu_audit('ELIMU_TIMETABLE_CONFLICT_OVERRIDDEN', 'elimu_timetable_entries', v_new.id, NULL, jsonb_build_object('conflicts', v_block), v_reason);
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_new.id, 'version', v_new.version, 'overridden', v_override, 'change_id', v_change, 'change_type', v_type, 'conflicts', v_clash);
END $$;
GRANT EXECUTE ON FUNCTION elimu_save_timetable_entry(jsonb, text) TO authenticated;

-- ---------- cancel a lesson (all weeks, or one date) ----------
CREATE OR REPLACE FUNCTION elimu_cancel_timetable_entry(p_entry_id uuid, p_date date, p_reason text, p_expected_version integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t uuid := elimu_tenant(); v_e elimu_timetable_entries; v_change uuid; v_reason text := nullif(btrim(p_reason),'');
BEGIN
  PERFORM elimu_require('timetable.manage');
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Say why the lesson is cancelled.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_e FROM elimu_timetable_entries WHERE id = p_entry_id AND tenant_id = v_t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That lesson was not found.' USING ERRCODE = 'P0002'; END IF;
  IF p_date IS NULL THEN
    IF p_expected_version IS NOT NULL AND p_expected_version <> v_e.version THEN
      RETURN jsonb_build_object('ok', false, 'stale', true, 'message', 'Someone else changed this lesson. Reload it and try again.'); END IF;
    IF v_e.status = 'CANCELLED' THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
    UPDATE elimu_timetable_entries SET status = 'CANCELLED', version = version + 1, updated_by = elimu_staff_id(), updated_at = now() WHERE id = p_entry_id;
  ELSE
    IF extract(isodow FROM p_date)::int <> v_e.day_of_week THEN RAISE EXCEPTION 'That date is not a % lesson day.', v_e.day_of_week USING ERRCODE = '22023'; END IF;
    INSERT INTO elimu_timetable_exceptions (tenant_id, entry_id, exception_date, kind, reason, created_by) VALUES (v_t, p_entry_id, p_date, 'CANCELLED', v_reason, elimu_staff_id())
    ON CONFLICT (entry_id, exception_date, kind) DO NOTHING;
  END IF;
  INSERT INTO elimu_timetable_change_history (tenant_id, business_id, entry_id, change_type, effective_date, class_id, stream_id, teacher_id, previous_value, reason, changed_by)
  VALUES (v_t, elimu_business(), p_entry_id, 'CANCELLED', p_date, v_e.class_id, v_e.stream_id, v_e.teacher_id, to_jsonb(v_e), v_reason, elimu_staff_id()) RETURNING id INTO v_change;
  PERFORM elimu_audit('ELIMU_TIMETABLE_LESSON_CANCELLED', 'elimu_timetable_entries', p_entry_id, to_jsonb(v_e), jsonb_build_object('date', p_date), v_reason);
  RETURN jsonb_build_object('ok', true, 'change_id', v_change);
END $$;
GRANT EXECUTE ON FUNCTION elimu_cancel_timetable_entry(uuid, date, text, integer) TO authenticated;

-- ---------- change the teacher or room for ONE date ----------
CREATE OR REPLACE FUNCTION elimu_set_timetable_exception(p_entry_id uuid, p_date date, p_kind text, p_new_teacher uuid, p_new_room uuid, p_reason text, p_override_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t uuid := elimu_tenant(); v_e elimu_timetable_entries; v_clash jsonb; v_block jsonb; v_hard boolean; v_change uuid;
        v_reason text := nullif(btrim(p_reason),''); v_ov text := nullif(btrim(p_override_reason),''); v_override boolean := false;
BEGIN
  PERFORM elimu_require('timetable.manage');
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Say why this change is made.' USING ERRCODE = '22023'; END IF;
  IF p_kind NOT IN ('TEACHER_CHANGED','ROOM_CHANGED') THEN RAISE EXCEPTION 'Unknown change type.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_e FROM elimu_timetable_entries WHERE id = p_entry_id AND tenant_id = v_t AND status = 'ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION 'That lesson was not found or is cancelled.' USING ERRCODE = 'P0002'; END IF;
  IF extract(isodow FROM p_date)::int <> v_e.day_of_week THEN RAISE EXCEPTION 'That date is not on this lesson''s weekday.' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO v_clash FROM _elimu_tt_conflicts(
    v_t, p_entry_id, v_e.term_id, v_e.day_of_week, v_e.start_time, v_e.end_time, v_e.class_id, v_e.stream_id,
    CASE WHEN p_kind = 'TEACHER_CHANGED' THEN p_new_teacher ELSE NULL END, CASE WHEN p_kind = 'ROOM_CHANGED' THEN p_new_room ELSE NULL END, p_date, p_date, v_e.expected_students) c
    WHERE c.code NOT IN ('CLASS_CLASH');   -- the class's own lesson is the one being changed
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_block FROM jsonb_array_elements(v_clash) x WHERE x->>'severity' = 'BLOCK';
  v_hard := EXISTS (SELECT 1 FROM jsonb_array_elements(v_block) x WHERE (x->>'overridable')::boolean = false);
  IF jsonb_array_length(v_block) > 0 THEN
    IF v_hard OR v_ov IS NULL OR NOT elimu_can('timetable.override') THEN
      RETURN jsonb_build_object('ok', false, 'conflicts', v_clash, 'overridable', NOT v_hard AND elimu_can('timetable.override')); END IF;
    IF length(v_ov) < 5 THEN RAISE EXCEPTION 'Give a reason of at least 5 characters to override a clash.' USING ERRCODE = '22023'; END IF;
    v_override := true;
  END IF;
  INSERT INTO elimu_timetable_exceptions (tenant_id, entry_id, exception_date, kind, new_teacher_id, new_room_id, reason, created_by)
  VALUES (v_t, p_entry_id, p_date, p_kind, p_new_teacher, p_new_room, v_reason, elimu_staff_id())
  ON CONFLICT (entry_id, exception_date, kind) DO UPDATE SET new_teacher_id = EXCLUDED.new_teacher_id, new_room_id = EXCLUDED.new_room_id, reason = EXCLUDED.reason;
  INSERT INTO elimu_timetable_change_history (tenant_id, business_id, entry_id, change_type, effective_date, class_id, stream_id, teacher_id, previous_teacher_id, previous_value, new_value, reason, override_conflicts, changed_by)
  VALUES (v_t, elimu_business(), p_entry_id, p_kind, p_date, v_e.class_id, v_e.stream_id,
          CASE WHEN p_kind = 'TEACHER_CHANGED' THEN p_new_teacher ELSE v_e.teacher_id END, v_e.teacher_id,
          jsonb_build_object('teacher_id', v_e.teacher_id, 'room_id', v_e.room_id), jsonb_build_object('teacher_id', p_new_teacher, 'room_id', p_new_room),
          CASE WHEN v_override THEN v_reason || ' | override: ' || v_ov ELSE v_reason END, CASE WHEN v_override THEN v_block END, elimu_staff_id()) RETURNING id INTO v_change;
  PERFORM elimu_audit('ELIMU_TIMETABLE_ENTRY_CHANGED', 'elimu_timetable_entries', p_entry_id, jsonb_build_object('teacher_id', v_e.teacher_id, 'room_id', v_e.room_id),
                      jsonb_build_object('date', p_date, 'kind', p_kind, 'teacher_id', p_new_teacher, 'room_id', p_new_room), v_reason);
  IF v_override THEN PERFORM elimu_audit('ELIMU_TIMETABLE_CONFLICT_OVERRIDDEN', 'elimu_timetable_entries', p_entry_id, NULL, jsonb_build_object('conflicts', v_block, 'date', p_date), v_ov); END IF;
  RETURN jsonb_build_object('ok', true, 'change_id', v_change, 'overridden', v_override, 'conflicts', v_clash);
END $$;
GRANT EXECUTE ON FUNCTION elimu_set_timetable_exception(uuid, date, text, uuid, uuid, text, text) TO authenticated;

-- ---------- teacher workload ----------
CREATE OR REPLACE VIEW elimu_v_teacher_workload WITH (security_invoker = true) AS
  SELECT e.tenant_id, e.teacher_id, e.term_id, count(*) AS lessons_per_week,
         round(sum(EXTRACT(EPOCH FROM (e.end_time - e.start_time)) / 60)) AS minutes_per_week,
         count(DISTINCT e.day_of_week) AS days_teaching
    FROM elimu_timetable_entries e
   WHERE e.status = 'ACTIVE' AND e.teacher_id IS NOT NULL AND e.valid_from IS NULL
   GROUP BY e.tenant_id, e.teacher_id, e.term_id;
GRANT SELECT ON elimu_v_teacher_workload TO authenticated;
