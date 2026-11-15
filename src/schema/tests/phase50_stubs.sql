-- SCRATCH-ONLY: extra columns/tables phase50 reads (names confirmed from saleService.js / phase14). Never run on a real database.
ALTER TABLE lb_sales ADD COLUMN sale_number text, ADD COLUMN completed_at timestamptz DEFAULT now(), ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN folio_id uuid, ADD COLUMN customer_id uuid;
ALTER TABLE lb_products ADD COLUMN name text, ADD COLUMN barcode text;
ALTER TABLE lb_customers ADD COLUMN IF NOT EXISTS phone text;
CREATE TABLE lb_sale_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, sale_id uuid REFERENCES lb_sales(id), product_id uuid, quantity numeric, unit_price numeric, discount_amount numeric DEFAULT 0, total_price numeric);
CREATE TABLE lb_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sale_id uuid, payment_method text, amount numeric);
CREATE TABLE lb_receipts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, sale_id uuid);
