# Elimu: Academic Performance & Examinations module (AI 2)

Everything a school needs to go from **subjects and teachers → assessments → marks → grades → term results → report cards → telling guardians**, built to sit **inside** the existing POS/ERP without changing it.

| Area | What you get |
|---|---|
| Subjects | Code, name, category, compulsory/elective, active, order, level applicability; elective choices per student |
| Allocation | Subject → class / stream / year (/ term); teacher → subject; class teachers. Changes **end** the old row, history is kept |
| Assessments | Configurable types; assessment per year/term/class/stream/subject with date, max marks, weight, instructions, status; weight check (must total 100) |
| Marks entry | Grid with PRESENT / ABSENT / EXEMPTED / NOT_SUBMITTED / PENDING, remarks, bulk save of drafts, submit, unlock (reason), void, per-mark history. **Blank is never zero.** Works offline |
| Grading | Fully configurable schemes and bands (points, descriptors, remarks, pass flag), per-level or per-subject schemes, **versioned** so old results never change |
| Results | Weighted subject results, overall mean, grade, grade points, class/stream position, assessment breakdown; incomplete work is flagged, never graded |
| Report cards | DRAFT → REVIEW → APPROVED → PUBLISHED, class-teacher / head-teacher / subject remarks, frozen snapshot, print one / selected / class / stream via the POS print engine, corrections after publication create a new revision |
| Communication | Call / SMS / WhatsApp / Email guardian, 7 reusable academic templates with variables, editable before sending, tracked in the **existing** outbox |
| Security | Tenant RLS, owner-managed academic roles, teacher scope, no direct writes to marks/results, audit in `pos_audit_log` |

**Not here (by design):** students, guardians, admissions, classes, streams, years, terms, enrollment (Elimu foundation), attendance/timetable, fees, dashboards. They connect through the contract in [INTEGRATION.md](INTEGRATION.md).

## Documents
[ARCHITECTURE.md](ARCHITECTURE.md) · [INTEGRATION.md](INTEGRATION.md) · [CHANGELOG.md](CHANGELOG.md) · [AI2_CONTINUATION.md](AI2_CONTINUATION.md) (what is finished, what is not) · [tests/README.md](tests/README.md)

## Quick start (staging first)
1. `academic/schema/00_prereq_check.sql`, then the foundation adapter views (or the dev stub in a scratch DB), then every file in [schema/install_order.txt](schema/install_order.txt).
2. Mount routes in `POSApp.jsx`: `{elimuAcademicRoutes}` (INTEGRATION.md §6).
3. As owner open `/elimu/setup` → **Add defaults**, give staff their academic roles.

## Verification status (be honest about this)
Verified **in a scratch PostgreSQL 16** with POS stand-ins: 111 SQL scenarios acting as owner / head / exams officer / teachers / non-academic staff / another school under real RLS; 17 JS tests of the engines, report-card HTML and templates; 7 offline-store tests on a fake IndexedDB; a server-render check of the marks grid; the whole UI bundles with no missing imports/exports. **Not verified:** a real Supabase project, a real browser session, the real `comm_log_guard` trigger / `comm-send` function, load at school scale. See AI2_CONTINUATION.md.
