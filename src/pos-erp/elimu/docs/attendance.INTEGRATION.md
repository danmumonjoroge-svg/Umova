# INTEGRATION CONTRACT (AI 3 — Attendance, Timetable, Lesson Scheduling)

Nothing here assumes AI 1, AI 2, AI 4 or AI 5 has delivered anything. Where Elimu needs data it does not own, it reads **named views** (§2). Map your real tables to those views; do not rename the views or columns.

## 0. Wiring (not applied — POS files are untouched)
Two small edits in existing files switch the module on. They are intentionally **not** made by this delivery:
1. `POSApp.jsx` — inside the `<Route element={<POSLayout />}>` group add `<Route path="elimu/*" element={<ElimuRoutes />} />` and `import ElimuRoutes from './elimu/routes';`
2. `navigation/navConfig.js` — add `ELIMU_MODULE` from `elimu/navigation.js` to `MODULES` and a `school` capability (opt-in). `permsAny` there uses Elimu action names, so `navConfig` / `ROUTE_PERMISSIONS` need a small adapter if they only accept POS permission keys (the routes themselves are already guarded by `RequireElimu`).
Optional 3: register a handler for outbox kind `elimu_attendance` in `offline/syncEngine.js` `HANDLERS` (§8). Without it the Elimu pages sync their own queue when the page is open and the connection returns.
Until step 1, the pages are unreachable in the running app. Apply the 009 views (§2) before using any register.

## 1. Tables created (all RLS-enabled, `tenant_id = get_current_tenant_id()`)
Core: `elimu_staff_roles`, `elimu_teacher_allocations`. Calendar: `elimu_school_calendar_events`.
Attendance: `elimu_attendance_settings`, `elimu_attendance_status_defs`, `elimu_attendance_reasons`, `elimu_attendance_sessions`, `elimu_attendance_records`, `elimu_attendance_amendments`, `elimu_absence_followups`, `elimu_attendance_notices`.
Timetable: `elimu_school_rooms`, `elimu_timetable_periods`, `elimu_timetable_entries`, `elimu_teacher_availability`, `elimu_timetable_exceptions`, `elimu_timetable_change_history`, `elimu_timetable_change_notices`.
Views: `elimu_v_attendance_sessions`, `elimu_v_attendance_notices`, `elimu_v_teacher_workload` (`security_invoker`).
Public RPCs (all check `elimu_can`/`elimu_require`): `elimu_my_access`, `elimu_attendance_seed_defaults`, `elimu_get_attendance_settings`, `elimu_is_school_day`, `elimu_open_attendance_session`, `elimu_save_attendance_marks`, `elimu_submit_attendance`, `elimu_amend_attendance`, `elimu_decide_early_departure`, `elimu_record_guardian_contact`, `elimu_update_absence_followup`, `elimu_daily_overview`, `elimu_daily_summary`, `elimu_repeated_absences`, `elimu_report_records`, `elimu_report_student_percentages`, `elimu_report_class_percentages`, `elimu_report_monthly_summary`, `elimu_log_report_generated`, `elimu_timetable_conflicts`, `elimu_save_timetable_entry`, `elimu_cancel_timetable_entry`, `elimu_set_timetable_exception`, `elimu_record_timetable_notice`, `elimu_link_timetable_notice`.
No existing table is altered. Audit rows go into the existing `pos_audit_log`.

## 2. Tables/views expected from the Elimu foundation (REQUIRED views)
Create these over your real tables (template: `shared/schema/009_foundation_adapter_TEMPLATE.sql`). `tenant_id` must equal `pos_tenants.id`. Ids are `uuid`; Elimu stores them without foreign keys.

| View | Columns Elimu reads |
|---|---|
| `elimu_v_roster` | tenant_id, enrollment_id, student_id, admission_number, student_name, class_id, stream_id, academic_year_id, term_id, enrolled_from, enrolled_to, status (`'ACTIVE'` = currently enrolled) |
| `elimu_v_class_streams` | tenant_id, class_id, class_name, stream_id (NULL if none), stream_name, academic_year_id, sort_order |
| `elimu_v_guardians` | tenant_id, guardian_id, student_id, guardian_name, relationship, phone, email, whatsapp_phone, is_primary, can_receive_attendance_alerts |
| `elimu_v_terms` | tenant_id, term_id, academic_year_id, term_name, year_name, start_date, end_date, is_current |
| `elimu_v_subjects` | tenant_id, subject_id, subject_name, subject_code |
| `elimu_v_teachers` | tenant_id, teacher_id, teacher_name, phone, email — default `pos_staff` (`teacher_id = pos_staff.id`) |

If your teacher id is not `pos_staff.id`, `elimu_staff_id()` (the signed-in person's id) and the `staff_id`/`teacher_id` columns must use the same id space — change `elimu_staff_id()` once, in `001_core.sql`.
Until these views exist the screens show a "student records are not connected" notice; attendance cannot be opened without `elimu_v_roster`.
Optional hardening after foundation tables exist: foreign keys on `elimu_attendance_records.enrollment_id / student_id` (see template).

## 3. Existing POS services reused
`posSupabaseClient`, `usePosErpAuth` (tenant, `posStaffId`, owner), `get_current_tenant_id()` / `is_pos_session()` / `is_pos_owner()`, `pos_staff`, `pos_audit_log`, `lb_communication_log`, `services/commEngineService` (`deepLink`, `setStatus`, `sendViaProvider`), `offline/db` (Dexie `meta`, `outbox`), `offline/offlineCache`, `offline/netErrors`, `components/CardKit`, `components/workspace/Sheet`, `utils/printDocument`. No second auth, tenant, staff, communication, notification or offline engine exists in `elimu/` (a unit test checks the SQL for this).

## 4. Components exposed
`StudentRow`, `AmendSheet` (attendance); `TimetableGrid`, `EntryEditor`, `ConflictList` (timetable); `GuardianMessageSheet` (communication; usable by AI 1 for other guardian messages); `kit.jsx` helpers (`Field`, `ConfirmSheet`, `StatusPill`, `CompletionPill`, `classOptions`).

## 5. Hooks and APIs exposed
Hooks: `useElimu` / `ElimuProvider` / `RequireElimu` (`can('timetable.manage')`, `today()`, `tenantId`), `useFoundation`, `useAttendanceConfig`, `useOfflineSync`.
Services: `attendanceService`, `absenceService`, `reportService`, `timetableService`, `calendarService`, `accessService`, `foundationService`, `guardianComms`, `getOfflineAttendance`.
Pure rules: `attendance/utils/{statuses,lateness,bulk}`, `timetable/utils/{conflicts,grid}`, `shared/utils/time`.

## 6. Routes/pages (under `elimu/*`)
`attendance` (dashboard), `attendance/take`, `absences`, `reports`, `attendance/settings`, `timetable`, `timetable/changes`, `timetable/setup`, `calendar`, `access`.

## 7. Communication dependencies
`lb_communication_log` must accept `purpose = 'ELIMU_ATTENDANCE'|'ELIMU_TIMETABLE_CHANGE'`, `template_source = 'ELIMU'`, `reference_type/id/label`, status `QUEUED/OPENED/SENT` set by staff, and provider statuses set only by a provider. Elimu prepares messages only; "sent" appears only after a staff confirmation, "delivered/read" only when the provider reports it. Duplicates are blocked by `uq_elimu_notice_once` (attendance) and `UNIQUE(change_id, audience, recipient_ref, channel)` (timetable); a re-send after a correction needs the explicit `resend` flag and supersedes the old link.
**POS permission caveat:** inserting into `lb_communication_log` for a non-customer/supplier recipient is guarded by the POS trigger `comm_can_send('OTHER')`, which needs one of the POS permissions `settings.manage`, `finance.view` or `operations.use`. A teacher who has an Elimu role but none of those cannot prepare a message (the database answers 42501 “You do not have permission to send messages”; the screen shows it). Give those staff `operations.use`, or have AI 1 extend `comm_can_send` for `GUARDIAN`/`STAFF` kinds. This path was read from the POS SQL but was **not executed** against the real communication tables in this delivery.
Not built: automatic sending, the POS notification bell for Elimu events, per-guardian bulk timetable notices (teacher/class-notice wording is prepared one recipient at a time).

## 8. Offline dependencies and limitations
Uses Dexie `meta` (drafts, cached opened registers) and `outbox` rows `kind='elimu_attendance'`, statuses `ELIMU_PENDING/SYNCING/SYNCED/NEEDS_ATTENTION/FAILED`. Optional `syncEngine.HANDLERS` entry: call `attendanceService.saveMarks / submit` for `payload.type` `marks / submit`.
Works offline: marking a register already opened on this device, bulk marks, drafts, queued submit, queued guardian messages. Needs connectivity: first open of a register, amendments, excuse decisions, all timetable work, reports. Conflicts (someone else changed a student) are shown for a decision, never overwritten. The POS "unsynced" badge does not count Elimu rows.

## 9. What AI 1 (foundation: students, classes, guardians, staff) must provide
The `elimu_v_roster`, `elimu_v_class_streams`, `elimu_v_guardians`, `elimu_v_terms` (shared with AI 2), `elimu_v_teachers` views; one enrolment id per student per class period; guardian phone/WhatsApp/email and `can_receive_attendance_alerts`; keep enrolment history (`enrolled_from/to`) instead of overwriting. Staff access: grant Elimu roles through `elimu_staff_roles` (screen: `elimu/access`) — POS permissions alone do not give Elimu access except to the owner.
## 10. What AI 2 (academics: years, terms, subjects, classes) must provide
`elimu_v_terms`, `elimu_v_subjects` and the academic-year / term ids used in `elimu_v_roster` and `elimu_v_class_streams`. Subject-to-teacher allocation: Elimu keeps its own `elimu_teacher_allocations` for attendance scope; AI 2 may replace it by populating the same table or by redefining `elimu_is_allocated()`.
## 11. What AI 4 (exams/grading/fees etc.) must know
Read-only consumers may use `elimu_attendance_records` / `elimu_report_*` RPCs. Never write to attendance tables directly: the guards reject it. Exam periods can be put on the calendar (`EXAM_PERIOD`); they do not stop attendance unless the event is flagged "no attendance". Attendance % uses the school's `excused_counts_as_present` setting — reuse `elimu_report_student_percentages`, do not recompute.
## 12. What AI 5 (dashboards/portals/notifications) must know
Parent/student portals are not built; any portal must use views with its own guardian-scoped RLS (current Elimu read policies are staff-only). Event sources: new rows in `elimu_attendance_notices`, `elimu_timetable_change_history`, `elimu_absence_followups`. Notification-bell integration is NOT implemented. Audit actions are written to `pos_audit_log` with `module = 'elimu'` metadata.

## Permissions (Elimu actions)
attendance.take_own/take_any/view_all/amend · absence.manage/approve · comms.send · reports.view · settings.manage · timetable.view/manage/override · calendar.view/manage · roles.view/manage. Role → action table: `elimu_role_actions()` in `001_core.sql` (mirrored in `shared/utils/access.js`).

### Phase 8 offline safety note
- Attendance queue submission dedupe is tenant-scoped and the queue drain uses a Web Locks / same-tab guard.
- The attendance offline adapter no longer falls back to volatile in-memory storage if the POS Dexie database is unavailable; it fails visibly instead of claiming the register is safely queued.
- Exam mark-sheet caches and pending edits are now tenant-scoped. Pre-v2 unscoped pending edits are held back and shown as a review warning; they are not automatically assigned to the current tenant.
- See `elimu/docs/phase8_fk_diagnostics.sql` for read-only staging FK inventory and the documented attendance session orphan check. It is not a migration.
