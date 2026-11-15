# Architecture

## Principles
1. **Reuse, don't duplicate.** Tenancy = `get_current_tenant_id()` / JWT `pos_tenant_id`; sign-in = `usePosErpAuth`; staff = `pos_staff`; messages = `lb_communication_log` + `commEngineService`; audit = `pos_audit_log`; offline = Dexie `meta` + `outbox`; UI = `CardKit` + `Sheet`.
2. **The database is the authority.** Every write goes through a `SECURITY DEFINER` RPC that calls `elimu_require(action)`; tables expose read-only RLS (timetable entries, attendance records/sessions have no staff write policy). The JS only decides what to *show*.
3. **Foundation-agnostic.** Students, enrolments, classes, streams, terms, guardians, subjects and teachers belong to AI 1/AI 2. They are read through six named adapter views; ids are plain `uuid`s with no foreign keys to tables that may not exist.
4. **History is a snapshot.** An attendance record stores student name, admission number, class and stream as they were that day, plus `enrollment_id`; later transfers or renames never rewrite it.

## Tenancy and access
* Every Elimu table has `tenant_id` and an RLS policy `tenant_id = get_current_tenant_id()`; `business_id` (the school) is stored for multi-school tenants.
* Roles live in `elimu_staff_roles` (school_admin, principal, deputy, class_teacher, subject_teacher, attendance_officer, staff). `elimu_role_actions(role)` maps role → actions; `elimu_can(action)` is used by policies and RPCs. The POS owner always passes; a non-POS session fails closed; `service_role` passes.
* Teachers are limited to classes they are allocated (`elimu_teacher_allocations`, `elimu_att_scope_ok`) unless they hold `attendance.take_any` / `view_all`.
* `shared/utils/access.js` mirrors the SQL action table; a unit test parses the SQL and fails if they differ.

## Attendance model
* `elimu_attendance_sessions` (DRAFT → SUBMITTED → AMENDED), unique per tenant/class/stream/date/kind/lesson (`COALESCE(elimu_nil())` makes NULLs unique-safe). `elimu_attendance_records` unique per (session, enrolment) and (session, student).
* A student with no mark is `NOT_MARKED`. It is its own bucket everywhere (UI, SQL counts, reports) and never becomes ABSENT. Submitting with unmarked students needs explicit confirmation (or is refused if the school setting says so).
* Status groups PRESENT / ABSENT / EXCUSED / NEUTRAL; system statuses are fixed, schools add their own as custom statuses mapped to a group. Late = arrival more than `grace_minutes` after the start; minutes counted from the start. Early departure can need approval.
* Submit locks the register: a trigger blocks direct edits; only `elimu_amend_attendance` (sets GUC `elimu.attendance_amend`) can change it, requires `attendance.amend` + a reason, and writes `elimu_attendance_amendments` plus an audit row.
* Submit creates an absence follow-up per ABSENT/SICK daily record.
* Attendance % = (present [+ excused if the school chooses]) ÷ (present + absent + excused). Not-marked and neutral are excluded, not counted as absence.
* Calendar: a day is a school day unless it is a weekend day (setting) or covered by a calendar event that “affects attendance”.

## Timetable model
* `elimu_timetable_entries` are weekly lessons with a validity range (a one-off lesson has the same from/to date) and an optimistic `version`. Saving only happens through `elimu_save_timetable_entry`.
* `_elimu_tt_conflicts` finds CLASS/TEACHER/ROOM clashes, outside school hours, overlap with breaks, teacher not working/unavailable/on leave, inactive room (blocking) and room capacity (warning). Invalid duration and inactive room cannot be overridden. Overriding needs `timetable.override` and a ≥ 5 character reason; the clash list and reason are stored in the change history. A backstop trigger refuses a write that skipped the RPC.
* One-day changes (cancel, teacher swap, room swap) are rows in `elimu_timetable_exceptions`; the weekly pattern is untouched. Every change appends to `elimu_timetable_change_history` (no write policy, append-only).

## Communication
Wording lives in `communication/templates`. **Elimu never sends.** It prepares a message (`lb_communication_log.status = QUEUED`), staff open the channel link (OPENED) and confirm (SENT); `SUBMITTED / DELIVERED / READ / FAILED` come only from a provider via the POS engine. `elimu_attendance_notices` / `elimu_timetable_change_notices` are dedupe links (one per record+purpose+guardian+channel, one per change+recipient+channel); the views `elimu_v_attendance_notices` show the *real* log status.

## Offline
Drafts and a copy of each opened register are saved in the POS Dexie `meta` table; queued marks/submits/messages go to `outbox` with `kind = 'elimu_attendance'` and `ELIMU_*` statuses so the POS sync engine never touches them. Marks merge per session, are idempotent upserts, and carry `base_updated_at` so a student changed by someone else is reported, not overwritten. Limits are listed in INTEGRATION.md §Offline.
