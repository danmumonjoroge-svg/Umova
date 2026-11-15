# eTIMS Phase 2 — foundation (7 new files, 0 existing files changed)

Run order (STAGING first, nothing here is deployed): `schema/phase48_etims_foundation.sql` once. Needs phase28 helpers.
Rollback: see the header of that file.

New files
- schema/phase48_etims_foundation.sql   tables, guards, RLS, status view, 3 owner RPCs
- services/etimsService.js               thin RPC wrappers; no KRA address, key or header
- utils/taxEngine.js                     the one tax calculation (no rates or codes inside; provisional rounding)
- schema/tests/phase48_{stubs,scenarios}.sql, phase48_run.sh   scratch-DB tests: TOTAL 49 FAIL 0 (PG 16)
- schema/tests/etims_tax_js_checks.mjs   16 passed

Nothing is switched on: lb_etims_config.enabled can only be set by the backend (Phase 3). No trigger touches lb_sales or lb_receipts yet.
Not tested against the live database; run the Appendix 1 checks from ETIMS_PHASE1_AUDIT.md first.
