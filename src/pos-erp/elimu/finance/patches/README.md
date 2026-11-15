# Optional patches to POS files (NOT applied)

The brief forbids modifying the POS. Two integration points would need a small opt-in change to POS files. They are written here as
proposals so the owner of the POS can apply them deliberately. **Nothing in `elimu/` depends on them.**

## 1. Daraja STK Push for fee payments (`01_stk_push_for_fees.md`)
The existing `mpesa-stk-push` function only accepts a POS cart or a rent invoice, and `confirm_mpesa_payment()` turns a successful push into a
POS *sale* (with stock movements). A fee payment must not do that. Until this patch is applied, school M-Pesa works through
(a) the Paybill/C2B inbox (customers pay Paybill with the admission number as account) and (b) manual code entry.

## 2. Syncing drafts through the POS outbox (`02_outbox_handler.md`)
`HANDLERS` in `offline/syncEngine.js` is module-private. Elimu drafts therefore use the existing local DB's `meta` store and are submitted by
the cashier (never auto-synced). The patch would let the outbox submit them. It is optional and changes no money rule: the server still decides.
