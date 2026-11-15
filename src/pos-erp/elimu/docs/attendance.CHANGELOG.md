# Changelog

## 0.1.0 — first delivery (AI 3)
### Added
* **Core**: Elimu roles/actions (`elimu_staff_roles`, `elimu_role_actions`, `elimu_can/require`), teacher allocations, audit helper writing to `pos_audit_log`, `elimu_my_access`.
* **Calendar**: events (holidays, closings, terms, exams, meetings…), “no attendance” days, school-day calculation, audit.
* **Attendance**: settings (hours, grace, deadline, weekend days, thresholds, notification options), school statuses and reasons, daily/lesson registers with snapshots, draft → submit → lock, amendments with history, early-departure approval, absence follow-up cases, guardian contact tracking, dashboard, 11 reports (CSV/print), repeated-absence detection.
* **Timetable**: rooms, periods, weekly lessons with versions and validity dates, teacher availability/leave, conflict detection + audited override, one-day cancel/teacher/room changes, append-only change history, teacher workload view.
* **Communication**: attendance and timetable wording; guardian message sheet over the POS communication engine; honest status handling; dedupe.
* **Offline**: drafts, cached registers, queued marks/submit/messages with conflict reporting on the POS Dexie database.
* **UI**: 10 pages + components, one route group, one navigation entry.
* **Tests**: `tests/sql` (90 checks on Postgres 16 with stub foundation tables; migrations applied twice), `tests/elimu_utils.test.mjs` (17 tests).
### Changed outside `elimu/`
Nothing.
