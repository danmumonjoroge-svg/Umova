// elimu/app/auth/authAdapter.js -- the AUTH ADAPTER CONTRACT. Pure (no host imports).
//
// Elimu owns the sign-in EXPERIENCE and the SESSION it exposes. Verifying a credential and holding the signed-in identity is shared Umova
// infrastructure, reached through ONE adapter object (default: hostAdapter.js over the shared POSAuthProvider):
//
//   adapter  = { id, useIdentity(): Identity }                                   // useIdentity is a React hook
//   Identity = {
//     stage:  'checking' | 'logged_out' | 'pending' | 'rejected' | 'suspended' | 'must_change_password' | 'authenticated'
//     school: { id, business_id, business_code, business_name } | null          (the tenant: ONE school per session)
//     user:   { id, name, kind: 'staff' | 'guardian' | 'student', isOwner } | null
//     statusDetail, logoutNotice, offline,
//     signIn({ schoolCode, identifier, password }): Promise<void>               // throws ElimuAuthError on failure
//     signOut(): Promise<void>
//   }
// A different identity source (for example a parent/student login) only has to implement this shape.

export const AUTH_ERROR = {
  SCHOOL_NOT_FOUND: 'SCHOOL_NOT_FOUND', SCHOOL_PENDING: 'SCHOOL_PENDING', SCHOOL_REJECTED: 'SCHOOL_REJECTED', SCHOOL_SUSPENDED: 'SCHOOL_SUSPENDED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED', INVALID_CREDENTIALS: 'INVALID_CREDENTIALS', MUST_CHANGE_PASSWORD: 'MUST_CHANGE_PASSWORD',
  WRONG_SCHOOL: 'WRONG_SCHOOL', OFFLINE: 'OFFLINE', UNKNOWN: 'UNKNOWN',
};

const MESSAGES = {
  SCHOOL_NOT_FOUND: 'No school found with that code.',
  SCHOOL_PENDING: "This school's registration is still pending approval.",
  SCHOOL_REJECTED: "This school's registration was not approved.",
  SCHOOL_SUSPENDED: "This school's account is suspended.",
  ACCOUNT_DISABLED: 'This account has been disabled. Ask your school administrator.',
  INVALID_CREDENTIALS: 'Incorrect user ID or password.',
  MUST_CHANGE_PASSWORD: 'You must set a new password before continuing.',
  WRONG_SCHOOL: 'That account belongs to a different school. Check the school code.',
  OFFLINE: 'You are offline. Connect to the internet to sign in.',
  UNKNOWN: 'Something went wrong signing in. Please try again.',
};
export const authMessage = (code) => MESSAGES[code] || MESSAGES.UNKNOWN;

export class ElimuAuthError extends Error {
  constructor(code = AUTH_ERROR.UNKNOWN, message, detail = null) {
    super(message || authMessage(code));
    this.name = 'ElimuAuthError'; this.code = code; this.detail = detail;
  }
}

// What the shared login reports (resolve_pos_login / get_pos_profile reasons) -> Elimu codes.
const HOST_REASON = {
  BUSINESS_NOT_FOUND: AUTH_ERROR.SCHOOL_NOT_FOUND, TENANT_NOT_APPROVED: AUTH_ERROR.SCHOOL_PENDING, TENANT_REJECTED: AUTH_ERROR.SCHOOL_REJECTED,
  TENANT_SUSPENDED: AUTH_ERROR.SCHOOL_SUSPENDED, STAFF_DISABLED: AUTH_ERROR.ACCOUNT_DISABLED, INVALID_CREDENTIALS: AUTH_ERROR.INVALID_CREDENTIALS,
  USER_NOT_FOUND: AUTH_ERROR.INVALID_CREDENTIALS,      // never reveal whether the user ID or the password was wrong
  NETWORK: AUTH_ERROR.OFFLINE, OFFLINE: AUTH_ERROR.OFFLINE,
};
/** Host login result { ok, reason, detail } -> ElimuAuthError (only for ok:false). */
export function errorFromHostResult(r) {
  const code = HOST_REASON[r?.reason] || AUTH_ERROR.UNKNOWN;
  return new ElimuAuthError(code, undefined, r?.detail ?? null);
}
