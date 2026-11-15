# Changelog

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
