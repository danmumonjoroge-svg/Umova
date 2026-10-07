-- ============================================================
-- phase19 — Customer Folios (Phase 2 of the hospitality/production upgrade)
--
-- ONE customer, ONE running bill. A folio collects charges from the
-- existing POS (sales charged to the account) and, later, from rooms,
-- services and packages, then is settled in one go.
--
-- Reuses, does not replace: lb_customers (a guest IS a customer),
-- lb_sales / lb_sale_items (the POS), lb_products (names, service flag),
-- next_doc_number() + lb_doc_counters (phase17) for FOL-/INV-/RCT- numbers,
-- the tenant_isolation RLS pattern (phase6).
--
-- DESIGN DECISIONS (see PHASE1_DEPENDENCY_MAP.md):
--  * A folio balance is NOT written to lb_customers.outstanding_balance.
--    That column is moved by process_credit_sale_payment on CREDIT
--    payments; a folio-charged sale carries NO payment row, so nothing
--    is double counted. financialReportsService adds open folio
--    balances to receivables instead.
--  * The invoice and receipt are RENDERED from the folio. Settling
--    allocates invoice_number / receipt_number on the folio itself;
--    there is no second invoice table and lb_receipts is untouched.
--  * Folio payments live in lb_folio_payments (shift_id nullable for a
--    later till-reconciliation step). Reports read them directly.
--  * Money changes only through the SECURITY DEFINER functions below,
--    which check the caller's tenant themselves.
--
-- NOT RUN against a live database. Assumed (confirm on staging):
--   lb_sales(id, tenant_id, business_id, customer_id, status),
--   lb_sale_items(id, sale_id, product_id, quantity, unit_price, total_price),
--   lb_products(id, name, track_inventory), lb_payment_method enum with
--   CASH / MOBILE_MONEY / CARD (BANK optional).
-- Needs no enum change, so it can run in one go.
-- ============================================================

-- ---------- folio header ----------
CREATE TABLE IF NOT EXISTS lb_folios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  customer_id uuid NOT NULL REFERENCES lb_customers(id),
  stay_id uuid,                              -- FK added in Phase 3 (lb_stays)
  folio_number text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','SETTLED','VOID')),
  title text,                                -- e.g. "Room 204"
  invoice_number text,                       -- allocated at settlement
  receipt_number text,                       -- allocated at settlement
  opened_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  notes text,
  created_by uuid,
  settled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, folio_number)
);
-- one open bill per customer: "one customer — one bill"
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_folios_one_open_per_customer
  ON lb_folios(customer_id) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_lb_folios_business_status ON lb_folios(business_id, status);

-- ---------- folio lines (signed amount; negative = adjustment/discount) ----------
CREATE TABLE IF NOT EXISTS lb_folio_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  folio_id uuid NOT NULL REFERENCES lb_folios(id),
  line_type text NOT NULL CHECK (line_type IN ('ROOM','PRODUCT','SERVICE','ACTIVITY','PACKAGE','OTHER','ADJUSTMENT')),
  category text,                             -- receipt grouping: Food, Beverages, Activities...
  description text NOT NULL,
  quantity numeric(15,4) NOT NULL DEFAULT 1,
  unit_price numeric(15,4) NOT NULL DEFAULT 0,
  amount numeric(15,4) NOT NULL,
  sale_id uuid REFERENCES lb_sales(id),      -- set when the line came from a POS sale
  sale_item_id uuid,                         -- idempotency: one line per sale item
  status text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','VOID')),
  void_reason text,
  client_reference text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_folio_lines_sale_item ON lb_folio_lines(sale_item_id) WHERE sale_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_folio_lines_client_ref ON lb_folio_lines(client_reference) WHERE client_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lb_folio_lines_folio ON lb_folio_lines(folio_id);

-- ---------- folio payments ----------
CREATE TABLE IF NOT EXISTS lb_folio_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  folio_id uuid NOT NULL REFERENCES lb_folios(id),
  payment_method lb_payment_method NOT NULL,
  amount numeric(15,4) NOT NULL CHECK (amount > 0),
  reference_no text,                         -- e.g. M-Pesa code
  shift_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lb_folio_payments_folio ON lb_folio_payments(folio_id);

-- ---------- link the existing POS (all nullable: retail is unchanged) ----------
ALTER TABLE lb_sales ADD COLUMN IF NOT EXISTS folio_id uuid REFERENCES lb_folios(id);
ALTER TABLE lb_sales ADD COLUMN IF NOT EXISTS stay_id uuid;
CREATE INDEX IF NOT EXISTS idx_lb_sales_folio ON lb_sales(folio_id) WHERE folio_id IS NOT NULL;

-- ---------- RLS: same policy as every lb_* table ----------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['lb_folios','lb_folio_lines','lb_folio_payments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%I ON %I', t, t);
    EXECUTE format('CREATE POLICY tenant_isolation_%I ON %I FOR ALL USING (tenant_id = get_current_tenant_id()) WITH CHECK (tenant_id = get_current_tenant_id())', t, t);
  END LOOP;
END $$;

-- Direct writes to the money tables are closed to clients: they go through
-- the functions below (which are SECURITY DEFINER and tenant-checked).
-- Clients keep SELECT through RLS.
REVOKE INSERT, UPDATE, DELETE ON lb_folios, lb_folio_lines, lb_folio_payments FROM anon, authenticated;
GRANT SELECT ON lb_folios, lb_folio_lines, lb_folio_payments TO authenticated;

-- ---------- balance view (security_invoker: RLS of the caller applies) ----------
CREATE OR REPLACE VIEW lb_folio_summary WITH (security_invoker = true) AS
SELECT f.*,
       COALESCE(l.charges, 0)                      AS total_charges,
       COALESCE(p.paid, 0)                         AS total_paid,
       COALESCE(l.charges, 0) - COALESCE(p.paid, 0) AS balance_due
FROM lb_folios f
LEFT JOIN (SELECT folio_id, SUM(amount) AS charges FROM lb_folio_lines WHERE status = 'POSTED' GROUP BY folio_id) l ON l.folio_id = f.id
LEFT JOIN (SELECT folio_id, SUM(amount) AS paid FROM lb_folio_payments GROUP BY folio_id) p ON p.folio_id = f.id;
GRANT SELECT ON lb_folio_summary TO authenticated;

-- ============================================================
-- RPCs
-- ============================================================

-- Internal: fetch a folio the caller owns, locked, or raise.
CREATE OR REPLACE FUNCTION _folio_for_update(p_folio_id uuid) RETURNS lb_folios
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v lb_folios;
BEGIN
  SELECT * INTO v FROM lb_folios WHERE id = p_folio_id AND tenant_id = get_current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Folio not found'; END IF;
  RETURN v;
END $$;

-- Opens a folio for a customer, or returns their existing open one.
CREATE OR REPLACE FUNCTION open_folio(p_business_id uuid, p_customer_id uuid, p_title text DEFAULT NULL, p_stay_id uuid DEFAULT NULL, p_created_by uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tid uuid := get_current_tenant_id(); v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM lb_customers WHERE id = p_customer_id AND tenant_id = v_tid) THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM lb_businesses WHERE id = p_business_id AND tenant_id = v_tid) THEN
    RAISE EXCEPTION 'Business not found';
  END IF;
  SELECT id INTO v_id FROM lb_folios WHERE customer_id = p_customer_id AND status = 'OPEN';
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO lb_folios (tenant_id, business_id, customer_id, stay_id, folio_number, title, created_by)
  VALUES (v_tid, p_business_id, p_customer_id, p_stay_id, next_doc_number(p_business_id, 'FOL'), p_title, p_created_by)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Adds a manual line (room night, activity, other charge, or a negative adjustment).
CREATE OR REPLACE FUNCTION post_folio_line(
  p_folio_id uuid, p_line_type text, p_description text, p_quantity numeric, p_unit_price numeric,
  p_category text DEFAULT NULL, p_client_reference text DEFAULT NULL, p_created_by uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_f lb_folios; v_id uuid; v_amount numeric(15,4);
BEGIN
  v_f := _folio_for_update(p_folio_id);
  IF v_f.status <> 'OPEN' THEN RAISE EXCEPTION 'This folio is % and cannot take new charges', lower(v_f.status); END IF;
  IF p_line_type NOT IN ('ROOM','SERVICE','ACTIVITY','PACKAGE','OTHER','ADJUSTMENT','PRODUCT') THEN RAISE EXCEPTION 'Unknown line type %', p_line_type; END IF;
  IF coalesce(btrim(p_description), '') = '' THEN RAISE EXCEPTION 'Description is required'; END IF;
  IF p_quantity IS NULL OR p_quantity = 0 THEN RAISE EXCEPTION 'Quantity is required'; END IF;
  IF p_line_type <> 'ADJUSTMENT' AND (p_quantity < 0 OR p_unit_price < 0) THEN RAISE EXCEPTION 'Use an adjustment for a discount or correction'; END IF;
  v_amount := round(p_quantity * p_unit_price, 4);
  IF p_line_type = 'ADJUSTMENT' AND v_amount > 0 THEN v_amount := -v_amount; END IF; -- adjustments always reduce the bill
  IF p_client_reference IS NOT NULL THEN
    SELECT id INTO v_id FROM lb_folio_lines WHERE client_reference = p_client_reference AND tenant_id = v_f.tenant_id;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  INSERT INTO lb_folio_lines (tenant_id, business_id, folio_id, line_type, category, description, quantity, unit_price, amount, client_reference, created_by)
  VALUES (v_f.tenant_id, v_f.business_id, v_f.id, p_line_type, p_category, btrim(p_description), p_quantity, p_unit_price, v_amount, p_client_reference, p_created_by)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Charges an existing POS sale to a folio: one line per sale item, amounts
-- read from the sale itself (the client cannot invent them). Idempotent.
CREATE OR REPLACE FUNCTION post_sale_to_folio(p_folio_id uuid, p_sale_id uuid, p_created_by uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_f lb_folios; v_sale lb_sales; v_n integer;
BEGIN
  v_f := _folio_for_update(p_folio_id);
  IF v_f.status <> 'OPEN' THEN RAISE EXCEPTION 'This folio is % and cannot take new charges', lower(v_f.status); END IF;
  SELECT * INTO v_sale FROM lb_sales WHERE id = p_sale_id AND tenant_id = v_f.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF v_sale.customer_id IS DISTINCT FROM v_f.customer_id THEN RAISE EXCEPTION 'The sale belongs to a different customer than this folio'; END IF;
  IF v_sale.folio_id IS DISTINCT FROM v_f.id THEN RAISE EXCEPTION 'The sale was not marked for this folio'; END IF;

  INSERT INTO lb_folio_lines (tenant_id, business_id, folio_id, line_type, description, quantity, unit_price, amount, sale_id, sale_item_id, created_by)
  SELECT v_f.tenant_id, v_f.business_id, v_f.id,
         CASE WHEN p.track_inventory IS FALSE THEN 'SERVICE' ELSE 'PRODUCT' END,
         coalesce(p.name, 'Item'), si.quantity, si.unit_price, si.total_price, v_sale.id, si.id, p_created_by
  FROM lb_sale_items si
  LEFT JOIN lb_products p ON p.id = si.product_id
  WHERE si.sale_id = v_sale.id
  ON CONFLICT (sale_item_id) WHERE sale_item_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- Corrects a mistake without deleting history.
CREATE OR REPLACE FUNCTION void_folio_line(p_line_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_l lb_folio_lines; v_f lb_folios;
BEGIN
  SELECT * INTO v_l FROM lb_folio_lines WHERE id = p_line_id AND tenant_id = get_current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Line not found'; END IF;
  v_f := _folio_for_update(v_l.folio_id);
  IF v_f.status <> 'OPEN' THEN RAISE EXCEPTION 'A settled folio cannot be changed'; END IF;
  IF v_l.sale_id IS NOT NULL THEN RAISE EXCEPTION 'This charge came from a sale. Void the sale instead'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  UPDATE lb_folio_lines SET status = 'VOID', void_reason = p_reason WHERE id = p_line_id;
END $$;

-- Settles the whole account in one transaction.
-- p_payments: [{"payment_method":"MOBILE_MONEY","amount":12300,"reference_no":"SHK7X9ABCD"}, ...]
-- Total paid must equal the balance exactly (no change handling; CREDIT not allowed here).
CREATE OR REPLACE FUNCTION settle_folio(p_folio_id uuid, p_payments jsonb, p_settled_by uuid DEFAULT NULL, p_shift_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_f lb_folios; v_charges numeric(15,4); v_paid numeric(15,4); v_balance numeric(15,4);
  v_pay jsonb; v_in numeric(15,4) := 0; v_amt numeric(15,4); v_inv text; v_rct text;
BEGIN
  v_f := _folio_for_update(p_folio_id);
  IF v_f.status <> 'OPEN' THEN RAISE EXCEPTION 'This folio is already %', lower(v_f.status); END IF;
  SELECT COALESCE(SUM(amount),0) INTO v_charges FROM lb_folio_lines WHERE folio_id = v_f.id AND status = 'POSTED';
  SELECT COALESCE(SUM(amount),0) INTO v_paid FROM lb_folio_payments WHERE folio_id = v_f.id;
  v_balance := v_charges - v_paid;
  IF v_charges <= 0 THEN RAISE EXCEPTION 'There is nothing to settle on this folio'; END IF;

  FOR v_pay IN SELECT * FROM jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) LOOP
    v_amt := (v_pay->>'amount')::numeric;
    IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'Each payment needs an amount above zero'; END IF;
    IF upper(coalesce(v_pay->>'payment_method','')) = 'CREDIT' THEN RAISE EXCEPTION 'A folio cannot be settled on credit'; END IF;
    v_in := v_in + v_amt;
  END LOOP;
  IF v_in <> v_balance THEN
    RAISE EXCEPTION 'Payments (%) must equal the balance (%)', v_in, v_balance;
  END IF;

  FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    INSERT INTO lb_folio_payments (tenant_id, business_id, folio_id, payment_method, amount, reference_no, shift_id, created_by)
    VALUES (v_f.tenant_id, v_f.business_id, v_f.id, (v_pay->>'payment_method')::lb_payment_method, (v_pay->>'amount')::numeric, nullif(btrim(v_pay->>'reference_no'),''), p_shift_id, p_settled_by);
  END LOOP;

  v_inv := next_doc_number(v_f.business_id, 'INV');
  v_rct := next_doc_number(v_f.business_id, 'RCT');
  UPDATE lb_folios SET status = 'SETTLED', settled_at = now(), settled_by = p_settled_by,
         invoice_number = v_inv, receipt_number = v_rct, updated_at = now()
   WHERE id = v_f.id;
  RETURN jsonb_build_object('folio_id', v_f.id, 'invoice_number', v_inv, 'receipt_number', v_rct, 'total', v_charges);
END $$;

-- Cancels an empty folio (nothing posted, nothing paid).
CREATE OR REPLACE FUNCTION void_folio(p_folio_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_f lb_folios;
BEGIN
  v_f := _folio_for_update(p_folio_id);
  IF v_f.status <> 'OPEN' THEN RAISE EXCEPTION 'Only an open folio can be cancelled'; END IF;
  IF EXISTS (SELECT 1 FROM lb_folio_lines WHERE folio_id = v_f.id AND status = 'POSTED') OR EXISTS (SELECT 1 FROM lb_folio_payments WHERE folio_id = v_f.id) THEN
    RAISE EXCEPTION 'This folio has charges. Void or settle them first';
  END IF;
  UPDATE lb_folios SET status = 'VOID', updated_at = now() WHERE id = v_f.id;
END $$;

REVOKE ALL ON FUNCTION open_folio, post_folio_line, post_sale_to_folio, void_folio_line, settle_folio, void_folio, _folio_for_update FROM PUBLIC;
GRANT EXECUTE ON FUNCTION open_folio, post_folio_line, post_sale_to_folio, void_folio_line, settle_folio, void_folio TO authenticated;
