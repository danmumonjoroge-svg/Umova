# Deployment notes — Phases 11 & 12 (offline-first + M-Pesa STK)

This project's zip has no `package.json` / build config in it (it's just
the `src/pos-erp` source tree), so these two things can't be done by this
change set and need doing in your actual project before either phase
works:

## 1. Install Dexie

```
npm install dexie
```

`offline/db.js` imports it. Nothing else in this deliverable needs a new
dependency.

## 2. Deploy the two Supabase Edge Functions

```
supabase functions deploy mpesa-stk-push
supabase functions deploy mpesa-callback
```

Then set the secrets `mpesa-stk-push` needs (never commit these):

```
supabase secrets set MPESA_CONSUMER_KEY=xxx
supabase secrets set MPESA_CONSUMER_SECRET=xxx
supabase secrets set MPESA_PASSKEY=xxx
supabase secrets set MPESA_ENV=sandbox   # or production
supabase secrets set MPESA_CALLBACK_URL=https://<your-project>.functions.supabase.co/mpesa-callback
```

Get a Daraja sandbox app (consumer key/secret, test shortcode, test
passkey) from https://developer.safaricom.co.ke before any of this can
be exercised. **Nothing in this deliverable has made a single live
request to Daraja** — there's no sandbox credential or deployed function
in this environment to test against. The code is written against
Safaricom's published Daraja v2 STK Push API, not verified against it.

## 3. Run the migrations, in this order

```
phase1_tenant_business_link.sql
phase4_daily_closing_cash_fix.sql
phase5_property.sql
phase6_salon.sql
phase7_communication.sql
phase8_whatsapp.sql          -- run PART 1, wait for commit, then PART 2
phase9_assets.sql
phase10_supplier_messaging.sql -- run the enum ADD VALUEs, wait for commit, then the rest
phase11_offline_sync.sql
phase12_mpesa.sql
```

`phase9_assets.sql` and `phase12_mpesa.sql` both have inline `NOTE`
comments flagging column-name assumptions that haven't been checked
against your live schema (the `Depreciation` expense category insert,
the `record_expense()` call signature, and the `lb_warehouses` /
`lb_inventory` / `lb_inventory_movements` column names
`confirm_mpesa_payment()` writes to). Check those before running in
production — see AUDIT.md's Phase 9 and Phase 12 entries for exactly
what to verify.

## 4. Turn M-Pesa on for a business

There's no settings-page UI for this yet (out of scope this pass) — call
`mpesaService.saveConfig()` once per business, or insert directly:

```sql
insert into lb_mpesa_config (tenant_id, business_id, shortcode, environment, is_active)
values ('<tenant-id>', '<business-id>', '174379', 'sandbox', true);
```

(`174379` is Safaricom's published sandbox test shortcode.)
