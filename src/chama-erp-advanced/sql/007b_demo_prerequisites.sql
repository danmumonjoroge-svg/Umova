-- =============================================================================
-- 007b — DEMO PREREQUISITES (combined, safe to re-run)
-- Bundles 006_fixes_and_hardening.sql + 007_announcements.sql + the welfare
-- module migration so the demo chama (008) has every table/column it needs.
-- Every statement is additive/idempotent. Billing (005) is NOT included/required.
-- Run this ONCE in the Supabase SQL editor, then run 008_demo_chama.sql.
-- =============================================================================

-- =============================================================================
-- PART: 006_fixes_and_hardening.sql
-- =============================================================================
-- =============================================================================
-- CHAMA ERP — FIX & HARDENING PASS (run AFTER 001–005)
-- =============================================================================
-- This migration fixes bugs found in a full audit of the delivered package.
-- Every finding below is real and reproducible against the shipped code —
-- see AUDIT_REPORT.md at the root of this package for the full write-up,
-- severity ranking, and what's still deliberately left as a roadmap item.
--
-- Safe to re-run: additive columns/functions only, no drops.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- FIX 1 — chama_members is missing columns the shipped UI already writes to.
-- MembersDirectory.js inserts `national_id`, updates `remarks`, and sets
-- `approved_by` / `approved_at` / `suspended_at` — none of which exist on
-- chama_members in 001_schema_upgrade.sql. Every "Add member" with a
-- national ID, every "Approve", every "Suspend", and every "Edit role" with
-- a remark fails in production with a Postgres "column does not exist"
-- error. This was a documentation/implementation mismatch: the README
-- claimed these columns "already exist," but no migration ever created them.
-- -----------------------------------------------------------------------------
alter table chama_members add column if not exists national_id text;
alter table chama_members add column if not exists remarks text;
alter table chama_members add column if not exists approved_by uuid references chama_members(id);
alter table chama_members add column if not exists approved_at timestamptz;
alter table chama_members add column if not exists suspended_at timestamptz;

-- -----------------------------------------------------------------------------
-- FIX 2 — is_chama_licensed() silently disagrees with the client's own
-- definition of "licensed."
--
-- ChamaContext.js's isLicenseValid() and ChamaSelector.js's licenseTone()
-- both treat license_status IN ('active','trial') as valid. But the SQL
-- function is_chama_licensed() — called on every session restore in
-- ChamaContext.js's useEffect — only checked license_status = 'active'.
-- Every self-registered chama is created via register_chama() with
-- license_status = 'trial' (sql/004). Result: a brand-new trial chama logs
-- in fine, but the moment the browser is refreshed or reopened, the
-- background re-validation call silently kicks the chairperson out with
-- "This chama's license is no longer active" even though nothing expired.
-- -----------------------------------------------------------------------------
create or replace function is_chama_licensed(p_chama_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select
    c.license_status in ('active', 'trial')
    and (c.license_expiry is null or c.license_expiry >= current_date)
  from chamas c
  where c.id = p_chama_id;
$$;

-- -----------------------------------------------------------------------------
-- FIX 3 — no way to actually suspend a chama.
-- LicenseManager.js's `effectiveStatus()` and the login gate both know how
-- to render/block a 'suspended' license_status, but nothing anywhere in the
-- platform-admin UI, or any SQL function, ever sets it. A platform admin
-- who needs to pull a chama offline immediately (abuse, non-payment
-- dispute, fraud) has no button for it today — the only lever is waiting
-- for the prepaid period to lapse. set_chama_free(false) does not suspend;
-- it marks the chama 'expired', which is a different, softer state (an
-- expired chama can be restored by the *next real payment*; a suspended one
-- should require a deliberate un-suspend).
-- -----------------------------------------------------------------------------
create or replace function set_chama_suspended(p_chama_id uuid, p_suspended boolean, p_reason text default null)
returns void
language plpgsql
security definer
as $$
begin
  if p_suspended then
    update chamas set license_status = 'suspended' where id = p_chama_id;
  else
    -- Un-suspending restores whatever the expiry date says is true — it does
    -- NOT grant free access. If the license has actually lapsed, un-suspending
    -- correctly lands the chama back on 'expired', not 'active'.
    update chamas
      set license_status = case
        when license_plan = 'free' then 'active'
        when license_expiry is null or license_expiry >= current_date then 'active'
        else 'expired'
      end
      where id = p_chama_id;
  end if;
  insert into chama_payments (chama_id, amount, method, reference, period_days, recorded_by, notes)
  values (p_chama_id, 0, 'ADMIN', null, 0, 'platform admin',
    (case when p_suspended then 'Chama suspended' else 'Chama un-suspended' end)
      || case when p_reason is not null then ': ' || p_reason else '' end);
exception when others then
  -- The audit-trail insert above is best-effort convenience (reusing
  -- chama_payments as a free timeline is a shortcut, not a real audit
  -- table) — never let it block the actual suspend/unsuspend action.
  null;
end;
$$;

grant execute on function set_chama_suspended(uuid, boolean, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- FIX 4 — "Loan Repayment" is offered as a contribution type on
-- MemberContributionForm.js, and TreasurerReconciliation.js happily
-- verifies and "approves & posts" it — but post_contribution()'s
-- loan_repayment branch was a deliberate no-op ("the app layer calls
-- apply_loan_repayment() instead"). Nothing ever did. Net effect: a member
-- who declares a loan repayment through the normal contribution flow gets
-- told it was "Approved & posted," a ledger credit entry is written, and
-- their loan balance never moves by one shilling. The money is recorded as
-- received but the debt never shrinks — this is a real, silent accounting
-- bug, not just a missing feature.
--
-- Fix: give contribution requests an optional loan_id, and make
-- post_contribution() actually apply the repayment (insert the repayment
-- row + decrement the loan balance + close it at zero) when
-- contribution_type = 'loan_repayment', instead of doing nothing.
-- -----------------------------------------------------------------------------
alter table chama_contribution_requests add column if not exists loan_id uuid references chama_loans(id);

create or replace function post_contribution(p_request_id uuid, p_approver uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  v_req chama_contribution_requests%rowtype;
  v_ledger_id uuid;
  v_loan chama_loans%rowtype;
begin
  select * into v_req from chama_contribution_requests where id = p_request_id for update;

  if v_req.id is null then
    raise exception 'Contribution request % not found', p_request_id;
  end if;
  if v_req.member_id is null then
    raise exception 'Contribution % has no member_id set — cannot post to a member balance', p_request_id;
  end if;
  if v_req.status <> 'VERIFIED' then
    raise exception 'Contribution % must be VERIFIED before it can be posted (currently %)', p_request_id, v_req.status;
  end if;
  if v_req.posted then
    raise exception 'Contribution % has already been posted', p_request_id;
  end if;

  -- Loan repayments declared through the member contribution flow need a
  -- loan on file before they can post — same rule the dedicated Repayment
  -- Desk enforces, just reached from a different screen.
  if v_req.contribution_type = 'loan_repayment' and v_req.loan_id is null then
    raise exception 'Contribution % is a loan repayment but has no loan_id set — the member must pick which loan they are repaying', p_request_id;
  end if;

  insert into chama_ledger_entries (chama_id, member_id, account_type, direction, amount, source_type, source_id, description, created_by)
  values (
    v_req.chama_id, v_req.member_id, v_req.contribution_type, 'credit', v_req.amount,
    'contribution', v_req.id,
    'Contribution verified against account, ref ' || coalesce(v_req.transaction_ref, 'n/a'),
    p_approver
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

    insert into chama_loan_repayments (chama_id, loan_id, member_id, amount, method, reference, recorded_by)
    values (v_req.chama_id, v_loan.id, v_req.member_id, v_req.amount, v_req.payment_method, v_req.transaction_ref, p_approver);

    update chama_loans
      set balance = greatest(coalesce(balance, amount) - v_req.amount, 0),
          status = case when coalesce(balance, amount) - v_req.amount <= 0 then 'closed' else status end
      where id = v_loan.id;
  end if;

  return v_ledger_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- FIX 5 — disburse_loan() and apply_loan_repayment() had no guard rails
-- beyond "does the row exist."
--   - disburse_loan() never checked the loan actually finished the approval
--     chain (a loan row only exists once LoanApprovalQueue.js creates it on
--     full approval today, so this is currently unreachable in practice —
--     but it's exactly the kind of implicit invariant that breaks the
--     moment someone adds a second way to create a chama_loans row, e.g. a
--     data import). It also never checked the paying account belongs to
--     the same chama as the loan — with RLS still off (see AUDIT_REPORT.md
--     P0 finding), a crafted request could disburse chama A's loan "from"
--     chama B's bank account, corrupting both chamas' books.
--   - apply_loan_repayment() never validated p_amount > 0, never checked
--     the loan was actually disbursed, and let repayments post against an
--     already-closed loan.
-- -----------------------------------------------------------------------------
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
  if v_loan.id is null then
    raise exception 'Loan % not found', p_loan_id;
  end if;
  if v_loan.disbursed then
    raise exception 'Loan % already disbursed', p_loan_id;
  end if;
  if v_loan.status is distinct from 'active' then
    raise exception 'Loan % is not in an active/approved state (status: %)', p_loan_id, v_loan.status;
  end if;

  select * into v_account from chama_bank_accounts where id = p_source_account;
  if v_account.id is null then
    raise exception 'Source account % not found', p_source_account;
  end if;
  if v_account.chama_id is distinct from v_loan.chama_id then
    raise exception 'Source account belongs to a different chama than this loan';
  end if;
  if not coalesce(v_account.is_active, false) then
    raise exception 'Source account is not active';
  end if;

  update chama_loans
    set disbursed = true, disbursement_date = current_date,
        disbursement_source = p_source_account, disbursed_by = p_disburser,
        balance = amount
    where id = p_loan_id;

  insert into chama_ledger_entries (chama_id, member_id, account_type, direction, amount, source_type, source_id, description, created_by)
  values (
    v_loan.chama_id, v_loan.member_id, 'loan_disbursement', 'debit', v_loan.amount,
    'loan_disbursement', v_loan.id, 'Loan disbursed to member', p_disburser
  );
end;
$$;

create or replace function apply_loan_repayment(p_loan_id uuid, p_amount numeric, p_method text, p_reference text, p_recorder uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  v_loan chama_loans%rowtype;
  v_repayment_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Repayment amount must be greater than zero';
  end if;

  select * into v_loan from chama_loans where id = p_loan_id for update;
  if v_loan.id is null then
    raise exception 'Loan % not found', p_loan_id;
  end if;
  if not coalesce(v_loan.disbursed, false) then
    raise exception 'Loan % has not been disbursed yet — nothing to repay', p_loan_id;
  end if;
  if v_loan.status = 'closed' then
    raise exception 'Loan % is already closed — this repayment would have no loan to apply against. If this is a refund/overpayment, record it separately.', p_loan_id;
  end if;

  insert into chama_loan_repayments (chama_id, loan_id, member_id, amount, method, reference, recorded_by)
  values (v_loan.chama_id, p_loan_id, v_loan.member_id, p_amount, p_method, p_reference, p_recorder)
  returning id into v_repayment_id;

  update chama_loans
    set balance = greatest(coalesce(balance, amount) - p_amount, 0),
        status = case when coalesce(balance, amount) - p_amount <= 0 then 'closed' else status end
    where id = p_loan_id;

  insert into chama_ledger_entries (chama_id, member_id, account_type, direction, amount, source_type, source_id, description, created_by)
  values (v_loan.chama_id, v_loan.member_id, 'loan_repayment', 'credit', p_amount, 'loan_repayment', v_repayment_id, 'Loan repayment', p_recorder);

  return v_repayment_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- FIX 6 — LoanApprovalQueue.js has a lost-update race condition.
-- Approve/reject is implemented client-side as: fetch the row, check the
-- current member's role hasn't already signed, append a JS object to the
-- fetched `approvals` array, then write the WHOLE array back. Two officials
-- (e.g. secretary and treasurer) approving within the same few hundred
-- milliseconds both read the array before either write lands; the second
-- write overwrites the first with its own stale snapshot plus its own
-- entry, silently discarding one of the two approvals. A loan can end up
-- stuck "Awaiting Approval" forever with only one signature actually
-- recorded, or in rarer timings, wrongly marked fully approved short of a
-- real quorum.
--
-- Fix: move the whole read-modify-write into one row-locked, atomic
-- function. The client now calls this instead of doing its own fetch +
-- JS array surgery + update (see LoanApprovalQueue.js).
-- -----------------------------------------------------------------------------
create or replace function submit_loan_decision(
  p_application_id uuid,
  p_member_id uuid,
  p_role text,
  p_decision text,       -- 'approve' | 'reject'
  p_comment text default null
)
returns table (status text, fully_approved boolean, loan_id uuid)
language plpgsql
security definer
as $$
declare
  v_app chama_loan_applications%rowtype;
  v_chain jsonb;
  v_approvals jsonb;
  v_entry jsonb;
  v_approved_roles text[];
  v_fully_approved boolean;
  v_new_loan_id uuid;
  v_member_name text;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'Invalid decision %', p_decision;
  end if;

  select * into v_app from chama_loan_applications where id = p_application_id for update;
  if v_app.id is null then
    raise exception 'Application % not found', p_application_id;
  end if;
  if v_app.status not in ('Pending', 'Awaiting Approval') then
    raise exception 'Application % is no longer awaiting a decision (status: %)', p_application_id, v_app.status;
  end if;

  v_chain := case when jsonb_typeof(v_app.approver_roles) = 'array' then v_app.approver_roles
             when v_app.approver_roles is not null then v_app.approver_roles::text::jsonb
             else '[]'::jsonb end;
  v_approvals := case when jsonb_typeof(v_app.approvals) = 'array' then v_app.approvals
                 when v_app.approvals is not null then v_app.approvals::text::jsonb
                 else '[]'::jsonb end;

  if not (v_chain ? p_role) then
    raise exception 'Role % is not part of this application''s approval chain', p_role;
  end if;
  if exists (select 1 from jsonb_array_elements(v_approvals) a where a->>'role' = p_role) then
    raise exception 'You have already recorded a decision in this role for this application';
  end if;

  select name into v_member_name from chama_members where id = p_member_id;

  v_entry := jsonb_build_object(
    'role', p_role, 'member_id', p_member_id, 'name', v_member_name,
    'decision', p_decision, 'comment', p_comment, 'decided_at', now()
  );
  v_approvals := v_approvals || jsonb_build_array(v_entry);

  if p_decision = 'reject' then
    update chama_loan_applications
      set approvals = v_approvals, status = 'Rejected', rejected_at = now(),
          remarks = coalesce(p_comment, 'Rejected by ' || p_role)
      where id = p_application_id;
    return query select 'Rejected'::text, false, null::uuid;
    return;
  end if;

  select array_agg(a->>'role') into v_approved_roles
    from jsonb_array_elements(v_approvals) a where a->>'decision' = 'approve';
  v_approved_roles := coalesce(v_approved_roles, array[]::text[]);

  select bool_and(role_needed = any (v_approved_roles))
    into v_fully_approved
    from jsonb_array_elements_text(v_chain) role_needed;
  v_fully_approved := coalesce(v_fully_approved, false);

  if v_fully_approved then
    v_new_loan_id := gen_random_uuid();
    update chama_loan_applications
      set approvals = v_approvals, status = 'Approved', approved_at = now(), loan_id = v_new_loan_id
      where id = p_application_id;

    insert into chama_loans (
      id, chama_id, member_id, member_name, application_id, amount,
      interest_rate, interest_type, repayment_months, balance, disbursed, status
    ) values (
      v_new_loan_id, v_app.chama_id, v_app.member_id, v_app.member_name, v_app.id, v_app.requested_amount,
      v_app.interest_rate, v_app.interest_type, v_app.repayment_months, v_app.requested_amount, false, 'active'
    );

    return query select 'Approved'::text, true, v_new_loan_id;
  else
    update chama_loan_applications
      set approvals = v_approvals, status = 'Awaiting Approval'
      where id = p_application_id;
    return query select 'Awaiting Approval'::text, false, null::uuid;
  end if;
end;
$$;

grant execute on function submit_loan_decision(uuid, uuid, text, text, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- FIX 7 — loan rules (min_membership_months, max_active_loans_per_member)
-- exist on chama_loan_rules and are fully editable in LoanRulesCard.js, but
-- nothing anywhere ever reads them back to block an application. A chama
-- can configure "members must wait 6 months" and "max 1 active loan," and
-- both settings are pure decoration — MemberLoanApplication.js only
-- enforces the savings-multiplier cap and guarantor coverage.
--
-- Fix: enforce both server-side with a trigger on chama_loan_applications,
-- so it can't be bypassed by any future client screen either.
-- -----------------------------------------------------------------------------
create or replace function enforce_loan_application_rules()
returns trigger
language plpgsql
as $$
declare
  v_rules chama_loan_rules%rowtype;
  v_joined_at timestamptz;
  v_months numeric;
  v_active_count integer;
begin
  select * into v_rules from chama_loan_rules where chama_id = new.chama_id;
  if v_rules.id is null then
    return new; -- no rules configured for this chama yet — nothing to enforce
  end if;

  if coalesce(v_rules.min_membership_months, 0) > 0 then
    select joined_at into v_joined_at from chama_members where id = new.member_id;
    if v_joined_at is not null then
      v_months := extract(epoch from (now() - v_joined_at)) / (30.0 * 86400);
      if v_months < v_rules.min_membership_months then
        raise exception 'This chama requires % months of membership before applying for a loan (you have %.1f)', v_rules.min_membership_months, v_months;
      end if;
    end if;
  end if;

  if coalesce(v_rules.max_active_loans_per_member, 1) is not null then
    select count(*) into v_active_count
      from chama_loans
      where member_id = new.member_id and chama_id = new.chama_id and status = 'active';
    if v_active_count >= coalesce(v_rules.max_active_loans_per_member, 1) then
      raise exception 'You already have % active loan(s) — this chama allows a maximum of %', v_active_count, v_rules.max_active_loans_per_member;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_loan_application_rules on chama_loan_applications;
create trigger trg_enforce_loan_application_rules
  before insert on chama_loan_applications
  for each row execute function enforce_loan_application_rules();

-- -----------------------------------------------------------------------------
-- NOTE ON RLS (kept intentionally out of scope for this pass, same as prior
-- migrations, but documented plainly rather than left silent):
--
-- Every table in this schema is still readable/writable by any request
-- carrying Supabase's anon key, scoped only by whatever `.eq("chama_id", …)`
-- the calling React component happens to add — there is no server-side
-- enforcement that a logged-in member of chama A cannot read or write
-- chama B's rows. The welfare module's migrations.sql ships example RLS
-- policies keyed off `auth.uid()`, but this ERP does NOT use Supabase Auth
-- — login goes through the custom chama_users/authenticate_user() scheme
-- in sql/002. auth.uid() is always NULL for these sessions, so every
-- example policy in welfare/migrations.sql is inert if enabled as written
-- — it would not error, it would just always evaluate to false/true in a
-- way that doesn't correspond to who is actually logged in.
--
-- This needs a real decision, not a patch: either (a) migrate login to ride
-- on Supabase Auth (phone number as the identifier, custom claims for
-- chama_member_id) so auth.uid() means something and standard RLS applies,
-- or (b) issue your own signed JWT from authenticate_user() with a
-- chama_member_id claim and write RLS policies against
-- current_setting('request.jwt.claims', true)::json. Both are real
-- projects, not a five-line fix — see AUDIT_REPORT.md, Finding P0-1.
-- =============================================================================

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

-- =============================================================================
-- PART: 007_announcements.sql
-- =============================================================================
-- =============================================================================
-- 007 — Chama announcements (the "Updates" area of the mobile app)
-- Additive and idempotent. The only new table the redesign needs: nothing in
-- the existing schema stores meeting notices, reminders or Chama notices.
-- Follows the same pattern as the other feature tables: tenant column +
-- explicit add-column-if-not-exists.
-- =============================================================================
create table if not exists chama_announcements (
  id uuid primary key default gen_random_uuid()
);

alter table chama_announcements add column if not exists chama_id uuid not null;
alter table chama_announcements add column if not exists title text not null;
alter table chama_announcements add column if not exists body text;
alter table chama_announcements add column if not exists kind text default 'notice';   -- meeting | reminder | notice
alter table chama_announcements add column if not exists event_date date;              -- set for meetings / dated events
alter table chama_announcements add column if not exists pinned boolean default false;
alter table chama_announcements add column if not exists expires_on date;
alter table chama_announcements add column if not exists created_by uuid references chama_members(id);
alter table chama_announcements add column if not exists created_at timestamptz default now();

create index if not exists idx_announcements_chama on chama_announcements(chama_id, pinned desc, created_at desc);

-- RLS: NOT enabled here, for the same reason as every other feature table in
-- this package (see AUDIT_REPORT P2-1): the app uses custom phone+password
-- auth, so auth.uid() is not available to write policies against yet. Until
-- that decision is made, "only secretary/chairperson can post" is enforced in
-- the UI only. Treat this table as writable by any client holding the anon key.

-- =============================================================================
-- PART: welfare/migrations.sql (guarded)
-- =============================================================================
-- =============================================================================
-- Welfare module upgrade — additive migrations
--
-- Nothing here drops or renames existing columns/tables. Everything is a new
-- nullable column, a new table with sensible defaults, or a new policy.
-- Run in order. Review the RLS section against your actual auth/RBAC schema
-- before applying — it assumes `chama_members.user_id = auth.uid()` and a
-- `role` column on `chama_members`; adjust to match your real schema.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Contribution sources + pledges (welfare_contributions)
-- -----------------------------------------------------------------------------
alter table welfare_contributions
  alter column member_id drop not null; -- external/organization/anonymous contributions have no member

alter table welfare_contributions
  add column if not exists source_type text not null default 'member'
    check (source_type in ('member', 'external', 'organization', 'anonymous')),
  add column if not exists contributor_name text,        -- external individual or organization name
  add column if not exists contributor_contact text,      -- phone/email, optional, external/org only
  add column if not exists payment_method text,           -- 'cash' | 'bank' | 'mobile_money' | 'cheque' | 'other'
  add column if not exists reference text,                -- transaction/reference number
  add column if not exists is_pledge boolean not null default false,
  add column if not exists pledged_amount numeric,         -- set when is_pledge = true
  add column if not exists amount_received numeric,        -- running total actually received against the pledge
  add column if not exists expected_payment_date date,     -- pledge only
  add column if not exists rejection_reason text,          -- populated when status is set to Rejected
  add column if not exists received_by uuid;               -- officer who logged the contribution

comment on column welfare_contributions.source_type is
  'member | external | organization | anonymous. member_id is only meaningful when source_type = member.';
comment on column welfare_contributions.amount is
  'For a non-pledge contribution: the amount received. For a pledge, mirrors pledged_amount for backward compatibility with existing SUM(amount) reporting; use amount_received for the actually-collected figure.';

-- Same source/pledge fields on event-level contributions, for consistency.
-- (Guarded: that legacy table only exists on databases that had the older welfare module.)
do $evt$
begin
  if to_regclass('welfare_event_contributions') is not null then
    alter table welfare_event_contributions alter column member_id drop not null;
    alter table welfare_event_contributions
      add column if not exists source_type text not null default 'member',
      add column if not exists contributor_name text,
      add column if not exists contributor_contact text,
      add column if not exists payment_method text,
      add column if not exists reference text,
      add column if not exists is_pledge boolean not null default false,
      add column if not exists pledged_amount numeric,
      add column if not exists amount_received numeric,
      add column if not exists expected_payment_date date;
  end if;
end $evt$;

-- -----------------------------------------------------------------------------
-- 2. Granular contribution visibility (welfare_cases)
-- -----------------------------------------------------------------------------
-- amount_visible_to_members already exists; add the finer-grained controls
-- the spec asks for, without removing the existing column (kept as the
-- "show amounts" default for anything not yet migrated to the new fields).
alter table welfare_cases
  add column if not exists show_contributor_names boolean not null default true,
  add column if not exists show_contributor_ranking boolean not null default false,
  add column if not exists show_anonymous_contributors boolean not null default true,
  add column if not exists show_external_contributors boolean not null default true,
  add column if not exists allow_anonymous_contributions boolean not null default true,
  add column if not exists allow_external_contributions boolean not null default true,
  add column if not exists campaign_status text not null default 'open'
    check (campaign_status in ('draft', 'open', 'closing', 'closed', 'reconciled')),
  add column if not exists closing_date date;

comment on column welfare_cases.amount_visible_to_members is
  'Legacy flag, kept for backward compatibility. New code should read show_contributor_names / show_* alongside this.';

-- -----------------------------------------------------------------------------
-- 3. Event budget line items
-- -----------------------------------------------------------------------------
create table if not exists welfare_event_budget_lines (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references welfare_events(id) on delete cascade,
  category text not null,
  activity text,
  description text,
  quantity numeric not null default 1,
  unit_cost numeric not null default 0,
  budget_amount numeric not null default 0,   -- quantity * unit_cost, kept explicit so overrides are possible
  approved_amount numeric,
  actual_amount numeric,
  responsible_member_id uuid references chama_members(id),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_welfare_event_budget_lines_event on welfare_event_budget_lines(event_id);

-- Budget revision history — every change to an approved line is recorded,
-- never silently overwritten.
create table if not exists welfare_event_budget_revisions (
  id uuid primary key default gen_random_uuid(),
  budget_line_id uuid not null references welfare_event_budget_lines(id) on delete cascade,
  previous_value numeric,
  new_value numeric,
  field text not null,          -- which column changed, e.g. 'budget_amount'
  reason text,
  requested_by uuid,
  approved_by uuid,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 4. Planned vs actual on event tasks/activities
-- -----------------------------------------------------------------------------
alter table welfare_event_tasks
  add column if not exists planned_start_time time,
  add column if not exists planned_end_time time,
  add column if not exists actual_date date,
  add column if not exists actual_start_time time,
  add column if not exists actual_end_time time,
  add column if not exists estimated_cost numeric,
  add column if not exists actual_cost numeric,
  add column if not exists depends_on_task_id uuid references welfare_event_tasks(id),
  add column if not exists completion_evidence text; -- URL/note

-- -----------------------------------------------------------------------------
-- 5. Generic audit log (create only if the wider ERP doesn't already have one)
-- -----------------------------------------------------------------------------
-- If your ERP already has an audit_log/activity_log table, skip this block
-- and point welfareFormat.js's logAudit() at that table/columns instead.
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  chama_id uuid not null,
  actor_member_id uuid,
  module text not null,          -- e.g. 'welfare_case', 'welfare_event'
  action text not null,          -- e.g. 'contribution_approved', 'case_closed'
  entity_id uuid,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_log_chama on audit_log(chama_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 6. Row-Level Security shape for contribution privacy (P0 finding)
-- -----------------------------------------------------------------------------
-- These are TEMPLATE policies illustrating the intent — "a member who isn't
-- authorized to see contributor identity should not receive that column in
-- the query response, not just have it hidden by the UI." Adjust the join
-- conditions to your actual auth.uid()/chama_members schema before applying.
--
-- Recommended pattern: don't try to hide individual columns via RLS (Postgres
-- RLS is row-level, not column-level). Instead expose a view that
-- conditionally nulls out identity columns, and point member-facing reads at
-- the view while officials continue reading the base table directly.

create or replace view welfare_contributions_member_safe as
select
  c.id,
  c.case_id,
  c.status,
  c.created_at,
  c.source_type,
  case when wc.show_contributor_names then c.member_id else null end as member_id,
  case when wc.show_contributor_names then c.contributor_name else null end as contributor_name,
  case
    when wc.amount_visible_to_members then c.amount
    else null
  end as amount,
  case when wc.show_external_contributors or c.source_type <> 'external' then c.source_type else 'hidden' end as visible_source_type
from welfare_contributions c
join welfare_cases wc on wc.id = c.case_id;

comment on view welfare_contributions_member_safe is
  'Use this view (not the base table) for any member-facing contribution list. '
  'Officials/welfare officers should keep reading welfare_contributions directly.';

-- Example RLS enabling row visibility only for the case's participants —
-- adjust table/column names to match your schema:
--
-- alter table welfare_contributions enable row level security;
--
-- create policy "officials see all contributions"
--   on welfare_contributions for select
--   using (
--     exists (
--       select 1 from chama_members m
--       where m.user_id = auth.uid()
--         and m.chama_id = (select chama_id from welfare_cases where id = welfare_contributions.case_id)
--         and m.role in ('welfare_officer','admin','chairperson','treasurer','secretary')
--     )
--   );
--
-- create policy "participants see their case's contributions"
--   on welfare_contributions for select
--   using (
--     exists (
--       select 1 from welfare_case_participants p
--       join chama_members m on m.id = p.member_id
--       where p.case_id = welfare_contributions.case_id
--         and m.user_id = auth.uid()
--         and p.can_see = true
--     )
--   );
