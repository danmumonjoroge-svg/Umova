# Tests

| What | How to run | Needs |
|---|---|---|
| **SQL scenarios** (111 checks: permissions, RLS, validation, math, locking, corrections, history, isolation, communication) | `sh academic/schema/tests/run_schema.sh`; last lines should read `TOTAL 111 FAIL 0` | A **scratch** local Postgres 16 (`PGHOST`, `PGPORT`; defaults in the script). **Never point it at a real database:** it drops/creates `elimu_test`. |
| JS engines, report-card HTML, templates (17) | `node --experimental-default-type=module --test elimu/tests/engines.test.js` (run from the POS folder) | Node ≥ 20. No npm packages. |
| Offline store (7) | `ELIMU_NODE_MODULES=/path/to/node_modules node --experimental-default-type=module --import ./elimu/tests/node-resolver.mjs --test elimu/tests/offline.test.mjs` | `npm i dexie fake-indexeddb`; `tests/node-resolver.mjs` (included) resolves the POS's extensionless imports |
| Marks grid render (9 assertions) | `tests/mark_grid.ssr.jsx`: bundle with esbuild (`--jsx=automatic`, `NODE_PATH` to a folder with react, react-dom, lucide-react) and run | esbuild |

`academic/schema/tests/pos_stubs.sql` = the project's own `schema/tests/live_stubs.sql` (real function bodies from the live DB) plus condensed `is_pos_owner`, `lb_communication_log`, `lb_communication_templates`. The real `comm_log_guard` trigger is **not** loaded.
