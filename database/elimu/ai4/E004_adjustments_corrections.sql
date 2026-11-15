-- ============================================================================
-- ELIMU FINANCE  E004  Adjustments (discounts, scholarships, bursaries, credit notes, write-offs), standing awards,
--                      and controlled corrections (payment reversal, adjustment reversal, refund).
-- RULES ENFORCED HERE (not in the UI):
--   * Nobody applies an adjustment alone: request -> a DIFFERENT approver decides (owner may self-approve only if the school enabled it).
--   * A confirmed transaction is NEVER deleted or edited. Corrections are new ledger rows that point at the original.
--   * Non-cash adjustments (discount, scholarship, credit note, write-off) can never exceed what is owed. Only a bursary RECEIVED
--     (real money from a sponsor) or an opening credit may leave the student with credit.
-- Requires E001-E003. Re-runnable.
-- ============================================================================

-- ---------- standing awards (a scholarship / bursary the school has agreed) ----------
CREATE TABLE IF NOT EXISTS elimu_fin_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  student_id uuid NOT NULL,
  award_type text NOT NULL CHECK (award_type IN ('SCHOLARSHIP','BURSARY')),
  sponsor_type text NOT NULL CHECK (sponsor_type IN ('NONE','GOVERNMENT','COUNTY','NGO','INDIVIDUAL','SCHOOL')),
  sponsor_name text,
  coverage text NOT NULL CHECK (coverage IN ('FULL','PARTIAL')),
  value_type text NOT NULL CHECK (value_type IN ('PERCENT','FIXED')),
  value numeric(15,4) NOT NULL CHECK (value > 0),
  CONSTRAINT elimu_fin_award_pct CHECK (value_type <> 'PERCENT' OR value <= 100),
  CONSTRAINT elimu_fin_award_full CHECK (coverage <> 'FULL' OR (value_type = 'PERCENT' AND value = 100)),
  scope text NOT NULL CHECK (scope IN ('TERM','ANNUAL')),
  academic_year text NOT NULL, period_id uuid REFERENCES elimu_fin_periods(id),
  CONSTRAINT elimu_fin_award_term_period CHECK (scope <> 'TERM' OR period_id IS NOT NULL),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ENDED','CANCELLED')),
  approved_by uuid NOT NULL, approved_at timestamptz NOT NULL DEFAULT now(), approval_note text,
  supporting_document_url text, notes text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, student_id) REFERENCES elimu_fin_students (business_id, student_id)
);

-- ---------- adjustments ----------
CREATE TABLE IF NOT EXISTS elimu_fin_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  student_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('DISCOUNT','SCHOLARSHIP','BURSARY','CREDIT_NOTE','WRITE_OFF','OPENING_CREDIT')),
  subtype text,                                               -- SIBLING, STAFF_CHILD, EARLY_PAYMENT, GOVERNMENT, COUNTY, NGO, INDIVIDUAL, SCHOOL, FULL, PARTIAL, OTHER
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  percent numeric(7,4) CHECK (percent IS NULL OR (percent > 0 AND percent <= 100)),
  period_id uuid REFERENCES elimu_fin_periods(id),
  target_invoice_id uuid REFERENCES elimu_fin_invoices(id),
  award_id uuid REFERENCES elimu_fin_awards(id),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  sponsor_name text, sponsor_reference text, supporting_document_url text,
  status text NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN ('PENDING_APPROVAL','APPLIED','REJECTED','CANCELLED','REVERSED')),
  requested_by uuid, requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid, decided_at timestamptz, decision_note text,
  applied_at timestamptz, ledger_entry_id uuid,
  admission_no text NOT NULL, student_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, student_id) REFERENCES elimu_fin_students (business_id, student_id),
  CONSTRAINT elimu_fin_adj_applied CHECK (status <> 'APPLIED' OR (decided_by IS NOT NULL AND applied_at IS NOT NULL AND ledger_entry_id IS NOT NULL))
);
-- an award can be applied to a given invoice once
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_fin_adj_award_invoice ON elimu_fin_adjustments (award_id, target_invoice_id)
  WHERE award_id IS NOT NULL AND status IN ('PENDING_APPROVAL','APPLIED');
CREATE INDEX IF NOT EXISTS idx_elimu_fin_adj_student ON elimu_fin_adjustments (business_id, student_id, status);
CREATE INDEX IF NOT EXISTS idx_elimu_fin_adj_pending ON elimu_fin_adjustments (business_id, requested_at) WHERE status = 'PENDING_APPROVAL';

CREATE OR REPLACE FUNCTION _elimu_fin_adj_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Adjustments are never deleted. Reverse the adjustment instead.' USING ERRCODE = '42501'; END IF;
  IF NEW.amount IS DISTINCT FROM OLD.amount OR NEW.student_id IS DISTINCT FROM OLD.student_id OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'An adjustment''s amount, student and kind cannot be edited.' USING ERRCODE = '42501'; END IF;
  IF OLD.status IN ('REJECTED','CANCELLED','REVERSED') THEN RAISE EXCEPTION 'A % adjustment cannot change.', lower(OLD.status) USING ERRCODE = '42501'; END IF;
  IF OLD.status = 'APPLIED' AND NEW.status NOT IN ('APPLIED','REVERSED') THEN RAISE EXCEPTION 'An applied adjustment can only be reversed.' USING ERRCODE = '42501'; END IF;
  NEW.updated_at := now(); RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_fin_adj_guard ON elimu_fin_adjustments;
CREATE TRIGGER trg_elimu_fin_adj_guard BEFORE UPDATE OR DELETE ON elimu_fin_adjustments FOR EACH ROW EXECUTE FUNCTION _elimu_fin_adj_guard();

-- ---------- corrections: reversal / refund requests with an approval trail ----------
CREATE TABLE IF NOT EXISTS elimu_fin_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  student_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('PAYMENT_REVERSAL','ADJUSTMENT_REVERSAL','REFUND')),
  original_type text CHECK (original_type IN ('PAYMENT','ADJUSTMENT')),
  original_id uuid,                                            -- NULL for REFUND (refund draws on the student's credit)
  original_ref text,                                           -- receipt no. / adjustment ref shown to people
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  refund_method text CHECK (refund_method IS NULL OR refund_method IN ('CASH','MPESA','BANK','CHEQUE')),
  refund_reference text, refund_payee text,
  status text NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN ('PENDING_APPROVAL','COMPLETED','REJECTED','CANCELLED')),
  requested_by uuid, requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid, decided_at timestamptz, decision_note text,
  ledger_entry_id uuid, detail jsonb,
  session_id uuid,                                             -- cashier session a CASH refund came out of
  admission_no text NOT NULL, student_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, student_id) REFERENCES elimu_fin_students (business_id, student_id),
  CONSTRAINT elimu_fin_corr_shape CHECK ((kind = 'REFUND' AND original_id IS NULL AND refund_method IS NOT NULL) OR (kind <> 'REFUND' AND original_id IS NOT NULL)),
  CONSTRAINT elimu_fin_corr_done CHECK (status <> 'COMPLETED' OR (decided_by IS NOT NULL OR decided_at IS NOT NULL))
);
-- one live correction per original transaction
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_fin_corr_original ON elimu_fin_corrections (original_type, original_id)
  WHERE original_id IS NOT NULL AND status IN ('PENDING_APPROVAL','COMPLETED');
CREATE INDEX IF NOT EXISTS idx_elimu_fin_corr_pending ON elimu_fin_corrections (business_id, requested_at) WHERE status = 'PENDING_APPROVAL';

CREATE OR REPLACE FUNCTION _elimu_fin_corr_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Corrections are never deleted.' USING ERRCODE = '42501'; END IF;
  IF OLD.status <> 'PENDING_APPROVAL' THEN RAISE EXCEPTION 'A decided correction cannot change.' USING ERRCODE = '42501'; END IF;
  IF NEW.amount IS DISTINCT FROM OLD.amount OR NEW.original_id IS DISTINCT FROM OLD.original_id OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'A correction request cannot be edited; cancel it and raise a new one.' USING ERRCODE = '42501'; END IF;
  NEW.updated_at := now(); RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_fin_corr_guard ON elimu_fin_corrections;
CREATE TRIGGER trg_elimu_fin_corr_guard BEFORE UPDATE OR DELETE ON elimu_fin_corrections FOR EACH ROW EXECUTE FUNCTION _elimu_fin_corr_guard();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['elimu_fin_awards','elimu_fin_adjustments','elimu_fin_corrections'] LOOP PERFORM _elimu_fin_secure(t, 'view'); END LOOP;
END $$;

-- ---------- maker-checker ----------
CREATE OR REPLACE FUNCTION _elimu_fin_check_maker_checker(p_requested_by uuid, p_business uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE st elimu_fin_settings%ROWTYPE;
BEGIN
  IF NOT is_pos_session() THEN RETURN; END IF;
  IF p_requested_by IS NOT DISTINCT FROM _elimu_fin_staff() THEN
    st := _elimu_fin_settings(p_business);
    IF NOT (is_pos_owner() AND st.allow_self_approval) THEN
      RAISE EXCEPTION 'A different authorised person must approve a request you made.' USING ERRCODE = '42501';
    END IF;
  END IF;
END $$;

-- ---------- applying an approved adjustment (ledger + GL + allocation + audit) ----------
CREATE OR REPLACE FUNCTION _elimu_fin_apply_adjustment(p_adj uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a elimu_fin_adjustments%ROWTYPE; v_owed numeric; v_inv elimu_fin_invoices%ROWTYPE; v_entry uuid; v_ltype text; v_debit_key text; st elimu_fin_settings%ROWTYPE;
BEGIN
  SELECT * INTO a FROM elimu_fin_adjustments WHERE id = p_adj FOR UPDATE;
  IF a.status = 'APPLIED' THEN RETURN; END IF;                -- never twice
  IF a.kind NOT IN ('BURSARY','OPENING_CREDIT') THEN
    IF a.target_invoice_id IS NOT NULL THEN
      SELECT * INTO v_inv FROM elimu_fin_invoices WHERE id = a.target_invoice_id FOR UPDATE;
      IF v_inv.status = 'CANCELLED' THEN RAISE EXCEPTION 'The invoice for this adjustment has been cancelled.'; END IF;
      v_owed := v_inv.outstanding;
    ELSE
      SELECT coalesce(sum(outstanding),0) INTO v_owed FROM elimu_fin_invoices WHERE business_id = a.business_id AND student_id = a.student_id AND status IN ('ISSUED','PARTIALLY_PAID');
    END IF;
    IF a.amount > v_owed THEN
      RAISE EXCEPTION 'A % of KES % is more than the KES % owed. It cannot create credit.', lower(replace(a.kind,'_',' ')), a.amount, v_owed;
    END IF;
  END IF;
  v_ltype := CASE a.kind WHEN 'DISCOUNT' THEN 'DISCOUNT' WHEN 'SCHOLARSHIP' THEN 'SCHOLARSHIP' WHEN 'BURSARY' THEN 'BURSARY'
                         WHEN 'CREDIT_NOTE' THEN 'CREDIT_NOTE' WHEN 'WRITE_OFF' THEN 'WRITE_OFF' ELSE 'OPENING_CREDIT' END;
  v_entry := _elimu_fin_ledger_post(a.business_id, a.student_id, v_ltype, -a.amount, _elimu_fin_today(),
    initcap(replace(lower(a.kind),'_',' ')) || ': ' || a.reason, 'ADJUSTMENT', a.id, a.target_invoice_id);
  UPDATE elimu_fin_adjustments SET status = 'APPLIED', applied_at = now(), ledger_entry_id = v_entry WHERE id = a.id;
  v_debit_key := CASE a.kind WHEN 'DISCOUNT' THEN 'DISCOUNT_ALLOWED' WHEN 'SCHOLARSHIP' THEN 'SCHOLARSHIP_EXPENSE' WHEN 'BURSARY' THEN 'BURSARY_RECEIVABLE'
                             WHEN 'CREDIT_NOTE' THEN 'FEE_INCOME' WHEN 'WRITE_OFF' THEN 'BAD_DEBT_EXPENSE' ELSE 'OPENING_BALANCE_EQUITY' END;
  PERFORM _elimu_fin_gl('ADJUSTMENT_APPLIED', 'ADJUSTMENT', a.id, _elimu_fin_today(),
    jsonb_build_array(jsonb_build_object('account_key', v_debit_key, 'debit', a.amount, 'credit', 0),
                      jsonb_build_object('account_key', 'STUDENT_CREDIT_LIABILITY', 'debit', 0, 'credit', a.amount)), a.business_id);
  -- allocation: a targeted adjustment settles its own invoice whatever the policy; otherwise policy decides
  IF a.target_invoice_id IS NOT NULL THEN
    PERFORM _elimu_fin_allocate_one('ADJUSTMENT', a.id, a.target_invoice_id, least(a.amount, (SELECT outstanding FROM elimu_fin_invoices WHERE id = a.target_invoice_id)), 'AUTO', 'TARGETED');
  ELSE
    st := _elimu_fin_settings(a.business_id);
    IF st.allocation_policy <> 'MANUAL_ONLY' THEN PERFORM _elimu_fin_allocate_student(a.business_id, a.student_id, a.id); END IF;
  END IF;
  PERFORM _elimu_fin_audit(CASE a.kind WHEN 'DISCOUNT' THEN 'DISCOUNT_GRANTED' WHEN 'SCHOLARSHIP' THEN 'SCHOLARSHIP_AWARDED' WHEN 'BURSARY' THEN 'BURSARY_RECORDED' ELSE 'ADJUSTMENT_APPLIED' END,
    'elimu_fin_adjustments', a.id, jsonb_build_object('new', jsonb_build_object('kind', a.kind, 'amount', a.amount, 'student_id', a.student_id, 'subtype', a.subtype, 'target_invoice_id', a.target_invoice_id),
      'reason', a.reason, 'approval', jsonb_build_object('requested_by', a.requested_by, 'decided_by', _elimu_fin_staff(), 'note', a.decision_note)));
END $$;

-- ---------- request an adjustment ----------
CREATE OR REPLACE FUNCTION elimu_fin_request_adjustment(
  p_business uuid, p_student uuid, p_kind text, p_amount numeric, p_reason text,
  p_subtype text DEFAULT NULL, p_percent numeric DEFAULT NULL, p_target_invoice uuid DEFAULT NULL, p_period uuid DEFAULT NULL,
  p_sponsor_name text DEFAULT NULL, p_sponsor_reference text DEFAULT NULL, p_document_url text DEFAULT NULL, p_award uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s elimu_fin_students%ROWTYPE; adj elimu_fin_adjustments%ROWTYPE; v_kind text := upper(p_kind); v_amt numeric := p_amount; inv elimu_fin_invoices%ROWTYPE;
BEGIN
  IF NOT (elimu_fin_can('collect') OR elimu_fin_can('bill')) THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  PERFORM _elimu_fin_tenant_of(p_business);
  IF v_kind NOT IN ('DISCOUNT','SCHOLARSHIP','BURSARY','CREDIT_NOTE','WRITE_OFF') THEN RAISE EXCEPTION 'Unknown adjustment type.'; END IF;
  IF length(btrim(coalesce(p_reason,''))) < 3 THEN RAISE EXCEPTION 'A reason is required.'; END IF;
  SELECT * INTO s FROM elimu_fin_students WHERE business_id = p_business AND student_id = p_student;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Student not found.'; END IF;
  IF p_target_invoice IS NOT NULL THEN
    SELECT * INTO inv FROM elimu_fin_invoices WHERE id = p_target_invoice AND business_id = p_business AND student_id = p_student;
    IF NOT FOUND THEN RAISE EXCEPTION 'That invoice does not belong to this student.'; END IF;
  END IF;
  IF p_percent IS NOT NULL THEN
    IF p_target_invoice IS NULL THEN RAISE EXCEPTION 'A percentage needs the invoice it applies to.'; END IF;
    v_amt := round(inv.total * p_percent / 100, 2);
  END IF;
  IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'The amount must be above zero.'; END IF;
  IF v_amt <> round(v_amt,2) THEN RAISE EXCEPTION 'The amount can have at most two decimal places.'; END IF;
  IF v_kind = 'BURSARY' AND p_sponsor_name IS NULL THEN RAISE EXCEPTION 'Name the sponsor of the bursary.'; END IF;
  INSERT INTO elimu_fin_adjustments (tenant_id, business_id, student_id, kind, subtype, amount, percent, period_id, target_invoice_id, award_id, reason,
      sponsor_name, sponsor_reference, supporting_document_url, requested_by, admission_no, student_name)
  VALUES (s.tenant_id, p_business, p_student, v_kind, p_subtype, v_amt, p_percent, coalesce(p_period, inv.period_id), p_target_invoice, p_award, p_reason,
      p_sponsor_name, p_sponsor_reference, p_document_url, _elimu_fin_staff(), s.admission_no, s.full_name)
  RETURNING * INTO adj;
  PERFORM _elimu_fin_audit('ADJUSTMENT_REQUESTED', 'elimu_fin_adjustments', adj.id, jsonb_build_object('new', jsonb_build_object('kind', v_kind, 'amount', v_amt, 'student_id', p_student), 'reason', p_reason));
  RETURN jsonb_build_object('ok', true, 'adjustment_id', adj.id, 'amount', v_amt, 'status', adj.status);
END $$;

CREATE OR REPLACE FUNCTION elimu_fin_decide_adjustment(p_adjustment uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a elimu_fin_adjustments%ROWTYPE;
BEGIN
  PERFORM _elimu_fin_require('approve');
  SELECT * INTO a FROM elimu_fin_adjustments WHERE id = p_adjustment AND tenant_id = get_current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Adjustment not found.'; END IF;
  IF a.status <> 'PENDING_APPROVAL' THEN RAISE EXCEPTION 'This adjustment is already %.', lower(replace(a.status,'_',' ')); END IF;
  IF NOT p_approve AND length(btrim(coalesce(p_note,''))) < 3 THEN RAISE EXCEPTION 'Say why the adjustment is declined.'; END IF;
  IF p_approve THEN PERFORM _elimu_fin_check_maker_checker(a.requested_by, a.business_id); END IF;
  UPDATE elimu_fin_adjustments SET decided_by = _elimu_fin_staff(), decided_at = now(), decision_note = p_note,
         status = CASE WHEN p_approve THEN 'PENDING_APPROVAL' ELSE 'REJECTED' END WHERE id = a.id;
  IF p_approve THEN PERFORM _elimu_fin_apply_adjustment(a.id); ELSE
    PERFORM _elimu_fin_audit('ADJUSTMENT_REJECTED', 'elimu_fin_adjustments', a.id, jsonb_build_object('reason', p_note));
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', (SELECT status FROM elimu_fin_adjustments WHERE id = a.id));
END $$;

CREATE OR REPLACE FUNCTION elimu_fin_cancel_adjustment_request(p_adjustment uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a elimu_fin_adjustments%ROWTYPE;
BEGIN
  SELECT * INTO a FROM elimu_fin_adjustments WHERE id = p_adjustment AND tenant_id = get_current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Adjustment not found.'; END IF;
  IF a.status <> 'PENDING_APPROVAL' THEN RAISE EXCEPTION 'Only a pending request can be withdrawn.'; END IF;
  IF a.requested_by IS DISTINCT FROM _elimu_fin_staff() AND NOT elimu_fin_can('approve') THEN RAISE EXCEPTION 'Only the requester or an approver can withdraw this.' USING ERRCODE = '42501'; END IF;
  UPDATE elimu_fin_adjustments SET status = 'CANCELLED', decision_note = p_reason, decided_by = _elimu_fin_staff(), decided_at = now() WHERE id = a.id;
  PERFORM _elimu_fin_audit('ADJUSTMENT_WITHDRAWN', 'elimu_fin_adjustments', a.id, jsonb_build_object('reason', p_reason));
  RETURN jsonb_build_object('ok', true);
END $$;

-- ---------- opening credit (family has already overpaid when the school starts) ----------
CREATE OR REPLACE FUNCTION elimu_fin_add_opening_credit(p_business uuid, p_student uuid, p_amount numeric, p_reason text DEFAULT 'Credit brought forward')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s elimu_fin_students%ROWTYPE; adj elimu_fin_adjustments%ROWTYPE;
BEGIN
  PERFORM _elimu_fin_require('approve'); PERFORM _elimu_fin_tenant_of(p_business);
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'The credit must be above zero.'; END IF;
  SELECT * INTO s FROM elimu_fin_students WHERE business_id = p_business AND student_id = p_student;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Student not found.'; END IF;
  INSERT INTO elimu_fin_adjustments (tenant_id, business_id, student_id, kind, subtype, amount, reason, status, requested_by, decided_by, decided_at, decision_note, admission_no, student_name)
  VALUES (s.tenant_id, p_business, p_student, 'OPENING_CREDIT', 'OTHER', p_amount, p_reason, 'PENDING_APPROVAL', _elimu_fin_staff(), _elimu_fin_staff(), now(), 'Opening credit', s.admission_no, s.full_name)
  RETURNING * INTO adj;
  PERFORM _elimu_fin_apply_adjustment(adj.id);
  RETURN jsonb_build_object('ok', true, 'adjustment_id', adj.id);
END $$;

-- ---------- standing awards ----------
CREATE OR REPLACE FUNCTION elimu_fin_create_award(p_business uuid, p_student uuid, p_type text, p_sponsor_type text, p_sponsor_name text, p_coverage text,
  p_value_type text, p_value numeric, p_scope text, p_academic_year text, p_period uuid DEFAULT NULL, p_document_url text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_t uuid;
BEGIN
  PERFORM _elimu_fin_require('approve'); v_t := _elimu_fin_tenant_of(p_business);
  IF NOT EXISTS (SELECT 1 FROM elimu_fin_students WHERE business_id = p_business AND student_id = p_student) THEN RAISE EXCEPTION 'Student not found.'; END IF;
  INSERT INTO elimu_fin_awards (tenant_id, business_id, student_id, award_type, sponsor_type, sponsor_name, coverage, value_type, value, scope, academic_year, period_id,
      approved_by, approval_note, supporting_document_url, created_by)
  VALUES (v_t, p_business, p_student, upper(p_type), upper(p_sponsor_type), p_sponsor_name, upper(p_coverage), upper(p_value_type), p_value, upper(p_scope), p_academic_year, p_period,
      coalesce(_elimu_fin_staff(), '00000000-0000-0000-0000-000000000000'::uuid), p_note, p_document_url, _elimu_fin_staff())
  RETURNING id INTO v_id;
  PERFORM _elimu_fin_audit('AWARD_CREATED', 'elimu_fin_awards', v_id, jsonb_build_object('new', jsonb_build_object('type', p_type, 'coverage', p_coverage, 'value', p_value, 'student_id', p_student), 'reason', p_note));
  RETURN jsonb_build_object('ok', true, 'award_id', v_id);
END $$;

-- apply an approved award to one invoice (the award itself carries the approval; this is not a fresh request)
CREATE OR REPLACE FUNCTION elimu_fin_apply_award(p_award uuid, p_invoice uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE aw elimu_fin_awards%ROWTYPE; inv elimu_fin_invoices%ROWTYPE; s elimu_fin_students%ROWTYPE; adj_id uuid; v_amt numeric;
BEGIN
  PERFORM _elimu_fin_require('bill');
  SELECT * INTO aw FROM elimu_fin_awards WHERE id = p_award AND tenant_id = get_current_tenant_id();
  IF NOT FOUND OR aw.status <> 'ACTIVE' THEN RAISE EXCEPTION 'That award is not active.'; END IF;
  SELECT * INTO inv FROM elimu_fin_invoices WHERE id = p_invoice AND business_id = aw.business_id AND student_id = aw.student_id FOR UPDATE;
  IF NOT FOUND OR inv.status = 'CANCELLED' THEN RAISE EXCEPTION 'That invoice does not belong to the award holder.'; END IF;
  IF inv.academic_year IS DISTINCT FROM aw.academic_year OR (aw.scope = 'TERM' AND inv.period_id IS DISTINCT FROM aw.period_id) THEN
    RAISE EXCEPTION 'This award does not cover that invoice''s period.'; END IF;
  IF inv.kind = 'OPENING_BALANCE' THEN RAISE EXCEPTION 'An award is not applied to a balance brought forward.'; END IF;
  v_amt := CASE aw.value_type WHEN 'PERCENT' THEN round(inv.total * aw.value / 100, 2) ELSE least(aw.value, inv.total) END;
  v_amt := least(v_amt, inv.outstanding);
  IF v_amt <= 0 THEN RAISE EXCEPTION 'Nothing is outstanding on that invoice for the award to cover.'; END IF;
  SELECT * INTO s FROM elimu_fin_students WHERE business_id = aw.business_id AND student_id = aw.student_id;
  INSERT INTO elimu_fin_adjustments (tenant_id, business_id, student_id, kind, subtype, amount, period_id, target_invoice_id, award_id, reason, sponsor_name,
      status, requested_by, decided_by, decided_at, decision_note, admission_no, student_name)
  VALUES (aw.tenant_id, aw.business_id, aw.student_id, aw.award_type, aw.sponsor_type, v_amt, inv.period_id, inv.id, aw.id,
      initcap(lower(aw.award_type)) || ' award ' || aw.coverage || coalesce(' - ' || aw.sponsor_name, ''), aw.sponsor_name,
      'PENDING_APPROVAL', _elimu_fin_staff(), aw.approved_by, now(), 'Per approved award', s.admission_no, s.full_name)
  RETURNING id INTO adj_id;
  PERFORM _elimu_fin_apply_adjustment(adj_id);
  RETURN jsonb_build_object('ok', true, 'adjustment_id', adj_id, 'amount', v_amt);
END $$;

-- ============================ corrections ============================
CREATE OR REPLACE FUNCTION elimu_fin_credit_available(p_business uuid, p_student uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  -- money the school is holding for the student that can legitimately go back out: free CONFIRMED payment funds, capped by the credit balance
  SELECT greatest(0, least(
    coalesce((SELECT sum(p.amount - p.refunded - p.allocated) FROM elimu_fin_payments p
               WHERE p.business_id = p_business AND p.student_id = p_student AND p.status = 'CONFIRMED' AND p.tenant_id = get_current_tenant_id()), 0),
    coalesce((SELECT -a.balance FROM elimu_fin_accounts a WHERE a.business_id = p_business AND a.student_id = p_student AND a.tenant_id = get_current_tenant_id()), 0)))
$$;

CREATE OR REPLACE FUNCTION elimu_fin_request_correction(
  p_business uuid, p_kind text, p_original_id uuid, p_reason text,
  p_student uuid DEFAULT NULL, p_amount numeric DEFAULT NULL, p_refund_method text DEFAULT NULL, p_refund_reference text DEFAULT NULL, p_refund_payee text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_kind text := upper(p_kind); pay elimu_fin_payments%ROWTYPE; adj elimu_fin_adjustments%ROWTYPE; s elimu_fin_students%ROWTYPE; v_id uuid; v_amt numeric; v_ref text; v_avail numeric;
BEGIN
  IF NOT (elimu_fin_can('collect') OR elimu_fin_can('bill')) THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  PERFORM _elimu_fin_tenant_of(p_business);
  IF length(btrim(coalesce(p_reason,''))) < 3 THEN RAISE EXCEPTION 'A reason is required.'; END IF;
  IF v_kind = 'PAYMENT_REVERSAL' THEN
    SELECT * INTO pay FROM elimu_fin_payments WHERE id = p_original_id AND business_id = p_business;
    IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;
    IF pay.status <> 'CONFIRMED' THEN RAISE EXCEPTION 'Only a confirmed payment can be reversed (this one is %).', lower(pay.status); END IF;
    IF pay.refunded > 0 THEN RAISE EXCEPTION 'KES % of this payment has already been refunded; it cannot be reversed.', pay.refunded; END IF;
    v_amt := pay.amount; v_ref := pay.receipt_no; p_student := pay.student_id;
  ELSIF v_kind = 'ADJUSTMENT_REVERSAL' THEN
    SELECT * INTO adj FROM elimu_fin_adjustments WHERE id = p_original_id AND business_id = p_business;
    IF NOT FOUND THEN RAISE EXCEPTION 'Adjustment not found.'; END IF;
    IF adj.status <> 'APPLIED' THEN RAISE EXCEPTION 'Only an applied adjustment can be reversed.'; END IF;
    v_amt := adj.amount; v_ref := initcap(lower(adj.kind)); p_student := adj.student_id;
  ELSIF v_kind = 'REFUND' THEN
    IF p_student IS NULL THEN RAISE EXCEPTION 'Choose the student.'; END IF;
    IF upper(p_refund_method) NOT IN ('CASH','MPESA','BANK','CHEQUE') THEN RAISE EXCEPTION 'Choose how the refund will be paid.'; END IF;
    v_avail := elimu_fin_credit_available(p_business, p_student);
    v_amt := p_amount;
    IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'The refund amount must be above zero.'; END IF;
    IF v_amt <> round(v_amt,2) THEN RAISE EXCEPTION 'The amount can have at most two decimal places.'; END IF;
    IF v_amt > v_avail THEN RAISE EXCEPTION 'Only KES % of credit is available to refund (asked KES %).', v_avail, v_amt; END IF;
    v_ref := 'Refund';
  ELSE RAISE EXCEPTION 'Unknown correction type.'; END IF;
  SELECT * INTO s FROM elimu_fin_students WHERE business_id = p_business AND student_id = p_student;
  INSERT INTO elimu_fin_corrections (tenant_id, business_id, student_id, kind, original_type, original_id, original_ref, amount, reason, refund_method, refund_reference, refund_payee,
      requested_by, admission_no, student_name)
  VALUES (s.tenant_id, p_business, p_student, v_kind, CASE v_kind WHEN 'PAYMENT_REVERSAL' THEN 'PAYMENT' WHEN 'ADJUSTMENT_REVERSAL' THEN 'ADJUSTMENT' END,
      CASE WHEN v_kind = 'REFUND' THEN NULL ELSE p_original_id END, v_ref, v_amt, p_reason, upper(p_refund_method), p_refund_reference, p_refund_payee,
      _elimu_fin_staff(), s.admission_no, s.full_name)
  RETURNING id INTO v_id;
  PERFORM _elimu_fin_audit('CORRECTION_REQUESTED', 'elimu_fin_corrections', v_id, jsonb_build_object('new', jsonb_build_object('kind', v_kind, 'amount', v_amt, 'original', v_ref), 'reason', p_reason));
  RETURN jsonb_build_object('ok', true, 'correction_id', v_id, 'amount', v_amt);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'A correction for that transaction is already pending or done.' USING ERRCODE = '23505';
END $$;

CREATE OR REPLACE FUNCTION elimu_fin_decide_correction(p_correction uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c elimu_fin_corrections%ROWTYPE; pay elimu_fin_payments%ROWTYPE; adj elimu_fin_adjustments%ROWTYPE; v_orig_entry uuid; v_entry uuid; v_released numeric;
  p record; v_need numeric; v_take numeric; v_detail jsonb := '[]'::jsonb; v_cash_key text; v_sess uuid;
BEGIN
  PERFORM _elimu_fin_require('approve');
  SELECT * INTO c FROM elimu_fin_corrections WHERE id = p_correction AND tenant_id = get_current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Correction not found.'; END IF;
  IF c.status <> 'PENDING_APPROVAL' THEN RAISE EXCEPTION 'This request is already %.', lower(replace(c.status,'_',' ')); END IF;
  IF NOT p_approve THEN
    IF length(btrim(coalesce(p_note,''))) < 3 THEN RAISE EXCEPTION 'Say why this is declined.'; END IF;
    UPDATE elimu_fin_corrections SET status = 'REJECTED', decided_by = _elimu_fin_staff(), decided_at = now(), decision_note = p_note WHERE id = c.id;
    PERFORM _elimu_fin_audit('CORRECTION_REJECTED', 'elimu_fin_corrections', c.id, jsonb_build_object('reason', p_note));
    RETURN jsonb_build_object('ok', true, 'status', 'REJECTED');
  END IF;
  PERFORM _elimu_fin_check_maker_checker(c.requested_by, c.business_id);

  IF c.kind = 'PAYMENT_REVERSAL' THEN
    SELECT * INTO pay FROM elimu_fin_payments WHERE id = c.original_id FOR UPDATE;
    IF pay.status <> 'CONFIRMED' THEN RAISE EXCEPTION 'That payment is no longer confirmed.'; END IF;
    IF pay.refunded > 0 THEN RAISE EXCEPTION 'That payment has been partly refunded; it cannot be reversed.'; END IF;
    v_released := 0;
    -- 1) undo the matching (money returns to credit), 2) reverse the receipt in the ledger, 3) mark the original REVERSED (never deleted)
    SELECT coalesce(sum(_elimu_fin_release_one(id, 'PAYMENT_REVERSED: ' || c.reason)), 0) INTO v_released
      FROM elimu_fin_allocations WHERE source_type = 'PAYMENT' AND source_id = pay.id AND released_at IS NULL;
    SELECT id INTO v_orig_entry FROM elimu_fin_ledger WHERE source_type = 'PAYMENT' AND source_id = pay.id AND entry_type = 'PAYMENT';
    v_entry := _elimu_fin_ledger_post(pay.business_id, pay.student_id, 'REVERSAL', pay.amount, _elimu_fin_today(),
      'Reversal of receipt ' || pay.receipt_no || ': ' || c.reason, 'CORRECTION', c.id, NULL, v_orig_entry);
    UPDATE elimu_fin_payments SET status = 'REVERSED', notes = coalesce(notes || E'\n','') || 'Reversed: ' || c.reason WHERE id = pay.id;
    IF pay.c2b_id IS NOT NULL THEN PERFORM _elimu_fin_return_c2b(pay.c2b_id, pay.amount); END IF;
    v_cash_key := CASE pay.method WHEN 'CASH' THEN 'CASH_ON_HAND' WHEN 'MPESA' THEN 'MPESA_CLEARING' WHEN 'BANK' THEN 'BANK' ELSE 'OTHER_RECEIPTS' END;
    PERFORM _elimu_fin_gl('PAYMENT_REVERSED', 'PAYMENT_REV', pay.id, _elimu_fin_today(),
      jsonb_build_array(jsonb_build_object('account_key','STUDENT_CREDIT_LIABILITY','debit',pay.amount,'credit',0), jsonb_build_object('account_key', v_cash_key,'debit',0,'credit',pay.amount)), pay.business_id);
    v_detail := jsonb_build_object('released_allocations', v_released, 'original_receipt', pay.receipt_no);
    PERFORM _elimu_fin_audit('PAYMENT_REVERSED', 'elimu_fin_payments', pay.id, jsonb_build_object('previous', 'CONFIRMED', 'new', 'REVERSED', 'reason', c.reason,
      'approval', jsonb_build_object('requested_by', c.requested_by, 'decided_by', _elimu_fin_staff(), 'note', p_note)));

  ELSIF c.kind = 'ADJUSTMENT_REVERSAL' THEN
    SELECT * INTO adj FROM elimu_fin_adjustments WHERE id = c.original_id FOR UPDATE;
    IF adj.status <> 'APPLIED' THEN RAISE EXCEPTION 'That adjustment is no longer applied.'; END IF;
    SELECT coalesce(sum(_elimu_fin_release_one(id, 'ADJUSTMENT_REVERSED: ' || c.reason)), 0) INTO v_released
      FROM elimu_fin_allocations WHERE source_type = 'ADJUSTMENT' AND source_id = adj.id AND released_at IS NULL;
    v_entry := _elimu_fin_ledger_post(adj.business_id, adj.student_id, 'REVERSAL', adj.amount, _elimu_fin_today(),
      'Reversal of ' || lower(adj.kind) || ': ' || c.reason, 'CORRECTION', c.id, adj.target_invoice_id, adj.ledger_entry_id);
    UPDATE elimu_fin_adjustments SET status = 'REVERSED', decision_note = coalesce(decision_note || E'\n','') || 'Reversed: ' || c.reason WHERE id = adj.id;
    PERFORM _elimu_fin_gl('ADJUSTMENT_REVERSED', 'ADJUSTMENT_REV', adj.id, _elimu_fin_today(),
      jsonb_build_array(jsonb_build_object('account_key','STUDENT_CREDIT_LIABILITY','debit',adj.amount,'credit',0),
        jsonb_build_object('account_key', CASE adj.kind WHEN 'DISCOUNT' THEN 'DISCOUNT_ALLOWED' WHEN 'SCHOLARSHIP' THEN 'SCHOLARSHIP_EXPENSE' WHEN 'BURSARY' THEN 'BURSARY_RECEIVABLE'
          WHEN 'CREDIT_NOTE' THEN 'FEE_INCOME' WHEN 'WRITE_OFF' THEN 'BAD_DEBT_EXPENSE' ELSE 'OPENING_BALANCE_EQUITY' END,'debit',0,'credit',adj.amount)), adj.business_id);
    v_detail := jsonb_build_object('released_allocations', v_released);
    PERFORM _elimu_fin_audit('ADJUSTMENT_REVERSED', 'elimu_fin_adjustments', adj.id, jsonb_build_object('previous','APPLIED','new','REVERSED','reason',c.reason));

  ELSE -- REFUND: draw down free payment funds oldest first
    v_need := c.amount;
    IF c.amount > elimu_fin_credit_available(c.business_id, c.student_id) THEN
      RAISE EXCEPTION 'The student no longer has KES % of credit available.', c.amount; END IF;
    FOR p IN SELECT id, (amount - refunded - allocated) AS free FROM elimu_fin_payments
              WHERE business_id = c.business_id AND student_id = c.student_id AND status = 'CONFIRMED' AND (amount - refunded - allocated) > 0
              ORDER BY confirmed_at, id FOR UPDATE LOOP
      EXIT WHEN v_need <= 0;
      v_take := least(v_need, p.free);
      UPDATE elimu_fin_payments SET refunded = refunded + v_take WHERE id = p.id;
      v_detail := v_detail || jsonb_build_object('payment_id', p.id, 'amount', v_take);
      v_need := v_need - v_take;
    END LOOP;
    IF v_need > 0 THEN RAISE EXCEPTION 'Could not find enough unallocated payment funds to refund.'; END IF;
    v_entry := _elimu_fin_ledger_post(c.business_id, c.student_id, 'REFUND', c.amount, _elimu_fin_today(),
      'Refund (' || lower(c.refund_method) || '): ' || c.reason, 'REFUND', c.id);
    IF c.refund_method = 'CASH' THEN
      -- cash leaves the till of the person who pays it out (the requester), not the approver
      SELECT id INTO v_sess FROM elimu_fin_cashier_sessions WHERE business_id = c.business_id AND cashier_id = c.requested_by AND status = 'OPEN' LIMIT 1;
    END IF;
    v_cash_key := CASE c.refund_method WHEN 'CASH' THEN 'CASH_ON_HAND' WHEN 'MPESA' THEN 'MPESA_CLEARING' WHEN 'BANK' THEN 'BANK' ELSE 'OTHER_RECEIPTS' END;
    PERFORM _elimu_fin_gl('REFUND_PAID', 'REFUND', c.id, _elimu_fin_today(),
      jsonb_build_array(jsonb_build_object('account_key','STUDENT_CREDIT_LIABILITY','debit',c.amount,'credit',0), jsonb_build_object('account_key', v_cash_key,'debit',0,'credit',c.amount)), c.business_id);
    PERFORM _elimu_fin_audit('REFUND_APPROVED', 'elimu_fin_corrections', c.id, jsonb_build_object('new', jsonb_build_object('amount', c.amount, 'method', c.refund_method, 'reference', c.refund_reference),
      'reason', c.reason, 'approval', jsonb_build_object('requested_by', c.requested_by, 'decided_by', _elimu_fin_staff(), 'note', p_note)));
  END IF;

  UPDATE elimu_fin_corrections SET status = 'COMPLETED', decided_by = _elimu_fin_staff(), decided_at = now(), decision_note = p_note,
         ledger_entry_id = v_entry, detail = v_detail, session_id = v_sess WHERE id = c.id;
  RETURN jsonb_build_object('ok', true, 'status', 'COMPLETED', 'detail', v_detail);
END $$;

CREATE OR REPLACE FUNCTION elimu_fin_cancel_correction_request(p_correction uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c elimu_fin_corrections%ROWTYPE;
BEGIN
  SELECT * INTO c FROM elimu_fin_corrections WHERE id = p_correction AND tenant_id = get_current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Correction not found.'; END IF;
  IF c.status <> 'PENDING_APPROVAL' THEN RAISE EXCEPTION 'Only a pending request can be withdrawn.'; END IF;
  IF c.requested_by IS DISTINCT FROM _elimu_fin_staff() AND NOT elimu_fin_can('approve') THEN RAISE EXCEPTION 'Only the requester or an approver can withdraw this.' USING ERRCODE = '42501'; END IF;
  UPDATE elimu_fin_corrections SET status = 'CANCELLED', decided_by = _elimu_fin_staff(), decided_at = now() WHERE id = c.id;
  PERFORM _elimu_fin_audit('CORRECTION_WITHDRAWN', 'elimu_fin_corrections', c.id, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION _elimu_fin_adj_guard(), _elimu_fin_corr_guard(), _elimu_fin_check_maker_checker(uuid,uuid), _elimu_fin_apply_adjustment(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION elimu_fin_request_adjustment(uuid,uuid,text,numeric,text,text,numeric,uuid,uuid,text,text,text,uuid), elimu_fin_decide_adjustment(uuid,boolean,text),
  elimu_fin_cancel_adjustment_request(uuid,text), elimu_fin_add_opening_credit(uuid,uuid,numeric,text),
  elimu_fin_create_award(uuid,uuid,text,text,text,text,text,numeric,text,text,uuid,text,text), elimu_fin_apply_award(uuid,uuid),
  elimu_fin_credit_available(uuid,uuid), elimu_fin_request_correction(uuid,text,uuid,text,uuid,numeric,text,text,text),
  elimu_fin_decide_correction(uuid,boolean,text), elimu_fin_cancel_correction_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION elimu_fin_request_adjustment(uuid,uuid,text,numeric,text,text,numeric,uuid,uuid,text,text,text,uuid), elimu_fin_decide_adjustment(uuid,boolean,text),
  elimu_fin_cancel_adjustment_request(uuid,text), elimu_fin_add_opening_credit(uuid,uuid,numeric,text),
  elimu_fin_create_award(uuid,uuid,text,text,text,text,text,numeric,text,text,uuid,text,text), elimu_fin_apply_award(uuid,uuid),
  elimu_fin_credit_available(uuid,uuid), elimu_fin_request_correction(uuid,text,uuid,text,uuid,numeric,text,text,text),
  elimu_fin_decide_correction(uuid,boolean,text), elimu_fin_cancel_correction_request(uuid) TO authenticated;
