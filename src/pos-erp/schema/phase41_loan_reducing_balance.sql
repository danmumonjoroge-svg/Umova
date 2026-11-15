-- phase41_loan_reducing_balance.sql   -- NOT YET RUN on a real database. Test on STAGING first. Re-runnable. Needs phase37, phase38, phase40.
--
-- WHAT THIS CHANGES (REDUCING-balance loans only; FLAT and NO-INTEREST loans behave exactly as before)
--   The instalment SCHEDULE stays fixed (the lender's table: date, principal, interest, balance). It is the yardstick, nothing more.
--   What the borrower really OWES is tracked separately:
--     * Interest is charged ONCE A MONTH (once per instalment period), at the normal rate, on the ACTUAL loan balance at the start of
--       that period (not on the scheduled balance). Pay less -> the balance stays higher -> next month's interest is higher.
--       Pay more -> the balance is lower -> next month's interest is lower. No penalty rate, no recalculated schedule.
--     * Interest that has not been charged yet cannot be paid in advance. A payment clears charged interest first (oldest first),
--       and EVERYTHING left goes to principal: due instalments first, then ahead.  Example: instalment 10,000 = 2,000 interest + 8,000
--       principal, member pays 60,000  ->  2,000 interest, 58,000 principal.
--     * Early payment does NOT shorten the term or lower the instalment. The loan simply is not "behind" until the actual balance
--       is above the SCHEDULED balance at the last due date (see loanStanding in utils/loanHelpers.js).
--   An instalment of such a loan is PAID only once its date has passed and its interest has been charged and paid, unless the whole
--   loan balance is zero (then nothing more can ever be charged and the remaining instalments close with it).
--
-- HOW IT IS STORED (no existing numbers are rewritten)
--   lb_loan_installments gets: accrues (this instalment follows the rules above), interest_accrued (this month's interest has been charged),
--   scheduled_interest (what the original table said, for display), accrual_opening (the balance the interest was charged on),
--   accrued_at, closed_by_payment. Until its month ends an instalment's interest_due is 0; when charged it becomes opening x rate.
--   Existing ACTIVE reducing loans: instalments already due keep their interest as it is; future ones switch to the new rule.
--
-- DATING RULE (so interest already charged can never become wrong): a payment on a reducing loan cannot be dated earlier than the start of
--   the most recently charged month. loan_void_payment refuses to undo a payment that a later month's interest was calculated on.
--
-- NOT DONE (be aware): after the LAST instalment date no further interest is charged (there is no next month to charge it in).
--   loan_update_installment on a reducing loan does not touch interest that has not been charged yet.
-- ROLLBACK: restore _loan_apply_payment/_loan_post_installment/loan_void_payment from phase40/phase38, re-create CHECK lb_loan_inst_interest_first
--   from phase38, DROP FUNCTION loan_accrue, _loan_accrue, _loan_balance_at, _loan_period_rate; DROP TRIGGER trg_loan_inst_accrual;
--   (set interest_due back from scheduled_interest where accrues AND NOT interest_accrued), then drop the added columns.

DO $$ BEGIN
  IF to_regprocedure('_loan_expense_actor(uuid)') IS NULL OR to_regclass('public.lb_loan_payments') IS NULL THEN
    RAISE EXCEPTION 'phase41 needs phase37, phase38 and phase40 first.';
  END IF;
END $$;

ALTER TABLE lb_loan_installments
  ADD COLUMN IF NOT EXISTS accrues            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS interest_accrued   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS scheduled_interest numeric(15,2),
  ADD COLUMN IF NOT EXISTS accrual_opening    numeric(15,2),
  ADD COLUMN IF NOT EXISTS accrued_at         timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by_payment  uuid;

-- The "interest before principal" table rule stays for every other loan. For a reducing loan the engine enforces it loan-wide
-- (all charged interest is paid before any principal), because principal may now be paid on instalments whose month has not ended.
ALTER TABLE lb_loan_installments DROP CONSTRAINT IF EXISTS lb_loan_inst_interest_first;
ALTER TABLE lb_loan_installments ADD CONSTRAINT lb_loan_inst_interest_first
  CHECK (paid_principal = 0 OR accrues OR (paid_interest = interest_due AND paid_fees = fees_due));

-- new instalments of a reducing loan start with no interest charged
CREATE OR REPLACE FUNCTION _loan_inst_accrual_init() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW.pre_app AND NEW.status = 'PENDING' AND EXISTS (SELECT 1 FROM lb_loans WHERE id = NEW.loan_id AND interest_method = 'REDUCING') THEN
    NEW.accrues := true; NEW.interest_accrued := false; NEW.scheduled_interest := NEW.interest_due; NEW.interest_due := 0;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_loan_inst_accrual ON lb_loan_installments;
CREATE TRIGGER trg_loan_inst_accrual BEFORE INSERT ON lb_loan_installments FOR EACH ROW EXECUTE FUNCTION _loan_inst_accrual_init();

-- existing ACTIVE reducing loans (once: only instalments not yet switched)
UPDATE lb_loan_installments i
   SET accrues = true, scheduled_interest = coalesce(scheduled_interest, i.interest_due),
       interest_accrued = (i.due_date <= _loan_today()),
       interest_due = CASE WHEN i.due_date <= _loan_today() THEN i.interest_due ELSE i.paid_interest END
  FROM lb_loans l
 WHERE l.id = i.loan_id AND l.interest_method = 'REDUCING' AND l.status = 'ACTIVE' AND i.status = 'PENDING' AND NOT i.pre_app AND NOT i.accrues;

-- ============================================================ the accrual engine ============================================================
CREATE OR REPLACE FUNCTION _loan_period_rate(p_loan lb_loans) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT (CASE WHEN p_loan.rate_period = 'MONTH' THEN p_loan.rate * 12 ELSE p_loan.rate END) / 100
         / (CASE p_loan.frequency WHEN 'MONTHLY' THEN 12 ELSE 52 END)
$$;

-- what is still owed of the loan itself on a given date: the amount borrowed less principal paid on or before that date
CREATE OR REPLACE FUNCTION _loan_balance_at(p_loan uuid, p_date date) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT l.principal
         - coalesce((SELECT sum(principal_paid) FROM lb_loan_payments WHERE loan_id = l.id AND status = 'ACTIVE' AND paid_on <= p_date), 0)
         - coalesce((SELECT sum(principal_due)  FROM lb_loan_installments WHERE loan_id = l.id AND pre_app AND status = 'PAID' AND due_date <= p_date), 0)
    FROM lb_loans l WHERE l.id = p_loan
$$;

-- Charges the interest of every instalment whose date is on or before p_asof and that has not been charged yet, in order.
-- The caller holds the loan lock. Returns how many were charged.
CREATE OR REPLACE FUNCTION _loan_accrue(p_loan uuid, p_asof date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE l lb_loans; r record; v_open numeric; v_int numeric; v_n integer := 0;
BEGIN
  SELECT * INTO l FROM lb_loans WHERE id = p_loan;
  IF NOT FOUND OR l.interest_method <> 'REDUCING' THEN RETURN 0; END IF;
  FOR r IN
    SELECT * FROM (SELECT i.*, lag(i.due_date) OVER (ORDER BY i.seq) AS prev_due FROM lb_loan_installments i
                    WHERE i.loan_id = p_loan AND i.status <> 'CANCELLED') x
     WHERE x.accrues AND NOT x.interest_accrued AND x.status = 'PENDING' AND x.due_date <= p_asof ORDER BY x.seq
  LOOP
    v_open := greatest(_loan_balance_at(p_loan, coalesce(r.prev_due, l.disbursed_on)), 0);
    v_int  := greatest(round(v_open * _loan_period_rate(l), 2), r.paid_interest);
    UPDATE lb_loan_installments SET interest_due = v_int, interest_accrued = true, accrual_opening = v_open, accrued_at = now(), updated_at = now() WHERE id = r.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- Charge everything due up to today for the business's active reducing loans (the app calls this when the loans screen opens).
-- Safe to repeat. People who may not record expenses simply get {skipped:true}; someone who may will do it.
CREATE OR REPLACE FUNCTION loan_accrue(p_business_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := get_current_tenant_id(); r record; v_n integer := 0;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No business in this session.' USING ERRCODE = '42501'; END IF;
  BEGIN PERFORM pos_require('expenses.record'); EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('charged', 0, 'skipped', true); END;
  FOR r IN SELECT id FROM lb_loans WHERE tenant_id = v_tenant AND status = 'ACTIVE' AND interest_method = 'REDUCING'
              AND (p_business_id IS NULL OR business_id = p_business_id) ORDER BY id
  LOOP
    PERFORM 1 FROM lb_loans WHERE id = r.id FOR UPDATE;
    v_n := v_n + _loan_accrue(r.id, _loan_today());
  END LOOP;
  RETURN jsonb_build_object('charged', v_n, 'skipped', false);
END $$;

-- ============================================================ payment engine (phase40 version + accrual) ============================================================
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

  -- reducing loan: month-by-month interest. A payment cannot be dated inside a month whose interest was already charged
  -- on a balance that this payment would have changed.
  IF l.interest_method = 'REDUCING' THEN
    IF EXISTS (SELECT 1 FROM (SELECT x.due_date, x.accrued_at, lag(x.due_date) OVER (ORDER BY x.seq) AS prev_due
                                FROM lb_loan_installments x WHERE x.loan_id = l.id AND x.status <> 'CANCELLED') y
                WHERE y.accrued_at IS NOT NULL AND coalesce(y.prev_due, l.disbursed_on) >= p_paid_on) THEN
      RAISE EXCEPTION 'Interest has already been charged for the month this payment falls in. Use the date the money was actually paid, or a later one.' USING ERRCODE = '22023';
    END IF;
    PERFORM _loan_accrue(l.id, p_paid_on);
  END IF;

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
     AND (NOT i.accrues OR i.interest_accrued)
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
      NULL, 'PAID', CASE WHEN p_auto THEN NULL ELSE _loan_expense_actor(p_actor) END);
    UPDATE lb_loan_payment_allocations SET expense_id = v_exp WHERE id = a.id;
  END LOOP;

  SELECT coalesce(sum(interest), 0), coalesce(sum(fees), 0), coalesce(sum(principal), 0) INTO v_si, v_sf, v_sp
    FROM lb_loan_payment_allocations WHERE payment_id = v_pay;
  IF v_si + v_sf + v_sp <> round(p_amount, 2) THEN RAISE EXCEPTION 'Payment split does not add up.' USING ERRCODE = '22023'; END IF;
  UPDATE lb_loan_payments SET interest_paid = v_si, fees_paid = v_sf, principal_paid = v_sp WHERE id = v_pay;

  -- reducing loan: once nothing at all is owed (balance zero, charged interest and fees paid) no more interest can ever be charged,
  -- so the instalments still waiting for their date close with the loan
  IF l.interest_method = 'REDUCING' AND NOT EXISTS (
       SELECT 1 FROM lb_loan_installments WHERE loan_id = l.id AND status = 'PENDING'
          AND (principal_due > paid_principal OR interest_due > paid_interest OR fees_due > paid_fees)) THEN
    UPDATE lb_loan_installments SET status = 'PAID', paid_on = p_paid_on, closed_by_payment = v_pay, updated_at = now()
     WHERE loan_id = l.id AND status = 'PENDING';
  END IF;
  v_cleared := NOT EXISTS (SELECT 1 FROM lb_loan_installments WHERE loan_id = l.id AND status = 'PENDING');
  IF v_cleared THEN UPDATE lb_loans SET status = 'CLEARED', updated_at = now() WHERE id = l.id; END IF;

  RETURN jsonb_build_object('payment_id', v_pay, 'amount', round(p_amount, 2), 'interest', v_si, 'fees', v_sf, 'principal', v_sp,
                            'expense_amount', v_si + v_sf, 'cleared', v_cleared, 'paid_on', p_paid_on,
                            'instalments_touched', (SELECT count(*) FROM lb_loan_payment_allocations WHERE payment_id = v_pay));
END $$;
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
  IF l.interest_method = 'REDUCING' THEN
    PERFORM _loan_accrue(l.id, v_paid);                                             -- charge this month's interest first
    SELECT * INTO i FROM lb_loan_installments WHERE id = p_id;
  END IF;
  v_amt  := (i.interest_due - i.paid_interest) + (i.fees_due - i.paid_fees) + (i.principal_due - i.paid_principal);
  IF v_amt <= 0 THEN RETURN NULL; END IF;

  v_res := _loan_apply_payment(l.id, v_amt, v_paid, p_method, p_actor, p_auto, i.id, NULL);
  IF v_res IS NULL THEN RETURN NULL; END IF;
  RETURN v_res || jsonb_build_object('installment_id', i.id, 'principal_repaid', v_res -> 'principal');
END $$;

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

  -- reducing loan: a month charged AFTER this payment was recorded used the balance this payment left. Undoing it would make that interest wrong.
  IF EXISTS (SELECT 1 FROM (SELECT x.accrued_at, lag(x.due_date) OVER (ORDER BY x.seq) AS prev_due FROM lb_loan_installments x
                             WHERE x.loan_id = l.id AND x.status <> 'CANCELLED') y
              WHERE y.accrued_at > p.created_at AND coalesce(y.prev_due, l.disbursed_on) >= p.paid_on) THEN
    RAISE EXCEPTION 'Interest for a later month was worked out after this payment, so it cannot be undone any more.' USING ERRCODE = '22023';
  END IF;
  UPDATE lb_loan_installments SET status = 'PENDING', paid_on = NULL, closed_by_payment = NULL, auto_posted = false, manual_only = true, updated_at = now()
   WHERE loan_id = l.id AND closed_by_payment = p.id;

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

-- ============================================================ grants ============================================================
REVOKE ALL ON FUNCTION _loan_period_rate(lb_loans), _loan_balance_at(uuid, date), _loan_accrue(uuid, date), _loan_inst_accrual_init(),
                       _loan_apply_payment(uuid, numeric, date, text, uuid, boolean, uuid, text), _loan_post_installment(uuid, boolean, date, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION loan_accrue(uuid), loan_void_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION loan_accrue(uuid), loan_void_payment(uuid) TO authenticated;
