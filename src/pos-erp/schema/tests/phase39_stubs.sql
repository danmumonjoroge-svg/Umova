-- Stand-ins for the live tables phase39 touches (scratch database ONLY). Columns come from what the app code and
-- phase12/14/17 read and write. Passing proves the new logic, NOT that the live database matches: run
-- diagnostics/phase39_precheck.sql and the migration on STAGING first.
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION get_current_tenant_id() RETURNS uuid LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('test.tenant', true), ''), '00000000-0000-0000-0000-0000000000a1')::uuid $$;
-- a "POS staff session" is simulated with test.pos = 'on' and a comma list in test.perms
CREATE OR REPLACE FUNCTION is_pos_session() RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.pos', true), 'off') = 'on' $$;
CREATE OR REPLACE FUNCTION pos_has_permission(p text) RETURNS boolean LANGUAGE sql AS $$ SELECT p = ANY (string_to_array(coalesce(current_setting('test.perms', true), ''), ',')) $$;
-- identical to phase28_permissions.sql
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
CREATE TABLE lb_customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, name text, phone text);
CREATE TABLE lb_products (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE lb_warehouses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, is_default boolean);
CREATE TABLE lb_inventory (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid, warehouse_id uuid, quantity numeric, updated_at timestamptz);
CREATE TABLE lb_inventory_movements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, warehouse_id uuid, product_id uuid, movement_type text, quantity numeric, unit_cost numeric, reference_id uuid, reference_type text, created_by uuid);
CREATE SEQUENCE sale_seq;
CREATE FUNCTION generate_sale_number() RETURNS text LANGUAGE sql AS $$ SELECT 'S-' || lpad(nextval('sale_seq')::text, 6, '0') $$;
CREATE TABLE lb_sales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, cashier_id uuid, shift_id uuid, customer_id uuid, sale_number text, status text, subtotal numeric, discount_total numeric, tax_total numeric, total_amount numeric, notes text, completed_at timestamptz, client_reference text, created_at timestamptz DEFAULT now());
CREATE TABLE lb_sale_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, sale_id uuid REFERENCES lb_sales(id), product_id uuid, quantity numeric, unit_price numeric, cost_price numeric, discount_amount numeric, discount_percent numeric, tax_amount numeric, total_price numeric, selling_mode text);
CREATE TABLE lb_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, sale_id uuid REFERENCES lb_sales(id), payment_method lb_payment_method, amount numeric, change_amount numeric, reference_no text, status text, created_by uuid, created_at timestamptz DEFAULT now());
CREATE TABLE lb_receipts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, sale_id uuid, receipt_number text, receipt_type text, receipt_data jsonb);
-- phase17 adds these to lb_mpesa_transactions; the rent branch itself is stubbed
CREATE OR REPLACE FUNCTION record_rent_invoice_payment(p_inv uuid, p_amount numeric, p_method text, p_ref text, p_notes text, p_by uuid, p_source text, p_txn uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
