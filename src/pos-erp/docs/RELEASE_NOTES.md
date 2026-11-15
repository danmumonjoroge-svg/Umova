# Notes for this release: classes, printable reports, M-Pesa received payments, roles, budgets

## 1. Run order (Supabase SQL editor, staging first)
Needs phase28 (permissions), phase19 (folios), phase17 (rent invoices), phase12 (M-Pesa) and phase39 already applied.
1. `schema/phase42_product_classes.sql`
2. `schema/phase43_mpesa_c2b_inbox.sql`
3. `schema/phase44_budgets.sql`

Each file can be run twice safely. Then, once, for your own business, uncomment the block at the end of phase42 (set up the
classes and place items), or just open **My Items -> Classes** and use the ready-made set.

## 2. Edge Functions
- `supabase functions deploy c2b-hook --no-verify-jwt`   (Safaricom calls it; the secret token in the URL is the protection)
- `supabase functions deploy c2b-register`
Then: My Money -> M-Pesa -> Received payments -> **Turn on received payments** (owner or manager).
The app needs the `jspdf` package (`npm i jspdf`) if it is not already installed.

## 3. What was added
| Request | Where |
|---|---|
| Printable PDF reports (stock, low stock, sales, sales by class, items sold, spending, M-Pesa, who owes me) | My Money -> Printable Reports. Download, print or share; same data as the screen |
| Class of every item/service, with SQL and a report per class | phase42; My Items -> Classes and a Class box on each item; "Sales by class" report |
| M-Pesa to the system: Joy pays 3,000, cashier sees amount, code, name, clears bill, bill turns Paid | My Money -> M-Pesa -> Received payments (suggests bills, "Clear bill"); till shows received payments to tap |
| User roles / only authorised screens | Every route now has a guard (table below); `tests/routeGuards.test.js` fails if one is missed. The database still refuses the action |
| Target / budget page: budget, actual, variance | My Money -> Targets & Budget (sales target per class, spending budget per category, copy last month, PDF) |

## 4. How a received payment is matched
Safaricom sends payments to `c2b-hook`. They are stored once per M-Pesa code (a repeat is ignored). The cashier opens the payment;
the system suggests bills by exact amount, name and bill number, and the cashier taps **Clear bill**. A folio that is fully paid becomes
SETTLED (invoice and receipt numbers are shown); a part payment leaves it open with the balance. A code can never be used twice, including
when someone types the same code by hand elsewhere. Safaricom now hides phone numbers, so matching is by name, amount and code, never phone.

## 5. Not verified, please check on staging
- All SQL ran on a scratch Postgres with stand-ins for your existing tables: **108 scenarios, 0 failures** (Joy case, part and split payments,
  rent invoices, role matrix, tenant isolation, budget maths). Real tables may differ: each phase header lists what it assumes.
- The React screens were syntax-checked and their imports and function names cross-checked, but **not run** (no build or bundler in the zip).
- The two Edge Functions were **not tested against live Daraja**. On production a shortcode can usually register its URLs once.
- Reading screens is hidden by the UI; the database enforces writes and the new reports/inbox/budget reads. Older read-only tables keep your existing policies.
- A cashier (payments.record) now sees My Money so they can clear M-Pesa payments; the other money pages stay closed to them.
- Items saved while offline may not carry the new class until the offline queue accepts the `class_id` field.
- `utils/permissions.js` in the zip is out of date compared with your live copy; it was not changed.

## 6. Who can open which screen (default role templates from phase28)
| Screen | Owner | Manager | Cashier | Storekeeper | Accountant | HR officer |
|---|---|---|---|---|---|---|
| Home (dashboard) | Yes | Yes | Yes | Yes | Yes | Yes |
| /pos/ | Yes | Yes | Yes | - | - | - |
| /pos/report-centre | Yes | Yes | - | Yes | Yes | - |
| /pos/budgets | Yes | Yes | - | - | Yes | - |
| /pos/equipment | Yes | Yes | - | - | Yes | - |
| /pos/room-list | Yes | Yes | Yes | - | - | - |
| /pos/stays | Yes | Yes | Yes | - | - | - |
| /pos/production-runs | Yes | Yes | Yes | - | - | - |
| /pos/recipes | Yes | Yes | Yes | - | - | - |
| /pos/units | Yes | Yes | Yes | - | - | - |
| /pos/charges | Yes | Yes | Yes | - | - | - |
| /pos/meters | Yes | Yes | Yes | - | - | - |
| /pos/invoices | Yes | Yes | Yes | - | - | - |
| /pos/maintenance | Yes | Yes | Yes | - | - | - |
| /pos/services | Yes | Yes | Yes | - | - | - |
| /pos/activities | Yes | Yes | Yes | - | - | - |
| /pos/packages | Yes | Yes | Yes | - | - | - |
| /pos/appointments | Yes | Yes | Yes | - | - | - |
| /pos/efficiency | Yes | Yes | - | - | Yes | - |
| /pos/communication | Yes | Yes | Yes | - | Yes | - |
| /pos/messages | Yes | Yes | Yes | - | Yes | - |
| /pos/retail | Yes | Yes | Yes | Yes | Yes | - |
| /pos/network | Yes | Yes | Yes | Yes | Yes | - |
| /pos/money | Yes | Yes | Yes | - | Yes | - |
| /pos/people | Yes | Yes | Yes | - | Yes | - |
| /pos/comms | Yes | Yes | Yes | - | Yes | - |
| /pos/rentals | Yes | Yes | Yes | - | - | - |
| /pos/salon | Yes | Yes | Yes | - | - | - |
| /pos/rooms | Yes | Yes | Yes | - | - | - |
| /pos/production | Yes | Yes | Yes | - | - | - |
| /pos/products | Yes | Yes | Yes | Yes | Yes | - |
| /pos/inventory | Yes | Yes | Yes | Yes | Yes | - |
| /pos/goods-receiving | Yes | Yes | Yes | Yes | Yes | - |
| /pos/purchase-orders | Yes | Yes | Yes | Yes | Yes | - |
| /pos/suppliers | Yes | Yes | Yes | Yes | Yes | - |
| /pos/payables | Yes | Yes | Yes | Yes | Yes | - |
| /pos/cash | Yes | Yes | - | - | Yes | - |
| /pos/mpesa | Yes | Yes | Yes | - | Yes | - |
| /pos/expenses | Yes | Yes | - | - | Yes | - |
| /pos/loans | Yes | Yes | - | - | Yes | - |
| /pos/reports | Yes | Yes | - | - | Yes | - |
| /pos/financials | Yes | Yes | - | - | Yes | - |
| /pos/customers | Yes | Yes | Yes | - | Yes | - |
| /pos/folios | Yes | Yes | Yes | - | Yes | - |
| /pos/reversals | Yes | Yes | Yes | - | - | - |
| /pos/network/find | Yes | Yes | - | Yes | Yes | - |
| /pos/network/orders | Yes | Yes | Yes | Yes | Yes | - |
| /pos/network/suppliers | Yes | Yes | Yes | Yes | Yes | - |
| /pos/network/offers | Yes | Yes | - | - | - | - |
| /pos/settings | Yes | - | - | - | - | - |
| /pos/audit | Yes | Yes | - | - | - | - |
| /pos/staff | Yes | - | - | - | - | - |
| /pos/reconcile | Yes | Yes | - | - | Yes | - |
| /pos/hr | Yes | - | - | - | - | Yes |
| /pos/payroll | Yes | - | - | - | - | - |
| /pos/control | Yes | Yes | - | - | - | - |
