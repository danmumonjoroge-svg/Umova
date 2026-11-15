# Communication & Notification Engine (phases 50–51)

One engine writes every customer, supplier and business message from the database records. The owner picks a purpose and channel, reviews, optionally edits, and presses Send. Nothing is sent without that, unless the owner has separately switched an automation to "Send automatically".

## How it fits together
- **Shared engine** `supabase/functions/_shared/comm/*` — pure JS used by the app *and* the server job, so a preview is word-for-word what automation would write. Takes `now` as a parameter (no hidden clock). Business timezone default `Africa/Nairobi`.
- **App**: `components/MessageComposer.jsx` (the one place messages are written), `components/ContactActions.jsx` (Call / WhatsApp / SMS / Email buttons on customers, suppliers, payables, purchase orders, appointments, notifications), Messages hub `pages/CustomerCommunicationPage.jsx` (To send · History · Wording · Settings), Notifications `pages/CommunicationPage.jsx`.
- **Server** (Supabase Edge Functions): `comm-dispatch` (scheduler, runs without anyone logged in), `comm-send` (owner pressed Send → provider), `comm-webhook` (delivery receipts).
- **Three wording levels**: system default (code) → business template (`lb_communication_templates`, manager only) → per-message edit (stored only on that message; never changes the template).

## Deploy (in this order)
1. SQL editor: run `schema/phase50a_comm_enum_values.sql` **alone**, then `phase50_communication_engine.sql`, then `phase51_comm_scheduler.sql`. All are re-runnable.
2. Database → Extensions: enable `pg_cron` and `pg_net`. Vault: create secret `comm_cron_secret` (long random string).
3. Deploy functions:
   `supabase functions deploy comm-dispatch --no-verify-jwt` · `comm-webhook --no-verify-jwt` · `comm-send`
4. Set secrets (`supabase secrets set …`):

| Secret | Needed for |
|---|---|
| `COMM_CRON_SECRET` (same value as Vault `comm_cron_secret`) | scheduler |
| `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID` (optional) | SMS via Africa's Talking (`AT_USERNAME=sandbox` for tests) |
| `RESEND_API_KEY`, `COMM_EMAIL_FROM` | Email via Resend |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | optional WhatsApp Cloud API |
| `COMM_WEBHOOK_TOKEN` | Africa's Talking / Resend receipts |

5. Start the timer once: `select comm_install_schedule('https://<project>.supabase.co/functions/v1/comm-dispatch');`
6. Webhook URLs: `…/functions/v1/comm-webhook/at?token=…`, `…/resend?token=…`, `…/whatsapp` (Meta).

Without provider secrets the app still works: SMS/Email open in the phone's own apps, WhatsApp opens wa.me, and automations only *prepare* messages in "To send".

## Honest statuses
Prepared → Opened → (owner confirms) Sent · Submitted → Delivered → Read (provider only) · Failed. Opening WhatsApp is **never** shown as sent. The database refuses a user session claiming Submitted/Delivered/Read, deleting history, or rewriting a sent message.

## Safety
No triggers on sales, payments, stock or accounts; a failed message can never affect them. Reminders are re-checked just before sending and suppressed if the debt is cleared, goods received, or the appointment cancelled/past. Duplicates are blocked by a unique dedupe key per event. Provider keys exist only as server secrets. Automations default to "Prepare for me" or off, never automatic.

## Tests
`node --test tests/comm_engine.test.mjs tests/comm_notifications.test.mjs` (71) · `sh schema/tests/comm_run.sh` (62, needs a scratch Postgres).

## Document trail & three-way match (phase 52)
Printable, record-built documents (browser print / Save as PDF, same route as receipts): **Purchase Order**, **Goods Received / Delivery Note**, **Sales Invoice**, **Sales Delivery Note**, **Sales Receipt**. Each lists its sibling documents (PO → delivery → supplier invoice; invoice → delivery note → receipt). Sales document numbers are derived (`INV-<sale no>`, `DN-<sale no>`), so they regenerate identically.
- Run `schema/phase52_document_trail.sql` (adds supplier invoice amount/date to goods received notes).
- Goods Receiving now records the supplier's invoice number **and amount**. Purchase Orders and the supplier drawer have **Check documents** (ordered vs received vs invoiced, with plain-language differences).
- Paying a supplier with unresolved differences shows a warning and requires a reason, which is saved in the payment's notes. Payment is never blocked.
- Where: PO cards (Print, Check documents), supplier drawer (POs, GRNs), receipt screen after a sale (Invoice, Delivery note). Code: `utils/businessDocuments.js`, `utils/triangulation.js`, `services/documentsService.js`.
- Tests: `node --test tests/document_trail.test.mjs`.
