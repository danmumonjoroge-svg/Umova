# Elimu finance - integration contracts

Names below are THIS module's. Other agents do not have to use them: the only coupling points are the two bridge tables and the RPCs in sections 3 and 6.
All RPCs are `public.elimu_fin_*`, callable by `authenticated`, permission-checked in the database. Money arguments are `numeric` (send `"123.45"` strings).

## 1. Tables created (31) and functions (64 public RPCs, 38 internal helpers closed to API roles)
Config: `elimu_fin_settings`, `elimu_fin_periods`*, `elimu_fin_students`*, `elimu_fin_fee_items`, `elimu_fin_fee_structures`, `elimu_fin_fee_structure_items`, `elimu_fin_discount_rules`
(*bridge, section 3). Ledger/billing: `elimu_fin_accounts`, `elimu_fin_ledger`, `elimu_fin_invoices`, `elimu_fin_invoice_lines`, `elimu_fin_invoice_structures`, `elimu_fin_invoice_revisions`.
Payments: `elimu_fin_payments`, `elimu_fin_allocations`. Adjustments/corrections: `elimu_fin_awards`, `elimu_fin_adjustments`, `elimu_fin_corrections`.
Plans: `elimu_fin_payment_plans`, `elimu_fin_plan_invoices`, `elimu_fin_installments`, `elimu_fin_followups`.
Operations: `elimu_fin_cashier_sessions`, `elimu_fin_expense_meta`, `elimu_fin_budgets`, `elimu_fin_budget_lines`, `elimu_fin_reconciliations`.
Accounting: `elimu_fin_account_mappings`, `elimu_fin_gl_postings`, `elimu_fin_gl_posting_lines`. Messaging link: `elimu_fin_notifications`.
(Migrations E001-E011.) Deliberately NOT created: payment/receipt/expense/budget-engine/staff/communication/document tables - reused from the POS.

## 2. Existing tables reused
Read/written through their own contracts: `lb_businesses` (school identity, logo, contacts), `pos_staff` (names), `pos_audit_log` (insert), `lb_expenses` + `lb_expense_categories`
(via `record_expense()`; status column updated only by `elimu_fin_set_expense_status`), `lb_mpesa_c2b_payments` (`amount_used`/`status` updated by `_elimu_fin_consume_c2b`/`_return_c2b`,
the same fields `pos_apply_mpesa_c2b` uses), `lb_doc_counters` (through `next_doc_number`), `lb_communication_log` (insert + status updates by the POS engine).
Read-only duplicate checks: `lb_payments.reference_no`, `lb_mpesa_transactions.mpesa_receipt_number`.

## 3. Student foundation Elimu EXPECTS (AI 1)  -  the bridge
AI 1 owns students, guardians, classes, streams, academic years/terms, enrolments. Finance needs this read model, kept current by AI 1 calling:

`elimu_fin_sync_student(p_business uuid, p_student jsonb)` - call on admission, class/stream change, boarding change, guardian change, leaving. Requires `bill` or `configure`.
```
{ student_id (AI1 students.id, required), enrollment_id, admission_no (required, unique per school), full_name (required),
  class_id, class_name, stream_id, stream_name, boarding_status 'DAY'|'BOARDING'|'WEEKLY_BOARDING', student_category (free text),
  sibling_group_id, sibling_rank (1 = first child enrolled), is_staff_child,
  status 'ACTIVE'|'LEFT'|'SUSPENDED'|'GRADUATED',
  guardian_id, guardian_name, guardian_phone, guardian_email, guardian_relationship }       -- the PRIMARY fee-paying guardian
```
`elimu_fin_save_config('elimu_fin_periods', business, {academic_year, term|null, term_no, start_date, end_date, default_due_date, external_year_id, external_term_id, is_current})` for years/terms.
Rules: a student is never deleted from finance; mark `LEFT`. Class change = sync again (old invoices keep their class snapshot; the change is audited).
Guardians: only the primary guardian is held. **A multi-child "parent statement" needs AI 1's guardian-student links and is not built** (documented gap; `sibling_group_id` is the interim grouping).
Later, once AI 1's tables exist, add real foreign keys with a migration of your own (`student_id` -> students.id); nothing here blocks it.

## 4. Financial services reused from the POS
Doc numbering (`next_doc_number`), audit (`pos_audit_log`), permissions (`pos_has_permission`), expense recording (`record_expense`), Paybill inbox (`lb_mpesa_c2b_payments`),
communication (`utils/comm`, `commEngineService`, `lb_communication_log`), offline (`offline/db`, `readThrough`, `netErrors`, `idGenerator`), PDF/print (`reportPdf`, `printDocument`, `businessHeader`).

## 5. Payment APIs exposed
| RPC | Who | Notes |
|---|---|---|
| `elimu_fin_record_payment(business, student, method, amount, date, transaction_ref, bank_account, deposit_slip_ref, payer_name, payer_phone, notes, client_reference, c2b_id)` | collect | all channels; `client_reference` = idempotency key; returns `status` CONFIRMED/PENDING |
| `elimu_fin_confirm_payment(payment, basis, note)` | approve (not the recorder) | basis `MANUAL_ATTESTATION` or `BANK_STATEMENT` |
| `elimu_fin_fail_payment(payment, reason)` | approve | pending only |
| `elimu_fin_c2b_inbox(business, limit)` | collect | unapplied Paybill payments + suggested student by admission no |
| `elimu_fin_allocate(source_type, source, invoice, amount)` / `elimu_fin_release_allocation(alloc, reason)` | approve | manual allocation / undo |
| `elimu_fin_receipt_data(payment)` | view | JSON for receipts (school, student, items paid for, balance) |
| `elimu_fin_request_correction(business, 'PAYMENT_REVERSAL'|'ADJUSTMENT_REVERSAL'|'REFUND', ...)` + `elimu_fin_decide_correction(id, approve, note)` | collect/bill request, approve decides | reversal keeps original; refund limited to credit that came from payments |
| `elimu_fin_confirm_stk_payment(payment, mpesa_code, amount, mpesa_txn)` | **service_role only** | for the optional STK patch (patches/01) |
Adjustments: `elimu_fin_request_adjustment` -> `elimu_fin_decide_adjustment`; `elimu_fin_create_award`/`elimu_fin_apply_award`; `elimu_fin_add_opening_credit`.
Sessions: `elimu_fin_open_session`/`close_session`/`approve_session`/`session_summary`. Reconciliation: `elimu_fin_unreconciled`/`elimu_fin_reconcile`.

## 6. Fee billing APIs exposed
`elimu_fin_matching_structures`, `elimu_fin_preview_bill`, `elimu_fin_bill_student(business, student, period, structure_ids?, due_date?, extra_lines, notes, apply_rules)`,
`elimu_fin_bill_bulk(business, period, class?, stream?, structure_ids?, due_date?, dry_run)`, `elimu_fin_add_opening_balance`, `elimu_fin_amend_invoice(invoice, lines, reason, due_date?)`,
`elimu_fin_cancel_invoice(invoice, reason)`, plans `elimu_fin_create_plan`/`decide_plan`/`cancel_plan`/`plan_status`, `elimu_fin_record_followup`.
Reads (paged, permission-gated): `elimu_fin_student_account`, `elimu_fin_statement`, `elimu_fin_debtors`, `elimu_fin_aging`, `elimu_fin_collections`, `elimu_fin_collections_by_period`,
`elimu_fin_fee_summary`, `elimu_fin_structure_report`, `elimu_fin_student_list`, `elimu_fin_income_expenditure`, `elimu_fin_repeat_overdue`, `elimu_fin_approval_queue`, `elimu_fin_budget_report`.
JS wrappers for all of them: `elimu/finance/services/financeApi.js`.

## 7. Configuration (admin = `settings.manage`)
`elimu_fin_save_config(table, business, row, reason)` for settings, periods, fee items, structures, structure items, discount rules (whitelisted, audited with previous/new/reason).

## 8. Routes / pages added
`elimu/finance/ElimuFinanceRoutes.jsx` exports `elimuFinanceRoutes()` and `ELIMU_FINANCE_NAV`. It is **not** wired in (POS files are off-limits). To mount, two small edits by whoever owns them:
1. `POSApp.jsx`, inside `PosRoutesInner` under the layout route: `import { elimuFinanceRoutes } from '../elimu/finance/ElimuFinanceRoutes'; ... {elimuFinanceRoutes()}`
2. `navigation/navConfig.js`: add the entries from `ELIMU_FINANCE_NAV` to the Money group.
Pages: `/school-finance/collect`, `/account/:studentId`, `/debtors`, `/approvals`, `/fees`, `/reports`. (Adjustment/plan/expense/budget/reconciliation screens are not built - AI4_CONTINUATION.md.)

## 9. Accounting integration
Journal outbox + mappings (ARCHITECTURE.md section 6). AI 5 / a future GL: read `elimu_fin_gl_postings` where `status='READY'` with lines, post, call `elimu_fin_gl_mark_posted(posting, external_ref)`.
Set mappings with `elimu_fin_seed_default_mappings` then `elimu_fin_save_mapping`. `gl_enabled` is off until chosen; nothing posted before it is on is back-filled.

## 10. Communication dependencies
POS comm engine files (`utils/comm`, `supabase/functions/_shared/comm/render.js`), `commEngineService` (status updates, deep links, `comm-send` provider route), table `lb_communication_log`
(must accept `purpose` text and `message_type='OTHER'`; the precheck verifies this). Finance purposes `ELIMU_*` are in `communication/templates/financeTemplates.js`.
School-level template overrides for these purposes via `lb_communication_templates` are **not delivered/untested**; per-message editing is.

## 11. Offline dependencies
`offline/db.js` (`meta`), `offline/readThrough.js`, `offline/idGenerator.js`, `offline/netErrors.js`. Drafts key: `meta['elimu:fee_drafts']` (NOT under `cache:`, so sign-out does not silently drop unsent records - submit before signing out on a shared phone).

## 12. What AI 1 must provide
The section 3 sync calls (and a hook on every class/guardian/status change); real academic years/terms; stable `student_id`; the primary guardian's phone/email; sibling grouping and rank if sibling discounts are wanted; later, guardian-student links for parent statements.

## 13. What AI 2 (exams/report cards) needs to know
Finance does **not** block or withhold anything. If the school wants "fees cleared" gating, read `elimu_fin_student_account(business, student)` -> `outstanding`, `arrears`, `current_balance`
(requires `view`) and apply the school's own policy; do not treat any balance as misconduct. Fee items such as Examination are ordinary fee items. Do not write to any `elimu_fin_*` table.

## 14. What AI 3 (attendance/calendar) needs to know
Terms drive billing: send them as periods (section 3) with `default_due_date`. Instalment dates live in `elimu_fin_installments` (read via `elimu_fin_plan_status`) if the calendar should show them.
Nothing in finance depends on attendance; no fee is auto-charged for absence.

## 15. What AI 5 (dashboard/administration) integrates
Mount routes + nav (section 8); run the precheck and RLS audit; dashboard tiles: `elimu_fin_collections(from,to,'DAY')`, `elimu_fin_aging`, `elimu_fin_fee_summary`, `elimu_fin_approval_queue` (counts),
`elimu_fin_debtors(limit 5)`. Add a settings screen over `elimu_fin_save_config('elimu_fin_settings', ...)` (allocation policy, confirmation rules, due days, receipt text, GL switch, self-approval).
Permissions: assign staff with the existing templates (ARCHITECTURE.md section 8) - no new staff screens.
