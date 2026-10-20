// src/components/Auth/loginHelpers.js
//
// Single source of truth for "how do we check a staff login" and "how do
// we check a member login." Extracted from AdminLogin.js and AuthPage.js
// so that logic exists in exactly one place — previously AdminLogin.js
// had its own separate STAFF_ROLES list that silently drifted from the
// real one in AuthContext.js. Import from here instead of re-inlining.
//
// Neither function navigates or touches component state — they return a
// plain result object and let the caller (AdminLogin.js, UnifiedLogin.js)
// decide what to do with it. Neither function signs a user out on its
// own success path; only on a failed role check (staff path), matching
// the existing AdminLogin.js behavior.

import { supabase } from "../../supabaseClient";
import { STAFF_ROLES } from "../../Context/AuthContext";

/**
 * @param {string} identifier - raw input, e.g. "UI-0004" or "ui-0004"
 * @returns {boolean} true if this looks like a phone number rather than
 *   a member/staff code. Both member_no and staff user_no use the same
 *   "UI-XXXX" shape (see users.member_no / members.member_no), so the
 *   only reliable signal is: codes contain a dash, phone numbers don't.
 */
export function looksLikePhoneNumber(identifier) {
  const trimmed = identifier.trim();
  if (trimmed.includes("-")) return false;
  const digitsOnly = trimmed.replace(/[\s()]/g, "");
  return /^\+?\d{9,13}$/.test(digitsOnly);
}

/**
 * Staff/admin login — checks the `users` table, then Supabase Auth, then
 * the shared STAFF_ROLES list. Mirrors AdminLogin.js's original logic
 * exactly (status checks, email check, role gate, audit log).
 *
 * @returns {Promise<{ok: true, userRecord: object} | {ok: false, reason: string, message: string}>}
 */
export async function resolveStaffLogin(userNo, password) {
  const { data: userRecord, error: userError } = await supabase
    .from("users")
    .select("id, member_no, name, email, role, status, auth_user_id")
    .eq("member_no", userNo.trim().toUpperCase())
    .maybeSingle();

  if (userError || !userRecord) {
    return { ok: false, reason: "NOT_FOUND", message: "User Number not found." };
  }

  if (userRecord.status === "inactive") {
    return { ok: false, reason: "INACTIVE", message: "Account is inactive." };
  }
  if (userRecord.status === "suspended") {
    return { ok: false, reason: "SUSPENDED", message: "Account is suspended." };
  }
  if (!userRecord.email) {
    return { ok: false, reason: "NO_EMAIL", message: "No email linked to this user." };
  }

  const { data, error: loginError } = await supabase.auth.signInWithPassword({
    email: userRecord.email,
    password,
  });

  if (loginError) {
    const message = loginError.message.toLowerCase().includes("invalid login credentials")
      ? "Invalid password."
      : loginError.message;
    return { ok: false, reason: "BAD_PASSWORD", message };
  }

  if (!STAFF_ROLES.includes((userRecord.role || "").toLowerCase())) {
    await supabase.auth.signOut();
    return { ok: false, reason: "NOT_STAFF", message: "You do not have dashboard access." };
  }

  try {
    await supabase.from("audit_logs").insert([
      {
        user_id: data.user.id,
        action: "ADMIN_LOGIN",
        role: userRecord.role,
        email: userRecord.email,
      },
    ]);
  } catch {
    // Audit logging is best-effort — never block a successful login on it.
  }

  return { ok: true, userRecord };
}

/**
 * Member login — checks the `members` table, then Supabase Auth.
 * Mirrors AuthPage.js's plain-login step exactly (status checks,
 * password_set check, email check).
 *
 * @returns {Promise<{ok: true, member: object} | {ok: false, reason: string, message: string, member?: object}>}
 */
export async function resolveMemberLogin(memberNo, password) {
  // Server-side lookup: returns only what login needs. The members table is not readable by the browser.
  const { data: member, error: memberError } = await supabase
    .rpc("member_login_lookup", { p_member_no: memberNo.trim().toUpperCase() });

  if (memberError) {
    return { ok: false, reason: "LOOKUP_FAILED", message: "Failed to look up member. Please try again." };
  }
  if (!member) {
    return { ok: false, reason: "NOT_FOUND", message: "Member number not found." };
  }
  if (member.status === "inactive") {
    return { ok: false, reason: "INACTIVE", message: "Your account is inactive. Contact the SACCO office." };
  }
  if (member.status === "suspended") {
    return { ok: false, reason: "SUSPENDED", message: "Your account is suspended. Contact the SACCO office." };
  }
  if (!(member.password_set === true || member.password_set === "true")) {
    return { ok: false, reason: "NEEDS_SETUP", message: "You haven't activated your account yet.", member };
  }
  if (!member.email) {
    return { ok: false, reason: "NO_EMAIL", message: "No email on file. Contact the SACCO office." };
  }

  const { error: authError } = await supabase.auth.signInWithPassword({
    email: member.email,
    password,
  });

  if (authError) {
    let message = authError.message;
    if (authError.message.toLowerCase().includes("invalid login credentials")) {
      message = "Incorrect password. Please try again.";
    } else if (authError.message.toLowerCase().includes("email not confirmed")) {
      message = "Please confirm your email address first — check your inbox.";
    }
    return { ok: false, reason: "BAD_PASSWORD", message };
  }

  return { ok: true, member };
}
