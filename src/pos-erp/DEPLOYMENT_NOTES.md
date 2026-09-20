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

## 2. Deploy the three Supabase Edge Functions

```
supabase functions deploy mpesa-stk-push
supabase functions deploy mpesa-callback
supabase functions deploy mpesa-save-config
```

Then set the ONE secret `mpesa-stk-push` still needs at the deployment
level (Daraja consumer key/secret/passkey are now entered PER BUSINESS
by the owner, from the app's M-Pesa → Setup panel — see Phase 13 in
AUDIT.md — so they are no longer set here):

```
supabase secrets set MPESA_CALLBACK_URL=https://<your-project>.functions.supabase.co/mpesa-callback
```

Each business owner gets their own Daraja sandbox/production app from
https://developer.safaricom.co.ke and enters its consumer key, consumer
secret, and passkey themselves under M-Pesa → Setup in the app — no CLI
access needed for that part. **Nothing in this deliverable has made a
single live request to Daraja** — there's no sandbox credential or
deployed function in this environment to test against. The code is
written against Safaricom's published Daraja v2 STK Push API, not
verified against it.

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
phase13_mpesa_client_credentials.sql
phase14_receipts.sql
phase15_business_logo.sql   -- run AFTER creating the storage bucket, see §5 below
```

`phase9_assets.sql` and `phase12_mpesa.sql` both have inline `NOTE`
comments flagging column-name assumptions that haven't been checked
against your live schema (the `Depreciation` expense category insert,
the `record_expense()` call signature, and the `lb_warehouses` /
`lb_inventory` / `lb_inventory_movements` column names
`confirm_mpesa_payment()` writes to). Check those before running in
production — see AUDIT.md's Phase 9 and Phase 12 entries for exactly
what to verify. `phase13_mpesa_client_credentials.sql`'s
`mpesa-save-config` ownership check assumes `lb_businesses` has the same
`tenant_id = get_current_tenant_id()` RLS policy every other `lb_*`
table has — very likely true (phase1's own comments describe it as
already in place) but not confirmed against a live schema dump.

## 4. Turn M-Pesa on for a business

There IS a settings UI for this now (Phase 13) — open the app, go to
**M-Pesa**, expand **M-Pesa Setup**, fill in the till/paybill number and
the three Daraja credentials (from https://developer.safaricom.co.ke),
and flip "Turn M-Pesa on." No SQL required for normal use.

The only reason to touch SQL directly is local testing without a
deployed `mpesa-save-config` function yet:

```sql
insert into lb_mpesa_config (tenant_id, business_id, shortcode, environment, is_active)
values ('<tenant-id>', '<business-id>', '174379', 'sandbox', true);

insert into lb_mpesa_secrets (tenant_id, business_id, consumer_key, consumer_secret, passkey)
values ('<tenant-id>', '<business-id>', '<key>', '<secret>', '<passkey>');
```

(`174379` is Safaricom's published sandbox test shortcode.) If you insert
directly like this, also set `lb_mpesa_config.has_consumer_key = true`,
`has_consumer_secret = true`, `has_passkey = true` — `mpesa-stk-push`
checks those flags before it checks `lb_mpesa_secrets` itself, and won't
proceed if they're still false.

## 5. Create the business-logos Storage bucket (Phase 15)

This is a Dashboard step, not SQL — `phase15_business_logo.sql` only sets
up the access policies, and will silently do nothing useful if the
bucket doesn't exist yet.

1. Supabase Dashboard → **Storage** → **New bucket**
2. Name: `business-logos`
3. **Public bucket: ON** — a logo needs to render on receipts and the
   sidebar for anyone viewing them, without an auth token. This is
   intentional, not an oversight — see the migration file's own header
   for why a logo is safe to be public while Daraja credentials (Phase
   13) are not.
4. Then run `phase15_business_logo.sql`.

Once that's done, **Settings → Business Profile** has an "Add a logo"
button — no further setup needed. Uploads go to
`<business_id>/logo.<ext>` automatically; re-uploading replaces the old
file rather than piling up.

## 6. Receipts (Phase 14) — nothing to deploy beyond the migration

`phase14_receipts.sql` only touches `confirm_mpesa_payment()` (adds the
receipt-row insert M-Pesa sales were missing) — cash/card/credit
receipts already worked via `saleService.create()`'s own existing
insert, so there's no new function or bucket for this phase. Print,
WhatsApp, and Email all run entirely client-side (native browser print
dialog, `wa.me`, `mailto:`) — no Edge Function, no provider account, no
secret to configure. If WhatsApp receipt sending shows "No WhatsApp
receipt wording is set up yet," open **Messages** once — that's what
seeds the default templates (Phase 7/8's `ensureDefaults()`), including
the `RECEIPT` one this depends on.
