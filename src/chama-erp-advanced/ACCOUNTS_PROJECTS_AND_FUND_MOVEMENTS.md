# Accounts, projects and fund movements

## Run once (Supabase SQL editor)
`sql/010_accounts_projects_fund_movements.sql` — after 001, 002, 006 and 009. Safe to re-run.

## Rules (as decided)
- **Project** = a Chama investment or business.
- **Treasurer records, chairperson approves** any transfer between accounts, expense, or payment into a project. Nothing moves until approved. The person who recorded a request can never approve it.
- **Each account (Cash in hand, M-Pesa, Bank…) has its own balance** = opening balance + money in − money out.
  - Cash contributions and cash loan repayments go to **Cash in hand** (created automatically).
  - M-Pesa / bank ones go to the account the member or treasurer chose.
  - Loan payouts come out of the account chosen on the Disbursement screen.
- Approval is refused if the source account does not hold the amount.

## New / changed files
- sql/010_accounts_projects_fund_movements.sql
- funds/FundMovements.js + .css — Money > Move money (treasurer records, chairperson approves)
- funds/ChamaProjects.js — Money > Projects
- contributions/ChamaBankAccounts.js — shows each account's balance
- contributions/MemberContributionForm.js — cash needs no account
- contributions/TreasurerRecordContribution.js — cash is a method, not an account
- loans/LoanRepaymentDesk.js — asks which account a non-cash repayment went into
- shell/views.js, shell/work.js, workspaces/MoneyWorkspace.js — routes, approval count, cards

## Things to know
- Older ledger entries whose account can't be worked out (e.g. M-Pesa/bank loan repayments from the old desk) stay "unassigned": shown on Chama Accounts, not in any balance. Set each account's opening balance so balances match reality today.
- Welfare-case contributions (welfare_contributions table) are not in the ledger, so are not in account balances yet.
- Money returning from a project (profits, sale proceeds) is not built yet.
- Role checks use the member id the app sends, like the rest of the package (no RLS yet — see AUDIT_REPORT.md).
