# Chama ERP — Full Audit Report & Fix Log

This covers every module in the package: auth/licensing, the dashboard shell,
Members, Loans, Contributions, Welfare, and Platform Admin. It's written the
same way the welfare module's own `AUDIT_AND_ROADMAP.md` was — findings first,
then what was actually changed, then what's deliberately left for a follow-up
pass — so the two documents read consistently.

**How to apply the fixes:** run `sql/006_fixes_and_hardening.sql` in the
Supabase SQL editor, after `001`–`005`, then deploy the updated `.js` files in
this package over your existing ones (same paths, nothing renamed). It's
additive/idempotent — safe to re-run.

---

## Severity key

- **P0** — breaks core functionality or loses/corrupts money-tracking data for
  every user, right now, with no special conditions needed.
- **P1** — a real bug or a promised-but-missing feature, but narrower in
  who/when it bites.
- **P2** — design weaknesses and enforcement gaps worth closing but not
  urgent.
- **P3** — roadmap items, deliberately not built here (same convention the
  welfare audit used).

---

## P0 — Fixed in this pass

### P0-1: Login is broken for every user
`auth/AuthGate.js` rendered `<Navigate to="/login" replace />` and pointed at
a `UnifiedLogin.js` component that does not exist anywhere in this package,
is not created by this package, and is not referenced in the README's own
`App.js` wiring instructions (which only mention `ChamaContext`, `AuthGate`,
and `ChamaDashboardAdvanced`). Meanwhile `LoginPhone.js` — fully built,
styled, wired to `loginWithPhone()`/`registerUser()` — was never rendered
anywhere. A stray `auth.zip` shipped alongside the `auth/` folder turned out
to be the *previous, working* version of `AuthGate.js`, which rendered
`LoginPhone` directly — strong evidence this was a regression introduced in a
later edit, not an intentional design.

**Effect:** anyone logging out, or opening the app fresh, hits a route with
nothing mounted on it. The entire app is unusable past first load.

**Fix:** `auth/AuthGate.js` now renders `LoginPhone` directly again, matching
what the package's own README describes. The stray `auth.zip` was removed
from the package (it was a duplicate-and-diverged copy of `auth/`, not a
real dependency).

### P0-2: Loan repayments declared via the contribution form vanish
`MemberContributionForm.js` offers "Loan Repayment" as a contribution type.
`TreasurerReconciliation.js` verifies and "approves & posts" it exactly like
any other contribution. But `post_contribution()`'s `loan_repayment` branch
was a deliberate no-op, with a comment saying the app layer would call
`apply_loan_repayment()` instead — nothing ever did, and there was no way to
even say *which* loan a declared repayment was for (no `loan_id` anywhere on
`chama_contribution_requests`).

**Effect:** a member is told their repayment was "Approved & posted." A
ledger credit is written. Their loan balance never moves. The debt and the
books silently disagree, and nobody is warned.

**Fix:** added `chama_contribution_requests.loan_id`. The contribution form
now requires picking a specific active loan when the type is "Loan
Repayment." `post_contribution()` now actually inserts the
`chama_loan_repayments` row and decrements the loan balance (closing it at
zero) when posting a loan-repayment contribution, instead of doing nothing.
`TreasurerReconciliation.js` flags any legacy row with no `loan_id` so it
can't be silently approved into the same trap.

### P0-3: Loan approvals can silently lose a signature (race condition)
`LoanApprovalQueue.js` implemented approve/reject as: fetch the application,
splice a new decision into the JS-side `approvals` array, write the whole
array back. Two officials deciding within the same round-trip (very plausible
— a secretary and treasurer both reviewing a queue at the same time) both
read the array before either write lands. The second write's stale snapshot
overwrites the first, discarding one signature. Depending on timing, this can
leave a loan permanently short one signoff, or in rarer orderings, incorrectly
mark it "fully approved" without a genuine quorum.

**Fix:** the entire read-check-modify-write now happens inside one
row-locked Postgres function, `submit_loan_decision()` (see
`006_fixes_and_hardening.sql`). `LoanApprovalQueue.js` now calls this RPC
instead of doing its own fetch + array surgery + update. Two concurrent
decisions can no longer clobber each other — Postgres's row lock serializes
them.

### P0-4: `chama_members` is missing columns the shipped UI already writes to
`MembersDirectory.js` inserts `national_id` on "Add member," updates
`remarks` on "Edit role," and sets `approved_by` / `approved_at` /
`suspended_at` on approve/suspend/reactivate. **None of these columns are
created by any migration in `sql/`.** The README asserted "the approval
workflow fields (`approved_by`/`approved_at`/`suspended_at`) that already
exist on the table" — that claim doesn't hold up against what `001` actually
creates (`chama_id, name, phone, role, status, has_pin, created_at,
savings_balance, shares_balance, welfare_balance, joined_at` — nothing else).

**Effect:** adding a member with a national ID, approving a pending member,
suspending/reactivating anyone, or saving a remark on Edit Role all fail with
a Postgres `column "..." does not exist` error, in production, on first use.

**Fix:** added all five columns in `006`. Also fixed `approveMember()` in
`MembersDirectory.js`, which had a fallback of writing the approver's *name*
into what is (now, correctly) a `uuid` foreign key — that fallback would have
thrown a type error the first time `member?.id` was ever momentarily unset.

### P0-5: `is_chama_licensed()` disagrees with the client about what "licensed" means
The client-side check (`isLicenseValid()` in `ChamaContext.js`,
`licenseTone()` in `ChamaSelector.js`) treats `license_status IN ('active',
'trial')` as valid. The server-side `is_chama_licensed()` function — called
on every session restore — only checked `license_status = 'active'`. Every
self-registered chama starts on `'trial'` (see `register_chama()` in
`sql/004`).

**Effect:** a brand-new trial chama's chairperson logs in fine, but the
moment the tab is refreshed or reopened, the background re-validation call
in `ChamaContext.js` gets `false` back from `is_chama_licensed()` and kicks
them to the "License no longer active" screen — despite nothing having
expired. This would have made every self-registered trial chama effectively
unusable after the first page load.

**Fix:** `is_chama_licensed()` now checks the same `('active', 'trial')` set
the client already uses.

---

## P1 — Fixed in this pass

### P1-1: No way to actually suspend a chama
`LicenseManager.js`'s `effectiveStatus()` and the login gate both know how to
render/block a `'suspended'` license, but nothing anywhere ever sets it.
`set_chama_free(false)` marks a chama `'expired'`, which is a *different,
softer* state (an expired chama is restored by the next real payment — a
suspended one shouldn't be). A platform admin needing to pull a chama offline
immediately (fraud, dispute, abuse) had no button for it.

**Fix:** added `set_chama_suspended()` and wired a Suspend / Un-suspend
button into `LicenseManager.js`.

### P1-2: The promised Welfare operational dashboard was never actually delivered
`welfare/README.md` and `welfare/AUDIT_AND_ROADMAP.md` both describe
`WelfareDashboard.js`/`.css` as **built** in that pass ("Create — the missing
operational dashboard... absent from the original files"), and list it in
the file-changes table. It does not exist anywhere in the delivered zip, and
`ChamaDashboardAdvanced.js`'s nav never referenced it.

**Fix:** built `welfare/WelfareDashboard.js` / `.css` — KPI strip (open
cases, pending approvals, outstanding pledges, raised this month, upcoming
events), an alerts panel (stalled cases with zero contributions, overdue
pledges, events approaching with open tasks, events over budget), a pending
actions panel (your assigned tasks, contributions awaiting a decision,
cases in "closing"), and per-event task/budget progress bars — all read from
tables the other three welfare screens already use, no schema change
required for the dashboard itself. Wired into the sidebar as the first item
under **Welfare**, with drill-down via `onNavigate(view, filter)` exactly as
originally specified.

### P1-3: Loan rules are configurable but never enforced
`min_membership_months` and `max_active_loans_per_member` are fully editable
in `LoanRulesCard.js`, persisted to `chama_loan_rules`, and even displayed
back to the member in `MemberLoanApplication.js` — but nothing ever checked
them before accepting an application. A chama could configure "6 months
minimum membership, max 1 active loan" and both settings would be pure
decoration.

**Fix:** added a `before insert` trigger on `chama_loan_applications`
(`enforce_loan_application_rules()`) that checks both, server-side, so it
can't be bypassed by any future client screen either — not just a client-side
form validation that a different screen could skip.

### P1-4: `disburse_loan()` / `apply_loan_repayment()` had no real guard rails
- `disburse_loan()` never checked the loan had actually cleared approval
  (only "does the row exist, is it not already disbursed"), and never
  checked the paying account belongs to the *same chama* as the loan.
  Currently unreachable in practice (a `chama_loans` row is only created on
  full approval today) — but it's exactly the kind of implicit invariant
  that breaks the moment a second way to create that row shows up (a data
  import, a manual insert, a future screen).
- `apply_loan_repayment()` never validated `p_amount > 0`, never checked the
  loan was disbursed, and allowed a repayment to post against an already
  closed loan.

**Fix:** both functions now validate these explicitly and raise a clear
exception instead of silently accepting bad input.

---

## P2 — Design weaknesses worth closing (documented, partially addressed)

### P2-1: RLS is disabled almost everywhere — the biggest open item
Every feature table (`chama_members`, `chama_loans`, `chama_contribution_requests`,
`welfare_*`, etc.) is readable and writable by any request carrying the
Supabase anon key, scoped only by whatever `.eq("chama_id", …)` the calling
React component happens to add. There is no server-side enforcement that a
logged-in member of chama A cannot read or write chama B's rows.

This was flagged before (both the original README and the welfare audit
called it out), but the welfare module's `migrations.sql` ships example RLS
policies keyed off `auth.uid()` — **this ERP does not use Supabase Auth.**
Login goes through the custom `chama_users` / `authenticate_user()` scheme in
`sql/002`. `auth.uid()` is always `NULL` for these sessions. If those example
policies were enabled as written, they would not error — they'd just quietly
evaluate to `false` (or `true`, depending on the policy) in a way that has
nothing to do with who is actually logged in. **Do not enable them as-is.**

This needs an actual decision, not a patch:
- **(a)** Migrate login to ride on Supabase Auth (phone number as identity,
  custom claims for `chama_member_id`), so `auth.uid()` means something and
  standard RLS applies; or
- **(b)** Have `authenticate_user()` issue your own signed JWT with a
  `chama_member_id` claim, and write RLS policies against
  `current_setting('request.jwt.claims', true)::json`.

Either is a real project. `006_fixes_and_hardening.sql` documents this
plainly instead of silently shipping non-functional policy examples.

### P2-2: `chama_loan_applications`/`chama_loans` disbursement path bypasses the "atomic posting" rule
`LoanApprovalQueue.js` used to insert directly into `chama_loans` from the
client on full approval (now folded into `submit_loan_decision()`, so this
is fixed as a side effect of the P0-3 fix — noted here for completeness since
it wasn't originally flagged as its own item).

### P2-3: Platform Admin "New chama" creates an orphaned chama
`LicenseManager.js`'s "New chama" button inserts directly into `chamas` with
no founding member and no login — unlike `register_chama()`, which creates a
chairperson + login atomically. A chama created this way has nobody who can
log into it until someone manually adds a `chama_members` row. Not fixed in
this pass (needs a product decision: should platform admin also collect a
founding chairperson's details, or is this screen licensing-only by design
and member creation always happens through self-registration or
`MembersDirectory.js` after the fact?) — flagged for your review.

### P2-4: Silent overpayment absorption on loan repayments
`apply_loan_repayment()` clamps the balance to zero with `greatest(...,0)` —
correct for closing the loan, but an overpayment beyond the remaining
balance is simply absorbed with no record that the member is owed a refund
or credit. Not fixed here (needs a product decision on what should happen to
the excess — refund, credit to savings, credit to next loan) — flagged for
your review.

---

## P3 — Roadmap (not built here, consistent with the welfare module's own P2/P3 classification)

Everything the welfare module's own `AUDIT_AND_ROADMAP.md` already listed as
P2/P3 still applies (budget revision history UI, event-day execution view,
notification integration, Finance/GL integration, EDRMS integration,
recurring-event auto-generation). Nothing in this pass changes that
classification — see that file directly for the full list and reasoning.

Additionally, from this broader pass:
- A real `platform_admins` table + login, replacing the shared
  `REACT_APP_PLATFORM_ADMIN_KEY` (already flagged as a known limitation in
  the original README — still true, still worth doing before handing
  platform-admin access to more than one person).
- Phone number normalization at registration (`0722...` vs `+254722...` vs
  `254722...` are all different strings to `chama_users.phone_number`
  today — a member could technically end up unable to auto-link because
  their added-by-official phone format doesn't byte-for-byte match what
  they type at registration). Worth a normalizing trigger or app-layer
  formatter before this becomes a real support burden.

---

## Files changed in this pass

| File | Change |
|---|---|
| `sql/006_fixes_and_hardening.sql` | **New.** All P0/P1 SQL fixes: missing columns, `is_chama_licensed()` fix, `set_chama_suspended()`, `post_contribution()` loan-repayment fix, hardened `disburse_loan()`/`apply_loan_repayment()`, atomic `submit_loan_decision()`, loan-rule enforcement trigger. |
| `auth/AuthGate.js` | Restored direct `LoginPhone` rendering; removed dependency on a nonexistent `/login` route and `UnifiedLogin.js`. |
| `auth.zip` | **Removed** — stray duplicate/diverged packaging artifact. |
| `MembersDirectory.js` | `approveMember()` now always uses `member.id` (uuid), never a name string, and surfaces a clear error instead of a type failure. |
| `loans/LoanApprovalQueue.js` | Approve/reject now calls the atomic `submit_loan_decision()` RPC instead of a racy client-side read-modify-write. |
| `contributions/MemberContributionForm.js` | Loan-repayment contributions now require picking a specific active loan (`loan_id`), so they can actually post against real debt. |
| `contributions/TreasurerReconciliation.js` | Flags any loan-repayment row with no linked loan before a treasurer can approve it. |
| `platform-admin/LicenseManager.js` / `.css` | Added Suspend / Un-suspend action using `set_chama_suspended()`. |
| `welfare/WelfareDashboard.js` / `.css` | **New.** The operational dashboard promised in the welfare module's own docs but missing from the delivered package. |
| `ChamaDashboardAdvanced.js` | Added `WelfareDashboard` as the first item under the Welfare group; passes `onNavigate` through to every screen for drill-down. |

Nothing else was renamed or removed. Every existing import path still
resolves.
