-- Stand-ins for the live stock tables phase22 writes. Scratch DB ONLY.
-- psql -v texttypes=1 makes movement_type/reference_type plain text instead of enums.
ALTER TABLE lb_products ADD COLUMN IF NOT EXISTS cost_price numeric DEFAULT 0;
ALTER TABLE lb_products ADD COLUMN IF NOT EXISTS reorder_level numeric DEFAULT 0;
ALTER TABLE lb_products ADD COLUMN IF NOT EXISTS allow_negative_stock boolean DEFAULT false;
CREATE TABLE lb_warehouses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, business_id uuid, name text, is_default boolean DEFAULT false);
CREATE TYPE lb_stock_status AS ENUM ('NORMAL','LOW_STOCK','OUT_OF_STOCK');
CREATE TABLE lb_inventory (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, business_id uuid, branch_id uuid, warehouse_id uuid NOT NULL REFERENCES lb_warehouses(id), product_id uuid NOT NULL REFERENCES lb_products(id), quantity numeric NOT NULL DEFAULT 0, average_cost numeric NOT NULL DEFAULT 0, last_movement_at timestamptz, stock_status lb_stock_status NOT NULL DEFAULT 'NORMAL', UNIQUE (product_id, warehouse_id));
\if :{?texttypes}
CREATE TABLE lb_stock_movements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, business_id uuid, branch_id uuid, warehouse_id uuid NOT NULL, product_id uuid NOT NULL, movement_type text NOT NULL, reference_type text, reference_id uuid, quantity numeric NOT NULL, unit_cost numeric, total_cost numeric, batch_no text, expiry_date date, notes text, created_by uuid, created_at timestamptz DEFAULT now());
\else
CREATE TYPE lb_movement_type AS ENUM ('PURCHASE_RECEIPT','SALE','STOCK_ISSUE','STOCK_ADJUSTMENT','STOCK_COUNT','STOCK_RETURN','DAMAGED','EXPIRED','OPENING_STOCK');
CREATE TYPE lb_reference_type AS ENUM ('PURCHASE_ORDER','SALE','GRN');
CREATE TABLE lb_stock_movements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, business_id uuid, branch_id uuid, warehouse_id uuid NOT NULL, product_id uuid NOT NULL, movement_type lb_movement_type NOT NULL, reference_type lb_reference_type, reference_id uuid, quantity numeric NOT NULL, unit_cost numeric, total_cost numeric, batch_no text, expiry_date date, notes text, created_by uuid, created_at timestamptz DEFAULT now());
\endif
GRANT SELECT ON lb_products, lb_warehouses, lb_inventory, lb_stock_movements TO authenticated;
