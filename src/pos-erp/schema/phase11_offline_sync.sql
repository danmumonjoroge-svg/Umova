-- ============================================================
-- Phase 11 -- Offline-first sync support (Stage 1B, brief section 20-32)
--
-- The one schema change true offline sync actually needs: a way for the
-- server to recognise "I've already seen this exact transaction" when a
-- queued sale syncs, possibly more than once (flaky connection retries,
-- a callback fired twice, the owner pressing sync again). Without this,
-- lb_sales.insert() has no way to reject a duplicate -- sale_number is
-- generated server-side AFTER insert, so it can't be the dedupe key.
--
-- client_reference is that key: the LOCAL-SALE-<date>-<seq> id generated
-- on-device the moment a sale is created offline (brief section 24). It
-- travels with the sale through the outbox and is still on the row after
-- sync, so a support conversation ("my sale from this morning didn't
-- show up") can trace a specific offline transaction to its final synced
-- row.
--
-- Run order: migration #9, after phase10_supplier_messaging.sql.
-- ============================================================

ALTER TABLE lb_sales ADD COLUMN IF NOT EXISTS client_reference text;

-- Partial unique index, not a full UNIQUE constraint: countless existing
-- and future online-created sales have client_reference = NULL. Being
-- explicit (WHERE client_reference IS NOT NULL) makes the intent
-- obvious rather than relying on NULL-comparison behaviour silently.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lb_sales_client_reference
  ON lb_sales(client_reference) WHERE client_reference IS NOT NULL;

COMMENT ON COLUMN lb_sales.client_reference IS
  'Offline-first: the LOCAL-SALE-* id generated on-device when a sale is created offline. NULL for sales created online. Unique when set -- the idempotency key the sync engine relies on to make a retried sync a no-op instead of a duplicate.';

-- Same idempotency need exists for a standalone customer payment made
-- offline (customer payments, under Customers). Not extending this to
-- purchases/expenses/appointments in this pass -- see AUDIT.md's
-- "what's real vs scaffolded" note; this migration only covers what
-- offlineSaleService.js actually uses this session.
ALTER TABLE lb_customer_credit_transactions ADD COLUMN IF NOT EXISTS client_reference text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_lb_cct_client_reference
  ON lb_customer_credit_transactions(client_reference) WHERE client_reference IS NOT NULL;
