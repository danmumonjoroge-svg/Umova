-- ============================================================================
-- ELIMU FINANCE  E010  Notification registry (NOT a messaging engine).
-- Messages are composed/sent/logged by the POS communication engine (lb_communication_log, comm-send). This table only
--   (a) links a finance event to the lb_communication_log row that carries it, and
--   (b) makes "the same notice twice" impossible: UNIQUE (business_id, event_key).
-- event_key = purpose|reference_id|channel|recipient. A deliberate resend uses a new key suffix (e.g. ":resend:2").
-- Requires E001-E011. Re-runnable.
-- ============================================================================
CREATE TABLE IF NOT EXISTS elimu_fin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  student_id uuid,
  purpose text NOT NULL CHECK (purpose LIKE 'ELIMU_%'),
  channel text NOT NULL CHECK (channel IN ('SMS','EMAIL','WHATSAPP','CALL')),
  recipient text,
  reference_type text, reference_id uuid,
  event_key text NOT NULL CHECK (length(event_key) BETWEEN 5 AND 300),
  comm_log_id uuid,                                           -- lb_communication_log.id (status/failure live THERE, never copied here)
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, event_key)
);
CREATE INDEX IF NOT EXISTS idx_elimu_fin_notif_student ON elimu_fin_notifications (business_id, student_id, created_at DESC);
SELECT _elimu_fin_secure('elimu_fin_notifications', 'view');

CREATE OR REPLACE FUNCTION elimu_fin_register_notification(p_business uuid, p_student uuid, p_purpose text, p_channel text, p_recipient text,
  p_reference_type text, p_reference_id uuid, p_event_key text, p_comm_log_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t uuid; v_id uuid;
BEGIN
  IF NOT (elimu_fin_can('collect') OR elimu_fin_can('bill')) THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  v_t := _elimu_fin_tenant_of(p_business);
  INSERT INTO elimu_fin_notifications (tenant_id, business_id, student_id, purpose, channel, recipient, reference_type, reference_id, event_key, comm_log_id, created_by)
  VALUES (v_t, p_business, p_student, p_purpose, upper(p_channel), p_recipient, p_reference_type, p_reference_id, p_event_key, p_comm_log_id, _elimu_fin_staff())
  ON CONFLICT (business_id, event_key) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'notification_id', (SELECT id FROM elimu_fin_notifications WHERE business_id = p_business AND event_key = p_event_key));
  END IF;
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'notification_id', v_id);
END $$;
CREATE OR REPLACE FUNCTION elimu_fin_attach_comm_log(p_notification uuid, p_comm_log uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT (elimu_fin_can('collect') OR elimu_fin_can('bill')) THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  UPDATE elimu_fin_notifications SET comm_log_id = p_comm_log WHERE id = p_notification AND tenant_id = get_current_tenant_id() AND comm_log_id IS NULL;
END $$;
REVOKE ALL ON FUNCTION elimu_fin_register_notification(uuid,uuid,text,text,text,text,uuid,text,uuid), elimu_fin_attach_comm_log(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION elimu_fin_register_notification(uuid,uuid,text,text,text,text,uuid,text,uuid), elimu_fin_attach_comm_log(uuid,uuid) TO authenticated;
