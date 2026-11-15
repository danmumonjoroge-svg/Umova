# Phase 54 — Salon: optional staff, commission to payroll, one place to take payment

## What you asked for → what was built
| Request | Built |
|---|---|
| Customer can pick who serves them, optional | **Appointments → Book**: "Who should serve them? (optional)" — blank = *Any available staff*. Only appears when HR employees exist. Same optional **Served by** picker on any service line on the Sell page (walk-ins). |
| Commission auto-populates HR/Payroll | When a service line with a provider is saved, the database writes the commission (service's commission % × the line's net amount, after discount) to `pos_commissions`. **Payroll → Prepare pay run** pulls every unpaid commission up to month-end into that person's *Allowances*, with a note on the payslip line. New **Payroll → Commission** tab shows earned / waiting / in a run / paid per person. |
| Sales on complete, payment goes to Sell | **Appointments → Complete & Sell** opens Sell with the customer, service and provider loaded. No payment modal on Appointments any more. |
| Folio payment at Sell; one sales point | **Customer Folios → Settle on Sell** opens Sell with the folio's lines and balance. Pay with cash, card, M-Pesa code, **M-Pesa Prompt (STK)** or split. The folio then closes with its invoice and receipt. The settle sheet on the Folios page is removed. |

## Behaviour you should know about
* **Commission is earned when the service is sold (sale saved), not when money arrives.** A service charged to a folio earns it immediately. If you want it on payment, change `_lb_sale_item_service_hooks`.
* The provider is an **HR employee** (`pos_hr_employees`), because that is who payroll pays — a stylist needs no login. Add stylists under HR first.
* Commission is added as an **allowance**, so PAYE/NSSF/SHIF/housing apply to it like other pay. A commission-only stylist (basic 0) is included in the run.
* **Reversed sale:** unpaid commission is voided; if it was already in a run, a negative row (clawback) is added and netted in the next run. A negative balance carries forward, never below zero.
* Cancelling a draft/approved run frees its commission; marking a run paid marks it PAID.
* A booking is marked **COMPLETED by the database** when its sale item is saved, so it also works for offline-synced sales and M-Pesa prompt sales.
* Folio by prompt needs a **whole-shilling balance** (STK limitation); otherwise use the M-Pesa code. A prompt that arrives but cannot be applied (balance changed, already settled) is parked as *Needs attention*, never lost.
* Folio settlement needs internet. Credit is not offered for a folio (`settle_folio` refuses it).
* Settling from Sell needs the Sell permission (`sales.create`) and an open shift.

## Deploy order
1. Run `schema/phase54_salon_commission_checkout.sql` (needs phases 6, 19, 28, 31, 39). Re-runnable. It **replaces** `pos_payroll_create_run`, `pos_payroll_cancel`, `pos_payroll_mark_paid` and `confirm_mpesa_payment` (copied from phase31/phase39 with the additions — diff them if you have changed those since).
2. Redeploy the Edge Function `mpesa-stk-push` (folio target added).
3. Deploy the app files below.

## Files
New: `schema/phase54_salon_commission_checkout.sql`, `schema/tests/phase54_stubs.sql`, `schema/tests/phase54_scenarios.sql`
Changed: `services/salonService.js`, `hooks/useSalon.js`, `pages/AppointmentsPage.jsx`, `pages/POSPage.jsx`, `pages/FoliosPage.jsx`, `pages/PayrollPage.jsx`, `services/saleService.js`, `services/mpesaService.js`, `hooks/useMpesaPayment.js`, `services/hrService.js`, `supabase/functions/mpesa-stk-push/index.ts`

## Verified / not verified
* **Verified:** the SQL ran on a throwaway PostgreSQL 16 with stubbed earlier phases (`schema/tests/phase54_scenarios.sql`): commission accrual, booking completion, payroll pull (incl. commission-only employee), cancel → release, paid, reversal clawback, void of unpaid, folio settle via the M-Pesa callback, and the "balance changed → Needs attention" path. All JS/JSX files parse (esbuild).
* **Not verified:** the app was not built or run (no package.json in the zip), the Edge Function was not run (no Deno/Daraja), and nothing ran against your real database. The cart-sale branch of `confirm_mpesa_payment` (provider/booking columns on prompt-paid sales) was created but not executed. Please test on staging: book with a provider → Complete & Sell → pay by cash and by Prompt → prepare a pay run; settle a folio by cash and by Prompt.
