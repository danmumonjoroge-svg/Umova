# Elimu Academic & Examinations: ARCHITECTURE

## 1. Shape of the module

```
 React pages / hooks            JS services (thin)             Postgres (source of truth)
 ───────────────────            ──────────────────             ─────────────────────────────
 elimu/*/pages, components  ->  academicService, examService,  -> tables + triggers + RLS
 useMarkSheet, useScope         gradingService, reportCard…      SECURITY DEFINER functions (RPC)
        │                              │                                │
        │ offline: elimuOffline        │ rpc()  = posSupabase.rpc       ├─ reads foundation ONLY via elimu_ref_* views
        ▼ (IndexedDB queue)            ▼                                └─ writes audit to pos_audit_log
```
**All business rules live in the database.** The JS layer validates for instant feedback and renders; it can be wrong or bypassed without harming data. Pure JS engines (`gradingEngine`, `resultEngine`, `markValidation`) mirror the SQL for previews and are tested against the same numbers.

Folder map: `academic/` (subjects, allocations, roles, settings, scope), `exams/` (assessments, marks), `grading/` (schemes), `report_cards/` (results, cards, print), `communication/` (templates + composer, reusing the POS comm system), `offline/` (marks queue), `schema/install_order.txt`, `tests/`.

## 2. Database

17 tables (INTEGRATION.md §1). Conventions: `tenant_id` on every row; `*_by` columns hold `pos_staff.id`; foundation ids are plain uuids (no FKs) read through the `elimu_ref_*` adapter views; deletes are blocked for signed-in sessions (`elimu_block_delete`): deactivate, end, void or supersede instead.

Key constraints (all enforced by Postgres, not the UI):
* **No duplicate marks:** partial unique indexes `(assessment_id, student_id)` and `(assessment_id, enrollment_id)` where `voided_at IS NULL`.
* **Blank ≠ zero:** `CHECK ((mark_status='PRESENT') = (obtained_marks IS NOT NULL))`; no row at all is treated as PENDING.
* **Marks within range:** trigger `elimu_guard_mark` rejects `obtained > max_marks`; `CHECK obtained >= 0`; `max_marks > 0`; `weight` 0..100.
* **Roster integrity:** a mark's enrollment must belong to that student, year, class (and stream if the assessment has one).
* **No duplicate assessments:** unique `(tenant, year, term, class, stream, subject, lower(name))` excluding cancelled.
* **Grade bands can't overlap:** `EXCLUDE USING gist (scheme_id =, numrange(min,max,'[]') &&)`.
* **One active class teacher / one identical active allocation:** partial unique indexes.
* **History frozen:** allocations and class-teacher rows may only be *ended*; mark/report-card history tables reject UPDATE/DELETE.

## 3. Data flow

```
setup ─► allocations ─► assessment (DRAFT→OPEN) ─► marks entry (DRAFT) ─► submit (SUBMITTED) ─► [assessment LOCKED]
                                                                                        │
              compute term results (per class/stream, unlocked only) ◄─────────────────┘
                     │  subject_results (+breakdown) , term_results (+positions)
                     ▼
        generate report cards (DRAFT) ─► remarks ─► REVIEW ─► APPROVED (snapshot + LOCK) ─► PUBLISHED ─► notify guardians
                                                                                │
                                          correction ─► revision n+1 (DRAFT) ◄──┘ (head teacher, reason, audited)
```

## 4. Calculations (SQL `elimu_compute_one`, mirrored by `resultEngine.js`)

For one student, one subject, one term:
1. **Components:** assessments with same year/term/class, `stream IS NULL OR = student's stream`, not cancelled, `weight > 0`.
2. **Weight check:** Σ weights must equal 100 within the school's tolerance, else `WEIGHTS_INVALID` (never graded).
3. **Each mark:** only `SUBMITTED` marks count. No row / PENDING / DRAFT ⇒ subject `INCOMPLETE` (no percentage, no grade). `EXEMPTED` ⇒ left out. `ABSENT` and `NOT_SUBMITTED` ⇒ per school setting `ZERO` (counts as 0%) or `EXCLUDE` (left out). `PRESENT` ⇒ `obtained / max × 100`.
4. **Percentage** = Σ(percent × weight) / Σ(weights counted), rounded to 3 dp. Excluded components re-scale the remaining weights.
5. **Grade:** scheme = subject override → scheme for the class level → school default; band = highest `min_percent` ≤ percentage rounded to the scheme's decimals (clamped 0..100). Literal grade, points, descriptor, remark, scheme **version** and the full component breakdown are stored on the result.
6. **Overall:** mean of COMPLETE subject percentages; mean grade points; overall grade **only when every expected subject is complete**. Electives count only for students who selected them; subjects where every component is exempt are dropped.
7. **Positions:** standard competition ranking (1,2,2,4) on mean percentage within the class and within the stream, complete students only; locked results keep their positions.

Verified example (SQL scenarios and JS tests): CAT1 15/20 (20%), CAT2 18/20 (20%), Exam 60/100 (60%) ⇒ (75·20 + 90·20 + 60·60)/100 = **69.000 ⇒ C**. Absent CAT1 (0), exempt CAT2, exam 80% ⇒ (0·20 + 80·60)/80 = **60.000**.

## 5. Historical correctness
* Results hang on `enrollment_id + term_id`; class/stream/year are copied at compute time. A class change creates a new enrollment, so earlier results are untouched (tested).
* **Grading schemes are versioned.** Once any result uses a scheme, its bands and decimals are locked by trigger; "New version" copies it (n+1), retires the old one and moves the default. Old results keep pointing at their version *and* hold the literal grade.
* **Weights/marks changes after approval** require a correction. Results store breakdown snapshots, so later weight edits cannot rewrite them.
* **Report cards freeze at APPROVAL** (`snapshot` jsonb: school, student, names, subjects, remarks, grading key, display flags). Printing an approved/published card uses only the snapshot (tested: changing school settings later does not change a published card).
* **Corrections** create `elimu_term_results` revision n+1 and a new DRAFT card; revision n stays, `is_current=false`. Publishing n+1 marks card n `SUPERSEDED`.

## 6. Security

* **Tenant isolation:** every RLS policy requires `tenant_id = get_current_tenant_id()`; SECURITY DEFINER functions filter by tenant explicitly (they run as owner and bypass RLS), including every adapter-view read.
* **Fail closed:** no tenant claim ⇒ no rows; no active staff in an approved business ⇒ `elimu_can()` false; missing adapter views ⇒ writes fail with a clear message.
* **Roles & scope:** `elimu_can(action)` (matrix in INTEGRATION.md §6). Teachers are limited to their active allocations: subject + class (+ stream, strict for creating, per-student-stream for entering marks), enforced in policies, RPCs and (for roster/status rules) triggers.
* **Marks, assessments, results, cards, history, message links have no API write policy.** Clients can only call the RPCs; direct `INSERT/UPDATE/DELETE` is denied by grants (tested as a teacher and as the owner).
* **Published protection:** workflow transitions are enforced by trigger (`DRAFT→REVIEW→APPROVED→PUBLISHED→SUPERSEDED`, plus send-back/withdraw before publish); published and superseded cards are read-only even for a superuser; approved results are locked; `elimu_correct_published_mark` needs `reportcard.correct`, a reason, and is audited.
* **Contact privacy:** guardian phone/email are only returned by `elimu_student_contacts` / `elimu_guardian_targets` to people who cover that student (admins, class teacher, a teacher of that class).
* **Internal switches:** a few transaction-local settings (`elimu.correction`, `elimu.result_admin`, `elimu.edit_submitted`, `elimu.reason`) let the module's own definer functions pass its triggers. API clients cannot call `set_config`, and without the RPCs there is no write path anyway; treat them as defence in depth, not a boundary against a database superuser.
* RLS is `ENABLE`d, not `FORCE`d (the function owner must bypass it, as elsewhere in the POS).

## 7. Report cards and printing
`elimu_report_payload()` builds one JSON document (school, student, year/term/class/stream, subjects with marks/grade/points/remarks/breakdown, overall and positions, remarks with names, grading key, display flags). `reportCardHtml.js` turns it into HTML (escaped, DRAFT watermark when not final, "revision n" banner on corrections), and the POS's own `printDocument()` prints it; one card per page; single, selected, whole class or whole stream (paged 200 at a time). No separate PDF engine exists in this module.

## 8. Communication
`academicTemplates.js` holds wording for 7 purposes × SMS/WhatsApp/Email with the requested variables, rendered by the POS's `renderText` (same `{{var}}` / `{{var?}}` rules). Schools may override wording in the existing `lb_communication_templates`; an override that cannot be fully filled falls back to the standard text with a warning. `AcademicMessageSheet` generates the text, lets the user edit it, runs the POS's `checkFinal`, writes to the existing outbox as QUEUED, links it, and then sends through the POS's own path. Statuses are never advanced by this module except OPENED (phone route) and the user's own SENT confirmation.

## 9. Offline
Scope: marks entry only. `useMarkSheet` caches each opened sheet, queues edits in `umova_elimu_offline` when the connection fails, shows "On this phone, not sent", and syncs on reconnect. Server side, `elimu_save_marks` takes `base_version` per row: stale ⇒ `CONFLICT` (phone value kept, both shown, user picks), identical replay ⇒ `UNCHANGED` (idempotent), submitted/forbidden/invalid ⇒ parked with the reason, never dropped silently. Submitting, results, report cards and messaging require a connection. See INTEGRATION.md §8 for why this is a separate store and how to fold it into the shared outbox.

## 10. Performance design
Pagination everywhere (mark sheet 100/page, max 500; lists 25–50; bulk save ≤1000 rows; bulk transitions ≤500; payloads ≤200). Indexes on `(tenant_id, year, term, class, subject)`, `(assessment_id)` for live marks, `(tenant_id, student_id)`, result scope and card status. Compute runs per class (or stream), one student at a time inside one transaction. **Not load-tested**: see AI2_CONTINUATION.md.
