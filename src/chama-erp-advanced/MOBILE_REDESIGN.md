# Mobile-first redesign — what changed, what didn't, what to know

## What changed
**Only the shell and navigation were rebuilt.** `ChamaDashboardAdvanced.js` keeps its name and default export, so `App.js` is untouched.

| Area | Now |
|---|---|
| Phones (<768px) | Fixed bottom bar: Home · Money · Members · Welfare · More. Touch-sized, safe-area aware. |
| Tablet (768–1023) | Icon rail on the left. |
| Desktop (≥1024) | Full left sidebar: Home, Money, Loans, Members, Welfare, Updates, My statement (+ More, Log out). |
| Navigation | No expandable groups anywhere. A nav entry opens a **workspace** (landing page of action cards); cards open the existing screens. Browser/phone Back moves within the app. |
| Top bar | Page title, auto connection status, bell (→ Updates), account menu. No manual online/offline switch. |
| Theme | Forest `#14532D`, Emerald `#238B5B`, Gold `#C9A227`, `#F5F7F2`, `#26332B`. Tokens are set on `.cm-app`, so the *existing* screens are re-themed without editing their CSS. |

### New files
`shell/` (views registry, hooks, UI primitives, licence badge) · `workspaces/` (Home, Money, Loans, Welfare, More landings; MyStatement, MyLoans, LoanRulesView, MemberWelfare, MemberProfile, MembersWorkspace, UpdatesWorkspace) · `sql/007_announcements.sql`

### Existing files touched (all small, all additive)
- `MembersDirectory.js` — optional `onSelectMember` / `initialStatus` props; non-officials now request only the columns the directory shows (no national ID / balances downloaded).
- `contributions/MemberContributionForm.js` — optional `initialType` prop; **loan picker + `loan_id` on loan repayments** (see finding 2); refuses to "send" while offline.
- `loans/MemberLoanApplication.js` — optional `startOpen` prop.
- `ChamaDashboardAdvanced.css` — replaced (shell styles + a phone-reflow layer for the old screens' fixed multi-column grids).

Untouched: `ChamaContext`, auth, licensing, every SQL function, loans/, welfare/, reconciliation, platform-admin, all other logic.

## Permissions
Every screen keeps the exact role arrays from the old sidebar, checked with the existing `hasRole()`. Screens still guard themselves internally. Deep-linking to a screen you can't use shows "no access". One difference: **Chama finances totals** (old "Overview") are now treasurer/chairperson only, not everyone.

## Offline (honest version)
The project had **no offline/sync infrastructure**, so none was reused. Built: automatic connectivity detection, and a read-only cache (balances, statement, updates, profile) shown with an "out of date" notice and cleared on logout. **Money actions are not queued**: offline, the contribution form says it was *not* sent. Contributions are only ever "sent to treasurer" (PENDING) → "Confirmed" (APPROVED after the treasurer posts); the app never calls a contribution confirmed earlier than that. A real "Saved on this device → confirmed" outbox needs an idempotency key on `chama_contribution_requests` (schema change) and is left for a deliberate offline stage.

## Findings you should act on
1. **RLS is off almost everywhere** (AUDIT_REPORT P2-1). The brief says the backend must remain the final authority — today it isn't: with the anon key, any client can read/write these tables. UI hiding (including everything in this redesign) is not security. Fixing needs the decision README §6 describes (Supabase Auth vs. app-layer isolation).
2. **AUDIT_REPORT's JS fixes are not in this zip.** `006` SQL is (posting a loan-repayment contribution now *raises* if `loan_id` is null), but `MemberContributionForm.js` had no loan picker, so members' loan repayments would have failed at the treasurer. Fixed in the form. `TreasurerReconciliation.js` (legacy-row flag) and `LoanApprovalQueue.js` (still does read-modify-write on `approvals`, P0-3) still need their audit fixes.
3. **`member` in context is a login-time snapshot** (12h). `MemberLoanApplication` computes loan eligibility from that stale `savings_balance`. The new screens re-read live figures; that screen was not changed.
4. **Home shows what happened this month, not "X of Y due"** — no monthly target exists in the schema.
5. `welfare/WelfareDashboard.js` is still not wired in (audit P1-2) and needs an `onNavigate` mapping.

## Judgement calls
- "Applications" and "Approvals" are one card (one screen: `LoanApprovalQueue`).
- Members see welfare balance, own gifts and upcoming events, **not cases** (staff-only, unchanged).
- Meetings: no table exists; they are announcements with a date (`007`). `007` is the only new table.
- Statement is built from `chama_ledger_entries`; if ledger totals disagree with member balances it says so instead of choosing one.

## Verification
Syntax + import graph checked with esbuild. Rendered in headless Chromium against a stubbed Supabase at 360/390/430/820/1280px for member, treasurer, secretary and chairperson: no horizontal overflow, no JS errors; role gating, profile privacy, repay path and Back behaved as intended. **Not tested:** real Supabase, a physical phone, iOS Safari, real icons (`lucide-react` version — `HandCoins`/`ScanSearch` were already in use; new ones are common), and the existing `WelfareEventPlanner` needs its existing deps (`date-fns`, `@hello-pangea/dnd`, `sonner`).
