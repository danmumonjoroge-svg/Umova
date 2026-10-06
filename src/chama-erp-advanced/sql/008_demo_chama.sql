-- =============================================================================
-- 008 — DEMO CHAMA ("Mwangaza Self-Help Group")
--
-- A fully populated, FREE-PLAN chama for showing prospects the product.
--   * license_plan = 'free'  -> no expiry, no countdown badge, never locked out
--   * 12 members, one per role + ordinary members + 1 pending applicant
--   * 6 months of posted contributions with matching ledger entries, so
--     "My statement", Home and balances all reconcile
--   * Loans in every state: closed, active, approved-awaiting-disbursement,
--     awaiting approval, pending, rejected
--   * Treasurer queue with live work (pending / verified / rejected)
--   * Welfare: open + closed cases, pledges, external + anonymous gifts,
--     events with tasks
--   * Announcements (pinned meeting, reminder, notice)
--
-- PREREQUISITES: 001, 002, 006, 007 and welfare/migrations.sql already run.
-- (005_billing.sql is NOT required — the demo chama is created directly on the
-- free plan.) A pre-flight check below tells you exactly which one is missing.
-- SAFE TO RE-RUN: the first block wipes the demo chama (chama_no CHM-DEMO01)
-- and its logins, then rebuilds it with dates relative to today. Run it before
-- every demo to reset the data. It never touches any other chama.
--
-- LOGINS (password for all: Demo1234)
--   0711000001 Grace Wanjiku   chairperson
--   0711000002 Peter Kamau     secretary
--   0711000003 Mary Atieno     treasurer
--   0711000004 John Mwangi     welfare_officer
--   0711000005 Esther Njeri    member   (has an active loan)
--   0711000006 ... 0711000011  members
--   0711000012 Daniel Ochieng  pending applicant (approve him live)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PRE-FLIGHT: fail early with a clear list of what's missing
-- -----------------------------------------------------------------------------
do $$
declare
  missing text[] := array[]::text[];
begin
  if to_regprocedure('register_user(text,text,text,uuid)') is null then
    missing := array_append(missing, 'function register_user  -> run 002_auth_and_licensing.sql');
  end if;
  if to_regclass('chama_members') is null or to_regclass('chama_ledger_entries') is null
     or to_regclass('chama_loan_applications') is null or to_regclass('welfare_cases') is null then
    missing := array_append(missing, 'core tables (members/ledger/loans/welfare)  -> run 001_schema_upgrade.sql');
  end if;
  if not exists (select 1 from information_schema.columns where table_name='chamas' and column_name='license_plan') then
    missing := array_append(missing, 'chamas.license_plan  -> run 002_auth_and_licensing.sql');
  end if;
  if not exists (select 1 from information_schema.columns where table_name='chama_members' and column_name='national_id') then
    missing := array_append(missing, 'chama_members.national_id  -> run 006_fixes_and_hardening.sql');
  end if;
  if not exists (select 1 from information_schema.columns where table_name='chama_contribution_requests' and column_name='loan_id') then
    missing := array_append(missing, 'chama_contribution_requests.loan_id  -> run 006_fixes_and_hardening.sql');
  end if;
  if to_regclass('chama_announcements') is null then
    missing := array_append(missing, 'table chama_announcements  -> run 007_announcements.sql');
  end if;
  if not exists (select 1 from information_schema.columns where table_name='welfare_cases' and column_name='campaign_status') then
    missing := array_append(missing, 'welfare_cases.campaign_status  -> run welfare/migrations.sql');
  end if;
  if not exists (select 1 from information_schema.columns where table_name='welfare_contributions' and column_name='is_pledge') then
    missing := array_append(missing, 'welfare_contributions.is_pledge  -> run welfare/migrations.sql');
  end if;
  if array_length(missing, 1) > 0 then
    raise exception E'Demo chama cannot be created yet. Missing:\n  - %', array_to_string(missing, E'\n  - ');
  end if;
end $$;

do $$
declare
  v_chama uuid;
  v_old uuid;
  t text;
  v_ids uuid[] := array[]::uuid[];

  -- members
  m_chair uuid; m_sec uuid; m_treas uuid; m_welf uuid;
  m_esther uuid; m_samuel uuid; m_faith uuid; m_david uuid; m_lucy uuid;
  m_joseph uuid; m_ruth uuid; m_daniel uuid;

  acc_bank uuid; acc_mpesa uuid;

  r record;
  i int;
  mo int;
  v_amt numeric;
  v_date date;
  v_req uuid;
  v_led uuid;
  v_acc uuid;

  -- loans
  app1 uuid; app2 uuid; app3 uuid;
  loan1 uuid; loan2 uuid; loan3 uuid;
  rep uuid;

  -- welfare
  case1 uuid; case2 uuid; case3 uuid;
  ev1 uuid; ev2 uuid; ev3 uuid;
begin
  ---------------------------------------------------------------------------
  -- 0. RESET: remove any previous demo chama and its logins
  ---------------------------------------------------------------------------
  select id into v_old from chamas where chama_no = 'CHM-DEMO01';
  if v_old is not null then
    -- children without a chama_id column
    if to_regclass('welfare_event_budget_revisions') is not null then
      execute 'delete from welfare_event_budget_revisions where budget_line_id in (select id from welfare_event_budget_lines where event_id in (select id from welfare_events where chama_id = $1))' using v_old;
    end if;
    if to_regclass('welfare_event_budget_lines') is not null then
      execute 'delete from welfare_event_budget_lines where event_id in (select id from welfare_events where chama_id = $1)' using v_old;
    end if;
    delete from welfare_event_tasks where event_id in (select id from welfare_events where chama_id = v_old);
    delete from welfare_case_participants where case_id in (select id from welfare_cases where chama_id = v_old);

    -- tables with a chama_id, children before parents
    foreach t in array array[
      'audit_log','chama_contribution_requests','chama_loan_repayments','chama_loans',
      'chama_loan_applications','chama_loan_rules','chama_ledger_entries',
      'welfare_contributions','welfare_member_access','chama_announcements',
      'chama_payments','welfare_events','welfare_cases','chama_bank_accounts','chama_members'
    ] loop
      if to_regclass(t) is not null
         and exists (select 1 from information_schema.columns where table_name = t and column_name = 'chama_id') then
        execute format('delete from %I where chama_id = $1', t) using v_old;
      end if;
    end loop;
    delete from chamas where id = v_old;
  end if;
  delete from chama_users where phone_number like '07110000%';

  ---------------------------------------------------------------------------
  -- 1. The chama — FREE plan (no expiry, no billing countdown)
  ---------------------------------------------------------------------------
  insert into chamas (name, chama_no, license_status, license_expiry, license_plan)
  values ('Mwangaza Self-Help Group (DEMO)', 'CHM-DEMO01', 'active', null, 'free')
  returning id into v_chama;

  ---------------------------------------------------------------------------
  -- 2. Members (joined 14-24 months ago so loan-eligibility rules pass)
  ---------------------------------------------------------------------------
  insert into chama_members (chama_id, name, phone, role, status, national_id, joined_at, approved_at)
  values
    (v_chama,'Grace Wanjiku','0711000001','chairperson',    'active','24510001', now() - interval '24 months', now() - interval '24 months'),
    (v_chama,'Peter Kamau',  '0711000002','secretary',      'active','24510002', now() - interval '24 months', now() - interval '24 months'),
    (v_chama,'Mary Atieno',  '0711000003','treasurer',      'active','24510003', now() - interval '23 months', now() - interval '23 months'),
    (v_chama,'John Mwangi',  '0711000004','welfare_officer','active','24510004', now() - interval '22 months', now() - interval '22 months'),
    (v_chama,'Esther Njeri', '0711000005','member',         'active','24510005', now() - interval '20 months', now() - interval '20 months'),
    (v_chama,'Samuel Otieno','0711000006','member',         'active','24510006', now() - interval '20 months', now() - interval '20 months'),
    (v_chama,'Faith Chebet', '0711000007','member',         'active','24510007', now() - interval '18 months', now() - interval '18 months'),
    (v_chama,'David Kiprono','0711000008','member',         'active','24510008', now() - interval '16 months', now() - interval '16 months'),
    (v_chama,'Lucy Wambui',  '0711000009','member',         'active','24510009', now() - interval '16 months', now() - interval '16 months'),
    (v_chama,'Joseph Mutua', '0711000010','member',         'active','24510010', now() - interval '14 months', now() - interval '14 months'),
    (v_chama,'Ruth Akinyi',  '0711000011','member',         'active','24510011', now() - interval '14 months', now() - interval '14 months'),
    (v_chama,'Daniel Ochieng','0711000012','member',        'pending','24510012', now() - interval '2 days',   null);

  select id into m_chair  from chama_members where chama_id = v_chama and phone = '0711000001';
  select id into m_sec    from chama_members where chama_id = v_chama and phone = '0711000002';
  select id into m_treas  from chama_members where chama_id = v_chama and phone = '0711000003';
  select id into m_welf   from chama_members where chama_id = v_chama and phone = '0711000004';
  select id into m_esther from chama_members where chama_id = v_chama and phone = '0711000005';
  select id into m_samuel from chama_members where chama_id = v_chama and phone = '0711000006';
  select id into m_faith  from chama_members where chama_id = v_chama and phone = '0711000007';
  select id into m_david  from chama_members where chama_id = v_chama and phone = '0711000008';
  select id into m_lucy   from chama_members where chama_id = v_chama and phone = '0711000009';
  select id into m_joseph from chama_members where chama_id = v_chama and phone = '0711000010';
  select id into m_ruth   from chama_members where chama_id = v_chama and phone = '0711000011';
  select id into m_daniel from chama_members where chama_id = v_chama and phone = '0711000012';

  ---------------------------------------------------------------------------
  -- 3. Chama accounts
  ---------------------------------------------------------------------------
  insert into chama_bank_accounts (chama_id, account_name, account_type, provider, account_number, is_active, opening_balance)
  values (v_chama, 'Mwangaza Main Account', 'bank', 'Equity Bank', '0123456789012', true, 0)
  returning id into acc_bank;
  insert into chama_bank_accounts (chama_id, account_name, account_type, provider, account_number, is_active, opening_balance)
  values (v_chama, 'Mwangaza M-Pesa Paybill', 'mpesa', 'M-Pesa', '400200', true, 0)
  returning id into acc_mpesa;

  ---------------------------------------------------------------------------
  -- 4. Six months of POSTED contributions + ledger (savings / shares / welfare)
  --    Same shape post_contribution() produces, with historical dates.
  --    Samuel skips 2 months ago and Joseph skips last month (realistic arrears).
  ---------------------------------------------------------------------------
  for r in
    select * from (values
      (m_chair, 5000), (m_sec, 3000), (m_treas, 5000), (m_welf, 2000), (m_esther, 3000),
      (m_samuel, 2000), (m_faith, 4000), (m_david, 2000), (m_lucy, 3000), (m_joseph, 2000),
      (m_ruth, 2000)
    ) as x(mid, monthly)
  loop
    for mo in reverse 5..0 loop
      -- skip pattern for arrears realism
      if (r.mid = m_samuel and mo = 2) or (r.mid = m_joseph and mo = 1) then
        continue;
      end if;
      v_date := least(current_date, (date_trunc('month', current_date) - (mo || ' months')::interval)::date + 4 + (abs(hashtext(r.mid::text)) % 4));
      v_acc := case when abs(hashtext(r.mid::text)) % 2 = 0 then acc_mpesa else acc_bank end;

      foreach t in array array['savings','shares','welfare'] loop
        v_amt := case t when 'savings' then r.monthly when 'shares' then 500 else 200 end;

        insert into chama_contribution_requests (
          chama_id, member_id, bank_account_id, amount, contribution_type, contributed_on,
          payment_method, transaction_ref, status, verified_by, verified_at, bank_statement_amount,
          approved_by, approved_at, posted, created_at
        ) values (
          v_chama, r.mid, v_acc, v_amt, t, v_date,
          case when v_acc = acc_mpesa then 'MPESA' else 'BANK' end,
          'QJ' || upper(substr(md5(random()::text), 1, 8)), 'APPROVED', m_treas, v_date + time '14:00', v_amt,
          m_treas, v_date + time '15:00', true, v_date + time '09:00'
        ) returning id into v_req;

        insert into chama_ledger_entries (chama_id, member_id, account_type, direction, amount, source_type, source_id, description, created_by, created_at)
        values (v_chama, r.mid, t, 'credit', v_amt, 'contribution', v_req,
                'Contribution verified against account, ref demo', m_treas, v_date + time '15:00')
        returning id into v_led;

        update chama_contribution_requests set posted_ledger_entry_id = v_led where id = v_req;
      end loop;
    end loop;
  end loop;

  ---------------------------------------------------------------------------
  -- 5. Loan rules
  ---------------------------------------------------------------------------
  insert into chama_loan_rules (
    chama_id, savings_multiplier, max_loan_amount, min_membership_months, requires_guarantors,
    min_guarantors, guarantor_coverage_percent, default_interest_rate, default_interest_type,
    required_approvals, approver_roles, max_active_loans_per_member, updated_by
  ) values (
    v_chama, 3, 100000, 3, true, 2, 100, 5, 'flat_monthly',
    3, '["secretary","treasurer","chairperson"]'::jsonb, 1, m_chair
  );

  ---------------------------------------------------------------------------
  -- 6. Loans in every state
  ---------------------------------------------------------------------------
  -- L2: Samuel — 25,000 over 3 months, disbursed 5 months ago, FULLY REPAID (closed)
  app2 := gen_random_uuid(); loan2 := gen_random_uuid();
  insert into chama_loan_applications (id, chama_id, member_id, member_name, requested_amount, purpose, repayment_months, interest_rate, interest_type,
      guarantors, status, required_approvals, approver_roles, approvals, loan_id, approved_at, created_at)
  values (app2, v_chama, m_samuel, 'Samuel Otieno', 25000, 'Stock for hardware shop', 3, 5, 'flat_monthly',
      jsonb_build_array(jsonb_build_object('id','g1','memberId',m_chair,'amount',13000), jsonb_build_object('id','g2','memberId',m_treas,'amount',12000)),
      'Approved', 3, '["secretary","treasurer","chairperson"]'::jsonb,
      jsonb_build_array(
        jsonb_build_object('role','secretary','member_id',m_sec,'name','Peter Kamau','decision','approve','comment','Eligible','decided_at', now() - interval '5 months 3 days'),
        jsonb_build_object('role','treasurer','member_id',m_treas,'name','Mary Atieno','decision','approve','comment','Funds available','decided_at', now() - interval '5 months 2 days'),
        jsonb_build_object('role','chairperson','member_id',m_chair,'name','Grace Wanjiku','decision','approve','comment','Approved','decided_at', now() - interval '5 months 2 days')),
      loan2, now() - interval '5 months 2 days', now() - interval '5 months 5 days');
  insert into chama_loans (id, chama_id, member_id, member_name, application_id, amount, interest_rate, interest_type, repayment_months,
      balance, disbursed, disbursement_date, disbursement_source, disbursed_by, status, created_at)
  values (loan2, v_chama, m_samuel, 'Samuel Otieno', app2, 25000, 5, 'flat_monthly', 3,
      0, true, (current_date - interval '5 months')::date, acc_bank, m_treas, 'closed', now() - interval '5 months 2 days');
  insert into chama_ledger_entries (chama_id, member_id, account_type, direction, amount, source_type, source_id, description, created_by, created_at)
  values (v_chama, m_samuel, 'loan_disbursement', 'debit', 25000, 'loan_disbursement', loan2, 'Loan disbursed to member', m_treas, now() - interval '5 months');
  for mo in reverse 4..2 loop
    v_date := (date_trunc('month', current_date) - (mo || ' months')::interval)::date + 9;
    insert into chama_loan_repayments (chama_id, loan_id, member_id, amount, paid_on, method, reference, recorded_by, created_at)
    values (v_chama, loan2, m_samuel, case mo when 2 then 8334 else 8333 end, v_date, 'MPESA', 'RP' || upper(substr(md5(random()::text),1,8)), m_treas, v_date + time '12:00')
    returning id into rep;
    insert into chama_ledger_entries (chama_id, member_id, account_type, direction, amount, source_type, source_id, description, created_by, created_at)
    values (v_chama, m_samuel, 'loan_repayment', 'credit', case mo when 2 then 8334 else 8333 end, 'loan_repayment', rep, 'Loan repayment', m_treas, v_date + time '12:00');
  end loop;

  -- L1: Esther — 40,000 over 4 months, disbursed 3 months ago, 30,000 repaid, balance 10,000 (ACTIVE)
  app1 := gen_random_uuid(); loan1 := gen_random_uuid();
  insert into chama_loan_applications (id, chama_id, member_id, member_name, requested_amount, purpose, repayment_months, interest_rate, interest_type,
      guarantors, status, required_approvals, approver_roles, approvals, loan_id, approved_at, created_at)
  values (app1, v_chama, m_esther, 'Esther Njeri', 40000, 'School fees (Term 2)', 4, 5, 'flat_monthly',
      jsonb_build_array(jsonb_build_object('id','g1','memberId',m_faith,'amount',20000), jsonb_build_object('id','g2','memberId',m_lucy,'amount',20000)),
      'Approved', 3, '["secretary","treasurer","chairperson"]'::jsonb,
      jsonb_build_array(
        jsonb_build_object('role','secretary','member_id',m_sec,'name','Peter Kamau','decision','approve','comment','Meets rules','decided_at', now() - interval '3 months 4 days'),
        jsonb_build_object('role','treasurer','member_id',m_treas,'name','Mary Atieno','decision','approve','comment','OK','decided_at', now() - interval '3 months 3 days'),
        jsonb_build_object('role','chairperson','member_id',m_chair,'name','Grace Wanjiku','decision','approve','comment','Approved','decided_at', now() - interval '3 months 3 days')),
      loan1, now() - interval '3 months 3 days', now() - interval '3 months 6 days');
  insert into chama_loans (id, chama_id, member_id, member_name, application_id, amount, interest_rate, interest_type, repayment_months,
      balance, disbursed, disbursement_date, disbursement_source, disbursed_by, status, created_at)
  values (loan1, v_chama, m_esther, 'Esther Njeri', app1, 40000, 5, 'flat_monthly', 4,
      10000, true, (current_date - interval '3 months')::date, acc_bank, m_treas, 'active', now() - interval '3 months 3 days');
  insert into chama_ledger_entries (chama_id, member_id, account_type, direction, amount, source_type, source_id, description, created_by, created_at)
  values (v_chama, m_esther, 'loan_disbursement', 'debit', 40000, 'loan_disbursement', loan1, 'Loan disbursed to member', m_treas, now() - interval '3 months');
  for mo in reverse 2..0 loop
    v_date := least(current_date - 1, (date_trunc('month', current_date) - (mo || ' months')::interval)::date + 9);
    insert into chama_loan_repayments (chama_id, loan_id, member_id, amount, paid_on, method, reference, recorded_by, created_at)
    values (v_chama, loan1, m_esther, 10000, v_date, 'MPESA', 'RP' || upper(substr(md5(random()::text),1,8)), m_treas, v_date + time '12:00')
    returning id into rep;
    insert into chama_ledger_entries (chama_id, member_id, account_type, direction, amount, source_type, source_id, description, created_by, created_at)
    values (v_chama, m_esther, 'loan_repayment', 'credit', 10000, 'loan_repayment', rep, 'Loan repayment', m_treas, v_date + time '12:00');
  end loop;

  -- L3: Faith — 60,000 over 6 months, FULLY APPROVED, awaiting disbursement (treasurer demo)
  app3 := gen_random_uuid(); loan3 := gen_random_uuid();
  insert into chama_loan_applications (id, chama_id, member_id, member_name, requested_amount, purpose, repayment_months, interest_rate, interest_type,
      guarantors, status, required_approvals, approver_roles, approvals, loan_id, approved_at, created_at)
  values (app3, v_chama, m_faith, 'Faith Chebet', 60000, 'Expand poultry unit', 6, 5, 'flat_monthly',
      jsonb_build_array(jsonb_build_object('id','g1','memberId',m_chair,'amount',30000), jsonb_build_object('id','g2','memberId',m_ruth,'amount',30000)),
      'Approved', 3, '["secretary","treasurer","chairperson"]'::jsonb,
      jsonb_build_array(
        jsonb_build_object('role','secretary','member_id',m_sec,'name','Peter Kamau','decision','approve','comment','Within limit','decided_at', now() - interval '2 days'),
        jsonb_build_object('role','treasurer','member_id',m_treas,'name','Mary Atieno','decision','approve','comment','Funds available','decided_at', now() - interval '1 day'),
        jsonb_build_object('role','chairperson','member_id',m_chair,'name','Grace Wanjiku','decision','approve','comment','Go ahead','decided_at', now() - interval '3 hours')),
      loan3, now() - interval '3 hours', now() - interval '4 days');
  insert into chama_loans (id, chama_id, member_id, member_name, application_id, amount, interest_rate, interest_type, repayment_months,
      balance, disbursed, status, created_at)
  values (loan3, v_chama, m_faith, 'Faith Chebet', app3, 60000, 5, 'flat_monthly', 6, 60000, false, 'active', now() - interval '3 hours');

  -- Awaiting approval: David — secretary + treasurer have signed, chairperson still to go
  insert into chama_loan_applications (chama_id, member_id, member_name, requested_amount, purpose, repayment_months, interest_rate, interest_type,
      guarantors, status, required_approvals, approver_roles, approvals, created_at)
  values (v_chama, m_david, 'David Kiprono', 30000, 'Buy a dairy cow', 6, 5, 'flat_monthly',
      jsonb_build_array(jsonb_build_object('id','g1','memberId',m_esther,'amount',15000), jsonb_build_object('id','g2','memberId',m_ruth,'amount',15000)),
      'Awaiting Approval', 3, '["secretary","treasurer","chairperson"]'::jsonb,
      jsonb_build_array(
        jsonb_build_object('role','secretary','member_id',m_sec,'name','Peter Kamau','decision','approve','comment','Guarantors confirmed','decided_at', now() - interval '1 day'),
        jsonb_build_object('role','treasurer','member_id',m_treas,'name','Mary Atieno','decision','approve','comment','OK','decided_at', now() - interval '20 hours')),
      now() - interval '2 days');

  -- Pending, no decisions yet: Lucy
  insert into chama_loan_applications (chama_id, member_id, member_name, requested_amount, purpose, repayment_months, interest_rate, interest_type,
      guarantors, status, required_approvals, approver_roles, approvals, created_at)
  values (v_chama, m_lucy, 'Lucy Wambui', 15000, 'Emergency medical bills', 3, 5, 'flat_monthly',
      jsonb_build_array(jsonb_build_object('id','g1','memberId',m_faith,'amount',8000), jsonb_build_object('id','g2','memberId',m_welf,'amount',7000)),
      'Pending', 3, '["secretary","treasurer","chairperson"]'::jsonb, '[]'::jsonb, now() - interval '5 hours');

  -- Rejected: Joseph — asked for more than the savings multiplier allows
  insert into chama_loan_applications (chama_id, member_id, member_name, requested_amount, purpose, repayment_months, interest_rate, interest_type,
      guarantors, status, required_approvals, approver_roles, approvals, rejected_at, remarks, created_at)
  values (v_chama, m_joseph, 'Joseph Mutua', 90000, 'Matatu deposit', 12, 5, 'flat_monthly',
      jsonb_build_array(jsonb_build_object('id','g1','memberId',m_samuel,'amount',20000)),
      'Rejected', 3, '["secretary","treasurer","chairperson"]'::jsonb,
      jsonb_build_array(jsonb_build_object('role','treasurer','member_id',m_treas,'name','Mary Atieno','decision','reject','comment','Exceeds 3x savings; guarantors do not cover the amount','decided_at', now() - interval '3 weeks')),
      now() - interval '3 weeks', 'Exceeds 3x savings; guarantors do not cover the amount', now() - interval '3 weeks 2 days');

  ---------------------------------------------------------------------------
  -- 7. Treasurer queue — live work for the Reconciliation screen
  ---------------------------------------------------------------------------
  insert into chama_contribution_requests (chama_id, member_id, bank_account_id, amount, contribution_type, contributed_on, payment_method, transaction_ref, member_notes, status, created_at)
  values
    (v_chama, m_ruth,   acc_mpesa, 2000, 'savings', current_date,     'MPESA', 'QJ7H2K9LMA', 'October savings',                 'PENDING', now() - interval '3 hours'),
    (v_chama, m_joseph, acc_mpesa, 4000, 'savings', current_date - 1, 'MPESA', 'QJ5T8R1BNC', 'September + October savings',     'PENDING', now() - interval '1 day'),
    (v_chama, m_lucy,   acc_bank,   200, 'welfare', current_date - 1, 'BANK',  'EQB0099127',  'Welfare',                        'PENDING', now() - interval '1 day');

  insert into chama_contribution_requests (chama_id, member_id, bank_account_id, amount, contribution_type, contributed_on, payment_method, transaction_ref, member_notes,
      status, verified_by, verified_at, bank_statement_amount, verification_notes, created_at)
  values
    (v_chama, m_samuel, acc_mpesa, 2000, 'savings', current_date - 2, 'MPESA', 'QJ3D4F6GHP', 'Catching up on savings', 'VERIFIED', m_treas, now() - interval '2 hours', 2000, 'Matched on M-Pesa statement', now() - interval '2 days');

  -- A verified loan repayment: posting it exercises the loan-balance path and closes Esther's loan
  insert into chama_contribution_requests (chama_id, member_id, bank_account_id, amount, contribution_type, contributed_on, payment_method, transaction_ref, member_notes,
      status, verified_by, verified_at, bank_statement_amount, verification_notes, loan_id, created_at)
  values
    (v_chama, m_esther, acc_bank, 10000, 'loan_repayment', current_date - 1, 'BANK', 'EQB0098841', 'Final instalment', 'VERIFIED', m_treas, now() - interval '1 hour', 10000, 'Matched on Equity statement', loan1, now() - interval '1 day');

  insert into chama_contribution_requests (chama_id, member_id, bank_account_id, amount, contribution_type, contributed_on, payment_method, transaction_ref, member_notes,
      status, rejection_reason, created_at)
  values
    (v_chama, m_david, acc_mpesa, 3000, 'savings', current_date - 4, 'MPESA', 'QJ0000FAKE', 'Savings', 'REJECTED', 'Reference not found on the M-Pesa statement', now() - interval '4 days');

  ---------------------------------------------------------------------------
  -- 8. Balances = sum of the ledger (so statements and balances agree)
  ---------------------------------------------------------------------------
  update chama_members cm set
    savings_balance = coalesce((select sum(amount) from chama_ledger_entries l where l.member_id = cm.id and l.account_type = 'savings'), 0),
    shares_balance  = coalesce((select sum(amount) from chama_ledger_entries l where l.member_id = cm.id and l.account_type = 'shares'), 0),
    welfare_balance = coalesce((select sum(amount) from chama_ledger_entries l where l.member_id = cm.id and l.account_type = 'welfare'), 0)
  where cm.chama_id = v_chama;

  ---------------------------------------------------------------------------
  -- 9. Welfare — access, cases, contributions, events, tasks
  ---------------------------------------------------------------------------
  insert into welfare_member_access (chama_id, member_id, can_access, granted_by)
  values (v_chama, m_welf, true, m_chair), (v_chama, m_treas, true, m_chair), (v_chama, m_sec, true, m_chair);

  -- C1: OPEN funeral — Ruth Akinyi (mother)
  insert into welfare_cases (chama_id, title, event_type, beneficiary_member_id, beneficiary_name, description, expected_amount,
      amount_visible_to_members, is_visible_to_beneficiary, status, campaign_status, opened_by, opened_at,
      show_contributor_names, show_contributor_ranking, show_anonymous_contributors, show_external_contributors,
      allow_anonymous_contributions, allow_external_contributions)
  values (v_chama, 'Burial support — Ruth Akinyi''s mother', 'funeral', m_ruth, 'Ruth Akinyi',
      'Ruth lost her mother last week. Burial is planned for the coming weekend in Kisumu. Funds go towards transport, tent, coffin and catering.',
      60000, true, true, 'open', 'open', m_welf, now() - interval '6 days',
      true, false, true, true, true, true)
  returning id into case1;

  -- C2: CLOSED wedding — Faith Chebet (history)
  insert into welfare_cases (chama_id, title, event_type, beneficiary_member_id, beneficiary_name, description, expected_amount,
      status, campaign_status, opened_by, opened_at, closed_by, closed_at)
  values (v_chama, 'Wedding gift — Faith Chebet', 'wedding', m_faith, 'Faith Chebet',
      'Chama contribution towards Faith''s wedding. Target reached; gift presented at the send-off.',
      30000, 'closed', 'closed', m_welf, now() - interval '2 months', m_welf, now() - interval '5 weeks')
  returning id into case2;

  -- C3: OPEN sickness — Samuel Otieno (hospital bills), about half raised
  insert into welfare_cases (chama_id, title, event_type, beneficiary_member_id, beneficiary_name, description, expected_amount,
      status, campaign_status, opened_by, opened_at)
  values (v_chama, 'Hospital bills — Samuel Otieno', 'sickness', m_samuel, 'Samuel Otieno',
      'Samuel is admitted following a road accident. Funds go towards hospital bills and recovery.',
      45000, 'open', 'open', m_welf, now() - interval '4 days')
  returning id into case3;

  -- participants: every active member can see every case
  insert into welfare_case_participants (case_id, member_id, can_see, expected_contribution, added_by)
  select c.id, m.id, true, 1000, m_welf
  from (values (case1),(case2),(case3)) c(id)
  cross join chama_members m
  where m.chama_id = v_chama and m.status = 'active';

  -- C1 contributions (members, anonymous, external org, pledge, 2 pending)
  insert into welfare_contributions (chama_id, case_id, member_id, source_type, contributor_name, amount, contributed_on, payment_method, reference,
      status, is_pledge, pledged_amount, amount_received, expected_payment_date, recorded_by, received_by, approved_by, approved_at, created_at)
  values
    (v_chama, case1, m_chair,  'member',    null, 3000,  current_date - 5, 'mobile_money', 'WF1A', 'Approved', false, null, 3000,  null, m_welf, m_welf, m_treas, now() - interval '5 days', now() - interval '5 days'),
    (v_chama, case1, m_sec,    'member',    null, 2000,  current_date - 5, 'mobile_money', 'WF1B', 'Approved', false, null, 2000,  null, m_welf, m_welf, m_treas, now() - interval '5 days', now() - interval '5 days'),
    (v_chama, case1, m_treas,  'member',    null, 2500,  current_date - 4, 'bank',         'WF1C', 'Approved', false, null, 2500,  null, m_welf, m_welf, m_chair, now() - interval '4 days', now() - interval '4 days'),
    (v_chama, case1, m_esther, 'member',    null, 1000,  current_date - 4, 'mobile_money', 'WF1D', 'Approved', false, null, 1000,  null, m_welf, m_welf, m_treas, now() - interval '4 days', now() - interval '4 days'),
    (v_chama, case1, m_faith,  'member',    null, 1500,  current_date - 3, 'cash',         'WF1E', 'Approved', false, null, 1500,  null, m_welf, m_welf, m_treas, now() - interval '3 days', now() - interval '3 days'),
    (v_chama, case1, null,     'anonymous', null, 5000,  current_date - 3, 'cash',         null,   'Approved', false, null, 5000,  null, m_welf, m_welf, m_treas, now() - interval '3 days', now() - interval '3 days'),
    (v_chama, case1, null,     'external',  'Kiambu Teachers SACCO', 10000, current_date - 2, 'cheque', 'CHQ-004417', 'Approved', false, null, 10000, null, m_welf, m_welf, m_chair, now() - interval '2 days', now() - interval '2 days'),
    (v_chama, case1, m_david,  'member',    null, 4000,  current_date + 3, 'mobile_money', null,   'Approved', true,  4000, 0,     current_date + 3, m_welf, m_welf, m_treas, now() - interval '2 days', now() - interval '2 days'),
    (v_chama, case1, m_lucy,   'member',    null, 1000,  current_date - 1, 'mobile_money', 'WF1H', 'Pending',  false, null, 1000,  null, m_welf, m_welf, null, null, now() - interval '1 day'),
    (v_chama, case1, m_joseph, 'member',    null, 1000,  current_date,     'mobile_money', 'WF1I', 'Pending',  false, null, 1000,  null, m_welf, m_welf, null, null, now() - interval '2 hours');

  -- C2 contributions (closed — fully raised)
  insert into welfare_contributions (chama_id, case_id, member_id, source_type, amount, contributed_on, payment_method, reference,
      status, is_pledge, amount_received, recorded_by, received_by, approved_by, approved_at, created_at)
  select v_chama, case2, m.id, 'member', 3000, (current_date - 50), 'mobile_money', 'WF2' || substr(md5(m.id::text), 1, 4),
         'Approved', false, 3000, m_welf, m_welf, m_treas, now() - interval '50 days', now() - interval '50 days'
  from chama_members m where m.chama_id = v_chama and m.status = 'active' and m.id <> m_faith and m.id <> m_samuel;

  -- C3 contributions (about half raised)
  insert into welfare_contributions (chama_id, case_id, member_id, source_type, amount, contributed_on, payment_method, reference,
      status, is_pledge, amount_received, recorded_by, received_by, approved_by, approved_at, created_at)
  values
    (v_chama, case3, m_chair,  'member', 5000, current_date - 3, 'mobile_money', 'WF3A', 'Approved', false, 5000, m_welf, m_welf, m_treas, now() - interval '3 days', now() - interval '3 days'),
    (v_chama, case3, m_treas,  'member', 4000, current_date - 3, 'bank',         'WF3B', 'Approved', false, 4000, m_welf, m_welf, m_chair, now() - interval '3 days', now() - interval '3 days'),
    (v_chama, case3, m_sec,    'member', 3000, current_date - 2, 'mobile_money', 'WF3C', 'Approved', false, 3000, m_welf, m_welf, m_treas, now() - interval '2 days', now() - interval '2 days'),
    (v_chama, case3, m_esther, 'member', 2500, current_date - 2, 'mobile_money', 'WF3D', 'Approved', false, 2500, m_welf, m_welf, m_treas, now() - interval '2 days', now() - interval '2 days'),
    (v_chama, case3, m_ruth,   'member', 3000, current_date - 1, 'cash',         'WF3E', 'Approved', false, 3000, m_welf, m_welf, m_treas, now() - interval '1 day',  now() - interval '1 day'),
    (v_chama, case3, m_lucy,   'member', 2000, current_date - 1, 'mobile_money', 'WF3F', 'Approved', false, 2000, m_welf, m_welf, m_treas, now() - interval '1 day',  now() - interval '1 day');

  -- Welfare events
  insert into welfare_events (chama_id, case_id, title, event_type, event_date, location, description, budget, status, created_by)
  values (v_chama, case1, 'Burial planning & fundraising meeting', 'fundraiser', current_date + 2, 'Grace''s residence, Kikuyu',
          'Agree transport, tent and catering for the burial, and confirm who travels.', 15000, 'planned', m_welf)
  returning id into ev1;
  insert into welfare_events (chama_id, case_id, title, event_type, event_date, location, description, budget, status, created_by)
  values (v_chama, case3, 'Hospital visit — Samuel Otieno', 'visit', current_date + 1, 'Kenyatta National Hospital, Ward 4B',
          'Delegation visit with fruit and a card. Meet at the gate at 3pm.', 4000, 'planned', m_welf)
  returning id into ev2;
  insert into welfare_events (chama_id, case_id, title, event_type, event_date, location, description, budget, status, created_by)
  values (v_chama, case2, 'Faith''s wedding send-off', 'ceremony', current_date - 35, 'Limuru',
          'Gift presentation at the send-off.', 8000, 'completed', m_welf)
  returning id into ev3;

  insert into welfare_event_tasks (event_id, task, assignee_member_id, due_date, status)
  values
    (ev1, 'Book tent and chairs',                  m_sec,    current_date + 1, 'in_progress'),
    (ev1, 'Arrange transport to Kisumu (2 matatus)', m_david, current_date + 1, 'pending'),
    (ev1, 'Collect and confirm member contributions', m_treas, current_date + 2, 'in_progress'),
    (ev1, 'Prepare programme and eulogy',          m_chair,  current_date + 2, 'pending'),
    (ev2, 'Buy fruit and a get-well card',         m_lucy,   current_date + 1, 'pending'),
    (ev2, 'Confirm visiting hours with the ward',  m_welf,   current_date,     'done'),
    (ev3, 'Buy gift',                              m_lucy,   current_date - 40, 'done'),
    (ev3, 'Book venue',                            m_welf,   current_date - 42, 'done');

  ---------------------------------------------------------------------------
  -- 10. Announcements (Updates tab)
  ---------------------------------------------------------------------------
  insert into chama_announcements (chama_id, title, body, kind, event_date, pinned, created_by)
  values
    (v_chama, 'Monthly meeting — this Saturday', 'Agenda: loan approvals, burial support for Ruth, 2nd-quarter dividends. Venue: Grace''s residence, 2pm. Please be on time.', 'meeting', current_date + ((6 - extract(dow from current_date)::int + 7) % 7), true, m_sec),
    (v_chama, 'Savings due by the 10th', 'Please send monthly savings, shares and welfare by the 10th of each month and upload your M-Pesa reference under Money > Contribute.', 'reminder', null, false, m_treas),
    (v_chama, 'Welcome Daniel Ochieng', 'Daniel has applied to join. The officials will review his application at the meeting.', 'notice', null, false, m_sec);

  ---------------------------------------------------------------------------
  -- 11. Logins — real accounts via register_user() (auto-links by phone)
  ---------------------------------------------------------------------------
  perform register_user('0711000001', 'Demo1234', 'Grace Wanjiku');
  perform register_user('0711000002', 'Demo1234', 'Peter Kamau');
  perform register_user('0711000003', 'Demo1234', 'Mary Atieno');
  perform register_user('0711000004', 'Demo1234', 'John Mwangi');
  perform register_user('0711000005', 'Demo1234', 'Esther Njeri');
  perform register_user('0711000006', 'Demo1234', 'Samuel Otieno');
  perform register_user('0711000007', 'Demo1234', 'Faith Chebet');
  perform register_user('0711000008', 'Demo1234', 'David Kiprono');
  perform register_user('0711000009', 'Demo1234', 'Lucy Wambui');
  perform register_user('0711000010', 'Demo1234', 'Joseph Mutua');
  perform register_user('0711000011', 'Demo1234', 'Ruth Akinyi');
  perform register_user('0711000012', 'Demo1234', 'Daniel Ochieng');

  raise notice 'Demo chama ready. chama_id = %, plan = free, password = Demo1234', v_chama;
end $$;

-- -----------------------------------------------------------------------------
-- VERIFY (expect: plan=free, 12 members all linked to a login, ledger = balances)
-- -----------------------------------------------------------------------------
select c.name, c.license_plan, c.license_status, c.license_expiry,
       (select count(*) from chama_members m where m.chama_id = c.id)                       as members,
       (select count(*) from chama_members m where m.chama_id = c.id and m.user_id is not null) as members_with_login
from chamas c where c.chama_no = 'CHM-DEMO01';

select cm.name, cm.role, cm.status, cm.savings_balance, cm.shares_balance, cm.welfare_balance
from chama_members cm join chamas c on c.id = cm.chama_id
where c.chama_no = 'CHM-DEMO01' order by cm.role, cm.name;
