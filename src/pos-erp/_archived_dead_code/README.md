# Archived dead code — do not import from here

Moved out of the active tree on inspection (Phase 1 audit). Nothing in
POSApp.jsx / POSLayout.jsx / the route tree ever reached these files.
Kept only for reference in case any logic needs to be salvaged; none of
it should be wired back in as-is. See AUDIT.md at the project root for
the full reasoning.

- auth/POSAuthContext.js.dead
  Byte-for-byte-ish duplicate of context/POSAuthContext.js (older
  revision — missing the AUTH_ERROR vs INVALID_CREDENTIALS fix and the
  register_pos_tenant detail passthrough). Nothing imports it via its
  own path; it only exists because two orphaned guards below import a
  function (`usePosAuth`) that isn't even exported from it — the file
  exports `usePOSAuth` (capital OS), not `usePosAuth`. Would have thrown
  at import time if anything had actually rendered it.

- auth/POSStaffGuard.js.dead
  Pre-dates the current POSAuthGate design. Expects a `{ user, role,
  isPosStaff }` shape from usePosAuth() that the real POS auth context
  has never produced. Superseded by auth/POSAuthGate.jsx, which is the
  guard POSApp.jsx actually uses.

- auth/PosBranchGuard.js.dead
  Same generation as POSStaffGuard — expects `profile.business_id` /
  `profile.branch_id`, i.e. the OLD shared-tenant/branch model, not the
  pos_tenants/pos_staff model the rest of the auth folder implements.
  Not imported anywhere.

- auth/posLoginHelpers.js.dead
  Directly violates the "POS must not depend on main Umova auth"
  requirement: imports `STAFF_ROLES` from `../../Context/AuthContext`
  and queries the main `users` table by `member_no`. This is the old
  single-tenant staff-login flow, fully superseded by
  resolve_pos_login() + POSAuthContext.login(). Not imported anywhere.

- services/useProducts.js.dead
  Stale duplicate of hooks/useProducts.js — same filename, wrong
  folder (its own header comment even says "src/pos-erp/hooks/
  useProducts.js"). Missing the tenant_id/business_id stamping fix
  that hooks/useProducts.js has. Not imported anywhere; every page
  (POSPage, POSDashboard, ProductsPage) imports from hooks/.
