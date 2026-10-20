-- SCRATCH-ONLY stand-ins for the live tables/functions phase35 depends on (shapes taken from the app code). Never run on a real database.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb $$;
CREATE OR REPLACE FUNCTION get_current_tenant_id() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.tenant', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION is_pos_session() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE OR REPLACE FUNCTION pos_require(VARIADIC p_perms text[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE a text; have text := coalesce(current_setting('test.perms', true), '');
BEGIN FOREACH a IN ARRAY p_perms LOOP IF position(a in have) > 0 THEN RETURN; END IF; END LOOP;
  RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END $$;
CREATE TYPE lb_payment_method AS ENUM ('CASH','MOBILE_MONEY','CARD','CREDIT','BANK','OTHER');
CREATE TYPE lb_customer_type AS ENUM ('WALK_IN','REGULAR','CREDIT');
CREATE TABLE lb_businesses (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);
CREATE TABLE lb_customers (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, business_id uuid, name text, phone text, email text, address text, customer_type lb_customer_type, credit_limit numeric DEFAULT 0, created_by uuid, outstanding_balance numeric DEFAULT 0);
CREATE TABLE lb_expenses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, amount numeric, payment_method lb_payment_method, description text);
CREATE OR REPLACE FUNCTION record_expense(p_business_id uuid, p_branch_id uuid, p_category_id uuid, p_expense_date date, p_amount numeric, p_payment_method lb_payment_method, p_description text, p_attachment_url text, p_status text, p_created_by uuid)
RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE v uuid; BEGIN INSERT INTO lb_expenses(tenant_id,business_id,amount,payment_method,description) VALUES (get_current_tenant_id(),p_business_id,p_amount,p_payment_method,p_description) RETURNING id INTO v; RETURN v; END $$;
CREATE TABLE lb_customer_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, customer_id uuid, amount numeric, reference_no text);
CREATE OR REPLACE FUNCTION record_customer_payment(a uuid, b uuid, c uuid, d numeric, e lb_payment_method, f text, g text, h uuid)
RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE v uuid; BEGIN INSERT INTO lb_customer_payments(tenant_id,customer_id,amount,reference_no) VALUES (get_current_tenant_id(),c,d,f) RETURNING id INTO v; UPDATE lb_customers SET outstanding_balance = outstanding_balance - d WHERE id = c; RETURN v; END $$;
CREATE TABLE lb_products (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, track_inventory boolean DEFAULT true, reorder_level numeric DEFAULT 0);
CREATE TABLE lb_warehouses (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, is_default boolean);
CREATE TABLE lb_inventory (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, warehouse_id uuid, product_id uuid, quantity numeric, average_cost numeric, last_movement_at timestamptz, stock_status text);
CREATE TABLE lb_stock_movements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, warehouse_id uuid, product_id uuid, movement_type text, reference_type text, quantity numeric, unit_cost numeric, total_cost numeric, notes text, created_by uuid);
