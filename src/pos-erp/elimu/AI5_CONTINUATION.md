# Elimu continuation — next implementation hand-off

## Current phase delivered
AIA phase 3 adds production and inventory subledgers on top of AIA phases 1–2.

### Files changed / added in phase 3
- Added `aia/sql/003_elimu_aia_production_inventory.sql`.
- Added `aia/pages/AIAOperationsPanel.jsx` and integrated Production and Inventory tabs into `aia/pages/ElimuAIAPage.jsx`.
- Extended `aia/services/aiaService.js` with batch, production, inventory balance and stock movement methods.
- Updated `aia/README.md` and root `ELIMU_CONTINUATION_AUDIT.md`.
- Added `aia/tests/aiaProductionInventory.test.mjs`.

### Production and stock rules
- Batches start with an opening quantity; `QUANTITY_IN` adds to the cohort and `MORTALITY` reduces it.
- The batch counter is updated under a row lock; mortality above the current count is rejected.
- Inventory receipts and positive adjustments increase stock; issues and negative adjustments reduce it.
- The inventory counter is updated under a row lock; stock issues above the current balance are rejected.
- Production and inventory events are append-only to authenticated application users. Corrections should be compensating entries; no edit/delete UI is provided.
- These are operational subledgers only. They do not create GL journals.

## Verification performed
- `node --experimental-default-type=module --test elimu/aia/tests/*.test.mjs`: 12 passed, 0 failed.
- `node --experimental-default-type=module --test elimu/tests/engines.test.js`: 17 passed, 0 failed.
- `node --check elimu/aia/services/aiaService.js`: passed.
- TypeScript `transpileModule` parse checks for `ElimuAIAPage.jsx` and `AIAOperationsPanel.jsx`: 0 diagnostics.
- SQL migration was reviewed statically but not executed against PostgreSQL/Supabase. Browser rendering, RLS and concurrent transaction behavior remain unverified.

## Outstanding work (do not guess)
1. Recover the exact finance SQL migrations from the original Elimu integrated package/repository. Inspect `elimu_fin_gl_postings`, `elimu_fin_gl_posting_lines`, account mappings, posting RPCs and immutability rules.
2. Agree AIA account semantics with the school's accountant; implement an idempotent GL adapter only against the verified schema. Mark events POSTED only after GL success and persist the journal reference. Add retries, reversals and period-close rules.
3. Add biological asset valuation, cost-of-production allocation and inventory costing (FIFO/weighted average) after agreeing the accounting policy.
4. Integrate procurement receipts into the AIA input stock ledger only after verifying the existing POS GRN/stock movement contract; avoid duplicate stock ledgers.
5. Complete AIA production reports, yield-to-sales flow, mortality reporting and stock reconciliation.
6. Recover missing procurement and finance SQL migrations, run full role/RLS tests, then apply migrations to a staging tenant and verify browser/device flows.
7. Review the earlier Elimu archive blockers in `ELIMU_CONTINUATION_AUDIT.md`; several original modules still need full schema and staging verification.

Never apply the included migrations to a live school database directly from this package. Migration order is POS core schema, then AIA SQL 001, 002, 003.
