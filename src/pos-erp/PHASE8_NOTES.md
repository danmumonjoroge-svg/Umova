# Phase 8 and the leftovers

## One account, one invoice, one receipt
The guest's bill (on screen), invoice and receipt now read as one story, in this order:
**Room** (with "Room 204 - 6 Oct to 8 Oct, 2 nights" under the guest's name), **Food**, **Drinks**, **Items**, **Services**, **Activities**, then **each package as one block** (its price once, its contents listed without separate prices), then other charges and **discounts**, then the total and how it was paid (M-Pesa code included).
- Food and Drinks come from the real category: the product category for things sold at the till (phase25), the category on manual or package lines. A line with no category stays under Items/Services exactly as before, so old bills do not change.
- Section totals always add up to the bill total (checked), every line appears once.
- Paying once settles the whole account; the invoice and the receipt carry their own numbers.

## Leftovers done
- **Customer statement** now lists that customer's bills and stays (open balance or paid total), each opening the bill.
- **Till**: folio payments are now saved with the open till shift. NOTE: the daily cash-up (`close_cashier_shift` in your live database, not in this zip) does not yet add folio cash to expected cash. Until that function is changed, count folio cash separately.
- **Reverse a posted production run** (once, with a reason): materials back into stock at their issue cost, finished goods out. The run stays on record as Reversed and drops out of yield and wastage. Refused if the finished goods have already been sold or used (then use a stock adjustment).

## Run order for the whole upgrade
phase19, 20, 21, 22a (optional, alone), 22, 23, 24, 25, 26 (see DEPLOYMENT_NOTES.md). Then Settings: switch on what the business needs (Rooms & Stays, Services & Activities, Production, Packages, How we are doing). A retailer who switches nothing sees the same menu as before.

## Verified here (scratch Postgres 16, not your live database)
SQL suites: Phase 3 84, Phase 4 9, Phase 5 56 (enum, text, new-label variants), Phase 6 36 (enum and text), Phase 7 22 (hotel and bakery acceptance tests end to end), Phases 8/leftovers 18 (enum and text). JS checks (menu unchanged for retailers, every menu link routed, receipt layout, totals, package block, numbers). Static scan of changed files clean.

## NOT verified / still open
- Nothing run on your live Supabase or in a browser; no real build (npm registry blocked here). Test on a staging project first.
- Cash-up (see above). Cost of goods for package/folio stock is not posted to accounting.
- Offline: bills, packages, production and reversal need a connection; only till sales charged to a folio queue offline. Offline production drafts are not built.
- No room move in the middle of a stay (change the dates/price, or check out and book again). Room income is recognised for all nights at check-in. Time zone is fixed to Africa/Nairobi.
- Efficiency page has no salon or rental figures yet.
- Older SQL (phase12/14/17) mentions lb_inventory_movements; this upgrade follows lb_stock_movements, which the running code uses.
- The unused root-level POSDashboard.jsx has broken imports (existed before this work).
