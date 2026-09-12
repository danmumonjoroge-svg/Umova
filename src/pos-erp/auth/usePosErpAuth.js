// src/pos-erp/auth/usePosErpAuth.js
//
// Thin adapter between the POS/Inventory module (ProductsPage,
// useProducts, useCashierShifts, every services/*.js) and the app's REAL
// POS auth.
//
// FIXED: staffId used to return staff?.id (the pos_staff row's own
// primary key). But lb_* tables' "who did this" audit columns
// (lb_cashier_shifts.cashier_id, lb_products.created_by, etc.) have
// foreign keys pointing at auth.users(id) directly — NOT pos_staff(id)
// — confirmed via pg_constraint (lb_cashier_shifts_cashier_id_fkey
// REFERENCES auth.users(id)). This is actually a deliberate, sensible
// design: by referencing the raw Auth user id rather than either
// public.users or pos_staff specifically, lb_* tables can accept a
// "creator" reference from EITHER the old single-tenant staff system
// or the new POS tenant system, since both trace back to a real
// auth.users row. staffId now correctly returns staff?.auth_user_id.
//
// posStaffId is added separately for anything that specifically needs
// the pos_staff row's own id (e.g. pos_audit_log.actor_id, which
// register_pos_tenant's own insert populates with the pos_staff id,
// not the auth user id — a genuinely different target table with a
// genuinely different FK).

import { usePOSAuth } from "../context/POSAuthContext";

export function usePosErpAuth() {
  const { staff, tenant, authStage, isOwner, isManager, isCashier, logout } = usePOSAuth();

  return {
    // No separate "auth user" object is exposed by this system — the
    // staff row itself is the closest equivalent, kept for parity with
    // old callers that destructure authUser/profile.
    authUser: staff,
    profile: staff,
    tenant,
    // auth.users.id — what lb_* tables' audit columns (cashier_id,
    // created_by, received_by, etc.) actually reference via FK.
    staffId: staff?.auth_user_id ?? null,
    // pos_staff.id — for anything referencing pos_staff itself directly
    // (e.g. pos_audit_log.actor_id). Not the same value as staffId.
    posStaffId: staff?.id ?? null,
    staffName: staff?.name ?? staff?.full_name ?? null,
    role: staff?.role ?? null,
    isStaff: !!staff,
    isAdmin: isOwner || isManager,
    isOwner,
    isManager,
    isCashier,
    loading: authStage === "checking",
    logout,
  };
}
