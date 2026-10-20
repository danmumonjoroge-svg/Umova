-- phase33_offline_key_per_tenant.sql   (MVP audit D-01)   -- NOT YET RUN on any database.
-- Offline sales carry a client_reference (the idempotency key). It was unique across ALL businesses; it must be unique
-- per business. New keys also contain a per-phone id (see offline/idGenerator.js), so collisions are prevented at source;
-- this index is the database-side guarantee.
-- Safe order: create the new (weaker-or-equal) index first, then drop the old one. Existing rows cannot violate it:
-- any set unique on client_reference is already unique on (tenant_id, client_reference).
-- Rollback: CREATE UNIQUE INDEX idx_lb_sales_client_reference ON lb_sales(client_reference) WHERE client_reference IS NOT NULL;
--           DROP INDEX idx_lb_sales_tenant_client_reference;
CREATE UNIQUE INDEX IF NOT EXISTS idx_lb_sales_tenant_client_reference
  ON lb_sales(tenant_id, client_reference) WHERE client_reference IS NOT NULL;
DROP INDEX IF EXISTS idx_lb_sales_client_reference;
-- Not changed here: idx_lb_cct_client_reference (lb_customer_credit_transactions) and uq_lb_folio_lines_client_ref.
-- Check that those tables have a tenant_id column before scoping them the same way.
