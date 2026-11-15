-- ============================================================
-- ELIMU 002 -- school calendar
--
-- INSPECTED FIRST: the POS has no general calendar table. lb_appointments is a salon booking list and the "calendar" in
-- rooms/stays is a booking grid; neither can hold term dates, holidays or school events. So this ONE table is added.
-- It is calendar EVENTS only (no exam marks or grading: an exam period is just a dated block).
-- Run AFTER 001. Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS elimu_school_calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid,
  academic_year_id uuid,                -- foundation id (plain uuid; see INTEGRATION.md)
  term_id uuid,
  event_type text NOT NULL CHECK (event_type IN
    ('SCHOOL_OPENING','SCHOOL_CLOSING','TERM_START','TERM_END','HOLIDAY','PUBLIC_HOLIDAY','EXAM_PERIOD',
     'SCHOOL_EVENT','STAFF_MEETING','PARENT_MEETING','SPORTS_DAY','SPECIAL_ACTIVITY','OTHER')),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  description text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  start_time time,                      -- NULL = all day
  end_time time,
  is_school_day boolean NOT NULL DEFAULT false,   -- does school run normally on these dates? (holidays: false; events: true)
  affects_attendance boolean NOT NULL DEFAULT false, -- true = no attendance expected on these dates
  audience text NOT NULL DEFAULT 'ALL' CHECK (audience IN ('ALL','STAFF','PARENTS','STUDENTS')),
  location text,
  is_cancelled boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT elimu_cal_dates_chk CHECK (end_date >= start_date),
  CONSTRAINT elimu_cal_times_chk CHECK (start_time IS NULL OR end_time IS NULL OR end_time > start_time),
  -- a holiday type cannot be marked as a normal school day
  CONSTRAINT elimu_cal_holiday_chk CHECK (event_type NOT IN ('HOLIDAY','PUBLIC_HOLIDAY') OR is_school_day = false)
);
CREATE INDEX IF NOT EXISTS idx_elimu_cal_range ON elimu_school_calendar_events (tenant_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_elimu_cal_type ON elimu_school_calendar_events (tenant_id, event_type, start_date);
DROP TRIGGER IF EXISTS trg_elimu_cal_upd ON elimu_school_calendar_events;
CREATE TRIGGER trg_elimu_cal_upd BEFORE UPDATE ON elimu_school_calendar_events FOR EACH ROW EXECUTE FUNCTION elimu_set_updated_at();

ALTER TABLE elimu_school_calendar_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_cal_read ON elimu_school_calendar_events;
CREATE POLICY elimu_cal_read ON elimu_school_calendar_events FOR SELECT
  USING (tenant_id = get_current_tenant_id() AND elimu_can('calendar.view'));
DROP POLICY IF EXISTS elimu_cal_write ON elimu_school_calendar_events;
CREATE POLICY elimu_cal_write ON elimu_school_calendar_events FOR ALL
  USING (tenant_id = get_current_tenant_id() AND elimu_can('calendar.manage'))
  WITH CHECK (tenant_id = get_current_tenant_id() AND elimu_can('calendar.manage'));

-- Is attendance expected on this date? (calendar only; weekends are settings, applied by elimu_is_school_day in 003)
CREATE OR REPLACE FUNCTION elimu_calendar_blocks_day(p_tenant uuid, p_date date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM elimu_school_calendar_events e
                  WHERE e.tenant_id = p_tenant AND NOT e.is_cancelled AND e.affects_attendance
                    AND p_date BETWEEN e.start_date AND e.end_date)
$$;
GRANT EXECUTE ON FUNCTION elimu_calendar_blocks_day(uuid, date) TO authenticated;

-- Audit calendar changes through the existing audit log (staff sessions only).
CREATE OR REPLACE FUNCTION elimu_cal_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN PERFORM elimu_audit('ELIMU_CALENDAR_EVENT_CREATED', 'elimu_school_calendar_events', NEW.id, NULL, to_jsonb(NEW)); RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF to_jsonb(NEW) - 'updated_at' IS DISTINCT FROM to_jsonb(OLD) - 'updated_at' THEN
      PERFORM elimu_audit('ELIMU_CALENDAR_EVENT_CHANGED', 'elimu_school_calendar_events', NEW.id, to_jsonb(OLD), to_jsonb(NEW)); END IF;
    RETURN NEW;
  ELSE PERFORM elimu_audit('ELIMU_CALENDAR_EVENT_DELETED', 'elimu_school_calendar_events', OLD.id, to_jsonb(OLD), NULL); RETURN OLD; END IF;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_cal_audit ON elimu_school_calendar_events;
CREATE TRIGGER trg_elimu_cal_audit AFTER INSERT OR UPDATE OR DELETE ON elimu_school_calendar_events
  FOR EACH ROW WHEN (is_pos_session()) EXECUTE FUNCTION elimu_cal_audit();
