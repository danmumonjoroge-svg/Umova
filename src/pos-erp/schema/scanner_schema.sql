-- ============================================================
-- UMOVA SCANNING ENGINE — Phase 1 migration (POS-tenant corrected)
-- Idempotent: safe to re-run, and safe whether or not the two scanner
-- tables already exist.
--
-- Corrections vs. the first version of this file:
--   * lb_update_updated_at() did not exist in this database
--     (ERROR 42883) — it is now created here.
--   * tenant_id no longer references tenants(id). POS tenants live in
--     pos_tenants; every other POS lb_* table uses a plain tenant_id.
--   * user_id references auth.users(id) (what usePosErpAuth().staffId is).
--   * RLS uses get_current_tenant_id() (JWT pos_tenant_id) with
--     WITH CHECK, same as phase5/7/12 — not current_setting('app.current_tenant').
--   RLS stays ON, tenant_id/business_id stay NOT NULL.
--
-- No changes to lb_products columns, lb_inventory, lb_sales, etc.
-- ============================================================

-- 0. updated_at trigger function (only used by lb_product_barcodes) -------
CREATE OR REPLACE FUNCTION lb_update_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

-- 1. Scoped barcode uniqueness -------------------------------------------
-- Two ACTIVE products in the same tenant+business cannot share a barcode.
-- NULL/blank barcodes and inactive products are unrestricted.
-- (If this fails with "could not create unique index", you already have
--  duplicate active barcodes in one business — fix those rows first.)
DROP INDEX IF EXISTS uq_lb_products_barcode_scoped;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_products_barcode_scoped
    ON lb_products (tenant_id, business_id, barcode)
    WHERE barcode IS NOT NULL AND barcode <> '' AND is_active = 'active';

-- 2. Multi-barcode mapping (carton / pack / supplier barcodes) -----------
CREATE TABLE IF NOT EXISTS lb_product_barcodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    business_id UUID NOT NULL REFERENCES lb_businesses(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES lb_products(id) ON DELETE CASCADE,
    barcode TEXT NOT NULL,
    barcode_type TEXT NOT NULL DEFAULT 'UNIT'
        CHECK (barcode_type IN ('UNIT', 'CARTON', 'INNER_PACK', 'SUPPLIER', 'OTHER')),
    unit_id UUID REFERENCES lb_product_units(id) ON DELETE SET NULL,
    pack_quantity DECIMAL(15,4) NOT NULL DEFAULT 1,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lb_pb_tenant ON lb_product_barcodes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lb_pb_business ON lb_product_barcodes(business_id);
CREATE INDEX IF NOT EXISTS idx_lb_pb_product ON lb_product_barcodes(product_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_pb_barcode_scoped
    ON lb_product_barcodes (tenant_id, business_id, barcode)
    WHERE status = 'ACTIVE';

ALTER TABLE lb_product_barcodes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lb_pb_tenant ON lb_product_barcodes;
CREATE POLICY lb_pb_tenant ON lb_product_barcodes
    FOR ALL USING (tenant_id = get_current_tenant_id())
    WITH CHECK (tenant_id = get_current_tenant_id());

DROP TRIGGER IF EXISTS trg_lb_product_barcodes_updated_at ON lb_product_barcodes;
CREATE TRIGGER trg_lb_product_barcodes_updated_at
    BEFORE UPDATE ON lb_product_barcodes
    FOR EACH ROW EXECUTE FUNCTION lb_update_updated_at();

-- 3. Scanner event log (audit/debugging only, no images) ------------------
CREATE TABLE IF NOT EXISTS lb_scanner_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    business_id UUID NOT NULL REFERENCES lb_businesses(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES lb_branches(id) ON DELETE SET NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    barcode TEXT NOT NULL,
    format TEXT,
    scanner_type TEXT NOT NULL DEFAULT 'MANUAL'
        CHECK (scanner_type IN ('CAMERA', 'USB', 'BLUETOOTH', 'MANUAL')),
    context_type TEXT
        CHECK (context_type IN ('SALE', 'GRN', 'STOCKTAKE', 'TRANSFER', 'SALES_RETURN', 'SUPPLIER_RETURN', 'PRODUCT_FORM')),
    context_id UUID,
    result TEXT NOT NULL DEFAULT 'ERROR'
        CHECK (result IN ('RESOLVED', 'NOT_FOUND', 'INACTIVE', 'ERROR')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- If the table already existed from an earlier run, repair its FKs:
-- drop any FK on tenant_id / user_id, then re-add user_id -> auth.users.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.lb_scanner_events'::regclass
      AND c.contype = 'f'
      AND a.attname IN ('tenant_id', 'user_id')
  LOOP
    EXECUTE format('ALTER TABLE public.lb_scanner_events DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE public.lb_scanner_events
  ADD CONSTRAINT lb_scanner_events_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lb_se_tenant ON lb_scanner_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lb_se_business ON lb_scanner_events(business_id);
CREATE INDEX IF NOT EXISTS idx_lb_se_context ON lb_scanner_events(context_type, context_id);
CREATE INDEX IF NOT EXISTS idx_lb_se_created ON lb_scanner_events(created_at DESC);

ALTER TABLE lb_scanner_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lb_se_tenant ON lb_scanner_events;
CREATE POLICY lb_se_tenant ON lb_scanner_events
    FOR ALL USING (tenant_id = get_current_tenant_id())
    WITH CHECK (tenant_id = get_current_tenant_id());

-- Verify afterwards:
--   select tablename, policyname, qual, with_check from pg_policies
--   where tablename in ('lb_scanner_events','lb_product_barcodes');
