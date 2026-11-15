# ELIMU — School Management Module (foundation, AI 1)

A self-contained folder that adds school management **inside** Umova. It is not a second app and it does not copy the POS: it reads the
existing tenant, staff, permission, customer, communication and audit systems and adds only what a school needs on top.

**Nothing outside `elimu/` was created, changed, renamed or deleted.** The existing POS code and its SQL migrations are untouched.

## What is in this foundation

| Area | What it does |
|---|---|
| Students | Registration, admission number (auto or manual), preferred name, optional gender, private photo, configurable status, status history, minimal care notes (off by default). Duplicate warning before save. |
| Guardians | Many-to-many with students, relationship, primary/secondary rank, emergency contact, phones/emails (normalised by the database), per-channel consent/opt-out. One parent with three children = one record. Guardians are never logins. |
| Admissions | Application → Review → Accepted / Waitlisted / Rejected → Admitted → Enrolled. Atomic submit; decisions need approval permission; “Admit” creates the admission number, Active status and enrolment in one repeatable step. |
| Academic structure | Academic years (one current), terms, classes, streams, class teachers. |
| Enrolment | One row per student × year × period, history kept (moves and status changes never overwrite), duplicates blocked, only Active students can be enrolled. |
| Communication | SMS, WhatsApp, Email and Call from any student/guardian/application screen through reusable components, 15 purposes, three-level editable templates, consent aware, honest statuses, offline drafts. |
| Notifications | Event → *prepared reminder* queue. Nothing is ever sent automatically. |
| Read models | `v_elimu_student_directory`, `v_elimu_enrollment_history`, `v_elimu_data_quality`, `elimu_dashboard_summary()` for later modules and reports. |

Not built here (by design): exams/marks, attendance, timetable, fee accounting, payroll, a reporting engine. Their integration contracts are in `INTEGRATION.md`.

## Folder map

```
elimu/
  README.md  ARCHITECTURE.md  INTEGRATION.md  CHANGELOG.md
  schema/         001..006 SQL (run in this order)
  services/       platform.js (the ONLY file that imports from the host) + data services
  communication/  purposes, templates, resolver, consent, notification catalogue, ElimuCommunicationService
  components/     ElimuContactActions, ElimuMessageComposer, ElimuCommunicationPanel, forms, layout
  pages/          Dashboard, Students, StudentProfile, Guardians, Admissions, Classes, Communication, Settings
  hooks/  utils/  registry.js  routes.jsx  navigation.js  index.js
  tests/          SQL suite, JS unit tests, UI smoke test, scratch-Postgres helpers
```

## Deploying the database

Run once per Supabase project, in order, after the existing POS migrations (phases 7, 8, 10, 50a and 50 are required):

1. `001_elimu_academic_structure.sql`
2. `002_elimu_students.sql`
3. `003_elimu_guardians.sql`
4. `004_elimu_admissions.sql`
5. `005_elimu_enrollments.sql`
6. `006_elimu_communication_integration.sql`

Every file checks its prerequisites first and fails with a clear message if one is missing. Every file can be re-run safely.
Each school then calls `elimu_ensure_setup()` (the UI does this on first open) to seed default statuses and number sequences.

## Mounting the UI (at merge time)

Place the folder at `src/pos-erp/elimu/`. Then, in the host:
1. add `<Route path="/elimu/*" element={<ElimuRoutes />} />` to the POS router;
2. add `ELIMU_NAV_MODULE` (from `elimu/navigation.js`) to `navConfig.js` with a new opt-in `elimu` capability.

If the folder lives elsewhere, only the import paths at the top of `services/platform.js` change.

## Tests (all run on a scratch Postgres 16 and plain Node)

```
sh tests/pgctl.sh                                   # start a throwaway Postgres
POS_ERP_DIR=<pos-erp> sh tests/baseline.sh elimu_test   # POS baseline (phases 7, 8, 10, 50a, 50)
for f in schema/00*.sql; do psql -v ON_ERROR_STOP=1 -d elimu_test -f $f; done
sh tests/run_sql_tests.sh elimu_test                # 70 checks: two-school isolation, permissions, workflow, consent, honesty rules
ENGINE_RENDER=<pos-erp>/supabase/functions/_shared/comm/render.js \
  node --experimental-default-type=module --test tests/js/pure.test.js    # 9 groups incl. parity with the real comm engine
NM=<node_modules> sh tests/run_ui_smoke.sh          # renders every route + the communication components against host stubs
```

Last result: SQL 70/70 (also on a fresh database built from scratch), JS 9/9, UI smoke 19/19.

## Honest limits

* Tested against a scratch Postgres with the POS baseline built from the repo’s own stubs — **not** against a live Supabase project, PostgREST embeds or the real storage service. Run the SQL on staging first.
* The permission catalogue is closed in core, so Elimu maps its actions to existing keys for now (`INTEGRATION.md` §6). That works today but is coarser than ideal (e.g. “can edit students” = “can manage staff records”).
* No SMS/WhatsApp/email provider is configured by this module. With no provider, “Send through the school’s sending service” says so and the phone route (opens the app on the device) is used; those are recorded as *opened*, never *sent*.
