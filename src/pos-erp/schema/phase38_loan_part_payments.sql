-- phase38_loan_part_payments.sql   (My Loans: pay ANY amount, not only the exact instalment; interest always before principal)
-- STATUS: written and tested on a SCRATCH database only (schema/tests/phase37_run.sh runs phase37 then this file). NOT run on any real database.
-- Needs phase37_loans.sql first. Safe to run twice.
--
-- WHAT IT ADDS
--   * loan_record_payment(): record whatever the borrower actually paid: less than the instalment (7,000 of 13,000), exactly it,
--     or more (30,000 of 13,000). One payment can also be split over several instalments.
--   * ONE allocation rule, in the database, so the screen and the books cannot disagree (function _loan_apply_payment):
--       1. INTEREST (and fees) on every instalment that is already due, oldest first.
--       2. Only when ALL of that is paid: PRINCIPAL on the instalments already due, oldest first.
--       3. Anything left over is paid ahead: the next instalments in order, each one interest -> fees -> principal.
--     Principal can therefore never be paid while interest/fees on the same (or an earlier due) instalment are still owed, and the
--     table itself refuses it (CHECK lb_loan_inst_interest_first), so no screen, import or future code can break the rule.
--     The reverse ("interest after principal") is impossible for the same reason.
--   * Every payment is kept (lb_loan_payments) with how it was split (lb_loan_payment_allocations), so the history can be shown.
--   * Only INTEREST + FEES reach My Spending, one expense per instalment touched, dated like before (the due date when paid late, the
--     day paid when paid early). Principal never does.
--   * loan_void_payment() (owner only) undoes the MOST RECENT payment of a loan (undoing in order keeps the interest-first rule true).
--     It replaces loan_undo_payment(), which undid a whole instalment.
--   * "Where is this loan against its schedule" (arrears / ahead / on schedule) is worked out from the instalments in
--     src/pos-erp/utils/loanHelpers.js (loanStanding), the same way the screen already adds up the rest.
--
-- WHAT CHANGES FOR EXISTING THINGS
--   * An instalment is still PENDING until every part of it is paid, then PAID. "Part paid" is simply PENDING with paid_* > 0.
--   * "Mark as paid" (loan_mark_paid) and automatic posting now pay the BALANCE of that one instalment (what is left after any part payments).
--   * Existing PAID instalments are converted to one payment each, so Undo keeps working on them (newest first).
--   * loan_update_installment() may now also change a part-paid instalment, but never below what has already been paid against it.
--   * loan_close(): "paid off early" keeps what a part-paid instalment already received (it is trimmed to the paid amount and counted as paid);
--     "added by mistake" is refused once any payment has been recorded.
--   * loan_post_due() no longer uses SKIP LOCKED: every posting path now takes the LOAN row lock first, then the instalment (one lock order = no deadlocks).
--
-- ROLLBACK
--   Void/undo every payment first, then:  DROP FUNCTION loan_record_payment, loan_void_payment, _loan_apply_payment, _loan_bump;
--   DROP TABLE lb_loan_payment_allocations, lb_loan_payments;  ALTER TABLE lb_loan_installments DROP COLUMN paid_principal, DROP COLUMN paid_interest, DROP COLUMN paid_fees;
--   (and re-run phase37_loans.sql to restore the older loan_post_due / loan_close / loan_update_installment / loan_undo_payment.)

DO $$ BEGIN
  IF to_regclass('public.lb_loans') IS NULL OR to_regclass('public.lb_loan_installments') IS NULL
     OR to_regprocedure('_loan_post_installment(uuid,boolean,date,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'phase38 needs phase37_loans.sql first.';
  END IF;
END $$;

-- ============================================================ columns ============================================================
ALTER TABLE lb_loan_installments
  ADD COLUMN IF NOT EXISTS paid_principal numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_interest  numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_fees      numeric(15,2) NOT NULL DEFAULT 0;

-- ============================================================ payment history ============================================================
CREATE TABLE IF NOT EXISTS lb_loan_payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  n              bigint GENERATED ALWAYS AS IDENTITY,          -- strict order of recording (newest = highest)
  tenant_id      uuid NOT NULL,
  business_id    uuid NOT NULL REFERENCES lb_businesses(id),
  loan_id        uuid NOT NULL REFERENCES lb_loans(id) ON DELETE CASCADE,
  amount         numeric(15,2) NOT NULL CHECK (amount > 0),
  interest_paid  numeric(15,2) NOT NULL DEFAULT 0 CHECK (interest_paid >= 0),
  fees_paid      numeric(15,2) NOT NULL DEFAULT 0 CHECK (fees_paid >= 0),
  principal_paid numeric(15,2) NOT NULL DEFAULT 0 CHECK (principal_paid >= 0),
  paid_on        date NOT NULL,
  payment_method text NOT NULL DEFAULT 'BANK' CHECK (payment_method IN ('BANK','MOBILE_MONEY','CASH','OTHER')),
  auto           boolean NOT NULL DEFAULT false,               -- posted by the automatic (standing order) path
  status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','VOIDED')),
  note           text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  voided_at      timestamptz
);
CREATE INDEX IF NOT EXISTS lb_loan_payments_loan_idx ON lb_loan_payments (tenant_id, loan_id, status, n);

CREATE TABLE IF NOT EXISTS lb_loan_payment_allocations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  payment_id     uuid NOT NULL REFERENCES lb_loan_payments(id) ON DELETE CASCADE,
  installment_id uuid NOT NULL REFERENCES lb_loan_installments(id) ON DELETE CASCADE,
  interest       numeric(15,2) NOT NULL DEFAULT 0 CHECK (interest >= 0),
  fees           numeric(15,2) NOT NULL DEFAULT 0 CHECK (fees >= 0),
  principal      numeric(15,2) NOT NULL DEFAULT 0 CHECK (principal >= 0),
  expense_id     uuid REFERENCES lb_expenses(id),              -- the My Spending row for this slice's interest + fees (none when only principal)
  UNIQUE (payment_id, installment_id)
);
CREATE INDEX IF NOT EXISTS lb_loan_alloc_inst_idx ON lb_loan_payment_allocations (installment_id);

ALTER TABLE lb_loan_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE lb_loan_payment_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS loan_payments_read ON lb_loan_payments;
CREATE POLICY loan_payments_read ON lb_loan_payments FOR SELECT USING (tenant_id = get_current_tenant_id());
DROP POLICY IF EXISTS loan_alloc_read ON lb_loan_payment_allocations;
CREATE POLICY loan_alloc_read ON lb_loan_payment_allocations FOR SELECT USING (tenant_id = get_current_tenant_id());
REVOKE ALL ON lb_loan_payments, lb_loan_payment_allocations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON lb_loan_payments, lb_loan_payment_allocations TO authenticated;

-- ============================================================ bring existing rows across ============================================================
-- (1) instalments paid before the app was used: counted as fully paid, but they are not "app payments" (no expense, no cash effect).
UPDATE lb_loan_installments
   SET paid_principal = principal_due, paid_interest = interest_due, paid_fees = fees_due
 WHERE status = 'PAID' AND pre_app AND paid_principal + paid_interest + paid_fees = 0;

-- (2) instalments already paid through the app (phase37): one payment each, so Undo still works. Oldest first = lowest n.
DO $$
DECLARE r record; v_pay uuid;
BEGIN
  FOR r IN
    SELECT i.*, l.payment_method AS loan_method, l.created_by AS loan_by
      FROM lb_loan_installments i JOIN lb_loans l ON l.id = i.loan_id
     WHERE i.status = 'PAID' AND NOT i.pre_app AND i.paid_principal + i.paid_interest + i.paid_fees = 0
       AND NOT EXISTS (SELECT 1 FROM lb_loan_payment_allocations a WHERE a.installment_id = i.id)
     ORDER BY coalesce(i.paid_on, i.due_date), i.loan_id, i.seq
  LOOP
    INSERT INTO lb_loan_payments (tenant_id, business_id, loan_id, amount, interest_paid, fees_paid, principal_paid, paid_on, payment_method, auto, note, created_by)
    VALUES (r.tenant_id, r.business_id, r.loan_id, r.principal_due + r.interest_due + r.fees_due, r.interest_due, r.fees_due, r.principal_due,
            coalesce(r.paid_on, r.due_date), r.loan_method, r.auto_posted, 'Recorded before part payments existed', r.loan_by)
    RETURNING id INTO v_pay;
    INSERT INTO lb_loan_payment_allocations (tenant_id, payment_id, installment_id, interest, fees, principal, expense_id)
    VALUES (r.tenant_id, v_pay, r.id, r.interest_due, r.fees_due, r.principal_due, r.expense_id);
    UPDATE lb_loan_installments SET paid_principal = principal_due, paid_interest = interest_due, paid_fees = fees_due, expense_id = NULL WHERE id = r.id;
  END LOOP;
END $$;

-- ============================================================ the rules, enforced by the table itself ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lb_loan_inst_paid_within_due') THEN
    ALTER TABLE lb_loan_installments ADD CONSTRAINT lb_loan_inst_paid_within_due
      CHECK (paid_principal >= 0 AND paid_interest >= 0 AND paid_fees >= 0
             AND paid_principal <= principal_due AND paid_interest <= interest_due AND paid_fees <= fees_due);
  END IF;
  -- THE RULE: any principal paid on an instalment means its interest and fees are paid in full. Principal can never come first.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lb_loan_inst_interest_first') THEN
    ALTER TABLE lb_loan_installments ADD CONSTRAINT lb_loan_inst_interest_first
      CHECK (paid_principal = 0 OR (paid_interest = interest_due AND paid_fees = fees_due));
  END IF;
END $$;

-- an instalment entered as "paid before the app" is born fully paid
CREATE OR REPLACE FUNCTION _loan_inst_preapp_paid() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.pre_app AND NEW.status = 'PAID' AND NEW.paid_principal + NEW.paid_interest + NEW.paid_fees = 0 THEN
    NEW.paid_principal := NEW.principal_due; NEW.paid_interest := NEW.interest_due; NEW.paid_fees := NEW.fees_due;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_loan_inst_preapp_paid ON lb_loan_installments;
CREATE TRIGGER trg_loan_inst_preapp_paid BEFORE INSERT ON lb_loan_installments FOR EACH ROW EXECUTE FUNCTION _loan_inst_preapp_paid();

-- ============================================================ the allocation engine (the ONE implementation) ============================================================

-- adds one slice of a payment to one instalment (and to the payment's allocation row for it)
CREATE OR REPLACE FUNCTION _loan_bump(p_pay uuid, p_inst uuid, p_int numeric, p_fee numeric, p_pri numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE lb_loan_installments
     SET paid_interest = paid_interest + p_int, paid_fees = paid_fees + p_fee, paid_principal = paid_principal + p_pri, updated_at = now()
   WHERE id = p_inst;
  INSERT INTO lb_loan_payment_allocations AS al (tenant_id, payment_id, installment_id, interest, fees, principal)
  SELECT tenant_id, p_pay, p_inst, p_int, p_fee, p_pri FROM lb_loan_installments WHERE id = p_inst
  ON CONFLICT (payment_id, installment_id)
  DO UPDATE SET interest = al.interest + EXCLUDED.interest, fees = al.fees + EXCLUDED.fees, principal = al.principal + EXCLUDED.principal;
END $$;

-- p_target NULL : a normal payment for the loan (the waterfall described at the top).
-- p_target set  : pay only that one instalment (its balance); used by "Mark as paid" and automatic posting.
-- Returns NULL when the loan is not ACTIVE. Raises 22023 when the amount is more than can be applied.
CREATE OR REPLACE FUNCTION _loan_apply_payment(p_loan_id uuid, p_amount numeric, p_paid_on date, p_method text, p_actor uuid, p_auto boolean, p_target uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  l lb_loans; v_today date := _loan_today(); v_left numeric := round(p_amount, 2); v_room numeric;
  v_pay uuid; r lb_loan_installments; a record; v_int numeric; v_fee numeric; v_pri numeric;
  v_cat uuid; v_exp uuid; v_method text; v_si numeric := 0; v_sf numeric := 0; v_sp numeric := 0; v_cleared boolean;
BEGIN
  SELECT * INTO l FROM lb_loans WHERE id = p_loan_id FOR UPDATE;           -- the LOAN lock is always taken first
  IF NOT FOUND OR l.status <> 'ACTIVE' THEN RETURN NULL; END IF;
  IF v_left <= 0 THEN RAISE EXCEPTION 'Enter an amount more than zero.' USING ERRCODE = '22023'; END IF;
  v_method := coalesce(p_method, l.payment_method);

  SELECT coalesce(sum((interest_due - paid_interest) + (fees_due - paid_fees) + (principal_due - paid_principal)), 0) INTO v_room
    FROM lb_loan_installments WHERE loan_id = l.id AND status = 'PENDING' AND (p_target IS NULL OR id = p_target);
  IF v_left > v_room THEN
    RAISE EXCEPTION 'That is more than the % still to pay (KES %). Enter the amount actually paid.',
      CASE WHEN p_target IS NULL THEN 'loan has' ELSE 'instalment has' END, to_char(v_room, 'FM999,999,999,990.00') USING ERRCODE = '22023';
  END IF;

  INSERT INTO lb_loan_payments (tenant_id, business_id, loan_id, amount, paid_on, payment_method, auto, note, created_by)
  VALUES (l.tenant_id, l.business_id, l.id, v_left, p_paid_on, v_method, coalesce(p_auto, false), nullif(btrim(coalesce(p_note, '')), ''), p_actor)
  RETURNING id INTO v_pay;

  -- PASS 1: interest + fees on what is already due (or on the one target instalment), oldest first
  FOR r IN SELECT * FROM lb_loan_installments
            WHERE loan_id = l.id AND status = 'PENDING' AND ((p_target IS NULL AND due_date <= v_today) OR id = p_target)
            ORDER BY seq FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_int := least(v_left, r.interest_due - r.paid_interest); v_left := v_left - v_int;
    v_fee := least(v_left, r.fees_due - r.paid_fees);         v_left := v_left - v_fee;
    IF v_int + v_fee > 0 THEN PERFORM _loan_bump(v_pay, r.id, v_int, v_fee, 0); END IF;
  END LOOP;

  -- PASS 2: principal on the same instalments, only once their interest and fees are fully paid
  FOR r IN SELECT * FROM lb_loan_installments
            WHERE loan_id = l.id AND status = 'PENDING' AND ((p_target IS NULL AND due_date <= v_today) OR id = p_target)
            ORDER BY seq FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    IF r.interest_due > r.paid_interest OR r.fees_due > r.paid_fees THEN CONTINUE; END IF;   -- principal never jumps the queue
    v_pri := least(v_left, r.principal_due - r.paid_principal); v_left := v_left - v_pri;
    IF v_pri > 0 THEN PERFORM _loan_bump(v_pay, r.id, 0, 0, v_pri); END IF;
  END LOOP;

  -- PASS 3: what is left is paid AHEAD: the next instalments in order, each one interest -> fees -> principal
  IF p_target IS NULL THEN
    FOR r IN SELECT * FROM lb_loan_installments WHERE loan_id = l.id AND status = 'PENDING' AND due_date > v_today ORDER BY seq FOR UPDATE
    LOOP
      EXIT WHEN v_left <= 0;
      v_int := least(v_left, r.interest_due - r.paid_interest); v_left := v_left - v_int;
      v_fee := least(v_left, r.fees_due - r.paid_fees);         v_left := v_left - v_fee;
      v_pri := 0;
      IF v_int = r.interest_due - r.paid_interest AND v_fee = r.fees_due - r.paid_fees THEN
        v_pri := least(v_left, r.principal_due - r.paid_principal); v_left := v_left - v_pri;
      END IF;
      IF v_int + v_fee + v_pri > 0 THEN PERFORM _loan_bump(v_pay, r.id, v_int, v_fee, v_pri); END IF;
    END LOOP;
  END IF;

  IF v_left <> 0 THEN RAISE EXCEPTION 'Could not apply the whole payment.' USING ERRCODE = '22023'; END IF;   -- cannot happen (checked against v_room above)

  -- instalments now fully paid
  UPDATE lb_loan_installments i
     SET status = 'PAID', paid_on = CASE WHEN p_auto THEN i.due_date ELSE p_paid_on END, auto_posted = coalesce(p_auto, false), updated_at = now()
   WHERE i.loan_id = l.id AND i.status = 'PENDING'
     AND i.paid_principal = i.principal_due AND i.paid_interest = i.interest_due AND i.paid_fees = i.fees_due
     AND EXISTS (SELECT 1 FROM lb_loan_payment_allocations al WHERE al.payment_id = v_pay AND al.installment_id = i.id);

  -- only interest + fees reach My Spending: one expense per instalment touched
  FOR a IN
    SELECT al.id, al.interest, al.fees, i.due_date, i.seq, i.status
      FROM lb_loan_payment_allocations al JOIN lb_loan_installments i ON i.id = al.installment_id
     WHERE al.payment_id = v_pay AND al.interest + al.fees > 0 ORDER BY i.seq
  LOOP
    IF v_cat IS NULL THEN
      SELECT id INTO v_cat FROM lb_expense_categories WHERE lower(name) = 'loan interest & charges' AND is_active = true ORDER BY tenant_id NULLS FIRST LIMIT 1;
    END IF;
    v_exp := record_expense(
      l.business_id, NULL, v_cat, least(a.due_date, p_paid_on), a.interest + a.fees, v_method::lb_payment_method,
      format('Loan interest & charges — %s, instalment %s of %s%s', l.lender_name, a.seq, l.term_count,
             CASE WHEN p_auto THEN ' (automatic)' WHEN a.status = 'PENDING' THEN ' (part payment)' ELSE '' END),
      NULL, 'PAID', CASE WHEN p_auto THEN NULL ELSE p_actor END);
    UPDATE lb_loan_payment_allocations SET expense_id = v_exp WHERE id = a.id;
  END LOOP;

  SELECT coalesce(sum(interest), 0), coalesce(sum(fees), 0), coalesce(sum(principal), 0) INTO v_si, v_sf, v_sp
    FROM lb_loan_payment_allocations WHERE payment_id = v_pay;
  IF v_si + v_sf + v_sp <> round(p_amount, 2) THEN RAISE EXCEPTION 'Payment split does not add up.' USING ERRCODE = '22023'; END IF;
  UPDATE lb_loan_payments SET interest_paid = v_si, fees_paid = v_sf, principal_paid = v_sp WHERE id = v_pay;

  v_cleared := NOT EXISTS (SELECT 1 FROM lb_loan_installments WHERE loan_id = l.id AND status = 'PENDING');
  IF v_cleared THEN UPDATE lb_loans SET status = 'CLEARED', updated_at = now() WHERE id = l.id; END IF;

  RETURN jsonb_build_object('payment_id', v_pay, 'amount', round(p_amount, 2), 'interest', v_si, 'fees', v_sf, 'principal', v_sp,
                            'expense_amount', v_si + v_sf, 'cleared', v_cleared, 'paid_on', p_paid_on,
                            'instalments_touched', (SELECT count(*) FROM lb_loan_payment_allocations WHERE payment_id = v_pay));
END $$;

-- "Mark as paid" and automatic posting: pay the BALANCE of ONE instalment (whatever is left after any part payments).
-- Same signature and the same "NULL = nothing to do, safe to retry" contract as phase37.
CREATE OR REPLACE FUNCTION _loan_post_installment(p_id uuid, p_auto boolean, p_paid_on date, p_method text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE i lb_loan_installments; l lb_loans; v_amt numeric; v_paid date; v_res jsonb;
BEGIN
  SELECT * INTO i FROM lb_loan_installments WHERE id = p_id;                       -- no lock yet: find the loan, lock IT first
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO l FROM lb_loans WHERE id = i.loan_id FOR UPDATE;
  SELECT * INTO i FROM lb_loan_installments WHERE id = p_id FOR UPDATE;            -- re-read under the lock
  IF NOT FOUND OR i.status <> 'PENDING' OR l.status <> 'ACTIVE' THEN RETURN NULL; END IF;

  v_paid := CASE WHEN p_auto THEN i.due_date ELSE coalesce(p_paid_on, _loan_today()) END;
  v_amt  := (i.interest_due - i.paid_interest) + (i.fees_due - i.paid_fees) + (i.principal_due - i.paid_principal);
  IF v_amt <= 0 THEN RETURN NULL; END IF;

  v_res := _loan_apply_payment(l.id, v_amt, v_paid, p_method, p_actor, p_auto, i.id, NULL);
  IF v_res IS NULL THEN RETURN NULL; END IF;
  RETURN v_res || jsonb_build_object('installment_id', i.id, 'principal_repaid', v_res -> 'principal');
END $$;

-- Same as phase37 but without SKIP LOCKED / row locks here: _loan_post_installment takes the loan lock first, then the instalment.
CREATE OR REPLACE FUNCTION loan_post_due(p_business_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := get_current_tenant_id(); r record; v_posted integer := 0; v_skipped integer := 0; v_res jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No business in this session.' USING ERRCODE = '42501'; END IF;
  FOR r IN
    SELECT i.id FROM lb_loan_installments i JOIN lb_loans l ON l.id = i.loan_id
     WHERE i.tenant_id = v_tenant AND l.status = 'ACTIVE' AND l.auto_pay AND i.status = 'PENDING' AND NOT i.manual_only
       AND i.due_date <= _loan_today() AND (p_business_id IS NULL OR i.business_id = p_business_id)
     ORDER BY i.due_date, i.seq
  LOOP
    BEGIN
      v_res := _loan_post_installment(r.id, true, NULL, NULL, NULL);
      IF v_res IS NOT NULL THEN v_posted := v_posted + 1; END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      v_skipped := v_skipped + 1;        -- this person may not record expenses; someone who may will post it
    END;
  END LOOP;
  RETURN jsonb_build_object('posted', v_posted, 'skipped', v_skipped);
END $$;

-- ============================================================ record a payment of ANY amount ============================================================
CREATE OR REPLACE FUNCTION loan_record_payment(
  p_client_reference text, p_loan_id uuid, p_amount numeric, p_paid_on date DEFAULT NULL, p_method text DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := get_current_tenant_id(); v_prev jsonb; l lb_loans; v_res jsonb; v_actor uuid := nullif(auth.jwt() ->> 'pos_staff_id', '')::uuid; v_on date;
BEGIN
  PERFORM pos_require('expenses.record');
  v_prev := _pos_claim_op('loan_payment', p_client_reference, md5(concat_ws('|', p_loan_id, p_amount, p_paid_on, p_method, p_note)));
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;

  SELECT * INTO l FROM lb_loans WHERE id = p_loan_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loan not found.' USING ERRCODE = '42501'; END IF;
  IF l.status <> 'ACTIVE' THEN RAISE EXCEPTION 'This loan is not active, so it cannot take a payment.' USING ERRCODE = '22023'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Enter an amount more than zero.' USING ERRCODE = '22023'; END IF;
  IF p_amount <> round(p_amount, 2) THEN RAISE EXCEPTION 'Amounts can have at most 2 decimal places.' USING ERRCODE = '22023'; END IF;
  v_on := coalesce(p_paid_on, _loan_today());
  IF v_on > _loan_today() THEN RAISE EXCEPTION 'The payment date cannot be in the future.' USING ERRCODE = '22023'; END IF;
  IF p_method IS NOT NULL AND p_method NOT IN ('BANK','MOBILE_MONEY','CASH','OTHER') THEN RAISE EXCEPTION 'Unknown payment method.' USING ERRCODE = '22023'; END IF;

  v_res := _loan_apply_payment(l.id, p_amount, v_on, p_method, v_actor, false, NULL, p_note);
  IF v_res IS NULL THEN RAISE EXCEPTION 'This loan is not active, so it cannot take a payment.' USING ERRCODE = '22023'; END IF;
  PERFORM _loan_audit('loan.payment', l.id, v_res);
  RETURN _pos_finish_op(p_client_reference, v_res || jsonb_build_object('ok', true));
END $$;

-- ============================================================ owner: undo the most recent payment ============================================================
DROP FUNCTION IF EXISTS loan_undo_payment(uuid);

CREATE OR REPLACE FUNCTION loan_void_payment(p_payment_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := get_current_tenant_id(); p lb_loan_payments; l lb_loans; a record;
BEGIN
  PERFORM _loan_require_owner();
  SELECT * INTO p FROM lb_loan_payments WHERE id = p_payment_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO l FROM lb_loans WHERE id = p.loan_id FOR UPDATE;                    -- loan lock first, like every other path
  SELECT * INTO p FROM lb_loan_payments WHERE id = p_payment_id FOR UPDATE;
  IF p.status <> 'ACTIVE' THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  IF l.status NOT IN ('ACTIVE', 'CLEARED') THEN RAISE EXCEPTION 'This loan is closed, so its payments can no longer be undone.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM lb_loan_payments WHERE loan_id = l.id AND status = 'ACTIVE' AND n > p.n) THEN
    RAISE EXCEPTION 'Only the most recent payment can be undone. Undo the later payment first.' USING ERRCODE = '22023';
  END IF;

  FOR a IN SELECT * FROM lb_loan_payment_allocations WHERE payment_id = p.id LOOP
    UPDATE lb_loan_installments
       SET paid_interest = paid_interest - a.interest, paid_fees = paid_fees - a.fees, paid_principal = paid_principal - a.principal,
           status = CASE WHEN status = 'PAID' THEN 'PENDING' ELSE status END,
           paid_on = CASE WHEN status = 'PAID' THEN NULL ELSE paid_on END,
           auto_posted = false, manual_only = true, updated_at = now()
     WHERE id = a.installment_id;
    IF a.expense_id IS NOT NULL THEN
      UPDATE lb_expenses SET status = 'REJECTED', description = coalesce(description, '') || ' (undone)', updated_at = now() WHERE id = a.expense_id;
    END IF;
  END LOOP;
  UPDATE lb_loan_payments SET status = 'VOIDED', voided_at = now() WHERE id = p.id;
  UPDATE lb_loans SET status = 'ACTIVE', closed_at = NULL, updated_at = now() WHERE id = l.id AND status = 'CLEARED';
  PERFORM _loan_audit('loan.payment_undone', l.id, jsonb_build_object('payment_id', p.id, 'amount', p.amount));
  RETURN jsonb_build_object('ok', true, 'already', false);
END $$;

-- ============================================================ owner: corrections that now know about part payments ============================================================
CREATE OR REPLACE FUNCTION loan_update_installment(p_installment_id uuid, p_due_date date, p_principal numeric, p_interest numeric, p_fees numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := get_current_tenant_id(); i lb_loan_installments; v_done boolean;
BEGIN
  PERFORM _loan_require_owner();
  SELECT * INTO i FROM lb_loan_installments WHERE id = p_installment_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Instalment not found.' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM lb_loans WHERE id = i.loan_id FOR UPDATE;                          -- loan lock first
  SELECT * INTO i FROM lb_loan_installments WHERE id = p_installment_id FOR UPDATE;
  IF i.status <> 'PENDING' THEN RAISE EXCEPTION 'Only an unpaid instalment can be changed. Undo the payment first.' USING ERRCODE = '22023'; END IF;
  IF p_due_date IS NULL OR coalesce(p_principal, -1) < 0 OR coalesce(p_interest, -1) < 0 OR coalesce(p_fees, -1) < 0 OR coalesce(p_principal,0) + coalesce(p_interest,0) + coalesce(p_fees,0) <= 0 THEN
    RAISE EXCEPTION 'Enter a date and amounts that are not negative (and not all zero).' USING ERRCODE = '22023';
  END IF;
  IF p_principal < i.paid_principal OR p_interest < i.paid_interest OR p_fees < i.paid_fees THEN
    RAISE EXCEPTION 'Part of this instalment is already paid (loan %, interest %, fees %). It cannot be set below what was paid. Undo the payment first.',
      i.paid_principal, i.paid_interest, i.paid_fees USING ERRCODE = '22023';
  END IF;
  IF i.paid_principal > 0 AND (p_interest <> i.interest_due OR p_fees <> i.fees_due) THEN
    RAISE EXCEPTION 'The loan part of this instalment is already being paid, so its interest and fees can no longer change.' USING ERRCODE = '22023';
  END IF;
  v_done := p_principal = i.paid_principal AND p_interest = i.paid_interest AND p_fees = i.paid_fees;
  UPDATE lb_loan_installments
     SET due_date = p_due_date, principal_due = p_principal, interest_due = p_interest, fees_due = p_fees, edited = true,
         status = CASE WHEN v_done THEN 'PAID' ELSE status END, paid_on = CASE WHEN v_done THEN _loan_today() ELSE paid_on END, updated_at = now()
   WHERE id = i.id;
  IF v_done AND NOT EXISTS (SELECT 1 FROM lb_loan_installments WHERE loan_id = i.loan_id AND status = 'PENDING') THEN
    UPDATE lb_loans SET status = 'CLEARED', updated_at = now() WHERE id = i.loan_id AND status = 'ACTIVE';
  END IF;
  PERFORM _loan_audit('loan.installment_edited', i.id, jsonb_build_object('from', jsonb_build_object('due', i.due_date, 'principal', i.principal_due, 'interest', i.interest_due, 'fees', i.fees_due),
                                                                       'to', jsonb_build_object('due', p_due_date, 'principal', p_principal, 'interest', p_interest, 'fees', p_fees)));
  RETURN jsonb_build_object('ok', true);
END $$;

-- SETTLED : paid off early. A part-paid instalment keeps what it received (trimmed to that and counted as paid); untouched ones are cancelled.
-- CANCEL  : entered by mistake. Refused once ANY payment has been recorded (undo them first).
CREATE OR REPLACE FUNCTION loan_close(p_loan_id uuid, p_mode text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := get_current_tenant_id(); l lb_loans;
BEGIN
  PERFORM _loan_require_owner();
  IF p_mode NOT IN ('SETTLED','CANCEL') THEN RAISE EXCEPTION 'Mode must be SETTLED or CANCEL.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO l FROM lb_loans WHERE id = p_loan_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loan not found.' USING ERRCODE = '42501'; END IF;
  IF l.status IN ('CLOSED','CANCELLED') THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  IF p_mode = 'CANCEL' THEN
    IF EXISTS (SELECT 1 FROM lb_loan_payments WHERE loan_id = l.id AND status = 'ACTIVE') THEN
      RAISE EXCEPTION 'Payments have already been recorded on this loan. Undo them first, or close it as paid off early.' USING ERRCODE = '22023';
    END IF;
    IF l.upfront_fee_expense_id IS NOT NULL THEN
      UPDATE lb_expenses SET status = 'REJECTED', description = coalesce(description, '') || ' (loan cancelled)', updated_at = now() WHERE id = l.upfront_fee_expense_id;
    END IF;
    UPDATE lb_loan_installments SET status = 'CANCELLED', updated_at = now() WHERE loan_id = l.id AND status = 'PENDING';
    UPDATE lb_loans SET status = 'CANCELLED', closed_at = now(), updated_at = now() WHERE id = l.id;
  ELSE
    UPDATE lb_loan_installments
       SET principal_due = paid_principal, interest_due = paid_interest, fees_due = paid_fees, status = 'PAID', paid_on = _loan_today(), edited = true, updated_at = now()
     WHERE loan_id = l.id AND status = 'PENDING' AND paid_principal + paid_interest + paid_fees > 0;
    UPDATE lb_loan_installments SET status = 'CANCELLED', updated_at = now() WHERE loan_id = l.id AND status = 'PENDING';
    UPDATE lb_loans SET status = 'CLOSED', closed_at = now(), updated_at = now() WHERE id = l.id;
  END IF;
  PERFORM _loan_audit('loan.close', l.id, jsonb_build_object('mode', p_mode));
  RETURN jsonb_build_object('ok', true, 'already', false);
END $$;

-- ============================================================ grants ============================================================
REVOKE ALL ON FUNCTION _loan_bump(uuid, uuid, numeric, numeric, numeric), _loan_apply_payment(uuid, numeric, date, text, uuid, boolean, uuid, text),
                       _loan_post_installment(uuid, boolean, date, text, uuid), _loan_inst_preapp_paid() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION loan_record_payment(text, uuid, numeric, date, text, text), loan_void_payment(uuid), loan_post_due(uuid),
                       loan_update_installment(uuid, date, numeric, numeric, numeric), loan_close(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION loan_record_payment(text, uuid, numeric, date, text, text), loan_void_payment(uuid), loan_post_due(uuid),
                          loan_update_installment(uuid, date, numeric, numeric, numeric), loan_close(uuid, text) TO authenticated;
