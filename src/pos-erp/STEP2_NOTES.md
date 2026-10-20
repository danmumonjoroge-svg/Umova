# Step 2 — Owner control: staff roles, permissions, Staff & Permissions screen

## What it does
- **Roles:** Owner, Manager, Cashier, Storekeeper, Accountant, HR officer as least-privilege starting points. The owner can then tick/untick any of 24 permissions per person.
- **Staff screen** (More → Staff & Permissions, owner only): add staff (temporary password shown once, must be changed at first sign-in), change role, per-person permissions, reset password, disable/enable (disabling signs them out).
- **Database enforcement** (`schema/phase28_permissions.sql`, NOT yet run on any real database):
  - Staff, roles and permissions can be changed **only** through owner-only RPCs. A trigger blocks direct edits: nobody can promote themselves, add or delete staff rows, or change their own role/status/login link.
  - Triggers on `lb_expenses`, `lb_customer_payments`, `lb_supplier_payments`, `lb_purchase_orders`, `lb_products`, `lb_pos_settings`, `lb_sales` (insert) and `lb_sale_items` (discounts). Triggers fire **inside** SECURITY DEFINER functions, so RPC-based writes (e.g. record_expense) are covered without editing function bodies I cannot see.
  - Audit log can be read only with `audit.view` (everyone can still write to it).
  - Logo/business-identity guard from phase27 now uses `settings.manage` instead of "owner only".
  - Sessions without a `pos_staff_id` claim (main Umova app, service-role edge functions such as the M-Pesa callback, cron) are not checked.
- **App:** fail-closed `can()`; `usePosErpAuth().can(key)`; route guard on every `/pos/*` page (`ROUTE_PERMISSIONS`); menu and mobile tabs hide what you cannot open; profit/spend tiles need `finance.view`; discount box needs `sales.discount`; business settings and logo need `settings.manage`.

## Behaviour changes for existing staff (expect these)
- Existing managers: default manager template. They can no longer change business details/logo/settings, or see Staff & Permissions, unless the owner grants `settings.manage`.
- Existing cashiers: lose Items, Suppliers, Reports, Financial pages, profit tiles and discounts. They keep the till, customers, payments, scanner, and operations modules.
- `payroll.access` is owner-only by default; no template has it.
- Permission changes reach an open session within ~2 minutes (the existing revalidation timer) or on window focus. The database applies them immediately.

## Verified
- `node --test tests/*.test.mjs`: 19/19 (includes a test that parses the SQL and fails if the JS and SQL permission tables ever differ).
- Whole tree parses with esbuild; `phase20_js_checks.mjs` 62/62.
- Scratch PostgreSQL 16: `phase27_scenarios.sql` 20/20; `phase28_scenarios.sql` 101/101, re-runs cleanly. Covers: every role's defaults; cashier/manager self-escalation attempts; cross-tenant attempts; suspended tenant; disabled staff; override grant/revoke; staff creation, duplicate names, weak passwords; session removal on disable; password reset; table triggers including through a definer RPC; audit-log read restriction.
- Negative control: with the triggers and staff guard removed, the cashier **can** promote itself to owner and the other attack tests fail.
- A real bug found by testing: `pos_reset_staff_password` reported success when no login record existed. It now returns `LOGIN_RECORD_MISSING`.

## NOT verified / not done
- **No real Supabase.** Staff creation inserts into `auth.users` / `auth.identities` exactly as `register_pos_tenant` does and deletes `auth.sessions` rows; I could only test that against stand-ins. Test creating a staff member and signing in as them on staging first.
- **No browser run or build** of the new screens.
- **Table triggers can be stricter than a real workflow.** On staging, run the till as a cashier, a storekeeper and an accountant, and receive stock, pay a supplier, complete a maintenance request (it creates an expense), and sync an offline sale. Known risks:
  - A sale queued offline whose cashier lost `sales.create` before it synced will be rejected at sync (error 42501). Offline sync was not tested.
  - Completing a maintenance request creates an expense, so it needs `expenses.record`.
- **Not enforced in the database:** reads (sales, profit, costs: UI only; table-level read gating would break the till/receipts), and stock adjustment / stocktake / transfer (one `lb_stock_movements` table serves sales and receiving too). Both need function-level checks; `pos_require('perm')` is provided for one-line use inside RPCs once I can see their bodies.
- **Keys with nothing to protect yet:** `refunds.request/approve` (Step 3), `employees.manage` / `payroll.access` (HR step), `reports.export` (I found no export feature), `payments.approve` (no approval flow yet). "Approval limits" arrive with Step 3.
- **Workspace pages** (Retail, People, Money) still list tiles that link to pages the user may not open; clicking shows "You do not have access". Tidy later.
- Dev bypass `REACT_APP_POS_SKIP_AUTH=true` has no staff, so permission-gated pages deny in that mode. Dev only.
- Managers cannot manage staff; delegation is deliberately not offered yet.
- Changing a person's role clears their custom changes (the screen warns first).
- Storekeeper/accountant/HR officer are stored with coarse `role='cashier'` (the least-privileged existing value) plus `role_template`; old code that checks `isCashier` will see them as cashiers.
