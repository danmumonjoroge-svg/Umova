CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.role', true),'authenticated') $$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION get_current_tenant_id() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-0000-0000-0000000000aa'::uuid $$;
CREATE TYPE lb_payment_method AS ENUM ('CASH','MOBILE_MONEY','CARD','CREDIT','BANK','OTHER');
CREATE TYPE lb_comm_message_type AS ENUM ('RECEIPT','REMINDER');
CREATE TABLE lb_businesses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, name text, phone text, email text, address text, logo_url text);
CREATE TABLE lb_customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, name text, phone text, email text, outstanding_balance numeric DEFAULT 0, updated_at timestamptz DEFAULT now());
CREATE TABLE lb_expense_categories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, name text, is_system boolean DEFAULT true, is_active boolean DEFAULT true, sort_order int);
INSERT INTO lb_expense_categories(name) VALUES ('Repairs');
CREATE TABLE lb_expenses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, category_id uuid, expense_date date, amount numeric, payment_method lb_payment_method, description text, status text, created_by uuid);
CREATE OR REPLACE FUNCTION record_expense(p_business_id uuid, p_branch_id uuid, p_category_id uuid, p_expense_date date, p_amount numeric, p_payment_method lb_payment_method, p_description text, p_attachment_url text, p_status text, p_created_by uuid)
RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE v uuid; BEGIN INSERT INTO lb_expenses(tenant_id,business_id,category_id,expense_date,amount,payment_method,description,status,created_by) VALUES (get_current_tenant_id(),p_business_id,p_category_id,p_expense_date,p_amount,p_payment_method,p_description,p_status,p_created_by) RETURNING id INTO v; RETURN v; END $$;
CREATE TABLE lb_products (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE lb_customer_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, customer_id uuid, amount numeric, payment_method lb_payment_method, reference_no text, notes text, created_by uuid, created_at timestamptz DEFAULT now());
CREATE TABLE lb_customer_credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, customer_id uuid, transaction_type text, reference_type text, reference_id uuid, amount numeric, balance_after numeric, notes text, created_by uuid, created_at timestamptz DEFAULT now());
-- stand-in for the live record_customer_payment: records the payment and reduces the balance (real signature checked below)
CREATE OR REPLACE FUNCTION record_customer_payment(p_business_id uuid, p_branch_id uuid, p_customer_id uuid, p_amount numeric, p_method lb_payment_method, p_ref text, p_notes text, p_by uuid)
RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE v uuid; BEGIN
  INSERT INTO lb_customer_payments(tenant_id,business_id,customer_id,amount,payment_method,reference_no,notes,created_by) VALUES (get_current_tenant_id(),p_business_id,p_customer_id,p_amount,p_method,p_ref,p_notes,p_by) RETURNING id INTO v;
  UPDATE lb_customers SET outstanding_balance = outstanding_balance - p_amount WHERE id = p_customer_id; RETURN v; END $$;
CREATE TABLE lb_sales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, total_amount numeric, status text, created_at timestamptz DEFAULT now());
CREATE TABLE lb_shifts (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
