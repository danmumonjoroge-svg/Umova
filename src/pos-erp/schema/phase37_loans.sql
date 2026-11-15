-- phase37_loans.sql   (My Loans: bank / SACCO / M-Pesa / other loans, linked to My Spending and reminders)
-- STATUS: written and tested on a SCRATCH database only (schema/tests/phase37_run.sh). NOT run on any real database.
--
-- WHAT IT DOES
--   Lets the owner record a loan once. The instalment schedule is worked out here, in the database, by ONE function
--   (loan_preview_schedule) that both the preview screen and the real save use, so the screen and the books cannot disagree.
--   Each instalment is split in two:
--     * PRINCIPAL  = paying back borrowed money. Reduces what you owe. It is NOT an expense and never touches My Profit.
--     * INTEREST + FEES = the real cost of the loan. Posted to My Spending (lb_expenses) in the category
--       "Loan Interest & Charges", through the same record_expense() that equipment depreciation (phase 9) already uses.
--   An instalment with no interest and no fee (an interest-free loan) is simply marked paid; nothing is posted.
--
-- WHEN THINGS ARE POSTED
--   * Auto-pay loans (standing order, salary or SACCO deduction): loan_post_due() posts every instalment whose date has come,
--     dated on its DUE date, the next time anyone opens the app. It never posts twice (row locks + status check).
--   * Other loans: the owner or anyone with expenses.record taps "Mark as paid" (loan_mark_paid). Dated on the due date when paid
--     late, on the day paid when paid early (an expense is never dated in the future).
--   * "Undo" (owner only) sets the posted expense to REJECTED (which every report already ignores) and puts the instalment back.
--     An undone instalment is never auto-posted again; it must be marked paid by hand.
--
-- WHO MAY DO WHAT (checked in the database, not only on screen)
--   add a loan / change a schedule / auto-pay / close / undo ... business OWNER only (is_pos_owner)
--   mark an instalment paid ................................... expenses.record  (existing key; no new permission keys)
--   see loans ................................................. anyone in the business (the My Money menu is already gated)
--   loan_post_due() runs for any signed-in POS session (it takes no amounts: only what the owner's schedule says is due).
--   lb_expenses already has a phase28 trigger that needs expenses.record for POS sessions; a person without it simply
--   leaves those instalments for someone who has it (reported as "skipped", never an error).
--
-- "TODAY" is Africa/Nairobi time (_loan_today()), not the server's UTC, so an instalment due today is due from midnight Kenya time.
--
-- WHAT IS DELIBERATELY NOT HERE
--   * No scheduled (midnight) job. Not until record_expense() is confirmed to work with no signed-in person (see
--     schema/diagnostics/loans_precheck.sql). Posting on app-open with backfilled dates gives the same books.
--   * (Part and over payments, arrears/advance status and the interest-before-principal rule were added afterwards in phase38_loan_part_payments.sql. Run that after this file.)
--   * Interest that has built up but is not yet due is not accrued; cost is recognised on the instalment's date (simple, owner-readable).
--
-- BEFORE YOU RUN (staging first)
--   1. Run schema/diagnostics/loans_precheck.sql and send me the results (read-only).
--   2. phase27_branding.sql (is_pos_owner), phase28_permissions.sql (pos_require) and phase35_offline_idempotency.sql must already be there.
--   3. Run this file once. Safe to run twice.
-- ROLLBACK
--   DROP FUNCTION loan_* and _loan_*;  DROP TABLE lb_loan_installments, lb_loans;   (the "Loan Interest & Charges" category and any
--   expenses already posted stay; reject those expenses first if you want them gone.)

DO $$ BEGIN
  IF to_regprocedure('pos_require(text[])') IS NULL OR to_regprocedure('_pos_claim_op(text,text,text)') IS NULL
     OR to_regprocedure('_pos_finish_op(text,jsonb)') IS NULL OR to_regprocedure('get_current_tenant_id()') IS NULL
     OR to_regprocedure('is_pos_owner()') IS NULL OR to_regprocedure('is_pos_session()') IS NULL THEN
    RAISE EXCEPTION 'phase37 needs phase27 (is_pos_owner), phase28 (pos_require) and phase35 (_pos_claim_op) first.';
  END IF;
END $$;

-- ============================================================ tables ============================================================

CREATE TABLE IF NOT EXISTS lb_loans (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  business_id            uuid NOT NULL REFERENCES lb_businesses(id),
  lender_name            text NOT NULL CHECK (length(btrim(lender_name)) > 0),
  lender_type            text NOT NULL CHECK (lender_type IN ('BANK','SACCO','MPESA','OTHER')),
  reference_no           text,
  principal              numeric(15,2) NOT NULL CHECK (principal > 0),
  interest_method        text NOT NULL CHECK (interest_method IN ('FLAT','REDUCING','NONE')),
  rate                   numeric(9,4)  NOT NULL DEFAULT 0 CHECK (rate >= 0),
  rate_period            text NOT NULL DEFAULT 'YEAR' CHECK (rate_period IN ('YEAR','MONTH')),   -- "14% a year" or "1% a month"
  term_count             integer NOT NULL CHECK (term_count BETWEEN 1 AND 360),
  frequency              text NOT NULL CHECK (frequency IN ('MONTHLY','WEEKLY')),
  first_due_date         date NOT NULL,
  disbursed_on           date NOT NULL,
  record_disbursement    boolean NOT NULL DEFAULT true,   -- false: an older loan whose money was received before this app was used
  upfront_fees           numeric(15,2) NOT NULL DEFAULT 0 CHECK (upfront_fees >= 0),
  upfront_fee_expense_id uuid REFERENCES lb_expenses(id),
  fee_per_installment    numeric(15,2) NOT NULL DEFAULT 0 CHECK (fee_per_installment >= 0),
  auto_pay               boolean NOT NULL DEFAULT false,
  payment_method         text NOT NULL DEFAULT 'BANK' CHECK (payment_method IN ('BANK','MOBILE_MONEY','CASH','OTHER')),
  status                 text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLEARED','CLOSED','CANCELLED')),
  notes                  text,
  closed_at              timestamptz,
  created_by             uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lb_loans_tenant_idx ON lb_loans (tenant_id, business_id, status);

CREATE TABLE IF NOT EXISTS lb_loan_installments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  business_id   uuid NOT NULL REFERENCES lb_businesses(id),
  loan_id       uuid NOT NULL REFERENCES lb_loans(id) ON DELETE CASCADE,
  seq           integer NOT NULL CHECK (seq >= 1),
  due_date      date NOT NULL,
  principal_due numeric(15,2) NOT NULL DEFAULT 0 CHECK (principal_due >= 0),
  interest_due  numeric(15,2) NOT NULL DEFAULT 0 CHECK (interest_due >= 0),
  fees_due      numeric(15,2) NOT NULL DEFAULT 0 CHECK (fees_due >= 0),
  status        text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','CANCELLED')),
  paid_on       date,
  pre_app       boolean NOT NULL DEFAULT false,   -- already paid before the loan was entered here: no expense, no cash effect
  auto_posted   boolean NOT NULL DEFAULT false,
  manual_only   boolean NOT NULL DEFAULT false,   -- set by Undo: never auto-post this one again
  edited        boolean NOT NULL DEFAULT false,   -- the owner changed it to match the lender's statement
  expense_id    uuid REFERENCES lb_expenses(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loan_id, seq),
  CHECK (principal_due + interest_due + fees_due > 0)
);
CREATE INDEX IF NOT EXISTS lb_loan_inst_due_idx ON lb_loan_installments (tenant_id, status, due_date);
CREATE UNIQUE INDEX IF NOT EXISTS lb_loan_inst_expense_uq ON lb_loan_installments (expense_id) WHERE expense_id IS NOT NULL;

-- Reading: anyone in the business. Writing: NOBODY directly -- only the functions below (RLS on, no write policy, no write grant).
ALTER TABLE lb_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE lb_loan_installments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS loans_read ON lb_loans;
CREATE POLICY loans_read ON lb_loans FOR SELECT USING (tenant_id = get_current_tenant_id());
DROP POLICY IF EXISTS loan_installments_read ON lb_loan_installments;
CREATE POLICY loan_installments_read ON lb_loan_installments FOR SELECT USING (tenant_id = get_current_tenant_id());
REVOKE ALL ON lb_loans, lb_loan_installments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON lb_loans, lb_loan_installments TO authenticated;

-- The expense category (columns confirmed against the live table: name, is_system, is_active, sort_order, tenant_id).
INSERT INTO lb_expense_categories (tenant_id, name, is_system, is_active, sort_order)
SELECT NULL, 'Loan Interest & Charges', true, true, 98
WHERE NOT EXISTS (SELECT 1 FROM lb_expense_categories WHERE lower(name) = 'loan interest & charges');

-- ============================================================ helpers ============================================================

CREATE OR REPLACE FUNCTION _loan_today() RETURNS date LANGUAGE sql STABLE
AS $$ SELECT (now() AT TIME ZONE 'Africa/Nairobi')::date $$;

CREATE OR REPLACE FUNCTION _loan_require_owner() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF is_pos_session() AND NOT is_pos_owner() THEN
    RAISE EXCEPTION 'Only the business owner can do that.' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION _loan_audit(p_action text, p_entity uuid, p_meta jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF to_regclass('public.pos_audit_log') IS NULL THEN RETURN; END IF;
  INSERT INTO pos_audit_log (pos_tenant_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (get_current_tenant_id(), 'staff', nullif(auth.jwt() ->> 'pos_staff_id', '')::uuid, p_action, 'loan', p_entity, p_meta);
END $$;

-- ============================================================ the schedule calculator (the ONE implementation) ============================================================
-- FLAT      total interest = principal x yearly rate x (instalments / instalments-per-year), shared evenly; principal shared evenly.
-- REDUCING  equal instalments (standard annuity); interest each time = balance x rate for the period; the last one clears the balance.
-- NONE      no interest.
-- Rate may be given per YEAR or per MONTH (a SACCO says "1% a month"; a bank says "14% a year"). Everything is rounded to cents
-- and the LAST instalment absorbs the rounding, so the principal column always adds up to exactly the loan amount.
CREATE OR REPLACE FUNCTION loan_preview_schedule(
  p_principal numeric, p_method text, p_rate numeric, p_rate_period text, p_count integer, p_frequency text,
  p_first_due date, p_fee_per numeric DEFAULT 0
) RETURNS TABLE (seq integer, due_date date, principal_due numeric, interest_due numeric, fees_due numeric)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_ppy numeric; v_annual numeric; v_r numeric; v_bal numeric; v_pay numeric;
  v_total_int numeric; v_per_int numeric; v_per_prin numeric;
  v_sum_prin numeric := 0; v_sum_int numeric := 0; v_prin numeric; v_int numeric; i integer;
BEGIN
  IF p_principal IS NULL OR p_principal <= 0 THEN RAISE EXCEPTION 'The loan amount must be more than zero.' USING ERRCODE = '22023'; END IF;
  IF p_count IS NULL OR p_count < 1 OR p_count > 360 THEN RAISE EXCEPTION 'The number of instalments must be between 1 and 360.' USING ERRCODE = '22023'; END IF;
  IF p_method NOT IN ('FLAT','REDUCING','NONE') THEN RAISE EXCEPTION 'Interest method must be FLAT, REDUCING or NONE.' USING ERRCODE = '22023'; END IF;
  IF p_frequency NOT IN ('MONTHLY','WEEKLY') THEN RAISE EXCEPTION 'Frequency must be MONTHLY or WEEKLY.' USING ERRCODE = '22023'; END IF;
  IF p_rate_period NOT IN ('YEAR','MONTH') THEN RAISE EXCEPTION 'Rate period must be YEAR or MONTH.' USING ERRCODE = '22023'; END IF;
  IF p_first_due IS NULL THEN RAISE EXCEPTION 'The first due date is required.' USING ERRCODE = '22023'; END IF;
  IF coalesce(p_rate, 0) < 0 OR coalesce(p_fee_per, 0) < 0 THEN RAISE EXCEPTION 'Rate and fees cannot be negative.' USING ERRCODE = '22023'; END IF;
  IF p_method <> 'NONE' AND coalesce(p_rate, 0) = 0 THEN RAISE EXCEPTION 'Enter the interest rate, or choose "No interest".' USING ERRCODE = '22023'; END IF;

  v_ppy    := CASE p_frequency WHEN 'MONTHLY' THEN 12 ELSE 52 END;
  v_annual := CASE WHEN p_method = 'NONE' THEN 0 WHEN p_rate_period = 'MONTH' THEN p_rate * 12 ELSE p_rate END;   -- percent a year
  v_r      := v_annual / 100 / v_ppy;
  v_bal    := p_principal;

  IF p_method = 'FLAT' THEN
    v_total_int := round(p_principal * v_annual / 100 * p_count / v_ppy, 2);
    v_per_int   := round(v_total_int / p_count, 2);
    v_per_prin  := round(p_principal / p_count, 2);
  ELSIF p_method = 'REDUCING' THEN
    v_pay := round(p_principal * v_r / (1 - power(1 + v_r, -p_count)), 2);
  ELSE
    v_per_prin := round(p_principal / p_count, 2);
  END IF;

  FOR i IN 1..p_count LOOP
    IF p_method = 'FLAT' THEN
      v_prin := v_per_prin; v_int := v_per_int;
      IF i = p_count THEN v_prin := p_principal - v_sum_prin; v_int := v_total_int - v_sum_int; END IF;
    ELSIF p_method = 'REDUCING' THEN
      v_int  := round(v_bal * v_r, 2);
      v_prin := greatest(v_pay - v_int, 0);
      IF i = p_count OR v_prin > v_bal THEN v_prin := v_bal; END IF;
    ELSE
      v_prin := v_per_prin; v_int := 0;
      IF i = p_count THEN v_prin := p_principal - v_sum_prin; END IF;
    END IF;
    v_sum_prin := v_sum_prin + v_prin; v_sum_int := v_sum_int + v_int; v_bal := v_bal - v_prin;

    seq := i;
    due_date := CASE p_frequency WHEN 'MONTHLY' THEN (p_first_due + make_interval(months => i - 1))::date ELSE p_first_due + 7 * (i - 1) END;
    principal_due := v_prin; interest_due := v_int; fees_due := coalesce(p_fee_per, 0);
    RETURN NEXT;
  END LOOP;
END $$;

-- ============================================================ posting ============================================================

-- Marks ONE instalment paid and posts its interest + fees to My Spending. Returns NULL when there was nothing to do
-- (already paid / cancelled), so every caller is safe to retry. Internal: not granted to API roles.
CREATE OR REPLACE FUNCTION _loan_post_installment(p_id uuid, p_auto boolean, p_paid_on date, p_method text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  i lb_loan_installments; l lb_loans; v_amt numeric; v_exp uuid; v_paid date; v_cat uuid;
BEGIN
  SELECT * INTO i FROM lb_loan_installments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR i.status <> 'PENDING' THEN RETURN NULL; END IF;
  SELECT * INTO l FROM lb_loans WHERE id = i.loan_id;
  IF l.status <> 'ACTIVE' THEN RETURN NULL; END IF;

  v_paid := CASE WHEN p_auto THEN i.due_date ELSE coalesce(p_paid_on, _loan_today()) END;
  v_amt  := i.interest_due + i.fees_due;

  IF v_amt > 0 THEN
    SELECT id INTO v_cat FROM lb_expense_categories WHERE lower(name) = 'loan interest & charges' AND is_active = true ORDER BY tenant_id NULLS FIRST LIMIT 1;
    v_exp := record_expense(
      i.business_id, NULL, v_cat, least(i.due_date, v_paid), v_amt,
      coalesce(p_method, l.payment_method)::lb_payment_method,
      format('Loan interest & charges — %s, instalment %s of %s%s', l.lender_name, i.seq, l.term_count, CASE WHEN p_auto THEN ' (automatic)' ELSE '' END),
      NULL, 'PAID', CASE WHEN p_auto THEN NULL ELSE p_actor END
    );
  END IF;

  UPDATE lb_loan_installments
     SET status = 'PAID', paid_on = v_paid, expense_id = v_exp, auto_posted = p_auto, updated_at = now()
   WHERE id = i.id;

  IF NOT EXISTS (SELECT 1 FROM lb_loan_installments WHERE loan_id = l.id AND status = 'PENDING') THEN
    UPDATE lb_loans SET status = 'CLEARED', updated_at = now() WHERE id = l.id;
  END IF;

  RETURN jsonb_build_object('installment_id', i.id, 'expense_id', v_exp, 'expense_amount', v_amt,
                            'principal_repaid', i.principal_due, 'paid_on', v_paid, 'cleared',
                            NOT EXISTS (SELECT 1 FROM lb_loan_installments WHERE loan_id = l.id AND status = 'PENDING'));
END $$;

-- ============================================================ owner: add a loan ============================================================

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
                                format('Loan processing fee — %s', btrim(p_lender_name)), NULL, 'PAID', v_actor);
    UPDATE lb_loans SET upfront_fee_expense_id = v_fee_exp WHERE id = v_id;
  END IF;

  -- an auto-pay loan whose first date is already past is brought up to date straight away (dates backfilled)
  IF coalesce(p_auto_pay, false) THEN v_posted := loan_post_due(p_business_id); END IF;

  PERFORM _loan_audit('loan.create', v_id, jsonb_build_object('lender', p_lender_name, 'principal', p_principal, 'instalments', p_term_count, 'auto_pay', coalesce(p_auto_pay, false)));
  RETURN _pos_finish_op(p_client_reference, jsonb_build_object('id', v_id, 'auto_posted', coalesce((v_posted ->> 'posted')::int, 0)));
END $$;

-- ============================================================ posting entry points ============================================================

-- Anyone signed in can run this. It only posts what the owner's schedule says is already due, for auto-pay loans.
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
       FOR UPDATE OF i SKIP LOCKED
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

CREATE OR REPLACE FUNCTION loan_mark_paid(p_installment_id uuid, p_paid_on date DEFAULT NULL, p_method text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := get_current_tenant_id(); v_res jsonb; v_actor uuid := nullif(auth.jwt() ->> 'pos_staff_id', '')::uuid;
BEGIN
  PERFORM pos_require('expenses.record');
  IF NOT EXISTS (SELECT 1 FROM lb_loan_installments WHERE id = p_installment_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Instalment not found.' USING ERRCODE = '42501';
  END IF;
  IF p_paid_on IS NOT NULL AND p_paid_on > _loan_today() THEN RAISE EXCEPTION 'The payment date cannot be in the future.' USING ERRCODE = '22023'; END IF;
  IF p_method IS NOT NULL AND p_method NOT IN ('BANK','MOBILE_MONEY','CASH','OTHER') THEN RAISE EXCEPTION 'Unknown payment method.' USING ERRCODE = '22023'; END IF;
  v_res := _loan_post_installment(p_installment_id, false, p_paid_on, p_method, v_actor);
  IF v_res IS NULL THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  PERFORM _loan_audit('loan.installment_paid', p_installment_id, v_res);
  RETURN v_res || jsonb_build_object('ok', true, 'already', false);
END $$;

-- ============================================================ owner: corrections ============================================================

CREATE OR REPLACE FUNCTION loan_undo_payment(p_installment_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := get_current_tenant_id(); i lb_loan_installments;
BEGIN
  PERFORM _loan_require_owner();
  SELECT * INTO i FROM lb_loan_installments WHERE id = p_installment_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Instalment not found.' USING ERRCODE = '42501'; END IF;
  IF i.status <> 'PAID' THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  IF i.pre_app THEN RAISE EXCEPTION 'This instalment was paid before you started using the app, so there is nothing posted to undo.' USING ERRCODE = '22023'; END IF;
  IF i.expense_id IS NOT NULL THEN
    UPDATE lb_expenses SET status = 'REJECTED', description = coalesce(description, '') || ' (undone)', updated_at = now() WHERE id = i.expense_id;
  END IF;
  UPDATE lb_loan_installments SET status = 'PENDING', paid_on = NULL, expense_id = NULL, auto_posted = false, manual_only = true, updated_at = now() WHERE id = i.id;
  UPDATE lb_loans SET status = 'ACTIVE', closed_at = NULL, updated_at = now() WHERE id = i.loan_id AND status IN ('CLEARED');
  PERFORM _loan_audit('loan.installment_undone', i.id, jsonb_build_object('expense_id', i.expense_id));
  RETURN jsonb_build_object('ok', true, 'already', false);
END $$;

-- Change one instalment so it matches the lender's own statement. Only an unpaid instalment can be changed.
CREATE OR REPLACE FUNCTION loan_update_installment(p_installment_id uuid, p_due_date date, p_principal numeric, p_interest numeric, p_fees numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := get_current_tenant_id(); i lb_loan_installments;
BEGIN
  PERFORM _loan_require_owner();
  SELECT * INTO i FROM lb_loan_installments WHERE id = p_installment_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Instalment not found.' USING ERRCODE = '42501'; END IF;
  IF i.status <> 'PENDING' THEN RAISE EXCEPTION 'Only an unpaid instalment can be changed. Undo the payment first.' USING ERRCODE = '22023'; END IF;
  IF p_due_date IS NULL OR coalesce(p_principal, -1) < 0 OR coalesce(p_interest, -1) < 0 OR coalesce(p_fees, -1) < 0 OR coalesce(p_principal,0) + coalesce(p_interest,0) + coalesce(p_fees,0) <= 0 THEN
    RAISE EXCEPTION 'Enter a date and amounts that are not negative (and not all zero).' USING ERRCODE = '22023';
  END IF;
  UPDATE lb_loan_installments SET due_date = p_due_date, principal_due = p_principal, interest_due = p_interest, fees_due = p_fees, edited = true, updated_at = now() WHERE id = i.id;
  PERFORM _loan_audit('loan.installment_edited', i.id, jsonb_build_object('from', jsonb_build_object('due', i.due_date, 'principal', i.principal_due, 'interest', i.interest_due, 'fees', i.fees_due),
                                                                       'to', jsonb_build_object('due', p_due_date, 'principal', p_principal, 'interest', p_interest, 'fees', p_fees)));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION loan_set_auto_pay(p_loan_id uuid, p_auto boolean, p_method text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := get_current_tenant_id(); l lb_loans; v_posted jsonb;
BEGIN
  PERFORM _loan_require_owner();
  SELECT * INTO l FROM lb_loans WHERE id = p_loan_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loan not found.' USING ERRCODE = '42501'; END IF;
  IF p_method IS NOT NULL AND p_method NOT IN ('BANK','MOBILE_MONEY','CASH','OTHER') THEN RAISE EXCEPTION 'Unknown payment method.' USING ERRCODE = '22023'; END IF;
  UPDATE lb_loans SET auto_pay = coalesce(p_auto, false), payment_method = coalesce(p_method, payment_method), updated_at = now() WHERE id = l.id;
  PERFORM _loan_audit('loan.auto_pay', l.id, jsonb_build_object('auto_pay', coalesce(p_auto, false)));
  IF coalesce(p_auto, false) THEN v_posted := loan_post_due(l.business_id); END IF;   -- switching it on catches up anything already due
  RETURN jsonb_build_object('ok', true, 'posted', coalesce((v_posted ->> 'posted')::int, 0));
END $$;

-- SETTLED : the loan was paid off early. Remaining unpaid instalments are cancelled; history stays.
--           (To record the final settlement amount, first edit the next instalment to the lender's figure and mark it paid.)
-- CANCEL  : the loan was entered by mistake. Allowed only while nothing has been posted for it (undo any payments first);
--           the fee expense, if any, is rejected.
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
    IF EXISTS (SELECT 1 FROM lb_loan_installments WHERE loan_id = l.id AND status = 'PAID' AND NOT pre_app) THEN
      RAISE EXCEPTION 'Instalments have already been paid on this loan. Undo them first, or close it as paid off early.' USING ERRCODE = '22023';
    END IF;
    IF l.upfront_fee_expense_id IS NOT NULL THEN
      UPDATE lb_expenses SET status = 'REJECTED', description = coalesce(description, '') || ' (loan cancelled)', updated_at = now() WHERE id = l.upfront_fee_expense_id;
    END IF;
    UPDATE lb_loan_installments SET status = 'CANCELLED', updated_at = now() WHERE loan_id = l.id AND status = 'PENDING';
    UPDATE lb_loans SET status = 'CANCELLED', closed_at = now(), updated_at = now() WHERE id = l.id;
  ELSE
    UPDATE lb_loan_installments SET status = 'CANCELLED', updated_at = now() WHERE loan_id = l.id AND status = 'PENDING';
    UPDATE lb_loans SET status = 'CLOSED', closed_at = now(), updated_at = now() WHERE id = l.id;
  END IF;
  PERFORM _loan_audit('loan.close', l.id, jsonb_build_object('mode', p_mode));
  RETURN jsonb_build_object('ok', true, 'already', false);
END $$;

-- ============================================================ grants ============================================================
REVOKE ALL ON FUNCTION _loan_today(), _loan_require_owner(), _loan_audit(text, uuid, jsonb), _loan_post_installment(uuid, boolean, date, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION loan_preview_schedule(numeric, text, numeric, text, integer, text, date, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION loan_create(text, uuid, text, text, text, numeric, text, numeric, text, integer, text, date, date, numeric, numeric, boolean, text, integer, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION loan_post_due(uuid), loan_mark_paid(uuid, date, text), loan_undo_payment(uuid), loan_update_installment(uuid, date, numeric, numeric, numeric),
                       loan_set_auto_pay(uuid, boolean, text), loan_close(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION loan_preview_schedule(numeric, text, numeric, text, integer, text, date, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION loan_create(text, uuid, text, text, text, numeric, text, numeric, text, integer, text, date, date, numeric, numeric, boolean, text, integer, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION loan_post_due(uuid), loan_mark_paid(uuid, date, text), loan_undo_payment(uuid), loan_update_installment(uuid, date, numeric, numeric, numeric),
                          loan_set_auto_pay(uuid, boolean, text), loan_close(uuid, text) TO authenticated;
