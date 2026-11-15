-- ============================================================
-- Phase 50a — communication statuses (run FIRST, on its own, let it commit; then run phase50)
--
-- Postgres will not let a new enum value be USED in the transaction that adds it, so these are separate
-- (same pattern as phase8, phase17a, phase22a).
--
-- Existing values kept exactly as they are: QUEUED (= prepared), OPENED, SENT, DELIVERED, FAILED.
--   SUBMITTED  a provider accepted the message for delivery (server-set only)
--   READ       the provider reported it was read (server-set only; WhatsApp API)
--   CANCELLED  withdrawn before sending (for example the debt was paid first)
-- ============================================================
ALTER TYPE lb_comm_status ADD VALUE IF NOT EXISTS 'SUBMITTED' AFTER 'OPENED';
ALTER TYPE lb_comm_status ADD VALUE IF NOT EXISTS 'READ';
ALTER TYPE lb_comm_status ADD VALUE IF NOT EXISTS 'CANCELLED';
