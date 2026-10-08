# Phases 4 and 5: Activities and Production

## What you get
**Phase 4 - Services & Activities.** A service can now be marked "Activity" (swimming, football, tours). Activities appear under a new opt-in Activities menu. On a guest folio, "Add charge" offers your services as quick-pick chips that fill the type, description and price. Activity charges are typed ACTIVITY on the folio. Commission/provider fields stay hidden unless Salon is on. Run `phase21_services_activities.sql`.

**Phase 5 - Production.** Opt-in Production menu with Recipes and Production runs.
- Recipe: materials (flour, sugar, eggs, milk, butter), a main output (Chocolate Cake), optional extra outputs with a cost share that must total 100%.
- Run: start with expected quantity, then record the actual result, wastage and reason. Posting takes materials out of stock, puts finished goods in, and records yield % and cost per unit.
- Bakery test: expected 100, actual 94, wastage 6 gives yield 94% (covered by the SQL tests).
Run `phase22a_production_enums.sql` (optional, only matters if your movement columns are enums) by itself first, then `phase22_production.sql`.

## Verified here
- SQL on a scratch Postgres 16: Phase 4 9 checks; Phase 5 56 checks in 3 column-type variants; Phase 3 84 checks still pass.
- JS: 41 checks (capabilities opt-in, existing menu unchanged, every menu link has a route, new routes belong to the right module).
- Static scan of every new file: no undefined names or missing exports.

## NOT verified
- Nothing run on your live Supabase or in a browser; no real build (npm registry blocked here).
- Whether your live `lb_stock_movements` uses enums or text for movement/reference type (the migration detects both).
- Older SQL (phase12/14/17) refers to `lb_inventory_movements`; Production follows the table the running JS uses.

## Known limits
- Production runs need a connection (no offline drafts yet).
- A posted run cannot be reversed; cancel works for drafts only.
- Packages, efficiency dashboard and unified receipts (Phases 6-8) are next; the customer profile does not yet list folios/stays.
