# Chama ERP — Advanced (self-contained)

Every old flat file (`ChamaRouter.js`, `ChamaDashboard.js`, `chamamembers.js`,
etc.) has been removed. This package now only contains what was actually
built here — nothing in it depends on anything from the original upload.

```
chama-erp-advanced/
├── ChamaContext.js            auth-aware context: login, chama selection, license gate
├── ChamaDashboardAdvanced.js  the entire dashboard shell (sidebar + role-gated tabs)
├── ChamaDashboardAdvanced.css
├── auth/                      LoginPhone, ChamaSelector, LicenseBlocked, RegisterAccount, AuthGate
├── loans/                     LoanRulesCard, MemberLoanApplication, LoanApprovalQueue, LoanDisbursementDesk
├── contributions/             MemberContributionForm, TreasurerReconciliation, ChamaBankAccounts
├── welfare/                   WelfareCaseDesk, WelfareEventPlanner, WelfareInsightsReport
├── sql/                       001_schema_upgrade.sql, 002_auth_and_licensing.sql
└── README.md
```

## 1. Setup

1. Delete your existing `src/chama-erp-advanced/` folder entirely and
   extract this zip in its place.
2. Run every file in `sql/` **in order**, in the Supabase SQL editor:
   - `001_schema_upgrade.sql` — core tables. Hardened against pre-existing
     tables: several (`chama_contribution_requests`, `chama_loan_applications`,
     `chama_loans`, `chama_loan_repayments`, `welfare_cases`,
     `welfare_contributions`, `welfare_member_access`) turned out to already
     exist in this database from earlier sessions with different columns —
     `chama_contribution_requests` specifically had `user_id` instead of
     `member_id`. Every column on every table is added via an explicit
     `alter table ... add column if not exists`, not just the ones assumed
     new, so it's safe regardless of what shape a table was already in.
   - `002_auth_and_licensing.sql` — phone+password login, `chama_users`,
     license fields on `chamas`.
   - `003_test_data.sql` — optional, a clean five-member test chama if you
     want to try the app without touching real data.
   - `004_register_chama.sql` — self-service "start a new chama" flow.
   - `005_billing.sql` — payment records + prepaid-style automatic license
     extension. See section 5 below.
   - `007_announcements.sql` — Chama Updates (mobile redesign).
3. Wire it into `App.js` (see the accompanying updated `App.js` — it now
   imports only `ChamaContext`, `auth/AuthGate`, and
   `ChamaDashboardAdvanced` from this folder; nothing else).

## 2. Login flow

```
Phone Number -> Password -> Login -> system searches for the phone number
  -> 1 chama   -> check license -> open dashboard
  -> 2+ chamas -> show chama list -> user selects -> check license -> open dashboard
```

`AuthGate` renders `LoginPhone` -> (`ChamaSelector` if 2+ chamas) ->
`LicenseBlocked` if the resolved chama isn't licensed -> otherwise your
`children` (now `ChamaDashboardAdvanced`, previously `ChamaRouter`).

`chama_members` doubles as the "Memberships" table from your original
sketch — it already has `chama_id`/`role`/`status` per person per chama;
migration `002` just adds a `user_id` column linking it to the new global
`chama_users` (phone + bcrypt password hash, verified entirely inside
Postgres via `pgcrypto` — a password is never compared in JavaScript and a
hash never reaches the browser).

> **Updated:** the sidebar/collapsible-group shell described in this section was replaced by a mobile-first workspace shell. See `MOBILE_REDESIGN.md`; the role table below still reflects who can reach each screen.

## 3. The dashboard

`ChamaDashboardAdvanced.js` replaces `ChamaDashboard.js` / `ChamaRouter.js`
entirely — one sidebar shell. Standalone items sit at the top level;
**Loans** and **Welfare** are collapsible groups — click the group header
to expand it, then pick a specific screen inside. Every leaf is still
individually role-gated exactly as before; grouping only changes how
they're presented, not who can see what.

| Sidebar entry | Who sees it | Component |
|---|---|---|
| Overview | everyone | `DashboardOverview.js` |
| Members | everyone (edit rights: officials) | `MembersDirectory.js` |
| **Loans** ▾ My Loans | everyone | `loans/MemberLoanApplication.js` |
| **Loans** ▾ Approvals | secretary, treasurer, chairperson | `loans/LoanApprovalQueue.js` |
| **Loans** ▾ Rules | secretary, treasurer, chairperson | `loans/LoanRulesCard.js` |
| **Loans** ▾ Disbursement | treasurer | `loans/LoanDisbursementDesk.js` |
| **Loans** ▾ Repayments | treasurer | `loans/LoanRepaymentDesk.js` |
| Contribute | everyone | `contributions/MemberContributionForm.js` |
| Reconciliation | treasurer | `contributions/TreasurerReconciliation.js` |
| Chama Accounts | treasurer, chairperson | `contributions/ChamaBankAccounts.js` |
| **Welfare** ▾ Cases | welfare officer + officials | `welfare/WelfareCaseDesk.js` |
| **Welfare** ▾ Events | welfare officer + officials | `welfare/WelfareEventPlanner.js` |
| **Welfare** ▾ Insights | welfare officer + officials | `welfare/WelfareInsightsReport.js` |

**`loans/LoanRepaymentDesk.js` is new** — the `apply_loan_repayment()`
Postgres function has existed since the very first migration, but nothing
in the UI ever called it. Treasurer-only; lists every active, disbursed
loan with its remaining balance, records a repayment against it (atomic:
inserts the repayment row, decrements the balance, closes the loan
automatically at zero, writes the ledger entry — same rule every other
money-moving screen here follows), and shows a per-loan payment history.

A group only appears in the sidebar at all if at least one item inside it
passes `hasRole()` for the logged-in member — an ordinary member, for
instance, never sees the Loans group expand to reveal Approvals/Rules/
Disbursement/Repayments, since none of those pass for role `member`; they
only ever see "My Loans" surfaced as if it were a plain item.

Tabs are filtered by `hasRole()` before they're even shown — a member never
sees a tab their role can't act on. `chairperson`/`admin` implicitly pass
every `hasRole()` check (see `ChamaContext.js`), matching "officials have
full rights" from your brief.

## 4. Members directory — `MembersDirectory.js`

Everyone sees name, phone, role, status, join date for the whole chama —
small trusted group, not a public listing. Officials additionally see
national ID and balances, and can: edit a member's role, add a brand-new
member (name/phone/national ID/role/starting status), approve someone
sitting in `pending` status, or suspend/reactivate. Built directly off your
real `chama_members` schema, including the `approved_by`/`approved_at`/
`suspended_at` columns that existed already but weren't wired to any
screen before this.

## 5. Platform licensing & billing — `platform-admin/`

The real operating console: which chamas are paid up, which are overdue,
which are on a free/exempt plan, and how much has been collected total.
Reachable at `/platform-admin`, gated by `REACT_APP_PLATFORM_ADMIN_KEY`
(see below) — deliberately kept **outside** `ChamaProvider`/`AuthGate`,
since it manages licensing across every chama and can't itself depend on
a chama already being logged into.

**How enforcement actually works — prepaid, not subscription-cancel.**
Every login compares `chamas.license_expiry` to today (`isLicenseValid()`
in `ChamaContext.js`). The moment that date passes, the chama is locked
out automatically — nobody has to click "suspend." Same model as a
prepaid electricity meter, not a subscription you have to remember to
cancel.

**Recording a payment (`sql/005_billing.sql`, `record_chama_payment()`)**
is the other half — it pushes `license_expiry` forward atomically and
logs the payment to `chama_payments`. If the chama still has time left,
the new period stacks on top instead of overwriting it (paying early
never wastes remaining time — same as topping up a meter before it hits
zero). Paying also always clears a `suspended` status; the only way back
to `active` is a real payment on file.

**Free mode** (`set_chama_free()`) is a separate, explicit override — for
demo accounts, partners, or anyone exempt from billing entirely. A
free-plan chama shows no countdown anywhere, on the platform dashboard or
inside its own sidebar.

The platform dashboard shows, per chama: an effective status computed
from plan + expiry + suspension (not just the raw `license_status`
string, so "Active" never lies about something actually overdue), days
remaining or overdue, a "Record payment" action with quick period presets
(1/3/6/12 months), a payment history view, and a summary strip (total
chamas, paid up, due soon, overdue, free-mode count, total revenue
collected).

Inside the chama's own dashboard, a small badge in the sidebar
(`LicenseBadge` in `ChamaDashboardAdvanced.js`) shows the chairperson
their own days-remaining or free-plan status — stays silent when there's
nothing urgent (more than 14 days left), so a healthy chama isn't nagged.

```
REACT_APP_PLATFORM_ADMIN_KEY=choose-something-only-you-know
```

Add that to your `.env`, restart the dev server, then visit
`/platform-admin`. **This is explicitly not a real access-control system**
— no per-person identity, no audit trail beyond what you build yourself.
It's fine for "the one person running this ERP for all chamas" today.
Before handing access to more than one person, replace `PlatformAdminGate.js`
with a real login (a `platform_admins` table + its own `authenticate_*`
function, same bcrypt pattern as `chama_users` — see `002`) instead of a
shared key.

**Still genuinely manual, on purpose, since it's a real scope decision:**
no payment gateway is wired in (you record what you were actually paid,
however you collected it — M-Pesa, bank, cash), no automatic
expiry-warning SMS/email to chairpersons, no self-service renewal by a
chama's own officials. All three are natural next steps if you want this
to run without you personally checking `/platform-admin`.

There's also a commented-out optional `pg_cron` job at the bottom of
`005_billing.sql` that keeps the stored `license_status` column itself in
sync daily — not required for enforcement (that's already live via the
date check above), just keeps raw data honest for anything that queries
`chamas` directly without recomputing.

## 6. What's genuinely out of scope here

- **RLS policies** on the feature tables — still stubbed/commented at the
  bottom of `001_schema_upgrade.sql`. Real sessions now exist via
  `chama_users`/`chama_members.user_id`; wiring `auth.uid()`-based policies
  on top is a deliberate next step, not done here, since it requires a call
  on whether to route this custom auth through Supabase Auth or keep tenant
  isolation at the application layer.
- **Payment gateway integration** — see section 5. Payments are recorded
  by you after the fact, not collected by the app itself.
- **Everything else your original upload had** (GL/treasury beyond what's
  needed for loans+contributions, meetings, notifications, statements,
  reports, public site) — deliberately dropped per your instruction to
  keep only this folder. None of it is referenced from anywhere in this
  package anymore.
