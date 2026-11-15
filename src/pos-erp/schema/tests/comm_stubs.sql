-- Stand-ins for base tables this migration touches (scratch database ONLY).
CREATE TABLE lb_customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, name text, phone text, email text, outstanding_balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, updated_at timestamptz DEFAULT now());
CREATE TABLE lb_suppliers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, name text, phone text, email text, outstanding_balance numeric DEFAULT 0);
CREATE TABLE lb_sales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, customer_id uuid, sale_number text, status text, total_amount numeric);
CREATE TABLE lb_customer_credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, customer_id uuid, transaction_type text, reference_type text, reference_id uuid, amount numeric, balance_after numeric, notes text, created_by uuid, created_at timestamptz DEFAULT now());
CREATE TABLE lb_products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, name text);
CREATE TYPE lb_appointment_status AS ENUM ('SCHEDULED','CONFIRMED','COMPLETED','CANCELLED','NO_SHOW');
CREATE TABLE lb_appointments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, customer_id uuid REFERENCES lb_customers(id), product_id uuid, appointment_date date NOT NULL, appointment_time time NOT NULL, status lb_appointment_status NOT NULL DEFAULT 'SCHEDULED');
CREATE TABLE lb_purchase_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, supplier_id uuid, po_number text, status text, order_date date, expected_date date, total_amount numeric);
