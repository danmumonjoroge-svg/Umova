-- ============================================================
-- Phase 8 — WhatsApp without an API (brief §16)
--
-- §16 forbids requiring a WhatsApp Business API. Messages are prepared
-- by Umova and handed to the native WhatsApp app / WhatsApp Web via a
-- wa.me link; the OWNER presses Send inside WhatsApp itself.
--
-- That makes three distinct real states, which §16 requires be kept
-- apart from "automatically delivered":
--
--   QUEUED  -> prepared (message rendered, WhatsApp not opened yet)
--   OPENED  -> wa.me link opened; WhatsApp/WhatsApp Web was launched
--   SENT    -> the owner came back and confirmed they pressed Send
--
-- DELIVERED is NEVER set for a WHATSAPP-channel message. Nothing in
-- this system can observe delivery without a real API, so claiming it
-- would violate §43. SENT here means "owner-attested", and the UI says
-- so in those words.
--
-- Run order: this is migration #6, after phase7_communication.sql.
-- ============================================================

-- ---------- PART 1 — run this on its own, then COMMIT ----------
-- Postgres will not let a new enum value be USED in the same
-- transaction that adds it, so part 2 must be a separate statement
-- batch. In the Supabase SQL editor: run part 1, wait for success,
-- then run part 2.

ALTER TYPE lb_comm_status ADD VALUE IF NOT EXISTS 'OPENED' AFTER 'QUEUED';

-- ---------- PART 2 — run after part 1 has committed ----------

-- When the wa.me link was opened. Distinct from sent_at, which for a
-- WHATSAPP message means "owner confirmed they pressed Send in
-- WhatsApp" — not a delivery receipt from anyone.
ALTER TABLE lb_communication_log
  ADD COLUMN IF NOT EXISTS opened_at timestamptz;

COMMENT ON COLUMN lb_communication_log.opened_at IS
  'WHATSAPP channel: when the wa.me link was opened on this device. NULL for provider-sent channels.';

COMMENT ON COLUMN lb_communication_log.sent_at IS
  'SMS/EMAIL: when a provider accepted the message. WHATSAPP: when the owner confirmed they pressed Send inside WhatsApp — owner-attested, NOT a delivery receipt.';

-- Existing businesses already hold the 7 SMS templates seeded in phase 7,
-- so templateService.ensureDefaults() no longer seeds all-or-nothing —
-- it gap-fills missing (message_type, channel) pairs, which is what adds
-- the WHATSAPP set to businesses that already have the SMS one. No seed
-- rows here: template wording is per-tenant and editable, and seeding it
-- server-side would need tenant_id/business_id this migration can't know.
