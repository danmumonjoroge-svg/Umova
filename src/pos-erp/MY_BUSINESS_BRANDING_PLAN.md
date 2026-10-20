# My Business — Branding, Owner Control, Permissions, HR & Safeguards
Audit (Phase 1) and staged plan. Priority 1 done. Priority 2 and 3 built and tested on scratch only (not deployed, partly enforced). Priorities 4-6 NOT started.

## Status key
DONE+VERIFIED = implemented and tested here · INTERIM = works but is not a real control · MISSING · UNVERIFIABLE = not in the supplied zip

## 1. Audit findings

| Area | State | Notes |
|---|---|---|
| Logo/name/address/phone per business on receipts, invoices, folio documents, sidebar | DONE (already) | Read from `lb_businesses` per tenant |
| Customer / supplier statement headers | WAS MISSING -> DONE+VERIFIED (JS checks) | Now use shared escaped header |
| Logo upload | WAS BROKEN -> DONE+VERIFIED (JS checks) | Old handler put a URL in form state and never saved `logo_url` |
| Logo validation | DONE+VERIFIED (JS) | Magic-byte sniff, 3 MB in, 64-6000 px, canvas re-encode, max 512 px out, SVG/GIF refused, https-only URL on render |
| Storage isolation by tenant folder | PRESENT (phase15 policies) | Not re-tested against live Supabase |
| Storage size/type limits server-side | NEW migration `phase27` — tested on scratch only, NOT deployed | |
| Stale logo in sidebar after switching business | FIXED | |
| "POS" wording -> "My Business" | DONE | SACCO app not renamed |
| Android launcher icon | Not touched (separate SACCO project) | Stays on product branding |
| Role stored on staff | `pos_staff.role` is **text only** | No permissions table, no enforcement |
| Role enforcement in DB | **MISSING** | Any signed-in staff can call most RPCs/tables for their tenant |
| Role enforcement in UI | **INTERIM** | Settings identity/capabilities fields disabled for non owner/manager/admin. A UI gate is bypassable and is not security |
| `utils/permissions.js can()` | Fails open | Must be replaced in Priority 2 |
| Self-promotion guard | MISSING | Cannot verify live `pos_staff` UPDATE policy |
| Sale void | **UNSAFE** | `saleService.voidSale` is client-side, non-atomic, no double-void guard, no permission check, does not reverse cash/customer balance/accounting |
| Audit log | PARTIAL | `auditService` exists; live `pos_audit_log` RLS unverifiable |
| Cashier reconciliation | PARTIAL | `close_cashier_shift` not in zip; folio cash not in cash-up |
| HR / payroll | MISSING | |
| Backups | Not a code feature; rely on Supabase backups |

## 2. Honest limits
Not verifiable here: live Supabase RLS for `pos_staff`, `pos_audit_log`, `lb_pos_settings`; core `lb_*` tables; `close_cashier_shift`; `lb_refunds`; real browser rendering of the logo card; real bundle build; Android.
To check the key one yourself:
`select polname, polcmd, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid) from pg_policy where polrelid in ('pos_staff'::regclass,'pos_audit_log'::regclass,'lb_pos_settings'::regclass);`

## 3. Plan (one stage at a time, each ends with a report and a stop)
**P2 Owner settings + secure permissions.** DB helper reading `pos_staff_id` from the JWT; `pos_permissions` (role defaults + per-staff overrides, page and action level); roles owner/manager/cashier/storekeeper/accountant/hr_officer; permission checks inside SECURITY DEFINER RPCs and RLS; trigger blocking role/permission self-change and last-owner removal; staff management UI; replace fail-open `can()`; every change audited. Tests: cross-role and cross-tenant denial on scratch Postgres.
**P3 Reversals + audit trail.** Atomic `reverse_sale` RPC (permission, reason, approval above a threshold, single-reversal guard, stock + cash + customer balance + accounting effects, M-Pesa refunds tracked as pending/manual). Replace client `voidSale`. Append-only audit rows.
**P4 Cashier reconciliation.** Cash + M-Pesa expected vs counted, folio cash included, variance with reason, manager sign-off.
**P5 HR foundation (optional capability).** Employees, attendance/leave, payroll runs. Kenyan statutory rates (PAYE bands, personal relief, NSSF tiers, SHIF, Housing Levy) must be checked against current official sources and stored date-effective before any figure is used; no legal-compliance claim.
**P6 Reporting.** Read-only views (security invoker).
Hardening of older SECURITY DEFINER functions (tenant check, REVOKE from public) runs alongside P2.

## 4. Decisions needed from you
1. "Powered by Umova" line on receipts — not added.
2. Brand colours per business — not implemented.
3. SVG logos — refused (script risk); say if you want sanitised SVG.
4. Statement printing after an async fetch may hit popup blockers on some browsers.

## 5. Priority 2 status (reworked after reading the live database)
The live database already had a permission system, so phase 28 was rewritten to add only: token helpers, `pos_my_access()`, `settings.manage` on `lb_businesses`, logo-upload policy. Verified on scratch Postgres against copies of the live functions (37 checks): manager/cashier cannot change branding, owner can, owner can grant/revoke through the existing function, other tenant untouched, existing functions unchanged. Sales/expenses/products/stock/payments/purchases/settings tables were already protected by your live triggers; the Staff page now uses your existing owner-only staff functions (add, role, per-permission, on/off, reset password).
Live finding: `pos_guard_sale_update` is not attached to `lb_sales`; phase 29 closes direct voids. STILL OPEN: live Supabase and browser not tested; page guards cover navigation routes only.

## 6. Priority 3 status
DONE+VERIFIED on scratch Postgres (65 checks, permissions remapped to refunds.request / refunds.approve): request/approve/refuse/cancel, atomic reversal (sale, stock, credit balance, payments), no double reversal, folio sales refused, cashiers limited to own sales < 24h, self-approval flagged, direct VOIDED/delete/payment edits blocked for staff, tenant isolation, audit rows, failed reversal rolls back whole.
STILL OPEN / UNVERIFIED: live behaviour of lb_payments.status, process_credit_sale_payment, perform_daily_closing (see DEPLOYMENT_NOTES section 9); partial refunds (lb_refunds); M-Pesa/card payout is manual (warned); approval threshold by amount not built (any approver can approve).

## 7. Priorities 4-6 status
4 Cashier reconciliation: built (phase30, ReconciliationPage). 5 HR foundation: built (phase31, HrPage, PayrollPage); rates need owner confirmation. 6 Reporting: built (phase32, ControlReportPage). None deployed.
