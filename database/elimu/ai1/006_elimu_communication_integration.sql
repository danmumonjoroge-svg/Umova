-- ============================================================
-- ELIMU 006 — communication & notification integration (adaptor over the EXISTING Umova engine)
--
-- Run AFTER 005. Additive and re-runnable. It does NOT change lb_communication_log, lb_communication_templates,
-- lb_comm_jobs, the comm-send edge function or any core permission. Every message Elimu prepares is a normal row in
-- lb_communication_log (so Umova's message history, delivery webhooks and reports keep working); Elimu only adds:
--
--   elimu_message_links       which student / guardian / application a log row is about (the core log has no such columns)
--   elimu_call_log            call INTENT + what the staff member recorded afterwards (the core log has no CALL channel)
--   elimu_notification_rules  which school events prepare a message, per purpose/channel (off = nothing happens)
--   elimu_notifications       the prepared-work queue ("3 acceptance letters to send"): nothing is ever sent from here
--   elimu_contact_eligibility()  consent / opt-out / contact-exists check, authoritative (JS mirrors it for the UI)
--   elimu_record_message() / elimu_mark_message() / elimu_log_call_intent() / elimu_record_call_outcome()
--   v_elimu_communication_history   one timeline: messages + calls, honest status labels
--
-- HONESTY RULES (enforced here, not only in the UI)
--   * Elimu never marks anything SUBMITTED / DELIVERED / READ -- only the provider (comm-send / webhook) can; the core guard refuses it.
--   * A WhatsApp wa.me / mailto / sms: hand-off is stored as OPENED ("opened on this device"), never "sent".
--   * A call row starts as INTENDED ("call started, outcome not recorded"); only a person can record what happened.
--   * A guardian who has opted out of a channel is refused here, except EMERGENCY purposes which are flagged as an override.
-- ============================================================

-- composite key so other tables can reference a contact within the same tenant
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'elimu_guardian_contacts_tenant_id_key') THEN
    ALTER TABLE elimu_guardian_contacts ADD CONSTRAINT elimu_guardian_contacts_tenant_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS elimu_message_links (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  log_id         uuid NOT NULL UNIQUE REFERENCES lb_communication_log (id),
  channel        text NOT NULL CHECK (channel IN ('SMS','EMAIL','WHATSAPP')),
  purpose        text NOT NULL CHECK (purpose LIKE 'ELIMU\_%'),
  student_id     uuid,
  guardian_id    uuid,
  contact_id     uuid,
  application_id uuid,
  consent_override boolean NOT NULL DEFAULT false,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, student_id)     REFERENCES elimu_students (tenant_id, id),
  FOREIGN KEY (tenant_id, guardian_id)    REFERENCES elimu_guardians (tenant_id, id),
  FOREIGN KEY (tenant_id, contact_id)     REFERENCES elimu_guardian_contacts (tenant_id, id),
  FOREIGN KEY (tenant_id, application_id) REFERENCES elimu_admission_applications (tenant_id, id),
  CONSTRAINT elimu_message_link_subject_chk CHECK (student_id IS NOT NULL OR guardian_id IS NOT NULL OR application_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_elimu_msg_student  ON elimu_message_links (tenant_id, student_id, created_at DESC) WHERE student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_elimu_msg_guardian ON elimu_message_links (tenant_id, guardian_id, created_at DESC) WHERE guardian_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_elimu_msg_app      ON elimu_message_links (tenant_id, application_id) WHERE application_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS elimu_call_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  student_id  uuid,
  guardian_id uuid NOT NULL,
  contact_id  uuid,
  purpose     text NOT NULL CHECK (purpose LIKE 'ELIMU\_%'),
  outcome     text NOT NULL DEFAULT 'INTENDED' CHECK (outcome IN ('INTENDED','ANSWERED','NO_ANSWER','BUSY','VOICEMAIL','WRONG_NUMBER','CALL_BACK')),
  note        text CHECK (note IS NULL OR length(note) <= 500),
  started_at  timestamptz NOT NULL DEFAULT now(),
  outcome_at  timestamptz,
  created_by  uuid,
  updated_by  uuid,
  FOREIGN KEY (tenant_id, student_id)  REFERENCES elimu_students (tenant_id, id),
  FOREIGN KEY (tenant_id, guardian_id) REFERENCES elimu_guardians (tenant_id, id),
  FOREIGN KEY (tenant_id, contact_id)  REFERENCES elimu_guardian_contacts (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_elimu_call_guardian ON elimu_call_log (tenant_id, guardian_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_elimu_call_student  ON elimu_call_log (tenant_id, student_id, started_at DESC) WHERE student_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS elimu_notification_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  business_id uuid NOT NULL,
  event_type  text NOT NULL CHECK (event_type LIKE 'elimu.%'),
  purpose     text NOT NULL CHECK (purpose LIKE 'ELIMU\_%'),
  channel     text NOT NULL CHECK (channel IN ('SMS','EMAIL','WHATSAPP')),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event_type, channel)
);

-- The queue holds PREPARED work for a person to open; sending still goes through the composer, one decision at a time.
CREATE TABLE IF NOT EXISTS elimu_notifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  business_id    uuid,
  event_type     text NOT NULL CHECK (event_type LIKE 'elimu.%'),
  purpose        text NOT NULL CHECK (purpose LIKE 'ELIMU\_%'),
  title          text NOT NULL CHECK (length(title) <= 160),
  student_id     uuid,
  guardian_id    uuid,
  application_id uuid,
  status         text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIONED','DISMISSED')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz,
  resolved_by    uuid,
  FOREIGN KEY (tenant_id, student_id)     REFERENCES elimu_students (tenant_id, id),
  FOREIGN KEY (tenant_id, guardian_id)    REFERENCES elimu_guardians (tenant_id, id),
  FOREIGN KEY (tenant_id, application_id) REFERENCES elimu_admission_applications (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_notification_open ON elimu_notifications (tenant_id, event_type, coalesce(application_id, student_id, guardian_id)) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_elimu_notification_queue ON elimu_notifications (tenant_id, status, created_at DESC);

-- ---------- guards / triggers ----------
CREATE OR REPLACE FUNCTION elimu_message_link_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM lb_communication_log l WHERE l.id = NEW.log_id AND l.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'That message belongs to another school.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'A message link cannot be changed.' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION elimu_call_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.outcome := 'INTENDED'; NEW.outcome_at := NULL; NEW.note := nullif(btrim(coalesce(NEW.note, '')), '');
    IF NEW.contact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM elimu_guardian_contacts c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.contact_id AND c.guardian_id = NEW.guardian_id AND c.kind = 'PHONE') THEN
      RAISE EXCEPTION 'That number does not belong to this guardian.' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.guardian_id IS DISTINCT FROM OLD.guardian_id OR NEW.student_id IS DISTINCT FROM OLD.student_id
       OR NEW.contact_id IS DISTINCT FROM OLD.contact_id OR NEW.purpose IS DISTINCT FROM OLD.purpose OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
      RAISE EXCEPTION 'Only the outcome and note of a call can be recorded.' USING ERRCODE = '23514';
    END IF;
    IF NEW.outcome IS DISTINCT FROM OLD.outcome OR NEW.note IS DISTINCT FROM OLD.note THEN NEW.outcome_at := now(); END IF;
    NEW.note := nullif(btrim(coalesce(NEW.note, '')), '');
  END IF;
  RETURN NEW;
END $$;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM (VALUES ('elimu_message_links','comms.send'),('elimu_call_log','comms.send'),('elimu_notification_rules','settings.manage'),('elimu_notifications','comms.send')) v(tbl, perm) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_1tenant ON %1$s', r.tbl);
    EXECUTE format('CREATE TRIGGER trg_%1$s_1tenant BEFORE INSERT OR UPDATE ON %1$s FOR EACH ROW EXECUTE FUNCTION elimu_tenant_guard()', r.tbl);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_2perm ON %1$s', r.tbl);
    EXECUTE format('CREATE TRIGGER trg_%1$s_2perm BEFORE INSERT OR UPDATE OR DELETE ON %1$s FOR EACH ROW EXECUTE FUNCTION elimu_enforce(%2$L)', r.tbl, r.perm);
    EXECUTE format('ALTER TABLE %1$s ENABLE ROW LEVEL SECURITY', r.tbl);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_message_links_3guard ON elimu_message_links;
CREATE TRIGGER trg_elimu_message_links_3guard BEFORE INSERT OR UPDATE ON elimu_message_links FOR EACH ROW EXECUTE FUNCTION elimu_message_link_guard();
DROP TRIGGER IF EXISTS trg_elimu_call_log_3guard ON elimu_call_log;
CREATE TRIGGER trg_elimu_call_log_3guard BEFORE INSERT OR UPDATE ON elimu_call_log FOR EACH ROW EXECUTE FUNCTION elimu_call_guard();
DROP TRIGGER IF EXISTS trg_elimu_notification_rules_4updated ON elimu_notification_rules;
CREATE TRIGGER trg_elimu_notification_rules_4updated BEFORE UPDATE ON elimu_notification_rules FOR EACH ROW EXECUTE FUNCTION elimu_set_updated_at();

-- RLS: history is visible with comms.history; logging a message/call needs comms.send (trigger); no DELETE policy anywhere.
DROP POLICY IF EXISTS elimu_message_links_select ON elimu_message_links;
CREATE POLICY elimu_message_links_select ON elimu_message_links FOR SELECT USING (tenant_id = (SELECT get_current_tenant_id()) AND (SELECT elimu_can('comms.history')));
DROP POLICY IF EXISTS elimu_message_links_insert ON elimu_message_links;
CREATE POLICY elimu_message_links_insert ON elimu_message_links FOR INSERT WITH CHECK (tenant_id = (SELECT get_current_tenant_id()));
DROP POLICY IF EXISTS elimu_call_log_select ON elimu_call_log;
CREATE POLICY elimu_call_log_select ON elimu_call_log FOR SELECT USING (tenant_id = (SELECT get_current_tenant_id()) AND (SELECT elimu_can('comms.history')));
DROP POLICY IF EXISTS elimu_call_log_insert ON elimu_call_log;
CREATE POLICY elimu_call_log_insert ON elimu_call_log FOR INSERT WITH CHECK (tenant_id = (SELECT get_current_tenant_id()));
DROP POLICY IF EXISTS elimu_call_log_update ON elimu_call_log;
CREATE POLICY elimu_call_log_update ON elimu_call_log FOR UPDATE USING (tenant_id = (SELECT get_current_tenant_id())) WITH CHECK (tenant_id = (SELECT get_current_tenant_id()));
DROP POLICY IF EXISTS elimu_notification_rules_select ON elimu_notification_rules;
CREATE POLICY elimu_notification_rules_select ON elimu_notification_rules FOR SELECT USING (tenant_id = (SELECT get_current_tenant_id()) AND (SELECT elimu_can('comms.send')));
DROP POLICY IF EXISTS elimu_notification_rules_write ON elimu_notification_rules;
CREATE POLICY elimu_notification_rules_write ON elimu_notification_rules FOR ALL USING (tenant_id = (SELECT get_current_tenant_id())) WITH CHECK (tenant_id = (SELECT get_current_tenant_id()));
DROP POLICY IF EXISTS elimu_notifications_select ON elimu_notifications;
CREATE POLICY elimu_notifications_select ON elimu_notifications FOR SELECT USING (tenant_id = (SELECT get_current_tenant_id()) AND (SELECT elimu_can('comms.send')));
DROP POLICY IF EXISTS elimu_notifications_update ON elimu_notifications;
CREATE POLICY elimu_notifications_update ON elimu_notifications FOR UPDATE USING (tenant_id = (SELECT get_current_tenant_id())) WITH CHECK (tenant_id = (SELECT get_current_tenant_id()));

-- ---------- consent / eligibility (authoritative) ----------
-- Returns {ok, reason, recipient, contact_id, override}. reason is a plain-language sentence the UI can show as is.
CREATE OR REPLACE FUNCTION elimu_contact_eligibility(p_guardian uuid, p_channel text, p_purpose text DEFAULT NULL, p_contact uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_tenant uuid := get_current_tenant_id(); v_kind text := CASE WHEN p_channel = 'EMAIL' THEN 'EMAIL' ELSE 'PHONE' END;
  v_cons text; c elimu_guardian_contacts; v_emergency boolean := coalesce(p_purpose, '') = 'ELIMU_EMERGENCY';
  v_consent_channel text := CASE WHEN p_channel = 'CALL' THEN 'PHONE' ELSE p_channel END;
BEGIN
  IF p_channel NOT IN ('SMS','EMAIL','WHATSAPP','CALL') THEN RAISE EXCEPTION 'Unknown channel.' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM elimu_guardians WHERE tenant_id = v_tenant AND id = p_guardian) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Guardian not found.');
  END IF;
  SELECT * INTO c FROM elimu_guardian_contacts x
   WHERE x.tenant_id = v_tenant AND x.guardian_id = p_guardian AND x.kind = v_kind AND (p_contact IS NULL OR x.id = p_contact)
     AND (p_channel <> 'WHATSAPP' OR p_contact IS NOT NULL OR true)
   ORDER BY (p_channel = 'WHATSAPP' AND x.is_whatsapp) DESC, x.is_primary DESC, x.created_at LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', CASE v_kind WHEN 'EMAIL' THEN 'No email address on record.' ELSE 'No phone number on record.' END);
  END IF;
  SELECT status INTO v_cons FROM elimu_guardian_channel_consent WHERE tenant_id = v_tenant AND guardian_id = p_guardian AND channel = v_consent_channel;
  v_cons := coalesce(v_cons, 'NOT_ASKED');
  IF v_cons = 'OPTED_OUT' THEN
    IF v_emergency THEN
      RETURN jsonb_build_object('ok', true, 'override', true, 'contact_id', c.id, 'recipient', c.value_normalized, 'reason', 'Guardian opted out of this channel; allowed for an emergency only.');
    END IF;
    RETURN jsonb_build_object('ok', false, 'contact_id', c.id, 'reason', 'This guardian has opted out of this channel.');
  END IF;
  IF v_cons = 'NOT_ASKED' AND elimu_setting_bool('require_explicit_consent', false, v_tenant) AND NOT v_emergency THEN
    RETURN jsonb_build_object('ok', false, 'contact_id', c.id, 'reason', 'This school requires consent on record before contacting by this channel.');
  END IF;
  RETURN jsonb_build_object('ok', true, 'override', false, 'contact_id', c.id, 'recipient', c.value_normalized);
END $$;

-- ---------- recording what staff did ----------
-- Prepare/hand off a message: writes a normal lb_communication_log row (QUEUED or OPENED only) plus the Elimu link.
-- SECURITY INVOKER on purpose: the core comm_log_guard (comm_can_send) applies on top of elimu_require('comms.send').
CREATE OR REPLACE FUNCTION elimu_record_message(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_tenant uuid := get_current_tenant_id(); v_ch text := upper(p ->> 'channel'); v_purpose text := p ->> 'purpose'; v_status text := coalesce(upper(p ->> 'status'), 'QUEUED');
  v_g uuid := nullif(p ->> 'guardian_id', '')::uuid; v_s uuid := nullif(p ->> 'student_id', '')::uuid; v_a uuid := nullif(p ->> 'application_id', '')::uuid;
  v_elig jsonb; v_biz uuid; v_name text; v_log uuid; v_body text := btrim(coalesce(p ->> 'message', '')); v_gen text := coalesce(p ->> 'generated_message', p ->> 'message');
BEGIN
  PERFORM elimu_require('comms.send');
  IF v_ch NOT IN ('SMS','EMAIL','WHATSAPP') THEN RAISE EXCEPTION 'Unknown channel.' USING ERRCODE = '22023'; END IF;
  IF v_purpose IS NULL OR v_purpose NOT LIKE 'ELIMU\_%' THEN RAISE EXCEPTION 'A purpose is required.' USING ERRCODE = '22023'; END IF;
  IF v_status NOT IN ('QUEUED','OPENED') THEN RAISE EXCEPTION 'A message can only be recorded as prepared or opened; delivery comes from the provider.' USING ERRCODE = '42501'; END IF;
  IF v_body = '' THEN RAISE EXCEPTION 'The message is empty.' USING ERRCODE = '22023'; END IF;
  IF v_g IS NULL THEN RAISE EXCEPTION 'Choose a guardian to contact.' USING ERRCODE = '22023'; END IF;
  v_elig := elimu_contact_eligibility(v_g, v_ch, v_purpose, nullif(p ->> 'contact_id', '')::uuid);
  IF NOT (v_elig ->> 'ok')::boolean THEN RAISE EXCEPTION '%', v_elig ->> 'reason' USING ERRCODE = '23514'; END IF;
  SELECT g.business_id, g.first_name || ' ' || g.last_name INTO v_biz, v_name FROM elimu_guardians g WHERE g.tenant_id = v_tenant AND g.id = v_g;
  INSERT INTO lb_communication_log (tenant_id, business_id, channel, message_type, recipient, rendered_message, generated_message, status, purpose, recipient_kind, recipient_name,
                                    subject, template_id, template_source, reference_type, reference_id, reference_label, created_by, opened_at)
  VALUES (v_tenant, v_biz, v_ch::lb_comm_channel, 'OTHER', v_elig ->> 'recipient', v_body, v_gen, v_status::lb_comm_status, v_purpose, 'GUARDIAN', v_name,
          nullif(btrim(coalesce(p ->> 'subject', '')), ''), nullif(p ->> 'template_id', '')::uuid, nullif(p ->> 'template_source', ''),
          CASE WHEN v_a IS NOT NULL THEN 'ELIMU_APPLICATION' WHEN v_s IS NOT NULL THEN 'ELIMU_STUDENT' ELSE 'ELIMU_GUARDIAN' END, coalesce(v_a, v_s, v_g),
          nullif(p ->> 'reference_label', ''), auth.uid(), CASE WHEN v_status = 'OPENED' THEN now() END)
  RETURNING id INTO v_log;
  INSERT INTO elimu_message_links (tenant_id, log_id, channel, purpose, student_id, guardian_id, contact_id, application_id, consent_override, created_by)
  VALUES (v_tenant, v_log, v_ch, v_purpose, v_s, v_g, (v_elig ->> 'contact_id')::uuid, v_a, coalesce((v_elig ->> 'override')::boolean, false), auth.uid());
  RETURN jsonb_build_object('log_id', v_log, 'status', v_status, 'override', coalesce((v_elig ->> 'override')::boolean, false));
END $$;

-- A person says what happened to a message they prepared: opened it / says they sent it by hand / gave up. Never a delivery claim.
CREATE OR REPLACE FUNCTION elimu_mark_message(p_log uuid, p_status text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM elimu_require('comms.send');
  IF upper(p_status) NOT IN ('OPENED','SENT','CANCELLED','FAILED') THEN RAISE EXCEPTION 'Only opened, sent by hand, cancelled or failed can be recorded.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM elimu_message_links WHERE tenant_id = get_current_tenant_id() AND log_id = p_log) THEN RAISE EXCEPTION 'Message not found.' USING ERRCODE = 'P0002'; END IF;
  UPDATE lb_communication_log SET status = upper(p_status)::lb_comm_status,
         opened_at = CASE WHEN upper(p_status) = 'OPENED' THEN coalesce(opened_at, now()) ELSE opened_at END,
         sent_at   = CASE WHEN upper(p_status) = 'SENT'   THEN coalesce(sent_at, now())   ELSE sent_at END
   WHERE tenant_id = get_current_tenant_id() AND id = p_log;
END $$;

CREATE OR REPLACE FUNCTION elimu_log_call_intent(p_guardian uuid, p_contact uuid DEFAULT NULL, p_student uuid DEFAULT NULL, p_purpose text DEFAULT 'ELIMU_GENERAL_NOTICE') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_elig jsonb; v_id uuid;
BEGIN
  PERFORM elimu_require('comms.send');
  v_elig := elimu_contact_eligibility(p_guardian, 'CALL', p_purpose, p_contact);
  IF NOT (v_elig ->> 'ok')::boolean THEN RAISE EXCEPTION '%', v_elig ->> 'reason' USING ERRCODE = '23514'; END IF;
  INSERT INTO elimu_call_log (tenant_id, student_id, guardian_id, contact_id, purpose, created_by)
  VALUES (get_current_tenant_id(), p_student, p_guardian, (v_elig ->> 'contact_id')::uuid, p_purpose, auth.uid()) RETURNING id INTO v_id;
  RETURN jsonb_build_object('call_id', v_id, 'dial', v_elig ->> 'recipient', 'override', coalesce((v_elig ->> 'override')::boolean, false));
END $$;

CREATE OR REPLACE FUNCTION elimu_record_call_outcome(p_call uuid, p_outcome text, p_note text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM elimu_require('comms.send');
  UPDATE elimu_call_log SET outcome = upper(p_outcome), note = p_note, updated_by = auth.uid() WHERE tenant_id = get_current_tenant_id() AND id = p_call;
  IF NOT FOUND THEN RAISE EXCEPTION 'Call not found.' USING ERRCODE = 'P0002'; END IF;
END $$;

-- ---------- notifications: prepare, never send ----------
CREATE OR REPLACE FUNCTION elimu_seed_notification_rules(p_business uuid DEFAULT NULL) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid := get_current_tenant_id(); v_biz uuid; n int;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No school selected.' USING ERRCODE = '22023'; END IF;
  IF is_pos_session() THEN PERFORM elimu_require('settings.manage'); END IF;
  SELECT b.id INTO v_biz FROM lb_businesses b WHERE b.tenant_id = v_tenant AND (p_business IS NULL OR b.id = p_business) ORDER BY b.id LIMIT 1;
  IF v_biz IS NULL THEN RAISE EXCEPTION 'This tenant has no business record.' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('elimu.trusted', 'on', true);
  INSERT INTO elimu_notification_rules (tenant_id, business_id, event_type, purpose, channel) VALUES
    (v_tenant, v_biz, 'elimu.application.submitted', 'ELIMU_ADMISSION_RECEIVED', 'SMS'),
    (v_tenant, v_biz, 'elimu.application.accepted',  'ELIMU_ADMISSION_OFFER',    'SMS'),
    (v_tenant, v_biz, 'elimu.application.waitlisted','ELIMU_ADMISSION_UPDATE',   'SMS'),
    (v_tenant, v_biz, 'elimu.application.rejected',  'ELIMU_ADMISSION_UPDATE',   'SMS'),
    (v_tenant, v_biz, 'elimu.student.admitted',      'ELIMU_WELCOME',            'SMS'),
    (v_tenant, v_biz, 'elimu.student.enrolled',      'ELIMU_ENROLLMENT_CONFIRMATION', 'SMS')
  ON CONFLICT (tenant_id, event_type, channel) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('elimu.trusted', '', true);
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION elimu_notify(p_event text, p_title text, p_student uuid, p_application uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid := get_current_tenant_id(); v_purpose text; v_g uuid;
BEGIN
  IF v_tenant IS NULL THEN RETURN; END IF;
  SELECT purpose INTO v_purpose FROM elimu_notification_rules WHERE tenant_id = v_tenant AND event_type = p_event AND is_active ORDER BY channel LIMIT 1;
  IF v_purpose IS NULL THEN RETURN; END IF;
  SELECT sg.guardian_id INTO v_g FROM elimu_student_guardians sg WHERE sg.tenant_id = v_tenant AND sg.student_id = p_student AND sg.ended_on IS NULL ORDER BY sg.guardian_rank LIMIT 1;
  INSERT INTO elimu_notifications (tenant_id, business_id, event_type, purpose, title, student_id, guardian_id, application_id)
  SELECT v_tenant, (SELECT business_id FROM elimu_students WHERE tenant_id = v_tenant AND id = p_student), p_event, v_purpose, left(p_title, 160), p_student, v_g, p_application
  ON CONFLICT DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION elimu_application_notify() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cat text; v_name text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status_id IS NOT DISTINCT FROM OLD.status_id THEN RETURN NEW; END IF;
  SELECT category INTO v_cat FROM elimu_admission_statuses WHERE tenant_id = NEW.tenant_id AND id = NEW.status_id;
  SELECT first_name || ' ' || last_name INTO v_name FROM elimu_students WHERE tenant_id = NEW.tenant_id AND id = NEW.student_id;
  PERFORM elimu_notify(CASE v_cat WHEN 'SUBMITTED' THEN 'elimu.application.submitted' WHEN 'ACCEPTED' THEN 'elimu.application.accepted'
                                  WHEN 'WAITLISTED' THEN 'elimu.application.waitlisted' WHEN 'REJECTED' THEN 'elimu.application.rejected'
                                  WHEN 'ADMITTED' THEN 'elimu.student.admitted' END,
                       CASE v_cat WHEN 'SUBMITTED' THEN 'Application received: ' WHEN 'ACCEPTED' THEN 'Tell the guardian: accepted — ' WHEN 'WAITLISTED' THEN 'Tell the guardian: waitlisted — '
                                  WHEN 'REJECTED' THEN 'Tell the guardian: not offered a place — ' WHEN 'ADMITTED' THEN 'Welcome the family: ' ELSE '' END || coalesce(v_name, ''),
                       NEW.student_id, NEW.id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_applications_5notify ON elimu_admission_applications;
CREATE TRIGGER trg_elimu_applications_5notify AFTER INSERT OR UPDATE ON elimu_admission_applications FOR EACH ROW EXECUTE FUNCTION elimu_application_notify();

-- Resolve a queue item once a person has acted on it or decided to skip it.
CREATE OR REPLACE FUNCTION elimu_resolve_notification(p_id uuid, p_status text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM elimu_require('comms.send');
  IF p_status NOT IN ('ACTIONED','DISMISSED') THEN RAISE EXCEPTION 'Bad status.' USING ERRCODE = '22023'; END IF;
  UPDATE elimu_notifications SET status = p_status, resolved_at = now(), resolved_by = auth.uid() WHERE tenant_id = get_current_tenant_id() AND id = p_id AND status = 'PENDING';
END $$;

-- ---------- one honest timeline ----------
CREATE OR REPLACE VIEW v_elimu_communication_history WITH (security_invoker = true) AS
SELECT l.tenant_id, 'MESSAGE:' || l.id::text AS entry_id, k.channel, k.purpose, k.student_id, k.guardian_id, k.application_id,
       l.recipient_name, l.subject, l.rendered_message AS body, l.was_edited, l.status::text AS raw_status,
       CASE l.status::text
         WHEN 'QUEUED' THEN 'Prepared, not sent' WHEN 'OPENED' THEN CASE k.channel WHEN 'WHATSAPP' THEN 'Opened in WhatsApp (not confirmed sent)' WHEN 'EMAIL' THEN 'Opened in email app (not confirmed sent)' ELSE 'Opened in messages app (not confirmed sent)' END
         WHEN 'SENT' THEN CASE WHEN l.provider IS NULL OR l.provider = 'MANUAL' THEN 'Marked as sent by staff' ELSE 'Sent' END
         WHEN 'SUBMITTED' THEN 'Handed to provider' WHEN 'DELIVERED' THEN 'Delivered' WHEN 'READ' THEN 'Read' WHEN 'FAILED' THEN 'Failed' ELSE 'Cancelled' END AS status_label,
       l.created_at AS at, l.created_by, k.consent_override
  FROM elimu_message_links k JOIN lb_communication_log l ON l.id = k.log_id
UNION ALL
SELECT c.tenant_id, 'CALL:' || c.id::text, 'CALL', c.purpose, c.student_id, c.guardian_id, NULL::uuid,
       g.first_name || ' ' || g.last_name, NULL, c.note, false, c.outcome,
       CASE c.outcome WHEN 'INTENDED' THEN 'Call started — outcome not recorded' WHEN 'ANSWERED' THEN 'Spoke with guardian' WHEN 'NO_ANSWER' THEN 'No answer'
                      WHEN 'BUSY' THEN 'Line busy' WHEN 'VOICEMAIL' THEN 'Left voicemail' WHEN 'WRONG_NUMBER' THEN 'Wrong number' ELSE 'Asked to call back' END,
       c.started_at, c.created_by, false
  FROM elimu_call_log c JOIN elimu_guardians g ON g.tenant_id = c.tenant_id AND g.id = c.guardian_id;

SELECT elimu_apply_grants();
