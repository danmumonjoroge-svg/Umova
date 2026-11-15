# ELIMU — Integration guide

## 1. Existing Umova systems reused (nothing rebuilt)

| Need | Reused from Umova | How Elimu uses it |
|---|---|---|
| Sign-in, sessions, tenants | `get_current_tenant_id()`, `is_pos_session()`, `usePosErpAuth`, `pos_tenants` | Every RLS policy and tenant-stamp trigger; school name from `businessIdentity` |
| Staff & roles | `pos_staff`, role templates, `pos_has_permission()`, `PermissionsContext` | Permission checks (see §6); class teachers reference `pos_staff` |
| Customers | `lb_customers` | A guardian may point at an existing customer record instead of copying it |
| Communication | `lb_communication_log`, `lb_communication_templates`, `comm-send`, `comm_can_send` | Messages are normal log rows; school templates are normal template rows |
| Notifications | computed live in the host bell | Elimu exposes `notificationItems()` + a persisted prepared-work queue |
| Audit | `pos_audit_log` | `elimu_audit()` writes column names and whitelisted non-PII values |
| Offline | Dexie `umova_offline`, permission cache | Read-only screens rely on the host; message drafts use Elimu’s own small store |
| Branding / UI kit | `CardKit`, `Sheet`, brand colours | Imported only in `services/platform.js` |
| Payments / M-Pesa / reports / calendar | untouched | Future modules integrate through §4 |

## 2. Existing tables Elimu depends on (read or reference only)

`pos_tenants`, `lb_businesses`, `pos_staff`, `pos_audit_log`, `lb_communication_log`, `lb_communication_templates`, `auth.uid()`,
and the functions `get_current_tenant_id`, `is_pos_session`, `pos_has_permission`. Required POS migrations: phases 7, 8, 10, 50a, 50.
Elimu never alters these tables. (Optional: `lb_customers` for the guardian↔customer link.)

## 3. New objects (migrations 001–006)

Tables: `elimu_settings`, `elimu_student_statuses`, `elimu_admission_statuses`, `elimu_number_sequences`, `elimu_academic_years`, `elimu_terms`,
`elimu_classes`, `elimu_streams`, `elimu_class_teachers`, `elimu_students`, `elimu_student_status_history`, `elimu_student_care_notes`,
`elimu_guardians`, `elimu_guardian_contacts`, `elimu_guardian_channel_consent`, `elimu_student_guardians`, `elimu_admission_applications`,
`elimu_admission_status_history`, `elimu_enrollments`, `elimu_enrollment_history`, `elimu_message_links`, `elimu_call_log`,
`elimu_notification_rules`, `elimu_notifications`.
Views: `v_elimu_current_period`, `v_elimu_student_directory`, `v_elimu_enrollment_history`, `v_elimu_data_quality`, `v_elimu_communication_history` (all `security_invoker`).
Storage: private bucket `elimu-student-photos` (created when the storage schema exists).
Added by migration 006 to an existing Elimu table only: a composite unique key on `elimu_guardian_contacts (tenant_id, id)`.

## 4. APIs future modules call

**Database (RPC / views)** — all tenant-scoped, permission-checked, safe to call from any module:

| Call | Purpose |
|---|---|
| `elimu_ensure_setup()` | idempotent school seed |
| `v_elimu_student_directory` | student + status + current class/stream + primary guardian/phone, one row each |
| `v_elimu_enrollment_history`, `v_elimu_current_period` | where a student was, which year/term is current |
| `elimu_enroll_students(year, term, class, stream, ids[], source)` / `elimu_move_enrollment` | bulk enrol / re-class with history |
| `elimu_change_student_status(student, status, reason, date)` | status change, closes open enrolments on exit |
| `elimu_submit_application(jsonb)` / `elimu_admit_application(...)` | admissions |
| `elimu_dashboard_summary()`, `v_elimu_data_quality` | counts for dashboards/reports |
| `elimu_contact_eligibility(guardian, channel, purpose)` | “may we contact this guardian this way, and why not” |
| `elimu_next_number(kind)` | admission / application numbers (`kind` is one of the sequence kinds in `elimu_number_sequences`) |

**JavaScript** — import only from `elimu/index.js`: `studentService`, `guardianService`, `admissionService`, `enrollmentService`, `setupService`,
`useElimuAccess`, `useElimuSetup`, `registerModule`, `registerPurpose`, `registerEvent`.
Other modules must **read** through these or the views and **must not** write to `elimu_*` tables directly.

**Foreign keys for other modules:** reference `(tenant_id, student_id)` → `elimu_students (tenant_id, id)`, and likewise for classes, academic years, terms, enrolments.

## 5. Communication & notification interfaces

* Components: `ElimuContactActions`, `ElimuMessageComposer`, `ElimuCommunicationPanel` (+ `CommunicationHistory`).
* Service: `ElimuCommunicationService` — `prepare`, `record`, `handOff`, `confirmSentByHand`, `sendViaProvider`, `startCall`, `recordCallOutcome`, `history`.
* Templates: `ElimuTemplateResolver` (system → school override → per-message edit). A module adds a purpose with `registerPurpose({ key: 'ELIMU_ATTENDANCE_ABSENT', label, fields })` and ships its system default text with it; schools override it in the normal template editor.
* Notifications: `registerEvent('elimu.attendance.absent', { label, purpose, audience })`, then call `elimu_notify(event, title, student, application)` (SECURITY DEFINER; creates a *pending, unsent* queue item only if the school has the rule switched on). The host bell can call `notificationItems({ summary, queue })`.
* Every message ends up in `lb_communication_log` with `purpose = 'ELIMU_*'` and a row in `elimu_message_links`, so Umova’s own message history and reports see it.

## 6. Permission requirements

Core’s permission catalogue is fixed (24 keys), so Elimu defines **actions** and maps them to existing keys. `elimu_can(action)` (SQL) and `canElimu()` (JS) use the same map and
**prefer a native `elimu.<action>` key as soon as one exists** in the catalogue — adding keys later needs no Elimu change.

| Action | Umova key(s) today | Typical school role |
|---|---|---|
| `*.view`, `comms.history`, `comms.send` | `operations.use` or `settings.manage` | Teacher, secretary, registrar, principal |
| `students.manage`, `guardians.manage`, `admissions.manage`, `enrollment.manage`, `students.care` | `employees.manage` or `settings.manage` | Registrar, secretary, principal |
| `structure.manage`, `admissions.decide`, `settings.manage` | `settings.manage` | Principal / deputy |

Role guidance (also shown in Settings): Principal = owner/manager + settings; Registrar/Secretary = manager; Class teacher = cashier + `operations.use`; Bursar = manager (finance); Parent = not a staff login (future portal).
Owners always pass. Hidden menu items never replace database enforcement.

## 7. Expected data from other modules

| From | Elimu expects / offers |
|---|---|
| **AI 2** (Academics: subjects, exams, marks, reports cards) | Reads `v_elimu_student_directory` and enrolments for class lists; calls `registerModule({ key:'academics' })`; term results notification → purpose `ELIMU_RESULTS_AVAILABLE` (already defined) |
| **AI 3** (Attendance & timetable) | Roster from `elimu_enroll…`/directory; writes its own tables keyed `(tenant_id, student_id)`; absence follow-up via purpose `ELIMU_ABSENCE_FOLLOWUP` + `elimu_notify` |
| **AI 4** (Fees & finance) | Reads directory/enrolment for billing; links to `lb_customers` through the guardian’s customer link; reminders via `ELIMU_FEE_REMINDER`; amounts are passed in by the fee module — Elimu never computes money |
| **AI 5** (Reports, calendar, parent portal) | Reads the views; calendar events may use `ELIMU_EVENT_REMINDER`; portal users must be **linked** to a guardian, not stored as a second user table |

## 8. Core changes requested (none made here — each is optional and additive)

1. Permission keys `elimu.*` in `pos_all_permissions()` and role templates (removes the coarse mapping in §6).
2. `elimu` capability flag so the School menu is opt-in per tenant.
3. Message-type enum value for school messages (Elimu uses `OTHER` with `purpose = 'ELIMU_*'`), and a `CALL` channel — today calls live in `elimu_call_log`.
4. `comm_can_send()` currently decides by `recipient_kind`; Elimu writes `GUARDIAN`, which falls to the general branch (needs `settings.manage`, `finance.view` or `operations.use`). A native guardian branch would let a pure teacher role message guardians.
5. Possible issue to check in the host `saveTemplate`: whether it validates the template `purpose` against a fixed list; school template overrides use `ELIMU_*` purposes.
6. Notification bell: call `notificationItems()` from the host provider list.

## 9. Merge checklist

1. Run migrations 001–006 on **staging**; run `tests/run_sql_tests.sh` there.
2. Copy `elimu/` to `src/pos-erp/elimu/`; confirm the five import paths in `services/platform.js`.
3. Add the route and `ELIMU_NAV_MODULE`.
4. Create the first academic year, term and classes in Settings; add one student and one guardian; send a test message to yourself.
5. Confirm storage policies for `elimu-student-photos` on the live storage service.
