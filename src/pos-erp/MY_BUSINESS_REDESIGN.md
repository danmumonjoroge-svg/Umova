# My Business redesign — what changed, and what to check

## 1. M-Pesa at the till (the main fix)
M-Pesa is now a **payment method** on the Sell screen: Cash · M-Pesa · Card · Credit.
Pick M-Pesa and choose how to collect it:

| Option | What happens | Needs internet |
|---|---|---|
| **Send prompt** | Buyer gets an M-Pesa pop-up and enters their PIN. Sale is created only after Safaricom confirms (unchanged `confirm_mpesa_payment`). Waiting screen shows a timer, can be hidden without cancelling, re-opens itself on result, and offers *Send again* / *Buyer paid another way* if it fails. | Yes |
| **Already paid** | Buyer paid your till/paybill. Cashier types the code from the SMS. Saved as a normal sale, works offline, syncs later. | No |

- Prompt is automatically unavailable (with a plain reason) when offline or when M-Pesa isn't set up; the till falls back to "Already paid" and links to setup.
- Same M-Pesa code can't be used on two sales (checked online).
- Prompt amounts must be whole shillings (Safaricom rounds); the till says so instead of creating a mismatch.
- In a **split** sale, an M-Pesa line is recorded by code (a prompt can't cover part of a cart).
- **My Money → M-Pesa** is now the back office only: setup (opens by default until switched on) + the day's records, including a new "Recorded at the till" list. The old "Received" tile summed failed requests too; replaced with real money in.

## 2. Navigation (brief §3–5, 15)
- `navigation/navConfig.js` is the single source for sidebar, bottom bar, More, topbar.
- Sidebar (md+): flat Forest Green list, no expandable groups. Bottom bar (phones): Home, Sell, Money, People, More. Drawer kept as secondary.
- New workspaces: `/pos/retail`, `/money`, `/people`, `/comms`, `/rentals`, `/salon`, `/more`. **Every existing route is unchanged.**
- Topbar: back arrow on phones for child pages; "Retail › My Stock" on desktop.

## 3. Capabilities (brief §10)
Settings → "What does your business do?" (Retail / Rentals / Salon). Stored in the existing `lb_pos_settings.settings` JSON — **no migration**. Until chosen, everything shows. Routes are never removed, only menu entries.

## 4. Offline pill (brief §11)
Online · Offline · Everything is saved · Offline · 3 sales saved · Updating · 3 sales · Online · Up to date · "N sales need attention". No manual switch. Count updates the moment an offline sale is queued.

## 5. Sell screen
Two-step flow on phones (Items → Sale) with sticky checkout bar, 44px+ targets. Payment methods follow Settings. **Catalogue no longer stops at 50 items**: loads up to 500 and searches the server as you type.

## 6. Home
Rebuilt around: what happened today → what needs attention → quick actions → quiet "where things stand" list. Data loading unchanged.

## Not done / know before shipping
- **Not run against a live Supabase or a real phone.** Verified: whole app bundles, lint clean for undefined names, navigation logic + new components render in tests. Not verified: STK against Daraja, realtime, layout on real 360/390/430 px devices.
- Colours are applied to the shell, Home, workspaces, Sell, and M-Pesa/Settings layout. Other pages (Products, Customers, Suppliers, etc.) keep their existing slate/emerald internals; they sit on the new ivory background but were not restyled page by page.
- No **Bank** card in My Money: the app has no bank page/ledger to open.
- Add `viewport-fit=cover` to your `index.html` viewport meta for the bottom bar's safe-area padding to take effect on notched phones.
- Stale `POSDashboard.jsx` next to POSApp.jsx moved to `_archived_dead_code/root/`.
- `POSPreview.js` is still a dev-only no-auth file; delete before shipping.
