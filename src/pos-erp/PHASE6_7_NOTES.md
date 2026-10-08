# Phases 6 and 7: Packages and "How we are doing"

## Phase 6 - Packages
A package is one price for a bundle you already sell, for example Family Package (swimming + lunch + drinks) or Bed & Breakfast. It is not a new kind of product.
- Make packages under Packages (opt-in; switches Customer Folios on). Items are existing products/services/activities, or a typed item such as "Late check-out".
- On a guest's bill: Add charge -> pick a package -> how many. The bill gets one ordinary line per item, so reports, invoice and receipt keep working.
- The package price is shared across the items in proportion to their normal prices; the last line takes the rounding so the lines add up to exactly the package price.
- Stocked items come out of stock (default warehouse, recorded as a sale movement). Services touch no stock.
- "Remove the whole package" takes every line off and puts the stock back. A single package line cannot be removed by itself.
- Editing a package never changes bills already posted.
- A hotel room itself still comes from the stay. A Bed & Breakfast package covers the breakfast and extras; it does not book the room.

## Phase 7 - How we are doing
Opt-in page. One read-only function (`efficiency_report`) works figures out from your real records for Today / 7 days / this month / 30 days. A section shows only if its data exists; anything that cannot be worked out shows a dash.
- Rooms: occupancy, average room price, income per room, room income, average stay, guests in now.
- Guest bills: average guest spend, settled, still open, where the money came from, best-selling activities.
- Packages: sold and income, by package.
- Production: yield %, wastage and its cost, by recipe, by reason.
Definitions are printed on the page. Future days are not counted.

## Verified here (scratch Postgres 16, not your live database)
- Phase 6: 36 checks (split adds up exactly, stock out and back, double-submit safe, stock guard, tenant isolation, direct writes blocked), in enum and text column variants.
- Phase 7: 22 checks, including the brief's acceptance tests end to end: 30 rooms, John Kamau in 204 at 4,000 x 2 nights + food, drinks and activities = one folio of 12,300 settled by M-Pesa; bakery 100 expected, 94 made, 6 wasted, yield 94%.
- Earlier suites still pass (Phase 3: 84, Phase 4: 9, Phase 5: 56 x 2 variants). JS checks pass (menu unchanged for retailers; new routes resolve). Static scan of new files clean.
- Two real bugs were found and fixed by these tests (package lines picked up other packages' items; package count).

## NOT verified
- Nothing run on your live Supabase or in a browser; no real build.
- Package cost of goods is not posted to accounting (same as manual folio lines); stock is.
- Occupancy counts only checked-in and checked-out stays. Time zone is fixed to Africa/Nairobi.
- Room income is nights x rate; the folio still recognises all nights at check-in.
- Salon and rental figures are not in the efficiency page yet.

## Next
Phase 8: one invoice and one receipt for Room + Food + Drink + Activity + Payment, grouped for reading (packages as one block).
