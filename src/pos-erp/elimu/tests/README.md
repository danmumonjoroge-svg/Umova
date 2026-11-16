# Tests

| What | How to run | Needs |
|---|---|---|
| **SQL scenarios** (111 checks: permissions, RLS, validation, math, locking, corrections, history, isolation, communication) | `sh academic/schema/tests/run_schema.sh`; last lines should read `TOTAL 111 FAIL 0` | A **scratch** local Postgres 16 (`PGHOST`, `PGPORT`; defaults in the script). **Never point it at a real database:** it drops/creates `elimu_test`. |
| JS engines, report-card HTML, templates (17) | `node --experimental-default-type=module --test elimu/tests/engines.test.js` (run from the POS folder) | Node ≥ 20. No npm packages. |
| Offline store (7) | `ELIMU_NODE_MODULES=/path/to/node_modules node --experimental-default-type=module --import ./elimu/tests/node-resolver.mjs --test elimu/tests/offline.test.mjs` | `npm i dexie fake-indexeddb`; `tests/node-resolver.mjs` (included) resolves the POS's extensionless imports |
| Auth core (11): identifiers, roles, errors, session | `node --experimental-default-type=module --test elimu/tests/app/app_core.test.mjs` (from the POS folder) | Node ≥ 20. No npm packages. |
| Shell models (13): menu, settings catalog, notifications, branding, registry | `node --experimental-default-type=module --test elimu/tests/app/app_nav.test.mjs` (from the POS folder) | Node ≥ 20. No npm packages. |
| Marks grid render (9 assertions) | `tests/mark_grid.ssr.jsx`: bundle with esbuild (`--jsx=automatic`, `NODE_PATH` to a folder with react, react-dom, lucide-react) and run | esbuild |

`academic/schema/tests/pos_stubs.sql` = the project's own `schema/tests/live_stubs.sql` (real function bodies from the live DB) plus condensed `is_pos_owner`, `lb_communication_log`, `lb_communication_templates`. The real `comm_log_guard` trigger is **not** loaded.

## Running the UI smoke test (156 checks)

`NM=/path/to/node_modules HOST_DIR=$PWD sh elimu/tests/run_ui_smoke.sh` (run from the POS folder).
`NM` must contain **real** `esbuild`, `react`, `react-dom`, `react-router-dom` (v6) and `lucide-react`. Do not substitute hand-written router stubs:
the Finance hub tests depend on real splat (`finance/*`) route params and fail against a stand-in. Expect `156 passed, 0 failed`.

## Role-map snapshot

`elimu_utils.test.mjs` compares `utils/permissions.js` with the database. Export `elimu_role_actions` as `{role: [sorted actions]}` into
`elimu/tests/sql/role_actions.snapshot.json`; until then that one test is skipped (not failed).
