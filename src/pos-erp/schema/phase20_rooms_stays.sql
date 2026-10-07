-- ============================================================
-- phase20 — Rooms & Stays (Phase 3 of the hospitality/production upgrade)
--
-- A small, generic "things people stay in, by the night" capability:
--     Room type -> Room -> Stay (a reservation until check-in) -> Guest (lb_customers) -> Folio (phase19)
--
-- Reuses, does not replace: lb_customers (a guest IS a customer), lb_folios /
-- lb_folio_lines (phase19: the one bill; room nights are ordinary ROOM lines on
-- it, not fake products), next_doc_number() for STY- numbers, the tenant_isolation
-- RLS pattern. lb_units (phase5) is for long-term rent by the month with a
-- standing tenant; a room is sold by the night to whoever walks in, so it has
-- its own small table instead of bending lb_units.
--
-- DESIGN DECISIONS
--  * A reservation and a stay are ONE table (lb_stays.status):
--        RESERVED -> CHECKED_IN -> CHECKED_OUT        (or RESERVED -> CANCELLED)
--  * lb_rooms.status holds the PHYSICAL state only: AVAILABLE / OCCUPIED /
--    CLEANING / MAINTENANCE. "Reserved" is derived in lb_room_board (an available
--    room with a booking arriving today or overdue) so it can never go stale.
--  * The room is never responsible for money. The stay owns ONE live ROOM line on
--    the guest's folio (nights x rate). Extending, shortening or checking out
--    voids that line and posts a corrected one (history kept; the line keeps its
--    original created_at so the revenue date does not jump).
--  * Nights = calendar nights, minimum 1 (a same-day stay is one night).
--    "Today" is Africa/Nairobi: change _local_today() if you serve another zone.
--  * Revenue timing (simplification): ALL booked nights are recognised on the
--    folio at check-in and corrected at check-out. Night-by-night accrual is a
--    Phase 7 (Efficiency) concern.
--  * A customer has ONE open folio (phase19), so a second room for the same
--    guest lands on the same bill. lb_folios.stay_id is the first stay; every
--    folio line also carries lb_folio_lines.stay_id when exactly one stay is in
--    house, so a stay's spend can be reported.
--  * Guests/rooms/stays are tenant-isolated exactly like phase19. Stays and room
--    status change ONLY through the SECURITY DEFINER functions below.
--
-- NOT RUN against a live database. Needs phase17 (next_doc_number) and phase19.
-- Assumes lb_businesses(id, tenant_id) and lb_customers(id, tenant_id), as phase19.
-- No enum change, so it runs in one go.
-- ============================================================

-- "Today" for a nightly business. One place to change the time zone.
CREATE OR REPLACE FUNCTION _local_today() RETURNS date
LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Africa/Nairobi')::date $$;

-- ---------- room types ----------
CREATE TABLE IF NOT EXISTS lb_room_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  name text NOT NULL,
  base_rate numeric(15,2) NOT NULL DEFAULT 0 CHECK (base_rate >= 0),   -- per night
  capacity integer NOT NULL DEFAULT 2 CHECK (capacity > 0),
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_room_types_name ON lb_room_types(business_id, lower(name));

-- ---------- rooms ----------
CREATE TABLE IF NOT EXISTS lb_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  room_type_id uuid NOT NULL REFERENCES lb_room_types(id),
  room_number text NOT NULL,
  rate_override numeric(15,2) CHECK (rate_override IS NULL OR rate_override >= 0), -- null = use the type's rate
  status text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','OCCUPIED','CLEANING','MAINTENANCE')),
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, room_number)
);
CREATE INDEX IF NOT EXISTS idx_lb_rooms_business ON lb_rooms(business_id, is_active);

-- ---------- stays (reservation until check-in) ----------
CREATE TABLE IF NOT EXISTS lb_stays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  stay_number text NOT NULL,
  room_id uuid NOT NULL REFERENCES lb_rooms(id),
  customer_id uuid NOT NULL REFERENCES lb_customers(id),
  folio_id uuid REFERENCES lb_folios(id),                 -- set at check-in
  status text NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED','CHECKED_IN','CHECKED_OUT','CANCELLED')),
  check_in_date date NOT NULL,
  expected_check_out date NOT NULL,
  rate numeric(15,2) NOT NULL CHECK (rate > 0),           -- per night, snapshotted when booked
  guests integer NOT NULL DEFAULT 1 CHECK (guests > 0),
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  nights_charged integer,                                 -- final, set at check-out
  notes text,
  cancel_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, stay_number),
  CHECK (expected_check_out > check_in_date)
);
CREATE INDEX IF NOT EXISTS idx_lb_stays_room ON lb_stays(room_id, status);
CREATE INDEX IF NOT EXISTS idx_lb_stays_customer ON lb_stays(customer_id);
CREATE INDEX IF NOT EXISTS idx_lb_stays_business_status ON lb_stays(business_id, status);
CREATE INDEX IF NOT EXISTS idx_lb_stays_folio ON lb_stays(folio_id) WHERE folio_id IS NOT NULL;

-- ---------- connect the existing tables (all nullable: retail is unchanged) ----------
DO $$ BEGIN
  ALTER TABLE lb_folios ADD CONSTRAINT lb_folios_stay_fk FOREIGN KEY (stay_id) REFERENCES lb_stays(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE lb_sales ADD CONSTRAINT lb_sales_stay_fk FOREIGN KEY (stay_id) REFERENCES lb_stays(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE lb_folio_lines ADD COLUMN IF NOT EXISTS stay_id uuid REFERENCES lb_stays(id);
CREATE INDEX IF NOT EXISTS idx_lb_folio_lines_stay ON lb_folio_lines(stay_id) WHERE stay_id IS NOT NULL;
-- exactly one live room line per stay
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_folio_lines_room_per_stay
  ON lb_folio_lines(stay_id) WHERE line_type = 'ROOM' AND status = 'POSTED' AND stay_id IS NOT NULL;

-- ---------- RLS: same policy as every lb_* table ----------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['lb_room_types','lb_rooms','lb_stays'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%I ON %I', t, t);
    EXECUTE format('CREATE POLICY tenant_isolation_%I ON %I FOR ALL USING (tenant_id = get_current_tenant_id()) WITH CHECK (tenant_id = get_current_tenant_id())', t, t);
  END LOOP;
END $$;

-- Stays: read only for clients. Rooms: the owner may add/edit a room, but never
-- its status (that moves with check-in/out via the functions below). Types: free edit.
REVOKE INSERT, UPDATE, DELETE ON lb_stays FROM anon, authenticated;
GRANT SELECT ON lb_stays TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON lb_rooms, lb_room_types FROM anon, authenticated;
GRANT SELECT ON lb_rooms, lb_room_types TO authenticated;
GRANT INSERT (tenant_id, business_id, room_type_id, room_number, rate_override, notes, is_active) ON lb_rooms TO authenticated;
GRANT UPDATE (room_type_id, room_number, rate_override, notes, is_active) ON lb_rooms TO authenticated;
GRANT INSERT (tenant_id, business_id, name, base_rate, capacity, description, is_active) ON lb_room_types TO authenticated;
GRANT UPDATE (name, base_rate, capacity, description, is_active) ON lb_room_types TO authenticated;

-- A client may only attach rooms/types to a business and room type of its own tenant.
CREATE OR REPLACE FUNCTION _room_setup_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM lb_businesses WHERE id = NEW.business_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Business not found';
  END IF;
  IF TG_TABLE_NAME = 'lb_rooms' THEN
    IF NOT EXISTS (SELECT 1 FROM lb_room_types WHERE id = NEW.room_type_id AND tenant_id = NEW.tenant_id AND business_id = NEW.business_id) THEN
      RAISE EXCEPTION 'Room type not found';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.is_active = false AND OLD.status = 'OCCUPIED' THEN
      RAISE EXCEPTION 'Room % has a guest in it. Check them out first', NEW.room_number;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_lb_rooms_guard ON lb_rooms;
CREATE TRIGGER trg_lb_rooms_guard BEFORE INSERT OR UPDATE ON lb_rooms FOR EACH ROW EXECUTE FUNCTION _room_setup_guard();
DROP TRIGGER IF EXISTS trg_lb_room_types_guard ON lb_room_types;
CREATE TRIGGER trg_lb_room_types_guard BEFORE INSERT OR UPDATE ON lb_room_types FOR EACH ROW EXECUTE FUNCTION _room_setup_guard();

-- Folio lines remember the stay they belong to (when exactly one is in house), and a
-- sale charged to the folio is tagged with it (lb_sales.stay_id, brief §6).
CREATE OR REPLACE FUNCTION _folio_line_stay_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid; v_n integer;
BEGIN
  IF NEW.stay_id IS NULL THEN
    SELECT (array_agg(id))[1], count(*) INTO v_id, v_n FROM lb_stays WHERE folio_id = NEW.folio_id AND status = 'CHECKED_IN';
    IF v_n = 1 THEN NEW.stay_id := v_id; END IF;
  END IF;
  IF NEW.sale_id IS NOT NULL AND NEW.stay_id IS NOT NULL THEN
    UPDATE lb_sales SET stay_id = NEW.stay_id WHERE id = NEW.sale_id AND stay_id IS NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_lb_folio_lines_stay ON lb_folio_lines;
CREATE TRIGGER trg_lb_folio_lines_stay BEFORE INSERT ON lb_folio_lines FOR EACH ROW EXECUTE FUNCTION _folio_line_stay_link();

-- ---------- views (security_invoker: the caller's RLS applies) ----------
CREATE OR REPLACE VIEW lb_room_board WITH (security_invoker = true) AS
SELECT r.id, r.tenant_id, r.business_id, r.room_number, r.room_type_id,
       rt.name AS room_type_name, rt.capacity,
       COALESCE(r.rate_override, rt.base_rate) AS rate, r.rate_override,
       r.status, r.notes, r.is_active,
       CASE WHEN r.status = 'AVAILABLE' AND nx.id IS NOT NULL AND nx.check_in_date <= _local_today() THEN 'RESERVED' ELSE r.status END AS display_status,
       cur.id AS current_stay_id, cur.customer_id AS current_customer_id, cg.name AS current_guest,
       cur.expected_check_out AS current_check_out, cur.folio_id AS current_folio_id,
       nx.id AS next_stay_id, nx.check_in_date AS next_check_in, nx.guest AS next_guest
FROM lb_rooms r
JOIN lb_room_types rt ON rt.id = r.room_type_id
LEFT JOIN LATERAL (SELECT s.* FROM lb_stays s WHERE s.room_id = r.id AND s.status = 'CHECKED_IN' ORDER BY s.checked_in_at DESC LIMIT 1) cur ON true
LEFT JOIN lb_customers cg ON cg.id = cur.customer_id
LEFT JOIN LATERAL (
  SELECT s.id, s.check_in_date, c.name AS guest FROM lb_stays s JOIN lb_customers c ON c.id = s.customer_id
  WHERE s.room_id = r.id AND s.status = 'RESERVED' ORDER BY s.check_in_date LIMIT 1
) nx ON true;
GRANT SELECT ON lb_room_board TO authenticated;

CREATE OR REPLACE VIEW lb_stay_summary WITH (security_invoker = true) AS
SELECT s.id, s.tenant_id, s.business_id, s.stay_number, s.room_id, s.customer_id, s.folio_id, s.status,
       s.check_in_date, s.expected_check_out, s.rate, s.guests, s.checked_in_at, s.checked_out_at, s.nights_charged, s.notes, s.cancel_reason, s.created_at,
       r.room_number, rt.name AS room_type_name, c.name AS customer_name, c.phone AS customer_phone,
       GREATEST(1, s.expected_check_out - s.check_in_date) AS nights_booked,
       f.status AS folio_status, COALESCE(f.total_charges, 0) AS folio_total, COALESCE(f.balance_due, 0) AS folio_balance
FROM lb_stays s
JOIN lb_rooms r ON r.id = s.room_id
JOIN lb_room_types rt ON rt.id = r.room_type_id
JOIN lb_customers c ON c.id = s.customer_id
LEFT JOIN lb_folio_summary f ON f.id = s.folio_id;
GRANT SELECT ON lb_stay_summary TO authenticated;

-- ============================================================
-- Internal helpers
-- ============================================================

-- Is the room free for [p_from, p_to)? A guest already in the room blocks it until
-- they leave (or tomorrow, if they have overstayed).
CREATE OR REPLACE FUNCTION _room_is_free(p_room_id uuid, p_from date, p_to date, p_exclude uuid DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM lb_stays s
    WHERE s.room_id = p_room_id AND s.id IS DISTINCT FROM p_exclude AND s.status IN ('RESERVED','CHECKED_IN')
      AND s.check_in_date < p_to
      AND (CASE WHEN s.status = 'CHECKED_IN' THEN GREATEST(s.expected_check_out, _local_today() + 1) ELSE s.expected_check_out END) > p_from
  )
$$;

CREATE OR REPLACE FUNCTION _stay_for_update(p_stay_id uuid) RETURNS lb_stays
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v lb_stays;
BEGIN
  SELECT * INTO v FROM lb_stays WHERE id = p_stay_id AND tenant_id = get_current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stay not found'; END IF;
  RETURN v;
END $$;

-- Makes the folio carry exactly one live ROOM line for the stay: p_nights x stay rate.
CREATE OR REPLACE FUNCTION _sync_room_line(p_stay_id uuid, p_nights integer, p_by uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_s lb_stays; v_f lb_folios; v_room lb_rooms; v_type text; v_old lb_folio_lines; v_had boolean; v_desc text;
BEGIN
  SELECT * INTO v_s FROM lb_stays WHERE id = p_stay_id;
  SELECT * INTO v_f FROM lb_folios WHERE id = v_s.folio_id FOR UPDATE;
  SELECT * INTO v_room FROM lb_rooms WHERE id = v_s.room_id;
  SELECT name INTO v_type FROM lb_room_types WHERE id = v_room.room_type_id;
  v_desc := 'Room ' || v_room.room_number || coalesce(' · ' || v_type, '') ||
            ' · ' || to_char(v_s.check_in_date, 'FMDD Mon') || ' – ' || to_char(v_s.check_in_date + p_nights, 'FMDD Mon');

  SELECT * INTO v_old FROM lb_folio_lines WHERE stay_id = v_s.id AND line_type = 'ROOM' AND status = 'POSTED';
  v_had := FOUND;
  IF v_had AND v_old.quantity = p_nights AND v_old.unit_price = v_s.rate AND v_old.description = v_desc THEN RETURN; END IF;
  IF v_f.status <> 'OPEN' THEN RAISE EXCEPTION 'The account for this stay is already settled, so the room charge cannot change'; END IF;
  IF v_had THEN
    UPDATE lb_folio_lines SET status = 'VOID', void_reason = 'Recalculated: the stay changed' WHERE id = v_old.id;
  END IF;
  INSERT INTO lb_folio_lines (tenant_id, business_id, folio_id, stay_id, line_type, category, description, quantity, unit_price, amount, created_by, created_at)
  VALUES (v_s.tenant_id, v_s.business_id, v_f.id, v_s.id, 'ROOM', 'Room', v_desc, p_nights, v_s.rate, round(p_nights * v_s.rate, 4), p_by,
          CASE WHEN v_had THEN v_old.created_at ELSE now() END);
END $$;

-- Room charges follow the stay: they cannot be removed by hand (phase19 version + this rule).
CREATE OR REPLACE FUNCTION void_folio_line(p_line_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_l lb_folio_lines; v_f lb_folios;
BEGIN
  SELECT * INTO v_l FROM lb_folio_lines WHERE id = p_line_id AND tenant_id = get_current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Line not found'; END IF;
  v_f := _folio_for_update(v_l.folio_id);
  IF v_f.status <> 'OPEN' THEN RAISE EXCEPTION 'A settled folio cannot be changed'; END IF;
  IF v_l.sale_id IS NOT NULL THEN RAISE EXCEPTION 'This charge came from a sale. Void the sale instead'; END IF;
  IF v_l.line_type = 'ROOM' AND v_l.stay_id IS NOT NULL THEN RAISE EXCEPTION 'The room charge follows the stay. Change the stay''s dates or rate instead'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  UPDATE lb_folio_lines SET status = 'VOID', void_reason = p_reason WHERE id = p_line_id;
END $$;

-- Puts a RESERVED stay in the room: folio, room status, room line. Caller holds the stay lock.
CREATE OR REPLACE FUNCTION _start_stay(p_stay_id uuid, p_by uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_s lb_stays; v_room lb_rooms; v_folio uuid;
BEGIN
  SELECT * INTO v_s FROM lb_stays WHERE id = p_stay_id;
  SELECT * INTO v_room FROM lb_rooms WHERE id = v_s.room_id FOR UPDATE;
  IF v_room.status = 'OCCUPIED' THEN RAISE EXCEPTION 'Room % still has a guest in it', v_room.room_number; END IF;
  IF v_room.status = 'CLEANING' THEN RAISE EXCEPTION 'Room % is being cleaned. Mark it ready first', v_room.room_number; END IF;
  IF v_room.status = 'MAINTENANCE' THEN RAISE EXCEPTION 'Room % is out of service for maintenance', v_room.room_number; END IF;

  v_folio := open_folio(v_s.business_id, v_s.customer_id, 'Room ' || v_room.room_number, v_s.id, p_by);
  UPDATE lb_folios SET stay_id = coalesce(stay_id, v_s.id), title = coalesce(title, 'Room ' || v_room.room_number), updated_at = now() WHERE id = v_folio;
  UPDATE lb_stays SET status = 'CHECKED_IN', checked_in_at = now(), folio_id = v_folio, updated_at = now() WHERE id = v_s.id;
  UPDATE lb_rooms SET status = 'OCCUPIED' WHERE id = v_room.id;
  PERFORM _sync_room_line(v_s.id, GREATEST(1, v_s.expected_check_out - v_s.check_in_date), p_by);
END $$;

-- ============================================================
-- RPCs
-- ============================================================

-- Books a room. p_check_in_now = walk-in: the stay starts today and the guest is put in the room.
CREATE OR REPLACE FUNCTION create_stay(
  p_business_id uuid, p_customer_id uuid, p_room_id uuid, p_check_in date, p_check_out date,
  p_rate numeric DEFAULT NULL, p_guests integer DEFAULT 1, p_notes text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL, p_check_in_now boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tid uuid := get_current_tenant_id(); v_room lb_rooms; v_rate numeric; v_in date; v_id uuid; v_today date := _local_today();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM lb_customers WHERE id = p_customer_id AND tenant_id = v_tid) THEN RAISE EXCEPTION 'Customer not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM lb_businesses WHERE id = p_business_id AND tenant_id = v_tid) THEN RAISE EXCEPTION 'Business not found'; END IF;
  SELECT * INTO v_room FROM lb_rooms WHERE id = p_room_id AND tenant_id = v_tid AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found'; END IF;
  IF NOT v_room.is_active THEN RAISE EXCEPTION 'Room % is not in use', v_room.room_number; END IF;

  v_in := CASE WHEN p_check_in_now THEN v_today ELSE p_check_in END;
  IF v_in IS NULL OR p_check_out IS NULL THEN RAISE EXCEPTION 'Check-in and check-out dates are required'; END IF;
  IF v_in < v_today THEN RAISE EXCEPTION 'The check-in date is in the past'; END IF;
  IF p_check_out <= v_in THEN RAISE EXCEPTION 'Check-out must be after check-in'; END IF;
  IF coalesce(p_guests, 0) < 1 THEN RAISE EXCEPTION 'At least one guest is required'; END IF;

  SELECT COALESCE(p_rate, v_room.rate_override, rt.base_rate) INTO v_rate FROM lb_room_types rt WHERE rt.id = v_room.room_type_id;
  IF v_rate IS NULL OR v_rate <= 0 THEN RAISE EXCEPTION 'Set a price per night for this room first'; END IF;

  IF NOT _room_is_free(v_room.id, v_in, p_check_out) THEN
    RAISE EXCEPTION 'Room % is already taken for those dates', v_room.room_number;
  END IF;

  INSERT INTO lb_stays (tenant_id, business_id, stay_number, room_id, customer_id, status, check_in_date, expected_check_out, rate, guests, notes, created_by)
  VALUES (v_tid, p_business_id, next_doc_number(p_business_id, 'STY'), v_room.id, p_customer_id, 'RESERVED', v_in, p_check_out, v_rate, p_guests, p_notes, p_created_by)
  RETURNING id INTO v_id;

  IF p_check_in_now THEN PERFORM _start_stay(v_id, p_created_by); END IF;
  RETURN v_id;
END $$;

-- Checks in a reservation. Arriving on another day than booked moves the booking to today.
CREATE OR REPLACE FUNCTION check_in_stay(p_stay_id uuid, p_by uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_s lb_stays; v_today date := _local_today();
BEGIN
  v_s := _stay_for_update(p_stay_id);
  IF v_s.status <> 'RESERVED' THEN RAISE EXCEPTION 'This stay is % and cannot be checked in', lower(replace(v_s.status, '_', ' ')); END IF;
  IF v_s.check_in_date <> v_today THEN
    IF v_today >= v_s.expected_check_out THEN RAISE EXCEPTION 'This booking has passed. Make a new booking'; END IF;
    IF NOT _room_is_free(v_s.room_id, v_today, v_s.expected_check_out, v_s.id) THEN RAISE EXCEPTION 'The room is not free from today'; END IF;
    UPDATE lb_stays SET check_in_date = v_today WHERE id = v_s.id;
  END IF;
  PERFORM _start_stay(v_s.id, p_by);
  RETURN v_s.id;
END $$;

-- Change dates / price / note. A guest in the room can only change the leaving date and the price;
-- the room line on the folio is recalculated.
CREATE OR REPLACE FUNCTION update_stay(
  p_stay_id uuid, p_check_out date DEFAULT NULL, p_rate numeric DEFAULT NULL, p_notes text DEFAULT NULL,
  p_check_in date DEFAULT NULL, p_by uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_s lb_stays; v_in date; v_out date; v_rate numeric;
BEGIN
  v_s := _stay_for_update(p_stay_id);
  IF v_s.status NOT IN ('RESERVED','CHECKED_IN') THEN RAISE EXCEPTION 'A stay that is % cannot be changed', lower(replace(v_s.status, '_', ' ')); END IF;
  IF p_check_in IS NOT NULL AND v_s.status <> 'RESERVED' THEN RAISE EXCEPTION 'The check-in date of a guest already in the room cannot change'; END IF;
  v_in := coalesce(p_check_in, v_s.check_in_date); v_out := coalesce(p_check_out, v_s.expected_check_out); v_rate := coalesce(p_rate, v_s.rate);
  IF v_rate <= 0 THEN RAISE EXCEPTION 'The price per night must be above zero'; END IF;
  IF v_s.status = 'RESERVED' AND v_in < _local_today() THEN RAISE EXCEPTION 'The check-in date is in the past'; END IF;
  IF v_out <= v_in THEN RAISE EXCEPTION 'Check-out must be after check-in'; END IF;
  IF (v_in <> v_s.check_in_date OR v_out <> v_s.expected_check_out) AND NOT _room_is_free(v_s.room_id, v_in, v_out, v_s.id) THEN
    RAISE EXCEPTION 'The room is already taken for those dates';
  END IF;
  UPDATE lb_stays SET check_in_date = v_in, expected_check_out = v_out, rate = v_rate, notes = coalesce(p_notes, notes), updated_at = now() WHERE id = v_s.id;
  IF v_s.status = 'CHECKED_IN' THEN
    PERFORM _sync_room_line(v_s.id, GREATEST(1, v_out - v_in), p_by);
  END IF;
END $$;

-- Check out. Charges the nights actually used (minimum 1), or the nights booked if p_charge_booked.
-- The room goes to CLEANING. The folio stays open: settle it from the Folios screen.
CREATE OR REPLACE FUNCTION check_out_stay(p_stay_id uuid, p_charge_booked boolean DEFAULT false, p_by uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_s lb_stays; v_nights integer; v_today date := _local_today(); v_total numeric;
BEGIN
  v_s := _stay_for_update(p_stay_id);
  IF v_s.status <> 'CHECKED_IN' THEN RAISE EXCEPTION 'This stay is % and cannot be checked out', lower(replace(v_s.status, '_', ' ')); END IF;
  v_nights := GREATEST(1, v_today - v_s.check_in_date);
  IF p_charge_booked THEN v_nights := GREATEST(v_nights, v_s.expected_check_out - v_s.check_in_date); END IF;
  PERFORM _sync_room_line(v_s.id, v_nights, p_by);
  UPDATE lb_stays SET status = 'CHECKED_OUT', checked_out_at = now(), nights_charged = v_nights, updated_at = now() WHERE id = v_s.id;
  UPDATE lb_rooms SET status = 'CLEANING' WHERE id = v_s.room_id;
  SELECT COALESCE(SUM(amount), 0) INTO v_total FROM lb_folio_lines WHERE folio_id = v_s.folio_id AND status = 'POSTED';
  RETURN jsonb_build_object('stay_id', v_s.id, 'folio_id', v_s.folio_id, 'nights', v_nights, 'room_total', round(v_nights * v_s.rate, 2), 'folio_total', v_total);
END $$;

CREATE OR REPLACE FUNCTION cancel_stay(p_stay_id uuid, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_s lb_stays;
BEGIN
  v_s := _stay_for_update(p_stay_id);
  IF v_s.status <> 'RESERVED' THEN RAISE EXCEPTION 'Only a booking that has not arrived can be cancelled'; END IF;
  UPDATE lb_stays SET status = 'CANCELLED', cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now() WHERE id = v_s.id;
END $$;

-- Housekeeping: mark a room ready, being cleaned, or out of service. A guest's room changes only by check-out.
CREATE OR REPLACE FUNCTION set_room_status(p_room_id uuid, p_status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_room lb_rooms;
BEGIN
  IF p_status NOT IN ('AVAILABLE','CLEANING','MAINTENANCE') THEN RAISE EXCEPTION 'A room can be set to available, cleaning or maintenance'; END IF;
  SELECT * INTO v_room FROM lb_rooms WHERE id = p_room_id AND tenant_id = get_current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found'; END IF;
  IF v_room.status = 'OCCUPIED' THEN RAISE EXCEPTION 'Room % has a guest in it. Check them out first', v_room.room_number; END IF;
  UPDATE lb_rooms SET status = p_status WHERE id = v_room.id;
END $$;

REVOKE ALL ON FUNCTION _room_is_free, _stay_for_update, _sync_room_line, _start_stay, _folio_line_stay_link, _room_setup_guard FROM PUBLIC;
REVOKE ALL ON FUNCTION create_stay, check_in_stay, update_stay, check_out_stay, cancel_stay, set_room_status, void_folio_line FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_stay, check_in_stay, update_stay, check_out_stay, cancel_stay, set_room_status, void_folio_line TO authenticated;
GRANT EXECUTE ON FUNCTION _local_today TO authenticated;
