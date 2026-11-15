# Treasurer recording + Group report

## 1. Database (run once, in the Supabase SQL editor)
Run `sql/009_treasurer_recording_and_group_report.sql` (after 001, 002, 006). Safe to re-run.
It adds `record_member_contribution()` and `chama_group_report()` and their grants.

## 2. New files
- contributions/TreasurerRecordContribution.js / .css  -> Money > "Record for a member" (treasurer; chair/admin pass hasRole)
- reports/GroupReport.js / .css                          -> Money > "Group report" (secretary, treasurer, chairperson, admin)
- sql/009_treasurer_recording_and_group_report.sql

## 3. Small edits to existing files
- shell/views.js: routes money/record and money/group-report
- shell/work.js: capabilities `record` and `reports`
- workspaces/MoneyWorkspace.js: two new cards
- contributions/MemberContributionForm.js: history shows "recorded by treasurer"

## How it stays safe
- Recording goes through the existing post_contribution(): same ledger entry, same balance and loan updates. No second money path.
- The database checks the caller is the treasurer/chair/admin of that Chama, the member belongs to it, the loan is the member's and active,
  rejects a repeated M-Pesa/bank reference, and refuses an identical entry within 60 seconds.
- Needs a connection; nothing is queued on the phone, so it is never "recorded" before the server has it.
- Group report is read-only and sums on the server (no 1,000-row cut-off); it flags when ledger totals and member balances disagree.
