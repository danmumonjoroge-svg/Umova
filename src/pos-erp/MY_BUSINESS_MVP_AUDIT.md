# My Business POS — MVP Audit (Phase 1: Inventory and Baseline)

Audit date: 2026-10-18. Phase 1 was read-only. **Phase 2–3 update (same day):** fixes for D-01, D-02, D-06 are in the code and D-03 has a migration ready; see §H. Items marked *fixed in code* are NOT yet confirmed on a phone or the live database.

**Evidence labels used throughout**
- **[READ]** established by reading the code or SQL in the uploaded zip.
- **[RAN]** established by actually running something in this environment.
- **[HYPOTHESIS]** a probable cause that could not be reproduced here. It needs a device or the live database.

## What I was given, and what that limits

The zip (`pos-erp/`, 274 files, 2.7 MB) is the `src/pos-erp` folder only. It has no `package.json`, no `public/` folder, no service worker, no Capacitor/Android project, no `../security/AppLock`, no `../supabaseClient`, and no `.git` history.

| Check | Possible now? |
|---|---|
| Read all POS source, SQL migrations, Edge Functions | Yes |
| Run the existing Node check suites | Yes (see §A) |
| Production build (`npm run build`) | **No**, project shell not in the zip |
| Run the React screens in a browser | **No** |
| Android device / Capacitor / WebView behaviour | **No** |
| Real Dexie/IndexedDB behaviour | **No** (the existing tests use an in-memory stand-in) |
| Live Supabase: RLS, effective grants, data | **No** |

Anything below that depends on those is marked as unverified. Nothing here claims a build, device test, or live-database test passed.

---

## A. Executive summary

**State.** The code base is large and mature, with many modules and good internal documentation. Offline support covers one page (Sell). Receipt printing and the Android navigation path are the weakest points. The audit also found one likely data-loss bug in offline sync and one likely payment-integrity gap in the M-Pesa database function.

**Biggest blockers for real-business use (ranked)**
1. **D-01, Critical [READ]**: offline sale IDs are only unique per phone per day, but the server treats a matching ID as "already synced". Two phones in one business can each make `LOCAL-SALE-<today>-000001`. The second phone's sale would then be silently dropped.
2. **D-02, High [READ + HYPOTHESIS]**: the Print Receipt dead end comes from `utils/printDocument.js`. It opens a blank `window.open(..., '_blank')` window and prints from it, with no way back. It also calls `print()` twice and never closes the window.
3. **D-03, High [READ]**: `confirm_mpesa_payment()` is `SECURITY DEFINER` with no caller check and no `REVOKE`/`GRANT` in its migrations. A signed-in cashier who knows a checkout ID might be able to mark a payment as paid. This needs a live-database test.
4. **D-04, High [READ]**: there is no receipt reprint or sales-history entry point. Once the receipt modal is closed, an offline receipt cannot be reopened.
5. **D-05, Medium**: only `/pos` (Sell) is declared offline-ready. Every other page shows "needs internet". That is a documented design choice, so it is a scope decision rather than a bug. It must be stated clearly to shop owners.

**Realistic readiness.** Not ready for real businesses until D-01 to D-04 are fixed and tested on a real Android phone. Sell, offline queue, tenant model and permissions look well designed. The fixes are small and targeted. I do not think a rewrite is needed.

**Baseline test results [RAN], Node v22.22.0**
- 8 of 8 suites in `schema/tests/*_js_checks.mjs` passed, including the 60 offline checks (on the Dexie stand-in).
- `tests/branding.test.mjs` and `tests/permissions.test.mjs` **fail on import**. They import names (`computeOutputSize`, `ALL_PERMISSIONS`) that the current `utils/logoImage.js` and `utils/permissions.js` do not export. These are stale tests, not proof of broken features (D-09).

---

## B. Architecture inventory

**Stack.** React (CRA-style `REACT_APP_*` env vars), React Router, Tailwind classes, lucide-react, Supabase (separate POS client, storage key `sb-pos-auth-token`), Dexie for local storage, Supabase Edge Functions for M-Pesa. Phone app wrapper and fingerprint lock live outside this folder (`../security/AppLock`).

**Auth and tenancy [READ].** `POSAuthProvider` → `POSAuthGate` → `PosLock` (fingerprint) → routes. The tenant ID travels in the JWT (`pos_tenant_id`, set by a token hook); `get_current_tenant_id()` drives RLS. `pos_tenants` is linked to `lb_businesses`. Roles: owner / manager / cashier, with a permission-key system (`phase28_*`, `utils/permissions.js`, `navigation/PermissionsContext.jsx`). `RequirePermission` hides pages in the UI. The database is meant to be the real boundary.

**Offline mechanism [READ].** Dexie database `umova_offline` (v4): `outbox` (the sync queue), `products_cache`, `customers_cache`, `folios_cache`, `rooms_cache`, `recipes_cache`, `meta`. Components:
- `syncEngine.js`: drains the outbox oldest-first, one sender at a time (Web Locks), and handles network / auth / refused / duplicate outcomes.
- `offlineSaleService.js`: wraps `saleService.create()`.
- `offlineShift.js`: shifts opened offline.
- `offlineIdentity.js`: a 14-day profile-only grace period.
- `warmCache.js`, `offlineCache.js`, `useNetStatus.js`, `ConnectionStatus.jsx`, `OfflineQueuePanel.jsx`, `OfflinePageGate.jsx`.
- The service worker and `offline.html` are documented in `OFFLINE_MODE.md` but **not in the zip**.

**Receipt/print [READ].** `ReceiptModal.jsx` (in-app modal) → `receiptService.print()` → `utils/printDocument.js` (new browser window). The same `printDocument` is used by customer statements, supplier statements, payslips and folio documents. `invoicePdfService.js` uses a hidden iframe instead (a better pattern already in the repo). `FinancialReportsPage` uses `window.print()` on the page itself.

**Data.** 35 SQL files in `schema/`. Core retail tables are the older `lb_*` family (`lb_sales`, `lb_receipts`, `lb_products`, `lb_inventory`, …), linked to `pos_tenants`/`pos_staff`. Tenant-scoped RLS is the pattern throughout.

**Module inventory** (status key: V = verified with evidence, IN = implemented but not verified, P = partial, B = broken, M = missing, X = blocked by external dependency)

| Module | Key files | Status | Evidence / note |
|---|---|---|---|
| Auth, login, tenant signup | `auth/*`, `context/POSAuthContext.js` | IN | Code reads complete; no live test |
| Offline identity / session restore | `offline/offlineIdentity.js` | V (logic only) | Stand-in checks pass; no device test |
| Fingerprint lock | `../security/AppLock` | X | Outside the zip |
| Sell / checkout | `pages/POSPage.jsx`, `saleService.js` | IN | Reported working by owner; D-01 affects offline sync |
| Offline sale queue and sync | `offline/*` | P | Logic checks pass on stand-in; D-01; real Dexie unverified |
| Receipt on screen | `ReceiptModal.jsx` | IN | |
| Receipt print | `printDocument.js` | **B** | D-02 |
| Receipt reprint / sales history | none found | **M** | D-04 |
| Products | `ProductsPage`, `productService` | IN | |
| Inventory / stock | `InventoryPage`, `inventoryService` | IN | Source of truth for stock balances not yet established |
| Purchasing, receiving, suppliers, payables | `PurchaseOrdersPage`, `GoodsReceivingPage`, `SuppliersPage`, `PayablesPage` | IN | |
| Expenses | `ExpensesPage`, `expensesService` | IN | |
| Customers, credit, statements | `CustomersPage`, `receivablesService` | IN | |
| Cash, daily closing, reconciliation | `CashPage`, `ReconciliationPage`, `phase4/30` | IN | |
| Reports (My Reports = Daily Closing; Financial Statements) | `ReportsPage`, `FinancialReportsPage` | P | Balance sheet is as-of-today only; profit definition needs review |
| M-Pesa (STK) | `supabase/functions/*`, `phase12/13` | P / X | D-03; needs Daraja credentials and live test |
| Sale corrections (reversals) | `SaleCorrectionsPage`, `phase29` | IN | Reversal mechanism exists; good |
| Staff, permissions | `StaffPage`, `phase28*` | IN | |
| Settings, branding | `SettingsPage`, `phase27*` | IN | |
| Rentals, maintenance, invoices | `Units/Charges/Meters/Invoices/MaintenancePage` | IN | |
| Salon, rooms, folios, production, packages, HR/payroll | respective pages | IN | Out of the core MVP shop path |
| Audit page | `AuditPage` | P | Only sale events are logged (per earlier notes) |
| Service worker / PWA shell | `public/service-worker.js` | X | Not in zip |
| Android/Capacitor config | n/a | X | Not in zip |

No TODO/FIXME markers, empty click handlers or "coming soon" placeholders were found in the live source [RAN: grep]. `_archived_dead_code/` is correctly excluded from the app.

---

## C. Defect register

| ID | Sev | Module / file | Finding |
|---|---|---|---|
| D-01 | **Critical** (fixed in code; migration pending) | `offline/idGenerator.js`, `saleService.js:135`, `schema/phase11_offline_sync.sql:27` | Offline sale key can collide across devices (silent loss) |
| D-02 | **High** (fixed in code; device test pending) | `utils/printDocument.js` | Print dead end |
| D-03 | **High** (migration written, not run) | `phase12/17 confirm_mpesa_payment` | M-Pesa confirm function has no caller check |
| D-04 | **High** | `ReceiptModal.jsx`, `POSPage.jsx` | No reprint / receipt history |
| D-05 | Medium | `offline/OfflinePageGate.jsx` | Only `/pos` works offline |
| D-06 | Medium (fixed in code; device test pending) | `ReceiptModal.jsx`, router | No Android Back handling for the receipt modal |
| D-07 | Medium | 6 SQL functions | `SECURITY DEFINER` without pinned `search_path` |
| D-08 | Medium | Early migrations | Many functions have no `REVOKE`; guard status of ~35 needs manual review |
| D-09 | Low | `tests/*.test.mjs` | Two stale test files fail on import |
| D-10 | Low | `POSApp.jsx` | Build-time auth bypass flag exists |
| D-11 | Low | Routes in `POSApp.jsx` | About 20 routes have no `RequirePermission` (UI only) |
| D-12 | Medium | `phase28_permissions.sql` | No permission trigger on `lb_inventory` / `lb_stock_movements`: `inventory.adjust` is enforced only in the UI [READ] |
| D-13 | High | `purchaseService.applyStockMovement` | Stock changed by read-then-write in the browser (lost update between two devices) [READ]; `phase35` fixes it for adjustments only |

### D-01 — Offline sale ID collision can silently drop a sale (Critical) [READ]
- **Reproduction (by code path).** Two phones in one business, both offline on the same day, each make their first sale.
  1. `nextLocalId('SALE')` counts per phone per day, so both get `LOCAL-SALE-20261018-000001`.
  2. When phone 2 syncs, `saleService.create()` runs `select id from lb_sales where client_reference = …`. It finds phone 1's sale (same business, RLS allows it).
  3. It returns that existing sale as if phone 2's sale had been saved. The outbox row is marked **SYNCED**.
- **Expected.** Both sales are saved.
- **Actual.** Phone 2's sale is never written. Stock, takings and customer credit for it are missing, and the queue says "Sent".
- **Second form.** The unique index is global (`ON lb_sales(client_reference)`, not per tenant). Two different businesses on the same day can collide, and the second insert fails with 23505. The `sale` handler does not treat 23505 as success, so it lands in "Needs attention". That form is loud, not silent.
- **Root cause.** Key is not globally unique (per-device counter), and the idempotency check and index are not scoped by tenant/device.
- **Proposed fix.** Make the key unguessable and globally unique, for example `LOCAL-SALE-<date>-<deviceId>-<seq>` or a UUID, and keep the human-readable number separate. Scope the unique index to `(tenant_id, client_reference)` (needs a migration; see §I). Also compare the stored total and items to the queued ones before treating a match as a duplicate.
- **Test required.** A two-device collision scenario in the offline suite (assert two distinct sales). A SQL scenario for the new index.

### D-02 — Print Receipt dead end (High) [READ + HYPOTHESIS]
- **Trigger.** `ReceiptModal` → `receiptService.print` → `printDocument()`.
- **What the code does.**
  - `window.open('', '_blank', 'width=420,height=600')` then `document.write(...)`.
  - It calls `win.print()` from `onload` **and** again from a 700 ms timer, so two print requests can fire.
  - It never listens for `afterprint` and never closes the window.
  - There is no Back/Done control inside that window.
- **Likely cause on a phone.** In an installed app or WebView, a script-opened blank window can take over the screen with no browser chrome. If the print sheet is cancelled or fails, nothing is left to tap. Android Back may close nothing, and the only exit is killing the app. **I could not reproduce this without a device**, so this is a hypothesis. It fits the symptom you described.
- **Same defect elsewhere.** Customer statement, supplier statement, payslip and folio documents all use `printDocument`.
- **Required behaviour (from your brief §4).** All seven points are unmet today: no Done/Return action, Back unpredictable, failure leaves the UI stuck. The sale itself is not affected, because the sale is saved before the modal opens [READ].
- **Proposed fix (smallest safe).** Print through a hidden iframe in the same page, the pattern `invoicePdfService.js` already uses. Print once, remove the iframe on `afterprint` or after a timeout, and keep the receipt modal open with a clear Done button. Where printing is unsupported, show a clear message instead of a dead window. Make Android Back close the modal (D-06).
- **Test required.** Real Android installed app and Chrome: print, cancel, fail, Back, Done; reopen receipt; confirm no second sale is created.

### D-03 — `confirm_mpesa_payment()` has no caller check (High) [READ, needs live test]
- The function (phase12, rewritten in phase14 and phase17) is `SECURITY DEFINER`, takes a checkout ID and a result code, and moves the transaction to PAID and completes the sale. The body has no check of who is calling. The migrations contain no `REVOKE ... FROM PUBLIC` or `GRANT EXECUTE` for it. It is called by the Edge Function using the service-role key.
- **Risk.** If `authenticated` can execute it, a signed-in cashier who can read a transaction's `checkout_request_id` could call it with result code 0 and a made-up receipt number, marking the sale paid without money.
- **Fix.** `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;` plus a pinned `search_path`.
- **Test.** On staging, call it as a cashier via the Supabase API and confirm it is refused.

### D-04 — No reprint or sales history (High) [READ]
`receiptService.getBySaleId` is called only right after checkout. No screen lets a cashier find a past sale and reprint its receipt. An offline receipt (synthetic, `LOCAL-SALE-…`) exists only in modal state and in the outbox payload, so it disappears once closed. Your brief requires reprint and "reopening the receipt does not create another sale". Fix: a "Recent sales" list with a Reprint action that reads `lb_receipts`, or the outbox payload for unsynced sales.

### D-05 — Offline scope is Sell only (Medium) [READ]
`OFFLINE_READY_PATHS = ['/pos']`. See §D. This is deliberate and documented. It needs a decision from you on which other pages should work offline (§I).

### D-06 — Receipt modal ignores the Android Back button (Medium) [HYPOTHESIS]
The modal is plain component state (`receiptModal`), not a route or history entry. Back is therefore expected to leave `/pos` or exit the app while the modal is open. Needs device confirmation. No Capacitor `backButton` listener exists in the zip.

### D-07 / D-08 — Function hardening (Medium) [READ]
- Parsing all 35 SQL files found 111 `SECURITY DEFINER` functions. **6 have no `search_path`**: `confirm_mpesa_payment` (×3 versions), `expire_stale_mpesa_requests`, `perform_daily_closing`, `post_asset_depreciation`.
- 35 function bodies show no obvious tenant/permission/auth reference. Many are internal helpers (names starting `_`) or are protected by `REVOKE`, which is present only in phases 19 onward. Phases 4–17 (M-Pesa, property, salon, assets, closing) have **no `REVOKE`/`GRANT` at all**. This is a pattern-match, not a proven hole. The effective grants must be read from the live database (`information_schema.routine_privileges`).

### D-09 / D-10 / D-11 (Low)
- **D-09 [RAN].** `tests/branding.test.mjs` and `tests/permissions.test.mjs` throw on import (missing exports). Update or retire them. The `schema/tests/*_js_checks.mjs` suites cover the same areas and pass.
- **D-10 [READ].** `REACT_APP_POS_SKIP_AUTH=true` turns the login off (a red banner shows). It is a build-time flag, so it must be false in every release build.
- **D-11 [READ].** Routes such as `/pos/units`, `/pos/meters`, `/pos/invoices`, `/pos/maintenance`, `/pos/services`, `/pos/recipes`, `/pos/stays` and the workspace landing pages have no `RequirePermission`. A hidden menu item is not authorization (brief §9), and the database must refuse those actions. Confirm that with the RLS review.

---

## D. Offline compatibility matrix

Levels: A shell loads, B local data readable, C offline writes, D sync, E conflicts. "Declared" is the code's own statement; "Verified" is what I could actually test.

| Page | A Shell | B Local data | C Offline write | D Sync | E Conflict | Declared | Verified |
|---|---|---|---|---|---|---|---|
| Login / session restore | needs SW | profile only (14 days) | n/a | n/a | n/a | Yes | Logic only (stand-in) |
| Sell (`/pos`) | needs SW | items (≤2,000), customers, folios | Yes: cash, M-Pesa code, card, credit, folio | Outbox, idempotent key | none (see D-01) | Yes | Logic only; **D-01** |
| Receipts | in modal | built from queued payload | print/share only | n/a | n/a | Yes | No (D-02, D-04) |
| Shifts | | | open offline | before its sales | | Yes | Logic only |
| Dashboard | blocked by gate | none | no | n/a | n/a | "Needs internet" | Not run |
| Products | blocked | none | no | n/a | n/a | "Needs internet" | Not run |
| Stock receiving / adjust | blocked | none | no | n/a | n/a | "Needs internet" | Not run |
| Expenses | blocked | none | no | n/a | n/a | "Needs internet" | Not run |
| Customers / credit | blocked | picker only (on Sell) | no | n/a | n/a | "Needs internet" | Not run |
| Suppliers / payables | blocked | none | no | n/a | n/a | "Needs internet" | Not run |
| Reports | blocked | none | no | n/a | n/a | "Needs internet" | Not run |
| Settings / staff | blocked | none | no | n/a | n/a | "Needs internet" | Not run |

Also: closing a shift and M-Pesa prompts require internet on purpose. Of your 14 required offline test steps, none could be executed here (no browser, no device, no real IndexedDB). The existing 60 automated checks cover queue order, retry, idempotency and shift ordering only against a stand-in.

---

## E. Security and data-integrity report (preliminary)

| Area | Finding | Evidence |
|---|---|---|
| Tenant isolation | Pattern is sound: `get_current_tenant_id()` from JWT claim, RLS on tables | [READ] 35 migrations; every migration that creates tables also enables RLS (scripted check) |
| RLS correctness | Not tested | Needs live cross-tenant read/write attempts |
| Function privileges | D-03, D-07, D-08 | [READ] |
| Secrets | No service-role key in browser code. It appears only in the three Edge Functions, as an env var | [RAN: grep] |
| Auth bypass flag | D-10 | [READ] |
| Device storage | Offline identity holds profile only (no password or token), expires in 14 days, wiped on sign-out. Sessions use secure native storage on the phone app | [READ] |
| Offline duplicate/loss | D-01 | [READ] |
| Transaction history | Reversal mechanism exists (`phase29`); sales are not deleted as a correction route | [READ] |
| Audit trail | Sales events logged; other modules not (per project notes) | [READ] |

I did not run any cross-tenant attack tests. They need a staging Supabase project.

---

## F. MVP gap analysis

- **Confirmed defects:** D-01, D-02, D-03, D-06, D-09.
- **Incomplete or missing essentials:** reprint / sales history (D-04); a decided offline scope beyond Sell (D-05); a build, release and recovery plan; an Android test pass.
- **Needs verification before any claim:** totals agreement across checkout, record, receipt and reports; stock balance source of truth; profit definition (cost of goods sold) in reports; end-of-day reconciliation; M-Pesa end to end.
- **Optional / later:** offline for stock receiving and expenses; customisation layers (§G); audit logging beyond sales.

---

## G. Customisation-readiness (assessment from the code; no changes proposed yet)

Existing building blocks [READ]: capability switches per business (`CAPABILITIES`, `optIn`, `withRequired` in `navConfig.js`), tenant branding (`phase27_*`, `utils/branding.js`), per-business settings (`lb_pos_settings`, `SettingsPage`), a permission-key system with role templates (`phase28`), and `pos_tenants` as the tenant anchor. This matches your Phases 1 and 2 almost entirely. Missing: custom fields, report configuration, workflow configuration, versioned extensions. The recommendation is to keep one codebase, extend `pos_tenants`/settings, and not build a framework until the MVP is stable. A detailed phased design comes in Phase 7.

---

## H. Work completed

**Phase 1:** no source changes; this report and the status file were added.

**Phase 2–3 (2026-10-18).** A copy of the original code was kept as `pos-erp-baseline-backup` before any edit.

| File | Change | Why |
|---|---|---|
| `utils/printDocument.js` | Prints through a hidden in-page frame instead of a new window; prints once; removes the frame after printing; reports a clear message if printing fails | D-02. Old code opened a window with no way back and printed twice |
| `services/receiptService.js` | `print()` passes an error callback through | D-02 |
| `components/ReceiptModal.jsx` | Android/browser Back closes the receipt and stays on the till; Done button now reads "Done — back to sale" and is full-size; the close X is a larger touch target; Print is disabled while the print sheet opens | D-02, D-06 |
| `offline/idGenerator.js` | Every local ID now includes a random per-phone ID: `LOCAL-SALE-20261018-1D7A2A96-000001`. Old queued IDs still sync | D-01 |
| `services/saleService.js` | Duplicate-sale lookup is limited to this business. If the key matches a sale with a *different total*, the sale is refused into "Needs attention" instead of being treated as saved | D-01 |
| `utils/mpesa.js`, `pages/POSPage.jsx` | One tested helper decides which M-Pesa modes are open: "Already paid" always, "Send prompt" only with internet and full setup; the till also blocks an M-Pesa code already on a waiting offline sale | Manual M-Pesa must need no setup and must work offline |
| `offline/offlineSaleService.js` | `findQueuedMpesaCode()` | Same SMS code typed on two offline sales |
| `services/receiptService.js` | Receipt shows "M-Pesa <code>" instead of "MOBILE MONEY" | Readable receipts |
| `PHONE_TEST_SCRIPT.md` | New 20-step device test | Tests I cannot run here |
| `schema/phase33_offline_key_per_tenant.sql` | **Written, not run.** Makes the unique sale key per business | D-01 |
| `schema/phase34_mpesa_confirm_lockdown.sql` | **Written, not run.** Pins `search_path`, removes access for staff/anonymous callers, keeps it for the server function | D-03 |
| `schema/tests/mvp_phase3_checks.mjs` | New: 24 checks for the above | |
| `schema/tests/offline_harness/dexie_standin.js` | The test stand-in now runs transactions one at a time, as real Dexie does | Needed for the "rapid taps" check to mean something |
| `schema/tests/offline_js_checks.mjs` | One assertion updated to the new ID format | Expected consequence of D-01 |

**Tests run [RAN], Node 22.22.0**
- `mvp_phase3_checks.mjs`: all 24 pass. The print and Back checks run the **real** `printDocument.js` and `ReceiptModal.jsx` in a simulated browser (jsdom + React 18). Simulated, not a real phone.
- The 7 other `schema/tests/*_js_checks.mjs` suites: all pass (offline suite included, still on the Dexie stand-in).
- Not run: production build, real browser, Android, live Supabase, the SQL migrations (not even on a scratch database yet).

**Known limits of these fixes**
- Whether the print sheet itself opens inside your installed Android app depends on the app wrapper (WebView). If it does not, the screen now shows "Printing did not start…" and the cashier can still use WhatsApp/Email and press Done; they are no longer trapped. This needs a real phone.
- In React development mode (StrictMode) the Back-button entry may be pushed twice. Production builds are not affected.
- Old sales already stuck in the queue with the old ID format are sent with the old ID. The business-scoped check still protects them, but a same-day collision between two *old-version* phones could not be repaired by this change.
- D-04 (reprint / sales history) is not built yet.

## I. Remaining blockers and decisions needed from you

1. **Project shell.** Send `package.json`, `public/` (service worker, `offline.html`), and the Capacitor/Android folder (or tell me you only want fixes in `src/pos-erp`). Without it I cannot run a build.
2. **Database migrations.** D-01 and D-03 need SQL changes. I will write them and test them on a scratch database, but **I will not run anything against your live Supabase without your approval**.
3. **Device testing.** I need you (or a tester) to run the print/Back/offline checks on a real Android phone once D-02 is fixed. I can write the exact test script.
4. **Offline scope.** Should stock receiving and expenses work offline for the MVP, or stay Sell-only?
5. **Staging project.** A Supabase staging project for cross-tenant and permission tests.

## J. Release checklist (must all pass before real businesses)

- [ ] D-01 fixed and covered by a two-device collision test.
- [ ] D-02, D-04 and D-06 fixed and passed on a real Android installed app and in Chrome.
- [ ] D-03 and the grant review (D-07, D-08) done against the live database.
- [ ] Cross-tenant read/write attempts all refused.
- [ ] Offline test steps 1–14 (your brief §5) passed on a device, including phone restart and fresh install.
- [ ] Totals agree across checkout, stored sale, receipt and daily closing for cash, M-Pesa, credit and split payments.
- [ ] Production build succeeds; `REACT_APP_POS_SKIP_AUTH` is not true.
- [ ] Stale tests fixed or retired; all suites pass.
- [ ] Backup and recovery steps written and tried once.
