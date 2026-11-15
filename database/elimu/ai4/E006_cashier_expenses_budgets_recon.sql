-- ============================================================================
-- ELIMU FINANCE  E006  Cashier collection sessions, school expenses (on the POS expense engine), budgets, reconciliation.
-- * Cashier sessions are separate from lb_cashier_shifts ON PURPOSE: POS shifts compute expected cash from SALES; fee cash is not a sale.
--   Identity is the same pos_staff id (no second staff system).
-- * Expenses are recorded by the existing record_expense(); Elimu only adds the school facts (supplier, department, approver, document).
-- Requires E001-E005. Re-runnable.
-- ============================================================================

-- ---------- cashier sessions ----------
CREATE TABLE IF NOT EXISTS elimu_fin_cashier_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  cashier_id uuid NOT NULL,                                    -- pos_staff.id
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','APPROVED')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_float numeric(15,2) NOT NULL DEFAULT 0 CHECK (opening_float >= 0),
  closed_at timestamptz,
  counted_cash numeric(15,2) CHECK (counted_cash IS NULL OR counted_cash >= 0),
  expected_cash numeric(15,2), variance numeric(15,2),         -- frozen at close
  collections jsonb,                                           -- frozen per-method totals at close
  handover_to uuid, handover_note text,
  approved_by uuid, approved_at timestamptz, approval_note text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT elimu_fin_session_closed CHECK (status = 'OPEN' OR (closed_at IS NOT NULL AND counted_cash IS NOT NULL AND expected_cash IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_fin_session_open ON elimu_fin_cashier_sessions (business_id, cashier_id) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_elimu_fin_sessions_biz ON elimu_fin_cashier_sessions (business_id, opened_at DESC);

CREATE OR REPLACE FUNCTION _elimu_fin_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Cashier sessions are never deleted.' USING ERRCODE = '42501'; END IF;
  IF OLD.status <> 'OPEN' AND (NEW.opening_float IS DISTINCT FROM OLD.opening_float OR NEW.counted_cash IS DISTINCT FROM OLD.counted_cash
      OR NEW.expected_cash IS DISTINCT FROM OLD.expected_cash OR NEW.cashier_id IS DISTINCT FROM OLD.cashier_id) THEN
    RAISE EXCEPTION 'A closed session''s figures cannot be changed.' USING ERRCODE = '42501'; END IF;
  IF OLD.status = 'APPROVED' THEN RAISE EXCEPTION 'An approved session cannot change.' USING ERRCODE = '42501'; END IF;
  NEW.updated_at := now(); RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_fin_session_guard ON elimu_fin_cashier_sessions;
CREATE TRIGGER trg_elimu_fin_session_guard BEFORE UPDATE OR DELETE ON elimu_fin_cashier_sessions FOR EACH ROW EXECUTE FUNCTION _elimu_fin_session_guard();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'elimu_fin_payments_session_fk') THEN
    ALTER TABLE elimu_fin_payments ADD CONSTRAINT elimu_fin_payments_session_fk FOREIGN KEY (session_id) REFERENCES elimu_fin_cashier_sessions(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'elimu_fin_corrections_session_fk') THEN
    ALTER TABLE elimu_fin_corrections ADD CONSTRAINT elimu_fin_corrections_session_fk FOREIGN KEY (session_id) REFERENCES elimu_fin_cashier_sessions(id);
  END IF;
END $$;

-- per-method totals for a session (CONFIRMED only; pending money is listed separately, never counted)
CREATE OR REPLACE FUNCTION _elimu_fin_session_totals(p_session uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'cash',   coalesce((SELECT sum(amount) FROM elimu_fin_payments WHERE session_id = p_session AND method = 'CASH' AND status = 'CONFIRMED'),0),
    'mpesa',  coalesce((SELECT sum(amount) FROM elimu_fin_payments WHERE session_id = p_session AND method = 'MPESA' AND status = 'CONFIRMED'),0),
    'bank',   coalesce((SELECT sum(amount) FROM elimu_fin_payments WHERE session_id = p_session AND method = 'BANK' AND status = 'CONFIRMED'),0),
    'other',  coalesce((SELECT sum(amount) FROM elimu_fin_payments WHERE session_id = p_session AND method IN ('CHEQUE','OTHER') AND status = 'CONFIRMED'),0),
    'pending',coalesce((SELECT sum(amount) FROM elimu_fin_payments WHERE session_id = p_session AND status = 'PENDING'),0),
    'cash_refunds', coalesce((SELECT sum(amount) FROM elimu_fin_corrections WHERE session_id = p_session AND kind = 'REFUND' AND refund_method = 'CASH' AND status = 'COMPLETED'),0),
    'payments', (SELECT count(*) FROM elimu_fin_payments WHERE session_id = p_session AND status IN ('CONFIRMED','PENDING')))
$$;

CREATE OR REPLACE FUNCTION elimu_fin_open_session(p_business uuid, p_opening_float numeric DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t uuid; v_id uuid;
BEGIN
  PERFORM _elimu_fin_require('collect'); v_t := _elimu_fin_tenant_of(p_business);
  IF _elimu_fin_staff() IS NULL THEN RAISE EXCEPTION 'Sign in as a member of staff to open a cashier session.'; END IF;
  IF p_opening_float IS NULL OR p_opening_float < 0 THEN RAISE EXCEPTION 'The opening cash cannot be negative.'; END IF;
  INSERT INTO elimu_fin_cashier_sessions (tenant_id, business_id, cashier_id, opening_float) VALUES (v_t, p_business, _elimu_fin_staff(), p_opening_float) RETURNING id INTO v_id;
  PERFORM _elimu_fin_audit('CASHIER_SESSION_OPENED', 'elimu_fin_cashier_sessions', v_id, jsonb_build_object('new', jsonb_build_object('opening_float', p_opening_float)));
  RETURN jsonb_build_object('ok', true, 'session_id', v_id);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'You already have an open cashier session.' USING ERRCODE = '23505';
END $$;

CREATE OR REPLACE FUNCTION elimu_fin_close_session(p_session uuid, p_counted_cash numeric, p_handover_to uuid DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s elimu_fin_cashier_sessions%ROWTYPE; v_tot jsonb; v_exp numeric; v_var numeric;
BEGIN
  PERFORM _elimu_fin_require('collect');
  SELECT * INTO s FROM elimu_fin_cashier_sessions WHERE id = p_session AND tenant_id = get_current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found.'; END IF;
  IF s.status <> 'OPEN' THEN RAISE EXCEPTION 'This session is already closed.'; END IF;
  IF s.cashier_id IS DISTINCT FROM _elimu_fin_staff() AND NOT elimu_fin_can('approve') THEN RAISE EXCEPTION 'Only the cashier or a supervisor can close this session.' USING ERRCODE = '42501'; END IF;
  IF p_counted_cash IS NULL OR p_counted_cash < 0 THEN RAISE EXCEPTION 'Enter the cash you counted.'; END IF;
  v_tot := _elimu_fin_session_totals(s.id);
  v_exp := s.opening_float + (v_tot->>'cash')::numeric - (v_tot->>'cash_refunds')::numeric;
  v_var := p_counted_cash - v_exp;
  IF v_var <> 0 AND length(btrim(coalesce(p_note,''))) < 3 THEN RAISE EXCEPTION 'The count is KES % off the expected KES %. Add a note explaining the variance.', abs(v_var), v_exp; END IF;
  UPDATE elimu_fin_cashier_sessions SET status = 'CLOSED', closed_at = now(), counted_cash = p_counted_cash, expected_cash = v_exp, variance = v_var,
         collections = v_tot, handover_to = p_handover_to, handover_note = p_note WHERE id = s.id;
  PERFORM _elimu_fin_audit('CASHIER_SESSION_CLOSED', 'elimu_fin_cashier_sessions', s.id, jsonb_build_object('new', jsonb_build_object('expected', v_exp, 'counted', p_counted_cash, 'variance', v_var), 'reason', p_note));
  RETURN jsonb_build_object('ok', true, 'expected_cash', v_exp, 'counted_cash', p_counted_cash, 'variance', v_var, 'collections', v_tot);
END $$;

CREATE OR REPLACE FUNCTION elimu_fin_approve_session(p_session uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s elimu_fin_cashier_sessions%ROWTYPE;
BEGIN
  PERFORM _elimu_fin_require('approve');
  SELECT * INTO s FROM elimu_fin_cashier_sessions WHERE id = p_session AND tenant_id = get_current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found.'; END IF;
  IF s.status <> 'CLOSED' THEN RAISE EXCEPTION 'Only a closed session can be approved.'; END IF;
  PERFORM _elimu_fin_check_maker_checker(s.cashier_id, s.business_id);
  UPDATE elimu_fin_cashier_sessions SET status = 'APPROVED', approved_by = _elimu_fin_staff(), approved_at = now(), approval_note = p_note WHERE id = s.id;
  PERFORM _elimu_fin_audit('CASHIER_SESSION_APPROVED', 'elimu_fin_cashier_sessions', s.id, jsonb_build_object('approval', jsonb_build_object('by', _elimu_fin_staff(), 'note', p_note), 'new', jsonb_build_object('variance', s.variance)));
  RETURN jsonb_build_object('ok', true);
END $$;

-- live view of a session (open sessions show running totals)
CREATE OR REPLACE FUNCTION elimu_fin_session_summary(p_session uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s elimu_fin_cashier_sessions%ROWTYPE; v_tot jsonb;
BEGIN
  PERFORM _elimu_fin_require('view');
  SELECT * INTO s FROM elimu_fin_cashier_sessions WHERE id = p_session AND tenant_id = get_current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found.'; END IF;
  IF s.cashier_id IS DISTINCT FROM _elimu_fin_staff() AND NOT (elimu_fin_can('approve') OR elimu_fin_can('report')) THEN RAISE EXCEPTION 'You can only see your own session.' USING ERRCODE = '42501'; END IF;
  v_tot := coalesce(s.collections, _elimu_fin_session_totals(s.id));
  RETURN jsonb_build_object('session', to_jsonb(s), 'collections', v_tot,
    'expected_cash_now', s.opening_float + (v_tot->>'cash')::numeric - (v_tot->>'cash_refunds')::numeric);
END $$;

-- ---------- school expenses on top of the POS expense engine ----------
CREATE TABLE IF NOT EXISTS elimu_fin_expense_meta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  expense_id uuid NOT NULL REFERENCES lb_expenses(id),
  supplier_name text, department text, reference text, supporting_document_url text,
  period_id uuid REFERENCES elimu_fin_periods(id), academic_year text,
  approved_by uuid, approved_at timestamptz, approval_note text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (expense_id)
);
CREATE INDEX IF NOT EXISTS idx_elimu_fin_expmeta_biz ON elimu_fin_expense_meta (business_id, period_id, department);

-- p_status: PENDING (awaiting approval) | APPROVED | PAID. Approved/paid on entry needs an approver (payments.approve).
CREATE OR REPLACE FUNCTION elimu_fin_record_expense(p_business uuid, p_category uuid, p_date date, p_amount numeric, p_method text, p_description text,
  p_supplier text DEFAULT NULL, p_department text DEFAULT NULL, p_reference text DEFAULT NULL, p_document_url text DEFAULT NULL,
  p_period uuid DEFAULT NULL, p_status text DEFAULT 'PENDING')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t uuid; v_exp uuid; v_status text := upper(p_status); v_year text; v_approver boolean;
BEGIN
  PERFORM _elimu_fin_require('expense'); v_t := _elimu_fin_tenant_of(p_business);
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'The amount must be above zero.'; END IF;
  IF v_status NOT IN ('PENDING','APPROVED','PAID') THEN RAISE EXCEPTION 'Status must be PENDING, APPROVED or PAID.'; END IF;
  v_approver := elimu_fin_can('approve');
  IF v_status <> 'PENDING' AND NOT v_approver THEN RAISE EXCEPTION 'Only an approver can record an expense as approved or paid. Save it as pending.' USING ERRCODE = '42501'; END IF;
  IF p_period IS NOT NULL THEN SELECT academic_year INTO v_year FROM elimu_fin_periods WHERE id = p_period AND business_id = p_business; END IF;
  v_exp := record_expense(p_business, NULL, p_category, coalesce(p_date, _elimu_fin_today()), p_amount, upper(p_method), p_description, p_document_url, v_status, _elimu_fin_staff());
  INSERT INTO elimu_fin_expense_meta (tenant_id, business_id, expense_id, supplier_name, department, reference, supporting_document_url, period_id, academic_year,
      approved_by, approved_at, created_by)
  VALUES (v_t, p_business, v_exp, p_supplier, p_department, p_reference, p_document_url, p_period, v_year,
      CASE WHEN v_status <> 'PENDING' THEN _elimu_fin_staff() END, CASE WHEN v_status <> 'PENDING' THEN now() END, _elimu_fin_staff());
  PERFORM _elimu_fin_audit('EXPENSE_RECORDED', 'lb_expenses', v_exp, jsonb_build_object('new', jsonb_build_object('amount', p_amount, 'status', v_status, 'supplier', p_supplier, 'department', p_department)));
  IF v_status = 'PAID' THEN PERFORM _elimu_fin_expense_gl(v_exp); END IF;
  RETURN jsonb_build_object('ok', true, 'expense_id', v_exp, 'status', v_status);
END $$;

CREATE OR REPLACE FUNCTION _elimu_fin_expense_gl(p_expense uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e record; v_cash text;
BEGIN
  SELECT x.id, x.business_id, x.amount, x.expense_date, upper(x.payment_method::text) AS pm, x.category_id INTO e FROM lb_expenses x WHERE x.id = p_expense;
  v_cash := CASE WHEN e.pm = 'CASH' THEN 'CASH_ON_HAND' WHEN e.pm IN ('MPESA','MOBILE_MONEY') THEN 'MPESA_CLEARING' WHEN e.pm IN ('BANK','BANK_TRANSFER') THEN 'BANK' ELSE 'OTHER_RECEIPTS' END;
  PERFORM _elimu_fin_gl('EXPENSE_PAID', 'EXPENSE', e.id, e.expense_date,
    jsonb_build_array(jsonb_build_object('account_key', 'EXPENSE:' || coalesce(e.category_id::text,'GENERAL'), 'fallback_key', 'GENERAL_EXPENSE', 'debit', e.amount, 'credit', 0),
                      jsonb_build_object('account_key', v_cash, 'debit', 0, 'credit', e.amount)), e.business_id);
END $$;

-- approver moves an expense forward: PENDING -> APPROVED -> PAID, or declines. (Updates only the status column of the POS row.)
CREATE OR REPLACE FUNCTION elimu_fin_set_expense_status(p_expense uuid, p_status text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE m elimu_fin_expense_meta%ROWTYPE; v_cur text; v_new text := upper(p_status);
BEGIN
  PERFORM _elimu_fin_require('approve');
  SELECT * INTO m FROM elimu_fin_expense_meta WHERE expense_id = p_expense AND tenant_id = get_current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found.'; END IF;
  SELECT status::text INTO v_cur FROM lb_expenses WHERE id = p_expense FOR UPDATE;
  IF v_new NOT IN ('APPROVED','PAID','REJECTED') THEN RAISE EXCEPTION 'Status must be APPROVED, PAID or REJECTED.'; END IF;
  IF NOT ((v_cur = 'PENDING' AND v_new IN ('APPROVED','PAID','REJECTED')) OR (v_cur = 'APPROVED' AND v_new IN ('PAID','REJECTED'))) THEN
    RAISE EXCEPTION 'An expense that is % cannot be moved to %.', lower(v_cur), lower(v_new); END IF;
  IF v_new = 'REJECTED' AND length(btrim(coalesce(p_note,''))) < 3 THEN RAISE EXCEPTION 'Say why it is declined.'; END IF;
  EXECUTE format('UPDATE lb_expenses SET status = %L WHERE id = $1', v_new) USING p_expense;
  UPDATE elimu_fin_expense_meta SET approved_by = _elimu_fin_staff(), approved_at = now(), approval_note = p_note WHERE id = m.id;
  PERFORM _elimu_fin_audit('EXPENSE_' || v_new, 'lb_expenses', p_expense, jsonb_build_object('previous', v_cur, 'new', v_new, 'reason', p_note));
  IF v_new = 'PAID' THEN PERFORM _elimu_fin_expense_gl(p_expense); END IF;
  RETURN jsonb_build_object('ok', true, 'status', v_new);
END $$;

-- ---------- budgets ----------
CREATE TABLE IF NOT EXISTS elimu_fin_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  academic_year text NOT NULL,
  period_id uuid REFERENCES elimu_fin_periods(id),             -- NULL = whole academic year
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','CLOSED')),
  approved_by uuid, approved_at timestamptz, notes text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_fin_budget_name ON elimu_fin_budgets (business_id, academic_year, (coalesce(period_id::text,'*')), lower(btrim(name)));
CREATE TABLE IF NOT EXISTS elimu_fin_budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, business_id uuid NOT NULL,
  budget_id uuid NOT NULL REFERENCES elimu_fin_budgets(id),
  department text,
  category_id uuid NOT NULL REFERENCES lb_expense_categories(id),
  amount numeric(15,2) NOT NULL CHECK (amount >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_fin_budget_line ON elimu_fin_budget_lines (budget_id, (coalesce(lower(btrim(department)),'*')), category_id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['elimu_fin_cashier_sessions','elimu_fin_expense_meta','elimu_fin_budgets','elimu_fin_budget_lines'] LOOP PERFORM _elimu_fin_secure(t, 'view'); END LOOP;
END $$;

-- save a DRAFT budget with its lines (lines of a draft are replaced; approved budgets are frozen)
CREATE OR REPLACE FUNCTION elimu_fin_save_budget(p_business uuid, p_budget jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t uuid; v_id uuid := nullif(p_budget->>'id','')::uuid; b elimu_fin_budgets%ROWTYPE; l jsonb; v_prev jsonb;
BEGIN
  IF NOT (elimu_fin_can('expense') OR elimu_fin_can('configure')) THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  v_t := _elimu_fin_tenant_of(p_business);
  IF v_id IS NULL THEN
    INSERT INTO elimu_fin_budgets (tenant_id, business_id, name, academic_year, period_id, notes, created_by)
    VALUES (v_t, p_business, p_budget->>'name', p_budget->>'academic_year', nullif(p_budget->>'period_id','')::uuid, p_budget->>'notes', _elimu_fin_staff()) RETURNING id INTO v_id;
  ELSE
    SELECT * INTO b FROM elimu_fin_budgets WHERE id = v_id AND business_id = p_business FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Budget not found.'; END IF;
    IF b.status <> 'DRAFT' THEN RAISE EXCEPTION 'An approved budget is frozen. Create a new budget for changes.'; END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_prev FROM elimu_fin_budget_lines x WHERE budget_id = v_id;
    UPDATE elimu_fin_budgets SET name = coalesce(p_budget->>'name', name), notes = coalesce(p_budget->>'notes', notes), updated_at = now() WHERE id = v_id;
    DELETE FROM elimu_fin_budget_lines WHERE budget_id = v_id;
  END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(coalesce(p_budget->'lines','[]'::jsonb)) LOOP
    INSERT INTO elimu_fin_budget_lines (tenant_id, business_id, budget_id, department, category_id, amount)
    VALUES (v_t, p_business, v_id, nullif(btrim(l->>'department'),''), (l->>'category_id')::uuid, (l->>'amount')::numeric);
  END LOOP;
  PERFORM _elimu_fin_audit('BUDGET_SAVED', 'elimu_fin_budgets', v_id, jsonb_build_object('previous', v_prev, 'new', p_budget->'lines'));
  RETURN jsonb_build_object('ok', true, 'budget_id', v_id);
END $$;

CREATE OR REPLACE FUNCTION elimu_fin_approve_budget(p_budget uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM _elimu_fin_require('approve');
  UPDATE elimu_fin_budgets SET status = 'APPROVED', approved_by = _elimu_fin_staff(), approved_at = now(), updated_at = now()
   WHERE id = p_budget AND tenant_id = get_current_tenant_id() AND status = 'DRAFT';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a draft budget can be approved.'; END IF;
  PERFORM _elimu_fin_audit('BUDGET_APPROVED', 'elimu_fin_budgets', p_budget, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true);
END $$;

-- budget vs actual. Actual = expenses that are APPROVED or PAID (committed), matched on category, period/year and (if the line names one) department.
CREATE OR REPLACE FUNCTION elimu_fin_budget_vs_actual(p_budget uuid) RETURNS TABLE (
  department text, category_id uuid, category text, budget numeric, actual numeric, variance numeric, variance_pct numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b elimu_fin_budgets%ROWTYPE;
BEGIN
  PERFORM _elimu_fin_require('report');
  SELECT * INTO b FROM elimu_fin_budgets WHERE id = p_budget AND tenant_id = get_current_tenant_id();
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY
    SELECT l.department, l.category_id, c.name::text, l.amount,
           coalesce((SELECT sum(e.amount) FROM lb_expenses e JOIN elimu_fin_expense_meta m ON m.expense_id = e.id
                      WHERE e.business_id = b.business_id AND e.category_id = l.category_id AND e.status::text IN ('APPROVED','PAID')
                        AND ((b.period_id IS NOT NULL AND m.period_id = b.period_id) OR (b.period_id IS NULL AND m.academic_year = b.academic_year))
                        AND (l.department IS NULL OR lower(btrim(m.department)) = lower(btrim(l.department)))), 0),
           0::numeric, NULL::numeric
      FROM elimu_fin_budget_lines l JOIN lb_expense_categories c ON c.id = l.category_id WHERE l.budget_id = b.id
      ORDER BY l.department NULLS FIRST, c.name;
END $$;
-- variance columns computed in a thin wrapper so the SQL above stays readable
CREATE OR REPLACE FUNCTION elimu_fin_budget_report(p_budget uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb; v_tb numeric; v_ta numeric;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('department', r.department, 'category_id', r.category_id, 'category', r.category, 'budget', r.budget, 'actual', r.actual,
           'variance', r.budget - r.actual, 'variance_pct', CASE WHEN r.budget = 0 THEN NULL ELSE round((r.budget - r.actual) / r.budget * 100, 1) END)), '[]'::jsonb),
         coalesce(sum(r.budget),0), coalesce(sum(r.actual),0)
    INTO v, v_tb, v_ta FROM elimu_fin_budget_vs_actual(p_budget) r;
  RETURN jsonb_build_object('lines', v, 'total_budget', v_tb, 'total_actual', v_ta, 'total_variance', v_tb - v_ta,
    'total_variance_pct', CASE WHEN v_tb = 0 THEN NULL ELSE round((v_tb - v_ta) / v_tb * 100, 1) END,
    'note', 'Variance = budget - actual. Positive = under budget. Actual counts APPROVED and PAID expenses.');
END $$;

-- ---------- reconciliation (bank / M-Pesa / cash against an external statement) ----------
CREATE TABLE IF NOT EXISTS elimu_fin_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  method text NOT NULL CHECK (method IN ('BANK','MPESA','CASH','CHEQUE','OTHER')),
  account_label text,
  period_start date NOT NULL, period_end date NOT NULL,
  statement_total numeric(15,2) NOT NULL,                      -- what the bank / Daraja / cash book says came in for the period
  book_total numeric(15,2) NOT NULL,                           -- sum of the payments ticked off here
  difference numeric(15,2) GENERATED ALWAYS AS (statement_total - book_total) STORED,
  payment_count integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('BALANCED','UNBALANCED')),
  notes text, prepared_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT elimu_fin_recon_dates CHECK (period_end >= period_start),
  CONSTRAINT elimu_fin_recon_unbalanced_note CHECK (status = 'BALANCED' OR length(btrim(coalesce(notes,''))) >= 3)
);
DROP TRIGGER IF EXISTS trg_elimu_fin_recon_guard ON elimu_fin_reconciliations;
CREATE TRIGGER trg_elimu_fin_recon_guard BEFORE UPDATE OR DELETE ON elimu_fin_reconciliations FOR EACH ROW EXECUTE FUNCTION _elimu_fin_immutable();
SELECT _elimu_fin_secure('elimu_fin_reconciliations', 'view');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'elimu_fin_payments_recon_fk') THEN
    ALTER TABLE elimu_fin_payments ADD CONSTRAINT elimu_fin_payments_recon_fk FOREIGN KEY (reconciliation_id) REFERENCES elimu_fin_reconciliations(id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION elimu_fin_unreconciled(p_business uuid, p_method text, p_from date, p_to date)
RETURNS TABLE (payment_id uuid, receipt_no text, payment_date date, amount numeric, transaction_ref text, bank_account text, student_name text, admission_no text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM _elimu_fin_require('reconcile'); PERFORM _elimu_fin_tenant_of(p_business);
  RETURN QUERY SELECT p.id, p.receipt_no, p.payment_date, p.amount, p.transaction_ref, p.bank_account, p.student_name, p.admission_no
    FROM elimu_fin_payments p WHERE p.business_id = p_business AND p.method = upper(p_method) AND p.status = 'CONFIRMED' AND p.reconciliation_id IS NULL
     AND p.payment_date BETWEEN p_from AND p_to ORDER BY p.payment_date, p.created_at LIMIT 2000;
END $$;

CREATE OR REPLACE FUNCTION elimu_fin_reconcile(p_business uuid, p_method text, p_account_label text, p_from date, p_to date, p_statement_total numeric,
  p_payment_ids uuid[], p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t uuid; v_book numeric; v_cnt int; v_id uuid; v_status text;
BEGIN
  PERFORM _elimu_fin_require('reconcile'); v_t := _elimu_fin_tenant_of(p_business);
  SELECT coalesce(sum(amount),0), count(*) INTO v_book, v_cnt FROM elimu_fin_payments
   WHERE id = ANY (coalesce(p_payment_ids, ARRAY[]::uuid[])) AND business_id = p_business AND method = upper(p_method) AND status = 'CONFIRMED'
     AND reconciliation_id IS NULL AND payment_date BETWEEN p_from AND p_to;
  IF v_cnt <> coalesce(cardinality(p_payment_ids),0) THEN
    RAISE EXCEPTION 'Some ticked payments are not confirmed %, inside the period, or are already reconciled.', lower(p_method); END IF;
  v_status := CASE WHEN v_book = p_statement_total THEN 'BALANCED' ELSE 'UNBALANCED' END;
  INSERT INTO elimu_fin_reconciliations (tenant_id, business_id, method, account_label, period_start, period_end, statement_total, book_total, payment_count, status, notes, prepared_by)
  VALUES (v_t, p_business, upper(p_method), p_account_label, p_from, p_to, p_statement_total, v_book, v_cnt, v_status, p_notes, _elimu_fin_staff()) RETURNING id INTO v_id;
  IF v_status = 'BALANCED' AND v_cnt > 0 THEN
    UPDATE elimu_fin_payments SET reconciliation_id = v_id, reconciled_at = now() WHERE id = ANY (p_payment_ids);
  END IF;
  PERFORM _elimu_fin_audit('RECONCILIATION_' || v_status, 'elimu_fin_reconciliations', v_id, jsonb_build_object('new', jsonb_build_object('statement', p_statement_total, 'book', v_book, 'payments', v_cnt), 'reason', p_notes));
  RETURN jsonb_build_object('ok', true, 'reconciliation_id', v_id, 'status', v_status, 'difference', p_statement_total - v_book, 'marked_reconciled', v_status = 'BALANCED');
END $$;

REVOKE ALL ON FUNCTION _elimu_fin_session_guard(), _elimu_fin_session_totals(uuid), _elimu_fin_expense_gl(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION elimu_fin_open_session(uuid,numeric), elimu_fin_close_session(uuid,numeric,uuid,text), elimu_fin_approve_session(uuid,text), elimu_fin_session_summary(uuid),
  elimu_fin_record_expense(uuid,uuid,date,numeric,text,text,text,text,text,text,uuid,text), elimu_fin_set_expense_status(uuid,text,text),
  elimu_fin_save_budget(uuid,jsonb), elimu_fin_approve_budget(uuid), elimu_fin_budget_vs_actual(uuid), elimu_fin_budget_report(uuid),
  elimu_fin_unreconciled(uuid,text,date,date), elimu_fin_reconcile(uuid,text,text,date,date,numeric,uuid[],text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION elimu_fin_open_session(uuid,numeric), elimu_fin_close_session(uuid,numeric,uuid,text), elimu_fin_approve_session(uuid,text), elimu_fin_session_summary(uuid),
  elimu_fin_record_expense(uuid,uuid,date,numeric,text,text,text,text,text,text,uuid,text), elimu_fin_set_expense_status(uuid,text,text),
  elimu_fin_save_budget(uuid,jsonb), elimu_fin_approve_budget(uuid), elimu_fin_budget_vs_actual(uuid), elimu_fin_budget_report(uuid),
  elimu_fin_unreconciled(uuid,text,date,date), elimu_fin_reconcile(uuid,text,text,date,date,numeric,uuid[],text) TO authenticated;
