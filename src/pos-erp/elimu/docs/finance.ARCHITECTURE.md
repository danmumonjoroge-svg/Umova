# Elimu finance - architecture

## 1. What the POS already had (inspected before writing code)
| Area | Finding in the uploaded `pos-erp` | What Elimu does |
|---|---|---|
| Auth / staff | `pos_staff`, `pos_tenants`, JWT claims `pos_tenant_id`, `pos_staff_id`; `is_pos_session()`, `is_pos_owner()` | Reused as-is. No second auth/staff. |
| Tenant | every row has `tenant_id`; a "business" (`lb_businesses`) is the unit | A **school = one `lb_businesses` row**. Every Elimu table carries `tenant_id` + `business_id`. |
| Permissions | 24 fixed keys in `pos_all_permissions()`; role templates (owner, manager, cashier, storekeeper, accountant, hr_officer) + per-staff overrides; `pos_has_permission()` | Reused. `elimu_fin_can(action)` maps finance actions to existing keys in ONE function (we could not add keys without editing POS). |
| RLS convention | RLS on, tenant SELECT policy, **no write grants**, writes via SECURITY DEFINER RPCs (e.g. `lb_loans`, `lb_mpesa_c2b_payments`) | Followed exactly, plus a RESTRICTIVE permission policy per table. |
| General ledger / chart of accounts | **None.** (grep: no journal, GL or chart-of-accounts anywhere.) | Not invented. Balanced **journal outbox** + configurable account mappings (E007). |
| Doc numbers | `next_doc_number(business, prefix)` yearly counters | Reused: `SFI` invoices, `SFR` receipts. |
| Payments | POS `lb_payments` belongs to sales | Not reused for fees (a fee is not a sale). Elimu has its own payment rows but **reads** `lb_payments`/`lb_mpesa_transactions` to refuse codes already used there. |
| M-Pesa | Daraja STK (`mpesa-stk-push`, `confirm_mpesa_payment`), manual code entry, **C2B Paybill inbox** `lb_mpesa_c2b_payments` | Inbox reused (consumed through its documented contract). **STK not usable for fees without editing POS** - see patches/01. |
| Expenses | `lb_expenses`, `lb_expense_categories`, `record_expense()` | Reused; Elimu adds supplier/department/approver/document in `elimu_fin_expense_meta`. |
| Budgets | `lb_budgets` = month/quarter/year by *business* with revenue by product class | Not a fit for year/term/department; separate small `elimu_fin_budgets`. |
| Cashier shifts | `lb_cashier_shifts` computes expected cash from **sales** | Fee cash is not a sale -> `elimu_fin_cashier_sessions` (same `pos_staff` identity). |
| Audit | `pos_audit_log` | Reused for every action (previous/new/reason/approval in `metadata`). |
| Communication | shared engine: purposes, templates, render, SMS segments, WhatsApp/email formatting, honest statuses, `comm-send`, `lb_communication_log` | Reused. The engine's purpose loaders only know POS purposes, so Elimu composes with the engine's renderer and writes the same log table (`message_type='OTHER'`, `purpose='ELIMU_*'`). |
| Offline | Dexie `umova_offline`: `outbox` (private `HANDLERS`), `meta`, `readThrough` snapshots | Reused: snapshots for viewing; drafts in `meta`. Outbox not used (needs a POS edit - patches/02). |
| PDF / print | `utils/reportPdf.js` (jsPDF, report-as-data), `printDocument`, `businessHeaderHtml` | Reused: receipts/statements/reports are built as report data. **No .xlsx library exists -> CSV export.** |

## 2. The student/class/term dependency (AI 1 not delivered)
Finance cannot FK to tables that do not exist. It keeps two small **bridge snapshots**, filled by AI 1 through RPCs:
`elimu_fin_students` (id, admission no, name, class/stream, boarding, category, sibling rank, primary guardian contact, status) and `elimu_fin_periods`
(academic year, term, dates, due date). Every invoice/payment also copies the admission number, name and class **at that moment**, so history survives a class
change or a student leaving. If AI 1 uses other names, only these two tables and two RPCs change (INTEGRATION.md section 3).

## 3. Money model
* `numeric(15,2)` in Postgres, **integer cents** in JavaScript, `"123.45"` strings across the wire. No floats anywhere (JS `toCents` rejects >2 decimals, NaN, exponent notation).
* **Ledger** `elimu_fin_ledger`: append-only (trigger), signed: `+` = student owes more, `-` = owes less. `balance_after` is computed under a row lock on the account.
  `elimu_fin_accounts.balance` is a cache; `elimu_fin_verify_account()` and the test suite assert `cache = SUM(ledger)`.
* **Invoices** are the unit of receivable. Opening balances are invoices too (kind `OPENING_BALANCE`), so allocation works the same everywhere.
  Lines are append-only; an amendment ADDS lines (or a cancelling line) and writes a revision with previous/new/reason. Cancel = credit note, never delete.
* **Allocation** `elimu_fin_allocations`: a source (a confirmed payment, or an applied adjustment) matched to an invoice. Append-only; "undo" sets `released_at`.
  Identity checked by tests: `balance = SUM(open invoice outstanding) - free credit`.
* **Credit**: money held beyond what is owed. Shown as available credit, kept as a liability in the journal, refundable only if it came from confirmed *payments*
  (a bursary/scholarship credit is not cash and cannot be refunded to a parent).
* **Duplicate billing**: partial unique index `(business, student, period, structure) WHERE active` on `elimu_fin_invoice_structures`; cancelling frees it.

## 4. Payment state machine
```
CASH          ----------------------------------------------> CONFIRMED (receipt, ledger, allocation)
MPESA code in Paybill inbox, amount <= reported --------------> CONFIRMED (basis C2B_MATCH; inbox amount_used updated)
MPESA typed code (unprovable) / BANK / CHEQUE / OTHER --> PENDING --approver (not the recorder)--> CONFIRMED (receipt, ledger, allocation)
                                                              \--> FAILED (reason; code may be re-entered)
CONFIRMED --approved reversal--> REVERSED (original kept; allocations released; reversal ledger row; Paybill amount returned)
STK result (service role only, after the optional POS patch) PENDING --> CONFIRMED
```
Settings can relax confirmation for bank/other/manual-M-Pesa, but only an approver's own entry may self-confirm. Cash outside an open session is allowed unless the school requires sessions.

## 5. Allocation policies (`elimu_fin_settings.allocation_policy`)
`OLDEST_FIRST` (default: by due date), `CURRENT_TERM_FIRST` (current period, then oldest), `MANUAL_ONLY` (money waits as credit; staff allocate/release).
Targeted adjustments (a discount for a specific invoice) settle that invoice regardless of policy. New invoices absorb existing credit when `auto_apply_credit`.
Fee-item priority ordering is **not** implemented.

## 6. Accounting (no GL exists)
`elimu_fin_gl_postings` + lines: balanced (CHECK + writer refuses), unique per (event, source) so a flow can never post twice, reversals are separate swapped postings.
Off by default (`gl_enabled`). Accounts are looked up in `elimu_fin_account_mappings` by key (`STUDENT_RECEIVABLES`, `FEE_INCOME`/`DEFERRED_INCOME` per `accounting_policy`
and per-fee-item override, `DISCOUNT_ALLOWED`, `SCHOLARSHIP_EXPENSE`, `BURSARY_RECEIVABLE`, `STUDENT_CREDIT_LIABILITY`, cash/M-Pesa/bank, per-category expense...).
Unmapped keys leave the posting `UNMAPPED` until mapped; a future GL adapter reads `READY` rows and calls `elimu_fin_gl_mark_posted`.
Pattern: receipt = Dr cash/M-Pesa/bank, Cr student-credit liability; allocation = Dr credit liability, Cr receivables; invoice = Dr receivables (+ discounts), Cr income.
Expense journals post when an expense is marked PAID through Elimu.

## 7. Security layers
1. RLS on every `elimu_fin_*` table: tenant SELECT + RESTRICTIVE `elimu_fin_can('view'|'report')`; **no INSERT/UPDATE/DELETE grant** to `anon`/`authenticated`.
2. Every write is a SECURITY DEFINER function with a pinned `search_path`, checking `elimu_fin_can()` and that `p_business` belongs to the caller's tenant (`_elimu_fin_tenant_of`).
3. Internal helpers (`_elimu_fin_*`) are revoked from API roles (E011 sweeps and fails if any slip through).
4. Triggers make ledger, invoice lines, revisions, payments' money columns, allocations, sessions' figures, journals and follow-ups immutable.
5. Maker-checker in the database (`_elimu_fin_check_maker_checker`).
6. The UI's `can()` only hides buttons; it is documented as a convenience.

## 8. Role mapping (existing templates -> school roles)
| School role | POS setup |
|---|---|
| School owner / Administrator | owner (administrators: `manager` template + `settings.manage` override) - fee structures, mappings, settings |
| Principal / Bursar | `manager` template - bills, approves adjustments/reversals/refunds/plans, confirms payments, approves sessions |
| Accountant | `accountant` template - reports, reconcile, record expenses (cannot approve) |
| Cashier | `cashier` template - collects, requests adjustments/reversals, sees balances |
| Auditor | `accountant` template with `payments.record` and `expenses.record` revoked via the existing override table, plus `audit.view` - read-only |
Segregation: the person who records cannot confirm/approve the same item (owners excepted only if the school switches `allow_self_approval` on).
