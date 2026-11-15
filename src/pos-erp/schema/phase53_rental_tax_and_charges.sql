-- ============================================================
-- phase53 — Rentals: every tenant charge on the invoice, and tax from Settings
-- Run AFTER phase5_property.sql and phase17_invoices_maintenance.sql. Safe to run twice.
--
-- 1) TAX. The business tax rate and "prices include tax" switch come from Settings > Payments & tax
--    (lb_pos_settings.settings: tax_rate, tax_inclusive). Each charge line now records the rate that applied
--    WHEN IT WAS BILLED, so changing Settings later never rewrites an old invoice.
--      - prices include tax  : the line amount is unchanged; the tax inside it is worked out and shown.
--      - prices exclude tax  : tax is added on top, and the line amount (what the tenant owes) includes it.
--    A charge can be marked "not taxable" (e.g. residential rent). Default is taxable, so the Settings rate
--    applies unless the owner switches it off per charge. A rate of 0 changes nothing.
-- 2) NO LEFT-OUT CHARGES. A water/electricity reading or a repair charged to the tenant, saved after that month's
--    invoice was already issued, used to be stranded (never on any invoice). The monthly run now also picks up
--    any earlier charge still not on an invoice and puts it on the next draft.
-- 3) RECEIPTS carry the tax share of each payment.
-- ============================================================

-- ---------- columns ----------
ALTER TABLE lb_recurring_charges ADD COLUMN IF NOT EXISTS taxable boolean NOT NULL DEFAULT true;

ALTER TABLE lb_recurring_charge_invoices ADD COLUMN IF NOT EXISTS net_amount numeric(15,4);          -- before tax; NULL on old rows = amount
ALTER TABLE lb_recurring_charge_invoices ADD COLUMN IF NOT EXISTS tax_rate numeric(7,4) NOT NULL DEFAULT 0;
ALTER TABLE lb_recurring_charge_invoices ADD COLUMN IF NOT EXISTS tax_amount numeric(15,4) NOT NULL DEFAULT 0;
ALTER TABLE lb_recurring_charge_invoices ADD COLUMN IF NOT EXISTS tax_inclusive boolean NOT NULL DEFAULT true;

ALTER TABLE lb_rent_invoice_payments ADD COLUMN IF NOT EXISTS tax_amount numeric(15,2) NOT NULL DEFAULT 0; -- tax share of this payment, for the receipt

-- ---------- the business's tax setting (one place) ----------
CREATE OR REPLACE FUNCTION rental_tax_setting(p_business_id uuid, OUT rate numeric, OUT inclusive boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s jsonb;
BEGIN
  SELECT settings INTO s FROM lb_pos_settings WHERE business_id = p_business_id ORDER BY (branch_id IS NULL) DESC LIMIT 1;
  rate := COALESCE(NULLIF(s->>'tax_rate', '')::numeric, 0);
  IF rate < 0 THEN rate := 0; END IF;
  inclusive := COALESCE((s->>'tax_inclusive')::boolean, true);
EXCEPTION WHEN undefined_column THEN
  -- lb_pos_settings without branch_id: take the business's row
  SELECT settings INTO s FROM lb_pos_settings WHERE business_id = p_business_id LIMIT 1;
  rate := COALESCE(NULLIF(s->>'tax_rate', '')::numeric, 0);
  inclusive := COALESCE((s->>'tax_inclusive')::boolean, true);
END $$;

-- ---------- billing one charge occurrence, now with tax ----------
CREATE OR REPLACE FUNCTION public.generate_recurring_charge_invoice(
  p_recurring_charge_id uuid,
  p_period date,
  p_amount numeric DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_charge RECORD; v_base numeric(15,4); v_total numeric(15,4); v_tax numeric(15,4) := 0; v_rate numeric := 0; v_incl boolean := true;
  v_due_date date; v_invoice_id uuid; v_new_balance numeric(15,4); v_txn_id uuid;
BEGIN
  SELECT * INTO v_charge FROM lb_recurring_charges WHERE id = p_recurring_charge_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recurring charge % not found', p_recurring_charge_id; END IF;
  IF v_charge.status != 'ACTIVE' THEN RAISE EXCEPTION 'Recurring charge is % — only ACTIVE charges can be billed', v_charge.status; END IF;
  IF EXISTS (SELECT 1 FROM lb_recurring_charge_invoices WHERE recurring_charge_id = p_recurring_charge_id AND period = p_period) THEN
    RAISE EXCEPTION 'This charge has already been billed for period %', p_period;
  END IF;

  v_base := COALESCE(p_amount, v_charge.amount);
  v_total := v_base;
  IF v_charge.taxable THEN
    SELECT rate, inclusive INTO v_rate, v_incl FROM rental_tax_setting(v_charge.business_id);
    IF v_rate > 0 THEN
      IF v_incl THEN v_tax := round(v_base * v_rate / (100 + v_rate), 2);              -- tax already inside the amount
      ELSE v_tax := round(v_base * v_rate / 100, 2); v_total := v_base + v_tax; END IF;  -- tax added on top
    END IF;
  END IF;
  IF v_tax = 0 THEN v_rate := 0; END IF;

  v_due_date := CASE
    WHEN v_charge.due_day IS NULL THEN p_period
    ELSE make_date(EXTRACT(year FROM p_period)::int, EXTRACT(month FROM p_period)::int,
      LEAST(v_charge.due_day, EXTRACT(day FROM (date_trunc('month', p_period) + interval '1 month - 1 day'))::int))
  END;

  INSERT INTO lb_recurring_charge_invoices (
    tenant_id, business_id, recurring_charge_id, customer_id, unit_id, period,
    amount, net_amount, tax_rate, tax_amount, tax_inclusive, due_date, status
  ) VALUES (
    v_charge.tenant_id, v_charge.business_id, p_recurring_charge_id, v_charge.customer_id, v_charge.unit_id, p_period,
    v_total, v_total - v_tax, v_rate, v_tax, v_incl, v_due_date, 'DUE'
  ) RETURNING id INTO v_invoice_id;

  UPDATE lb_customers SET outstanding_balance = outstanding_balance + v_total, updated_at = now()
  WHERE id = v_charge.customer_id RETURNING outstanding_balance INTO v_new_balance;

  INSERT INTO lb_customer_credit_transactions (
    tenant_id, business_id, customer_id, transaction_type, reference_type, reference_id, amount, balance_after, notes, created_by
  ) VALUES (
    v_charge.tenant_id, v_charge.business_id, v_charge.customer_id, 'ADJUSTMENT', 'recurring_charge_invoice', v_invoice_id, v_total, v_new_balance,
    v_charge.charge_name || ' — ' || to_char(p_period, 'Mon YYYY') || CASE WHEN v_tax > 0 THEN ' (incl. tax ' || v_tax || ')' ELSE '' END, p_created_by
  ) RETURNING id INTO v_txn_id;

  UPDATE lb_recurring_charge_invoices SET credit_transaction_id = v_txn_id WHERE id = v_invoice_id;
  RETURN v_invoice_id;
END $function$;

-- ---------- invoice view: add subtotal / tax (columns appended; nothing existing moves) ----------
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
  END AS display_status,
  COALESCE(l.total, 0) - COALESCE(l.tax, 0) AS subtotal_amount,
  COALESCE(l.tax, 0)    AS tax_total,
  COALESCE(l.rate, 0)   AS tax_rate,
  COALESCE(l.incl, true) AS tax_inclusive
FROM lb_rent_invoices i
LEFT JOIN LATERAL (
  SELECT SUM(c.amount) AS total, SUM(c.paid_amount) AS paid, SUM(c.tax_amount) AS tax, MAX(c.tax_rate) AS rate, bool_and(c.tax_inclusive) AS incl
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

-- ---------- monthly run: also sweep up earlier charges that never reached an invoice ----------
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
    v_inv := NULL; v_inv_status := NULL;
    SELECT id, status INTO v_inv, v_inv_status FROM lb_rent_invoices
      WHERE business_id = p_business_id AND customer_id = v_unit.customer_id AND unit_id = v_unit.id AND period = v_period AND status <> 'CANCELLED';
    IF v_inv IS NULL THEN
      SELECT (SELECT count(*) FROM lb_recurring_charge_invoices
                WHERE business_id = p_business_id AND customer_id = v_unit.customer_id AND unit_id = v_unit.id
                  AND period < v_next AND rent_invoice_id IS NULL AND status NOT IN ('WAIVED','CANCELLED') AND (period >= v_period OR status <> 'PAID'))
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

    IF v_inv_status = 'DRAFT' THEN
      FOR v_ch IN
        SELECT * FROM lb_recurring_charges
        WHERE business_id = p_business_id AND customer_id = v_unit.customer_id AND unit_id = v_unit.id
          AND status = 'ACTIVE' AND frequency = 'MONTHLY' AND start_date < v_next AND (end_date IS NULL OR end_date >= v_period)
      LOOP
        IF NOT EXISTS (SELECT 1 FROM lb_recurring_charge_invoices WHERE recurring_charge_id = v_ch.id AND period = v_period) THEN
          PERFORM generate_recurring_charge_invoice(v_ch.id, v_period, NULL, p_created_by);
        END IF;
      END LOOP;
      -- every charge of this tenant/unit not yet on an invoice, this month OR earlier (late meter readings, late repair charges)
      UPDATE lb_recurring_charge_invoices
      SET rent_invoice_id = v_inv
      WHERE business_id = p_business_id AND customer_id = v_unit.customer_id AND unit_id = v_unit.id
        AND period < v_next AND rent_invoice_id IS NULL AND status NOT IN ('WAIVED','CANCELLED') AND (period >= v_period OR status <> 'PAID');

      SELECT COUNT(*) INTO v_lines FROM lb_recurring_charge_invoices WHERE rent_invoice_id = v_inv;
      IF v_lines = 0 THEN
        RAISE EXCEPTION 'Invoice % ended up with no charges; nothing was saved.', v_inv;
      ELSE
        UPDATE lb_rent_invoices SET due_date = (SELECT MIN(due_date) FROM lb_recurring_charge_invoices WHERE rent_invoice_id = v_inv) WHERE id = v_inv;
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('created', v_new, 'already_existed', v_existing, 'skipped_no_charges', v_empty);
END $$;

-- ---------- payment: same as phase17, plus the tax share stored for the receipt ----------
CREATE OR REPLACE FUNCTION record_rent_invoice_payment(
  p_invoice_id uuid, p_amount numeric, p_payment_method text,
  p_reference_no text DEFAULT NULL, p_notes text DEFAULT NULL, p_created_by uuid DEFAULT NULL,
  p_source text DEFAULT 'MANUAL', p_mpesa_transaction_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_inv lb_rent_invoices%ROWTYPE; v_balance numeric; v_left numeric; v_line RECORD; v_apply numeric; v_paid numeric; v_rct text;
  v_tot numeric; v_tax numeric; v_ptax numeric := 0;
BEGIN
  SELECT * INTO v_inv FROM lb_rent_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found.'; END IF;
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

  -- tax share of this payment = invoice tax / invoice total, applied to the amount paid
  SELECT COALESCE(SUM(amount),0), COALESCE(SUM(tax_amount),0) INTO v_tot, v_tax
  FROM lb_recurring_charge_invoices WHERE rent_invoice_id = p_invoice_id AND status NOT IN ('WAIVED','CANCELLED');
  IF v_tot > 0 AND v_tax > 0 THEN v_ptax := round(p_amount * v_tax / v_tot, 2); END IF;

  v_left := p_amount;
  FOR v_line IN
    SELECT * FROM lb_recurring_charge_invoices
    WHERE rent_invoice_id = p_invoice_id AND status IN ('DUE','PARTIALLY_PAID','OVERDUE')
    ORDER BY due_date, created_at FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_apply := LEAST(v_left, v_line.amount - v_line.paid_amount);
    IF v_apply > 0 THEN
      PERFORM record_recurring_charge_payment(v_line.id, v_apply, p_payment_method::lb_payment_method, p_reference_no, p_notes, p_created_by);
      v_left := v_left - v_apply;
    END IF;
  END LOOP;

  v_rct := next_doc_number(v_inv.business_id, 'RCT');
  INSERT INTO lb_rent_invoice_payments (tenant_id, business_id, rent_invoice_id, receipt_number, amount, tax_amount, payment_method, source, reference_no, mpesa_transaction_id, notes, created_by)
  VALUES (v_inv.tenant_id, v_inv.business_id, p_invoice_id, v_rct, p_amount, v_ptax, p_payment_method, p_source, p_reference_no, p_mpesa_transaction_id, p_notes, p_created_by);

  SELECT COALESCE(SUM(paid_amount),0), COALESCE(SUM(amount),0) - COALESCE(SUM(paid_amount),0) INTO v_paid, v_balance
  FROM lb_recurring_charge_invoices WHERE rent_invoice_id = p_invoice_id AND status NOT IN ('WAIVED','CANCELLED');
  RETURN jsonb_build_object('paid_amount', v_paid, 'balance_due', v_balance, 'fully_paid', v_balance <= 0, 'receipt_number', v_rct, 'tax_amount', v_ptax);
END $$;
