-- ============================================================
-- phase17 — My Invoices, My Maintenance, invoice M-Pesa (STK)
-- Run AFTER phase17a_enum_values.sql.
--
-- Reuses, does not replace: lb_units, lb_customers (tenants),
-- lb_recurring_charges / lb_recurring_charge_invoices (the charge
-- LINES), record_recurring_charge_payment() (which posts through
-- record_customer_payment), record_expense() / lb_expenses (profit),
-- lb_mpesa_transactions + confirm_mpesa_payment() (STK).
-- There is no "property" table in this project: the business IS the
-- property owner and lb_units are its units, so none is invented.
-- NOT run against a live database — column names of record_expense()
-- come from expensesService.js; a mismatch will fail loudly on first use.
-- ============================================================

-- ---------- enums ----------
DO $$ BEGIN CREATE TYPE lb_rent_invoice_status AS ENUM ('DRAFT','ISSUED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE lb_maintenance_status AS ENUM ('REPORTED','OPEN','ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE lb_maintenance_category AS ENUM ('PLUMBING','ELECTRICAL','PAINTING','CARPENTRY','APPLIANCE','SECURITY','CLEANING','OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE lb_maintenance_priority AS ENUM ('LOW','NORMAL','HIGH','URGENT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- document numbers (INV-2026-0001, MNT-2026-0001) ----------
CREATE TABLE IF NOT EXISTS lb_doc_counters (
  business_id uuid NOT NULL, prefix text NOT NULL, yr integer NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (business_id, prefix, yr)
);
ALTER TABLE lb_doc_counters ENABLE ROW LEVEL SECURITY; -- no policies: only the SECURITY DEFINER function below touches it

CREATE OR REPLACE FUNCTION next_doc_number(p_business_id uuid, p_prefix text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_yr integer := EXTRACT(year FROM now())::int; v_n integer;
BEGIN
  INSERT INTO lb_doc_counters (business_id, prefix, yr, last_number) VALUES (p_business_id, p_prefix, v_yr, 1)
  ON CONFLICT (business_id, prefix, yr) DO UPDATE SET last_number = lb_doc_counters.last_number + 1
  RETURNING last_number INTO v_n;
  RETURN p_prefix || '-' || v_yr || '-' || lpad(v_n::text, 4, '0');
END $$;

-- ---------- invoice header ----------
CREATE TABLE IF NOT EXISTS lb_rent_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  customer_id uuid NOT NULL REFERENCES lb_customers(id),   -- the tenant
  unit_id uuid REFERENCES lb_units(id),
  invoice_number text NOT NULL,
  period date NOT NULL,                                     -- first day of billing month
  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date NOT NULL,
  status lb_rent_invoice_status NOT NULL DEFAULT 'DRAFT',   -- Paid/Partially Paid/Overdue are DERIVED (see view), never stored
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, invoice_number)
);
-- one live invoice per tenant+unit+month (cancelled ones don't block a re-issue)
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_rent_invoices_period
  ON lb_rent_invoices (business_id, customer_id, COALESCE(unit_id, '00000000-0000-0000-0000-000000000000'::uuid), period)
  WHERE status <> 'CANCELLED';
CREATE INDEX IF NOT EXISTS idx_lb_rent_invoices_business_period ON lb_rent_invoices (business_id, period);
ALTER TABLE lb_rent_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lb_rent_invoices ON lb_rent_invoices;
CREATE POLICY tenant_isolation_lb_rent_invoices ON lb_rent_invoices FOR ALL
  USING (tenant_id = get_current_tenant_id()) WITH CHECK (tenant_id = get_current_tenant_id());

-- invoice LINES are the existing charge occurrences
ALTER TABLE lb_recurring_charge_invoices ADD COLUMN IF NOT EXISTS rent_invoice_id uuid REFERENCES lb_rent_invoices(id);
CREATE INDEX IF NOT EXISTS idx_lb_rci_rent_invoice ON lb_recurring_charge_invoices (rent_invoice_id);

-- payments made against an invoice (one row per payment, however many lines it settled)
CREATE TABLE IF NOT EXISTS lb_rent_invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL,
  rent_invoice_id uuid NOT NULL REFERENCES lb_rent_invoices(id),
  receipt_number text,                                      -- RCT-2026-0001, gap-free, one per payment
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL,
  source text NOT NULL CHECK (source IN ('MANUAL','MPESA_MANUAL','MPESA_PROMPT')),
  reference_no text,
  mpesa_transaction_id uuid REFERENCES lb_mpesa_transactions(id),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lb_rip_invoice ON lb_rent_invoice_payments (rent_invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_rip_receipt_no ON lb_rent_invoice_payments (business_id, receipt_number) WHERE receipt_number IS NOT NULL;
-- the same M-Pesa code / same STK request can never be recorded twice
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_rip_mpesa_code ON lb_rent_invoice_payments (business_id, reference_no)
  WHERE payment_method = 'MOBILE_MONEY' AND reference_no IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_rip_mpesa_txn ON lb_rent_invoice_payments (mpesa_transaction_id) WHERE mpesa_transaction_id IS NOT NULL;
ALTER TABLE lb_rent_invoice_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lb_rip ON lb_rent_invoice_payments;
CREATE POLICY tenant_isolation_lb_rip ON lb_rent_invoice_payments FOR SELECT USING (tenant_id = get_current_tenant_id());
-- writes only through record_rent_invoice_payment()

-- ---------- summary view: totals + status calculated from real payments ----------
CREATE OR REPLACE VIEW lb_rent_invoice_summary WITH (security_invoker = true) AS
SELECT i.*,
  COALESCE(l.total, 0)  AS total_amount,
  COALESCE(l.paid, 0)   AS paid_amount,
  COALESCE(l.total, 0) - COALESCE(l.paid, 0) AS balance_due,
  COALESCE(pb.prev, 0)  AS previous_balance,
  CASE
    WHEN i.status = 'CANCELLED' THEN 'CANCELLED'
    WHEN i.status = 'DRAFT'     THEN 'DRAFT'
    WHEN COALESCE(l.total,0) > 0 AND COALESCE(l.paid,0) >= COALESCE(l.total,0) THEN 'PAID'
    WHEN i.due_date < CURRENT_DATE THEN 'OVERDUE'
    WHEN COALESCE(l.paid,0) > 0 THEN 'PARTIALLY_PAID'
    ELSE 'ISSUED'
  END AS display_status
FROM lb_rent_invoices i
LEFT JOIN LATERAL (
  SELECT SUM(c.amount) AS total, SUM(c.paid_amount) AS paid
  FROM lb_recurring_charge_invoices c
  WHERE c.rent_invoice_id = i.id AND c.status NOT IN ('WAIVED','CANCELLED')
) l ON true
LEFT JOIN LATERAL (
  SELECT SUM(c.amount - c.paid_amount) AS prev
  FROM lb_recurring_charge_invoices c
  WHERE c.customer_id = i.customer_id AND c.business_id = i.business_id
    AND c.period < i.period AND c.status IN ('DUE','PARTIALLY_PAID','OVERDUE')
    AND c.rent_invoice_id IS DISTINCT FROM i.id
) pb ON true;

-- ---------- generate monthly invoices (idempotent) ----------
CREATE OR REPLACE FUNCTION generate_monthly_rent_invoices(p_business_id uuid, p_period date, p_created_by uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_period date := date_trunc('month', p_period)::date;
  v_next date := (date_trunc('month', p_period) + interval '1 month')::date;
  v_tid uuid := get_current_tenant_id();
  v_unit RECORD; v_ch RECORD; v_inv uuid; v_inv_status lb_rent_invoice_status;
  v_lines integer; v_new integer := 0; v_existing integer := 0; v_empty integer := 0;
BEGIN
  IF v_tid IS NULL THEN RAISE EXCEPTION 'Not signed in to a business.'; END IF;
  FOR v_unit IN
    SELECT * FROM lb_units WHERE business_id = p_business_id AND tenant_id = v_tid AND status = 'OCCUPIED' AND customer_id IS NOT NULL
  LOOP
    SELECT id, status INTO v_inv, v_inv_status FROM lb_rent_invoices
      WHERE business_id = p_business_id AND customer_id = v_unit.customer_id AND unit_id = v_unit.id AND period = v_period AND status <> 'CANCELLED';
    IF v_inv IS NULL THEN
      -- Don't burn an invoice number (they must stay gap-free) on a unit that has nothing to bill this month.
      SELECT (SELECT count(*) FROM lb_recurring_charge_invoices
                WHERE business_id = p_business_id AND customer_id = v_unit.customer_id AND unit_id = v_unit.id
                  AND period >= v_period AND period < v_next AND rent_invoice_id IS NULL AND status NOT IN ('WAIVED','CANCELLED'))
           + (SELECT count(*) FROM lb_recurring_charges c
                WHERE c.business_id = p_business_id AND c.customer_id = v_unit.customer_id AND c.unit_id = v_unit.id
                  AND c.status = 'ACTIVE' AND c.frequency = 'MONTHLY' AND c.start_date < v_next AND (c.end_date IS NULL OR c.end_date >= v_period)
                  AND NOT EXISTS (SELECT 1 FROM lb_recurring_charge_invoices x WHERE x.recurring_charge_id = c.id AND x.period = v_period))
        INTO v_lines;
      IF v_lines = 0 THEN v_empty := v_empty + 1; CONTINUE; END IF;
      INSERT INTO lb_rent_invoices (tenant_id, business_id, customer_id, unit_id, invoice_number, period, due_date, created_by)
      VALUES (v_tid, p_business_id, v_unit.customer_id, v_unit.id, next_doc_number(p_business_id, 'INV'), v_period, v_period, p_created_by)
      RETURNING id INTO v_inv;
      v_inv_status := 'DRAFT'; v_new := v_new + 1;
    ELSE v_existing := v_existing + 1; END IF;

    -- Only a DRAFT is still open to new lines; an issued invoice is left exactly as sent.
    IF v_inv_status = 'DRAFT' THEN
      -- 1) bill each ACTIVE monthly charge once for this month (UNIQUE(charge, period) is the real guard)
      FOR v_ch IN
        SELECT * FROM lb_recurring_charges
        WHERE business_id = p_business_id AND customer_id = v_unit.customer_id AND unit_id = v_unit.id
          AND status = 'ACTIVE' AND frequency = 'MONTHLY' AND start_date < v_next AND (end_date IS NULL OR end_date >= v_period)
      LOOP
        IF NOT EXISTS (SELECT 1 FROM lb_recurring_charge_invoices WHERE recurring_charge_id = v_ch.id AND period = v_period) THEN
          PERFORM generate_recurring_charge_invoice(v_ch.id, v_period, NULL, p_created_by);
        END IF;
      END LOOP;
      -- 2) attach every not-yet-invoiced line for this tenant/unit in the month (monthly lines, metered water/electricity, one-offs)
      UPDATE lb_recurring_charge_invoices
      SET rent_invoice_id = v_inv
      WHERE business_id = p_business_id AND customer_id = v_unit.customer_id AND unit_id = v_unit.id
        AND period >= v_period AND period < v_next AND rent_invoice_id IS NULL AND status NOT IN ('WAIVED','CANCELLED');

      SELECT COUNT(*) INTO v_lines FROM lb_recurring_charge_invoices WHERE rent_invoice_id = v_inv;
      IF v_lines = 0 THEN
        RAISE EXCEPTION 'Invoice % ended up with no charges; nothing was saved.', v_inv; -- rolls the whole run back, numbers included
      ELSE
        UPDATE lb_rent_invoices SET due_date = (SELECT MIN(due_date) FROM lb_recurring_charge_invoices WHERE rent_invoice_id = v_inv) WHERE id = v_inv;
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('created', v_new, 'already_existed', v_existing, 'skipped_no_charges', v_empty);
END $$;

CREATE OR REPLACE FUNCTION issue_rent_invoice(p_invoice_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE lb_rent_invoices SET status = 'ISSUED', issue_date = CURRENT_DATE
  WHERE id = p_invoice_id AND tenant_id = get_current_tenant_id() AND status = 'DRAFT'
    AND EXISTS (SELECT 1 FROM lb_recurring_charge_invoices WHERE rent_invoice_id = p_invoice_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a draft invoice with charges can be issued.'; END IF;
END $$;

-- Cancelling detaches the lines (charges stay on the tenant's balance until waived in Rent & Charges — it does not erase debt).
CREATE OR REPLACE FUNCTION cancel_rent_invoice(p_invoice_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM lb_rent_invoice_payments WHERE rent_invoice_id = p_invoice_id) THEN
    RAISE EXCEPTION 'This invoice already has payments and cannot be cancelled.';
  END IF;
  UPDATE lb_rent_invoices SET status = 'CANCELLED' WHERE id = p_invoice_id AND tenant_id = get_current_tenant_id() AND status <> 'CANCELLED';
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found or already cancelled.'; END IF;
  UPDATE lb_recurring_charge_invoices SET rent_invoice_id = NULL WHERE rent_invoice_id = p_invoice_id;
END $$;

-- ---------- record a payment against an invoice (used by manual entry AND by the M-Pesa callback) ----------
CREATE OR REPLACE FUNCTION record_rent_invoice_payment(
  p_invoice_id uuid, p_amount numeric, p_payment_method text,
  p_reference_no text DEFAULT NULL, p_notes text DEFAULT NULL, p_created_by uuid DEFAULT NULL,
  p_source text DEFAULT 'MANUAL', p_mpesa_transaction_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_inv lb_rent_invoices%ROWTYPE; v_balance numeric; v_left numeric; v_line RECORD; v_apply numeric; v_paid numeric; v_rct text;
BEGIN
  SELECT * INTO v_inv FROM lb_rent_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found.'; END IF;
  -- signed-in users: own business only. The M-Pesa callback runs as service_role and skips this.
  IF auth.role() IS DISTINCT FROM 'service_role' AND v_inv.tenant_id IS DISTINCT FROM get_current_tenant_id() THEN
    RAISE EXCEPTION 'Invoice not found.';
  END IF;
  IF v_inv.status <> 'ISSUED' THEN RAISE EXCEPTION 'Only an issued invoice can take payments (this one is %).', v_inv.status; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be greater than zero.'; END IF;

  SELECT COALESCE(SUM(amount - paid_amount), 0) INTO v_balance
  FROM lb_recurring_charge_invoices WHERE rent_invoice_id = p_invoice_id AND status NOT IN ('WAIVED','CANCELLED','PAID');
  IF v_balance <= 0 THEN RAISE EXCEPTION 'This invoice is already fully paid.'; END IF;
  IF p_amount > v_balance + 0.004 THEN
    RAISE EXCEPTION 'Amount (%) is more than the invoice balance (%).', p_amount, v_balance;
  END IF;
  IF p_payment_method = 'MOBILE_MONEY' AND p_reference_no IS NOT NULL AND EXISTS (
    SELECT 1 FROM lb_rent_invoice_payments WHERE business_id = v_inv.business_id AND payment_method = 'MOBILE_MONEY' AND reference_no = p_reference_no
  ) THEN RAISE EXCEPTION 'M-Pesa code % has already been recorded.', p_reference_no; END IF;

  v_left := p_amount;
  FOR v_line IN
    SELECT * FROM lb_recurring_charge_invoices
    WHERE rent_invoice_id = p_invoice_id AND status IN ('DUE','PARTIALLY_PAID','OVERDUE')
    ORDER BY due_date, created_at FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_apply := LEAST(v_left, v_line.amount - v_line.paid_amount);
    IF v_apply > 0 THEN
      -- existing RPC: posts through record_customer_payment, so the tenant's balance and ledger stay consistent
      PERFORM record_recurring_charge_payment(v_line.id, v_apply, p_payment_method::lb_payment_method, p_reference_no, p_notes, p_created_by);
      v_left := v_left - v_apply;
    END IF;
  END LOOP;

  v_rct := next_doc_number(v_inv.business_id, 'RCT');
  INSERT INTO lb_rent_invoice_payments (tenant_id, business_id, rent_invoice_id, receipt_number, amount, payment_method, source, reference_no, mpesa_transaction_id, notes, created_by)
  VALUES (v_inv.tenant_id, v_inv.business_id, p_invoice_id, v_rct, p_amount, p_payment_method, p_source, p_reference_no, p_mpesa_transaction_id, p_notes, p_created_by);

  SELECT COALESCE(SUM(paid_amount),0), COALESCE(SUM(amount),0) - COALESCE(SUM(paid_amount),0) INTO v_paid, v_balance
  FROM lb_recurring_charge_invoices WHERE rent_invoice_id = p_invoice_id AND status NOT IN ('WAIVED','CANCELLED');
  RETURN jsonb_build_object('paid_amount', v_paid, 'balance_due', v_balance, 'fully_paid', v_balance <= 0, 'receipt_number', v_rct);
END $$;

-- ---------- M-Pesa: let an STK request be FOR an invoice ----------
ALTER TABLE lb_mpesa_transactions ADD COLUMN IF NOT EXISTS rent_invoice_id uuid REFERENCES lb_rent_invoices(id);
ALTER TABLE lb_mpesa_transactions ALTER COLUMN cart_snapshot DROP NOT NULL;
DO $$ BEGIN
  ALTER TABLE lb_mpesa_transactions ADD CONSTRAINT lb_mpesa_txn_has_purpose CHECK (cart_snapshot IS NOT NULL OR rent_invoice_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_lb_mpesa_rent_invoice ON lb_mpesa_transactions (rent_invoice_id);
-- one live prompt per invoice at a time (stops a double-tap sending two prompts)
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_mpesa_one_pending_per_invoice ON lb_mpesa_transactions (rent_invoice_id)
  WHERE status = 'PENDING' AND rent_invoice_id IS NOT NULL;

-- ---------- Maintenance ----------
CREATE TABLE IF NOT EXISTS lb_maintenance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  reference_no text NOT NULL,
  unit_id uuid NOT NULL REFERENCES lb_units(id),
  customer_id uuid REFERENCES lb_customers(id),             -- tenant living there when reported
  reported_date date NOT NULL DEFAULT CURRENT_DATE,
  description text NOT NULL,
  category lb_maintenance_category NOT NULL DEFAULT 'OTHER',
  priority lb_maintenance_priority NOT NULL DEFAULT 'NORMAL',
  status lb_maintenance_status NOT NULL DEFAULT 'REPORTED',
  assigned_to text,
  labour_cost numeric(15,2) NOT NULL DEFAULT 0 CHECK (labour_cost >= 0),
  materials_cost numeric(15,2) NOT NULL DEFAULT 0 CHECK (materials_cost >= 0),
  other_cost numeric(15,2) NOT NULL DEFAULT 0 CHECK (other_cost >= 0),
  total_cost numeric(15,2) GENERATED ALWAYS AS (labour_cost + materials_cost + other_cost) STORED,
  billing_choice text NOT NULL DEFAULT 'BUSINESS' CHECK (billing_choice IN ('BUSINESS','TENANT')),
  completed_date date,
  notes text,
  attachment_urls text[] NOT NULL DEFAULT '{}',
  expense_id uuid REFERENCES lb_expenses(id),                -- set once, when completed with a cost: the link that makes it count in profit
  tenant_charge_line_id uuid REFERENCES lb_recurring_charge_invoices(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, reference_no)
);
CREATE INDEX IF NOT EXISTS idx_lb_maint_business_status ON lb_maintenance_requests (business_id, status);
CREATE INDEX IF NOT EXISTS idx_lb_maint_unit ON lb_maintenance_requests (unit_id, reported_date DESC);
ALTER TABLE lb_maintenance_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lb_maint ON lb_maintenance_requests;
CREATE POLICY tenant_isolation_lb_maint ON lb_maintenance_requests FOR ALL
  USING (tenant_id = get_current_tenant_id()) WITH CHECK (tenant_id = get_current_tenant_id());

-- Moves a job forward. COMPLETED goes through complete_maintenance_request() only (it books the expense).
CREATE OR REPLACE FUNCTION set_maintenance_status(p_id uuid, p_status lb_maintenance_status, p_assigned_to text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v lb_maintenance_requests%ROWTYPE;
BEGIN
  SELECT * INTO v FROM lb_maintenance_requests WHERE id = p_id AND tenant_id = get_current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found.'; END IF;
  IF v.status IN ('COMPLETED','CANCELLED') THEN RAISE EXCEPTION 'This job is already %.', v.status; END IF;
  IF p_status = 'COMPLETED' THEN RAISE EXCEPTION 'Use Complete Job so the cost is recorded.'; END IF;
  IF p_status = 'ASSIGNED' AND COALESCE(NULLIF(trim(COALESCE(p_assigned_to, v.assigned_to, '')), ''), '') = '' THEN
    RAISE EXCEPTION 'Enter who the job is assigned to.';
  END IF;
  UPDATE lb_maintenance_requests SET status = p_status, assigned_to = COALESCE(NULLIF(trim(p_assigned_to), ''), assigned_to), updated_at = now() WHERE id = p_id;
END $$;

CREATE OR REPLACE FUNCTION complete_maintenance_request(
  p_id uuid, p_labour numeric, p_materials numeric, p_other numeric,
  p_payment_method text, p_completed_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL,
  p_billing text DEFAULT 'BUSINESS', p_created_by uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v lb_maintenance_requests%ROWTYPE; v_total numeric; v_cat uuid; v_exp uuid; v_unit text; v_charge uuid; v_line uuid;
BEGIN
  SELECT * INTO v FROM lb_maintenance_requests WHERE id = p_id AND tenant_id = get_current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found.'; END IF;
  IF v.status IN ('COMPLETED','CANCELLED') OR v.expense_id IS NOT NULL THEN RAISE EXCEPTION 'This job is already %.', v.status; END IF;
  v_total := COALESCE(p_labour,0) + COALESCE(p_materials,0) + COALESCE(p_other,0);
  IF LEAST(COALESCE(p_labour,0), COALESCE(p_materials,0), COALESCE(p_other,0)) < 0 THEN RAISE EXCEPTION 'Costs cannot be negative.'; END IF;
  IF p_billing = 'TENANT' AND (v.customer_id IS NULL OR v_total <= 0) THEN
    RAISE EXCEPTION 'To charge the tenant the job needs a tenant and a cost above zero.';
  END IF;
  SELECT unit_number INTO v_unit FROM lb_units WHERE id = v.unit_id;

  IF v_total > 0 THEN
    SELECT id INTO v_cat FROM lb_expense_categories WHERE name = 'Repairs' AND is_active ORDER BY is_system DESC LIMIT 1;
    -- the ONE expense record profit already reads (lb_expenses, status PAID) — no parallel ledger
    v_exp := record_expense(
      p_business_id := v.business_id, p_branch_id := NULL, p_category_id := v_cat, p_expense_date := p_completed_date,
      p_amount := v_total, p_payment_method := p_payment_method::lb_payment_method,
      p_description := 'Maintenance ' || v.reference_no || ' — Unit ' || COALESCE(v_unit,'?') || ' — ' || initcap(lower(v.category::text)),
      p_attachment_url := NULL, p_status := 'PAID', p_created_by := p_created_by);
  END IF;

  -- OPTIONAL recovery from the tenant: a one-off charge on the existing Rent & Charges ledger. The cost is still the owner's expense.
  IF p_billing = 'TENANT' THEN
    INSERT INTO lb_recurring_charges (tenant_id, business_id, customer_id, unit_id, charge_name, amount, frequency, status, created_by)
    VALUES (v.tenant_id, v.business_id, v.customer_id, v.unit_id, 'Repair — ' || initcap(lower(v.category::text)) || ' (' || v.reference_no || ')', v_total, 'ONE_OFF', 'ACTIVE', p_created_by)
    RETURNING id INTO v_charge;
    v_line := generate_recurring_charge_invoice(v_charge, p_completed_date, v_total, p_created_by);
  END IF;

  UPDATE lb_maintenance_requests SET
    labour_cost = COALESCE(p_labour,0), materials_cost = COALESCE(p_materials,0), other_cost = COALESCE(p_other,0),
    status = 'COMPLETED', completed_date = p_completed_date, notes = COALESCE(p_notes, notes),
    billing_choice = CASE WHEN p_billing = 'TENANT' THEN 'TENANT' ELSE 'BUSINESS' END,
    expense_id = v_exp, tenant_charge_line_id = v_line, updated_at = now()
  WHERE id = p_id;
  RETURN jsonb_build_object('total_cost', v_total, 'expense_id', v_exp, 'billed_to_tenant', v_line IS NOT NULL);
END $$;

-- ---------- confirm_mpesa_payment(): phase12 body + an invoice branch (sale branch unchanged) ----------
CREATE OR REPLACE FUNCTION confirm_mpesa_payment(
  p_checkout_request_id text,
  p_result_code integer,
  p_result_desc text,
  p_mpesa_receipt_number text,
  p_raw_callback jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_txn lb_mpesa_transactions%ROWTYPE;
  v_sale_id uuid;
  v_sale_number text;
  v_item jsonb;
  v_warehouse_id uuid;
  v_inv_result jsonb;
BEGIN
  SELECT * INTO v_txn FROM lb_mpesa_transactions WHERE checkout_request_id = p_checkout_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No M-Pesa transaction found for checkout_request_id %', p_checkout_request_id;
  END IF;

  -- Idempotent no-op on a repeated callback for an already-settled request.
  IF v_txn.status IN ('PAID', 'FAILED', 'CANCELLED', 'TIMED_OUT') THEN
    RETURN jsonb_build_object('already_processed', true, 'status', v_txn.status, 'sale_id', v_txn.sale_id);
  END IF;

  UPDATE lb_mpesa_transactions
  SET result_code = p_result_code,
      result_desc = p_result_desc,
      raw_callback = p_raw_callback,
      updated_at = now()
  WHERE id = v_txn.id;

  -- Daraja: ResultCode 0 = success. Anything else = failed/cancelled at
  -- the customer's end. Never inferred as "paid" from anything softer
  -- than this exact code (section 39: "never assume STK request =
  -- payment").
  IF p_result_code <> 0 THEN
    UPDATE lb_mpesa_transactions
    SET status = (CASE WHEN p_result_code = 1032 THEN 'CANCELLED' ELSE 'FAILED' END)::lb_mpesa_status
    WHERE id = v_txn.id;
    RETURN jsonb_build_object('already_processed', false, 'status', 'FAILED', 'sale_id', NULL);
  END IF;

  -- ---- Rent invoice payment (phase17): apply to the invoice, not a sale ----
  IF v_txn.rent_invoice_id IS NOT NULL THEN
    BEGIN
      v_inv_result := record_rent_invoice_payment(
        v_txn.rent_invoice_id, v_txn.amount, 'MOBILE_MONEY', p_mpesa_receipt_number,
        'M-Pesa STK payment', v_txn.requested_by, 'MPESA_PROMPT', v_txn.id);
    EXCEPTION WHEN OTHERS THEN
      -- Safaricom says the money arrived but it can't be applied (invoice cancelled, balance changed, duplicate code…).
      -- Never dropped, never guessed: flagged for a human, with the reason kept.
      UPDATE lb_mpesa_transactions
      SET status = 'NEEDS_ATTENTION', mpesa_receipt_number = p_mpesa_receipt_number, confirmed_at = now(),
          result_desc = COALESCE(result_desc, '') || ' | Received but not applied: ' || SQLERRM
      WHERE id = v_txn.id;
      RETURN jsonb_build_object('already_processed', false, 'status', 'NEEDS_ATTENTION', 'sale_id', NULL);
    END;
    UPDATE lb_mpesa_transactions
    SET status = 'PAID', mpesa_receipt_number = p_mpesa_receipt_number, confirmed_at = now()
    WHERE id = v_txn.id;
    RETURN jsonb_build_object('already_processed', false, 'status', 'PAID', 'sale_id', NULL, 'rent_invoice_id', v_txn.rent_invoice_id);
  END IF;

  -- ---- Payment confirmed. Create the sale now, not before. ----
  SELECT id INTO v_warehouse_id FROM lb_warehouses WHERE business_id = v_txn.business_id AND is_default = true LIMIT 1;

  INSERT INTO lb_sales (
    tenant_id, business_id, cashier_id, shift_id, customer_id, sale_number,
    status, subtotal, discount_total, tax_total, total_amount, notes,
    completed_at, client_reference
  )
  SELECT
    v_txn.tenant_id, v_txn.business_id, v_txn.requested_by, v_txn.shift_id, v_txn.customer_id,
    generate_sale_number(),
    'COMPLETED',
    COALESCE((SELECT SUM((i->>'quantity')::numeric * (i->>'unit_price')::numeric) FROM jsonb_array_elements(v_txn.cart_snapshot) i), v_txn.amount),
    0, 0, v_txn.amount,
    'M-Pesa STK payment — ' || COALESCE(p_mpesa_receipt_number, ''),
    now(),
    'MPESA-' || p_checkout_request_id
  RETURNING id, sale_number INTO v_sale_id, v_sale_number;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_txn.cart_snapshot)
  LOOP
    INSERT INTO lb_sale_items (
      tenant_id, sale_id, product_id, quantity, unit_price, cost_price,
      discount_amount, discount_percent, tax_amount, total_price, selling_mode
    ) VALUES (
      v_txn.tenant_id, v_sale_id, (v_item->>'product_id')::uuid,
      (v_item->>'quantity')::numeric, (v_item->>'unit_price')::numeric,
      COALESCE((v_item->>'cost_price')::numeric, 0),
      COALESCE((v_item->>'discount_amount')::numeric, 0), 0, 0,
      (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric - COALESCE((v_item->>'discount_amount')::numeric, 0),
      COALESCE(v_item->>'selling_mode', 'PER_UNIT')
    );

    -- Same stock-movement shape applyStockMovement() writes for a normal
    -- till sale (movement_type = 'SALE', negative quantity) -- inserted
    -- directly here since this function runs inside the DB, not through
    -- the JS service layer, but it is the SAME lb_inventory_movements
    -- table and the SAME triggers/effects a JS-created sale produces.
    -- Not a second, parallel stock-adjustment mechanism (section 4).
    IF v_warehouse_id IS NOT NULL THEN
      UPDATE lb_inventory
      SET quantity = quantity - (v_item->>'quantity')::numeric, updated_at = now()
      WHERE product_id = (v_item->>'product_id')::uuid AND warehouse_id = v_warehouse_id;

      INSERT INTO lb_inventory_movements (
        tenant_id, business_id, warehouse_id, product_id, movement_type,
        quantity, unit_cost, reference_id, reference_type, created_by
      ) VALUES (
        v_txn.tenant_id, v_txn.business_id, v_warehouse_id, (v_item->>'product_id')::uuid, 'SALE',
        -(v_item->>'quantity')::numeric, COALESCE((v_item->>'cost_price')::numeric, 0),
        v_sale_id, 'SALE', v_txn.requested_by
      );
    END IF;
  END LOOP;

  INSERT INTO lb_payments (tenant_id, business_id, sale_id, payment_method, amount, change_amount, reference_no, status, created_by)
  VALUES (v_txn.tenant_id, v_txn.business_id, v_sale_id, 'MOBILE_MONEY', v_txn.amount, 0, p_mpesa_receipt_number, 'COMPLETED', v_txn.requested_by);

  UPDATE lb_mpesa_transactions
  SET status = 'PAID', mpesa_receipt_number = p_mpesa_receipt_number, sale_id = v_sale_id, confirmed_at = now()
  WHERE id = v_txn.id;

  RETURN jsonb_build_object('already_processed', false, 'status', 'PAID', 'sale_id', v_sale_id, 'sale_number', v_sale_number);
END;
$$;
