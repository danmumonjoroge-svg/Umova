# Phase 3 — Rooms & Stays

## What it is
Room type -> Room -> Stay -> Guest (a customer) -> Folio (Phase 2). The room never touches money.
A stay puts ONE live ROOM line on the guest's folio (nights x rate); the Phase 2 folio settles it.
A reservation and a stay are the same table (`lb_stays.status`: RESERVED -> CHECKED_IN -> CHECKED_OUT, or CANCELLED).

## Decisions taken (please confirm or overrule)
1. **Own small tables, not `lb_units`.** Units are rented by the month to a standing tenant; a room is sold by the night. Customers, folios, numbering, RLS are all reused.
2. **Room status stored = physical only** (Available / Occupied / Cleaning / Maintenance). "Reserved" is derived on the board (ready room with a booking due today or overdue), so it cannot go stale.
3. **Nights = calendar nights, minimum 1.** Same-day stay = 1 night. "Today" is Africa/Nairobi, set in one function `_local_today()`.
4. **Room charge is posted at check-in for the booked nights** and recalculated (old line VOID with reason, new line posted, original date kept) on extend, re-price and check-out. Check-out charges nights actually used; if leaving early, staff can tick "still charge the booked nights". Overstays are charged in full.
5. **Check-out does not settle.** The room goes to Cleaning, the folio stays open, and the app opens the bill straight on the settle sheet.
6. **One bill per customer** still holds: a second room for the same guest lands on the same folio.
7. **Capability `rooms` is opt-in and switches on `folios` with it.** Existing businesses see exactly the menu they had before. Rooms sits under "More" on a phone (no new bottom tab).
8. Clients can add/edit rooms and room types (RLS-gated) but can NOT write stays or a room's status; those go through the new functions.

## Built
| Area | Files |
|---|---|
| DB | `schema/phase20_rooms_stays.sql`: lb_room_types, lb_rooms, lb_stays, views lb_room_board / lb_stay_summary, `lb_folio_lines.stay_id`, FKs from lb_folios / lb_sales to stays, functions create_stay, check_in_stay, update_stay, check_out_stay, cancel_stay, set_room_status, a folio-line trigger tagging lines and POS sales with the stay, `void_folio_line` now refuses to remove a room line by hand |
| Service | `services/roomService.js` |
| UI | `pages/RoomsPage.jsx` (room cards, housekeeping, add room / room types), `pages/StaysPage.jsx` (In the room / Booked / Past), `components/StaySheets.jsx` (book or check in, change, check out, cancel), `pages/workspaces/RoomsWorkspace.jsx` |
| Wiring | `navConfig.js` (rooms capability + module, `withRequired`), `CapabilitiesContext.jsx`, `SettingsPage.jsx` (toggle pulls in folios), `POSApp.jsx` routes `/pos/rooms`, `/pos/room-list`, `/pos/stays` |
| Shared | `components/workspace/Sheet.jsx` (moved out of FoliosPage); FoliosPage opens the settle sheet from `?settle=1` and hides "Remove" on room lines |
| Offline | `offline/db.js` v3 `rooms_cache` (read only) |
| Tests | `schema/tests/phase20_scenarios.sql`, `schema/tests/phase20_js_checks.mjs` |

## Verified
- **SQL, 84 checks on a scratch Postgres 16** (stand-in base tables): 30 rooms; John Kamau walk-in to Room 204, 2 nights x 4,000 = 8,000 on his folio, plus breakfast, drinks, swimming, football, dinner charged from the POS = **12,300**, checked out, settled with M-Pesa, folio SETTLED, balance 0, one INV and one RCT number, customer balance untouched. Also: double-booking and back-to-back bookings, cleaning/maintenance blocks, early departure, booked-nights option, same-day stay, extend and re-price (history kept as VOID), two rooms on one bill, settled account refuses a room-charge change, cancel, another business cannot see, book, change or check out our rooms, clients cannot write stays or room status, migration re-runs cleanly.
- **JS, 31 checks:** date maths matches the database, check-out preview, capability rules, a business that never chose sees the same menu as before, every menu link has a route.
- **Static check of the whole app tree** (TypeScript compiler over all .js/.jsx): no syntax errors, no undefined names, no broken relative imports or missing exports (a deliberately broken probe file was caught first, to prove the check works). Only exception: the unused root-level `POSDashboard.jsx` (pre-existing leftover, never imported).

## NOT verified
- **No real bundle:** the npm registry is blocked in this workspace, so I could not run esbuild/webpack. Run your normal build.
- Not run on your live Supabase or in a browser. The Rooms, Stays and sheet screens were only statically checked. Click through on a phone: add a room type, add rooms, walk-in check-in, charge a sale to the folio, check out, settle.
- Same live-schema assumptions as Phase 2 (lb_sales, lb_sale_items, lb_products columns, `lb_customers.phone`), plus the existing `lb_customers.is_active`.
- Time zone is hard-coded to Africa/Nairobi.

## Known gaps / next
- All nights are recognised as room revenue on the check-in date, then corrected at check-out (night-by-night accrual belongs with Efficiency, Phase 7).
- No room move / swap mid-stay yet; do it as check-out and new check-in.
- Customer profile and statement still do not show stays or folios (brief §26).
- Till reconciliation for folio settlements is still open (from Phase 2).
- Still open from Phase 1: `lb_stock_movements` vs `lb_inventory_movements`, needed before Production.
- Next: Phase 4, Services & Activities (sell swimming, football, gym etc. and charge to the folio, reusing the salon services table).
