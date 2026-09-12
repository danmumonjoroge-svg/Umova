-- ============================================================
-- Phase 6 — salon/barber/service-business capabilities (brief §48-50)
--
-- NOTE ON pos_appointments / pos_staff_commissions: these tables already
-- exist, but confirmed (this session) they have zero rows, nothing in
-- this codebase references them, and no function/trigger touches them.
-- They also reference a fully parallel, disconnected schema
-- (pos_customers, pos_items, pos_transactions — none of which this app
-- uses either) instead of lb_customers/lb_products, which is what every
-- other phase this session is built on. Treating them as abandoned
-- scaffolding from an earlier, different design direction and building
-- fresh here instead, rather than wiring new frontend code into tables
-- that can't reference a real customer or product.
--
-- A "service" is NOT a new catalog — confirmed against the live schema
-- and against saleService.js's own code: lb_products.track_inventory=false
-- already exists as a column, and saleService.js already skips stock
-- checks/movements for such products ("track_inventory = false are
-- exempt (nothing to check)" — its own comment). Since lb_sale_items has
-- a required FK straight to lb_products (no alternate "service_id"
-- column exists anywhere), a service MUST be a lb_products row to be
-- sellable through the till at all — reusing the existing sales engine
-- per §29 isn't just a design choice, it's structurally the only option.
--
-- What lb_products genuinely can't hold — duration, an assigned
-- provider, a commission rate — lives in a small 1:1 extension table
-- (lb_service_details) instead of altering lb_products itself. Doesn't
-- touch the product catalog other phases/pages already work against.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE lb_appointment_status AS ENUM ('SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- lb_service_details (§28, §50) ----------

CREATE TABLE IF NOT EXISTS lb_service_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid REFERENCES lb_businesses(id),
  product_id uuid NOT NULL UNIQUE REFERENCES lb_products(id), -- 1:1 — one service = one lb_products row
  duration_minutes integer,
  default_staff_id uuid REFERENCES pos_staff(id), -- §50: optional provider assignment; NULL is fine for a service anyone can perform
  -- §50 explicitly: "do not force commission functionality on retail
  -- businesses" and "allows service businesses to track commissions
  -- LATER" — so this is just the data hook (a rate to apply), not a
  -- commission ledger/payout system. Defaults to 0 (no commission)
  -- so it's inert unless a service business actually sets it.
  commission_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (commission_rate BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lb_service_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lb_service_details ON lb_service_details;
CREATE POLICY tenant_isolation_lb_service_details ON lb_service_details
  FOR ALL USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

-- ---------- lb_appointments (§49) ----------

CREATE TABLE IF NOT EXISTS lb_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid REFERENCES lb_businesses(id),
  customer_id uuid NOT NULL REFERENCES lb_customers(id),
  product_id uuid NOT NULL REFERENCES lb_products(id), -- the service being booked
  staff_id uuid REFERENCES pos_staff(id),
  appointment_date date NOT NULL,
  appointment_time time NOT NULL,
  duration_minutes integer, -- snapshot from lb_service_details at booking time, so a later duration edit doesn't rewrite past bookings
  status lb_appointment_status NOT NULL DEFAULT 'SCHEDULED',
  notes text,
  sale_id uuid REFERENCES lb_sales(id), -- set once the appointment is completed-and-sold (see appointmentService.completeAndSell)
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lb_appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lb_appointments ON lb_appointments;
CREATE POLICY tenant_isolation_lb_appointments ON lb_appointments
  FOR ALL USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

-- No new RPC here — completing an appointment is "create a normal sale
-- for the linked service product, then stamp this row's sale_id/status".
-- That's exactly what saleService.create() (existing code from earlier
-- phases) already does correctly for a track_inventory=false product;
-- wrapping it in a new SECURITY DEFINER function would just be a second
-- place doing the same insert. Sequencing (sale first, then the
-- appointment update) lives in appointmentService.completeAndSell() on
-- the JS side instead — see services/salonService.js.
