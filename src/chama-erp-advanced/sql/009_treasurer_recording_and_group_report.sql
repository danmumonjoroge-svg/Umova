-- =============================================================================
-- 009 — Treasurer records contributions for members + group report
-- Run AFTER 001, 002 and 006 (needs post_contribution and chama_ledger_entries).
-- Safe to re-run: every statement is create-or-replace / if-not-exists.
-- =============================================================================

-- Marks requests the treasurer entered on a member's behalf.
alter table chama_contribution_requests add column if not exists recorded_by_treasurer boolean default false;
alter table chama_contribution_requests add column if not exists entered_by uuid references chama_members(id);

-- -----------------------------------------------------------------------------
-- record_member_contribution
-- For members without a smartphone: the treasurer enters what the member paid.
-- It goes through the SAME path as a member declaration — a contribution
-- request that is VERIFIED and then posted by post_contribution() — so the
-- ledger, member balance and loan balance are updated by the one existing
-- function. No second way of moving money is created.
-- -----------------------------------------------------------------------------
create or replace function record_member_contribution(
  p_chama_id uuid,
  p_recorder uuid,                 -- the treasurer (chama_members.id)
  p_member_id uuid,                -- the member who paid
  p_amount numeric,
  p_type text,                     -- savings | shares | welfare | fine | loan_repayment
  p_contributed_on date,
  p_method text,                   -- CASH | MPESA | BANK
  p_bank_account_id uuid default null,
  p_reference text default null,
  p_loan_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_rec chama_members%rowtype;
  v_mem chama_members%rowtype;
  v_loan chama_loans%rowtype;
  v_req_id uuid;
  v_method text := upper(coalesce(p_method, ''));
begin
  select * into v_rec from chama_members where id = p_recorder and chama_id = p_chama_id;
  if v_rec.id is null or lower(coalesce(v_rec.role, '')) not in ('treasurer', 'chairperson', 'chairman', 'admin')
     or coalesce(v_rec.status, 'active') <> 'active' then
    raise exception 'Only the treasurer can record a contribution for a member';
  end if;

  select * into v_mem from chama_members where id = p_member_id and chama_id = p_chama_id;
  if v_mem.id is null then raise exception 'That member does not belong to this Chama'; end if;

  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than zero'; end if;
  if p_type not in ('savings', 'shares', 'welfare', 'fine', 'loan_repayment') then raise exception 'Unknown contribution type %', p_type; end if;
  if v_method not in ('CASH', 'MPESA', 'BANK') then raise exception 'Payment method must be Cash, M-Pesa or Bank'; end if;
  if p_contributed_on is null or p_contributed_on > current_date then raise exception 'The date paid cannot be in the future'; end if;

  if v_method <> 'CASH' then
    if p_bank_account_id is null then raise exception 'Choose the Chama account the money went into'; end if;
    if coalesce(trim(p_reference), '') = '' then raise exception 'Enter the M-Pesa code or bank reference'; end if;
    if not exists (select 1 from chama_bank_accounts where id = p_bank_account_id and chama_id = p_chama_id) then
      raise exception 'That account does not belong to this Chama';
    end if;
    -- the same M-Pesa code / bank reference must not be counted twice
    if exists (select 1 from chama_contribution_requests
               where chama_id = p_chama_id and upper(transaction_ref) = upper(trim(p_reference)) and status <> 'REJECTED') then
      raise exception 'The reference % has already been recorded', trim(p_reference);
    end if;
  end if;

  if p_type = 'loan_repayment' then
    select * into v_loan from chama_loans where id = p_loan_id and chama_id = p_chama_id and member_id = p_member_id;
    if v_loan.id is null then raise exception 'Choose which of this member''s loans is being repaid'; end if;
    if not coalesce(v_loan.disbursed, false) or v_loan.status <> 'active' then raise exception 'That loan is not active'; end if;
  end if;

  -- guard against a double tap: identical entry by this treasurer in the last minute
  if exists (select 1 from chama_contribution_requests
             where chama_id = p_chama_id and member_id = p_member_id and entered_by = p_recorder
               and amount = p_amount and contribution_type = p_type and contributed_on = p_contributed_on
               and created_at > now() - interval '60 seconds') then
    raise exception 'This looks like the same entry just recorded — not saved twice';
  end if;

  insert into chama_contribution_requests (
    chama_id, member_id, bank_account_id, amount, contribution_type, contributed_on, payment_method,
    transaction_ref, member_notes, status, verified_by, verified_at, bank_statement_amount, verification_notes,
    loan_id, recorded_by_treasurer, entered_by
  ) values (
    p_chama_id, p_member_id, p_bank_account_id,
    p_amount, p_type, p_contributed_on, v_method,
    nullif(trim(coalesce(p_reference, '')), ''), nullif(trim(coalesce(p_notes, '')), ''),
    'VERIFIED', p_recorder, now(), p_amount,
    case when v_method = 'CASH' then 'Cash received by treasurer, recorded on behalf of member'
         else 'Recorded by treasurer on behalf of member' end,
    case when p_type = 'loan_repayment' then p_loan_id else null end, true, p_recorder
  ) returning id into v_req_id;

  perform post_contribution(v_req_id, p_recorder);   -- ledger + balances, exactly as for any contribution
  return v_req_id;
end;
$$;

grant execute on function record_member_contribution(uuid, uuid, uuid, numeric, text, date, text, uuid, text, uuid, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- chama_group_report
-- One call returns the whole group statement as JSON, summed in the database
-- (so it is not cut off by the 1,000-row limit on ordinary table reads).
-- Officials only. Read-only.
-- -----------------------------------------------------------------------------
create or replace function chama_group_report(p_chama_id uuid, p_requester uuid, p_from date default null, p_to date default null)
returns jsonb
language plpgsql
security definer
stable
as $$
declare
  v_req chama_members%rowtype;
  v_from timestamptz := case when p_from is null then null else p_from::timestamp at time zone 'Africa/Nairobi' end;
  v_to timestamptz := case when p_to is null then null else (p_to + 1)::timestamp at time zone 'Africa/Nairobi' end;
  v_result jsonb;
begin
  select * into v_req from chama_members where id = p_requester and chama_id = p_chama_id;
  if v_req.id is null or lower(coalesce(v_req.role, '')) not in ('secretary', 'treasurer', 'chairperson', 'chairman', 'admin') then
    raise exception 'The group report is for Chama officials only';
  end if;

  select jsonb_build_object(
    'generated_at', now(),
    'from', p_from, 'to', p_to,

    -- money in / out per account, with opening and closing positions
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'account', account_type,
        'opening', opening, 'paid_in', paid_in, 'paid_out', paid_out, 'closing', closing))
      from (
        select account_type,
          coalesce(sum(case when v_from is not null and created_at < v_from then (case when direction = 'credit' then amount else -amount end) end), 0) as opening,
          coalesce(sum(case when (v_from is null or created_at >= v_from) and (v_to is null or created_at < v_to) and direction = 'credit' then amount end), 0) as paid_in,
          coalesce(sum(case when (v_from is null or created_at >= v_from) and (v_to is null or created_at < v_to) and direction = 'debit' then amount end), 0) as paid_out,
          coalesce(sum(case when (v_to is null or created_at < v_to) then (case when direction = 'credit' then amount else -amount end) end), 0) as closing
        from chama_ledger_entries where chama_id = p_chama_id group by account_type
      ) a), '[]'::jsonb),

    -- one line per member
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.name, 'phone', m.phone, 'role', m.role, 'status', m.status,
        'savings', coalesce(m.savings_balance, 0), 'shares', coalesce(m.shares_balance, 0), 'welfare', coalesce(m.welfare_balance, 0),
        'loan_owed', coalesce((select sum(coalesce(l.balance, l.amount)) from chama_loans l
                               where l.member_id = m.id and l.disbursed and l.status = 'active'), 0),
        'fines_paid', coalesce((select sum(e.amount) from chama_ledger_entries e
                                where e.member_id = m.id and e.account_type = 'fine' and e.direction = 'credit'
                                  and (v_from is null or e.created_at >= v_from) and (v_to is null or e.created_at < v_to)), 0),
        'paid_in_period', coalesce((select sum(e.amount) from chama_ledger_entries e
                                    where e.member_id = m.id and e.direction = 'credit'
                                      and e.account_type in ('savings', 'shares', 'welfare', 'fine', 'loan_repayment')
                                      and (v_from is null or e.created_at >= v_from) and (v_to is null or e.created_at < v_to)), 0)
      ) order by m.name)
      from chama_members m where m.chama_id = p_chama_id), '[]'::jsonb),

    -- loan book
    'loans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'member', coalesce(l.member_name, m.name), 'amount', l.amount, 'balance', coalesce(l.balance, l.amount),
        'status', l.status, 'disbursed', l.disbursed, 'disbursed_on', l.disbursement_date, 'interest_rate', l.interest_rate,
        'repaid', coalesce((select sum(r.amount) from chama_loan_repayments r where r.loan_id = l.id), 0)
      ) order by l.disbursement_date desc nulls last)
      from chama_loans l left join chama_members m on m.id = l.member_id
      where l.chama_id = p_chama_id and coalesce(l.disbursed, false)), '[]'::jsonb),
    'loans_waiting_payout', (select count(*) from chama_loans where chama_id = p_chama_id and not coalesce(disbursed, false)),
    'loan_applications_open', (select count(*) from chama_loan_applications where chama_id = p_chama_id and status in ('Pending', 'Awaiting Approval')),
    'loan_repaid_in_period', coalesce((select sum(amount) from chama_loan_repayments
        where chama_id = p_chama_id and (v_from is null or created_at >= v_from) and (v_to is null or created_at < v_to)), 0),

    -- welfare
    'welfare', jsonb_build_object(
      'cases_open', (select count(*) from welfare_cases where chama_id = p_chama_id and status = 'open'),
      'cases_closed', (select count(*) from welfare_cases where chama_id = p_chama_id and status <> 'open'),
      'case_contributions_in_period', coalesce((select sum(amount) from welfare_contributions
          where chama_id = p_chama_id and status = 'Approved'
            and (p_from is null or contributed_on >= p_from) and (p_to is null or contributed_on <= p_to)), 0)),

    -- waiting for the treasurer
    'awaiting_check', (select count(*) from chama_contribution_requests where chama_id = p_chama_id and status in ('PENDING', 'VERIFIED'))
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function chama_group_report(uuid, uuid, date, date) to anon, authenticated;

notify pgrst, 'reload schema';
