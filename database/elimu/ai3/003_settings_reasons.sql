-- ============================================================
-- ELIMU 003 -- attendance settings, custom statuses, absence reasons
-- Run AFTER 002. Safe to re-run.
--
-- Nothing is hard-coded to one school: opening/closing times, grace, weekend days, thresholds, notification rules
-- and statuses are all rows the school edits.
-- ============================================================

-- ---------- settings: one row per school ----------
CREATE TABLE IF NOT EXISTS elimu_attendance_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid,
  opening_time time NOT NULL DEFAULT '08:00',
  closing_time time NOT NULL DEFAULT '16:30',
  grace_minutes integer NOT NULL DEFAULT 10 CHECK (grace_minutes BETWEEN 0 AND 240),
  -- A student becomes LATE when arrival is MORE than grace_minutes after the scheduled start. Late minutes are always counted from the start.
  early_departure_approval_before time,        -- leaving before this time needs approval (NULL = never needs approval)
  early_departure_requires_approval boolean NOT NULL DEFAULT true,
  attendance_deadline time NOT NULL DEFAULT '10:00',   -- daily attendance should be submitted by this time
  weekend_days integer[] NOT NULL DEFAULT '{6,7}',     -- ISO: 1=Mon .. 7=Sun
  daily_mode text NOT NULL DEFAULT 'DAILY' CHECK (daily_mode IN ('DAILY','LESSON','BOTH')),
  require_submit_all_marked boolean NOT NULL DEFAULT false,    -- true = cannot submit while students remain NOT_MARKED
  amendment_requires_reason boolean NOT NULL DEFAULT true,
  amendment_window_days integer CHECK (amendment_window_days IS NULL OR amendment_window_days >= 0), -- NULL = no limit for authorised users
  excused_counts_as_present boolean NOT NULL DEFAULT false,    -- for attendance % only
  repeated_absence_threshold integer NOT NULL DEFAULT 3 CHECK (repeated_absence_threshold >= 2),   -- consecutive school days
  repeated_absence_window_days integer NOT NULL DEFAULT 30 CHECK (repeated_absence_window_days >= 1),
  repeated_absence_count integer NOT NULL DEFAULT 5 CHECK (repeated_absence_count >= 2),           -- absences within the window
  notify_absent boolean NOT NULL DEFAULT true,
  notify_late boolean NOT NULL DEFAULT false,
  notify_left_early boolean NOT NULL DEFAULT true,
  notify_repeated boolean NOT NULL DEFAULT true,
  notify_correction boolean NOT NULL DEFAULT true,
  guardian_channels text[] NOT NULL DEFAULT '{SMS,WHATSAPP}',      -- preferred order
  notify_mode text NOT NULL DEFAULT 'PREPARE' CHECK (notify_mode IN ('OFF','PREPARE')),  -- PREPARE = staff review & send. Never auto-send.
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id),
  CONSTRAINT elimu_att_settings_hours_chk CHECK (closing_time > opening_time),
  CONSTRAINT elimu_att_settings_weekend_chk CHECK (weekend_days <@ ARRAY[1,2,3,4,5,6,7])
);
DROP TRIGGER IF EXISTS trg_elimu_att_settings_upd ON elimu_attendance_settings;
CREATE TRIGGER trg_elimu_att_settings_upd BEFORE UPDATE ON elimu_attendance_settings FOR EACH ROW EXECUTE FUNCTION elimu_set_updated_at();

-- ---------- statuses ----------
-- The eight system statuses are fixed (they are the contract other modules rely on). Schools may ADD their own.
CREATE OR REPLACE FUNCTION elimu_system_status_group(p_status text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_status
    WHEN 'PRESENT' THEN 'PRESENT'  WHEN 'LATE' THEN 'PRESENT'  WHEN 'LEFT_EARLY' THEN 'PRESENT'
    WHEN 'ABSENT' THEN 'ABSENT'
    WHEN 'EXCUSED' THEN 'EXCUSED'  WHEN 'SICK' THEN 'EXCUSED'
    WHEN 'SUSPENDED' THEN 'NEUTRAL'
    WHEN 'NOT_MARKED' THEN 'NOT_MARKED'
    ELSE NULL END
$$;

CREATE TABLE IF NOT EXISTS elimu_attendance_status_defs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid,
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,29}$'),
  label text NOT NULL CHECK (length(btrim(label)) > 0),
  status_group text NOT NULL CHECK (status_group IN ('PRESENT','ABSENT','EXCUSED','NEUTRAL')),   -- how it counts in percentages
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  CONSTRAINT elimu_status_not_system CHECK (elimu_system_status_group(code) IS NULL)
);

-- Group for any status of a tenant (system or custom); NULL = unknown status.
CREATE OR REPLACE FUNCTION elimu_status_group(p_tenant uuid, p_status text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(elimu_system_status_group(p_status),
                  (SELECT d.status_group FROM elimu_attendance_status_defs d WHERE d.tenant_id = p_tenant AND d.code = p_status))
$$;
GRANT EXECUTE ON FUNCTION elimu_status_group(uuid, text) TO authenticated;

-- ---------- absence reasons ----------
CREATE TABLE IF NOT EXISTS elimu_attendance_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid,
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,29}$'),
  label text NOT NULL CHECK (length(btrim(label)) > 0),
  category text NOT NULL DEFAULT 'OTHER' CHECK (category IN
    ('ILLNESS','FAMILY_MATTER','SCHOOL_ACTIVITY','TRANSPORT_PROBLEM','DISCIPLINARY','UNKNOWN','OTHER')),
  applies_to text[] NOT NULL DEFAULT '{ABSENT,LATE,LEFT_EARLY}',
  default_status text,                         -- optional hint, e.g. ILLNESS -> SICK
  counts_as_excused boolean NOT NULL DEFAULT false,   -- a reason alone never excuses; staff approve (see follow-ups)
  is_misconduct boolean NOT NULL DEFAULT false,       -- only DISCIPLINARY-type reasons; absence is NOT assumed to be misconduct
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

-- Seeds the standard categories for a school the first time (idempotent). Called by the app on first open.
CREATE OR REPLACE FUNCTION elimu_attendance_seed_defaults() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t uuid := elimu_tenant(); v_b uuid := elimu_business();
BEGIN
  PERFORM elimu_require('settings.manage');
  INSERT INTO elimu_attendance_settings (tenant_id, business_id) VALUES (v_t, v_b) ON CONFLICT (tenant_id) DO NOTHING;
  INSERT INTO elimu_attendance_reasons (tenant_id, business_id, code, label, category, default_status, sort_order) VALUES
    (v_t, v_b, 'ILLNESS',        'Illness',               'ILLNESS',           'SICK', 10),
    (v_t, v_b, 'FAMILY_MATTER',  'Family matter',         'FAMILY_MATTER',     NULL,   20),
    (v_t, v_b, 'SCHOOL_ACTIVITY','School activity / trip','SCHOOL_ACTIVITY',   'EXCUSED', 30),
    (v_t, v_b, 'TRANSPORT',      'Transport problem',     'TRANSPORT_PROBLEM', NULL,   40),
    (v_t, v_b, 'DISCIPLINARY',   'Disciplinary matter',   'DISCIPLINARY',      NULL,   50),
    (v_t, v_b, 'UNKNOWN',        'Reason not known',      'UNKNOWN',           NULL,   90),
    (v_t, v_b, 'OTHER',          'Other',                 'OTHER',             NULL,   99)
  ON CONFLICT (tenant_id, code) DO NOTHING;
  RETURN jsonb_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION elimu_attendance_seed_defaults() TO authenticated;

-- Effective settings (row or built-in defaults) so a school that never opened Settings still works.
CREATE OR REPLACE FUNCTION elimu_get_attendance_settings() RETURNS elimu_attendance_settings
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s elimu_attendance_settings;
BEGIN
  SELECT * INTO s FROM elimu_attendance_settings WHERE tenant_id = elimu_tenant();
  IF NOT FOUND THEN
    s.tenant_id := elimu_tenant(); s.opening_time := '08:00'; s.closing_time := '16:30'; s.grace_minutes := 10;
    s.early_departure_requires_approval := true; s.attendance_deadline := '10:00'; s.weekend_days := '{6,7}'; s.daily_mode := 'DAILY';
    s.require_submit_all_marked := false; s.amendment_requires_reason := true; s.excused_counts_as_present := false;
    s.repeated_absence_threshold := 3; s.repeated_absence_window_days := 30; s.repeated_absence_count := 5;
    s.notify_absent := true; s.notify_late := false; s.notify_left_early := true; s.notify_repeated := true; s.notify_correction := true;
    s.guardian_channels := '{SMS,WHATSAPP}'; s.notify_mode := 'PREPARE';
  END IF;
  RETURN s;
END $$;
GRANT EXECUTE ON FUNCTION elimu_get_attendance_settings() TO authenticated;

-- Is attendance expected on this date? weekend setting + calendar. (A school can still take attendance on a closed day.)
CREATE OR REPLACE FUNCTION elimu_is_school_day(p_date date) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s elimu_attendance_settings := elimu_get_attendance_settings();
BEGIN
  IF extract(isodow FROM p_date)::int = ANY (s.weekend_days) THEN RETURN false; END IF;
  RETURN NOT elimu_calendar_blocks_day(elimu_tenant(), p_date);
END $$;
GRANT EXECUTE ON FUNCTION elimu_is_school_day(date) TO authenticated;

-- ---------- RLS ----------
ALTER TABLE elimu_attendance_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_att_settings_read ON elimu_attendance_settings;
CREATE POLICY elimu_att_settings_read ON elimu_attendance_settings FOR SELECT
  USING (tenant_id = get_current_tenant_id() AND (elimu_can('attendance.take_own') OR elimu_can('attendance.view_all') OR elimu_can('timetable.view')));
DROP POLICY IF EXISTS elimu_att_settings_write ON elimu_attendance_settings;
CREATE POLICY elimu_att_settings_write ON elimu_attendance_settings FOR ALL
  USING (tenant_id = get_current_tenant_id() AND elimu_can('settings.manage'))
  WITH CHECK (tenant_id = get_current_tenant_id() AND elimu_can('settings.manage'));

ALTER TABLE elimu_attendance_status_defs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_status_read ON elimu_attendance_status_defs;
CREATE POLICY elimu_status_read ON elimu_attendance_status_defs FOR SELECT
  USING (tenant_id = get_current_tenant_id() AND (elimu_can('attendance.take_own') OR elimu_can('attendance.view_all')));
DROP POLICY IF EXISTS elimu_status_write ON elimu_attendance_status_defs;
CREATE POLICY elimu_status_write ON elimu_attendance_status_defs FOR ALL
  USING (tenant_id = get_current_tenant_id() AND elimu_can('settings.manage'))
  WITH CHECK (tenant_id = get_current_tenant_id() AND elimu_can('settings.manage'));

ALTER TABLE elimu_attendance_reasons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_reason_read ON elimu_attendance_reasons;
CREATE POLICY elimu_reason_read ON elimu_attendance_reasons FOR SELECT
  USING (tenant_id = get_current_tenant_id() AND (elimu_can('attendance.take_own') OR elimu_can('attendance.view_all')));
DROP POLICY IF EXISTS elimu_reason_write ON elimu_attendance_reasons;
CREATE POLICY elimu_reason_write ON elimu_attendance_reasons FOR ALL
  USING (tenant_id = get_current_tenant_id() AND elimu_can('settings.manage'))
  WITH CHECK (tenant_id = get_current_tenant_id() AND elimu_can('settings.manage'));

-- Settings changes are audited.
CREATE OR REPLACE FUNCTION elimu_att_settings_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN PERFORM elimu_audit('ELIMU_ATTENDANCE_SETTINGS_CREATED', 'elimu_attendance_settings', NEW.id, NULL, to_jsonb(NEW));
  ELSIF to_jsonb(NEW) - 'updated_at' IS DISTINCT FROM to_jsonb(OLD) - 'updated_at' THEN
    PERFORM elimu_audit('ELIMU_ATTENDANCE_SETTINGS_CHANGED', 'elimu_attendance_settings', NEW.id, to_jsonb(OLD), to_jsonb(NEW)); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_att_settings_audit ON elimu_attendance_settings;
CREATE TRIGGER trg_elimu_att_settings_audit AFTER INSERT OR UPDATE ON elimu_attendance_settings
  FOR EACH ROW WHEN (is_pos_session()) EXECUTE FUNCTION elimu_att_settings_audit();
