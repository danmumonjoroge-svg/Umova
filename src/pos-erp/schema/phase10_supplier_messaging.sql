-- ============================================================
-- Phase 10 — Supplier messaging (brief §15, second list)
--
-- §15 asks for two separate message lists: customers (built in Phase 7/8)
-- and suppliers (purchase/order communication, payment confirmation,
-- payment reminder, supplier statement, delivery reminder, custom
-- message). This closes the second list.
--
-- DESIGN CHOICE: five new lb_comm_message_type values, prefixed
-- SUPPLIER_, rather than widening lb_communication_templates with a
-- recipient_type column. Reusing the existing PAYMENT_DUE/STATEMENT
-- values for suppliers too would have meant two different templates
-- competing for the same (business_id, message_type, channel) unique
-- key, which either breaks the constraint or forces a recipient_type
-- column change touching every existing row. New enum values needed no
-- schema change beyond the enum itself and read the same way every
-- other message type already does.
--
-- lb_communication_log gets a nullable supplier_id, alongside the
-- existing nullable customer_id — a message is about exactly one of the
-- two, enforced by a CHECK constraint, not left to application code to
-- get right.
--
-- Run order: migration #8, after phase9_assets.sql.
-- ============================================================

ALTER TYPE lb_comm_message_type ADD VALUE IF NOT EXISTS 'SUPPLIER_ORDER';
ALTER TYPE lb_comm_message_type ADD VALUE IF NOT EXISTS 'SUPPLIER_PAYMENT_SENT';
ALTER TYPE lb_comm_message_type ADD VALUE IF NOT EXISTS 'SUPPLIER_PAYMENT_DUE';
ALTER TYPE lb_comm_message_type ADD VALUE IF NOT EXISTS 'SUPPLIER_STATEMENT';
ALTER TYPE lb_comm_message_type ADD VALUE IF NOT EXISTS 'SUPPLIER_DELIVERY_REMINDER';

-- Same "run in two parts" rule as phase8_whatsapp.sql: a new enum value
-- can't be used in the same transaction that adds it. Everything below
-- this line must run AFTER the five ADD VALUEs above have committed.

ALTER TABLE lb_communication_log
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES lb_suppliers(id);

CREATE INDEX IF NOT EXISTS idx_lb_communication_log_supplier ON lb_communication_log(supplier_id) WHERE supplier_id IS NOT NULL;

-- Exactly one recipient per message, enforced at the database, not
-- trusted to the two services that write this table.
ALTER TABLE lb_communication_log DROP CONSTRAINT IF EXISTS lb_communication_log_one_recipient_chk;
ALTER TABLE lb_communication_log
  ADD CONSTRAINT lb_communication_log_one_recipient_chk
  CHECK ((customer_id IS NOT NULL) <> (supplier_id IS NOT NULL));

COMMENT ON COLUMN lb_communication_log.supplier_id IS
  'Set for supplier-facing messages (SUPPLIER_* message types). Exactly one of customer_id/supplier_id is set — see lb_communication_log_one_recipient_chk.';
