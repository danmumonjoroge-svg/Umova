-- ============================================================
-- ELIMU 007 -- absence follow-up cases and guardian-contact records
-- Run AFTER 006. Safe to re-run.
--
-- The MESSAGE ITSELF (text, channel, sender, time, delivery status, failure reason, queued/offline state) lives in the
-- existing lb_communication_log. This file only adds the LINK: which student / guardian / attendance record / purpose a
-- message was about (elimu_attendance_notices.comm_log_id) and the follow-up case a teacher works through.
-- Delivery status is read from lb_communication_log, never invented here: a queued or opened message is not "delivered".
-- ============================================================

CREATE TABLE IF NOT EXISTS elimu_absence_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid,
  record_id uuid NOT NULL REFERENCES elimu_attendance_records(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL,
  student_id uuid NOT NULL,
  enrollment_id uuid NOT NULL,
  absence_date date NOT NULL,
  class_id uuid NOT NULL, stream_id uuid,                              -- snapshot of where the student was that day
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')),
  reason_id uuid REFERENCES elimu_attendance_reasons(id),
  explanation_received boolean NOT NULL DEFAULT false,
  explanation_received_at timestamptz,
  explanation_note text,
  guardian_contacted boolean NOT NULL DEFAULT false,
  guardian_contacted_at timestamptz,
  guardian_contacted_by uuid,
  contact_channel text CHECK (contact_channel IS NULL OR contact_channel IN ('CALL','SMS','EMAIL','WHATSAPP','IN_PERSON','OTHER')),
  excuse_status text NOT NULL DEFAULT 'NONE' CHECK (excuse_status IN ('NONE','PENDING','APPROVED','REJECTED')),
  excuse_decided_by uuid, excuse_decided_at timestamptz, excuse_note text,
  assigned_to uuid,                                                      -- staff responsible
  follow_up_due date,
  notes text,
  closed_reason text CHECK (closed_reason IS NULL OR closed_reason IN ('RESOLVED','EXCUSE_APPROVED','CORRECTED','NO_ACTION_NEEDED','OTHER')),
  closed_at timestamptz, closed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (record_id)
);
CREATE INDEX IF NOT EXISTS idx_elimu_fu_open ON elimu_absence_followups (tenant_id, status, absence_date DESC) WHERE status IN ('OPEN','IN_PROGRESS');
CREATE INDEX IF NOT EXISTS idx_elimu_fu_student ON elimu_absence_followups (tenant_id, student_id, absence_date DESC);
CREATE INDEX IF NOT EXISTS idx_elimu_fu_class ON elimu_absence_followups (tenant_id, class_id, stream_id, absence_date DESC);
DROP TRIGGER IF EXISTS trg_elimu_fu_upd ON elimu_absence_followups;
CREATE TRIGGER trg_elimu_fu_upd BEFORE UPDATE ON elimu_absence_followups FOR EACH ROW EXECUTE FUNCTION elimu_set_updated_at();

ALTER TABLE elimu_absence_followups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_fu_read ON elimu_absence_followups;
CREATE POLICY elimu_fu_read ON elimu_absence_followups FOR SELECT
  USING (tenant_id = get_current_tenant_id() AND elimu_att_scope_ok(class_id, stream_id, NULL, NULL));
-- no write policy: elimu_update_absence_followup (below) is the only door

CREATE TABLE IF NOT EXISTS elimu_attendance_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  record_id uuid NOT NULL REFERENCES elimu_attendance_records(id) ON DELETE RESTRICT,
  followup_id uuid REFERENCES elimu_absence_followups(id) ON DELETE SET NULL,
  student_id uuid NOT NULL,
  guardian_id uuid,                                                      -- foundation guardian id (plain uuid)
  guardian_name text,
  purpose text NOT NULL CHECK (purpose IN ('ABSENT','LATE','LEFT_EARLY','REPEATED_ABSENCE','CORRECTION','CONCERN')),
  channel text NOT NULL CHECK (channel IN ('SMS','EMAIL','WHATSAPP','CALL')),
  comm_log_id uuid,                                                      -- lb_communication_log.id (NULL for a phone call)
  call_outcome text CHECK (call_outcome IS NULL OR call_outcome IN ('ANSWERED','NO_ANSWER','VOICEMAIL','WRONG_NUMBER','BUSY')),
  note text,
  superseded_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT elimu_notice_call_chk CHECK ((channel = 'CALL' AND comm_log_id IS NULL) OR channel <> 'CALL')
);
-- the same purpose is not sent twice to the same guardian on the same channel for one record (a deliberate resend supersedes the old one)
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_notice_once ON elimu_attendance_notices
  (tenant_id, record_id, purpose, COALESCE(guardian_id, elimu_nil()), channel) WHERE channel <> 'CALL' AND superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_elimu_notice_record ON elimu_attendance_notices (tenant_id, record_id);
CREATE INDEX IF NOT EXISTS idx_elimu_notice_student ON elimu_attendance_notices (tenant_id, student_id, created_at DESC);
ALTER TABLE elimu_attendance_notices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_notice_read ON elimu_attendance_notices;
CREATE POLICY elimu_notice_read ON elimu_attendance_notices FOR SELECT
  USING (tenant_id = get_current_tenant_id() AND EXISTS (SELECT 1 FROM elimu_attendance_records r WHERE r.id = record_id));

-- Contact history with the REAL delivery status from the communication log.
CREATE OR REPLACE VIEW elimu_v_attendance_notices WITH (security_invoker = true) AS
  SELECT n.*, l.status::text AS delivery_status, l.sent_at, l.failure_reason, l.rendered_message AS message_text, l.created_by AS sender_id,
         l.recipient AS sent_to, l.created_at AS message_created_at
    FROM elimu_attendance_notices n LEFT JOIN lb_communication_log l ON l.id = n.comm_log_id;
GRANT SELECT ON elimu_v_attendance_notices TO authenticated;

-- ---------- record that a guardian was (or is being) contacted ----------
-- Returns {duplicate:true, comm_log_id} when this purpose was already sent to this guardian on this channel, unless p_resend.
CREATE OR REPLACE FUNCTION elimu_record_guardian_contact(
  p_record_id uuid, p_purpose text, p_guardian_id uuid, p_guardian_name text, p_channel text,
  p_comm_log_id uuid DEFAULT NULL, p_call_outcome text DEFAULT NULL, p_note text DEFAULT NULL, p_resend boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rec elimu_attendance_records; v_fu uuid; v_exist elimu_attendance_notices; v_id uuid;
BEGIN
  PERFORM elimu_require('comms.send');
  SELECT * INTO rec FROM elimu_attendance_records WHERE id = p_record_id AND tenant_id = elimu_tenant();
  IF NOT FOUND THEN RAISE EXCEPTION 'That attendance record was not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT elimu_att_scope_ok(rec.class_id, rec.stream_id, NULL, NULL, true) AND NOT elimu_can('attendance.view_all') THEN
    RAISE EXCEPTION 'You are not assigned to this class.' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_fu FROM elimu_absence_followups WHERE record_id = rec.id;
  IF p_channel <> 'CALL' THEN
    SELECT * INTO v_exist FROM elimu_attendance_notices WHERE tenant_id = rec.tenant_id AND record_id = rec.id AND purpose = p_purpose
       AND COALESCE(guardian_id, elimu_nil()) = COALESCE(p_guardian_id, elimu_nil()) AND channel = p_channel AND superseded_at IS NULL;
    IF FOUND THEN
      IF NOT p_resend THEN RETURN jsonb_build_object('ok', true, 'duplicate', true, 'notice_id', v_exist.id, 'comm_log_id', v_exist.comm_log_id); END IF;
      UPDATE elimu_attendance_notices SET superseded_at = now() WHERE id = v_exist.id;
    END IF;
  END IF;
  INSERT INTO elimu_attendance_notices (tenant_id, record_id, followup_id, student_id, guardian_id, guardian_name, purpose, channel, comm_log_id, call_outcome, note, created_by)
  VALUES (rec.tenant_id, rec.id, v_fu, rec.student_id, p_guardian_id, p_guardian_name, p_purpose, p_channel, p_comm_log_id, p_call_outcome, nullif(btrim(p_note),''), elimu_staff_id())
  RETURNING id INTO v_id;
  -- Only a ANSWERED call counts as "contacted" on its own. A message counts once staff confirm it was sent (elimu_update_absence_followup).
  IF v_fu IS NOT NULL AND p_channel = 'CALL' AND p_call_outcome = 'ANSWERED' THEN
    UPDATE elimu_absence_followups SET guardian_contacted = true, guardian_contacted_at = now(), guardian_contacted_by = elimu_staff_id(), contact_channel = 'CALL',
           status = CASE WHEN status = 'OPEN' THEN 'IN_PROGRESS' ELSE status END WHERE id = v_fu;
    PERFORM elimu_audit('ELIMU_GUARDIAN_CONTACTED', 'elimu_attendance_records', rec.id, NULL, jsonb_build_object('channel', 'CALL', 'purpose', p_purpose, 'guardian', p_guardian_name));
  END IF;
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'notice_id', v_id);
END $$;
GRANT EXECUTE ON FUNCTION elimu_record_guardian_contact(uuid, text, uuid, text, text, uuid, text, text, boolean) TO authenticated;

-- ---------- work a follow-up case ----------
-- p_changes keys (all optional): reason_id, explanation_received, explanation_note, guardian_contacted, contact_channel,
--   request_excuse (true), excuse_decision ('APPROVED'|'REJECTED'), excuse_note, assigned_to, follow_up_due, notes, close (true), closed_reason
CREATE OR REPLACE FUNCTION elimu_update_absence_followup(p_followup_id uuid, p_changes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f elimu_absence_followups; rec elimu_attendance_records; v_old jsonb; v_reason uuid; v_dec text;
BEGIN
  PERFORM elimu_require('absence.manage');
  SELECT * INTO f FROM elimu_absence_followups WHERE id = p_followup_id AND tenant_id = elimu_tenant() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That follow-up was not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT elimu_att_scope_ok(f.class_id, f.stream_id, NULL, NULL, true) THEN RAISE EXCEPTION 'You are not assigned to this class.' USING ERRCODE = '42501'; END IF;
  v_old := to_jsonb(f);

  IF p_changes ? 'reason_id' THEN
    v_reason := nullif(p_changes->>'reason_id','')::uuid;
    IF v_reason IS NOT NULL AND NOT EXISTS (SELECT 1 FROM elimu_attendance_reasons x WHERE x.id = v_reason AND x.tenant_id = f.tenant_id) THEN
      RAISE EXCEPTION 'Unknown absence reason.' USING ERRCODE = '22023'; END IF;
    IF v_reason IS DISTINCT FROM f.reason_id THEN
      SELECT * INTO rec FROM elimu_attendance_records WHERE id = f.record_id FOR UPDATE;
      PERFORM set_config('elimu.attendance_amend', '1', true);
      UPDATE elimu_attendance_records SET reason_id = v_reason WHERE id = rec.id;
      INSERT INTO elimu_attendance_amendments (tenant_id, session_id, record_id, kind, previous_value, new_value, reason, amended_by)
      VALUES (rec.tenant_id, rec.session_id, rec.id, 'AMENDED', jsonb_build_object('reason_id', rec.reason_id), jsonb_build_object('reason_id', v_reason), 'Absence reason recorded', elimu_staff_id());
      PERFORM elimu_audit('ELIMU_ABSENCE_REASON_CHANGED', 'elimu_absence_followups', f.id, jsonb_build_object('reason_id', f.reason_id), jsonb_build_object('reason_id', v_reason));
      f.reason_id := v_reason;
    END IF;
  END IF;

  IF p_changes ? 'explanation_received' THEN
    f.explanation_received := coalesce((p_changes->>'explanation_received')::boolean, false);
    f.explanation_received_at := CASE WHEN f.explanation_received THEN coalesce(f.explanation_received_at, now()) END;
  END IF;
  IF p_changes ? 'explanation_note' THEN f.explanation_note := nullif(btrim(p_changes->>'explanation_note'),''); END IF;
  IF p_changes ? 'guardian_contacted' THEN
    IF coalesce((p_changes->>'guardian_contacted')::boolean, false) AND NOT f.guardian_contacted THEN
      f.guardian_contacted := true; f.guardian_contacted_at := now(); f.guardian_contacted_by := elimu_staff_id();
      f.contact_channel := nullif(p_changes->>'contact_channel','');
      PERFORM elimu_audit('ELIMU_GUARDIAN_CONTACTED', 'elimu_absence_followups', f.id, NULL, jsonb_build_object('channel', f.contact_channel));
    ELSIF NOT coalesce((p_changes->>'guardian_contacted')::boolean, false) THEN
      f.guardian_contacted := false; f.guardian_contacted_at := NULL; f.guardian_contacted_by := NULL; f.contact_channel := NULL;
    END IF;
  END IF;
  IF p_changes ? 'assigned_to' THEN f.assigned_to := nullif(p_changes->>'assigned_to','')::uuid; END IF;
  IF p_changes ? 'follow_up_due' THEN f.follow_up_due := nullif(p_changes->>'follow_up_due','')::date; END IF;
  IF p_changes ? 'notes' THEN f.notes := nullif(btrim(p_changes->>'notes'),''); END IF;
  IF coalesce((p_changes->>'request_excuse')::boolean, false) AND f.excuse_status = 'NONE' THEN f.excuse_status := 'PENDING'; END IF;

  v_dec := p_changes->>'excuse_decision';
  IF v_dec IS NOT NULL THEN
    PERFORM elimu_require('absence.approve');
    IF v_dec NOT IN ('APPROVED','REJECTED') THEN RAISE EXCEPTION 'Unknown decision.' USING ERRCODE = '22023'; END IF;
    f.excuse_status := v_dec; f.excuse_decided_by := elimu_staff_id(); f.excuse_decided_at := now(); f.excuse_note := nullif(btrim(p_changes->>'excuse_note'),'');
    IF v_dec = 'APPROVED' THEN
      SELECT * INTO rec FROM elimu_attendance_records WHERE id = f.record_id;
      IF rec.status = 'ABSENT' THEN                                   -- an approved excuse corrects the register through the normal, audited amendment
        PERFORM elimu_amend_attendance(rec.id, jsonb_build_object('status', 'EXCUSED'), 'Excuse approved' || coalesce(': ' || f.excuse_note, ''));
      END IF;
      f.status := 'RESOLVED'; f.closed_reason := 'EXCUSE_APPROVED'; f.closed_at := now(); f.closed_by := elimu_staff_id();
    END IF;
    PERFORM elimu_audit('ELIMU_EXCUSE_DECIDED', 'elimu_absence_followups', f.id, jsonb_build_object('excuse_status', v_old->>'excuse_status'), jsonb_build_object('excuse_status', v_dec), f.excuse_note);
  END IF;

  IF coalesce((p_changes->>'close')::boolean, false) THEN
    f.status := 'CLOSED'; f.closed_reason := coalesce(nullif(p_changes->>'closed_reason',''), 'RESOLVED'); f.closed_at := now(); f.closed_by := elimu_staff_id();
  ELSIF f.status = 'OPEN' AND (f.guardian_contacted OR f.explanation_received OR f.reason_id IS NOT NULL) THEN
    f.status := 'IN_PROGRESS';
  END IF;

  UPDATE elimu_absence_followups SET status = f.status, reason_id = f.reason_id, explanation_received = f.explanation_received, explanation_received_at = f.explanation_received_at,
         explanation_note = f.explanation_note, guardian_contacted = f.guardian_contacted, guardian_contacted_at = f.guardian_contacted_at,
         guardian_contacted_by = f.guardian_contacted_by, contact_channel = f.contact_channel, excuse_status = f.excuse_status, excuse_decided_by = f.excuse_decided_by,
         excuse_decided_at = f.excuse_decided_at, excuse_note = f.excuse_note, assigned_to = f.assigned_to, follow_up_due = f.follow_up_due, notes = f.notes,
         closed_reason = f.closed_reason, closed_at = f.closed_at, closed_by = f.closed_by
   WHERE id = f.id RETURNING * INTO f;
  RETURN jsonb_build_object('ok', true, 'followup', to_jsonb(f));
END $$;
GRANT EXECUTE ON FUNCTION elimu_update_absence_followup(uuid, jsonb) TO authenticated;
