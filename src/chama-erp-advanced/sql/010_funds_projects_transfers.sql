-- =============================================================================
-- 010 — Account balances, transfers, expenses and projects
-- Run AFTER 001, 002, 006 and 009. Safe to re-run.
--
-- Design (nothing existing is rewritten):
--   * chama_account_entries  — every movement of money in/out of a Chama account
--     (Bank, M-Pesa, Cash till...). Balance = account opening_balance + entries.
--     Filled automatically from the existing ledger by a trigger, so contributions,
--     loan repayments and loan payouts keep working exactly as before.
--   * chama_projects / chama_project_entries — each project has its own money
--     (capital put in, income earned, expenses paid, money returned to the Chama).
--   * chama_fund_requests — the treasurer RECORDS a transfer / expense / project
--     movement; a different official (chairperson or admin) APPROVES it. Only on
--     approval does money move.
-- =============================================================================

-- ---------- tables -----------------------------------------------------------
create table if not exists chama_projects (id uuid primary key default gen_random_uuid());
alter table chama_projects add column if not exists chama_id uuid;
alter table chama_projects add column if not exists name text;
alter table chama_projects add column if not exists description text;
alter table chama_projects add column if not exists status text default 'active';   -- active | closed
alter table chama_projects add column if not exists started_on date default current_date;
alter table chama_projects add column if not exists target_amount numeric(14,2);
alter table chama_projects add column if not exists created_by uuid references chama_members(id);
alter table chama_projects add column if not exists created_at timestamptz default now();
create index if not exists idx_projects_chama on chama_projects(chama_id);

create table if not exists chama_fund_requests (id uuid primary key default gen_random_uuid());
alter table chama_fund_requests add column if not exists chama_id uuid;
alter table chama_fund_requests add column if not exists kind text;   -- transfer | expense | to_project | from_project | project_expense | project_income
alter table chama_fund_requests add column if not exists amount numeric(14,2);
alter table chama_fund_requests add column if not exists from_account uuid references chama_bank_accounts(id);
alter table chama_fund_requests add column if not exists to_account uuid references chama_bank_accounts(id);
alter table chama_fund_requests add column if not exists project_id uuid references chama_projects(id);
alter table chama_fund_requests add column if not exists category text;
alter table chama_fund_requests add column if not exists description text;
alter table chama_fund_requests add column if not exists reference text;
alter table chama_fund_requests add column if not exists occurred_on date default current_date;
alter table chama_fund_requests add column if not exists status text default 'PENDING';   -- PENDING | APPROVED | REJECTED
alter table chama_fund_requests add column if not exists requested_by uuid references chama_members(id);
alter table chama_fund_requests add column if not exists decided_by uuid references chama_members(id);
alter table chama_fund_requests add column if not exists decided_at timestamptz;
alter table chama_fund_requests add column if not exists decision_note text;
alter table chama_fund_requests add column if not exists created_at timestamptz default now();
create index if not exists idx_fundreq_chama on chama_fund_requests(chama_id, status);

create table if not exists chama_account_entries (id uuid primary key default gen_random_uuid());
alter table chama_account_entries add column if not exists chama_id uuid;
alter table chama_account_entries add column if not exists account_id uuid references chama_bank_accounts(id);  -- null = not yet assigned to an account
alter table chama_account_entries add column if not exists direction text;   -- credit (money in) | debit (money out)
alter table chama_account_entries add column if not exists amount numeric(14,2);
alter table chama_account_entries add column if not exists kind text;        -- member_payment | loan_repayment | loan_payout | transfer | expense | to_project | from_project
alter table chama_account_entries add column if not exists source_type text;
alter table chama_account_entries add column if not exists source_id uuid;
alter table chama_account_entries add column if not exists project_id uuid references chama_projects(id);
alter table chama_account_entries add column if not exists category text;
alter table chama_account_entries add column if not exists description text;
alter table chama_account_entries add column if not exists occurred_on date default current_date;
alter table chama_account_entries add column if not exists created_by uuid references chama_members(id);
alter table chama_account_entries add column if not exists created_at timestamptz default now();
create index if not exists idx_acctentries_account on chama_account_entries(chama_id, account_id);
-- an automatic posting can only ever be recorded once
create unique index if not exists uniq_acctentries_source on chama_account_entries(source_type, source_id, direction) where source_id is not null;

create table if not exists chama_project_entries (id uuid primary key default gen_random_uuid());
alter table chama_project_entries add column if not exists chama_id uuid;
alter table chama_project_entries add column if not exists project_id uuid references chama_projects(id);
alter table chama_project_entries add column if not exists direction text;   -- in | out
alter table chama_project_entries add column if not exists kind text;        -- capital | income | expense | returned
alter table chama_project_entries add column if not exists amount numeric(14,2);
alter table chama_project_entries add column if not exists category text;
alter table chama_project_entries add column if not exists description text;
alter table chama_project_entries add column if not exists request_id uuid references chama_fund_requests(id);
alter table chama_project_entries add column if not exists occurred_on date default current_date;
alter table chama_project_entries add column if not exists created_by uuid references chama_members(id);
alter table chama_project_entries add column if not exists created_at timestamptz default now();
create index if not exists idx_projentries_project on chama_project_entries(project_id);

-- ---------- helpers ----------------------------------------------------------
create or replace function chama_account_balance(p_account_id uuid)
returns numeric language sql stable security definer as $$
  select coalesce((select opening_balance from chama_bank_accounts where id = p_account_id), 0)
       + coalesce((select sum(case when direction = 'credit' then amount else -amount end) from chama_account_entries where account_id = p_account_id), 0);
$$;

create or replace function chama_project_wallet(p_project_id uuid)
returns numeric language sql stable security definer as $$
  select coalesce(sum(case when direction = 'in' then amount else -amount end), 0) from chama_project_entries where project_id = p_project_id;
$$;

-- ---------- automatic feed from the existing ledger --------------------------
-- Member payments credit the account the member paid into; loan payouts debit the account
-- the loan was paid from; loan repayments recorded at the Repayment Desk have no account yet,
-- so they appear as "not yet assigned" and the treasurer assigns them.
create or replace function chama_feed_account_entries() returns trigger language plpgsql security definer as $$
declare v_account uuid; v_kind text; v_dir text; v_date date;
begin
  if new.source_type = 'contribution' and new.direction = 'credit' then
    select bank_account_id into v_account from chama_contribution_requests where id = new.source_id;
    v_kind := case when new.account_type = 'loan_repayment' then 'loan_repayment' else 'member_payment' end; v_dir := 'credit';
  elsif new.source_type = 'loan_repayment' and new.direction = 'credit' then
    v_account := null; v_kind := 'loan_repayment'; v_dir := 'credit';
  elsif new.source_type = 'loan_disbursement' and new.direction = 'debit' then
    select disbursement_source into v_account from chama_loans where id = new.source_id;
    v_kind := 'loan_payout'; v_dir := 'debit';
  else
    return new;
  end if;
  v_date := coalesce((new.created_at at time zone 'Africa/Nairobi')::date, current_date);
  insert into chama_account_entries (chama_id, account_id, direction, amount, kind, source_type, source_id, description, occurred_on, created_by)
  values (new.chama_id, v_account, v_dir, new.amount, v_kind, new.source_type, new.source_id, new.description, v_date, new.created_by)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trg_feed_account_entries on chama_ledger_entries;
create trigger trg_feed_account_entries after insert on chama_ledger_entries
  for each row execute function chama_feed_account_entries();

-- One-off catch-up for money already recorded before this migration (skips anything already fed).
-- NOTE: account "opening balance" should be the balance BEFORE the first payment recorded in the app.
insert into chama_account_entries (chama_id, account_id, direction, amount, kind, source_type, source_id, description, occurred_on, created_by)
select l.chama_id,
       case when l.source_type = 'contribution' then (select r.bank_account_id from chama_contribution_requests r where r.id = l.source_id)
            when l.source_type = 'loan_disbursement' then (select c.disbursement_source from chama_loans c where c.id = l.source_id)
            else null end,
       l.direction, l.amount,
       case when l.source_type = 'loan_disbursement' then 'loan_payout' when l.account_type = 'loan_repayment' then 'loan_repayment' else 'member_payment' end,
       l.source_type, l.source_id, l.description, (l.created_at at time zone 'Africa/Nairobi')::date, l.created_by
from chama_ledger_entries l
where l.source_id is not null
  and ((l.source_type = 'contribution' and l.direction = 'credit')
    or (l.source_type = 'loan_repayment' and l.direction = 'credit')
    or (l.source_type = 'loan_disbursement' and l.direction = 'debit'))
on conflict do nothing;

-- ---------- projects ---------------------------------------------------------
create or replace function create_chama_project(p_chama_id uuid, p_creator uuid, p_name text, p_description text default null, p_target numeric default null, p_started_on date default null)
returns uuid language plpgsql security definer as $$
declare v_who chama_members%rowtype; v_id uuid;
begin
  select * into v_who from chama_members where id = p_creator and chama_id = p_chama_id;
  if v_who.id is null or lower(coalesce(v_who.role, '')) not in ('treasurer', 'chairperson', 'chairman', 'admin') then
    raise exception 'Only the treasurer or chairperson can start a project';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the project a name'; end if;
  insert into chama_projects (chama_id, name, description, target_amount, started_on, created_by)
  values (p_chama_id, trim(p_name), nullif(trim(coalesce(p_description, '')), ''), p_target, coalesce(p_started_on, current_date), p_creator)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------- record a movement (treasurer) -------------------------------------
create or replace function request_fund_movement(
  p_chama_id uuid, p_requester uuid, p_kind text, p_amount numeric,
  p_from_account uuid default null, p_to_account uuid default null, p_project_id uuid default null,
  p_category text default null, p_description text default null, p_reference text default null, p_occurred_on date default null
) returns uuid language plpgsql security definer as $$
declare v_who chama_members%rowtype; v_id uuid; v_proj chama_projects%rowtype;
begin
  select * into v_who from chama_members where id = p_requester and chama_id = p_chama_id;
  if v_who.id is null or lower(coalesce(v_who.role, '')) not in ('treasurer', 'chairperson', 'chairman', 'admin') then
    raise exception 'Only the treasurer can record a money movement';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than zero'; end if;
  if p_kind not in ('transfer', 'expense', 'to_project', 'from_project', 'project_expense', 'project_income') then raise exception 'Unknown kind %', p_kind; end if;
  if coalesce(trim(p_description), '') = '' and p_kind in ('expense', 'project_expense') then raise exception 'Say what the money was spent on'; end if;
  if p_occurred_on is not null and p_occurred_on > current_date then raise exception 'The date cannot be in the future'; end if;

  if p_kind in ('transfer', 'expense', 'to_project') and not exists (select 1 from chama_bank_accounts where id = p_from_account and chama_id = p_chama_id) then
    raise exception 'Choose the account the money comes from';
  end if;
  if p_kind in ('transfer', 'from_project') and not exists (select 1 from chama_bank_accounts where id = p_to_account and chama_id = p_chama_id) then
    raise exception 'Choose the account the money goes to';
  end if;
  if p_kind = 'transfer' and p_from_account = p_to_account then raise exception 'Choose two different accounts'; end if;
  if p_kind in ('expense', 'project_expense') and coalesce(trim(p_category), '') = '' then raise exception 'Choose what kind of expense this is'; end if;
  if p_kind in ('to_project', 'from_project', 'project_expense', 'project_income') then
    select * into v_proj from chama_projects where id = p_project_id and chama_id = p_chama_id;
    if v_proj.id is null then raise exception 'Choose the project'; end if;
    if v_proj.status <> 'active' then raise exception 'That project is closed'; end if;
  end if;

  insert into chama_fund_requests (chama_id, kind, amount, from_account, to_account, project_id, category, description, reference, occurred_on, requested_by)
  values (p_chama_id, p_kind, p_amount,
          case when p_kind in ('transfer', 'expense', 'to_project') then p_from_account end,
          case when p_kind in ('transfer', 'from_project') then p_to_account end,
          case when p_kind in ('to_project', 'from_project', 'project_expense', 'project_income') then p_project_id end,
          nullif(trim(coalesce(p_category, '')), ''), nullif(trim(coalesce(p_description, '')), ''), nullif(trim(coalesce(p_reference, '')), ''),
          coalesce(p_occurred_on, current_date), p_requester)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------- approve / reject (a different official) ----------------------------
create or replace function decide_fund_request(p_request_id uuid, p_decider uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer as $$
declare r chama_fund_requests%rowtype; v_who chama_members%rowtype;
begin
  select * into r from chama_fund_requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  select * into v_who from chama_members where id = p_decider and chama_id = r.chama_id;
  if v_who.id is null or lower(coalesce(v_who.role, '')) not in ('chairperson', 'chairman', 'admin') then
    raise exception 'Only the chairperson can approve or reject this';
  end if;
  if r.status <> 'PENDING' then raise exception 'This was already decided'; end if;
  if r.requested_by = p_decider then raise exception 'A different official must approve what you recorded'; end if;

  if not p_approve then
    update chama_fund_requests set status = 'REJECTED', decided_by = p_decider, decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '') where id = r.id;
    return;
  end if;

  -- enough money must be there on the day it is approved
  if r.from_account is not null and chama_account_balance(r.from_account) < r.amount then
    raise exception 'That account only has KES % — not enough to pay out KES %', chama_account_balance(r.from_account), r.amount;
  end if;
  if r.kind in ('from_project', 'project_expense') and chama_project_wallet(r.project_id) < r.amount then
    raise exception 'The project only has KES % — not enough', chama_project_wallet(r.project_id);
  end if;

  if r.kind = 'transfer' then
    insert into chama_account_entries (chama_id, account_id, direction, amount, kind, source_type, source_id, description, occurred_on, created_by)
    values (r.chama_id, r.from_account, 'debit', r.amount, 'transfer', 'fund_request', r.id, coalesce(r.description, 'Transfer between accounts'), r.occurred_on, p_decider),
           (r.chama_id, r.to_account, 'credit', r.amount, 'transfer', 'fund_request', r.id, coalesce(r.description, 'Transfer between accounts'), r.occurred_on, p_decider);
  elsif r.kind = 'expense' then
    insert into chama_account_entries (chama_id, account_id, direction, amount, kind, source_type, source_id, category, description, occurred_on, created_by)
    values (r.chama_id, r.from_account, 'debit', r.amount, 'expense', 'fund_request', r.id, r.category, r.description, r.occurred_on, p_decider);
  elsif r.kind = 'to_project' then
    insert into chama_account_entries (chama_id, account_id, direction, amount, kind, source_type, source_id, project_id, description, occurred_on, created_by)
    values (r.chama_id, r.from_account, 'debit', r.amount, 'to_project', 'fund_request', r.id, r.project_id, coalesce(r.description, 'Put into project'), r.occurred_on, p_decider);
    insert into chama_project_entries (chama_id, project_id, direction, kind, amount, description, request_id, occurred_on, created_by)
    values (r.chama_id, r.project_id, 'in', 'capital', r.amount, coalesce(r.description, 'Put in by the Chama'), r.id, r.occurred_on, p_decider);
  elsif r.kind = 'from_project' then
    insert into chama_project_entries (chama_id, project_id, direction, kind, amount, description, request_id, occurred_on, created_by)
    values (r.chama_id, r.project_id, 'out', 'returned', r.amount, coalesce(r.description, 'Returned to the Chama'), r.id, r.occurred_on, p_decider);
    insert into chama_account_entries (chama_id, account_id, direction, amount, kind, source_type, source_id, project_id, description, occurred_on, created_by)
    values (r.chama_id, r.to_account, 'credit', r.amount, 'from_project', 'fund_request', r.id, r.project_id, coalesce(r.description, 'Returned from project'), r.occurred_on, p_decider);
  elsif r.kind = 'project_expense' then
    insert into chama_project_entries (chama_id, project_id, direction, kind, amount, category, description, request_id, occurred_on, created_by)
    values (r.chama_id, r.project_id, 'out', 'expense', r.amount, r.category, r.description, r.id, r.occurred_on, p_decider);
  elsif r.kind = 'project_income' then
    insert into chama_project_entries (chama_id, project_id, direction, kind, amount, description, request_id, occurred_on, created_by)
    values (r.chama_id, r.project_id, 'in', 'income', r.amount, coalesce(r.description, 'Project income'), r.id, r.occurred_on, p_decider);
  end if;

  update chama_fund_requests set status = 'APPROVED', decided_by = p_decider, decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '') where id = r.id;
end;
$$;

-- ---------- put an unassigned repayment into an account -------------------------
create or replace function assign_entry_account(p_entry_id uuid, p_account_id uuid, p_actor uuid)
returns void language plpgsql security definer as $$
declare e chama_account_entries%rowtype; v_who chama_members%rowtype;
begin
  select * into e from chama_account_entries where id = p_entry_id for update;
  if e.id is null then raise exception 'Entry not found'; end if;
  select * into v_who from chama_members where id = p_actor and chama_id = e.chama_id;
  if v_who.id is null or lower(coalesce(v_who.role, '')) not in ('treasurer', 'chairperson', 'chairman', 'admin') then raise exception 'Only the treasurer can do this'; end if;
  if e.account_id is not null then raise exception 'Already assigned to an account'; end if;
  if not exists (select 1 from chama_bank_accounts where id = p_account_id and chama_id = e.chama_id) then raise exception 'Choose one of this Chama''s accounts'; end if;
  update chama_account_entries set account_id = p_account_id where id = p_entry_id;
end;
$$;

-- ---------- one-call overview ---------------------------------------------------
create or replace function chama_funds_overview(p_chama_id uuid, p_requester uuid, p_from date default null, p_to date default null)
returns jsonb language plpgsql security definer stable as $$
declare v_who chama_members%rowtype;
begin
  select * into v_who from chama_members where id = p_requester and chama_id = p_chama_id;
  if v_who.id is null or lower(coalesce(v_who.role, '')) not in ('secretary', 'treasurer', 'chairperson', 'chairman', 'admin') then
    raise exception 'The funds overview is for Chama officials only';
  end if;
  return jsonb_build_object(
    'accounts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.account_name, 'type', a.account_type, 'opening', coalesce(a.opening_balance, 0),
        'in', coalesce((select sum(amount) from chama_account_entries e where e.account_id = a.id and e.direction = 'credit'), 0),
        'out', coalesce((select sum(amount) from chama_account_entries e where e.account_id = a.id and e.direction = 'debit'), 0),
        'balance', chama_account_balance(a.id)) order by a.account_name)
      from chama_bank_accounts a where a.chama_id = p_chama_id and coalesce(a.is_active, true)), '[]'::jsonb),
    'unassigned', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'amount', e.amount, 'direction', e.direction, 'kind', e.kind, 'on', e.occurred_on, 'description', e.description) order by e.occurred_on desc)
      from chama_account_entries e where e.chama_id = p_chama_id and e.account_id is null), '[]'::jsonb),
    'projects', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'status', p.status, 'description', p.description, 'target', p.target_amount, 'started_on', p.started_on,
        'capital', coalesce((select sum(amount) from chama_project_entries x where x.project_id = p.id and x.kind = 'capital'), 0),
        'income', coalesce((select sum(amount) from chama_project_entries x where x.project_id = p.id and x.kind = 'income'), 0),
        'expenses', coalesce((select sum(amount) from chama_project_entries x where x.project_id = p.id and x.kind = 'expense'), 0),
        'returned', coalesce((select sum(amount) from chama_project_entries x where x.project_id = p.id and x.kind = 'returned'), 0),
        'wallet', chama_project_wallet(p.id)) order by p.created_at desc)
      from chama_projects p where p.chama_id = p_chama_id), '[]'::jsonb),
    'expenses_by_category', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'total', total) order by total desc) from (
        select coalesce(category, 'Other') as category, sum(amount) as total from chama_account_entries
        where chama_id = p_chama_id and kind = 'expense' and (p_from is null or occurred_on >= p_from) and (p_to is null or occurred_on <= p_to) group by 1) q), '[]'::jsonb),
    'pending_requests', (select count(*) from chama_fund_requests where chama_id = p_chama_id and status = 'PENDING')
  );
end;
$$;

grant execute on function chama_account_balance(uuid) to anon, authenticated;
grant execute on function chama_project_wallet(uuid) to anon, authenticated;
grant execute on function create_chama_project(uuid, uuid, text, text, numeric, date) to anon, authenticated;
grant execute on function request_fund_movement(uuid, uuid, text, numeric, uuid, uuid, uuid, text, text, text, date) to anon, authenticated;
grant execute on function decide_fund_request(uuid, uuid, boolean, text) to anon, authenticated;
grant execute on function assign_entry_account(uuid, uuid, uuid) to anon, authenticated;
grant execute on function chama_funds_overview(uuid, uuid, date, date) to anon, authenticated;

notify pgrst, 'reload schema';
