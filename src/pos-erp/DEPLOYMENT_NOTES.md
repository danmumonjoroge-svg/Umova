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
phase19_folios.sql          -- Customer Folios. Needs phase17 (next_doc_number). No enum change.
phase20_rooms_stays.sql     -- Rooms & Stays. Needs phase19. No enum change. Safe to re-run.
phase21_services_activities.sql -- Adds lb_service_details.kind (SERVICE/ACTIVITY); folio lines from activities are typed ACTIVITY. Needs phase19. Safe to re-run.
phase22a_production_enums.sql -- OPTIONAL, run BEFORE phase22 and by itself (enum ALTER TYPE). No-op if movement columns are text.
phase22_production.sql      -- Recipes, production runs, yield/wastage/cost. Needs lb_inventory, lb_stock_movements, lb_warehouses. Safe to re-run.
phase23_packages.sql        -- Packages (bundles at one price) on folios. Needs phase19, 20, 21 and 22 (uses _col_accepts). Redefines void_folio_line (keeps the room guard). Safe to re-run.
phase24_efficiency.sql      -- efficiency_report(): read-only figures. Needs phase19, 20, 22 (23 optional). Safe to re-run.
phase25_unified_receipts.sql -- till sales posted to a folio carry the product category (Food / Drinks on the receipt). Needs phase19, 21. Safe to re-run.
phase26_production_reverse.sql -- reverse_production_run + REVERSED status. Needs phase22. Safe to re-run.
```

`phase19_folios.sql` is tested against a scratch Postgres (`schema/tests/phase19_scenarios.py`, 24 checks) but NOT against your live
schema. Before running it in production, confirm on staging: `lb_sales` has `customer_id`, `lb_sale_items` has `total_price`,
`lb_products` has `name` + `track_inventory`, and `lb_payment_method` includes CASH / MOBILE_MONEY / CARD.

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

## 7. Business logo limits (Phase 27) — run only after approval
Run `schema/phase27_business_branding.sql` after the `business-logos` bucket exists (phase15 setup). It limits the bucket to 1 MB and png/jpeg/webp. Idempotent; no-op if the bucket is missing. Then upload a test logo and confirm an SVG upload is refused.

## 8. Phase 28 (REWORKED) — small additions on top of YOUR existing permission system — run only after approval, STAGING first
Your live database already has its own permission system (`pos_all_permissions` 24 keys, `pos_role_default_permissions`, `pos_staff.role_template`, `pos_staff_permission_overrides`, `pos_has_permission(p_perm)`, `is_pos_session()`, `pos_enforce_permission()` triggers, owner-only staff functions). The first version of phase 28 tried to replace it and failed on `42P13`; it has been rewritten. **The new file creates no table and redefines no existing function** (checked: a fingerprint of all existing functions is identical before and after).
It adds only:
- `pos28_staff_id()` and `pos28_tenant_id()` — read the staff/business from the login token (your `pos_current_*` read session settings that are not reliably set, so new code does not use them).
- `pos_my_access()` — one call for the menus: `{ok, is_owner, role, template, permissions[]}`.
- `lb_businesses`: your `guard_business_identity()` (read and confirmed) already protects name, phone, email, address, currency, time zone and logo. A small extra trigger covers what it misses (receipt footer, tax config, settings JSON, status), and insert/delete use your `pos_enforce_permission('settings.manage')`. Your trigger is untouched.
- Logo bucket: your `business_logos_tenant_*` policies require `settings.manage`, but the older permissive `business_logos_insert_own / update_own / delete_own` policies let any staff member upload or delete a logo. A restrictive policy closes that gap.
- `pos_audit_log`: staff sessions can no longer update or delete audit rows, and can only insert rows for their own business.
Findings from your live database that matter: `pos_guard_sale_update` is NOT attached to `lb_sales`, and `lb_sales` has only a `sales.create` insert trigger, so today any staff session can set a sale to VOIDED directly. Phase 29 closes that. Check on staging that no existing screen needs to write audit rows other than inserts, or edit `lb_businesses.settings` as a non-owner.
Test with three logins (owner, manager, cashier): cashier and manager cannot rename the business, change the footer or upload a logo; owner can; owner grants `settings.manage` to the manager from the Staff page and the manager then can.
Rollback: drop triggers `trg_pos_perm_lb_businesses_insert/delete` and `trg_pos28_business_extras`, the `r_logo_*` and `r_audit_*` policies, and the functions `pos28_staff_id`, `pos28_tenant_id`, `pos_my_access`, `pos28_guard_business_extras`. Nothing else was touched.
Permission mapping used by phases 29-32 (and the app): refunds.request / refunds.approve (sale reversals), finance.view (Close the day; sign-off also needs payments.approve), employees.manage (staff records), payroll.access (payroll and salaries), audit.view (control report), settings.manage (branding). Staff management is owner-only through your existing functions; the app's Staff page now calls them (add staff, change role, per-permission override, switch on/off, reset password).

## 9. Sale reversals (Phase 29) — run only after approval, on STAGING first, after phase28
Check these on staging BEFORE trusting it (the live tables are not in the zip, so these were assumed from the app code):
1. `lb_sales.status` has the value `VOIDED` and `COMPLETED`; `lb_sales.cashier_id` holds the staff member's auth user id (what saleService writes today).
2. `lb_payments.status`: does it accept REFUNDED (or VOIDED / CANCELLED)? If none, the reversal still works but shows "PAYMENTS_NOT_MARKED" and cash-up must be adjusted by hand.
3. `process_credit_sale_payment` (trigger on lb_payments): make sure it does NOT fire on UPDATE of status. Do one credit-sale reversal and confirm the customer balance drops once, not twice.
4. Credit ledger: the reversal reduces the balance by the positive `lb_customer_credit_transactions` rows whose `reference_id` is the sale. Confirm a credit sale writes such a row; if not you get a "CREDIT_NOT_ADJUSTED" warning and the balance is left alone.
5. `perform_daily_closing`: confirm a reversed sale no longer counts in cash / M-Pesa totals.
6. Walk through: cashier asks -> manager approves; manager reverses own sale (shows "their own request"); try a folio-charged sale (refused); try reversing twice (refused).
7. The old browser "void" is gone. If any screen outside this zip calls `saleService.voidSale`, it will fail until moved to the Sale corrections flow.
8. Rollback: drop the `r_sales_*` / `r_payments_*` policies, the `pos_*reversal*` functions, `_reverse_sale_core`, and the `pos_sale_reversals` table. Already-reversed sales stay reversed.

## 10. Double-posting fix — app change only (no migration)
Ship with the next web build. Then run `schema/diagnostics/find_double_posting.sql` (read-only) on production. Block 5 lists any triggers that post stock or folio lines on their own: if one exists, the app and the trigger are both posting and that is a second cause to fix in the database. Duplicate sales found by block 1 are corrected through Sale corrections (phase29, once deployed), duplicate folio lines by "Remove" on the folio, duplicate stock by a stock adjustment with a reason.

## 11. Cash and M-Pesa reconciliation (Phase 30) — run only after approval, STAGING first
Order: phase27, 28, 29, then **30, 31, 32**. Phase 30 stops with a clear message if 28 or 29 is missing; phase 32 needs 28, 29 and 30; phase 31 needs 28 (31 is optional).
Screen: More > Close the day (needs `finance.view`; sign-off needs `payments.approve` and a different person from the one who counted, unless owner). The expected figures use sales, folio payments, cash movements, spending and approved reversals for the Nairobi day. Assumptions about the live database to check on staging: `lb_payments.payment_method` / `status` values, `lb_cash_movements` columns, `lb_folio_payments`, `lb_expenses.status`, `lb_mpesa_transactions`. If a column differs the function errors; it does not guess.

## 12. Staff records and payroll (Phase 31) — run only after approval, STAGING first
Screens: More > Staff records (`employees.manage`), More > Payroll (`payroll.access`). Only the owner can grant these.
**Statutory rates are a starting point, not advice.** Only NSSF (Year 4, 6% up to KES 108,000 from 1 Feb 2026) was read from an official notice. PAYE bands, personal relief, SHIF (2.75%) and the housing levy (1.5%) came from third-party summaries, and sources disagree on whether SHIF and the levy reduce taxable pay. The seeded rates are marked unconfirmed, and **a run cannot be approved until the owner confirms every rate in force for that month** against KRA, NSSF and SHA. When the law changes, add a new rate with a start date; old runs keep the rates they used.
Not built: part-month pro-rating, overtime, loans or advances, automatic unpaid-leave deductions, P9/P10 returns, pay-out files. The system does not move money.

## 13. Control report (Phase 32) — run only after approval
More > Control report (`audit.view`). Read-only; adds no table. It reports only what was recorded through these screens.
