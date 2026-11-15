# AI 2: Continuation & honest status

I did **not** hit a context/output limit: the vertical slice below is finished and tested to the extent stated. This file exists so the next person starts from facts, not from my summary.

## 1. Completed (files exist and were exercised)

| Area | Files | How it was verified |
|---|---|---|
| SQL: tables, triggers, RLS, ~50 functions | `academic/schema/{00,05(template),10,15}`, `grading/schema/20`, `exams/schema/{30,31}`, `report_cards/schema/{40,41,42}`, `communication/schema/60`, `schema/install_order.txt` | Installed **twice** (re-runnable) in scratch Postgres 16; **111 scenarios** (`academic/schema/tests/scenarios.sql`) run as real `authenticated` sessions under RLS |
| Dev foundation stub + adapter views | `academic/schema/dev/05_dev_foundation_stub.sql` | Used by the scenarios |
| Pure engines | `grading/utils/gradingEngine.js`, `report_cards/utils/resultEngine.js`, `exams/utils/markValidation.js`, `report_cards/utils/reportCardHtml.js` | 17 JS tests; numbers identical to the SQL's |
| Services | `academic/services/{rpc,academicService}.js`, `exams/services/examService.js`, `grading/services/gradingService.js`, `report_cards/services/{reportCardService,printReportCards}.js`, `communication/academic/academicCommService.js` | Bundled (imports/exports resolve). **Never called against a real Supabase** |
| Templates | `communication/templates/academicTemplates.js` | Tested with the POS's real `renderText` / `findBusinessTemplate` |
| Offline | `offline/elimuOfflineStore.js` | 7 tests on fake IndexedDB, using the POS's real `netErrors` / `idGenerator` |
| UI | 9 pages, `MarkSheetGrid`, `AcademicMessageSheet`, `GuardianContactActions`, `NotifyGuardiansSheet`, `StudentAcademicHistory`, `AccessGate`, `ScopeBar`, `Note`, hooks, `routes.jsx`, `index.js` | Whole module bundles with no missing imports/exports; the grid was server-rendered and asserted (9 checks); UI-kit prop names checked against `CardKit` (found and fixed 3 mismatches). **Never opened in a browser** |
| Docs | `README, ARCHITECTURE, INTEGRATION, CHANGELOG, tests/README` | |

## 2. NOT done (exact gaps)

1. **UI for editing message wording.** `academicCommService.saveBusinessTemplate()` and `friendly/unfriendly` exist; no page calls them. Needed: a "Message wording" section (purpose + channel picker, preview with sample data, save). Model it on the POS's existing template editor.
2. **UI for subject-teacher remarks.** RPC `elimu_save_subject_remark` + `reportCardService.saveSubjectRemark` exist; `ReportCardsPage`'s Remarks sheet only edits class-teacher and head remarks.
3. **UI for correcting a published mark.** `reportCardService.correctPublishedMark()` / `elimu_correct_published_mark` are tested in SQL; the page's **Correct…** button only *opens* a correction (new DRAFT revision). Needed: a small form (assessment picker, status, marks, reason) on the correction card.
4. **Elective selection UI** (`academicService.selectElective/endElective` exist). Until built, electives are only usable by calling the RPC.
5. **Bulk marks import** (paste / CSV). The save API takes up to 1000 rows, so this is UI + parsing only.
6. **Subject-level positions, class averages, trend/analytics.** Not built (overall class/stream positions are).
7. **Optional foundation FKs script** (`95_foundation_fks.template.sql`): mentioned in INTEGRATION §2 rule 5, not written. Nothing depends on it.
8. **Guardian-facing access.** Staff-only today. "Results published" notices tell guardians to contact the school; there is no guardian portal or link.
9. **Fee-based release gate** (INTEGRATION §10) and **attendance on the card** (§9): extension points described, not implemented.
10. **Host wiring not applied** (by instruction not to modify existing files): the two lines in `POSApp.jsx` and an optional nav entry.
11. **Offline limits:** only marks entry. A sheet must have been opened online once on that device; creating assessments, submitting, results, report cards and messaging need a connection (messages are *not* queued offline). Roster changes while offline are not seen.
12. **Accessibility, translations, visual polish and small-screen layout** of the grid (it scrolls horizontally) are unreviewed.

## 3. Not verified: do these before production
* Run all SQL on a **Supabase staging** project. Confirm the API role is `authenticated` (grants and the test harness assume it) and that `btree_gist` can be created.
* Replace the dev stub with the real adapter views once AI 1's tables exist; re-run the SQL scenarios with the real foundation (the scenarios' fixtures insert into `elimu_dev_*`; they will need a small fixtures switch).
* Load the **real** `comm_log_guard` trigger and the **real** `comm-send` function and send one SMS/WhatsApp from `AcademicMessageSheet` end to end (tests used a table stub only).
* Open every page in a browser on a phone; try offline entry (airplane mode), reconnect, and a deliberate conflict from two devices.
* Check whether the live `lb_communication_log.message_type` is still an enum (INTEGRATION §8).
* **Scale:** nothing was load-tested. Expected hot spots: `elimu_compute_term_results` (one transaction per class, per-student loops) and `elimu_get_mark_sheet` (roster staged in a temp table). Test with ~1,500 students × 12 subjects × 5 assessments; if too slow, compute per stream or move the loop to a queued job.
* Teacher roster visibility relies on allocations; a teacher with no allocation sees nothing: intended, but confirm with a pilot school.

## 4. Decisions someone may want to revisit
* **Own role table** instead of POS permission keys (the POS catalogue is closed behind a CHECK constraint). If the POS later opens it, map `elimu_can()` onto it.
* **Weights live on assessments** (no separate weights table); history is protected by the breakdown snapshot.
* **Only SUBMITTED marks count**, so teachers must submit. A school that does not want this needs a setting.
* **Approval = lock.** Withdrawing approval (before publishing) unlocks.
* **Own offline store** (INTEGRATION §8, patch B explains the alternative).
* `elimu_message_links.purpose` must start with `ELIMU_`.

## 5. Next steps, in order
1. Staging install + the verification list above.
2. Wire routes (2 lines) and add `AcademicHomePage` to navigation.
3. Build gaps 2, 3, 1, 4 (they are small; services are ready).
4. Connect AI 1's foundation through the adapter; mount `StudentAcademicHistory` and `GuardianContactActions` on the student profile.
5. Pilot with one class end to end (setup → marks → results → approve → publish → notify → correct one mark).

## 6. Fast re-orientation
`schema/install_order.txt` (what to run) → `INTEGRATION.md` (contracts) → `ARCHITECTURE.md` §4–6 (rules) → `academic/schema/tests/scenarios.sql` (executable specification of the behaviour).
