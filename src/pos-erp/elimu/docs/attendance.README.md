# Elimu — Attendance, Timetable & Lesson Scheduling (AI 3)

This folder adds the attendance and timetable subsystem for the future Elimu School Management System **inside** the existing POS/ERP project.
It reuses the POS tenant/auth/staff/communication/offline infrastructure and changes **no existing POS file**.

## What is in here

| Folder | Contents |
|---|---|
| `shared/` | Elimu roles + permissions (`001_core.sql`), access service/context, UI kit, time utilities, foundation adapter service + template |
| `calendar/` | School calendar events (holidays, closings, events) — schema `002`, service, page |
| `attendance/` | Settings, statuses, reasons, sessions, records, amendments, absence follow-up, dashboard, reports — schema `003`, `006`–`008`, services, pages, components, hooks, report definitions/export |
| `timetable/` | Rooms, periods, lessons, teacher availability, one-day changes, change history, conflict detection — schema `004`, `005`, services, pages, components |
| `communication/` | Attendance + timetable message wording and the glue to the POS communication engine (`lb_communication_log`) |
| `tests/` | `sql/` (Postgres scenarios, 90 checks) and `elimu_utils.test.mjs` (pure-JS rules, 17 tests) |
| `routes.jsx`, `navigation.js` | One route group and one navigation entry. **Not wired in** — see INTEGRATION.md §Wiring |

## Run the database part

Execute in this order (each file is safe to run twice):
`shared/schema/001_core.sql` → `calendar/schema/002_calendar.sql` → `attendance/schema/003_settings_reasons.sql` → `timetable/schema/004_…sql` → `timetable/schema/005_…sql` → `attendance/schema/006_…sql` → `007` → `008` → create the six foundation adapter views (`shared/schema/009_foundation_adapter_TEMPLATE.sql` is a template, not a migration).

## Run the tests

```sh
sh elimu/tests/sql/run.sh                                                    # needs Postgres 16 binaries; builds a scratch DB with stub foundation tables
node --import ./elimu/tests/register.mjs --test elimu/tests/elimu_utils.test.mjs   # no database, no browser
```

## Read next
`INTEGRATION.md` (contracts other modules depend on) · `ARCHITECTURE.md` (design decisions) · `AI3_CONTINUATION.md` (what is and is not finished) · `CHANGELOG.md`.
