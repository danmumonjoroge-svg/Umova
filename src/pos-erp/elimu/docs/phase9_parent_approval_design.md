# Phase 9 — Parent approval workflow: implementation boundary and database contract

## What is verified in this source archive

- Parent authentication uses a dedicated Supabase client/storage key (`parent/parentClient.js`).
- OTP verification in `parent/ParentApp.jsx` verifies control of a phone number and does not invoke a guardian-linking RPC.
- Parent child discovery calls `elimu_parent_children`; attendance, results, calendar and fees use separate `elimu_parent_*` read RPCs.
- School staff manage guardian/student relationships through `guardianService.link()` / `guardianService.unlink()` and the existing Guardians pages.
- No SQL migration in this archive defines the `elimu_parent_*` functions, the guardian/student base tables, their RLS policies, or a school-side approval RPC. The current `elimu_student_guardians` relationship is used by the client, but its authoritative DDL and tenant-key semantics are absent.

## Phase 9 application-side change

The parent portal's no-approved-link state now gives a clear school-verification checklist and explicitly warns parents not to share OTPs. It does not create a request row or grant access. This is intentional: a UI-only request cannot safely establish identity, tenant ownership, or approval authority.

## Required server-side workflow (design only — not a migration)

The schema owner must map this contract onto the actual foundation DDL before implementation:

1. A parent request is bound to the authenticated `auth.uid()` and verified phone claim, a tenant/school, and a proposed learner/guardian relationship. The phone number is a contact proof only, never sufficient evidence of relationship.
2. Request states are explicit and auditable: `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, `REVOKED`. State changes record actor, timestamp, reason, and prior state. Terminal-state re-submission rules must be defined.
3. A school approver must be authenticated, belong to the same tenant, and hold a dedicated guardian-link approval permission. Never accept an approver id, tenant id, guardian id, or student id as trusted authority merely because it came from a client payload.
4. Approval must transactionally validate the request, tenant, student, guardian, verified contact, duplicate active relationship, and approver permission; then create/activate the canonical guardian/student relationship and mark the request approved in one transaction.
5. Rejection and revocation must not delete historical evidence. Revocation must immediately stop all parent read access for that relationship.
6. Every parent read RPC (`elimu_parent_children`, `elimu_parent_attendance`, `elimu_parent_results`, `elimu_parent_calendar`, `elimu_parent_fees`) must derive the caller from `auth.uid()` and independently enforce an active, approved relationship in the same tenant. A client-side student id is only a selector, not authorization.
7. Parent users must not directly insert/update relationship rows or approve requests. RLS must deny direct writes; narrowly scoped RPCs must enforce authorization and tenant isolation.
8. Duplicate requests and duplicate active links must be prevented with database constraints/transactional checks based on the actual schema. Do not assume a uniqueness key until tenant and history semantics are confirmed.

## Required staging acceptance tests

- OTP verified, no request: zero children and no access to child read RPC data.
- Pending request: zero child access.
- Approved request: only the approved learner(s) visible to that parent.
- Rejected, cancelled or revoked request: no access; audit history remains.
- One guardian with multiple approved children: all and only those children are visible.
- Same phone number in another tenant: no cross-tenant discovery or access.
- Unauthorised staff member attempts approval: denied.
- Approver from another tenant attempts approval: denied.
- Duplicate request / concurrent approval: one canonical relationship, no duplicate active links.
- Forged student id passed to every parent data RPC: denied unless an approved relationship exists.
- Parent attempts direct table writes: denied by RLS.
- Guardian phone changed or relationship ended: existing session cannot continue reading revoked records.

## Blockers before database implementation

Supply the actual SQL definitions/migrations for the guardian, student, tenant and relationship tables; all `elimu_parent_*` functions; relevant RLS policies; staff permission model; and the canonical tenant resolver. Without these, writing an executable migration would require inventing physical columns, constraints, or security assumptions. No migration was created or run in Phase 9.
