# Patch 1 - Daraja STK Push for school fees (proposal, not applied)

Goal: reuse the existing Daraja integration (credentials, OAuth, callback URL, signature checks) - add ONE more purpose beside "cart" and "rent invoice".

## Flow
1. Cashier records a PENDING payment: `elimu_fin_record_payment(... method 'MPESA', transaction_ref NULL ...)` is NOT used for STK (a code is required).
   Instead add `elimu_fin_start_stk(p_business, p_student, p_amount, p_phone)` (not written: needs the final shape of lb_mpesa_transactions on the live DB)
   that inserts a PENDING `elimu_fin_payments` row with `method_detail = 'STK'` and returns its id.
2. `fn-stk/index.ts`: accept `elimu_payment_id` instead of a cart. Skip cart validation. Store the id on the lb_mpesa_transactions row
   (needs a nullable column `elimu_payment_id uuid`).
3. `confirm_mpesa_payment()` success branch: if `elimu_payment_id IS NOT NULL` then
   ```sql
   PERFORM elimu_fin_confirm_stk_payment(v_txn.elimu_payment_id, v_receipt, v_txn.amount, v_txn.id);
   RETURN ...;   -- and do NOT build a sale
   ```
   `elimu_fin_confirm_stk_payment` already exists (E003): service-role only, verifies amount, validates the M-Pesa code, refuses codes already used in the POS,
   is idempotent, and issues the receipt + ledger + allocation.
4. Failure/timeout results leave the elimu payment PENDING; the cashier marks it failed with `elimu_fin_fail_payment`.

## Why it is not applied
It edits `fn-stk`, `confirm_mpesa_payment` and `lb_mpesa_transactions`, which are POS files. Apply on staging, run `schema/tests` and the POS M-Pesa tests, then production.
