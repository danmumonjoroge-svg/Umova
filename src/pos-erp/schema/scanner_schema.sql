-- ============================================================
-- UMOVA SCANNING ENGINE — Phase 1 migration
-- Idempotent: safe to re-run.
--
-- What this adds:
--   1. Scoped uniqueness on lb_products.barcode (tenant+business),
--      NULL/blank barcodes remain unrestricted (spec section 8).
--   2. lb_product_barcodes — optional multi-barcode mapping
--      (carton/pack/supplier barcodes) for future use (spec section 30/31).
--   3. lb_scanner_events — lightweight scan audit log, metadata only,
--      never camera images (spec section 35).
--
-- No changes to lb_products, lb_inventory, lb_sales, lb_purchase_orders,
-- lb_goods_received or any existing table structure/columns.
-- ============================================================

-- 1. Scoped barcode uniqueness -------------------------------------------
-- Prevents two ACTIVE products in the same tenant+business from sharing a
-- barcode, while leaving NULL/blank barcodes (products without one) and
-- inactive/archived products unrestricted.
--
-- FIX: the original predicate referenced lb_products.status, which
-- doesn't exist on this table — this project tracks active/inactive on
-- lb_products with is_active (a text enum: 'active' / 'inactive'), the
-- same column productService.js's deactivate()/reactivate() already
-- read and write. Confirmed against that file, not guessed.
DROP INDEX IF EXISTS uq_lb_products_barcode_scoped;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_products_barcode_scoped
    ON lb_products (tenant_id, business_id, barcode)
    WHERE barcode IS NOT NULL AND barcode <> '' AND is_active = 'active';

-- 2. Multi-barcode mapping (carton / pack / supplier barcodes) -----------
CREATE TABLE IF NOT EXISTS lb_product_barcodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
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
DO $$ BEGIN
  CREATE POLICY lb_pb_tenant ON lb_product_barcodes
    FOR ALL USING (tenant_id = current_setting('app.current_tenant')::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS trg_lb_product_barcodes_updated_at ON lb_product_barcodes;
CREATE TRIGGER trg_lb_product_barcodes_updated_at
    BEFORE UPDATE ON lb_product_barcodes
    FOR EACH ROW EXECUTE FUNCTION lb_update_updated_at();

-- 3. Scanner event log (audit/debugging only, no images) ------------------
CREATE TABLE IF NOT EXISTS lb_scanner_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES lb_businesses(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES lb_branches(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
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
CREATE INDEX IF NOT EXISTS idx_lb_se_tenant ON lb_scanner_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lb_se_business ON lb_scanner_events(business_id);
CREATE INDEX IF NOT EXISTS idx_lb_se_context ON lb_scanner_events(context_type, context_id);
CREATE INDEX IF NOT EXISTS idx_lb_se_created ON lb_scanner_events(created_at DESC);

ALTER TABLE lb_scanner_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY lb_se_tenant ON lb_scanner_events
    FOR ALL USING (tenant_id = current_setting('app.current_tenant')::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
