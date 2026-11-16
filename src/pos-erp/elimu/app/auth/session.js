// elimu/app/auth/session.js -- builds the ElimuSession the whole app reads. Pure.
//
//   session = {
//     status:        'loading' | 'signed_out' | 'blocked' | 'authenticated'      only 'authenticated' opens the app
//     stage:         the identity stage it came from
//     authenticated: boolean
//     offline:       true when the device is signed in from a saved sign-in with no internet
//     notice:        string | null          one-shot message for the sign-in screen (e.g. "You were signed out")
//     problem:       { code, detail } | null   why a school/account is blocked (pending, suspended, must change password ...)
//     school:        { id, businessId, code, name, timeZone } | null
//     user:          { id, name, kind, isOwner, role, roleLabel } | null
//     permissions:   { can(action), isOwner, loaded, roles }                      never grants anything unless authenticated
//   }
import { AUTH_ERROR } from './authAdapter.js';
import { normalizeRole, roleLabel } from './roles.js';

const BLOCKED = {
  pending: AUTH_ERROR.SCHOOL_PENDING, rejected: AUTH_ERROR.SCHOOL_REJECTED, suspended: AUTH_ERROR.SCHOOL_SUSPENDED, must_change_password: AUTH_ERROR.MUST_CHANGE_PASSWORD,
};
const NO_PERMISSIONS = Object.freeze({ can: () => false, isOwner: false, loaded: false, roles: [] });

/** Tenant record -> school. The code is shown exactly as stored. */
export function buildSchool(t) {
  if (!t) return null;
  return {
    id: t.id ?? null, businessId: t.business_id ?? t.businessId ?? null,
    code: t.business_code ?? t.school_code ?? t.code ?? '', name: t.business_name ?? t.name ?? '',
    timeZone: t.time_zone ?? t.timeZone ?? 'Africa/Nairobi',
  };
}

function buildUser(u, access) {
  if (!u) return null;
  const owner = !!u.isOwner || !!access?.isOwner;
  const first = Array.isArray(access?.roles) && access.roles[0];
  const role = owner ? 'owner' : normalizeRole((first && (first.role ?? first)) || u.role);
  return { id: u.id ?? null, name: u.name ?? '', kind: u.kind || 'staff', isOwner: owner, role, roleLabel: roleLabel(role) };
}

export function buildSession({ identity, access = null } = {}) {
  const i = identity || {};
  const base = { stage: i.stage || 'logged_out', authenticated: false, offline: !!i.offline, notice: null, problem: null, school: null, user: null, permissions: NO_PERMISSIONS };

  if (i.stage === 'checking') return { ...base, status: 'loading' };

  if (BLOCKED[i.stage]) {
    return {
      ...base, status: 'blocked', problem: { code: BLOCKED[i.stage], detail: i.statusDetail ?? null },
      school: buildSchool(i.school), user: i.stage === 'must_change_password' ? buildUser(i.user, null) : null,
    };
  }

  if (i.stage === 'authenticated') {
    // The app opens only for a staff account that belongs to a school. Anything else is treated as signed out (never half-open).
    if (!i.school || !i.user || (i.user.kind || 'staff') !== 'staff') return { ...base, stage: 'logged_out', status: 'signed_out', notice: i.logoutNotice ?? null };
    const owner = !!i.user.isOwner || !!access?.isOwner;
    return {
      ...base, status: 'authenticated', authenticated: true, school: buildSchool(i.school), user: buildUser(i.user, access),
      permissions: { can: access?.can || (() => owner), isOwner: owner, loaded: !!access?.loaded, roles: access?.roles || [] },
    };
  }

  // 'logged_out' and anything unknown: never opens the app.
  return { ...base, stage: 'logged_out', status: 'signed_out', notice: i.logoutNotice ?? null };
}
