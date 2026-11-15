-- SCRATCH-ONLY extras for phase36 on top of phase35_stubs.sql (shapes taken from the app code). Never run on a real database.
ALTER TABLE lb_products ADD COLUMN IF NOT EXISTS name text, ADD COLUMN IF NOT EXISTS barcode text, ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS category_id uuid, ADD COLUMN IF NOT EXISTS unit_id uuid, ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS cost_price numeric, ADD COLUMN IF NOT EXISTS selling_price numeric, ADD COLUMN IF NOT EXISTS is_active text DEFAULT 'active';
CREATE TABLE IF NOT EXISTS lb_product_categories (id uuid PRIMARY KEY, name text);
CREATE TABLE IF NOT EXISTS lb_product_units (id uuid PRIMARY KEY, name text, code text);
CREATE TABLE IF NOT EXISTS pos_tenants (id uuid PRIMARY KEY, business_name text, phone text, status text);
CREATE TABLE IF NOT EXISTS pos_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pos_tenant_id uuid, actor_type text, actor_id uuid, action text, entity_type text, entity_id uuid, metadata jsonb, created_at timestamptz DEFAULT now());
