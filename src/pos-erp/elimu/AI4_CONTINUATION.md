# AI 4 - continuation notes

**Status: the database layer, services and core cashier/billing/debtor/approval/report screens are built and tested. Several screens are NOT built (list below).
The context limit was not the reason for each gap; some are deliberate scope cuts. Nothing below is claimed as done unless a file contains it.**

## What was actually verified
| Check | Result |
|---|---|
| SQL suite `schema/tests/run_tests.mjs` (real PostgreSQL 18 via PGlite; migrations loaded **twice**) | **252 / 252** |
| JS suite `tests/finance_js.test.mjs` | **11 / 11** |
| `diagnostics/elimu_verify_rls.sql` on the migrated test DB | 0 findings in all 6 queries |
| esbuild bundle of all pages against the real POS source (imports/exports resolve) | OK (needed a stub for the POS's own `../../security` import, which is outside the zip) |
| POS files unchanged (diff of original zip vs. tree outside `elimu/`) | identical |
What the SQL suite covers: billing (incl. duplicate-billing guard, sibling discount, bulk dry-run), the brief's 15,000+20,000 / 25,000 allocation example, overpayment/credit, credit absorbed by a new invoice,
M-Pesa (bad code, duplicate, case/spacing, POS-used code, Paybill inbox partial use, over-claim, reversal returns amount), bank pending/failed/re-entry, maker-checker, award, reversal (original kept, allocations
released), refund rules (bursary credit not refundable), plans (exact-sum, second approver, derived status, no double plan), cashier session variance, expenses/budget, reconciliation, GL balance/dedupe/unmapped,
invoice amend/cancel/rebill, reports, allocation policies, left students, closed period, notification dedupe, RLS/tenant isolation, internal-function lockdown, immutability triggers, global invariants after each phase.

## What these results do NOT prove (read before going live)
1. **Stubs, not the live POS.** The SQL suite runs against stand-ins for `lb_businesses`, permissions, `record_expense`, `lb_mpesa_c2b_payments`, etc. Run `diagnostics/elimu_precheck.sql` on staging; adapt if any row is false.
2. **No concurrency test.** PGlite is single-connection. The design takes row locks (`FOR UPDATE` on accounts, payments, invoices, Paybill rows) and has unique indexes, but two cashiers hitting the same payment at once was not exercised.
3. **UI never rendered.** Pages compile and their imports resolve; no browser, device or React test was run. Expect polish bugs. Business rules are in the database, not the pages.
4. **Comm log compatibility** (`purpose` text, `message_type='OTHER'`) is checked by the precheck, not by a live send. No SMS/WhatsApp/email was actually sent.
5. **PDFs** were not generated (jsPDF is not installed here); only the report-data builders are tested.

## Not implemented (honest list)
* **Daraja STK Push for fees.** Needs a POS edit (patches/01). Today: Paybill inbox + manual code. `elimu_fin_confirm_stk_payment` exists and is tested, but nothing calls it yet.
* **Screens missing** (the database functions and `financeApi` wrappers exist for all): adjustment/discount/scholarship/bursary request, reversal/refund request, payment-plan create/view, expenses, budgets, reconciliation, account mappings/settings, cashier-session close, opening balances, invoice amendment form (cancel exists), follow-up beyond a text note, awards.
* **Notifications wired to screens**: only *receipt* and *balance reminder* have buttons. The other ten purposes (invoice generated, payment confirmed/received, instalment approaching/overdue, plan approved, scholarship, bursary, refund, reversal) have templates and compose/dedupe logic but no page button, and **there is no scheduler** for instalment reminders.
* **School-editable finance templates** (via `lb_communication_templates`) - not built/untested.
* **Offline**: statement viewing from a saved copy and payment **drafts** only. **Offline expenditure drafts, offline receipts queue and outbox sync are not implemented** (outbox needs patches/02). Offline drafts are explicitly "not recorded".
* **Parent (multi-child) statements and class/term statements**: only per-student statements with a date range. Needs AI 1's guardian links / a class loop.
* **Excel**: CSV only (the POS has no xlsx library).
* **Automatic early-payment discount**: not automatic; use a manual adjustment with subtype `EARLY_PAYMENT`. Sibling and staff-child discounts ARE automatic at billing.
* **Fee-item priority in allocation, penalties/late fees**: not built (penalties deliberately - they must be an explicit approved policy).
* `frequency` on fee items is descriptive; billing happens per period (term or whole-year period). Per-item due dates are only a fallback for the invoice due date.
* Real FKs to AI 1's student tables, and a GL consumer, wait for those systems.

## Exact next steps
1. Staging: run precheck -> E001..E011 -> RLS audit -> `run_tests.mjs` pointed at a copy of staging (swap `E_stubs.sql` for nothing).
2. Mount routes/nav (INTEGRATION.md section 8); smoke-test Collect/Account/Debtors/Approvals/Reports by role (cashier, bursar, accountant, auditor, other school).
3. Agree the AI 1 sync contract; backfill `elimu_fin_students`/`periods`; create fee items, structures; dry-run bulk billing for one class.
4. Build the missing screens in this order: adjustment + reversal/refund requests, settings, reconciliation, plans, expenses/budgets, session close, mappings.
5. Decide on the two POS patches (STK, outbox) with the POS owner; add a concurrency test on a real Postgres.
6. Add scheduled reminders through the POS comm automation (not a new scheduler).

## File inventory
`finance/schema/E001..E011_*.sql` (11), `schema/tests/{E_stubs.sql,run_tests.mjs}`, `schema/diagnostics/{elimu_precheck,elimu_verify_rls}.sql`; `finance/services/financeApi.js`; `finance/utils/{money,allocation,aging,permissions}.js`;
`finance/hooks/useElimuFinance.js`; `finance/pages/Elimu{Collect,StudentAccount,Debtors,Approvals,FeeSetup,Reports}Page.jsx`; `finance/components/{MessageComposer,ReceiptActions}.jsx`; `finance/receipts/receiptReport.js`;
`finance/reports/reportBuilders.js`; `finance/offline/feeOfflineQueue.js`; `finance/ElimuFinanceRoutes.jsx`; `finance/patches/*`; `finance/tests/*`; `communication/templates/financeTemplates.js`; `communication/finance/financeComm.js`; docs.
