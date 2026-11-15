# AI 3 continuation notes

**Status:** the attendance and timetable subsystem is built to the extent listed under “Completed”. It has **not** been run inside the real POS app (no foundation tables, no browser). Items under “Not done / not verified” are real gaps.

## Completed (files exist and were checked as described)
* SQL `001`–`008` — applied twice cleanly on Postgres 16; 90 scenario checks pass (tenant isolation, role checks, duplicate sessions/marks, unmarked ≠ absent, submit lock, amend + history + audit, follow-ups, contact dedupe, repeated absence, historical snapshots, timetable clashes/override/backstop, calendar/weekend).
* JS: services, hooks, pure utils, templates, offline queue — 17 unit tests pass (including SQL↔JS role-action parity).
* UI: all pages/components in `routes.jsx` — each file passes an esbuild syntax check and the whole route tree bundles with every import and named export resolved. **No React render/click tests were run.**

## Not done / not verified
1. **Not wired into the POS app** (by design: POS files must not change). Apply INTEGRATION.md §0.
2. **Foundation views** `elimu_v_*` exist only as a template (`009`) and as stubs in the tests. Attendance cannot open a register until AI 1/AI 2 (or the integrator) create them.
3. **Communication path** is untested against the real `lb_communication_log` triggers; POS `comm_can_send` needs `operations.use`/`settings.manage`/`finance.view` (see INTEGRATION §7).
4. **Offline**: tested only with an in-memory store, not real IndexedDB or a real network drop. No bulk “pre-load registers” button. POS sync engine handler is optional and not added.
5. **Timetable views**: grid views by class, teacher and room exist; a student view and a daily view page are not built (`entriesForDate` / `viewFilters` support them). No auto-generation, no drag-and-drop, no printable timetable page, no “substitute teacher suggestions”.
6. **Timetable notices**: prepared one recipient at a time for teachers/class wording; no bulk per-guardian fan-out.
7. **Notifications**: nothing is pushed to the POS bell; no automatic sending of any message.
8. **Parent/student access** is not built (staff-only RLS).
9. **Visual check**: pages were never rendered in a browser; layout on small screens is unverified.
10. `esbuild` bundling reported that the supplied zip lacks `src/pos-erp/../security/secureAuthStorage` (imported by existing `services/posSupabaseClient.js`). This is a pre-existing gap in the upload, left untouched.

## Exact next steps
1. Create the six foundation views; run the SQL in order (README) in a staging Supabase.
2. Apply INTEGRATION.md §0 wiring; `npm run dev`; open `/elimu/attendance`.
3. Grant yourself `school_admin` (or use the owner login), seed settings via `elimu_attendance_seed_defaults`, add periods/rooms, open a register, submit, amend, prepare a guardian message.
4. Test on a phone offline: open a register online, go offline, mark, submit, go online, check the sync summary.
5. Decide the POS permission for teachers who must prepare messages.
