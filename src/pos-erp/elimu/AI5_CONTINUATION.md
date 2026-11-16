# Elimu AI5 Continuation — UI Phase 1

Updated: 2026-11-16

## Current project baseline

This continuation belongs to the Elimu module mounted by the host application at `/school/*`.
The parent portal is mounted separately at `/parent/*`. The existing AI1–AI4 modules and their
services are retained; this phase does not rebuild them.

## Completed in this phase

### UI — school dashboard first pass
- Refreshed `pages/ElimuDashboard.jsx` into a responsive school overview.
- Added a clear school/academic-period hero, KPI cards, class enrolment bars, attention queue,
  permission-aware quick links, and a data-quality section.
- Reused existing `studentService.dashboard()`, `communicationService.queue()`,
  `notificationItems()`, `quickActions()`, Elimu permission checks and CardKit `FitPage`.
- Kept dashboard figures grounded in the existing foundation summary. No attendance,
  academic-performance or finance figures were fabricated or independently recalculated.
- Added visible error handling for reminder-queue failures rather than presenting a failed
  request as an empty queue.
- No database migration or POS core change was made.

## Verification actually performed

- `node --experimental-default-type=module --test pos-erp/elimu/tests/js/pure.test.js`
  - 8 passed, 0 failed, 1 skipped (engine parity requires `ENGINE_RENDER`).
- `node --experimental-default-type=module --test pos-erp/elimu/tests/engines.test.js`
  - 17 passed, 0 failed.
- TypeScript JSX parse check for `pages/ElimuDashboard.jsx` using `tsc`
  - passed.
- No full host-app build, browser test, SQL scenario suite, or live Supabase test was run.
  The supplied POS archive does not include the full app package manifest/dependency setup,
  and this environment has no `psql`, `pg_ctl`, or Docker.

## Audit findings to carry forward

1. **Unified dashboard is not yet complete.** The refreshed dashboard currently shows the
   existing student/admissions/guardian summary. It does not yet show verified attendance,
   academic, finance, calendar, or cross-module indicators. Do not fabricate these; add
   authoritative service/RPC aggregations and reconcile them with module reports first.
2. **Unified reports area is incomplete.** Academic, attendance, and finance reports exist in
   their own module areas. A common report catalogue/filter/preview experience is still needed.
3. **Global Settings are partial.** Foundation settings exist, but attendance and finance
   configuration still live in module-specific areas. Consolidate navigation and presentation
   without duplicating settings storage.
4. **Communication consent (C8) remains open.** Direct inserts into `lb_communication_log`
   remain in:
   - `communication/attendance/guardianComms.js`
   - `communication/academic/academicCommService.js`
   - `communication/timetable/changeNotices.js`
   - `communication/finance/financeComm.js`

   These paths must be migrated to the central consent-enforcing RPC/service. UI eligibility
   checks alone are not a substitute for database enforcement.
5. **Communication layers (C14) remain duplicated.** Keep module-specific composers as
   presentation components if useful, but route all persistence and delivery through one
   shared service.
6. **Parent portal is an initial implementation, not production-verified.** It uses a separate
   phone-OTP Supabase client and SECURITY DEFINER RPCs linked to existing guardian/student
   relationships. The current linking function auto-links by verified phone match. Before
   enabling it for real families, require an explicit school-side verification/approval process
   and test cross-guardian, multi-child, consent and tenant isolation against staging.
7. **Offline integration (C15) remains unverified.** Elimu has module-specific IndexedDB queues.
   Do not merge or delete stores until replay, duplicate prevention, conflict handling,
   tenant/user isolation and failure visibility have been tested with the actual host sync engine.
8. **Foreign-key hardening (C20) remains open.** Run diagnostics against a staging copy of the
   real database first. Produce a report before adding constraints; do not make destructive
   changes or run migrations against production.
9. **Notifications are not the same as external delivery.** The existing Elimu queue is prepared
   work. Confirm host bell integration and preserve accurate queued/opened/sent/provider-delivered
   statuses.

## Recommended next work — continue in parts

1. Complete the UI shell/navigation refresh (desktop sidebar/topbar, mobile bottom navigation,
   consistent page spacing and states) without changing route or permission behaviour.
2. Build the unified dashboard data layer using authoritative AI2/AI3/AI4 services or safe RPCs;
   add date/year/term/class filters only where the source functions support them.
3. Create the unified Reports landing page, linking existing report builders rather than replacing
   them.
4. Refactor all four direct communication-log writers to the central consent-enforcing path and
   add tests for opted-out, missing-consent, emergency override and provider failure.
5. Consolidate Settings navigation and notification-centre access.
6. Harden and staging-test the parent portal account-linking workflow.
7. Verify offline integration and prepare C20 FK diagnostics/migrations.
8. Run full SQL and browser/host tests in the real staging environment.

## Safety boundary

No live database migrations were run. No claim of production readiness is made.

## Phase 2 — navigation and application shell (2026-11-16)

### Completed
- Reworked `components/ElimuLayout.jsx` into a responsive two-region application shell.
- Desktop (`md` and wider): added a persistent left sidebar with workspace and school-management sections, permission-filtered module links, active-page indication, and an online/offline indicator.
- Mobile: retained the existing bottom tabs and More sheet, including safe-area padding and the existing route targets.
- Preserved the existing `NAV_ITEMS`, module registry, `useElimuAccess()` checks, `basePath` routing, `OfflineBanner`, and `Outlet` route rendering.
- Expanded the main content area from a narrow fixed-width layout to a responsive workspace with a larger maximum width.
- No route definitions, permission rules, data services, database objects, or POS core files were changed.

### Verification performed for Phase 2
- TypeScript `transpileModule` JSX parse check for `components/ElimuLayout.jsx`: passed.
- `node --experimental-default-type=module --test elimu/tests/engines.test.js`: 17 passed, 0 failed.
- `node --experimental-default-type=module --test elimu/tests/elimu_utils.test.mjs`: could not complete; Node 22 rejected an existing extensionless relative import (`attendance/utils/lateness.js` imports `shared/utils/time` without a file extension). This is an environment/module-resolution issue in the existing test path; no test or source assertion was changed to hide it.
- No browser/responsive visual test, full host-app build, live Supabase test, or SQL migration test was run.

### Next UI phase
1. Refresh the Students list, student profile and Admissions screens to use consistent page headers, filters, responsive tables/cards, and action placement.
2. Apply the same page pattern to Academics, Attendance and Finance while retaining each module's current services and permission guards.
3. Add a consistent mobile page-title/action treatment without introducing a second scroll container.

### Carry-forward security and integration issues
All AI5 audit findings above remain open. In particular, the navigation refresh is presentation-only and does not resolve communication consent (C8), duplicated communication layers (C14), offline integration (C15), parent portal account-linking verification, or foreign-key hardening (C20). No migrations were run and no production-readiness claim is made.

## Phase 3 — Students, guardians, admissions and classes UI (2026-11-16)

### Completed
- Refreshed the Students directory with a clearer record summary, improved search/filter grouping,
  larger student avatars, stronger profile navigation and more readable guardian context.
- Refreshed the student profile header into a compact identity panel, retained the existing
  Overview / Guardians / History / registered-module tabs, and improved tab/action treatment.
- Refreshed the Guardians directory with record summaries, clearer contact/link counts and a
  stronger profile action. Guardian profile consent editor, contact actions and communication
  history remain in place.
- Refreshed Admissions with application totals, clearer search/stage filters, improved application
  cards and a more visible review action. Existing stage transitions, decision permissions,
  application submission, admission and enrolment services are unchanged.
- Refreshed Classes & Streams with a searchable local filter, In use / Archived / All scopes,
  active/total class summaries and clearer class cards. Filtering uses the already-loaded class
  collection; it does not introduce new service or database behaviour.
- Preserved the existing service calls, route paths, permission checks, forms, consent components,
  admissions workflow, and roster logic. No SQL, schema, data-service, or POS core changes.

### Verification performed
- TypeScript `transpileModule` JSX parse checks for all five changed pages: passed.
- `node --experimental-default-type=module --test elimu/tests/engines.test.js`: 17 passed, 0 failed.
- `node --experimental-default-type=module --test elimu/tests/js/pure.test.js`: 8 passed, 0 failed, 1 skipped (engine parity requires `ENGINE_RENDER`).
- `elimu/tests/offline.test.mjs` could not start because `fake-indexeddb` is not installed in this
  supplied environment. This is a missing test dependency, not a reported assertion failure.
- Browser rendering, responsive interaction, full host-app build, live Supabase and SQL tests were
  not performed. The UI smoke script requires host dependencies (React, React Router, esbuild and
  lucide-react) that are not installed in this environment.

### Next recommended phase
- Refresh the Academics, Attendance and Finance page experiences, reusing existing module services
  and permission guards. Keep their workflows and calculations unchanged; focus on layout,
  filtering, empty/loading/error states and responsive actions.

### Carry-forward
- All AI5 integration/security findings in this document remain open, including communication
  consent enforcement (C8), duplicated communication persistence (C14), parent portal verification,
  offline sync integration (C15), and foreign-key diagnostics/hardening (C20). No production
  readiness claim is made and no live migrations were run.

## Phase 4 — Academics, Attendance and Finance UI (2026-11-16)

### Completed
- Refreshed the Academics landing page with a clearer workspace introduction and responsive
  action tiles. The existing AccessGate, role-aware tile visibility and route targets are unchanged.
- Added local search and active/inactive filtering to Subjects. Filtering is performed against
  the already-loaded subject list; the existing academicService load/save operations and form
  fields are unchanged.
- Improved the Attendance dashboard date-selection header, added a permission-aware shortcut
  to the register-taking page, and made class completion rows easier to scan on small screens.
  The shortcut checks the existing `attendance.take_own` / `attendance.take_any` permissions.
  Existing attendance/calendar summary services and status calculations are unchanged.
- Refreshed Finance hub navigation into responsive feature cards while retaining the finance
  tree, visibleChildren permission filtering, route targets, and disabled/coming-soon handling.
- The Attendance register-taking workflow and Finance collection/account workflows were reviewed;
  their existing mobile-first and transactional layouts were retained rather than changing their
  operational behaviour in this presentation pass.
- No route definitions, permissions, calculations, services, database objects, SQL or POS core
  files were changed.

### Verification performed
- TypeScript `transpileModule` JSX parse checks for the four changed pages: passed.
- `node --experimental-default-type=module --test elimu/tests/engines.test.js`: 17 passed, 0 failed.
- `node --experimental-default-type=module --test elimu/tests/js/pure.test.js`: 8 passed, 0 failed,
  1 skipped (engine parity requires `ENGINE_RENDER`).
- Finance JS test suite could not complete in this environment: after enabling its extension
  resolver, startup stops because the host dependency `dexie` is not installed. No assertion
  failure was reported.
- No full host-app build, browser/responsive visual test, live Supabase test or SQL test was run.

### Carry-forward
- All earlier AI5 security/integration findings remain open: central communication consent
  enforcement (C8), duplicated communication persistence (C14), parent portal school-side
  account-link verification, offline sync integration (C15), and staging-first FK diagnostics /
  hardening (C20).
- The unified dashboard and unified reports catalogue are still not complete. Do not present
  module-only metrics as cross-school aggregates until authoritative sources are reconciled.
- No production-readiness claim is made and no live migrations were run.

## Phase 5 — reports catalogue and dashboard entry point (2026-11-16)

### Completed
- Added `pages/ReportsHubPage.jsx` as a unified reports catalogue with links to the existing
  Attendance reports, Academic results, Report Cards and Finance reports screens.
- Added the `/report-centre` route under the existing school shell and protected its entry with
  the existing `students.view` route action. Each destination retains its own module-level access
  checks and data services.
- Changed the Reports navigation item to open `/report-centre` rather than opening the Attendance
  report screen directly. Added a Reports centre quick action to the school dashboard.
- The catalogue explains that filters, data sources, export formats and permissions remain
  module-owned. It does not claim a cross-module total or silently merge unlike reporting periods.
- No report builders, calculation logic, SQL, schemas, service calls, route destinations inside
  the individual report screens, or POS core files were changed.

### Verification performed
- TypeScript `transpileModule` JSX parse checks for `ReportsHubPage.jsx`, `ElimuDashboard.jsx` and
  `routes.jsx`: passed.
- `node --experimental-default-type=module --test elimu/tests/engines.test.js`: 17 passed, 0 failed.
- `node --experimental-default-type=module --test elimu/tests/js/pure.test.js`: 8 passed, 0 failed,
  1 skipped (engine parity requires `ENGINE_RENDER`).
- The first JSX parser invocation used an unavailable global TypeScript path and did not run; it was
  rerun successfully using the installed Node 22 TypeScript package.
- No browser route-navigation test, full host-app build, live Supabase test or SQL test was run.

### Still outstanding after Phase 5
- A genuinely unified dashboard data layer with reconciled, authoritative attendance and finance
  summaries. The current school dashboard remains based on its existing student/admissions source.
- Shared date/year/term/class filters across reports; do not add until the relevant module services
  can support the same semantics.
- Central communication consent enforcement (C8), duplicated communication persistence (C14),
  parent portal account-link verification, offline integration (C15), and staging-first FK
  diagnostics/hardening (C20).
- Full browser, host build and staging verification. No live migrations were run and no production
  readiness claim is made.

### Recommended next phase
- Phase 6: audit and improve the notification centre and communication workflow, starting with
  tracing every send/log path and the central consent service. Treat security enforcement as the
  primary task; do not make a UI-only change that could imply consent is enforced when it is not.


## Phase 6 — communications centralisation and notification centre (2026-11-16)

### Completed in the supplied source tree
- Routed Attendance guardian-message recording through the existing `communicationService.record()` adapter and the `elimu_record_message` RPC contract. The attendance-specific follow-up/dedupe link is still recorded through `absenceService.recordContact()` after the central log id is returned.
- Routed Academic guardian-message recording through the same central adapter, then linked the resulting log row to the student/guardian with `elimu_link_message`.
- Registered Academic and Attendance purposes with the shared Elimu purpose registry so their message purposes are represented consistently in the shared catalogue.
- Routed Finance message creation through the central guardian-message adapter instead of inserting directly into `lb_communication_log`. The Finance composer now resolves the student's guardian/contact relationship before enabling preparation; missing or ambiguous guardian links fail closed. Finance's existing notification dedupe/attachment RPCs remain in use.
- Added a central log lookup helper to `ElimuCommunicationService` and made its record method reject missing guardian ids and non-Elimu purpose keys before invoking the database RPC.
- Improved the Communication page with prepared-work and active-rule counts, explicit status-honesty guidance, refresh action and queue/rule load-error visibility.

### Important boundary / still open
- Timetable change notices in this project are currently prepared only for teachers / class recipients (`NoticeSheet` excludes the guardian audience). They are internal staff/class notices, not guardian messages, so the guardian-consent RPC is not an equivalent drop-in. Their current shared-log insert remains pending a dedicated staff-notification service/RPC contract; do not treat it as guardian-consent compliant.
- The supplied ZIP does not contain the SQL source for the referenced foundation migrations 001–006 or the bodies of `elimu_record_message`, `elimu_link_message`, and related RPCs. Their runtime behavior, consent decision, tenant isolation, emergency override and transactional rollback could not be audited from this archive. The JS adapter calls the already-documented RPC contract, but this phase does not claim database enforcement was verified.
- Finance still performs its own notification dedupe registration before creating the central communication row. A failure after registration can leave a prepared notification registration without an attached log; transactional repair requires the corresponding SQL RPC/migration source.
- The local JS eligibility mirror remains a usability aid only. Database enforcement must remain authoritative.

### Verification performed
- `elimu/tests/engines.test.js`: 17 passed, 0 failed.
- `elimu/tests/js/pure.test.js`: 8 passed, 0 failed, 1 skipped (engine parity requires `ENGINE_RENDER`).
- Finance JS tests first hit an existing extensionless import in `finance/reports/reportBuilders.js`; after using a temporary Node resolver, test startup was blocked by the missing host dependency `dexie`. No full finance assertion suite was run. A focused mocked `prepareRecord` test passed: guardian id is required, dedupe is retained, and the central recording adapter is invoked.
- JSX parse checks and ZIP integrity are recorded in the Phase 6 delivery report.
- No browser test, host build, live Supabase test, staging consent scenario, provider delivery test or SQL migration was run.

### Remaining AI5 communication work
- Inspect and test the actual SQL body of `elimu_record_message` on staging for OPTED_OUT, NOT_ASKED with explicit consent required, ALLOWED, emergency override, cross-tenant guardian/contact ids and provider failures.
- Make the log + module link + finance dedupe attachment atomic, or add a safe repair/retry operation.
- Replace timetable staff/class notices with a shared staff-notification service, preserving its per-change dedupe.
- Verify that all guardian send routes (including legacy attendance offline replay) reach the central RPC and that provider send cannot bypass consent.
- Verify host bell integration and reconcile queued/opened/sent/provider-delivered states against the actual POS communication engine.

No live migrations were run and no production-readiness claim is made.


## Phase 7 — parent portal fail-closed sign-in and settings workspace (2026-11-16)

### Completed
- Removed the automatic `elimu_parent_link` call from the parent OTP sign-in flow. A verified phone number proves control of that phone only; it is not proof of a guardian relationship and must not create access to student records.
- Removed the client wrapper for the automatic-link RPC so the parent UI cannot invoke it accidentally. Existing school-approved links are still read through `elimu_parent_children` and the existing read RPCs.
- Updated the sign-in and no-linked-child states to explain that school verification is required before child records become visible.
- Added a Settings workspace section linking to the existing Attendance settings and Timetable setup routes. These are navigation shortcuts only; settings remain stored and permission-checked by their existing modules.
- No schema, SQL, RLS policy, data service, route permission, or POS core changes were made.

### Security boundary / work still required
- This is a fail-closed client-side improvement, not a complete school approval workflow. The supplied project does not include the SQL definition of `elimu_parent_link`, parent-link tables/policies, or a school-side approval RPC. Therefore no approval queue, approve/reject action, or server-enforced pending state can safely be implemented or verified from this archive alone.
- Before production use, provide the relevant migrations/RPC definitions and implement a tenant-scoped school approval workflow. The database must ensure parent read RPCs only return students connected by an approved guardian-student relationship; direct phone matches must never be sufficient.
- Cross-guardian, sibling, multiple-school/tenant, revoked-link, consent, and stale-session cases still require staging tests.
- Finance/global settings navigation is still module-specific where no verified settings route was found in the supplied route registry. No speculative route was added.

### Verification performed
- TypeScript `transpileModule` parse checks for `parent/ParentApp.jsx`, `parent/parentClient.js`, `pages/ElimuSettingsPage.jsx`, and `routes.jsx`: passed.
- `node --experimental-default-type=module --test elimu/tests/engines.test.js`: 17 passed, 0 failed.
- `node --experimental-default-type=module --test elimu/tests/js/pure.test.js`: 8 passed, 0 failed, 1 skipped (engine parity requires `ENGINE_RENDER`).
- No browser, host build, SQL, Supabase, or staging test was run.
- No live migrations were run and no production-readiness claim is made.

## Phase 8 — offline integration and data-integrity diagnostics (2026-11-16)

### Completed — offline reliability and isolation
- Hardened the Exams mark-sheet offline store with a Dexie v2 tenant-aware schema. New cached sheets and queued mark edits carry the active `tenantId`; read, list, count, resolve and sync operations now require that tenant and filter records before exposing or replaying them.
- Legacy v1 pending mark rows have no tenant identifier. They are intentionally excluded from display and replay rather than being assigned to whichever school signs in next. The Mark Entry screen now warns when such unscoped rows are detected. An administrator must investigate before any manual recovery or browser-storage cleanup.
- Added a `SYNCING` state for exam mark batches and recovery of interrupted `SYNCING` rows on the next pass. Network/auth failures restore the batch to `PENDING`; server refusals and row-level conflicts remain visible for resolution.
- Added a Web Locks guard and an in-process fallback guard for exam sync to reduce duplicate concurrent submissions across tabs / unsupported browsers.
- Attendance offline submit deduplication now includes `tenantId`, not only `sessionId`. Queued guardian messages use a deterministic client reference and are deduplicated while pending, syncing or already synced.
- Attendance drain now has a cross-tab Web Locks guard and same-tab fallback guard.
- Removed the runtime in-memory fallback from `getOfflineAttendance()`. If the POS Dexie store cannot be opened, the operation now fails visibly instead of telling staff work is saved when it would disappear on reload. `memoryStore()` remains available for explicit unit tests only.
- Added a tenant-isolation and duplicate-message regression case to the attendance offline utility test.

### Completed — foreign-key audit preparation
- Added `elimu/docs/phase8_fk_diagnostics.sql`, containing read-only catalog inventory for current Elimu foreign keys, `_id` columns lacking FK coverage, a tenant-scoped orphan check for the documented attendance-record/session relationship, and a candidate relationship inventory.
- The script contains SELECT statements only. It does not add constraints or modify data.
- No FK migration was drafted because the supplied archive does not include the Elimu foundation / academic / attendance / finance DDL that defines all physical parent tables, composite tenant keys, history semantics and delete policies. Views such as `elimu_v_roster` cannot be FK targets.

### Verification performed
- `elimu/tests/engines.test.js`: 17 passed, 0 failed.
- `elimu/tests/js/pure.test.js`: 8 passed, 0 failed, 1 skipped (engine parity requires `ENGINE_RENDER`).
- `elimu/tests/elimu_utils.test.mjs`: 17 passed, 0 failed when run with a temporary Node ESM extension resolver and the existing role-action snapshot from the review workspace. This included the new tenant-specific submit dedupe and duplicate guardian-message queue checks. The temporary resolver/snapshot link were not added to the project archive.
- `elimu/tests/offline.test.mjs` was updated for the tenant-aware API and now includes a cross-tenant cache/queue isolation test, but could not run because `fake-indexeddb` is not installed in the supplied environment. Dexie v2 upgrade behavior and IndexedDB recovery therefore still require browser/staging verification.
- JSX parsing, full host build, browser offline/online transition tests, SQL execution and staging Supabase tests remain outstanding.

### Important carry-forward / migration caution
- Legacy unscoped exam mark edits are deliberately held. Do not automatically backfill tenant ids based only on the currently signed-in user; recovery requires an independently verified assessment-to-tenant mapping and explicit operator review.
- Finance fee drafts already include tenant/business ids and use a stable draft id as the payment client reference. Their retry/recovery behavior still needs browser and staging testing, especially interrupted `SUBMITTING` records and server idempotency.
- Attendance offline queues still rely on the documented server idempotency / conflict contract. The SQL function bodies are not in the supplied archive and were not verified here.
- The FK SQL is a diagnostic inventory, not a constraint migration. Run it on a staging clone, review orphan candidates, confirm physical parent tables and tenant-aware key semantics, then prepare a separate reversible migration only after schema-owner approval.
- No live migrations, deletes, or production database changes were run. No production-readiness claim is made.

## Phase 9 — parent approval workflow groundwork (2026-11-16)

### Completed safely from the supplied source
- Re-inspected the Phase 8 baseline and confirmed the parent portal uses a dedicated Supabase auth client and calls `elimu_parent_children` plus separate `elimu_parent_*` read RPCs.
- Confirmed OTP verification does not call a link RPC. The previous Phase 7 removal of automatic `elimu_parent_link` remains intact.
- Improved the unlinked-parent state with a clear school-approval status, a practical school-office verification checklist, and an explicit warning never to share one-time sign-in codes.
- Added `elimu/docs/phase9_parent_approval_design.md` with the required server-side security contract, state lifecycle, tenant/approver requirements, staging acceptance tests and exact missing-schema blockers.
- Added `elimu/tests/parent-approval-contract.test.mjs` to guard against reintroducing automatic linking during OTP and to check the unlinked-parent safety guidance.

### Not implemented / hard blocker
- No parent request table, approval queue, approve/reject/revoke RPC, or database policy was added. The supplied archive has no SQL definitions for guardian/student/tenant foundation tables, the `elimu_parent_*` RPC bodies, their RLS policies, or an authoritative staff permission/tenant resolver. The actual tenant and history semantics cannot be inferred safely from client-side service calls.
- The existing staff Guardian profile can create/end guardian-student relationships directly. Until the schema owner supplies the authoritative DDL and permission model, this cannot safely be converted to a pending/approved state machine without risking changes to the canonical school relationship workflow.
- Parent read RPCs must be audited and tested on staging to prove each call independently checks the authenticated parent, active approved link, and tenant. This archive does not prove that behavior.

### Verification
- `node --test elimu/tests/parent-approval-contract.test.mjs`: 3 passed, 0 failed.
- TypeScript `transpileModule` JSX parse check for `parent/ParentApp.jsx`: passed.
- JSX parse and existing engine/pure logic suites run where the available environment permits; dependency/environment blockers are reported separately.
- No live migrations, SQL writes, or production changes were run. Phase 9 is groundwork, not a completed server-enforced approval workflow or production-readiness sign-off.
