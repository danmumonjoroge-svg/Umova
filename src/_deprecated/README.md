# Deprecated / retired files

Everything under this folder was confirmed **not imported or routed from
anywhere in the live app** (verified by grepping the entire src tree for
real references, not just name substrings — several early false positives
from substring matches were ruled out before anything was moved here).

Nothing here is wired into App.js, so none of it currently affects the
running app either way. Moved rather than deleted so it's still available
for reference or salvage. Safe to delete outright once confirmed unneeded.

## Duplicate/abandoned engines (superseded by src/services/journalAPI.js
## + the post_journal Postgres RPC)
- `utils/PenaltyEngine.js` — orphaned; live penalty flow is
  `Pages/Admin/LoanPenalties.js`.
- `utils/loanPenaltyEngine.js` — orphaned duplicate of the above; its own
  GL insert was already commented out before this audit.
- `utils/interestEngine.js` — only reachable via `utils/autointerestEngine.js`,
  which is itself unused.
- `utils/autointerestEngine.js` — unused.
- `utils/repaymentsEngine.js` — orphaned; live repayment UI is
  `Pages/Admin/LoanRepayments.js`.
- `components/Dashboard/Loanengineservice.js` — orphaned duplicate loan
  engine, not routed.
- `components/Dashboard/LoanApprovalDashboard.js` — orphaned, not routed.
  Live loan approval UI is `Pages/Admin/LoanApproval.js`.
- `Pages/Admin/ArrearsDashboard.js` — orphaned, not routed.

## Edge-function client wrappers with zero real callers
These called edge functions that (per `functions.zip`) aren't even deployed
under matching names — but the deciding factor for archiving them here was
that nothing in the live app calls them at all, independent of that.
- `services/parAPI.js` (PAR classification)
- `services/creditRiskAPI.js`
- `services/creditScoreAPI.js` (+ its page, `Pages/Admin/CreditScore.js`,
  not routed in App.js)
- `services/workflowAPI.js` (+ its page, `Pages/Admin/WorkflowPanel.jsx`,
  not routed in App.js)
- `services/ledgerAPI.js`
- `services/financialReportAPI.js` (+ its page,
  `Pages/Admin/FinancialReports.js`, not routed in App.js — note there's a
  live, different `FinancialReports.js` reachable via `Pages/Admin/Reports.js`
  reading directly from the ledger tables; this one was the dead duplicate)
- `services/securityAPI.js`
- `services/notificationAPI.js`
- `services/disbursementAPI.js` — `Pages/Admin/LoanDisbursement.js` has its
  own local `disburseLoan` function (a same-name coincidence, not an import
  of this file)
- `hooks/useRepayLoan.js` — same-name coincidence with logic inside
  `Pages/Admin/LoanRepayments.js`, not an actual import of this hook
- `hooks/useLoanSchedule.js` — same-name coincidence; the live schedule page
  (`Pages/Admin/LoanSchedule.js`) calls `generateLoanSchedule` from
  `services/loanAPI.js` instead

## Still live, NOT moved here, still broken
`services/loanApprovalAPI.js`, `services/loanAPI.js`, and
`services/scheduleJournalAPI.js` are genuinely called from routed pages
(`LoanApproval.js`, `LoanSchedule.js`) and still point at edge functions
that don't exist in `functions.zip`. These are next in line for a fix
(likely the same Postgres RPC approach used for `journalAPI.js`), not
archived.

## Added in Phase 2 pass
- `Pages/Admin/InterestEngine.js` — zero callers anywhere (confirmed via
  full grep, ruling out the `InterestDashboard.js` naming coincidence).
  Also had a genuinely broken import path (`../services/journalAPI` from
  `Pages/Admin/` resolves to a nonexistent `Pages/services/` — should have
  been `../../services/journalAPI`), which never surfaced as a build error
  only because nothing imports this file at all. Also used a hardcoded
  12% interest rate with no sourcing to an actual loan's approved rate.
