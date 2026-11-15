# Elimu - School Fees & Finance module (AI 4)

Everything for school fees lives under `elimu/`. Nothing in the existing POS was edited (verified; see CHANGELOG).
It reuses the POS's authentication, tenants, staff, permissions, document numbers, expense engine, M-Pesa Paybill inbox, communication engine,
audit log, offline database and PDF/print stack. It adds only what school finance genuinely needs.

```
elimu/
  README.md  ARCHITECTURE.md  INTEGRATION.md  CHANGELOG.md  AI4_CONTINUATION.md
  finance/
    schema/                 E001..E011 SQL migrations (run in order), tests/ (stubs + 252-assertion suite), diagnostics/ (staging precheck, RLS audit)
    services/financeApi.js  every database call (all are RPCs)         utils/   money (integer cents), allocation preview, ageing, permission map
    pages/                  Collect, Student account, Debtors, Approvals, Fee setup & billing, Reports
    components/             MessageComposer (review before send), ReceiptActions     hooks/  useElimuFinance
    receipts/ reports/      receipt + statement + report builders (POS PDF/print engines draw them; CSV export)
    offline/                fee drafts + saved copies on the existing offline DB      patches/  OPTIONAL proposals for 2 POS files (not applied)
    billing/ payments/ debtors/ adjustments/ reconciliation/ budgeting/ expenses/   (see note below)
  communication/
    templates/financeTemplates.js    12 purposes x SMS/WhatsApp/Email default templates
    finance/financeComm.js           compose, duplicate prevention, record via the POS comm log
```
The subfolders `billing/ payments/ debtors/ adjustments/ reconciliation/ budgeting/ expenses/` are intentionally empty placeholders: the brief's
suggested layout was adapted to this project's conventions - billing, payment, allocation, adjustment, reconciliation, budget and expense *logic* lives in the
database functions (`schema/E002-E007`) because the POS keeps financial rules in SECURITY DEFINER RPCs, and the screens live in `pages/`.

## Install (staging first)
1. `schema/diagnostics/elimu_precheck.sql` - every row must be `ok = true` (the POS phase 43 Paybill table and the comm log must exist).
2. Run `E001` ... `E011` in numeric order (each is re-runnable). `E011` fails loudly if any table lacks RLS or is API-writable.
3. `schema/diagnostics/elimu_verify_rls.sql` - six queries, all must return zero rows.
4. Mount routes and nav (INTEGRATION.md section 8), enable `gl_enabled` only when accounts are mapped.

## Run the tests
```
cd elimu/finance/schema/tests && npm i @electric-sql/pglite && node run_tests.mjs      # real PostgreSQL 18 (WASM), migrations loaded twice
cd <project root>             && node --import ./elimu/finance/tests/register.mjs --test elimu/finance/tests/finance_js.test.mjs
```
Last results: SQL **252/252**, JS **11/11** (see AI4_CONTINUATION.md for what those do and do not prove).

## The five rules the code enforces (not just the UI)
1. **A payment is money only when CONFIRMED.** Pending/failed payments touch no ledger, invoice or receipt.
2. **Confirmed records are never deleted or edited.** Corrections are reversal/adjustment rows pointing at the original (database triggers block UPDATE/DELETE).
3. **Nobody approves their own request** (adjustments, reversals, refunds, plans, session handover), and non-cash adjustments can never create credit.
4. **One payment, one allocation of each cent.** Caps are checked under row locks; duplicate M-Pesa/bank references and duplicate submissions are refused.
5. **Credit is a liability, not income.** Overpayments sit as credit; accounting postings keep them in a liability account.
