# eTIMS Phases 4-7 (built to the OSCU spec v2.0 without waiting for KRA) — apply on top of etims-phase3.zip

RUN ORDER (STAGING first): phase48 -> phase49 -> phase50_etims_queue.sql.  Then deploy:
  supabase functions deploy etims-submit --use-api --no-verify-jwt
  supabase secrets set ETIMS_WORKER_SECRET=<long random string>      (and ETIMS_ALLOWED_ORIGINS if not set yet)
  (re-deploy etims-initialize / etims-sync-codes / etims-register-item too: they share _shared/etims.ts which changed)
SCHEDULE the worker every minute (Supabase Dashboard > Integrations > Cron, or pg_cron+pg_net): POST to
  https://<project>.supabase.co/functions/v1/etims-submit  with header  x-etims-worker-secret: <the secret>.
  Without a schedule nothing is sent automatically; the owner's "Send now" button still works.

WHAT IT DOES
- A trigger on lb_receipts queues one tax invoice per sale AFTER receipt save (never raises; never edits sales/stock/M-Pesa).
- Body is built once and stored (immutable); invoice number allocated once; tax extracted from VAT-inclusive prices using
  rates read from KRA's own synced tax list. A sale that cannot be built (item without KRA codes, rate unknown, totals mismatch,
  exclusive prices, folio sale) is HELD BACK with the reason in words, never guessed.
- Connect failure -> retry (backoff 1,2,5,15,60,360 min). Timeout/lost connection after sending -> UNCONFIRMED (owner decides).
  KRA business rejection -> REJECTED with KRA's message. Device/key trouble -> business flagged, queue pauses.
- Reversal: not yet accepted -> cancelled; accepted -> credit note (rcptTyCd R, original invoice number, reason 06).
- Switching on: Settings > Tax invoices > "Start sending to KRA". Only sales after that moment are ever sent.

SCREENS: Settings card (switch, counts); new page /pos/etims ("Tax invoices": needs-attention list, Send now, Check again,
item KRA codes + Register); receipt note on the on-screen receipt (provisional when offline); buyer KRA PIN on customers (shown
only when tax invoices are set up). Product form is NOT edited: item codes live on the Tax invoices page (bulk-friendly).

FILES: new schema/phase50_etims_queue.sql, schema/tests/phase50_*, supabase/functions/etims-submit, components/EtimsCodePicker.jsx,
EtimsReceiptNote.jsx, pages/EtimsQueuePage.jsx.  Changed: POSApp.jsx, navigation/navConfig.js (both ALSO contain the earlier
"Home is the landing page" change), components/ReceiptModal.jsx, pages/CustomersPage.jsx, services/customerService.js,
services/etimsService.js, components/EtimsSetupCard.jsx, supabase/functions/_shared/etims.ts, tests/routeGuards.test.js
(index route is now a redirect; 59 routes, 0 problems).

TESTED: SQL on scratch PG16 — 48 scenarios, 0 fail (queue, duplicates, held-back, retry, unconfirmed, dead worker, credit notes,
isolation, trigger safety; re-runnable). Route-guard test passes. NOT TESTED: the Deno functions, the React screens on a device,
and any real KRA call. Vault branch of phase49.

TO PROVE IN THE KRA SANDBOX (spec silent): credit-note amounts positive + status 05; credit notes sharing the sale counter;
item tax field name taxAmt; whether a repeated invoice number is refused (994?); whether late (offline) submission is accepted;
tax B 16% vs 18%; where cmcKey sits in the init response. Printed receipts do not yet show KRA's signature (on-screen only).
LEFT OUT ON PURPOSE: hotel folios, rent invoices, purchases/stock reporting, partial refunds.

## Add-on: KRA integration token (phase51)
schema/phase51_etims_integration_token.sql (run after phase50) + components/EtimsSetupCard.jsx + services/etimsService.js.
Settings > Tax invoices > "For KRA's service request" > Show my token. One random 64-character token per business, stored in a locked table
(cashiers cannot read it), owner/manager only. WHETHER KRA ACCEPTS A VENDOR-MADE TOKEN IS UNCONFIRMED: ask KRA before relying on it.
Tested on scratch PG16: 8/8.
