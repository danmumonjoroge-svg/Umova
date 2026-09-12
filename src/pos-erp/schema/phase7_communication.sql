-- ============================================================
-- Phase 7 — customer communication (brief §51-54)
--
-- Deliberately separate from the internal notifications already built
-- (services/notificationsService.js + pages/CommunicationPage.jsx —
-- confirmed working, low-stock/supplier/shift/customer-credit alerts).
-- This is the OTHER half §51 asks for: customer-facing messages.
--
-- NOT faking any SMS/email/WhatsApp send — per §51/§53's explicit
-- instruction, this is the internal architecture (templates + log) that
-- a real provider gets connected to LATER through a clean service
-- boundary. Every message this schema creates starts and stays QUEUED
-- until something outside this migration actually sends it; there is no
-- code anywhere that flips a message to SENT/DELIVERED on its own.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE lb_comm_channel AS ENUM ('SMS', 'EMAIL', 'WHATSAPP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Matches brief §52's exact type list.
DO $$ BEGIN
  CREATE TYPE lb_comm_message_type AS ENUM (
    'WELCOME', 'PAYMENT_RECEIVED', 'PAYMENT_DUE', 'PAYMENT_OVERDUE',
    'RECEIPT', 'STATEMENT', 'APPOINTMENT_REMINDER', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Matches brief §54's exact status list.
DO $$ BEGIN
  CREATE TYPE lb_comm_status AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS lb_communication_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid REFERENCES lb_businesses(id),
  message_type lb_comm_message_type NOT NULL,
  channel lb_comm_channel NOT NULL DEFAULT 'SMS',
  subject text, -- only meaningful for EMAIL; NULL for SMS/WHATSAPP
  -- {{customer_name}}, {{business_name}}, {{amount}}, {{balance}},
  -- {{due_date}}, {{receipt_number}}, {{appointment_time}} — rendered by
  -- communicationService.js, not by anything in the database. Plain
  -- text, not a template engine — deliberately simple {{var}} substitution.
  body text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, message_type, channel) -- one template per type+channel per business — ambiguous otherwise
);

ALTER TABLE lb_communication_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lb_communication_templates ON lb_communication_templates;
CREATE POLICY tenant_isolation_lb_communication_templates ON lb_communication_templates
  FOR ALL USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

CREATE TABLE IF NOT EXISTS lb_communication_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid REFERENCES lb_businesses(id),
  customer_id uuid REFERENCES lb_customers(id),
  template_id uuid REFERENCES lb_communication_templates(id),
  channel lb_comm_channel NOT NULL,
  message_type lb_comm_message_type NOT NULL,
  recipient text, -- phone or email snapshotted at send time (customer's own may change later)
  rendered_message text NOT NULL,
  status lb_comm_status NOT NULL DEFAULT 'QUEUED',
  -- what this message is ABOUT, e.g. reference_type='sale'/'recurring_charge_invoice'/
  -- 'appointment', reference_id = that row's id — same loose pattern
  -- lb_customer_credit_transactions already uses.
  reference_type text,
  reference_id uuid,
  sent_at timestamptz,
  failure_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lb_communication_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lb_communication_log ON lb_communication_log;
CREATE POLICY tenant_isolation_lb_communication_log ON lb_communication_log
  FOR ALL USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());
