# Elimu procurement — phase 1

This module reuses the host POS procurement schema and service layer rather than inventing a second supplier / stock ledger:

- `lb_suppliers` — supplier directory and outstanding balances
- `lb_purchase_orders` / `lb_purchase_order_items` — draft and approval workflow
- `lb_goods_received_notes` / `lb_grn_items` — delivery records
- `lb_stock_movements` and the host receiving service — inventory updates

## Included in this phase

- Supplier directory with active status, contacts, terms and outstanding balance
- Supplier creation
- Purchase order creation for one stock item per order in this first UI pass
- Draft submission to `PENDING_APPROVAL`
- Partial goods receiving against approved / partially received purchase orders
- Supplier invoice reference and receiving notes on a GRN
- Credit or paid-in-full receiving choice; the host service handles supplier-balance posting and stock movements

## Integration and security requirements

- The Elimu route is `/elimu/procurement` and is guarded by the Elimu `finance.view` action.
- The module obtains `tenant_id`, `business_id` and staff identity from the existing POS auth context.
- Database RLS and the host POS procurement functions remain authoritative. Elimu's page guard does not replace those policies.
- The uploaded project does not include the authoritative base SQL migrations or a live Supabase instance. Confirm that the target database has the documented POS supplier / purchase / GRN tables, enums, triggers, stock functions, and RLS before enabling this page in production.
- School-specific procurement roles and school-ledger posting are not added in this phase. A later migration should grant Elimu procurement permissions and post approved supplier liabilities / payments to the Elimu general ledger idempotently.

## Next work

Add multi-line purchase orders, approval/decline UI, GRN correction/return flows, supplier payments and statements, supplier returns, procurement reports, and explicit school-ledger journal integration. Do not represent a draft PO as an approved commitment.
