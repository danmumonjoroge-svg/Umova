# Changelog

## 0.1.0: first complete vertical slice (AI 2)
Added (all under `elimu/`; **no existing POS file was changed**, confirmed with `git diff` against the uploaded baseline):
* **Database (17 tables, ~50 functions):** subjects, allocations, class teachers, elective selections, academic roles & settings; grading schemes/rules (versioned, overlap-proof); assessment types, assessments, marks, mark history; term results, subject results, report cards, report-card history; message links. RLS on every table, triggers for marks/lock/workflow rules, audit via `pos_audit_log`.
* **Marks entry:** roster sheet, bulk save with per-row outcome, conflict detection (`base_version`), idempotent replay, submit, unlock, void, history; teacher scoping.
* **Grading and results:** configurable bands, weighting with validation, absent/not-submitted policies, exemptions with re-scaling, completeness rules, overall grade and positions.
* **Report cards:** workflow, snapshot-on-approval, locking, corrections as revisions, print through the POS print engine.
* **Communication:** 7 templates × 3 channels, composer, guardian contact actions, notify-guardians list, history from the existing outbox.
* **Offline marks entry** (separate local store; reasons in ARCHITECTURE §9).
* **UI:** 9 pages, grid, composer sheets, student history component, routes + public `index.js`.
* **Tests:** SQL scenarios (111), JS engines/templates/report HTML (17), offline (7), grid server-render (9 assertions).
Bugs found and fixed by those tests during development: variable/alias clash in `elimu_submit_marks`; missing grants for `security_invoker` adapter views; delete guard on subject results during recompute.
