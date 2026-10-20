# My Business — Offline-First: Inspection and Plan

Date: 2026-10-18. **No code was changed for this document.** Evidence labels: **[READ]** from the code in the zip, **[RAN]** executed here, **[UNSEEN]** lives outside the zip (cannot be checked from here).

## 0. What I could not see
The zip has no service worker, `offline.html`, `package.json`, Capacitor/Android project, `../security/AppLock`, or the live database functions `record_expense()` and `record_customer_payment()` (only referenced). Stock-adjustment SQL is also not in the zip. Anything that depends on those is marked [UNSEEN]. The plan avoids rewriting functions I cannot read.

---

## A. Current offline architecture, and why other pages fail

### A1. What exists [READ]
| Piece | File(s) | Role |
|---|---|---|
| Local database | `offline/db.js` (Dexie `umova_offline`, v4) | Tables: `outbox`, `products_cache`, `customers_cache`, `folios_cache`, `rooms_cache`, `recipes_cache`, `meta` (key/value) |
| Sync queue | `outbox` + `offline/syncEngine.js` | One durable queue. Kinds today: `sale`, `shift_open`. Oldest first, one sender (Web Locks), network/auth/refused/duplicate outcomes, nothing silently discarded |
| Offline writes | `offline/offlineSaleService.js`, `offlineShift.js` | Save locally first, then queue. Stable key `client_reference` per sale |
| Server idempotency | `lb_sales.client_reference` unique index, check in `saleService.create` | A retry returns the existing sale (D-01 fix pending migration) |
| Local reads | `offline/offlineCache.js`, `warmCache.js` | Items (≤2,000), stock levels, customers, business profile, till settings; refreshed on open, on reconnect, every 10 min |
| Offline sign-in | `offline/offlineIdentity.js`, `context/POSAuthContext.js` | Profile-only record in localStorage (no password/token), 14-day grace, wiped on sign-out |
| Status UI | `offline/ConnectionStatus.jsx`, `useNetStatus.js`, `OfflineQueuePanel.jsx` | Online/offline pill, pending count, "needs attention" with retry / set aside |
| Page gate | `offline/OfflinePageGate.jsx` | `OFFLINE_READY_PATHS = ['/pos']`: every other page shows "This page needs internet" when the phone is offline |
| App shell | `public/service-worker.js`, `offline.html` (per `OFFLINE_MODE.md`) | [UNSEEN] |

### A2. Why Sell works offline
1. Its reads come from Dexie, not the server: items, stock, customers, business and till settings are copied in advance by `warmCache.js`.
2. Its write is saved to the outbox *before* the cashier is told it worked, with a stable idempotency key the server already understands.
3. Its shift, sign-in and receipt data are also available locally.
4. It is the only path listed in `OFFLINE_READY_PATHS`.

### A3. Why the other pages fail (actual network dependencies) [READ]
| Cause | Evidence | Pages affected |
|---|---|---|
| **Reads go straight to Supabase with no local fallback.** On failure the hook sets an error and an empty list | `hooks/useProducts.js` (`setProducts([])` in `catch`); all `services/*` use `supabase.from(...)` (productService 6, supplierService 9, purchaseService 27, financialReportsService 15 calls) | Products, Stock, Expenses, Suppliers, Customers (partly), Payables, Reports |
| **Writes call server functions directly**, with no queue and no client key | `record_expense` and `record_customer_payment` are RPCs; stock/GRN writes are multi-step inserts (`purchaseService` lines 129-620) | Expenses, customer payments, stock adjust, goods receiving, supplier payments |
| **No server idempotency for those writes.** `client_reference` exists only for sales, folio lines, packages and production runs | grep of `services/*.js` | Everything except Sell. Replaying a lost-reply request would double-post |
| **Reports are server aggregates** | `reconcileService` and `reportsService.closeDay` call RPCs (`perform_daily_closing`); `financialReportsService` joins 15 tables server-side | Reports, Close the day, Financial Statements, Home numbers |
| **Settings, staff and permissions are server-only writes** | `settingsService`, `staffService`, `permissionService` | Settings, Staff |
| **The gate itself** blocks the page even if its data were available | `OfflinePageGate.jsx` | All except `/pos` |
| **No reprint source** | `receiptService.getBySaleId` is only called right after checkout | Receipts (D-04) |
| **Offline unlock has no secret** | `offlineIdentity.js` stores a profile only; unlock relies on the phone's own lock / `AppLock` fingerprint (phone app only) | Login (requirement 13) |

Caching a page's JavaScript does not help any of these: the page loads, then its data request fails. That is why I propose to fix data and writes, not the shell.

### A4. Findings that matter for the design
- The existing mechanism is sound and should be **extended, not replaced**. Dexie, the outbox, the sync engine and the status UI all stay.
- Stock today is "last known quantity", reduced on this phone for each offline sale. The server stays authoritative.

---

## B. Offline capability matrix (current and proposed)
Levels: **A** shell loads, **B** reads local data, **C** offline write, **D** syncs safely, **E** conflict rule.

| Area | Now | Proposed MVP target | Needs internet |
|---|---|---|---|
| Startup / shell | Sell yes; others [UNSEEN] | All pages open offline | First install |
| Login | 14-day profile grace, no PIN | Local PIN unlock (§C5) | First sign-in on a device, password reset/change, after grace expiry |
| Home / dashboard | Blocked | Local numbers from saved + queued data, with "may be incomplete" label | — |
| Products | Blocked | **Read** (already cached). Create/edit stays online in MVP | Create/edit/price changes |
| Sales | Yes | Yes (keep) | M-Pesa prompt, credit limit checks beyond saved data |
| Receipts | Shown after sale only | **Print/reprint any recent sale**, including unsent ones | — |
| Stock | Blocked | **Read**; **adjust** (loss/damage/found) as a queued movement | Stocktake (needs the live count), transfers |
| Receive stock | Blocked | Phase 2 after expenses/payments; needs supplier balance rules | Until phase 2 |
| Expenses | Blocked | **Read + record** (queued, idempotent) | Edit/delete of synced expenses |
| Customers | Picker only | **Read; add customer; record a payment** (queued) | Statements older than saved window, folios |
| Suppliers | Blocked | **Read** | Create, payments (phase 2) |
| Reports | Blocked | **Local "Today / this week"** from saved + queued data; clearly labelled | Close the day, financial statements, anything older than the saved window |
| Settings | Blocked | **Read** | All saves |
| Staff / permissions | Blocked | None | All |

Rule: nothing is shown as "done" unless it is either confirmed by the server or labelled "Saved on this phone".

---

## C. Recommended design (smallest safe changes)

**C1. Keep one database and one queue.** Dexie version 5 adds one generic table, `read_cache` (`[tenantId+collection+key]`, `data`, `savedAt`), for list snapshots (expenses, suppliers, recent sales, receipts, movements). No second database, no second sync engine.

**C2. Read-through helper.** One function: try the server; on success save the result and return it; on a network failure return the saved copy with its `savedAt`. Pages keep their code and switch from `service.getAll()` to the helper. A banner shows "Saved copy from 14:02" when the copy was used. `OfflinePageGate` lets a page open once its data is available offline.

**C3. Widen `warmCache`.** Add: suppliers, expenses (last 90 days), sales and receipts (last 30 days), stock movements (last 30 days), categories, payment methods. Windows are configurable constants. Retention is limited to reduce sensitive data kept on the phone.

**C4. New outbox kinds, one idempotency ledger.**
Because `record_expense`, `record_customer_payment` and the stock functions are [UNSEEN], I do not rewrite them. Instead one migration adds:
- `pos_client_ops(tenant_id, client_reference, kind, result jsonb, created_at)` with `UNIQUE(tenant_id, client_reference)`, RLS by tenant.
- Wrapper functions `pos_apply_expense(...)`, `pos_apply_customer_payment(...)`, `pos_apply_stock_adjustment(...)`, `pos_create_customer(...)`. Each, in one transaction, checks the ledger (returns the stored result if present), otherwise calls the existing function and stores the result. This is the server-side duplicate prevention. It also covers "the reply was lost but the server saved it".
- Callers must be the signed-in staff (`get_current_tenant_id()`, permission checks, `SECURITY DEFINER` with pinned `search_path`, `REVOKE ... FROM PUBLIC`). Tenant isolation is unchanged.

The client generates a UUID for each new customer so a payment queued for that customer can name it before the server has seen it. The sync engine already holds back dependants of a failed parent (it does this for shifts); that rule is generalised.

**C5. Conflict and stock rules.**
- Stock is never sent as a quantity. Sales, adjustments and (later) receipts are sent as **movements** (+/− with reason, time, device, key); the server adds them to its history. Two phones changing the same item add up; nothing overwrites.
- A movement that would make stock negative is **accepted and flagged** for the owner (the goods have physically moved), not rejected. This already matches the sale path.
- Stocktake needs the live count, so it stays online in the MVP.
- Edits to records both sides changed (customer details, prices) are not allowed offline in the MVP, so no last-write-wins exists to go wrong.
- Out-of-order: the queue is oldest-first per business; a failed parent blocks its dependants; unrelated items continue.

**C6. Offline unlock without storing passwords.** After an online sign-in the user sets a 6-digit PIN. Stored: random salt + PBKDF2-SHA256 hash (WebCrypto, ≥210,000 iterations), bound to that staff member and device, in secure native storage on the phone app. 5 wrong tries lock for increasing times and after 10 require an online sign-in. The 14-day grace stays. The PIN unlocks the app only; the database still decides every action once online. Fingerprint (`AppLock`) remains an alternative where present. Limit to state honestly: a PIN hash on a rooted phone can be attacked offline, which is why it is 6 digits with lockout and secure storage.

**C7. Status and errors.** The pill already shows online/offline, pending and "needs attention". Add: last successful sync time (the hook has a slot, unused) and a one-line "N waiting · last sent 14:02".

**C8. Reports.** A local report builder computes totals from saved sales + queued sales + saved expenses. Every local report shows its window, "last updated", the number of unsent items, and a plain "may be incomplete" notice. Close-the-day and financial statements stay online (server-computed; computing them locally would risk a figure that disagrees with the books).

**C9. Receipts.** Reprint reads the saved receipt (or builds one from the queued sale payload). No server call. Printing uses the in-page print from the earlier fix.

**C10. M-Pesa.** "Already paid" works offline (done). "Send prompt" needs internet and a live Daraja response; it is never marked paid on request creation (existing behaviour: only `confirm_mpesa_payment` can do that, locked down by `phase34`).

---

## D. Implementation phases (each small, reviewable, with tests before the next)
| # | Phase | Contents | Migration |
|---|---|---|---|
| 1 | Navigation + persistent local data | Dexie v5 `read_cache`; read-through helper; wider `warmCache`; stale banner; open Products, Stock, Expenses, Suppliers, Customers, Settings **read-only** offline; update gate | none |
| 2 | Receipts | Recent-sales list + offline reprint (closes D-04) | none |
| 3 | Offline writes | `phase35` ledger + wrappers (written, you approve, staging first); outbox kinds: expense, customer payment, new customer, stock adjustment; handlers, dependency blocking, status wording | **phase35** |
| 4 | Offline unlock | PIN set/verify/lockout | none |
| 5 | Local reports | Today/week summary, incomplete/stale labels | none |
| 6 | Hardening and proof | Automated suite (queue, restart, duplicate, network drop mid-send, conflicts, two phones); full device protocol (§E) | none |
| 7 (later) | Receive stock and supplier payments offline | Needs supplier balance rules | later |

---

## E. Test plan
**Automated (I can run):** extend the existing harness (Dexie stand-in; `fake-indexeddb` + real Dexie via `--real` where installable). Cases: save-then-queue before success is shown; restart keeps the queue; lost reply then retry gives one record; network drop mid-send; refused item stays visible; dependant blocked behind failed parent; two devices adjust the same item (both movements kept); same expense key twice (one row); PIN lockout; tenant switch empties saved copy; stale/incomplete labels present.
**Device (only you can run; I will write the script):** with **both Wi-Fi and mobile data off** (aeroplane mode, then each radio separately): cold start, offline unlock, each page, every supported write, receipt reprint, app kill and phone restart, fresh install with no cache (expected: needs internet once), reconnect and check one copy of everything, then totals and stock against the server.

I will not declare offline complete until the device protocol passes. Automated results alone are not that proof.

---

## F. Remaining limitations (known now)
Stocktake, transfers, product edits, staff, settings saves, close-the-day, financial statements and first sign-in stay online. A phone offline for more than 14 days must sign in online again. Local reports cover only the saved window. Stock numbers are "last known" until the phone syncs.

## G. Decisions I need from you
1. Offline writes in the MVP: expenses, customer payments, new customers, stock adjustments. Add receive stock now or later?
2. Saved window: 30 days of sales and 90 days of expenses acceptable?
3. 6-digit PIN for offline unlock acceptable, or fingerprint only on the phone app?
4. Is the shop app the Capacitor Android app, a PWA, or both? Please send `package.json`, `public/`, and the Android folder.
5. May I write `phase35` (ledger and wrappers) for a staging database? I will not run it on your live one.
6. A staging Supabase project for server-side tests of the wrappers and cross-tenant checks.
