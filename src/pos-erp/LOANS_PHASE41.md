# Loans phase 41: reducing-balance interest

Run order (after phase37 and phase38): `schema/phase40_loan_expense_actor_fix.sql`, then `schema/phase41_loan_reducing_balance.sql`. Both are re-runnable. Test on staging first.

Rules for REDUCING loans (flat and no-interest loans are unchanged):
- The schedule stays as the lender issued it. It is only the yardstick.
- Interest is charged once a month on the ACTUAL balance at the start of that month. Pay less: next month's interest is higher. Pay more: lower. No penalty rate.
- A payment clears charged interest first (oldest first); everything left is principal. Interest not yet charged is never pre-paid. Example: 60,000 in a month whose interest is 2,000 = 2,000 interest + 58,000 principal.
- Early payment does not lower the instalment or shorten the term. The loan is "in arrears" only when the actual balance is above the scheduled balance at the last due date before today (plus any charged interest that is overdue and unpaid); "paid in advance" when below.
- The screen calls `loan_accrue` when the loans page opens so months that have ended already show their interest.

Limits to know:
- A payment cannot be dated inside a month whose interest was already charged (error tells the user). Undo is refused if a later month's interest was worked out on the balance that payment left.
- After the LAST instalment date no further interest is charged.
- Editing an instalment's interest on a reducing loan does not change interest that has not been charged yet.

Tests: `schema/tests/phase41_run.sh` (50 scenarios, scratch Postgres), `schema/tests/phase41_run.sh phase37_scenarios.sql` (old loan suite on top of phase41), `node --test tests/loan_helpers.test.mjs`.
