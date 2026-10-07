# Phase 2 — Customer Folio foundation

## Decisions taken (your "go with your best option")
1. **Invoice** is rendered from the folio. `settle_folio` allocates `INV-` and `RCT-` numbers via `next_doc_number` (the existing `lb_doc_counters`). No `lb_invoices` table; `lb_receipts` untouched.
2. **Folio debt** is NOT added to `lb_customers.outstanding_balance`. A folio-charged sale has no payment row, so the CREDIT trigger never fires and nothing is double counted. The balance sheet adds open folio balances to receivables instead.
3. **Revenue:** POS charges count as revenue through `lb_sales` as before. Folio lines that are not sales (room nights, manual charges, discounts) are added to the income statement as "Guest folio charges". Sale-derived lines are excluded there, so nothing is counted twice.
4. **Capability `folios` is opt-in.** Businesses that never chose a menu, and every business that did, see exactly what they saw before.

## What was built
| Area | Files |
|---|---|
| DB | `schema/phase19_folios.sql` (lb_folios, lb_folio_lines, lb_folio_payments, view lb_folio_summary, `lb_sales.folio_id/stay_id`, 6 RPCs, RLS, client writes revoked) |
| Service | `services/folioService.js` |
| POS | `saleService.js` (folio_id: no payments allowed, posts lines, voids the sale if posting fails, idempotent on offline retry), `POSPage.jsx` ("Pay now / Charge to folio"), receipt wording |
| UI | `pages/FoliosPage.jsx` (list, bill, add charge, discount, settle, print), People workspace card, route `/pos/folios` |
| Documents | `utils/folioDocument.js` (invoice and receipt from one folio, grouped Room / Items / Services / Activities) |
| Capabilities | `navConfig.js` (`optIn`, `DEFAULT_CAPABILITY_KEYS`, `visibleChildren`), `CapabilitiesContext.jsx` |
| Offline | `offline/db.js` v2 (`folios_cache`, read only), offline guard for folio sales |
| Reports | `financialReportsService.js`, `FinancialReportsPage.jsx` |
| Tests | `schema/tests/phase19_scenarios.py` + `phase19_stubs.sql` |

## Verified
- 24 SQL checks on a scratch Postgres: the John Kamau bill (Room 8,000 + Breakfast 800 + Dinner 1,800 + Drinks 900 + Swimming 500 + Football 300 = 12,300), settle with M-Pesa, one INV and one RCT number, folio SETTLED, balance 0; idempotent re-posting; underpay / CREDIT / wrong-customer / double-settle rejected; clients cannot write the tables directly; another tenant cannot read, charge, settle, or open a folio for your customer.
- 11 JS checks: bill grouping, invoice/receipt content and escaping, retailer sees no folio entries and an unchanged menu.
- The whole app bundles with no unresolved imports or missing exports.

## NOT verified (be aware before shipping)
- Not run against your live Supabase or a real phone. The SQL assumes columns listed in `DEPLOYMENT_NOTES.md`.
- The POS "Charge to folio" flow and FoliosPage were syntax/bundle-checked, not clicked through in a browser.
- `saleService.create` is still several client calls (pre-existing). If the folio step fails the sale is voided, but a network drop at exactly that moment could leave a sale needing review (logged to console).

## Known gaps (deliberately left for later phases)
- **Till reconciliation:** folio settlements are not in a cashier shift's expected cash yet (`shift_id` is stored, UI passes none).
- **Customer profile / statement** do not show folios yet (brief §26). The Folios page lists them per customer.
- **Settling offline** is not allowed (adding charges and settling need a connection). Charging a sale to an existing folio works offline and shows "Saved locally" until synced; the folio is never shown as settled before the server confirms.
- Settlement is one payment method per folio in the UI (the RPC accepts several).
- `lb_folios.stay_id` has no FK until Phase 3 (`lb_stays`).
- Open question still pending from Phase 1: `lb_stock_movements` vs `lb_inventory_movements`. Not touched here; must be settled before Production.
