-- =============================================================================
-- 010 — Per-account balances, Projects, and approved fund movements
-- Run AFTER 001, 002, 006 and 009. Safe to re-run.
--
-- What this adds
--   1. Every ledger entry now says WHICH account it touched (Cash, M-Pesa, Bank).
--      Each account's balance = opening balance + money in - money out.
--   2. A "Cash in hand" account per Chama, so cash is an account like the others.
--   3. Projects (a Chama investment or business).
--   4. Fund movements: transfer between accounts, expense, or money to a project.
--      The TREASURER records it; the CHAIRPERSON approves it. Nothing moves
--      until it is approved, and the person who recorded it cannot approve it.
--
-- No second money path: approved movements are written to the same ledger.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Ledger knows the account (and the project, for project funding)
-- -----------------------------------------------------------------------------
create table if not exists chama_projects (
  id uuid primary key default gen_random_uuid()
);
alter table chama_projects add column if not exists chama_id uuid not null;
alter table chama_projects add column if not exists name text not null;
alter table chama_projects add column if not exists description text;
alter table chama_projects add column if not exists kind text default 'investment';   -- investment | business
alter table chama_projects add column if not exists status text default 'active';     -- active | on_hold | closed
alter table chama_projects add column if not exists start_date date;
alter table chama_projects add column if not exists target_amount numeric(14,2);
alter table chama_projects add column if not exists created_by uuid references chama_members(id);
alter table chama_projects add column if not exists created_at timestamptz default now();
create index if not exists idx_projects_chama on chama_projects(chama_id, status);

alter table chama_ledger_entries add column if not exists account_id uuid references chama_bank_accounts(id);
alter table chama_ledger_entries add column if not exists project_id uuid references chama_projects(id);
create index if not exists idx_ledger_account on chama_ledger_entries(account_id);
create index if not exists idx_ledger_project on chama_ledger_entries(project_id);

alter table chama_loan_repayments add column if not exists bank_account_id uuid references chama_bank_accounts(id);

-- -----------------------------------------------------------------------------
-- 2. "Cash in hand" — one per Chama, created on demand
-- -----------------------------------------------------------------------------
create unique index if not exists uq_one_cash_account_per_chama
  on chama_bank_accounts(chama_id) where account_type = 'cash';

create or replace function ensure_cash_account(p_chama_id uuid)
returns uuid
language plpgsql
security definer
as $$
declare v_id uuid;
begin
  select id into v_id from chama_bank_accounts where chama_id = p_chama_id and account_type = 'cash' limit 1;
  if v_id is null then
    insert into chama_bank_accounts (chama_id, account_name, account_type, provider, is_active, opening_balance)
    values (p_chama_id, 'Cash in hand', 'cash', 'Treasurer', true, 0)
    on conflict do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from chama_bank_accounts where chama_id = p_chama_id and account_type = 'cash' limit 1;
    end if;
  end if;
  return v_id;
end;
$$;
grant execute on function ensure_cash_account(uuid) to anon, authenticated;

-- every existing Chama gets one now
do $$
declare c record;
begin
  for c in select distinct chama_id from chama_members where chama_id is not null loop
    perform ensure_cash_account(c.chama_id);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Backfill account_id on entries that already exist
--    (only where the account is knowable; anything else stays "unassigned"
--     and is shown as such, never hidden)
-- -----------------------------------------------------------------------------
update chama_ledger_entries e
   set account_id = case when upper(coalesce(r.payment_method, '')) = 'CASH' then ensure_cash_account(e.chama_id) else r.bank_account_id end
  from chama_contribution_requests r
 where e.account_id is null and e.source_type = 'contribution' and e.source_id = r.id;

update chama_ledger_entries e
   set account_id = l.disbursement_source
  from chama_loans l
 where e.account_id is null and e.source_type = 'loan_disbursement' and e.source_id = l.id and l.disbursement_source is not null;

update chama_ledger_entries e
   set account_id = ensure_cash_account(e.chama_id)
  from chama_loan_repayments p
 where e.account_id is null and e.source_type = 'loan_repayment' and e.source_id = p.id and upper(coalesce(p.method, '')) = 'CASH';

-- -----------------------------------------------------------------------------
-- 4. Existing money functions now record the account
-- -----------------------------------------------------------------------------

-- post_contribution: same as 006, plus account_id on the ledger entry.
create or replace function post_contribution(p_request_id uuid, p_approver uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  v_req chama_contribution_requests%rowtype;
  v_ledger_id uuid;
  v_loan chama_loans%rowtype;
  v_account uuid;
begin
  select * into v_req from chama_contribution_requests where id = p_request_id for update;

  if v_req.id is null then raise exception 'Contribution request % not found', p_request_id; end if;
  if v_req.member_id is null then raise exception 'Contribution % has no member_id set — cannot post to a member balance', p_request_id; end if;
  if v_req.status <> 'VERIFIED' then raise exception 'Contribution % must be VERIFIED before it can be posted (currently %)', p_request_id, v_req.status; end if;
  if v_req.posted then raise exception 'Contribution % has already been posted', p_request_id; end if;
  if v_req.contribution_type = 'loan_repayment' and v_req.loan_id is null then
    raise exception 'Contribution % is a loan repayment but has no loan_id set — the member must pick which loan they are repaying', p_request_id;
  end if;

  -- Cash lands in "Cash in hand"; M-Pesa / bank land in the account the member named.
  if upper(coalesce(v_req.payment_method, '')) = 'CASH' then
    v_account := ensure_cash_account(v_req.chama_id);
  else
    v_account := v_req.bank_account_id;
  end if;

  insert into chama_ledger_entries (chama_id, member_id, account_type, direction, amount, source_type, source_id, description, created_by, account_id)
  values (
    v_req.chama_id, v_req.member_id, v_req.contribution_type, 'credit', v_req.amount,
    'contribution', v_req.id,
    'Contribution verified against account, ref ' || coalesce(v_req.transaction_ref, 'n/a'),
    p_approver, v_account
  )
  returning id into v_ledger_id;

  update chama_contribution_requests
    set status = 'APPROVED', approved_by = p_approver, approved_at = now(),
        posted = true, posted_ledger_entry_id = v_ledger_id
    where id = p_request_id;

  if v_req.contribution_type = 'savings' then
    update chama_members set savings_balance = coalesce(savings_balance, 0) + v_req.amount where id = v_req.member_id;
  elsif v_req.contribution_type = 'shares' then
    update chama_members set shares_balance = coalesce(shares_balance, 0) + v_req.amount where id = v_req.member_id;
  elsif v_req.contribution_type = 'welfare' then
    update chama_members set welfare_balance = coalesce(welfare_balance, 0) + v_req.amount where id = v_req.member_id;
  elsif v_req.contribution_type = 'loan_repayment' then
    select * into v_loan from chama_loans where id = v_req.loan_id for update;
    if v_loan.id is null then
      raise exception 'Loan % referenced by contribution % no longer exists', v_req.loan_id, p_request_id;
    end if;

    insert into chama_loan_repayments (chama_id, loan_id, member_id, amount, method, reference, recorded_by, bank_account_id)
    values (v_req.chama_id, v_loan.id, v_req.member_id, v_req.amount, v_req.payment_method, v_req.transaction_ref, p_approver, v_account);

    update chama_loans
      set balance = greatest(coalesce(balance, amount) - v_req.amount, 0),
          status = case when coalesce(balance, amount) - v_req.amount <= 0 then 'closed' else status end
      where id = v_loan.id;
  end if;

  return v_ledger_id;
end;
$$;

-- disburse_loan: same as 006, plus account_id on the debit.
create or replace function disburse_loan(p_loan_id uuid, p_source_account uuid, p_disburser uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_loan chama_loans%rowtype;
  v_account chama_bank_accounts%rowtype;
begin
  select * into v_loan from chama_loans where id = p_loan_id for update;
  if v_loan.id is null then raise exception 'Loan % not found', p_loan_id; end if;
  if v_loan.disbursed then raise exception 'Loan % already disbursed', p_loan_id; end if;
  if v_loan.status is distinct from 'active' then
    raise exception 'Loan % is not in an active/approved state (status: %)', p_loan_id, v_loan.status;
  end if;

  select * into v_account from chama_bank_accounts where id = p_source_account;
  if v_account.id is null then raise exception 'Source account % not found', p_source_account; end if;
  if v_account.chama_id is distinct from v_loan.chama_id then
    raise exception 'Source account belongs to a different chama than this loan';
  end if;
  if not coalesce(v_account.is_active, false) then raise exception 'Source account is not active'; end if;

  update chama_loans
    set disbursed = true, disbursement_date = current_date,
        disbursement_source = p_source_account, disbursed_by = p_disburser,
        balance = amount
    where id = p_loan_id;

  insert into chama_ledger_entries (chama_id, member_id, account_type, direction, amount, source_type, source_id, description, created_by, account_id)
  values (
    v_loan.chama_id, v_loan.member_id, 'loan_disbursement', 'debit', v_loan.amount,
    'loan_disbursement', v_loan.id, 'Loan disbursed to member', p_disburser, p_source_account
  );
end;
$$;

-- apply_loan_repayment: new optional account. The old 5-argument version is
-- dropped first so the app never hits an "ambiguous function" error.
drop function if exists apply_loan_repayment(uuid, numeric, text, text, uuid);

create or replace function apply_loan_repayment(
  p_loan_id uuid, p_amount numeric, p_method text, p_reference text, p_recorder uuid,
  p_account_id uuid default null
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_loan chama_loans%rowtype;
  v_repayment_id uuid;
  v_account uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Repayment amount must be greater than zero'; end if;

  select * into v_loan from chama_loans where id = p_loan_id for update;
  if v_loan.id is null then raise exception 'Loan % not found', p_loan_id; end if;
  if not coalesce(v_loan.disbursed, false) then raise exception 'Loan % has not been disbursed yet — nothing to repay', p_loan_id; end if;
  if v_loan.status = 'closed' then
    raise exception 'Loan % is already closed — this repayment would have no loan to apply against. If this is a refund/overpayment, record it separately.', p_loan_id;
  end if;

  if upper(coalesce(p_method, '')) = 'CASH' then
    v_account := ensure_cash_account(v_loan.chama_id);
  else
    if p_account_id is null then raise exception 'Choose the Chama account this repayment went into'; end if;
    if not exists (select 1 from chama_bank_accounts where id = p_account_id and chama_id = v_loan.chama_id) then
      raise exception 'That account does not belong to this Chama';
    end if;
    v_account := p_account_id;
  end if;

  insert into chama_loan_repayments (chama_id, loan_id, member_id, amount, method, reference, recorded_by, bank_account_id)
  values (v_loan.chama_id, p_loan_id, v_loan.member_id, p_amount, p_method, p_reference, p_recorder, v_account)
  returning id into v_repayment_id;

  update chama_loans
    set balance = greatest(coalesce(balance, amount) - p_amount, 0),
        status = case when coalesce(balance, amount) - p_amount <= 0 then 'closed' else status end
    where id = p_loan_id;

  insert into chama_ledger_entries (chama_id, member_id, account_type, direction, amount, source_type, source_id, description, created_by, account_id)
  values (v_loan.chama_id, v_loan.member_id, 'loan_repayment', 'credit', p_amount, 'loan_repayment', v_repayment_id, 'Loan repayment', p_recorder, v_account);

  return v_repayment_id;
end;
$$;
grant execute on function apply_loan_repayment(uuid, numeric, text, text, uuid, uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Fund movements: treasurer records, chairperson approves
-- -----------------------------------------------------------------------------
create table if not exists chama_fund_requests (
  id uuid primary key default gen_random_uuid()
);
alter table chama_fund_requests add column if not exists chama_id uuid not null;
alter table chama_fund_requests add column if not exists kind text not null;                         -- transfer | expense | project_funding
alter table chama_fund_requests add column if not exists from_account_id uuid references chama_bank_accounts(id);
alter table chama_fund_requests add column if not exists to_account_id uuid references chama_bank_accounts(id);   -- transfers
alter table chama_fund_requests add column if not exists project_id uuid references chama_projects(id);          -- project funding
alter table chama_fund_requests add column if not exists expense_category text;                                  -- expenses
alter table chama_fund_requests add column if not exists amount numeric(14,2) not null;
alter table chama_fund_requests add column if not exists description text;
alter table chama_fund_requests add column if not exists reference text;
alter table chama_fund_requests add column if not exists request_date date default current_date;
alter table chama_fund_requests add column if not exists status text default 'pending';              -- pending | approved | rejected | cancelled
alter table chama_fund_requests add column if not exists recorded_by uuid references chama_members(id);
alter table chama_fund_requests add column if not exists recorded_at timestamptz default now();
alter table chama_fund_requests add column if not exists decided_by uuid references chama_members(id);
alter table chama_fund_requests add column if not exists decided_at timestamptz;
alter table chama_fund_requests add column if not exists decision_note text;
create index if not exists idx_fund_requests_chama on chama_fund_requests(chama_id, status, recorded_at desc);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chama_fund_requests_kind_check') then
    alter table chama_fund_requests add constraint chama_fund_requests_kind_check check (kind in ('transfer', 'expense', 'project_funding'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chama_fund_requests_status_check') then
    alter table chama_fund_requests add constraint chama_fund_requests_status_check check (status in ('pending', 'approved', 'rejected', 'cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chama_fund_requests_amount_check') then
    alter table chama_fund_requests add constraint chama_fund_requests_amount_check check (amount > 0);
  end if;
end $$;

-- the account's balance right now (opening + in - out), from the ledger only
create or replace function chama_account_balance(p_account_id uuid)
returns numeric
language sql
stable
security definer
as $$
  select coalesce((select opening_balance from chama_bank_accounts where id = p_account_id), 0)
       + coalesce((select sum(case when direction = 'credit' then amount else -amount end)
                   from chama_ledger_entries where account_id = p_account_id), 0);
$$;

-- ---- Treasurer records a movement (nothing moves yet) -----------------------
create or replace function record_fund_request(
  p_chama_id uuid,
  p_recorder uuid,
  p_kind text,                       -- transfer | expense | project_funding
  p_from_account uuid,
  p_amount numeric,
  p_description text,
  p_to_account uuid default null,    -- transfer
  p_project_id uuid default null,    -- project_funding
  p_category text default null,      -- expense
  p_reference text default null,
  p_date date default null
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_rec chama_members%rowtype;
  v_from chama_bank_accounts%rowtype;
  v_to chama_bank_accounts%rowtype;
  v_proj chama_projects%rowtype;
  v_id uuid;
begin
  select * into v_rec from chama_members where id = p_recorder and chama_id = p_chama_id;
  if v_rec.id is null or lower(coalesce(v_rec.role, '')) not in ('treasurer', 'admin') or coalesce(v_rec.status, 'active') <> 'active' then
    raise exception 'Only the treasurer can record a transfer, expense or project payment';
  end if;

  if p_kind not in ('transfer', 'expense', 'project_funding') then raise exception 'Unknown kind %', p_kind; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than zero'; end if;
  if coalesce(trim(p_description), '') = '' then raise exception 'Say what this is for'; end if;
  if p_date is not null and p_date > current_date then raise exception 'The date cannot be in the future'; end if;

  select * into v_from from chama_bank_accounts where id = p_from_account and chama_id = p_chama_id;
  if v_from.id is null then raise exception 'Choose the account the money comes from'; end if;
  if not coalesce(v_from.is_active, false) then raise exception 'The source account is not active'; end if;

  if p_kind = 'transfer' then
    select * into v_to from chama_bank_accounts where id = p_to_account and chama_id = p_chama_id;
    if v_to.id is null then raise exception 'Choose the account the money goes to'; end if;
    if v_to.id = v_from.id then raise exception 'The two accounts must be different'; end if;
    if not coalesce(v_to.is_active, false) then raise exception 'The destination account is not active'; end if;
  elsif p_kind = 'expense' then
    if coalesce(trim(p_category), '') = '' then raise exception 'Choose an expense category'; end if;
  else
    select * into v_proj from chama_projects where id = p_project_id and chama_id = p_chama_id;
    if v_proj.id is null then raise exception 'Choose the project'; end if;
    if v_proj.status <> 'active' then raise exception 'That project is not active'; end if;
  end if;

  -- guard against a double tap
  if exists (select 1 from chama_fund_requests
             where chama_id = p_chama_id and recorded_by = p_recorder and kind = p_kind
               and from_account_id = p_from_account and amount = p_amount
               and coalesce(description, '') = trim(p_description)
               and recorded_at > now() - interval '60 seconds') then
    raise exception 'This looks like the same entry just recorded — not saved twice';
  end if;

  insert into chama_fund_requests (
    chama_id, kind, from_account_id, to_account_id, project_id, expense_category,
    amount, description, reference, request_date, status, recorded_by
  ) values (
    p_chama_id, p_kind, p_from_account,
    case when p_kind = 'transfer' then p_to_account else null end,
    case when p_kind = 'project_funding' then p_project_id else null end,
    case when p_kind = 'expense' then trim(p_category) else null end,
    p_amount, trim(p_description), nullif(trim(coalesce(p_reference, '')), ''),
    coalesce(p_date, current_date), 'pending', p_recorder
  ) returning id into v_id;

  return v_id;
end;
$$;
grant execute on function record_fund_request(uuid, uuid, text, uuid, numeric, text, uuid, uuid, text, text, date) to anon, authenticated;

-- ---- Chairperson approves or rejects ----------------------------------------
create or replace function decide_fund_request(
  p_request_id uuid,
  p_decider uuid,
  p_approve boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
as $$
declare
  v_req chama_fund_requests%rowtype;
  v_dec chama_members%rowtype;
  v_from chama_bank_accounts%rowtype;
  v_balance numeric;
  v_label text;
begin
  select * into v_req from chama_fund_requests where id = p_request_id for update;
  if v_req.id is null then raise exception 'Request not found'; end if;
  if v_req.status <> 'pending' then raise exception 'This request has already been %', v_req.status; end if;

  select * into v_dec from chama_members where id = p_decider and chama_id = v_req.chama_id;
  if v_dec.id is null or lower(coalesce(v_dec.role, '')) not in ('chairperson', 'chairman', 'admin') or coalesce(v_dec.status, 'active') <> 'active' then
    raise exception 'Only the chairperson can approve or reject this';
  end if;
  if v_dec.id = v_req.recorded_by then
    raise exception 'You recorded this yourself — someone else must approve it';
  end if;

  if not p_approve then
    if coalesce(trim(p_note), '') = '' then raise exception 'Say why you are rejecting this'; end if;
    update chama_fund_requests set status = 'rejected', decided_by = p_decider, decided_at = now(), decision_note = trim(p_note) where id = p_request_id;
    return;
  end if;

  -- lock the source account so two approvals cannot both spend the same money
  select * into v_from from chama_bank_accounts where id = v_req.from_account_id for update;
  if not coalesce(v_from.is_active, false) then raise exception 'The source account is not active'; end if;

  v_balance := chama_account_balance(v_req.from_account_id);
  if v_req.amount > v_balance then
    raise exception 'Not enough in % — it holds KES %, this needs KES %', v_from.account_name, to_char(v_balance, 'FM999,999,999,990.00'), to_char(v_req.amount, 'FM999,999,999,990.00');
  end if;

  if v_req.kind = 'transfer' then
    if not exists (select 1 from chama_bank_accounts where id = v_req.to_account_id and coalesce(is_active, false)) then
      raise exception 'The destination account is not active';
    end if;
    v_label := 'Transfer: ' || v_req.description;
    insert into chama_ledger_entries (chama_id, member_id, account_type, direction, amount, source_type, source_id, description, created_by, account_id)
    values (v_req.chama_id, null, 'transfer_out', 'debit', v_req.amount, 'fund_request', v_req.id, v_label, p_decider, v_req.from_account_id),
           (v_req.chama_id, null, 'transfer_in', 'credit', v_req.amount, 'fund_request', v_req.id, v_label, p_decider, v_req.to_account_id);

  elsif v_req.kind = 'expense' then
    insert into chama_ledger_entries (chama_id, member_id, account_type, direction, amount, source_type, source_id, description, created_by, account_id)
    values (v_req.chama_id, null, 'expense', 'debit', v_req.amount, 'fund_request', v_req.id,
            'Expense (' || coalesce(v_req.expense_category, 'other') || '): ' || v_req.description, p_decider, v_req.from_account_id);

  else
    if not exists (select 1 from chama_projects where id = v_req.project_id and status = 'active') then
      raise exception 'That project is no longer active';
    end if;
    insert into chama_ledger_entries (chama_id, member_id, account_type, direction, amount, source_type, source_id, description, created_by, account_id, project_id)
    values (v_req.chama_id, null, 'project_funding', 'debit', v_req.amount, 'fund_request', v_req.id,
            'Project funding: ' || v_req.description, p_decider, v_req.from_account_id, v_req.project_id);
  end if;

  update chama_fund_requests set status = 'approved', decided_by = p_decider, decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '') where id = p_request_id;
end;
$$;
grant execute on function decide_fund_request(uuid, uuid, boolean, text) to anon, authenticated;

-- ---- The treasurer can withdraw their own pending request -------------------
create or replace function cancel_fund_request(p_request_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
as $$
declare v_req chama_fund_requests%rowtype;
begin
  select * into v_req from chama_fund_requests where id = p_request_id for update;
  if v_req.id is null then raise exception 'Request not found'; end if;
  if v_req.status <> 'pending' then raise exception 'Only a pending request can be withdrawn'; end if;
  if v_req.recorded_by is distinct from p_actor then raise exception 'Only the person who recorded it can withdraw it'; end if;
  update chama_fund_requests set status = 'cancelled', decided_at = now() where id = p_request_id;
end;
$$;
grant execute on function cancel_fund_request(uuid, uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Balances for the screens (officials only; read-only)
-- -----------------------------------------------------------------------------
create or replace function chama_account_balances(p_chama_id uuid, p_requester uuid)
returns jsonb
language plpgsql
security definer
stable
as $$
declare
  v_req chama_members%rowtype;
  v_result jsonb;
begin
  select * into v_req from chama_members where id = p_requester and chama_id = p_chama_id;
  if v_req.id is null or lower(coalesce(v_req.role, '')) not in ('secretary', 'treasurer', 'chairperson', 'chairman', 'admin') then
    raise exception 'Account balances are for Chama officials only';
  end if;

  perform ensure_cash_account(p_chama_id);

  select jsonb_build_object(
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.account_name, 'type', a.account_type, 'provider', a.provider,
        'number', a.account_number, 'active', coalesce(a.is_active, true),
        'opening', coalesce(a.opening_balance, 0),
        'paid_in', coalesce(m.paid_in, 0), 'paid_out', coalesce(m.paid_out, 0),
        'balance', coalesce(a.opening_balance, 0) + coalesce(m.paid_in, 0) - coalesce(m.paid_out, 0),
        'pending_out', coalesce(p.pending_out, 0)
      ) order by case a.account_type when 'cash' then 0 when 'mpesa' then 1 else 2 end, a.created_at)
      from chama_bank_accounts a
      left join (select account_id,
                        sum(case when direction = 'credit' then amount else 0 end) as paid_in,
                        sum(case when direction = 'debit' then amount else 0 end) as paid_out
                 from chama_ledger_entries where chama_id = p_chama_id and account_id is not null group by account_id) m on m.account_id = a.id
      left join (select from_account_id, sum(amount) as pending_out
                 from chama_fund_requests where chama_id = p_chama_id and status = 'pending' group by from_account_id) p on p.from_account_id = a.id
      where a.chama_id = p_chama_id), '[]'::jsonb),
    -- ledger entries with no account recorded (older data) — shown, never hidden
    'unassigned', (select jsonb_build_object(
        'paid_in', coalesce(sum(case when direction = 'credit' then amount end), 0),
        'paid_out', coalesce(sum(case when direction = 'debit' then amount end), 0),
        'count', count(*))
      from chama_ledger_entries where chama_id = p_chama_id and account_id is null)
  ) into v_result;

  return v_result;
end;
$$;
grant execute on function chama_account_balances(uuid, uuid) to anon, authenticated;

-- Project totals: money put in, and how many payments
create or replace function chama_project_summary(p_chama_id uuid, p_requester uuid)
returns jsonb
language plpgsql
security definer
stable
as $$
declare
  v_req chama_members%rowtype;
begin
  select * into v_req from chama_members where id = p_requester and chama_id = p_chama_id;
  if v_req.id is null or lower(coalesce(v_req.role, '')) not in ('secretary', 'treasurer', 'chairperson', 'chairman', 'admin') then
    raise exception 'Projects are for Chama officials only';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'description', p.description, 'kind', p.kind, 'status', p.status,
      'start_date', p.start_date, 'target_amount', p.target_amount,
      'invested', coalesce(e.invested, 0), 'payments', coalesce(e.payments, 0),
      'pending', coalesce(r.pending, 0)
    ) order by case p.status when 'active' then 0 when 'on_hold' then 1 else 2 end, p.created_at desc)
    from chama_projects p
    left join (select project_id, sum(amount) as invested, count(*) as payments
               from chama_ledger_entries where chama_id = p_chama_id and account_type = 'project_funding' group by project_id) e on e.project_id = p.id
    left join (select project_id, sum(amount) as pending
               from chama_fund_requests where chama_id = p_chama_id and status = 'pending' and kind = 'project_funding' group by project_id) r on r.project_id = p.id
    where p.chama_id = p_chama_id), '[]'::jsonb);
end;
$$;
grant execute on function chama_project_summary(uuid, uuid) to anon, authenticated;

-- RLS: not enabled, same as every other feature table here (see AUDIT_REPORT).
-- The roles above are checked from the member id the app sends, exactly like
-- record_member_contribution() — a known limit until real sessions replace it.

notify pgrst, 'reload schema';
