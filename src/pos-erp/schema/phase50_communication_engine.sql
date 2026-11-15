-- ============================================================
-- Phase 50 — Communication & notification engine
--
-- Run AFTER phase50a (separate run), and after phase7/8/10/28. Safe to re-run.
--
-- EXTENDS the existing communication tables, it does not replace them:
--   lb_communication_templates  + purpose, is_customised   (business-level wording; system defaults live in code)
--   lb_communication_log        + purpose, subject, generated/final text, provider ids, delivery times, ...
-- NEW:
--   lb_comm_preferences   per-business greeting/sign-off/automation/timing settings
--   lb_comm_jobs          the scheduler's work list (one row per message it plans), deduplicated by key
--   lb_receivable_dues    optional explicit "pay by" dates for customer debts (the ledger has no due date)
--   lb_notification_reads who has read which internal notification
-- Also: appointment/PO date history columns, and customer payment terms.
--
-- SAFETY PRINCIPLES
--   * Nothing here writes to, or is triggered by, a financial table. Messaging can never change a sale, payment,
--     stock level or the accounts, and a failing message can never roll one back.  (The only triggers added are on
--     lb_appointments and lb_purchase_orders, and only to REMEMBER dates; they touch no money.)
--   * A signed-in session can never claim a message was SUBMITTED / DELIVERED / READ. Only the server (service role)
--     can set those, from provider receipts.
--   * Outbox rows cannot be deleted by a POS session.
-- ============================================================

-- ---------- 1. log: richer record of every attempt ----------
ALTER TABLE lb_communication_log
  ADD COLUMN IF NOT EXISTS purpose text,
  ADD COLUMN IF NOT EXISTS recipient_kind text,
  ADD COLUMN IF NOT EXISTS recipient_name text,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS generated_message text,
  ADD COLUMN IF NOT EXISTS was_edited boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS template_source text,
  ADD COLUMN IF NOT EXISTS reference_label text,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS initiated_by text NOT NULL DEFAULT 'USER',   -- USER | AUTOMATION
  ADD COLUMN IF NOT EXISTS job_id uuid,
  ADD COLUMN IF NOT EXISTS status_history jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN lb_communication_log.rendered_message IS 'The FINAL text that was (or will be) sent, after any edits. generated_message holds what the system first wrote.';
COMMENT ON COLUMN lb_communication_log.provider IS 'NULL / MANUAL = sent by hand from the user''s own phone or mail app. Otherwise the provider that accepted it.';
COMMENT ON COLUMN lb_communication_log.status IS 'QUEUED=prepared, OPENED=app opened (not proof of sending), SUBMITTED/DELIVERED/READ=provider-confirmed (server only), SENT=provider says left, or the user says they sent it (manual), FAILED, CANCELLED.';

CREATE INDEX IF NOT EXISTS idx_lb_comm_log_provider_msg ON lb_communication_log (provider, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lb_comm_log_ref ON lb_communication_log (tenant_id, reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_lb_comm_log_created ON lb_communication_log (tenant_id, created_at DESC);

-- A message can now go to staff or the owner as well (low-stock alert, daily summary): at most one of customer/supplier.
ALTER TABLE lb_communication_log DROP CONSTRAINT IF EXISTS lb_communication_log_one_recipient_chk;
ALTER TABLE lb_communication_log ADD CONSTRAINT lb_communication_log_one_recipient_chk
  CHECK (NOT (customer_id IS NOT NULL AND supplier_id IS NOT NULL));

-- ---------- 2. templates: business-level wording per purpose ----------
ALTER TABLE lb_communication_templates
  ADD COLUMN IF NOT EXISTS purpose text,
  ADD COLUMN IF NOT EXISTS is_customised boolean,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

-- one template per business + purpose + channel. Old rows (no purpose) keep their own key space.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
     WHERE con.conrelid = 'lb_communication_templates'::regclass AND con.contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE lb_communication_templates DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_comm_templates_purpose
  ON lb_communication_templates (business_id, purpose, channel) WHERE purpose IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_comm_templates_legacy_type
  ON lb_communication_templates (business_id, message_type, channel) WHERE purpose IS NULL;

-- ---------- 3. preferences ----------
CREATE TABLE IF NOT EXISTS lb_comm_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,   -- shape + defaults: _shared/comm/prefs.js
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id)
);
ALTER TABLE lb_comm_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lb_comm_preferences ON lb_comm_preferences;
CREATE POLICY tenant_isolation_lb_comm_preferences ON lb_comm_preferences FOR ALL
  USING (tenant_id = get_current_tenant_id()) WITH CHECK (tenant_id = get_current_tenant_id());

-- ---------- 4. jobs (the scheduler's work list) ----------
CREATE TABLE IF NOT EXISTS lb_comm_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid REFERENCES lb_businesses(id),
  automation text NOT NULL,                 -- the preference key, e.g. PAYMENT_REMINDER
  purpose text NOT NULL,                    -- the wording planned (re-decided from fresh data when it is sent)
  channel text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('DRAFT','AUTO')),
  recipient_kind text NOT NULL,
  customer_id uuid REFERENCES lb_customers(id),
  supplier_id uuid REFERENCES lb_suppliers(id),
  reference_type text,
  reference_id uuid,
  dedupe_key text NOT NULL,
  run_at timestamptz NOT NULL DEFAULT now(),
  -- READY     = prepared for the owner to review and send (DRAFT mode, or AUTO that could not be sent by the server)
  -- PENDING   = AUTO, waiting for its time / retry
  -- PROCESSING= claimed by a dispatcher run
  -- DONE      = a message was recorded for it (log_id)
  -- SUPPRESSED= no longer needed when checked (debt paid, goods received, appointment cancelled...)
  -- FAILED    = gave up (see last_error)
  -- CANCELLED = dismissed by a person
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','READY','PROCESSING','DONE','SUPPRESSED','FAILED','CANCELLED')),
  status_reason text,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_error text,
  log_id uuid REFERENCES lb_communication_log(id),
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_lb_comm_jobs_due ON lb_comm_jobs (status, next_attempt_at, run_at);
CREATE INDEX IF NOT EXISTS idx_lb_comm_jobs_tenant ON lb_comm_jobs (tenant_id, status);
ALTER TABLE lb_comm_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comm_jobs_select ON lb_comm_jobs;
CREATE POLICY comm_jobs_select ON lb_comm_jobs FOR SELECT USING (tenant_id = get_current_tenant_id());
DROP POLICY IF EXISTS comm_jobs_update ON lb_comm_jobs;
CREATE POLICY comm_jobs_update ON lb_comm_jobs FOR UPDATE USING (tenant_id = get_current_tenant_id()) WITH CHECK (tenant_id = get_current_tenant_id());
-- no INSERT / DELETE policy: only the server (service role) creates jobs, and nobody deletes them.

-- ---------- 5. due dates for customer debts ----------
ALTER TABLE lb_customers ADD COLUMN IF NOT EXISTS credit_terms_days integer CHECK (credit_terms_days IS NULL OR credit_terms_days BETWEEN 0 AND 365);
COMMENT ON COLUMN lb_customers.credit_terms_days IS 'Days a credit sale may stay unpaid for this customer. NULL = use the business default (lb_comm_preferences), or no due date if neither is set.';

CREATE TABLE IF NOT EXISTS lb_receivable_dues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid REFERENCES lb_businesses(id),
  customer_id uuid NOT NULL REFERENCES lb_customers(id),
  reference_id uuid NOT NULL,            -- the credit-ledger row id, or the sale id it came from
  due_date date NOT NULL,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, reference_id)
);
ALTER TABLE lb_receivable_dues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lb_receivable_dues ON lb_receivable_dues;
CREATE POLICY tenant_isolation_lb_receivable_dues ON lb_receivable_dues FOR ALL
  USING (tenant_id = get_current_tenant_id()) WITH CHECK (tenant_id = get_current_tenant_id());

-- ---------- 6. internal notifications: who has read what ----------
CREATE TABLE IF NOT EXISTS lb_notification_reads (
  tenant_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  notif_key text NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, notif_key)
);
ALTER TABLE lb_notification_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_reads_own ON lb_notification_reads;
CREATE POLICY notification_reads_own ON lb_notification_reads FOR ALL
  USING (tenant_id = get_current_tenant_id() AND staff_id = nullif(auth.jwt() ->> 'pos_staff_id','')::uuid)
  WITH CHECK (tenant_id = get_current_tenant_id() AND staff_id = nullif(auth.jwt() ->> 'pos_staff_id','')::uuid);

-- ---------- 7. remember dates (original vs revised) ----------
ALTER TABLE lb_appointments
  ADD COLUMN IF NOT EXISTS original_appointment_date date,
  ADD COLUMN IF NOT EXISTS original_appointment_time time,
  ADD COLUMN IF NOT EXISTS rescheduled_from_date date,
  ADD COLUMN IF NOT EXISTS rescheduled_from_time time,
  ADD COLUMN IF NOT EXISTS rescheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS reschedule_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

CREATE OR REPLACE FUNCTION comm_appointment_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.original_appointment_date := COALESCE(NEW.original_appointment_date, NEW.appointment_date);
    NEW.original_appointment_time := COALESCE(NEW.original_appointment_time, NEW.appointment_time);
    RETURN NEW;
  END IF;
  IF (NEW.appointment_date, NEW.appointment_time) IS DISTINCT FROM (OLD.appointment_date, OLD.appointment_time) THEN
    NEW.original_appointment_date := COALESCE(OLD.original_appointment_date, OLD.appointment_date);
    NEW.original_appointment_time := COALESCE(OLD.original_appointment_time, OLD.appointment_time);
    NEW.rescheduled_from_date := OLD.appointment_date;
    NEW.rescheduled_from_time := OLD.appointment_time;
    NEW.rescheduled_at := now();
    NEW.reschedule_count := COALESCE(OLD.reschedule_count, 0) + 1;
  END IF;
  IF NEW.status::text = 'CANCELLED' AND OLD.status::text IS DISTINCT FROM 'CANCELLED' THEN NEW.cancelled_at := now();
  ELSIF NEW.status::text <> 'CANCELLED' THEN NEW.cancelled_at := NULL; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_lb_appointments_comm_history ON lb_appointments;
CREATE TRIGGER trg_lb_appointments_comm_history BEFORE INSERT OR UPDATE ON lb_appointments FOR EACH ROW EXECUTE FUNCTION comm_appointment_history();

ALTER TABLE lb_purchase_orders
  ADD COLUMN IF NOT EXISTS revised_delivery_date date,
  ADD COLUMN IF NOT EXISTS revised_delivery_note text,
  ADD COLUMN IF NOT EXISTS delivery_revised_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_revision_count integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN lb_purchase_orders.expected_date IS 'The ORIGINAL expected delivery date. It is never overwritten by a revision; see revised_delivery_date.';

CREATE OR REPLACE FUNCTION comm_po_delivery_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revised_delivery_date IS DISTINCT FROM OLD.revised_delivery_date THEN
    NEW.delivery_revised_at := now();
    NEW.delivery_revision_count := COALESCE(OLD.delivery_revision_count, 0) + 1;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_lb_po_comm_delivery_history ON lb_purchase_orders;
CREATE TRIGGER trg_lb_po_comm_delivery_history BEFORE UPDATE ON lb_purchase_orders FOR EACH ROW EXECUTE FUNCTION comm_po_delivery_history();

-- ---------- 8. permissions ----------
-- Who may send. Reuses the existing permission keys (no change to the permission catalogue).
CREATE OR REPLACE FUNCTION comm_can_send(p_kind text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_pos_session() THEN RETURN true; END IF;
  IF p_kind = 'SUPPLIER' THEN
    RETURN pos_has_permission('purchases.create') OR pos_has_permission('inventory.receive') OR pos_has_permission('payments.record') OR pos_has_permission('balances.view');
  ELSIF p_kind = 'CUSTOMER' THEN
    RETURN pos_has_permission('operations.use') OR pos_has_permission('sales.view') OR pos_has_permission('sales.create') OR pos_has_permission('payments.record') OR pos_has_permission('balances.view');
  END IF;
  RETURN pos_has_permission('settings.manage') OR pos_has_permission('finance.view') OR pos_has_permission('operations.use');
END $$;
REVOKE ALL ON FUNCTION comm_can_send(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION comm_can_send(text) TO authenticated;

-- Preferences: settings.manage (the existing "change business settings" permission).
DROP TRIGGER IF EXISTS trg_pos_perm_lb_comm_preferences ON lb_comm_preferences;
CREATE TRIGGER trg_pos_perm_lb_comm_preferences BEFORE INSERT OR UPDATE OR DELETE ON lb_comm_preferences
  FOR EACH ROW EXECUTE FUNCTION pos_enforce_permission('settings.manage');

-- Payment terms and due dates: whoever may record payments.
DROP TRIGGER IF EXISTS trg_pos_perm_lb_receivable_dues ON lb_receivable_dues;
CREATE TRIGGER trg_pos_perm_lb_receivable_dues BEFORE INSERT OR UPDATE OR DELETE ON lb_receivable_dues
  FOR EACH ROW EXECUTE FUNCTION pos_enforce_permission('payments.record','sales.create','settings.manage');

-- Permanent templates: only settings.manage may CHANGE wording. The old Messages screen seeds untouched default rows
-- for whoever opens it (is_customised IS NULL) - that stays allowed; anything that saves wording does not.
CREATE OR REPLACE FUNCTION comm_guard_template() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT is_pos_session() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'INSERT' AND COALESCE(NEW.is_customised, false) = false THEN RETURN NEW; END IF;
  IF pos_has_permission('settings.manage') THEN RETURN COALESCE(NEW, OLD); END IF;
  RAISE EXCEPTION 'Only someone allowed to change business settings can change message templates.' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_comm_guard_template ON lb_communication_templates;
CREATE TRIGGER trg_comm_guard_template BEFORE INSERT OR UPDATE OR DELETE ON lb_communication_templates FOR EACH ROW EXECUTE FUNCTION comm_guard_template();

-- ---------- 9. the outbox: integrity ----------
-- Split the old FOR ALL policy: tenants can read, add and update their own rows; nobody can delete.
DROP POLICY IF EXISTS tenant_isolation_lb_communication_log ON lb_communication_log;
DROP POLICY IF EXISTS comm_log_select ON lb_communication_log;
DROP POLICY IF EXISTS comm_log_insert ON lb_communication_log;
DROP POLICY IF EXISTS comm_log_update ON lb_communication_log;
CREATE POLICY comm_log_select ON lb_communication_log FOR SELECT USING (tenant_id = get_current_tenant_id());
CREATE POLICY comm_log_insert ON lb_communication_log FOR INSERT WITH CHECK (tenant_id = get_current_tenant_id());
CREATE POLICY comm_log_update ON lb_communication_log FOR UPDATE USING (tenant_id = get_current_tenant_id()) WITH CHECK (tenant_id = get_current_tenant_id());

CREATE OR REPLACE FUNCTION comm_log_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_kind text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF is_pos_session() THEN RAISE EXCEPTION 'Message history cannot be deleted.' USING ERRCODE = '42501'; END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.recipient_kind := COALESCE(NEW.recipient_kind, CASE WHEN NEW.supplier_id IS NOT NULL THEN 'SUPPLIER' WHEN NEW.customer_id IS NOT NULL THEN 'CUSTOMER' ELSE 'OTHER' END);
    NEW.generated_message := COALESCE(NEW.generated_message, NEW.rendered_message);
    NEW.was_edited := COALESCE(NEW.generated_message, '') IS DISTINCT FROM COALESCE(NEW.rendered_message, '');
    IF is_pos_session() THEN
      IF NOT comm_can_send(NEW.recipient_kind) THEN RAISE EXCEPTION 'You do not have permission to send messages.' USING ERRCODE = '42501'; END IF;
      IF NEW.status::text NOT IN ('QUEUED','OPENED') OR NEW.provider IS NOT NULL OR NEW.provider_message_id IS NOT NULL
         OR NEW.delivered_at IS NOT NULL OR NEW.read_at IS NOT NULL OR NEW.submitted_at IS NOT NULL THEN
        RAISE EXCEPTION 'A message can only start as prepared. Delivery details come from the provider.' USING ERRCODE = '42501';
      END IF;
      NEW.initiated_by := 'USER';
    END IF;
    NEW.status_history := jsonb_build_array(jsonb_build_object('status', NEW.status::text, 'at', now(), 'by', CASE WHEN is_pos_session() THEN 'user' ELSE 'system' END));
    RETURN NEW;
  END IF;

  -- UPDATE
  IF is_pos_session() THEN
    IF NOT comm_can_send(OLD.recipient_kind) THEN RAISE EXCEPTION 'You do not have permission to change messages.' USING ERRCODE = '42501'; END IF;
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.channel IS DISTINCT FROM OLD.channel OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.generated_message IS DISTINCT FROM OLD.generated_message OR NEW.provider IS DISTINCT FROM OLD.provider
       OR NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id OR NEW.delivered_at IS DISTINCT FROM OLD.delivered_at
       OR NEW.read_at IS DISTINCT FROM OLD.read_at OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at OR NEW.initiated_by IS DISTINCT FROM OLD.initiated_by THEN
      RAISE EXCEPTION 'That part of a message record cannot be changed.' USING ERRCODE = '42501';
    END IF;
    IF OLD.status::text <> 'QUEUED' AND (NEW.rendered_message IS DISTINCT FROM OLD.rendered_message OR NEW.recipient IS DISTINCT FROM OLD.recipient OR NEW.subject IS DISTINCT FROM OLD.subject) THEN
      RAISE EXCEPTION 'A message that has been opened or sent cannot be rewritten.' USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status::text IN ('SUBMITTED','DELIVERED','READ') THEN
        RAISE EXCEPTION 'Delivery can only be confirmed by the provider.' USING ERRCODE = '42501';
      END IF;
      IF NEW.status::text = 'SENT' AND OLD.provider IS NOT NULL AND OLD.provider <> 'MANUAL' THEN
        RAISE EXCEPTION 'This message was sent through a provider; its status comes from the provider.' USING ERRCODE = '42501';
      END IF;
      IF OLD.status::text IN ('DELIVERED','READ') THEN RAISE EXCEPTION 'A delivered message cannot be changed.' USING ERRCODE = '42501'; END IF;
    END IF;
  END IF;

  IF NEW.rendered_message IS DISTINCT FROM OLD.rendered_message THEN NEW.was_edited := NEW.rendered_message IS DISTINCT FROM COALESCE(NEW.generated_message, ''); END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_history := COALESCE(OLD.status_history, '[]'::jsonb) || jsonb_build_object('status', NEW.status::text, 'at', now(), 'by', CASE WHEN is_pos_session() THEN 'user' ELSE 'system' END);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_comm_log_guard ON lb_communication_log;
CREATE TRIGGER trg_comm_log_guard BEFORE INSERT OR UPDATE OR DELETE ON lb_communication_log FOR EACH ROW EXECUTE FUNCTION comm_log_guard();

-- Jobs: a person may only dismiss a READY job or mark it done with its message; nothing else.
CREATE OR REPLACE FUNCTION comm_jobs_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF is_pos_session() THEN
    IF NOT comm_can_send(OLD.recipient_kind) THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
    IF OLD.status NOT IN ('READY','FAILED') OR NEW.status NOT IN ('DONE','CANCELLED','READY')
       OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.purpose IS DISTINCT FROM OLD.purpose
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.mode IS DISTINCT FROM OLD.mode THEN
      RAISE EXCEPTION 'That change to a scheduled message is not allowed.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_comm_jobs_guard ON lb_comm_jobs;
CREATE TRIGGER trg_comm_jobs_guard BEFORE UPDATE ON lb_comm_jobs FOR EACH ROW EXECUTE FUNCTION comm_jobs_guard();

-- ---------- 10. customer debts with REAL due dates ----------
-- The credit ledger records every change of a customer's balance but no due date. This derives, for each customer who
-- still owes money, which parts of the debt are still open and when each is due:
--   * every ledger row that INCREASED the balance is a credit event (this does not depend on the type names)
--   * payments settle the OLDEST debt first, so what is still owed is made of the NEWEST increases (FIFO)
--   * due date = an explicit lb_receivable_dues date for that event, else event date + payment terms
--     (customer's credit_terms_days, else the business default passed in). No terms and no explicit date = NULL: the
--     caller must NOT invent one.
-- SECURITY INVOKER: a POS session only ever sees its own business through the table policies.
CREATE OR REPLACE FUNCTION comm_receivable_snapshot(p_tenant uuid, p_tz text DEFAULT 'Africa/Nairobi', p_default_days integer DEFAULT NULL, p_customer uuid DEFAULT NULL)
RETURNS TABLE (customer_id uuid, outstanding numeric, due_date date, open_amount numeric, reference text, event_at timestamptz)
LANGUAGE sql STABLE AS $$
  WITH cust AS (
    SELECT c.id, c.outstanding_balance AS bal, COALESCE(c.credit_terms_days, p_default_days) AS terms
      FROM lb_customers c
     WHERE c.tenant_id = p_tenant AND c.outstanding_balance > 0 AND (p_customer IS NULL OR c.id = p_customer)
       AND (NOT is_pos_session() OR p_tenant = get_current_tenant_id())
  ), led AS (
    SELECT t.customer_id, t.id AS ledger_id, t.reference_id, t.created_at,
           t.balance_after - LAG(t.balance_after, 1, 0::numeric) OVER (PARTITION BY t.customer_id ORDER BY t.created_at, t.id) AS delta
      FROM lb_customer_credit_transactions t JOIN cust ON cust.id = t.customer_id
  ), inc AS (
    SELECT l.*, COALESCE(SUM(l.delta) OVER (PARTITION BY l.customer_id ORDER BY l.created_at DESC, l.ledger_id DESC
                  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS newer
      FROM led l WHERE l.delta > 0
  )
  SELECT cust.id, cust.bal,
         COALESCE(d.due_date, CASE WHEN cust.terms IS NOT NULL THEN (inc.created_at AT TIME ZONE p_tz)::date + cust.terms END),
         LEAST(inc.delta, cust.bal - inc.newer),
         s.sale_number,
         inc.created_at
    FROM cust
    JOIN inc ON inc.customer_id = cust.id AND cust.bal - inc.newer > 0
    LEFT JOIN lb_receivable_dues d ON d.customer_id = cust.id AND d.reference_id IN (inc.ledger_id, inc.reference_id)
    LEFT JOIN lb_sales s ON s.id = inc.reference_id
   ORDER BY cust.id, inc.created_at
$$;
GRANT EXECUTE ON FUNCTION comm_receivable_snapshot(uuid, text, integer, uuid) TO authenticated;
