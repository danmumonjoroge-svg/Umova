// elimu/app/auth/identifiers.js -- pure helpers for the sign-in form (no host imports; runs in plain Node).

/** Spaces are removed; case and hyphens are KEPT because the host looks the code up as typed (codes such as TEST-01, DEMOSCH, 2201 exist). */
export function normalizeSchoolCode(v) { return String(v ?? '').replace(/\s+/g, ''); }

/** User ID / username: surrounding spaces removed, inner text untouched. */
export function normalizeIdentifier(v) { return String(v ?? '').trim(); }

export const SCHOOL_CODE_MIN = 2;
export const SCHOOL_CODE_MAX = 24;
export const IDENTIFIER_MAX = 64;

/** -> { ok, errors: { schoolCode?, identifier?, password? }, value: { schoolCode, identifier, password } }. The password is never trimmed or altered. */
export function validateLoginForm({ schoolCode, identifier, password } = {}) {
  const value = { schoolCode: normalizeSchoolCode(schoolCode), identifier: normalizeIdentifier(identifier), password: String(password ?? '') };
  const errors = {};
  if (!value.schoolCode) errors.schoolCode = 'Enter your school code.';
  else if (value.schoolCode.length < SCHOOL_CODE_MIN || value.schoolCode.length > SCHOOL_CODE_MAX || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value.schoolCode)) errors.schoolCode = 'That school code does not look right.';
  if (!value.identifier) errors.identifier = 'Enter your user ID.';
  else if (value.identifier.length > IDENTIFIER_MAX) errors.identifier = 'That user ID is too long.';
  if (!value.password) errors.password = 'Enter your password.';
  return { ok: Object.keys(errors).length === 0, errors, value };
}

/** Seconds to make the person wait after repeated wrong passwords (a courtesy brake; the server remains the real limiter). 0 for the first 2 failures. */
export function retryDelaySeconds(failures) {
  const n = Number(failures) || 0;
  if (n < 3) return 0;
  return Math.min(60, 2 ** (n - 2));   // 3 -> 2s, 4 -> 4s, 5 -> 8s ... capped at 60s
}
