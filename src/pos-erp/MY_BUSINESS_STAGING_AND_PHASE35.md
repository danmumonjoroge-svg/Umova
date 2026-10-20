# phase35 (duplicate protection), receive-stock check, staging setup, and files I need

Date: 2026-10-19. Nothing here was run against your live Supabase. Nothing asks for a password or key.

## 1. Project files and Git: what I could and could not reach
- I looked for your repository. This session has **no GitHub account linked** and no link to your computer, so I cannot open `C:\Users\DMUMO\sacco-dashboard` or the repo. I have only the `pos-erp` folder you sent.
- Still not seen: `package.json`, `public/service-worker.js`, `public/offline.html`, any Capacitor config, the `android/` folder, `src/security/*`, `src/supabaseClient.js`, and the database schema for the older `lb_*` tables.
- **Two ways to give them to me (pick one):**
  1. **Connect GitHub (best).** In claude.ai go to Settings → Connectors → GitHub, then tell me `owner/repo`. I attach it read-only.
  2. **Copy and paste** the files below into the chat, or zip only those files.
- **Exact list (paths relative to `sacco-dashboard`):**
  `package.json` · `package-lock.json` (only the first 30 lines) · `public/service-worker.js` · `public/offline.html` · `public/manifest.json` (or `manifest.webmanifest`) · `src/index.js` · `src/offline/registerServiceWorker.js` · `src/security/AppLock.*` · `src/security/secureAuthStorage.*` · `capacitor.config.json` (or `.ts`) · `android/app/src/main/AndroidManifest.xml` · `android/app/build.gradle` · `android/variables.gradle` · and the output of `git status` and `git log --oneline -10`.
- **Never send:** `.env` files, `local.properties`, any `*.jks` / `*.keystore`, `keystore.properties`, `google-services.json`, signing passwords, any Supabase **service-role** key, or database passwords. If a file contains one, delete that line before sending. The anon key is public, but I do not need it either.

## 2. Does postponing "receive stock" break the offline workflows? (inspected)
Short answer: **it will not break them, but it shares stock rows with offline adjustments, so I found a real risk.**
- Receiving does not use the offline database or the outbox at all. It calls the server directly (`purchaseService.js`), so it keeps working online exactly as now. Nothing in the offline plan depends on it.
- Receiving, supplier returns and manual stock adjustments all go through one browser-side function, `applyStockMovement()`. It **reads** the stock quantity, **adds** in the browser, and **writes the total back**. That is a read-then-write: two devices acting at the same moment can overwrite each other (**D-13**). Sales avoid the problem only partly (they use the same function).
- The new `pos_apply_stock_adjustment()` changes stock **on the server, under a lock, by the amount**. If a receipt (old read-then-write) and an offline adjustment (new locked change) happen in the same instant, the receipt could overwrite the adjustment's effect.
- **Decision:** keep receiving online-only (as agreed), and make moving `applyStockMovement()` onto the same server function the very next step after the offline workflows are stable. Until then the exposure is a narrow time window and is recorded in the SQL header.
- **Also found (D-12):** stock tables (`lb_inventory`, `lb_stock_movements`) have **no permission trigger**. A cashier without `inventory.adjust` could change stock by calling the API directly. The new wrapper enforces `inventory.adjust`; the table itself still needs a guard. I will propose that separately.

## 3. phase35 — what it changes (file: `schema/phase35_offline_idempotency.sql`)
**New objects (only these):**
| Object | Purpose |
|---|---|
| table `pos_client_ops` | "Already done" ledger. Columns: `tenant_id`, `client_reference`, `kind`, `request_hash`, `result`, `created_by`, `created_at`. **UNIQUE (tenant_id, client_reference)**. RLS on, **no policies, no grants** — nobody can read or write it through the API |
| `_pos_claim_op`, `_pos_finish_op` | Internal: claim a key / store the result. Not callable by users |
| `pos_apply_expense(...)` | Wraps the existing `record_expense()` |
| `pos_apply_customer_payment(...)` | Wraps the existing `record_customer_payment()` |
| `pos_create_customer(...)` | Inserts a customer using an id the phone chose |
| `pos_apply_stock_adjustment(...)` | Locks the stock row and applies the change; writes the movement |

**Existing tables affected:** none altered. Rows are written to `lb_expenses`, `lb_customer_payments`, `lb_customers`, `lb_customers.outstanding_balance`, `lb_inventory`, `lb_stock_movements` exactly as the app does today (through the same functions, so their triggers and RLS still apply).
**Existing constraints and security kept:** RLS unchanged. `phase28` permission triggers on `lb_expenses` and `lb_customer_payments` still fire. The wrappers also call `pos_require()` for the right permission. Business ownership is checked (`lb_businesses`, `lb_customers`, `lb_products` must belong to the caller's business). `SECURITY DEFINER` with a pinned `search_path`. `anon` has no access.
**Safe retries, including "the server saved it but the reply never arrived":**
1. Claim and work happen in **one transaction**. Same key + same request again → returns the saved result with `duplicate: true`, does nothing.
2. Same key + **different** request → refused with error `P0409`, nothing saved, shows as "Needs attention" (never silently treated as done).
3. Failure of any kind → the whole transaction rolls back **including the claim**, so a later retry runs normally.
4. Two retries at once → the second waits, then gets the first one's result.
**Existing duplicate records:** the app can't fix these automatically. Run `schema/diagnostics/phase35_precheck.sql` first. It is read-only and lists likely double-posted expenses, payments and stock movements, stock rows that disagree with their movements, duplicate stock rows, negative stock, current permissions on `confirm_mpesa_payment` and the other money functions, row-security status, and whether any trigger guards the stock tables.

**Tested [RAN] on a scratch PostgreSQL 16** (stand-in tables shaped from the app code, not your real functions): **38 of 38 checks pass.** Covers: retry saves once; same key different data refused; failed attempt does not burn the key; two simultaneous calls save one; payment balance reduced once; customer then payment order; stock changes add up (10 − 4 = 6) and stay equal to their movements; negative stock accepted and flagged; wrong business refused for business, customer and item; no permission refused; same key text allowed in two businesses; signed-in users cannot read/write the ledger or call internal functions; anonymous users cannot call the wrappers; file can be run twice.
**Not tested:** against your real `record_expense()` / `record_customer_payment()` (not visible to me), real triggers, real RLS policies, or real Supabase auth. That is exactly what staging is for.
Run it yourself: `sh schema/tests/phase35_run.sh` (needs a scratch Postgres; see the script).

## 4. Create a staging Supabase project (step by step)
**Rules:** staging must contain **no real customer data**. Use different email addresses. Never paste production keys into chat or into the staging app.
1. **Create the project.** supabase.com → New project → name it `mybusiness-staging`, same region as production, strong database password stored in your password manager (not in chat).
2. **Copy the structure, not the data.** On your computer, install the Supabase CLI. Run `supabase login`, then `supabase link --project-ref <PRODUCTION ref>` and `supabase db dump -f prod_schema.sql` (schema only; this includes tables, RLS policies, functions and triggers, and no rows). Then `supabase link --project-ref <STAGING ref>` and apply it: `psql "<staging connection string>" -f prod_schema.sql`. (Connection strings stay on your computer.) If you prefer not to use the CLI, the Supabase dashboard's SQL editor can run the file in parts.
3. **Compare.** Confirm the staging table list matches production. If `lb_*` tables or the older functions are missing, the dump was incomplete. Tell me which and I will advise.
4. **Authentication settings in staging** (dashboard → Authentication): same email/password settings as production, and turn on the **custom access token hook** that adds `pos_tenant_id` / `pos_staff_id` to the sign-in token (`pos_custom_access_token_hook`). Without it, every business looks empty.
5. **Storage:** create the `business-logos` and product-image buckets as your migrations describe (`phase15`, `phase16`). Do not copy files.
6. **Edge Functions:** deploy `mpesa-save-config`, `mpesa-stk-push`, `mpesa-callback` to staging with `supabase functions deploy`. Set their secrets in staging only, using Daraja **sandbox** credentials. Do not use production Daraja keys.
7. **Run my scripts in this order, on staging only:** `schema/diagnostics/phase35_precheck.sql` (read) → `phase33_offline_key_per_tenant.sql` → `phase34_mpesa_confirm_lockdown.sql` → `phase35_offline_idempotency.sql`. Send me the precheck results (no data values are needed; counts and function names are enough).
8. **Test accounts (two separate businesses, so isolation can be proven):**
   - Business A: an owner, a manager, a cashier (cashier without stock-adjust permission).
   - Business B: an owner and a cashier.
   - Create them through the app's normal business sign-up and staff screens against staging (so every check goes through real code), with test emails like `a-owner+stg@…`. Give each some items, customers and a shift.
9. **Point a test build at staging.** Create `.env.staging` with `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_KEY` set to the **staging** project's URL and anon key. Build the Android test app with those values and a different app name/id (for example "My Business STG") so it can never be confused with the real one. Make sure `REACT_APP_POS_SKIP_AUTH` is not `true`.
10. **Safety checks before every test session:** the app's URL host is the staging project; no real customers are present; you are signed in as a test account.
After this, I will write the staging test script (cross-business and permission tests via the API, plus the offline device tests) and the app changes that call the new functions.

## 5. What happens next
1. You: connect GitHub or send the file list; create staging; run the precheck on it.
2. Me (no database needed, can proceed now): Phase 1 of the offline plan (saved copies for reading Products, Stock, Expenses, Suppliers, Customers, Settings, with 30/90-day configurable windows that never delete unsent items), then the outbox kinds and handlers for the four writes, then the PIN unlock.
