# ELIMU — Architecture

Elimu is a **module on top of Umova**, not a parallel system. It owns school data and school screens; everything generic is borrowed.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ UMOVA CORE (existing, unchanged)                                                             │
│  Auth & sessions · Tenants/businesses · Staff · Roles & permissions · Customers · Audit log  │
│  Payments & M-Pesa · Reports · Calendar · Branding · Offline engine                           │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                          ▲  read / call only
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ SHARED SERVICES (existing, reused through adaptors)                                          │
│  Communication engine: lb_communication_log · lb_communication_templates · comm-send · jobs   │
│  Notifications (computed live) · Message history · Delivery webhooks                          │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                          ▲  elimu_record_message(), template rows, provider send
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ELIMU (this folder)                                                                          │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐                  │
│  │ Students   │ │ Guardians  │ │ Admissions │ │ Classes &  │ │ Enrolment  │   …later: Academics,│
│  │            │ │ & consent  │ │ workflow   │ │ structure  │ │ & history  │   Attendance, Fees  │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘ └────────────┘                  │
│  ═══════ cross-cutting: COMMUNICATION (ElimuContactActions · MessageComposer · Panel)  ═══════ │
│  ═══════ cross-cutting: NOTIFICATIONS (event → prepared reminder, never auto-send)     ═══════ │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

Communication and notifications are drawn across every school area because every area uses them: any student, guardian, application or
class screen can drop in `<ElimuContactActions>` or `<ElimuCommunicationPanel>`.

## Principles

1. **Adaptor, not copy.** `services/platform.js` is the only file that imports from the host (client, permissions, auth, UI kit). Pure logic
   (`utils/`, `communication/` except the service) imports nothing from the host and is tested in plain Node.
2. **The database is the authority.** Every rule that matters lives in SQL (RLS, constraints, triggers, RPCs). The JS mirrors some rules
   (consent, validation, permissions) only to give an early, friendly answer; the mirror is tested for parity.
3. **Tenant isolation everywhere.** Every table has `tenant_id`; foreign keys are *composite* `(tenant_id, id)` so a row can never point into
   another school; RLS uses the `(SELECT get_current_tenant_id())` pattern; a BEFORE trigger stamps/validates the tenant.
4. **History is kept.** No DELETE policy on students, guardians links, applications, enrolments, messages or calls. People leave, links end,
   statuses change — each with a history row. Corrections are updates; mistakes are archived.
5. **Configurable but rule-bearing.** Statuses and admission stages are editable lookup rows, but each maps to a fixed *category*; rules and
   reports read the category, never the label.
6. **Honest communication.** See below.

## Data model (new tables)

```
elimu_settings ─ elimu_student_statuses ─ elimu_admission_statuses ─ elimu_number_sequences
elimu_academic_years ─┬─ elimu_terms
elimu_classes ────────┼─ elimu_streams ─ elimu_class_teachers (→ pos_staff)
elimu_students ───────┼─ elimu_student_status_history ─ elimu_student_care_notes
elimu_guardians ──────┼─ elimu_guardian_contacts ─ elimu_guardian_channel_consent
        └─ elimu_student_guardians (many-to-many, rank, emergency, ended_on)
elimu_admission_applications ─ elimu_admission_status_history
elimu_enrollments ─ elimu_enrollment_history
elimu_message_links → lb_communication_log      elimu_call_log
elimu_notification_rules ─ elimu_notifications
views: v_elimu_current_period, v_elimu_student_directory, v_elimu_enrollment_history, v_elimu_data_quality, v_elimu_communication_history
```

Workflow rules enforced in SQL: admission transitions by category matrix; `ADMITTED` only through `elimu_admit_application()`; one open
application per child per year; one live enrolment per student × year × period; year-long and term enrolment never mixed; only Active students
enrolled; stream must belong to class; term must lie inside its year; one current academic year; finished enrolments are frozen.

## Communication design

```
 screen ──► ElimuContactActions ──► ElimuMessageComposer ──► ElimuCommunicationService
                (4 buttons, reasons)   (purpose, channel,        │ prepare()  pure: template + merge fields
                                        edit, confirm)           │ record()   elimu_record_message()  → lb_communication_log (QUEUED/OPENED)
                                                                 │ handOff()  sms: / wa.me / mailto: / tel:  + records OPENED/INTENDED
                                                                 │ sendViaProvider()  existing comm-send edge function (if configured)
                                                                 └ offline → own IndexedDB draft, state PENDING
```

* **Purpose first.** 15 purposes (`communication/purposes.js`); later modules `registerPurpose()` — keys are `ELIMU_*`.
* **Three template levels.** system default → school override (row in `lb_communication_templates`) → edit for this one message. The generated
  text is stored beside the final text so “edited” is provable.
* **Never silent.** Every route is an explicit tap. Notifications only *prepare* work.
* **Honest status.** `QUEUED` = prepared · `OPENED` = handed to this phone’s app (labelled “not confirmed sent”) · `SENT` only when staff say
  “I sent it” (labelled “Marked as sent by staff”) · `SUBMITTED/DELIVERED/READ` only from the provider — the core `comm_log_guard` refuses them from a user.
  A call is `INTENDED` until a person records the outcome.
* **Consent.** Per-guardian, per-channel (`ALLOWED / OPTED_OUT / NOT_ASKED`). Opt-out is refused in SQL; only `ELIMU_EMERGENCY` overrides, and the override is stored on the message link. A school setting can require explicit consent.
* **Offline.** No signal → the draft is kept on the device as PENDING and shown as *not sent*. Umova’s Dexie database could not be extended without a core change, so Elimu keeps its own tiny store (`utils/offlineDrafts.js`).

## Security & privacy

RLS on every table; permission triggers; photos in a **private** bucket (path stored, signed links only, CHECK refuses URLs); audit rows record column
names and whitelisted non-PII values, never names/phones/notes; no PII is logged by the JS; medical/care notes are off by default, length-limited and
behind a separate permission; sensitive attributes (religion, ethnicity, national ID…) are deliberately **not collected**.

## Extension points for later modules

`registerModule({ key, routes, studentTabs, quickActions })` · `registerPurpose()` · `registerEvent()` · read models above · `elimu_can(action)`.
