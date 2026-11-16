# Changelog

## Unreleased — Elimu shell, menu, settings hub and notifications (step 3)

### Added
- **`app/shell/ElimuShell.jsx`:** the one application shell. App bar (school logo or initials, school name, notification bell, account menu), grouped desktop sidebar
  (People / Academics / Daily operations / Finance & reports, Settings pinned), phone bottom tabs + More sheet, one scrolling area, offline banner.
  Also `states.jsx` (`LoadingState`, `ErrorState`, `EmptyState`, `PageContainer`), `branding.js`, `useSchoolLogo.js` (logo from the shared business profile), `icons.js`.
- **`app/navigation/navModel.js`:** pure menu model built on the existing `NAV_ITEMS` (one source of entries); visibility by module + action + owner-only, grouping, phone tab split,
  active entry by longest path prefix (`also` prefixes honoured).
- **`app/settings/`:** ONE Settings hub (`/settings`, `/settings/:section`). The catalog (`navigation/settingsRegistry.js`) owns labels and required actions; each module supplies its screen via
  `registerModule({ settingsSections })`. School profile, Academic setup, Attendance, Timetable, Fees & billing and Users & roles are sections. Existing deep links are kept.
- **`app/notifications/`:** bell with unseen count, notifications sheet and page. Built-in feed (dashboard counts, prepared-message queue) plus any module's `notificationProviders`;
  providers fail independently. Nothing sends a message.
- **`app/routes/ElimuAppRoutes.jsx`:** shell + notifications + settings + every registered module; `registry.js` gains `settingsSections`, `notificationProviders`, `registeredKeys`.
- **Tests:** `tests/app/app_nav.test.mjs` (13 pure checks); 32 new UI smoke checks (menu by role, settings hub and its permission refusals, every module route under the shell).

### Changed
- `ElimuApp` now mounts `ElimuAppRoutes` (shell) instead of its own header + the in-module layout; new props `base` and `homeHref`.
- `routes.jsx` gains `bare` mode (skips `ElimuLayout`). Default is unchanged, so `ElimuHost.jsx` and the `/elimu` mount keep working.
- "Umova home" and "Sign out" moved from the app bar into the account menu.

## Unreleased — Elimu session and sign-in layer (step 2)

### Added
- **`app/auth/` (the ElimuSession):** `identifiers.js` (school code / user ID / password validation, wrong-password brake), `roles.js` (role names and aliases from
  `utils/permissions.js`), `authAdapter.js` (adapter contract, `ElimuAuthError`, host reason -> Elimu error codes), `session.js` (builds the session; pure),
  `hostAdapter.js` (default adapter over the shared `POSAuthProvider`; the only auth file that imports the host), `ElimuAuthContext.jsx`
  (`ElimuAuthProvider`, `useElimuSession`, `useElimuAuth`). Exported from `index.js`.
- **Sign-in screen:** field-level validation, remembered school code (per device, nothing secret), show/hide password, short wait after repeated wrong
  passwords, "Incorrect user ID or password" for both unknown user and wrong password (never says which).
- **Tests:** `tests/app/app_core.test.mjs` (11 pure checks); 19 new UI smoke checks for every sign-in stage and the public exports.

### Changed
- `ElimuAuthGate` is driven by the session status. Only `authenticated` staff of a school open the app; a non-staff account, or one without a school, is treated as signed out.
- `ElimuApp` wraps `ElimuAuthProvider` and takes optional `adapter` / `accessOverride` props; the app lock signs out through the session.
- `ElimuAccessProvider` reuses an access value provided higher up instead of fetching `elimu_my_access` a second time.
- The Elimu permission fetch now starts only once someone is signed in.

### Fixed (tests only)
- `elimu_utils.test.mjs` skips, instead of failing, when `role_actions.snapshot.json` has not been exported (it now also looks in `tests/sql/`).
- The UI smoke test stubs `POSForcePasswordChange` with its own default-export stub.

## 1.0.0 — Foundation (AI 1)

### Added
- **Database (migrations 001–006):** academic structure, students with status history and optional care notes, guardians with contacts and per-channel consent,
  configurable admissions workflow with atomic submit and repeatable admit, history-safe enrolment, communication integration (message links, call log,
  notification rules and prepared-work queue), five security-invoker read models, dashboard summary.
- **Rules in SQL:** composite tenant foreign keys, RLS on every table, no destructive cascades or delete policies, one current academic year, no overlapping years,
  one live enrolment per student × year × period, stream-belongs-to-class, term-inside-year, admission transition matrix, ADMITTED only via the admit function,
  consent/opt-out enforced, delivery statuses reserved for the provider.
- **UI:** Dashboard, Students (list/profile/forms), Guardians, Admissions, Classes, Communication hub, Settings; mobile-first, built on the host UI kit.
- **Communication:** `ElimuContactActions`, `ElimuMessageComposer`, `ElimuCommunicationPanel`, `ElimuCommunicationService`, `ElimuTemplateResolver`; 15 purposes, three-level templates, offline drafts.
- **Extension points:** `registerModule`, `registerPurpose`, `registerEvent`.
- **Tests:** 70 SQL checks, 9 JS groups (including parity with the real comm engine), 19 UI smoke checks.

### Fixed during development
- Re-running `elimu_ensure_setup()` demoted the default status rows (the default-flag trigger ran before `ON CONFLICT DO NOTHING` skipped the insert); the seed now inserts only missing rows.
- Trigger firing order made explicit (`_1tenant`, `_2perm`, `_3guard`, `_4updated`).
- A WhatsApp-flagged number is now preferred over the primary number when messaging on WhatsApp (JS sort bug found by tests).
- Import paths for the communication service corrected (found by the UI smoke test).

### Known limitations
- Verified on a scratch Postgres with the POS baseline, not on a live Supabase project.
- Permissions use a mapping onto existing keys until core adds `elimu.*` keys (INTEGRATION.md §6, §8).
- No messaging provider is configured here; without one, messages are opened on the device and recorded as *opened*.
