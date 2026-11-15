-- phase40_loan_expense_actor_fix.sql   -- NOT YET RUN. Test on STAGING first. Re-runnable.
--
-- BUG: recording a loan payment failed with
--   23503 insert or update on table "lb_expenses" violates foreign key constraint "lb_expenses_created_by_fkey"
--   Key (created_by)=(...) is not present in table "users".
-- WHY: the loan functions take the signed-in person from the login token as pos_staff_id (a pos_staff row id) and handed THAT to
-- record_expense() as created_by. lb_expenses.created_by points at the auth user id (pos_staff.auth_user_id), the same value the app
-- passes as staffId everywhere else. Two places did it: _loan_apply_payment (every loan payment / Mark as paid) and loan_create (the
-- up-front processing fee). lb_loan_payments.created_by and lb_loans.created_by keep the pos_staff id, as before.
-- FIX: map the staff id to its auth user id only for the expense row. Nothing else changes; no data is touched.
-- ROLLBACK: re-run the two functions from phase38_loan_part_payments.sql (_loan_apply_payment) and phase37_loans.sql (loan_create),
-- then DROP FUNCTION _loan_expense_actor(uuid). Grants on both functions are unchanged by CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION _loan_expense_actor(p_staff uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT auth_user_id FROM pos_staff WHERE id = p_staff $$;
REVOKE ALL ON FUNCTION _loan_expense_actor(uuid) FROM PUBLIC, anon, authenticated;

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
      NULL, 'PAID', CASE WHEN p_auto THEN NULL ELSE _loan_expense_actor(p_actor) END);
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

CREATE OR REPLACE FUNCTION loan_create(
  p_client_reference text, p_business_id uuid, p_lender_name text, p_lender_type text, p_reference_no text,
  p_principal numeric, p_interest_method text, p_rate numeric, p_rate_period text,
  p_term_count integer, p_frequency text, p_first_due date, p_disbursed_on date,
  p_upfront_fees numeric DEFAULT 0, p_fee_per_installment numeric DEFAULT 0,
  p_auto_pay boolean DEFAULT false, p_payment_method text DEFAULT 'BANK',
  p_paid_before_count integer DEFAULT 0, p_record_disbursement boolean DEFAULT true, p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant uuid := get_current_tenant_id(); v_prev jsonb; v_id uuid; v_disb date; v_cat uuid; v_fee_exp uuid;
  v_actor uuid := nullif(auth.jwt() ->> 'pos_staff_id', '')::uuid; v_posted jsonb;
BEGIN
  PERFORM _loan_require_owner();
  v_prev := _pos_claim_op('loan_create', p_client_reference, md5(concat_ws('|', p_business_id, p_lender_name, p_lender_type, p_reference_no, p_principal,
            p_interest_method, p_rate, p_rate_period, p_term_count, p_frequency, p_first_due, p_disbursed_on, p_upfront_fees, p_fee_per_installment,
            p_auto_pay, p_payment_method, p_paid_before_count, p_record_disbursement)));
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;

  IF NOT EXISTS (SELECT 1 FROM lb_businesses WHERE id = p_business_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Business not found.' USING ERRCODE = '42501';
  END IF;
  IF p_lender_type NOT IN ('BANK','SACCO','MPESA','OTHER') THEN RAISE EXCEPTION 'Pick who lent the money.' USING ERRCODE = '22023'; END IF;
  IF coalesce(p_paid_before_count, 0) < 0 OR coalesce(p_paid_before_count, 0) >= p_term_count THEN
    RAISE EXCEPTION 'Instalments already paid must be fewer than the total number of instalments.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_upfront_fees, 0) > 0 AND NOT coalesce(p_record_disbursement, true) THEN
    RAISE EXCEPTION 'A processing fee can only be recorded for a loan received after you started using this app.' USING ERRCODE = '22023';
  END IF;
  v_disb := coalesce(p_disbursed_on, _loan_today());

  INSERT INTO lb_loans (tenant_id, business_id, lender_name, lender_type, reference_no, principal, interest_method, rate, rate_period, term_count,
                        frequency, first_due_date, disbursed_on, record_disbursement, upfront_fees, fee_per_installment, auto_pay, payment_method, notes, created_by)
  VALUES (v_tenant, p_business_id, btrim(p_lender_name), p_lender_type, nullif(btrim(coalesce(p_reference_no, '')), ''), p_principal, p_interest_method,
          CASE WHEN p_interest_method = 'NONE' THEN 0 ELSE coalesce(p_rate, 0) END, coalesce(p_rate_period, 'YEAR'), p_term_count,
          p_frequency, p_first_due, v_disb, coalesce(p_record_disbursement, true), coalesce(p_upfront_fees, 0), coalesce(p_fee_per_installment, 0),
          coalesce(p_auto_pay, false), coalesce(p_payment_method, 'BANK'), p_notes, v_actor)
  RETURNING id INTO v_id;

  INSERT INTO lb_loan_installments (tenant_id, business_id, loan_id, seq, due_date, principal_due, interest_due, fees_due, status, paid_on, pre_app)
  SELECT v_tenant, p_business_id, v_id, s.seq, s.due_date, s.principal_due, s.interest_due, s.fees_due,
         CASE WHEN s.seq <= coalesce(p_paid_before_count, 0) THEN 'PAID' ELSE 'PENDING' END,
         CASE WHEN s.seq <= coalesce(p_paid_before_count, 0) THEN s.due_date END,
         s.seq <= coalesce(p_paid_before_count, 0)
    FROM loan_preview_schedule(p_principal, p_interest_method, p_rate, coalesce(p_rate_period, 'YEAR'), p_term_count, p_frequency, p_first_due, coalesce(p_fee_per_installment, 0)) s;

  IF coalesce(p_upfront_fees, 0) > 0 THEN
    SELECT id INTO v_cat FROM lb_expense_categories WHERE lower(name) = 'loan interest & charges' AND is_active = true ORDER BY tenant_id NULLS FIRST LIMIT 1;
    v_fee_exp := record_expense(p_business_id, NULL, v_cat, least(v_disb, _loan_today()), p_upfront_fees, coalesce(p_payment_method, 'BANK')::lb_payment_method,
                                format('Loan processing fee — %s', btrim(p_lender_name)), NULL, 'PAID', _loan_expense_actor(v_actor));
    UPDATE lb_loans SET upfront_fee_expense_id = v_fee_exp WHERE id = v_id;
  END IF;

  -- an auto-pay loan whose first date is already past is brought up to date straight away (dates backfilled)
  IF coalesce(p_auto_pay, false) THEN v_posted := loan_post_due(p_business_id); END IF;

  PERFORM _loan_audit('loan.create', v_id, jsonb_build_object('lender', p_lender_name, 'principal', p_principal, 'instalments', p_term_count, 'auto_pay', coalesce(p_auto_pay, false)));
  RETURN _pos_finish_op(p_client_reference, jsonb_build_object('id', v_id, 'auto_posted', coalesce((v_posted ->> 'posted')::int, 0)));
END $$;
