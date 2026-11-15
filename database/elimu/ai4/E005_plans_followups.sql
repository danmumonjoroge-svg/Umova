-- ============================================================================
-- ELIMU FINANCE  E005  Payment plans (instalments) and debtor follow-ups.
-- * A plan covers specific invoices. Its instalments must add up to EXACTLY what is outstanding on them when the plan is approved.
-- * Instalment "paid" is DERIVED (money settled on the covered invoices since approval, applied to instalments in order).
--   Nothing is stored that could drift from the allocations.
-- * No penalties / late fees exist anywhere in this module. If a school ever wants them it must be an explicit, approved policy (not built).
-- * Rescheduling = a NEW plan that supersedes the old one when approved. The old plan stays on record.
-- Requires E001-E004. Re-runnable.
-- ============================================================================
CREATE TABLE IF NOT EXISTS elimu_fin_payment_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  student_id uuid NOT NULL,
  name text NOT NULL DEFAULT 'Payment plan',
  status text NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN ('PENDING_APPROVAL','ACTIVE','COMPLETED','CANCELLED','SUPERSEDED','REJECTED')),
  total_amount numeric(15,2) NOT NULL CHECK (total_amount > 0),
  baseline_settled numeric(15,2),                              -- settled on covered invoices at approval
  supersedes_plan_id uuid REFERENCES elimu_fin_payment_plans(id),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  requested_by uuid, requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid, decided_at timestamptz, decision_note text,
  admission_no text NOT NULL, student_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, student_id) REFERENCES elimu_fin_students (business_id, student_id)
);
CREATE TABLE IF NOT EXISTS elimu_fin_plan_invoices (
  plan_id uuid NOT NULL REFERENCES elimu_fin_payment_plans(id),
  invoice_id uuid NOT NULL REFERENCES elimu_fin_invoices(id),
  tenant_id uuid NOT NULL, business_id uuid NOT NULL,
  PRIMARY KEY (plan_id, invoice_id)
);
CREATE TABLE IF NOT EXISTS elimu_fin_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, business_id uuid NOT NULL,
  plan_id uuid NOT NULL REFERENCES elimu_fin_payment_plans(id),
  seq integer NOT NULL CHECK (seq >= 1),
  due_date date NOT NULL,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  UNIQUE (plan_id, seq)
);
CREATE TABLE IF NOT EXISTS elimu_fin_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  student_id uuid NOT NULL,
  invoice_id uuid REFERENCES elimu_fin_invoices(id),
  action_type text NOT NULL CHECK (action_type IN ('CALL','SMS','EMAIL','WHATSAPP','VISIT','MEETING','PROMISE_TO_PAY','NOTE')),
  outcome text, notes text,
  promise_date date, promise_amount numeric(15,2) CHECK (promise_amount IS NULL OR promise_amount > 0),
  next_action_date date,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, student_id) REFERENCES elimu_fin_students (business_id, student_id),
  CONSTRAINT elimu_fin_followup_has_content CHECK (coalesce(btrim(outcome),'') <> '' OR coalesce(btrim(notes),'') <> '' OR promise_date IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_elimu_fin_followups_student ON elimu_fin_followups (business_id, student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_elimu_fin_plans_student ON elimu_fin_payment_plans (business_id, student_id, status);

-- plans/instalments: append-style. Only status/decision columns of a plan may change, and only forward from PENDING / ACTIVE.
CREATE OR REPLACE FUNCTION _elimu_fin_plan_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Payment plans are never deleted.' USING ERRCODE = '42501'; END IF;
  IF TG_TABLE_NAME = 'elimu_fin_payment_plans' THEN
    IF NEW.total_amount IS DISTINCT FROM OLD.total_amount OR NEW.student_id IS DISTINCT FROM OLD.student_id THEN RAISE EXCEPTION 'A plan''s total and student cannot change; reschedule instead.' USING ERRCODE = '42501'; END IF;
    IF OLD.status IN ('COMPLETED','CANCELLED','SUPERSEDED','REJECTED') THEN RAISE EXCEPTION 'A % plan cannot change.', lower(OLD.status) USING ERRCODE = '42501'; END IF;
    NEW.updated_at := now();
  ELSE
    RAISE EXCEPTION 'Instalments cannot be edited. Reschedule with a new plan.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_fin_plan_guard ON elimu_fin_payment_plans;
CREATE TRIGGER trg_elimu_fin_plan_guard BEFORE UPDATE OR DELETE ON elimu_fin_payment_plans FOR EACH ROW EXECUTE FUNCTION _elimu_fin_plan_guard();
DROP TRIGGER IF EXISTS trg_elimu_fin_inst_guard ON elimu_fin_installments;
CREATE TRIGGER trg_elimu_fin_inst_guard BEFORE UPDATE OR DELETE ON elimu_fin_installments FOR EACH ROW EXECUTE FUNCTION _elimu_fin_plan_guard();
-- the follow-up log is append-only too
DROP TRIGGER IF EXISTS trg_elimu_fin_followup_guard ON elimu_fin_followups;
CREATE TRIGGER trg_elimu_fin_followup_guard BEFORE UPDATE OR DELETE ON elimu_fin_followups FOR EACH ROW EXECUTE FUNCTION _elimu_fin_immutable();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['elimu_fin_payment_plans','elimu_fin_plan_invoices','elimu_fin_installments','elimu_fin_followups'] LOOP PERFORM _elimu_fin_secure(t, 'view'); END LOOP;
END $$;

-- ---------- propose a plan ----------
CREATE OR REPLACE FUNCTION elimu_fin_create_plan(p_business uuid, p_student uuid, p_invoice_ids uuid[], p_installments jsonb, p_reason text,
  p_name text DEFAULT 'Payment plan', p_supersedes uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s elimu_fin_students%ROWTYPE; v_owed numeric; v_sum numeric := 0; v_plan uuid; x jsonb; n int := 0; v_prev date := NULL; v_d date; v_a numeric; v_cnt int;
BEGIN
  PERFORM _elimu_fin_require('bill'); PERFORM _elimu_fin_tenant_of(p_business);
  IF length(btrim(coalesce(p_reason,''))) < 3 THEN RAISE EXCEPTION 'A reason is required.'; END IF;
  SELECT * INTO s FROM elimu_fin_students WHERE business_id = p_business AND student_id = p_student;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Student not found.'; END IF;
  IF p_invoice_ids IS NULL OR cardinality(p_invoice_ids) = 0 THEN RAISE EXCEPTION 'Choose the invoices the plan covers.'; END IF;
  SELECT count(*), coalesce(sum(outstanding),0) INTO v_cnt, v_owed FROM elimu_fin_invoices
   WHERE id = ANY (p_invoice_ids) AND business_id = p_business AND student_id = p_student AND status IN ('ISSUED','PARTIALLY_PAID');
  IF v_cnt <> cardinality(p_invoice_ids) THEN RAISE EXCEPTION 'Every covered invoice must be an open invoice of this student.'; END IF;
  IF v_owed <= 0 THEN RAISE EXCEPTION 'Nothing is outstanding on those invoices.'; END IF;
  IF jsonb_array_length(coalesce(p_installments,'[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'Add at least one instalment.'; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(p_installments) LOOP
    v_d := (x->>'due_date')::date; v_a := (x->>'amount')::numeric;
    IF v_a IS NULL OR v_a <= 0 OR v_a <> round(v_a,2) THEN RAISE EXCEPTION 'Every instalment needs an amount above zero (two decimals at most).'; END IF;
    IF v_d IS NULL THEN RAISE EXCEPTION 'Every instalment needs a due date.'; END IF;
    v_sum := v_sum + v_a;
  END LOOP;
  IF v_sum <> v_owed THEN RAISE EXCEPTION 'The instalments add up to KES % but KES % is outstanding on those invoices. They must match exactly.', v_sum, v_owed; END IF;
  IF EXISTS (SELECT 1 FROM elimu_fin_plan_invoices pi JOIN elimu_fin_payment_plans pp ON pp.id = pi.plan_id
              WHERE pi.invoice_id = ANY (p_invoice_ids) AND pp.status IN ('ACTIVE','PENDING_APPROVAL') AND pp.id IS DISTINCT FROM p_supersedes) THEN
    RAISE EXCEPTION 'One of those invoices is already on a plan. Reschedule that plan instead.'; END IF;
  INSERT INTO elimu_fin_payment_plans (tenant_id, business_id, student_id, name, total_amount, supersedes_plan_id, reason, requested_by, admission_no, student_name)
  VALUES (s.tenant_id, p_business, p_student, p_name, v_sum, p_supersedes, p_reason, _elimu_fin_staff(), s.admission_no, s.full_name) RETURNING id INTO v_plan;
  INSERT INTO elimu_fin_plan_invoices (plan_id, invoice_id, tenant_id, business_id) SELECT v_plan, unnest(p_invoice_ids), s.tenant_id, p_business;
  FOR x IN SELECT * FROM jsonb_array_elements(p_installments) ORDER BY (value->>'due_date')::date LOOP
    n := n + 1;
    INSERT INTO elimu_fin_installments (tenant_id, business_id, plan_id, seq, due_date, amount) VALUES (s.tenant_id, p_business, v_plan, n, (x->>'due_date')::date, (x->>'amount')::numeric);
  END LOOP;
  PERFORM _elimu_fin_audit('PAYMENT_ARRANGEMENT_REQUESTED', 'elimu_fin_payment_plans', v_plan, jsonb_build_object('new', jsonb_build_object('total', v_sum, 'installments', n, 'supersedes', p_supersedes), 'reason', p_reason));
  RETURN jsonb_build_object('ok', true, 'plan_id', v_plan, 'installments', n, 'total', v_sum);
END $$;

CREATE OR REPLACE FUNCTION elimu_fin_decide_plan(p_plan uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pl elimu_fin_payment_plans%ROWTYPE; v_owed numeric; v_set numeric;
BEGIN
  PERFORM _elimu_fin_require('approve');
  SELECT * INTO pl FROM elimu_fin_payment_plans WHERE id = p_plan AND tenant_id = get_current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found.'; END IF;
  IF pl.status <> 'PENDING_APPROVAL' THEN RAISE EXCEPTION 'This plan is already %.', lower(replace(pl.status,'_',' ')); END IF;
  IF NOT p_approve THEN
    IF length(btrim(coalesce(p_note,''))) < 3 THEN RAISE EXCEPTION 'Say why the plan is declined.'; END IF;
    UPDATE elimu_fin_payment_plans SET status = 'REJECTED', decided_by = _elimu_fin_staff(), decided_at = now(), decision_note = p_note WHERE id = pl.id;
    PERFORM _elimu_fin_audit('PAYMENT_ARRANGEMENT_REJECTED', 'elimu_fin_payment_plans', pl.id, jsonb_build_object('reason', p_note));
    RETURN jsonb_build_object('ok', true, 'status', 'REJECTED');
  END IF;
  PERFORM _elimu_fin_check_maker_checker(pl.requested_by, pl.business_id);
  SELECT coalesce(sum(i.outstanding),0), coalesce(sum(i.settled),0) INTO v_owed, v_set FROM elimu_fin_invoices i JOIN elimu_fin_plan_invoices pi ON pi.invoice_id = i.id
   WHERE pi.plan_id = pl.id AND i.status IN ('ISSUED','PARTIALLY_PAID','PAID');
  IF v_owed <> pl.total_amount THEN RAISE EXCEPTION 'The balance on the covered invoices changed (now KES %, plan KES %). Raise the plan again.', v_owed, pl.total_amount; END IF;
  IF pl.supersedes_plan_id IS NOT NULL THEN
    UPDATE elimu_fin_payment_plans SET status = 'SUPERSEDED', decision_note = coalesce(decision_note || E'\n','') || 'Rescheduled by a new plan' WHERE id = pl.supersedes_plan_id AND status = 'ACTIVE';
  END IF;
  UPDATE elimu_fin_payment_plans SET status = 'ACTIVE', baseline_settled = v_set, decided_by = _elimu_fin_staff(), decided_at = now(), decision_note = p_note WHERE id = pl.id;
  PERFORM _elimu_fin_audit('PAYMENT_ARRANGEMENT_APPROVED', 'elimu_fin_payment_plans', pl.id, jsonb_build_object('new', jsonb_build_object('total', pl.total_amount), 'approval', jsonb_build_object('requested_by', pl.requested_by, 'decided_by', _elimu_fin_staff(), 'note', p_note)));
  RETURN jsonb_build_object('ok', true, 'status', 'ACTIVE');
END $$;

CREATE OR REPLACE FUNCTION elimu_fin_cancel_plan(p_plan uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pl elimu_fin_payment_plans%ROWTYPE;
BEGIN
  PERFORM _elimu_fin_require('approve');
  IF length(btrim(coalesce(p_reason,''))) < 3 THEN RAISE EXCEPTION 'A reason is required.'; END IF;
  SELECT * INTO pl FROM elimu_fin_payment_plans WHERE id = p_plan AND tenant_id = get_current_tenant_id() FOR UPDATE;
  IF NOT FOUND OR pl.status NOT IN ('ACTIVE','PENDING_APPROVAL') THEN RAISE EXCEPTION 'Only a pending or active plan can be cancelled.'; END IF;
  UPDATE elimu_fin_payment_plans SET status = 'CANCELLED', decided_by = _elimu_fin_staff(), decided_at = now(), decision_note = p_reason WHERE id = pl.id;
  PERFORM _elimu_fin_audit('PAYMENT_ARRANGEMENT_AMENDED', 'elimu_fin_payment_plans', pl.id, jsonb_build_object('previous','ACTIVE','new','CANCELLED','reason',p_reason));
  RETURN jsonb_build_object('ok', true);
END $$;

-- ---------- instalment status, derived from the allocations (never stored) ----------
CREATE OR REPLACE FUNCTION elimu_fin_plan_status(p_plan uuid, p_as_of date DEFAULT NULL)
RETURNS TABLE (seq int, due_date date, amount numeric, paid numeric, remaining numeric, status text, days_overdue int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pl elimu_fin_payment_plans%ROWTYPE; v_paid_total numeric; v_today date := coalesce(p_as_of, _elimu_fin_today());
BEGIN
  PERFORM _elimu_fin_require('view');
  SELECT * INTO pl FROM elimu_fin_payment_plans WHERE id = p_plan AND tenant_id = get_current_tenant_id();
  IF NOT FOUND THEN RETURN; END IF;
  IF pl.status <> 'ACTIVE' AND pl.status <> 'COMPLETED' THEN v_paid_total := 0;
  ELSE
    SELECT greatest(coalesce(sum(i.settled),0) - coalesce(pl.baseline_settled,0), 0) INTO v_paid_total
      FROM elimu_fin_invoices i JOIN elimu_fin_plan_invoices pi ON pi.invoice_id = i.id WHERE pi.plan_id = pl.id AND i.status <> 'CANCELLED';
  END IF;
  RETURN QUERY
    SELECT q.seq, q.due_date, q.amount, q.paid, q.amount - q.paid,
           CASE WHEN q.paid >= q.amount THEN 'PAID' WHEN q.due_date < v_today THEN 'OVERDUE' WHEN q.paid > 0 THEN 'PART_PAID' ELSE 'UPCOMING' END,
           CASE WHEN q.paid < q.amount AND q.due_date < v_today THEN (v_today - q.due_date) ELSE 0 END
      FROM (SELECT n.seq, n.due_date, n.amount,
                   least(n.amount, greatest(v_paid_total - coalesce(sum(n.amount) OVER (ORDER BY n.seq ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0), 0)) AS paid
              FROM elimu_fin_installments n WHERE n.plan_id = pl.id) q
     ORDER BY q.seq;
END $$;

-- ---------- follow-ups ----------
CREATE OR REPLACE FUNCTION elimu_fin_record_followup(p_business uuid, p_student uuid, p_action text, p_outcome text DEFAULT NULL, p_notes text DEFAULT NULL,
  p_invoice uuid DEFAULT NULL, p_promise_date date DEFAULT NULL, p_promise_amount numeric DEFAULT NULL, p_next_action date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t uuid; v_id uuid;
BEGIN
  IF NOT (elimu_fin_can('bill') OR elimu_fin_can('collect')) THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  v_t := _elimu_fin_tenant_of(p_business);
  IF NOT EXISTS (SELECT 1 FROM elimu_fin_students WHERE business_id = p_business AND student_id = p_student) THEN RAISE EXCEPTION 'Student not found.'; END IF;
  IF p_invoice IS NOT NULL AND NOT EXISTS (SELECT 1 FROM elimu_fin_invoices WHERE id = p_invoice AND business_id = p_business AND student_id = p_student) THEN RAISE EXCEPTION 'That invoice is not this student''s.'; END IF;
  INSERT INTO elimu_fin_followups (tenant_id, business_id, student_id, invoice_id, action_type, outcome, notes, promise_date, promise_amount, next_action_date, created_by)
  VALUES (v_t, p_business, p_student, p_invoice, upper(p_action), p_outcome, p_notes, p_promise_date, p_promise_amount, p_next_action, _elimu_fin_staff()) RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'followup_id', v_id);
END $$;

REVOKE ALL ON FUNCTION _elimu_fin_plan_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION elimu_fin_create_plan(uuid,uuid,uuid[],jsonb,text,text,uuid), elimu_fin_decide_plan(uuid,boolean,text), elimu_fin_cancel_plan(uuid,text),
  elimu_fin_plan_status(uuid,date), elimu_fin_record_followup(uuid,uuid,text,text,text,uuid,date,numeric,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION elimu_fin_create_plan(uuid,uuid,uuid[],jsonb,text,text,uuid), elimu_fin_decide_plan(uuid,boolean,text), elimu_fin_cancel_plan(uuid,text),
  elimu_fin_plan_status(uuid,date), elimu_fin_record_followup(uuid,uuid,text,text,text,uuid,date,numeric,date) TO authenticated;
