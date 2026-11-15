# M-Pesa at the till (phase 39)

**Till:** picking M-Pesa shows one section: a code field, a **Prompt** button, one status line.
- Typing a code = manual payment. Needs no Daraja, works offline (queued, checked on sync).
- **Prompt** = STK Push through the existing `mpesa-stk-push` function. Needs internet + a complete Daraja setup; otherwise only the button is off, with a one-line reason.
- On Safaricom's confirmation the real receipt code fills the same field (locked). The sale already exists (created by `confirm_mpesa_payment`), so the bottom button becomes **Done** and never records it twice.
- No answer within 2 minutes = "uncertain": request set aside (NEEDS_ATTENTION), manual code allowed, no second prompt, a late success is still applied.

**Availability** of M-Pesa as a method = Settings -> Payments & tax only (`utils/paymentMethods.js`). Daraja never affects it.

**Verified vs recorded:** unchanged and derived, not a new column. A payment is provider-confirmed only if a PAID `lb_mpesa_transactions` row carries the same code. A typed code is never marked confirmed.

**Apply:** run `schema/diagnostics/phase39_precheck.sql` to see any code already used twice (these do not block; the rule then applies to new payments only), then `schema/phase39_mpesa_manual_and_prompt.sql` on staging, then `schema/phase40_loan_expense_actor_fix.sql` (separate loan-payment bug: expense `created_by` got the staff id instead of the auth user id), then redeploy `mpesa-save-config` and `mpesa-stk-push`. `mpesa-callback` is unchanged.

**Tests:** `node --test tests/mpesa_till.test.mjs`; `node tests/mpesa-till/render_check.mjs <node_modules with esbuild+react>`; `sh schema/tests/phase39_run.sh` (scratch Postgres); `node schema/tests/offline_js_checks.mjs`.
