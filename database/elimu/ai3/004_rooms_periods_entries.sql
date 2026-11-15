-- ============================================================
-- ELIMU 004 -- rooms/venues, timetable periods, timetable entries
-- Run AFTER 003. Safe to re-run.
--
-- NOT a property/asset system: a room here is just a name, a type and a capacity so a lesson can be placed in it.
-- class_id / stream_id / subject_id / academic_year_id / term_id are plain uuids owned by the Elimu foundation
-- (AI 1: classes, streams, years, terms; AI 2: subjects). teacher_id is pos_staff.id by default.
-- ============================================================

CREATE TABLE IF NOT EXISTS elimu_school_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  room_type text NOT NULL DEFAULT 'CLASSROOM' CHECK (room_type IN
    ('CLASSROOM','LABORATORY','WORKSHOP','HALL','SPORTS_GROUND','LIBRARY','COMPUTER_LAB','OTHER')),
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  location_note text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_room_name ON elimu_school_rooms (tenant_id, lower(btrim(name)));
DROP TRIGGER IF EXISTS trg_elimu_room_upd ON elimu_school_rooms;
CREATE TRIGGER trg_elimu_room_upd BEFORE UPDATE ON elimu_school_rooms FOR EACH ROW EXECUTE FUNCTION elimu_set_updated_at();

-- Periods: the school's own bell schedule. Nothing here is a default timetable.
CREATE TABLE IF NOT EXISTS elimu_timetable_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid,
  academic_year_id uuid,
  term_id uuid,                                    -- NULL = applies to every term
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  period_type text NOT NULL DEFAULT 'LESSON' CHECK (period_type IN ('LESSON','BREAK','LUNCH','ASSEMBLY','ACTIVITY','OTHER')),
  days integer[] NOT NULL DEFAULT '{1,2,3,4,5}',   -- ISO 1=Mon..7=Sun
  start_time time NOT NULL,
  end_time time NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_teaching boolean GENERATED ALWAYS AS (period_type IN ('LESSON','ACTIVITY')) STORED,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT elimu_period_days_chk CHECK (cardinality(days) > 0 AND days <@ ARRAY[1,2,3,4,5,6,7]),
  CONSTRAINT elimu_period_order_chk CHECK (end_time > start_time),
  CONSTRAINT elimu_period_len_chk CHECK ((EXTRACT(EPOCH FROM (end_time - start_time)) / 60) BETWEEN 5 AND 480)
);
CREATE INDEX IF NOT EXISTS idx_elimu_periods ON elimu_timetable_periods (tenant_id, academic_year_id, term_id) WHERE is_active;
DROP TRIGGER IF EXISTS trg_elimu_period_upd ON elimu_timetable_periods;
CREATE TRIGGER trg_elimu_period_upd BEFORE UPDATE ON elimu_timetable_periods FOR EACH ROW EXECUTE FUNCTION elimu_set_updated_at();

-- Two active periods of the same term cannot overlap on a shared day.
CREATE OR REPLACE FUNCTION elimu_periods_no_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o record;
BEGIN
  IF NOT NEW.is_active THEN RETURN NEW; END IF;
  SELECT p.name, p.start_time, p.end_time INTO o FROM elimu_timetable_periods p
   WHERE p.tenant_id = NEW.tenant_id AND p.id <> NEW.id AND p.is_active
     AND p.academic_year_id IS NOT DISTINCT FROM NEW.academic_year_id
     AND (p.term_id IS NOT DISTINCT FROM NEW.term_id OR p.term_id IS NULL OR NEW.term_id IS NULL)
     AND p.days && NEW.days AND p.start_time < NEW.end_time AND p.end_time > NEW.start_time LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Period "%" (% - %) overlaps with the period you are saving.', o.name, to_char(o.start_time,'HH24:MI'), to_char(o.end_time,'HH24:MI') USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_period_overlap ON elimu_timetable_periods;
CREATE TRIGGER trg_elimu_period_overlap BEFORE INSERT OR UPDATE ON elimu_timetable_periods FOR EACH ROW EXECUTE FUNCTION elimu_periods_no_overlap();

-- Entries: one lesson/activity of one class (or stream), one weekday, one time slot.
CREATE TABLE IF NOT EXISTS elimu_timetable_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid,
  academic_year_id uuid,
  term_id uuid,
  entry_kind text NOT NULL DEFAULT 'LESSON' CHECK (entry_kind IN ('LESSON','ACTIVITY')),
  class_id uuid NOT NULL,
  stream_id uuid,                                  -- NULL = whole class
  subject_id uuid,                                 -- required for a LESSON (checked below)
  activity_label text,                             -- required for an ACTIVITY
  teacher_id uuid,                                 -- pos_staff.id (or the foundation's teacher id; see INTEGRATION.md)
  room_id uuid REFERENCES elimu_school_rooms(id),
  period_id uuid REFERENCES elimu_timetable_periods(id),
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_time time NOT NULL,
  end_time time NOT NULL,
  valid_from date,                                 -- NULL/NULL = every week of the term
  valid_to date,                                   -- both set to the same date = a one-off (replacement) lesson
  expected_students integer CHECK (expected_students IS NULL OR expected_students >= 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED')),
  notes text,
  version integer NOT NULL DEFAULT 1,              -- optimistic lock: an edit must name the version it saw
  override_reason text,                            -- set only when an authorised user saved over a conflict
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT elimu_entry_time_chk CHECK (end_time > start_time),
  CONSTRAINT elimu_entry_range_chk CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT elimu_entry_content_chk CHECK ((entry_kind = 'LESSON' AND subject_id IS NOT NULL) OR (entry_kind = 'ACTIVITY' AND length(btrim(coalesce(activity_label,''))) > 0))
);
CREATE INDEX IF NOT EXISTS idx_elimu_entry_class ON elimu_timetable_entries (tenant_id, term_id, class_id, stream_id, day_of_week) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_elimu_entry_teacher ON elimu_timetable_entries (tenant_id, teacher_id, term_id, day_of_week) WHERE status = 'ACTIVE' AND teacher_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_elimu_entry_room ON elimu_timetable_entries (tenant_id, room_id, term_id, day_of_week) WHERE status = 'ACTIVE' AND room_id IS NOT NULL;

-- Writes to periods/rooms are ordinary CRUD for timetable managers. Entries are written ONLY through the RPC in 005
-- (conflict check, optimistic lock, history, audit); POS sessions get no direct write policy on entries.
ALTER TABLE elimu_school_rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_room_read ON elimu_school_rooms;
CREATE POLICY elimu_room_read ON elimu_school_rooms FOR SELECT USING (tenant_id = get_current_tenant_id() AND elimu_can('timetable.view'));
DROP POLICY IF EXISTS elimu_room_write ON elimu_school_rooms;
CREATE POLICY elimu_room_write ON elimu_school_rooms FOR ALL
  USING (tenant_id = get_current_tenant_id() AND elimu_can('timetable.manage'))
  WITH CHECK (tenant_id = get_current_tenant_id() AND elimu_can('timetable.manage'));

ALTER TABLE elimu_timetable_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_period_read ON elimu_timetable_periods;
CREATE POLICY elimu_period_read ON elimu_timetable_periods FOR SELECT USING (tenant_id = get_current_tenant_id() AND elimu_can('timetable.view'));
DROP POLICY IF EXISTS elimu_period_write ON elimu_timetable_periods;
CREATE POLICY elimu_period_write ON elimu_timetable_periods FOR ALL
  USING (tenant_id = get_current_tenant_id() AND elimu_can('timetable.manage'))
  WITH CHECK (tenant_id = get_current_tenant_id() AND elimu_can('timetable.manage'));

ALTER TABLE elimu_timetable_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_entry_read ON elimu_timetable_entries;
CREATE POLICY elimu_entry_read ON elimu_timetable_entries FOR SELECT USING (tenant_id = get_current_tenant_id() AND elimu_can('timetable.view'));
-- (deliberately NO insert/update/delete policy for staff sessions)

-- Rooms and periods: audit (timetable created / changed).
CREATE OR REPLACE FUNCTION elimu_tt_simple_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN PERFORM elimu_audit('ELIMU_' || upper(TG_ARGV[0]) || '_CREATED', TG_TABLE_NAME, NEW.id, NULL, to_jsonb(NEW)); RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF to_jsonb(NEW) - 'updated_at' IS DISTINCT FROM to_jsonb(OLD) - 'updated_at' THEN
      PERFORM elimu_audit('ELIMU_' || upper(TG_ARGV[0]) || '_CHANGED', TG_TABLE_NAME, NEW.id, to_jsonb(OLD), to_jsonb(NEW)); END IF;
    RETURN NEW;
  ELSE PERFORM elimu_audit('ELIMU_' || upper(TG_ARGV[0]) || '_DELETED', TG_TABLE_NAME, OLD.id, to_jsonb(OLD), NULL); RETURN OLD; END IF;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_room_audit ON elimu_school_rooms;
CREATE TRIGGER trg_elimu_room_audit AFTER INSERT OR UPDATE OR DELETE ON elimu_school_rooms
  FOR EACH ROW WHEN (is_pos_session()) EXECUTE FUNCTION elimu_tt_simple_audit('room');
DROP TRIGGER IF EXISTS trg_elimu_period_audit ON elimu_timetable_periods;
CREATE TRIGGER trg_elimu_period_audit AFTER INSERT OR UPDATE OR DELETE ON elimu_timetable_periods
  FOR EACH ROW WHEN (is_pos_session()) EXECUTE FUNCTION elimu_tt_simple_audit('timetable_period');
