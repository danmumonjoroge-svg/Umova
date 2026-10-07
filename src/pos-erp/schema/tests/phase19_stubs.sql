-- Stand-ins for the live base tables. Scratch DB ONLY.
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE OR REPLACE FUNCTION get_current_tenant_id() RETURNS uuid LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('test.tenant', true),''), '00000000-0000-0000-0000-0000000000aa')::uuid $$;
CREATE TYPE lb_payment_method AS ENUM ('CASH','MOBILE_MONEY','CARD','CREDIT','BANK','OTHER');
CREATE TABLE lb_businesses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, name text);
CREATE TABLE lb_customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, name text, phone text, email text, outstanding_balance numeric DEFAULT 0);
CREATE TABLE lb_products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, name text, track_inventory boolean DEFAULT true);
CREATE TABLE lb_sales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, customer_id uuid, total_amount numeric, status text, created_at timestamptz DEFAULT now());
CREATE TABLE lb_sale_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sale_id uuid, product_id uuid, quantity numeric, unit_price numeric, total_price numeric);
CREATE TABLE lb_doc_counters (business_id uuid NOT NULL, prefix text NOT NULL, yr integer NOT NULL, last_number integer NOT NULL DEFAULT 0, PRIMARY KEY (business_id, prefix, yr));
CREATE OR REPLACE FUNCTION next_doc_number(p_business_id uuid, p_prefix text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_yr integer := EXTRACT(year FROM now())::int; v_n integer;
BEGIN
  INSERT INTO lb_doc_counters (business_id, prefix, yr, last_number) VALUES (p_business_id, p_prefix, v_yr, 1)
  ON CONFLICT (business_id, prefix, yr) DO UPDATE SET last_number = lb_doc_counters.last_number + 1
  RETURNING last_number INTO v_n;
  RETURN p_prefix || '-' || v_yr || '-' || lpad(v_n::text, 4, '0');
END $$;
