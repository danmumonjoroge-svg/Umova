# Changelog
## 1.0.0 - initial delivery (AI 4)
* Schema E001-E011: foundation + bridge, ledger/invoices/billing, payments/allocation/M-Pesa protection, adjustments/awards/corrections, plans/follow-ups,
  cashier sessions/expenses/budgets/reconciliation, accounting outbox, reports, notification registry, hardening sweep.
* Services, utilities, receipt/statement/report builders, communication templates + composer, offline drafts, six pages, route manifest.
* Tests: SQL 252 assertions on PostgreSQL 18 (PGlite), JS 11 tests. Diagnostics: staging precheck, RLS/grant audit.
* **Existing POS files: unchanged.** Verified by extracting the original zip and diffing every file outside `elimu/` (identical). Two optional POS patches are *proposed* in `finance/patches/`, not applied.
### Fixed during testing (found by the suite, not by inspection)
* Cash refunds were attributed to the approver's session instead of the cashier who paid them out.
* The service-role STK confirmation ran without a tenant in scope, so ledger/journal/audit helpers saw `NULL`; now scoped transaction-locally from the payment row.
