-- ============================================================
-- Phase 5 — property capabilities (brief §43-47)
--
-- Nothing here existed before — no lb_units, lb_recurring_charges,
-- lb_meters, or anything adjacent turned up in any schema query this
-- whole conversation. This is genuinely new schema, built to match the
-- existing lb_* conventions rather than invent a different pattern:
--   - tenant_id NOT NULL, business_id nullable (same as every other lb_*
--     table), tenant_isolation_lb_<table> RLS policy gating on
--     tenant_id = get_current_tenant_id() (identical shape to every
--     policy already on lb_products/lb_customers/etc.)
--   - enums for closed sets (status, frequency, meter type), plain text
--     for open-ended fields (charge_name — §45 explicitly wants this
--     generic: Rent/Water/Electricity/Garbage/Parking/Internet/Other,
--     not a fixed list)
--   - money math and ledger writes happen in a SECURITY DEFINER RPC,
--     not client-side — same pattern as record_customer_payment()/
--     process_credit_sale_payment(), for the same reason: a client-side
--     balance update is a second source of truth that can drift.
--
-- A "property tenant" is deliberately NOT a new customer type. §21 of
-- the brief is explicit: "Do not create a separate customer system for
-- property... Property tenants should use the same customer engine."
-- lb_customers.customer_type already has REGISTERED/BUSINESS/CREDIT
-- options that fit a property tenant fine (typically CREDIT, since rent
-- is billed and paid later, same shape as a retail credit sale) — no
-- new customer_type value added here. A property tenant is a lb_customers
-- row, full stop; lb_units.customer_id just points at one.
--
-- A generated recurring-charge invoice raises the customer's balance
-- through the exact same lb_customer_credit_transactions ledger a credit
-- sale or a payment does (Phase 2/4) — same table, same running
-- balance_after, same statement view in CustomersPage.jsx already reads
-- it. transaction_type = 'ADJUSTMENT' (confirmed against the live enum:
-- SALE | PAYMENT | ADJUSTMENT) — a recurring charge isn't a POS sale, so
-- reusing 'SALE' would misreport rent as merchandise revenue in anything
-- that ever groups by transaction_type; ADJUSTMENT is the correct fit.
--
-- Idempotent: CREATE TYPE/TABLE guarded with DO blocks / IF NOT EXISTS
-- where Postgres allows it (CREATE TYPE has no IF NOT EXISTS at all, so
-- those are wrapped in exception-handling DO blocks).
-- ============================================================

-- ---------- enums ----------

DO $$ BEGIN
  CREATE TYPE lb_unit_status AS ENUM ('VACANT', 'OCCUPIED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lb_charge_frequency AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY', 'ONE_OFF');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lb_recurring_charge_status AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Matches brief §46 exactly.
DO $$ BEGIN
  CREATE TYPE lb_charge_invoice_status AS ENUM ('DUE', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'WAIVED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lb_meter_type AS ENUM ('WATER', 'ELECTRICITY', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- lb_units (§44) ----------

CREATE TABLE IF NOT EXISTS lb_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid REFERENCES lb_businesses(id),
  unit_number text NOT NULL,
  customer_id uuid REFERENCES lb_customers(id), -- current occupant; NULL = vacant
  rent_amount numeric(15,4) NOT NULL DEFAULT 0,
  status lb_unit_status NOT NULL DEFAULT 'VACANT',
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, unit_number)
);

ALTER TABLE lb_units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lb_units ON lb_units;
CREATE POLICY tenant_isolation_lb_units ON lb_units
  FOR ALL USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

-- ---------- lb_recurring_charges (§45 — the billing DEFINITION) ----------

CREATE TABLE IF NOT EXISTS lb_recurring_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid REFERENCES lb_businesses(id),
  customer_id uuid NOT NULL REFERENCES lb_customers(id),
  unit_id uuid REFERENCES lb_units(id), -- nullable: a service business could bill a recurring charge with no unit
  charge_name text NOT NULL, -- free text by design (§45): Rent/Water/Electricity/Garbage/Service charge/Parking/Internet/Other
  amount numeric(15,4) NOT NULL,
  frequency lb_charge_frequency NOT NULL DEFAULT 'MONTHLY',
  due_day integer CHECK (due_day BETWEEN 1 AND 31), -- day-of-period the charge falls due; nullable for ONE_OFF
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  status lb_recurring_charge_status NOT NULL DEFAULT 'ACTIVE',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lb_recurring_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lb_recurring_charges ON lb_recurring_charges;
CREATE POLICY tenant_isolation_lb_recurring_charges ON lb_recurring_charges
  FOR ALL USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

-- ---------- lb_recurring_charge_invoices (§46 — one row per generated occurrence) ----------

CREATE TABLE IF NOT EXISTS lb_recurring_charge_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid REFERENCES lb_businesses(id),
  recurring_charge_id uuid NOT NULL REFERENCES lb_recurring_charges(id),
  customer_id uuid NOT NULL REFERENCES lb_customers(id), -- denormalized: avoids a join through lb_recurring_charges for every statement/list query
  unit_id uuid REFERENCES lb_units(id),
  period date NOT NULL, -- first day of the billing period this occurrence covers
  amount numeric(15,4) NOT NULL,
  paid_amount numeric(15,4) NOT NULL DEFAULT 0,
  due_date date NOT NULL,
  status lb_charge_invoice_status NOT NULL DEFAULT 'DUE',
  credit_transaction_id uuid, -- the lb_customer_credit_transactions row this generation created
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recurring_charge_id, period) -- the actual duplicate-billing guard; generate_recurring_charge_invoice() also checks this explicitly for a clean error message
);

ALTER TABLE lb_recurring_charge_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lb_recurring_charge_invoices ON lb_recurring_charge_invoices;
CREATE POLICY tenant_isolation_lb_recurring_charge_invoices ON lb_recurring_charge_invoices
  FOR ALL USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

-- ---------- lb_meters + lb_meter_readings (§47) ----------

CREATE TABLE IF NOT EXISTS lb_meters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid REFERENCES lb_businesses(id),
  unit_id uuid REFERENCES lb_units(id),
  customer_id uuid REFERENCES lb_customers(id),
  meter_number text NOT NULL,
  meter_type lb_meter_type NOT NULL,
  rate numeric(15,4) NOT NULL DEFAULT 0, -- default per-unit rate; snapshotted onto each reading, so changing this later doesn't rewrite billing history
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lb_meters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lb_meters ON lb_meters;
CREATE POLICY tenant_isolation_lb_meters ON lb_meters
  FOR ALL USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

CREATE TABLE IF NOT EXISTS lb_meter_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid REFERENCES lb_businesses(id),
  meter_id uuid NOT NULL REFERENCES lb_meters(id),
  previous_reading numeric(15,4) NOT NULL,
  current_reading numeric(15,4) NOT NULL,
  consumption numeric(15,4) GENERATED ALWAYS AS (current_reading - previous_reading) STORED,
  rate numeric(15,4) NOT NULL, -- snapshot of lb_meters.rate at reading time
  charge_amount numeric(15,4) GENERATED ALWAYS AS ((current_reading - previous_reading) * rate) STORED,
  reading_date date NOT NULL DEFAULT CURRENT_DATE,
  recurring_charge_invoice_id uuid REFERENCES lb_recurring_charge_invoices(id), -- set once this reading has been billed
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (current_reading >= previous_reading) -- meters don't run backwards; a real rollover/replacement needs a manual adjustment, not a negative consumption row
);

ALTER TABLE lb_meter_readings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lb_meter_readings ON lb_meter_readings;
CREATE POLICY tenant_isolation_lb_meter_readings ON lb_meter_readings
  FOR ALL USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

-- ============================================================
-- RPCs
-- ============================================================

-- Generates one billing occurrence from a recurring_charge definition
-- (or an ad-hoc amount override, e.g. a metered reading's charge_amount)
-- and posts it to the customer's balance atomically — mirrors
-- process_credit_sale_payment()'s shape (raise balance, write ledger
-- row) but as a plain callable RPC rather than a trigger, since there's
-- no "insert a sale" event to hang a trigger off of here.
CREATE OR REPLACE FUNCTION public.generate_recurring_charge_invoice(
  p_recurring_charge_id uuid,
  p_period date,
  p_amount numeric DEFAULT NULL, -- override the definition's amount (e.g. a metered charge); NULL = use lb_recurring_charges.amount
  p_created_by uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_charge RECORD;
  v_amount numeric(15,4);
  v_due_date date;
  v_invoice_id uuid;
  v_new_balance numeric(15,4);
  v_txn_id uuid;
BEGIN
  SELECT * INTO v_charge FROM lb_recurring_charges WHERE id = p_recurring_charge_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recurring charge % not found', p_recurring_charge_id;
  END IF;
  IF v_charge.status != 'ACTIVE' THEN
    RAISE EXCEPTION 'Recurring charge is % — only ACTIVE charges can be billed', v_charge.status;
  END IF;
  IF EXISTS (SELECT 1 FROM lb_recurring_charge_invoices WHERE recurring_charge_id = p_recurring_charge_id AND period = p_period) THEN
    RAISE EXCEPTION 'This charge has already been billed for period %', p_period;
  END IF;

  v_amount := COALESCE(p_amount, v_charge.amount);
  v_due_date := CASE
    WHEN v_charge.due_day IS NULL THEN p_period
    ELSE make_date(
      EXTRACT(year FROM p_period)::int, EXTRACT(month FROM p_period)::int,
      LEAST(v_charge.due_day, EXTRACT(day FROM (date_trunc('month', p_period) + interval '1 month - 1 day'))::int)
    ) -- clamps e.g. due_day=31 into a 30-day month instead of raising
  END;

  INSERT INTO lb_recurring_charge_invoices (
    tenant_id, business_id, recurring_charge_id, customer_id, unit_id,
    period, amount, due_date, status
  ) VALUES (
    v_charge.tenant_id, v_charge.business_id, p_recurring_charge_id, v_charge.customer_id, v_charge.unit_id,
    p_period, v_amount, v_due_date, 'DUE'
  ) RETURNING id INTO v_invoice_id;

  UPDATE lb_customers
  SET outstanding_balance = outstanding_balance + v_amount, updated_at = now()
  WHERE id = v_charge.customer_id
  RETURNING outstanding_balance INTO v_new_balance;

  INSERT INTO lb_customer_credit_transactions (
    tenant_id, business_id, customer_id, transaction_type,
    reference_type, reference_id, amount, balance_after, notes, created_by
  ) VALUES (
    v_charge.tenant_id, v_charge.business_id, v_charge.customer_id, 'ADJUSTMENT',
    'recurring_charge_invoice', v_invoice_id, v_amount, v_new_balance,
    v_charge.charge_name || ' — ' || to_char(p_period, 'Mon YYYY'), p_created_by
  ) RETURNING id INTO v_txn_id;

  UPDATE lb_recurring_charge_invoices SET credit_transaction_id = v_txn_id WHERE id = v_invoice_id;

  RETURN v_invoice_id;
END;
$function$;

-- Records a payment against ONE charge invoice specifically (as opposed
-- to record_customer_payment(), which reduces a customer's overall
-- balance without tracking which invoice(s) it covers). Reuses the exact
-- same payment/ledger mechanics — inserts into lb_customer_payments,
-- decrements lb_customers.outstanding_balance, writes the ledger row —
-- then additionally updates the specific invoice's paid_amount/status.
CREATE OR REPLACE FUNCTION public.record_recurring_charge_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_method lb_payment_method,
  p_reference_no text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice RECORD;
  v_payment_id uuid;
  v_new_paid numeric(15,4);
  v_new_status lb_charge_invoice_status;
BEGIN
  SELECT * INTO v_invoice FROM lb_recurring_charge_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Charge invoice % not found', p_invoice_id;
  END IF;
  IF v_invoice.status IN ('PAID', 'WAIVED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Invoice is already %, cannot record a payment against it', v_invoice.status;
  END IF;

  -- record_customer_payment() already does everything a standalone
  -- payment needs (payment_number, insert, balance decrement, ledger
  -- entry) — call it directly rather than duplicating that logic here.
  v_payment_id := record_customer_payment(
    v_invoice.business_id, NULL, v_invoice.customer_id, p_amount,
    p_payment_method, p_reference_no, p_notes, p_created_by
  );

  v_new_paid := v_invoice.paid_amount + p_amount;
  v_new_status := CASE
    WHEN v_new_paid >= v_invoice.amount THEN 'PAID'
    WHEN v_new_paid > 0 THEN 'PARTIALLY_PAID'
    ELSE v_invoice.status
  END;

  UPDATE lb_recurring_charge_invoices
  SET paid_amount = v_new_paid, status = v_new_status
  WHERE id = p_invoice_id;

  RETURN v_payment_id;
END;
$function$;
