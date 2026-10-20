# Offline mode — POS module (Module 1 of 3: POS → Chama → Finance)

## In plain words
After a phone has opened My Business **once with internet**, it keeps working with no signal:

| You can do offline | What happens |
|---|---|
| Open the app | The app is saved on the phone (needs the service worker, see "Setting up") |
| Open the till after a restart | Uses your saved sign-in for up to **14 days** since the last online check |
| Open or keep a shift | A shift opened offline is sent to the server first, before its sales |
| Search / scan items | From the item list saved on the phone (up to 2,000 items) |
| Sell: cash, M-Pesa "already paid" (code), card, credit, folio charge | Saved on the phone as **"Saved on this phone"**, never called sold-and-confirmed |
| Pick a customer for credit | From the customer list saved on the phone |
| Print / share a receipt | Receipt shows the local number (LOCAL-SALE-…); the real number arrives after sending |

| Needs internet (on purpose) | Why |
|---|---|
| Closing a shift | The server works out expected cash from the sales it has; closing early would give a false "balanced" |
| M-Pesa prompt (STK push) | The buyer's phone must be reached; the till falls back to "Already paid" |
| Every other page (stock adjust, expenses, reports…) | Later modules; the page says "This page needs internet" and offers "Go to Sell" |
| First ever sign-in on a phone | Nothing is saved yet |

Tap the **connection pill** (top bar) to see **Saved on this phone**: each sale as *Saved on this phone → Sending → Sent*, or *Needs attention* (reason shown; owner/manager can *Try again* or *Set aside*, never silently deleted).

## What was wrong before (found in the audit)
1. The app could not open with no signal at all (no service worker).
2. Opening offline sat on a spinner, or logged the cashier out once the token was an hour old.
3. No shift could be found or opened offline, so selling was blocked.
4. Stock levels and customers were never saved; each item-list refresh also wiped saved stock.
5. A dropped connection during a sale/sync was misread as a *refused* sale ("needs attention"), because supabase-js errors are not `TypeError`s.
6. A sale stuck "sending" after the page closed was never retried; two tabs could send together.
7. An offline sale was rejected on sync if the server's stock looked short (the goods had already gone), and was dated with the upload time instead of the sale time.
8. Refused sales could not be seen, retried or set aside.

## Files
New: `public/service-worker.js`, `public/offline.html`, `src/offline/registerServiceWorker.js`, `pos-erp/offline/{netErrors,offlineIdentity,offlineShift,warmCache,queueLabels}.js`, `OfflineQueuePanel.jsx`, `OfflinePageGate.jsx`.
Changed: `index.js` (registers worker), `context/POSAuthContext.js`, `auth/usePosErpAuth.js`, `offline/{syncEngine,offlineCache,offlineSaleService,ConnectionStatus,idGenerator}`, `hooks/{useCashierShifts,useCustomers}.js`, `services/{saleService,cashierService,scannerService}.js`, `pages/POSPage.jsx`, `POSLayout.jsx`, `navigation/{Capabilities,Permissions}Context`.
No database/schema change. No Stage 2 (M-Pesa) work.

## Setting up (one-time, for whoever deploys)
1. Copy `public/service-worker.js` and `public/offline.html` into your project's `public/` folder.
2. Deploy over **https**. Open the app once online on each phone. Then test: aeroplane mode → reopen.
3. iPhone: use **Add to Home Screen** (Safari clears saved data of unused websites after ~7 days otherwise).
4. Dexie must be installed (it already is, `offline/db.js` uses it).

## Safety decisions you may want to change
- Offline sign-in grace: `OFFLINE_GRACE_DAYS = 14` in `offlineIdentity.js`.
- A staff member disabled while a phone is offline can keep selling until it reconnects; their sales are then refused ("needs attention"). The database remains the authority.
- Sales from the queue skip the server's stock pre-check (the sale already happened). Negative stock shows up for the owner to fix; DB rules still apply.

## Verified / not verified
Verified: `node schema/tests/offline_js_checks.mjs` (60 checks: queue, retry, idempotency, ordering, shifts, auth expiry, caches) — **on an in-memory stand-in for Dexie**, because Dexie could not be downloaded here; and `node src/offline/tests/service_worker_browser_check.mjs` in real Chromium (app + deep route + lazy chunk open with the server gone). All existing JS check suites still pass.
**Not verified:** real Dexie/IndexedDB (re-run with `--real` after `npm i dexie fake-indexeddb`); the React screens in a browser (no package.json/build in the upload); live Supabase. To confirm on staging: inserting `lb_cashier_shifts` with a client-supplied `id`; that `lb_sales` accepts a past `completed_at`; and what the DB does with a sale that makes stock negative.
Barcode scan offline uses the product's main barcode only (carton/pack barcodes need internet). Logos hosted on another site may not show offline.

## Field-test fixes (2026-10-18)
- Owner was shown "You do not have access" on Sell: the owner now always sees every page (sign-in record says owner), even if the permission list is empty or could not load. The database still decides every save.
- Demo and real business customers appeared mixed offline: the saved copy now belongs to one business and is emptied when another business (or nobody) signs in; a copy left by the earlier version is emptied once. After updating, open the app online once so the lists are saved again.
