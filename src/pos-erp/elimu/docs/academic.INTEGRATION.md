# Elimu Academic & Examinations: INTEGRATION

Read this before connecting the module to the Elimu foundation (AI 1), attendance/timetable (AI 3), fees (AI 4) or dashboards (AI 5).

**Golden rule used throughout:** the academic module never reads a foundation table directly. It reads **eight adapter views** (`elimu_ref_*`). Whoever owns the foundation maps their real tables to those views once; nothing else changes.

---

## 1. Tables I CREATE (17, all prefixed `elimu_`, all `tenant_id`-scoped with RLS)

| Table | Purpose | Schema file |
|---|---|---|
| `elimu_academic_roles` | Academic roles per staff member (ACADEMIC_ADMIN, HEADTEACHER, EXAMS_OFFICER, TEACHER). Owner-only writes. | academic/schema/10_core.sql |
| `elimu_academic_settings` | One row per school: absent / not-submitted policy, weight tolerance, head teacher name, motto, footer, display flags | 10_core |
| `elimu_subjects` | Subjects (code, name, category, compulsory/elective, active, order, applicable levels, optional grading-scheme override) | 10_core (+ column added by 20) |
| `elimu_subject_allocations` | Subject to class/stream/year(/term) and teacher. **History-preserving** (end + new row, never edit/delete) | 10_core |
| `elimu_class_teachers` | Class teacher per class(+stream)/year. History-preserving | 10_core |
| `elimu_student_subject_selections` | Which students take an *elective* | 10_core |
| `elimu_grading_schemes` | Grading schemes, **versioned**; locked once any result used them | grading/schema/20_grading.sql |
| `elimu_grading_rules` | Bands (grade, min%, max%, points, descriptor, remark, pass). DB exclusion constraint forbids overlaps | 20 |
| `elimu_assessment_types` | Configurable types (CAT, Quiz, Exam, …) | exams/schema/30_exams.sql |
| `elimu_assessments` | Assessment per year/term/class/stream/subject with max marks and weight | 30 |
| `elimu_marks` | One live mark per student per assessment; status PRESENT/ABSENT/EXEMPTED/NOT_SUBMITTED/PENDING | 30 |
| `elimu_mark_history` | Append-only before/after ledger of every mark change (DB trigger) | 30 |
| `elimu_term_results` | Overall result per **enrollment + term**, revisioned, lockable | report_cards/schema/40_results_reportcards.sql |
| `elimu_subject_results` | Per-subject result with literal grade, scheme version and assessment breakdown snapshot | 40 |
| `elimu_report_cards` | Report card workflow row (DRAFT/REVIEW/APPROVED/PUBLISHED/SUPERSEDED), frozen snapshot | 40 |
| `elimu_report_card_history` | Append-only workflow history | 40 |
| `elimu_message_links` | Links a row of the **existing** outbox (`lb_communication_log`) to student / guardian / academic record | communication/schema/60_communication.sql |

Plus about 50 functions (`elimu_*`, listed in section 5). There is **no** student, guardian, class, stream, year, term, enrollment, admission or teacher-profile table, and none is created.

## 2. Tables I EXPECT from the Elimu foundation: the adapter contract

Provide these as views named exactly as below (production: edit `academic/schema/05_foundation_adapter.template.sql`; dev: `academic/schema/dev/05_dev_foundation_stub.sql` fakes them over `elimu_dev_*` tables, **never run that in production**). Views must be `WITH (security_invoker = true)` and granted `SELECT` to `authenticated`; the underlying foundation tables must have RLS on `tenant_id = get_current_tenant_id()`.

| View | Columns (types matter) |
|---|---|
| `elimu_ref_academic_years` | id uuid, tenant_id uuid, name text, start_date date, end_date date, is_current boolean |
| `elimu_ref_terms` | id, tenant_id, academic_year_id uuid, name text, **sequence_no int**, start_date, end_date, is_current |
| `elimu_ref_classes` | id, tenant_id, name text, **level_code text NULL**, sort_order int |
| `elimu_ref_streams` | id, tenant_id, class_id uuid, name text |
| `elimu_ref_students` | id, tenant_id, **admission_number text**, **full_name text**, status text |
| `elimu_ref_enrollments` | id, tenant_id, student_id, academic_year_id, class_id, stream_id NULL, **status text**, start_date NULL, end_date NULL |
| `elimu_ref_guardians` | id, tenant_id, full_name text, phone text NULL, email text NULL |
| `elimu_ref_student_guardians` | tenant_id, student_id, guardian_id, relationship text NULL, is_primary boolean, **receives_academic_messages boolean** |

**Rules the foundation must honour (results depend on them):**

1. `tenant_id` is `pos_tenants.id`, the same value as `get_current_tenant_id()`. One POS tenant = one school.
2. **An enrollment = one student in one class (+ optional stream) for one academic year.** A class change = a **new** enrollment; the old one is closed (`status = COMPLETED` or `TRANSFERRED_OUT`, `end_date` set). **Never reuse or rewrite an enrollment id to point at another class**: every result hangs on `enrollment_id`.
3. Enrollment `status` values understood: `ACTIVE`, `COMPLETED`, `TRANSFERRED_OUT`, `WITHDRAWN`, `CANCELLED`. The marks roster uses `ACTIVE` + `COMPLETED` (plus anyone who already has a live mark). If the foundation uses other words, map them in the view.
4. `elimu_ref_classes.level_code` is optional; when present it is matched against `elimu_subjects.applicable_levels` and `elimu_grading_schemes.applicable_levels`.
5. The module stores foundation ids as plain `uuid` (no foreign keys), because the foundation tables do not exist yet. Once they do, the foundation owner **may** add FKs from `elimu_marks.enrollment_id`, `elimu_term_results.enrollment_id`, etc. (not written yet; see AI2_CONTINUATION.md item 7). Nothing in the module requires them.
6. **Teachers are POS staff (`pos_staff.id`).** `elimu_subject_allocations.teacher_staff_id` and `elimu_class_teachers.teacher_staff_id` are real FKs to `pos_staff`. If the foundation adds a teacher profile table, it should reference `pos_staff.id`.
7. Deleting/renaming a class, stream, term or year that has results is the foundation's responsibility to prevent (soft-delete). Result rows keep ids, not names; names are re-read when a card is built and frozen at approval.

## 3. POS services I CONSUME (reused, not duplicated)

| POS item | Used for |
|---|---|
| `get_current_tenant_id()`, JWT claims `pos_tenant_id` / `pos_staff_id`, `is_pos_session()`, `is_pos_owner()` | Tenant scoping, identity, owner check, in every RLS policy and function |
| `pos_staff`, `pos_tenants` | Teacher identity, active-staff and approved-business checks |
| `pos_audit_log` | **All** audit events (via `elimu_audit()`; section 7) |
| `lb_businesses` | School name, logo, address, phone, email on report cards |
| `lb_communication_log` (outbox) + `comm-send` edge function + `commEngineService.setStatus / sendViaProvider / deepLink / listTemplates` | **All** SMS / WhatsApp / email sending and tracking |
| `lb_communication_templates` | Per-school overrides of academic wording (`purpose = ELIMU_*`) |
| `supabase/functions/_shared/comm/render.js` (`renderText`) and `engine.js` (`findBusinessTemplate`), `utils/comm` (`checkFinal`, `contactFor`, `normalizeMsisdn`, `toFriendly/fromFriendly`) | Template rendering and last-safety-check rules, identical to the rest of the POS |
| `utils/printDocument.printDocument`, `utils/branding.safeLogoUrl` | Report-card printing / Save-as-PDF |
| `services/posSupabaseClient.posSupabase`, `auth/usePosErpAuth`, `components/CardKit`, `components/workspace/Sheet`, `components/network/networkKit` (`useLoad`, `useOnline`, `OfflineBanner`) | Client, auth, UI kit |
| `offline/netErrors` (`isNetworkFailure`, `isAuthFailure`), `offline/idGenerator.newUuid` | Offline error classification and ids |

## 4. Components I EXPOSE (import from `elimu/index.js`)

| Export | Use |
|---|---|
| `StudentAcademicHistory` `{studentId, publishedOnly=true}` | Drop into the student profile: Year → Term → Class → Subject → Assessments → Result |
| `GuardianContactActions` `{studentId, purpose?, context?, reference?}` | Call / SMS / WhatsApp / Email guardian buttons for any student page |
| `AcademicMessageSheet`, `NotifyGuardiansSheet` | Editable message composer; bulk "notify guardians" list |
| `MarkSheetGrid` | The marks grid (also usable by AI 3 for an exam-day register, say) |
| Pages (mounted by routes) | `AcademicHomePage`, `SubjectsPage`, `AllocationsPage`, `AcademicSetupPage`, `AssessmentsPage`, `MarkEntryPage`, `GradingSchemesPage`, `TermResultsPage`, `ReportCardsPage` |

## 5. Hooks / APIs I EXPOSE

**Hooks:** `useAcademicAccess()`, `useScope()` (year/term/class/stream selection from the adapter views), `useMarkSheet(assessmentId)`.
**JS services:** `academicService`, `examService`, `gradingService`, `reportCardService` (+ `nestHistory`), `printReportCards`, `printClassReportCards`, `academicCommService`, `elimuOffline`.
**Pure engines (no I/O, unit tested):** `lookupGrade`, `validateScheme`, `computeSubjectResult`, `computeOverall`, `rank`, `weightsOk`, `reportCardHtml`.
**Database RPCs (`authenticated`, all permission-checked and tenant-scoped):**
setup `elimu_my_access, elimu_set_academic_role, elimu_list_staff, elimu_get_settings, elimu_seed_defaults, elimu_assign_subject, elimu_end_allocation, elimu_set_class_teacher, elimu_end_class_teacher, elimu_select_elective, elimu_end_elective` ·
grading `elimu_grade_lookup, elimu_validate_scheme, elimu_resolve_scheme, elimu_new_scheme_version, elimu_set_default_scheme` ·
exams `elimu_create_assessment, elimu_update_assessment, elimu_set_assessment_status, elimu_check_weights, elimu_get_mark_sheet, elimu_save_marks, elimu_submit_marks, elimu_unlock_marks, elimu_void_mark, elimu_mark_history_for` ·
results `elimu_compute_term_results, elimu_list_term_results, elimu_generate_report_cards, elimu_save_report_remarks, elimu_save_subject_remark, elimu_report_card_transition, elimu_bulk_transition, elimu_open_correction, elimu_correct_published_mark, elimu_get_report_cards, elimu_list_report_cards, elimu_student_history, elimu_report_payload` ·
communication `elimu_student_contacts, elimu_guardian_targets, elimu_link_message, elimu_message_history, elimu_staff_covers_student`.
Internal-only (REVOKEd from clients): `elimu_audit`, `elimu_compute_one`, `elimu_rank_class`.

## 6. Routes I ADD and how to mount them

`elimu` · `elimu/subjects` · `elimu/allocations` · `elimu/setup` · `elimu/assessments` · `elimu/my-assessments` · `elimu/marks/:assessmentId` · `elimu/grading` · `elimu/results` · `elimu/report-cards`

**The only change needed outside `elimu/` (not applied; the module touches no existing file):**
```jsx
// POSApp.jsx
import { elimuAcademicRoutes } from './elimu/routes';
...inside the existing <Routes>...   {elimuAcademicRoutes}
```
Optionally add `ELIMU_ACADEMIC_NAV` (`elimu/routes.jsx`) to `navigation/navConfig.js` `MODULES`. Pages check access themselves, so `ROUTE_PERMISSIONS` need not change.

**Permissions.** The POS permission catalogue is a closed list guarded by a CHECK constraint, so extending it would mean editing existing functions. Instead the module uses `elimu_academic_roles`, managed **only by the business owner** (Academic set-up → Roles). The single source of truth is the function `elimu_can(action)`:

| Action | Owner | Head teacher | Academic admin | Exams officer | Teacher |
|---|:-:|:-:|:-:|:-:|:-:|
| config (subjects, types, schemes, allocations, settings) | ✓ | ✓ | ✓ | | |
| see all assessments / marks / results | ✓ | ✓ | ✓ | ✓ | own subjects only* |
| create assessments / enter marks | ✓ all | ✓ all | ✓ all | ✓ all | **only allocated class+subject(+stream)** |
| unlock marks, lock assessment, compute results, review cards | ✓ | ✓ | ✓ | ✓ | |
| approve / publish report cards | ✓ | ✓ | ✓ | | |
| **correct a published result**, head remarks | ✓ | ✓ | | | |
| class-teacher remarks | ✓ | ✓ | ✓ | ✓ | the class teacher |

\* A class teacher also sees their own class's results and report cards. Teachers are `pos_staff` with a POS role of `cashier` (least privilege); because the POS function `comm_can_send` lets staff with `operations.use` message non-customer recipients, cashier-template teachers can use the message buttons. If a school makes teachers `hr_officer`, they cannot (see section 8, optional patch B).

## 7. Audit events written to `pos_audit_log` (`entity_type` = `elimu_*`, `actor_id` = `pos_staff.id`)

`ASSESSMENT_CREATED/EDITED/OPEN/LOCKED/CANCELLED/DRAFT`, `MARKS_SAVED`, `MARKS_SAVED_AND_SUBMITTED`, `MARKS_SUBMITTED`, `MARKS_UNLOCKED`, `MARK_VOIDED`, `RESULTS_COMPUTED`, `RESULT_FINALIZED`, `RESULT_APPROVED`, `RESULT_APPROVAL_WITHDRAWN`, `REPORT_CARD_SENT_BACK`, `REPORT_CARD_PUBLISHED`, `PUBLISHED_RESULT_CORRECTION_OPENED`, `PUBLISHED_RESULT_CORRECTED`, `SUBJECT_ALLOCATED`, `SUBJECT_ALLOCATION_ENDED`, `CLASS_TEACHER_ASSIGNED`, `ACADEMIC_ROLE_CHANGED`, `GRADING_SCHEME_VERSIONED`, `GRADING_DEFAULT_SET`, `ACADEMIC_DEFAULTS_SEEDED`.
Row-level before/after detail lives in `elimu_mark_history` (every mark) and `elimu_report_card_history` (every workflow step), written by database triggers so no code path can skip them. Per-mark rows are deliberately *not* duplicated into `pos_audit_log` (one batch event per save keeps it readable).

## 8. Communication dependencies

* Messages are rows in `lb_communication_log` with `message_type = 'OTHER'`, `purpose = 'ELIMU_*'`, `recipient_kind = 'GUARDIAN'`, `reference_type = 'elimu_report_card' | 'elimu_student' …`, and are linked to student/guardian by `elimu_message_links`. Real delivery state is read straight from the outbox, so "queued", "opened on phone", "failed" are shown truthfully.
* Purposes: `ELIMU_RESULT_PUBLISHED, ELIMU_REPORT_CARD_AVAILABLE, ELIMU_EXAM_REMINDER, ELIMU_ACADEMIC_CONCERN, ELIMU_PERFORMANCE_IMPROVEMENT, ELIMU_PARENT_MEETING, ELIMU_ACADEMIC_ANNOUNCEMENT`. Other modules must use their own prefix (e.g. `ELIMU_FEES_`), because `elimu_message_links` only accepts `ELIMU_%`.
* `comm-send` re-checks "is the underlying transaction still current" using the POS purposes. For `ELIMU_*` it finds no recipient record and returns REVIEW, which does **not** block sending (verified by reading `dispatcher.evaluateJob`). Not exercised against a live function.
* **Observed in the existing POS (not changed, not mine):** `commEngineService.record()` writes the purpose key into `lb_communication_log.message_type`, which is an enum in the repo's SQL (`phase7`). Academic code avoids the issue by always writing `'OTHER'`. Worth checking whether the live DB column was widened.
* **Offline messaging:** not queued. Offline you can write the message and use **Call**; recording/sending requires a connection, and the UI says so. Nothing is ever shown as sent that was not.
* **Optional patch A (existing file):** `comm_can_send`: add a `GUARDIAN` branch if teachers are not `operations.use` holders.

### Optional patch B: shared offline outbox (existing file)
Elimu keeps its own small IndexedDB store because `offline/syncEngine.js`'s `drain()` marks any unknown outbox `kind` as `FAILED`. If you prefer one queue: export a `registerOutboxHandler(kind, fn)` from `syncEngine.js`, register `elimu_marks` there, and replace `elimuOffline.syncAll` with it. Not needed for the module to work.

## 9. What AI 3 (attendance & timetable) needs to know
* "Who teaches what, where" already exists: `elimu_subject_allocations` (subject, class, stream, year, optional term, `teacher_staff_id`, ACTIVE/ENDED) and `elimu_class_teachers`. **Do not create a second teacher-subject table**; read these (SELECT is allowed to any academic role). Timetable slots should reference `subject_id` + `class_id`/`stream_id` (and may store an `allocation_id` if you want to).
* Subjects live in `elimu_subjects`; a timetable should only offer ACTIVE subjects.
* Nothing in this module reads attendance. If report cards should show attendance, add it to the payload in `elimu_report_payload()` (one jsonb key) and to `reportCardHtml.js`. That is an extension point, not built.
* Use the same enrollment rule (section 2, rule 2) for attendance so a class change does not rewrite attendance either.

## 10. What AI 4 (fees & school finance) needs to know
* The module **does not withhold results for unpaid fees**. If the school wants that, the natural gate is the `APPROVED → PUBLISHED` step in `elimu_report_card_transition` and the print step. Suggested contract (not implemented): fees provides `elimu_ext_may_release_report(p_student uuid) returns boolean`; the academic function would call it when it exists.
* Fee reminders must use their own outbox purposes (`ELIMU_FEES_*`) and their own link table; `elimu_message_links` is academic only.
* Academic roles do not grant any finance access, and POS finance permissions do not grant academic access.

## 11. What AI 5 (dashboard, reporting, administration) needs to know
* Safe tables to read for KPIs (all indexed by `tenant_id` + scope): `elimu_term_results` (`is_current`), `elimu_subject_results`, `elimu_marks` (`voided_at IS NULL`), `elimu_assessments`, `elimu_report_cards` (status counts), `elimu_message_links` + `lb_communication_log`. RLS limits rows to staff with access, so a dashboard for an admin works through normal queries.
* Always filter `is_current = true` on results and `voided_at IS NULL` on marks; old revisions/voided rows are history.
* Audit feed: `pos_audit_log` where `entity_type LIKE 'elimu_%'` (events in section 7).
* Result states: `completeness` ∈ COMPLETE / INCOMPLETE / NO_ASSESSMENTS / WEIGHTS_INVALID; term `is_complete`, `locked_at`; card `status`. "Marks outstanding" = `elimu_marks` rows `entry_status = 'DRAFT'` or roster students with no row (`elimu_get_mark_sheet` summary).
* Administration screens to host: the academic role editor lives in `AcademicSetupPage`; import it rather than rebuilding.
* Not provided: pre-aggregated views, charts, trend analytics.

## 12. Setup order
1. Run `academic/schema/00_prereq_check.sql` (read-only).
2. Install the foundation adapter views (section 2).
3. Run the files in `schema/install_order.txt`.
4. Owner opens `elimu/setup` → adds defaults → gives roles. Mount the routes (section 6).
