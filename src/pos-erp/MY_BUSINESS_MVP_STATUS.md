# My Business MVP — Status (2026-10-19, after offline Phase 1)

**Done in code (not yet confirmed on a phone or live DB):**
- D-02 Print Receipt dead end: prints in-page, once, with a Done button; failures show a message.
- D-06 Android/browser Back closes the receipt and stays on the till.
- D-01 Offline sale key collision: IDs now include a per-phone ID; duplicate check is per business; a same-key/different-total sale is refused loudly.

**Offline Phase 1 - look-only saved copies (done in code, NOT yet tested on a phone):**
- Products, Stock, Expenses, Suppliers, Customers now open with no internet and show the copy saved on the phone, with a banner "No internet: you can look, but not change anything here yet. Saved on this phone: <time>".
- Copies refresh on app open, on reconnect and every 10 minutes (only for pages the user may see). Expenses keep 90 days; the setting is in `offline/retention.js` (sales 30 days). Pending (unsent) items are never removed by retention.
- A copy is used ONLY when the failure is "no connection". Permission refusals still show as errors. A copy never crosses to another business. Sign-out empties copies but never the unsent queue.
- Home, workspaces and reports stay gated offline on purpose (they would show misleading zeros) until Phase 5.
- Tests [RAN]: 23 new checks (`schema/tests/offline_readthrough_checks.mjs`) + all 9 JS suites pass on the Dexie stand-in. No database change in this phase.
- Limit: not built or run on a device; Wi-Fi + mobile-data-off test is yours (PHONE_TEST_SCRIPT.md). Writing offline (expenses, payments, customers, stock adjust) is NOT done yet: Phase 3.

**Written, not run (need your approval, staging first):**
- `schema/phase33_offline_key_per_tenant.sql` (per-business unique sale key)
- `schema/phase34_mpesa_confirm_lockdown.sql` (M-Pesa confirm function locked to the server)

**Tests [RAN]:** 24 new checks pass (real print and receipt code in a simulated browser); 7 existing suites still pass. No build, device or live-DB test was possible.

**M-Pesa "Already paid" (manual code) - checked in code, needs no setup:** works with no Daraja setup, works offline, code cleaned and validated, same code blocked on this phone (offline) and on the server (online), receipt shows "M-Pesa <code>". Only "Send prompt" needs setup and internet. 14 new automated checks pass. Not yet tested on a phone: see PHONE_TEST_SCRIPT.md.

**Still open:** D-04 reprint/sales history; D-05 offline scope decision; D-07/D-08 function-privilege review on the live DB; D-09 stale tests; D-10 auth-bypass flag check in release builds; phone testing; project shell files for a build.

**Next (offline plan):** Phase 2 receipt reprint / recent sales offline, then Phase 3 offline writes (needs staging + phase35). Previous note: you test the receipt flow on the Android app (script in the reply); then Phase 4: reprint/sales history (D-04) and the agreed offline workflows.
