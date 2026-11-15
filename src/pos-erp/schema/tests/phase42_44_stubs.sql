-- Stand-ins for the live tables phases 42-44 touch (scratch database ONLY). Columns come from what the app code and
-- phases 12/13/17/19/28/39 read and write. Passing proves the NEW logic, NOT that the live database matches:
-- run the migrations on STAGING first and click through the screens.
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('test.role', true), ''), 'authenticated') $$;
CREATE OR REPLACE FUNCTION get_current_tenant_id() RETURNS uuid LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('test.tenant', true), ''), '00000000-0000-0000-0000-0000000000a1')::uuid $$;
-- a "POS staff session" is simulated with test.pos = 'on' and a comma list in test.perms
CREATE OR REPLACE FUNCTION is_pos_session() RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.pos', true), 'off') = 'on' $$;
CREATE OR REPLACE FUNCTION pos_has_permission(p text) RETURNS boolean LANGUAGE sql AS $$ SELECT p = ANY (string_to_array(coalesce(current_setting('test.perms', true), ''), ',')) $$;
-- identical to phase28_permissions.sql
CREATE OR REPLACE FUNCTION pos_require(VARIADIC p_perms text[]) RETURNS void LANGUAGE plpgsql STABLE AS $$
DECLARE a text;
BEGIN
  IF NOT is_pos_session() THEN RETURN; END IF;
  FOREACH a IN ARRAY p_perms LOOP IF pos_has_permission(a) THEN RETURN; END IF; END LOOP;
  RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501';
END $$;
CREATE OR REPLACE FUNCTION pos_enforce_permission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a text;
BEGIN
  IF is_pos_session() THEN
    FOREACH a IN ARRAY TG_ARGV LOOP
      IF pos_has_permission(a) THEN IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END IF;
    END LOOP;
    RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;

CREATE TYPE lb_payment_method AS ENUM ('CASH','MOBILE_MONEY','CARD','CREDIT','BANK','VOUCHER','OTHER');
CREATE TABLE lb_businesses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, name text);
CREATE TABLE lb_customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, name text, phone text, outstanding_balance numeric DEFAULT 0, updated_at timestamptz DEFAULT now());
CREATE TABLE lb_product_categories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, name text);
CREATE TABLE lb_products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, business_id uuid, name text, sku text, category_id uuid REFERENCES lb_product_categories(id),
  cost_price numeric DEFAULT 0, selling_price numeric DEFAULT 0, reorder_level numeric DEFAULT 0, track_inventory boolean DEFAULT true, is_active text DEFAULT 'active', updated_at timestamptz DEFAULT now());
CREATE TABLE lb_warehouses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, is_default boolean);
CREATE TABLE lb_inventory (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid, warehouse_id uuid, quantity numeric, average_cost numeric, updated_at timestamptz);
CREATE SEQUENCE sale_seq;
CREATE FUNCTION generate_sale_number() RETURNS text LANGUAGE sql AS $$ SELECT 'S-' || lpad(nextval('sale_seq')::text, 6, '0') $$;
CREATE TABLE lb_sales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, cashier_id uuid, shift_id uuid, customer_id uuid, sale_number text, status text, subtotal numeric, discount_total numeric, tax_total numeric, total_amount numeric, notes text, completed_at timestamptz, client_reference text, created_at timestamptz DEFAULT now());
CREATE TABLE lb_sale_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, sale_id uuid REFERENCES lb_sales(id), product_id uuid, quantity numeric, unit_price numeric, cost_price numeric, discount_amount numeric, discount_percent numeric, tax_amount numeric, total_price numeric, selling_mode text);
CREATE TABLE lb_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, sale_id uuid REFERENCES lb_sales(id), payment_method lb_payment_method, amount numeric, change_amount numeric, reference_no text, status text, created_by uuid, created_at timestamptz DEFAULT now());
-- same duplicate-code guard as phase39
CREATE UNIQUE INDEX uq_lb_payments_mpesa_ref ON lb_payments (tenant_id, (upper(regexp_replace(reference_no, '[^A-Za-z0-9]', '', 'g')))) WHERE payment_method = 'MOBILE_MONEY' AND reference_no IS NOT NULL AND btrim(reference_no) <> '';
CREATE TABLE lb_receipts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, sale_id uuid, receipt_number text, receipt_type text, receipt_data jsonb);
CREATE TABLE lb_expense_categories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, name text);
CREATE TABLE lb_expenses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, category_id uuid, expense_date date, amount numeric, status text, description text);

-- doc numbers (phase17 has the real one)
CREATE TABLE lb_doc_counters_stub (k text PRIMARY KEY, n int);
CREATE FUNCTION next_doc_number(p_business_id uuid, p_prefix text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v int; BEGIN
  INSERT INTO lb_doc_counters_stub VALUES (p_business_id::text || p_prefix, 1) ON CONFLICT (k) DO UPDATE SET n = lb_doc_counters_stub.n + 1 RETURNING n INTO v;
  RETURN p_prefix || '-' || lpad(v::text, 4, '0'); END $$;

-- customer payments: the live RPC's parameter names are taken from services/paymentService.js
CREATE TABLE lb_customer_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, customer_id uuid, amount numeric, payment_method lb_payment_method, reference_no text, notes text, created_by uuid, created_at timestamptz DEFAULT now());
CREATE OR REPLACE FUNCTION record_customer_payment(p_business_id uuid, p_branch_id uuid, p_customer_id uuid, p_amount numeric, p_payment_method lb_payment_method, p_reference_no text, p_notes text, p_created_by uuid)
RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE v uuid; BEGIN
  INSERT INTO lb_customer_payments(tenant_id,business_id,customer_id,amount,payment_method,reference_no,notes,created_by) VALUES (get_current_tenant_id(),p_business_id,p_customer_id,p_amount,p_payment_method,p_reference_no,p_notes,p_created_by) RETURNING id INTO v;
  UPDATE lb_customers SET outstanding_balance = outstanding_balance - p_amount WHERE id = p_customer_id; RETURN v; END $$;

-- rent invoices: only what phase43 touches (the real ones are in phase17)
CREATE TABLE lb_rent_invoices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, customer_id uuid, invoice_number text, status text DEFAULT 'ISSUED', total numeric);
CREATE TABLE lb_rent_invoice_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, rent_invoice_id uuid, amount numeric, payment_method text, source text CHECK (source IN ('MANUAL','MPESA_MANUAL','MPESA_PROMPT')), reference_no text, notes text, created_by uuid, created_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX uq_lb_rip_mpesa_code ON lb_rent_invoice_payments (business_id, reference_no) WHERE payment_method = 'MOBILE_MONEY' AND reference_no IS NOT NULL;
CREATE VIEW lb_rent_invoice_summary AS SELECT i.*, i.total - coalesce((SELECT sum(p.amount) FROM lb_rent_invoice_payments p WHERE p.rent_invoice_id = i.id), 0) AS balance_due FROM lb_rent_invoices i;
CREATE FUNCTION record_rent_invoice_payment(p_invoice_id uuid, p_amount numeric, p_payment_method text, p_reference_no text DEFAULT NULL, p_notes text DEFAULT NULL, p_created_by uuid DEFAULT NULL, p_source text DEFAULT 'MANUAL', p_mpesa_transaction_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE i lb_rent_invoices; BEGIN
  SELECT * INTO i FROM lb_rent_invoices WHERE id = p_invoice_id;
  INSERT INTO lb_rent_invoice_payments (tenant_id, business_id, rent_invoice_id, amount, payment_method, source, reference_no, notes, created_by) VALUES (i.tenant_id, i.business_id, i.id, p_amount, p_payment_method, p_source, p_reference_no, p_notes, p_created_by);
  RETURN jsonb_build_object('receipt_number', 'RCT-RENT-1'); END $$;
