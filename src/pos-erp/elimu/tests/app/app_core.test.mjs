// Pure tests of the Elimu auth core (no host, no React). Run from the POS folder:
//   node --experimental-default-type=module --test elimu/tests/app/app_core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSchoolCode, normalizeIdentifier, validateLoginForm, retryDelaySeconds } from '../../app/auth/identifiers.js';
import { normalizeRole, roleLabel, ELIMU_ROLES } from '../../app/auth/roles.js';
import { AUTH_ERROR, ElimuAuthError, authMessage, errorFromHostResult } from '../../app/auth/authAdapter.js';
import { buildSession, buildSchool } from '../../app/auth/session.js';

const TENANT = { id: 't1', business_id: 'b1', business_code: 'DEMOSCH', business_name: 'Demo School' };
const identity = (o = {}) => ({ stage: 'authenticated', school: TENANT, user: { id: 'u1', name: 'Jane', kind: 'staff', isOwner: false }, statusDetail: null, logoutNotice: null, offline: false, ...o });
const access = (actions = [], o = {}) => ({ can: (a) => actions.includes(a), loaded: true, isOwner: false, roles: [{ role: 'class_teacher' }], ...o });

test('school code: spaces removed, case and hyphens kept', () => {
  assert.equal(normalizeSchoolCode(' TEST- 01 '), 'TEST-01'); assert.equal(normalizeSchoolCode('demosch'), 'demosch'); assert.equal(normalizeSchoolCode(null), '');
});
test('identifier is trimmed only', () => { assert.equal(normalizeIdentifier('  Jane.W  '), 'Jane.W'); assert.equal(normalizeIdentifier(undefined), ''); });
test('login form validation', () => {
  const bad = validateLoginForm({});
  assert.equal(bad.ok, false); assert.deepEqual(Object.keys(bad.errors).sort(), ['identifier', 'password', 'schoolCode']);
  assert.equal(validateLoginForm({ schoolCode: 'a', identifier: 'x', password: 'p' }).errors.schoolCode, 'That school code does not look right.');
  assert.equal(validateLoginForm({ schoolCode: 'bad code!', identifier: 'x', password: 'p' }).errors.schoolCode, 'That school code does not look right.');
  const ok = validateLoginForm({ schoolCode: ' TEST-01 ', identifier: ' STF-1 ', password: '  keep spaces  ' });
  assert.equal(ok.ok, true); assert.deepEqual(ok.value, { schoolCode: 'TEST-01', identifier: 'STF-1', password: '  keep spaces  ' });
  assert.equal(validateLoginForm({ schoolCode: 'DEMOSCH', identifier: 'x'.repeat(65), password: 'p' }).errors.identifier, 'That user ID is too long.');
});
test('wrong-password brake: none for 2 failures, doubling, capped at 60s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(retryDelaySeconds), [0, 0, 0, 2, 4, 8, 16]); assert.equal(retryDelaySeconds(50), 60); assert.equal(retryDelaySeconds('x'), 0);
});
test('roles: normalised, aliased, labelled', () => {
  assert.equal(normalizeRole('Class Teacher'), 'class_teacher'); assert.equal(normalizeRole('head-teacher'), 'headteacher'); assert.equal(normalizeRole('Gate Officer'), 'attendance_officer'); assert.equal(normalizeRole(null), '');
  assert.equal(roleLabel('owner'), 'School owner'); assert.equal(roleLabel('bursar'), 'Bursar'); assert.equal(roleLabel('board_member'), 'Board Member'); assert.equal(roleLabel(''), '');
  assert.ok(ELIMU_ROLES.includes('principal') && ELIMU_ROLES.includes('attendance_officer') && new Set(ELIMU_ROLES).size === ELIMU_ROLES.length);
});
test('host reasons map to Elimu errors; unknown never leaks which field was wrong', () => {
  const map = { BUSINESS_NOT_FOUND: 'SCHOOL_NOT_FOUND', TENANT_NOT_APPROVED: 'SCHOOL_PENDING', TENANT_REJECTED: 'SCHOOL_REJECTED', TENANT_SUSPENDED: 'SCHOOL_SUSPENDED', STAFF_DISABLED: 'ACCOUNT_DISABLED', INVALID_CREDENTIALS: 'INVALID_CREDENTIALS', USER_NOT_FOUND: 'INVALID_CREDENTIALS', NETWORK: 'OFFLINE', WHATEVER: 'UNKNOWN' };
  for (const [reason, code] of Object.entries(map)) assert.equal(errorFromHostResult({ ok: false, reason }).code, code, reason);
  const e = errorFromHostResult({ ok: false, reason: 'TENANT_SUSPENDED', detail: 'fees unpaid' });
  assert.ok(e instanceof ElimuAuthError && e instanceof Error); assert.equal(e.detail, 'fees unpaid'); assert.equal(e.message, authMessage('SCHOOL_SUSPENDED'));
  assert.equal(authMessage('nope'), authMessage(AUTH_ERROR.UNKNOWN));
  assert.equal(authMessage('INVALID_CREDENTIALS'), 'Incorrect user ID or password.');
});
test('session: every host stage maps to the right status; only "authenticated" opens the app', () => {
  assert.equal(buildSession({ identity: identity({ stage: 'checking' }) }).status, 'loading');
  const out = buildSession({ identity: identity({ stage: 'logged_out', school: null, user: null, logoutNotice: 'Bye' }) });
  assert.deepEqual([out.status, out.notice, out.authenticated], ['signed_out', 'Bye', false]);
  for (const [stage, code] of [['pending', 'SCHOOL_PENDING'], ['rejected', 'SCHOOL_REJECTED'], ['suspended', 'SCHOOL_SUSPENDED'], ['must_change_password', 'MUST_CHANGE_PASSWORD']]) {
    const s = buildSession({ identity: identity({ stage, statusDetail: 'why' }), access: access(['students.view']) });
    assert.equal(s.status, 'blocked', stage); assert.equal(s.problem.code, code); assert.equal(s.problem.detail, 'why'); assert.equal(s.authenticated, false);
    assert.equal(s.permissions.can('students.view'), false, 'a blocked session never carries permissions');
  }
  assert.equal(buildSession({ identity: identity({ stage: 'weird' }) }).status, 'signed_out', 'an unknown stage never opens the app');
  assert.equal(buildSession({ identity: identity({ offline: true }), access: access() }).offline, true);
});
test('session: a missing school or a non-staff account never becomes authenticated', () => {
  assert.equal(buildSession({ identity: identity({ school: null }) }).status, 'signed_out');
  assert.equal(buildSession({ identity: identity({ user: null }) }).status, 'signed_out');
  assert.equal(buildSession({ identity: identity({ user: { id: 'p1', name: 'Parent', kind: 'guardian' } }) }).status, 'signed_out');
});
test('session: authenticated carries school, user, role and permissions', () => {
  const s = buildSession({ identity: identity(), access: access(['students.view']) });
  assert.equal(s.status, 'authenticated'); assert.equal(s.authenticated, true);
  assert.deepEqual([s.school.id, s.school.businessId, s.school.code, s.school.name, s.school.timeZone], ['t1', 'b1', 'DEMOSCH', 'Demo School', 'Africa/Nairobi']);
  assert.deepEqual([s.user.role, s.user.roleLabel, s.user.isOwner], ['class_teacher', 'Class teacher', false]);
  assert.equal(s.permissions.can('students.view'), true); assert.equal(s.permissions.can('finance.approve'), false); assert.equal(s.permissions.loaded, true);
});
test('session: owner gets owner role and passes every can() even before access has loaded', () => {
  const s = buildSession({ identity: identity({ user: { id: 'u', name: 'Owner', kind: 'staff', isOwner: true } }), access: null });
  assert.equal(s.user.isOwner, true); assert.equal(s.user.role, 'owner'); assert.equal(s.permissions.can('anything'), true); assert.equal(s.permissions.loaded, false);
  const t = buildSession({ identity: identity(), access: null });
  assert.equal(t.permissions.can('students.view'), false, 'a non-owner holds nothing until access is loaded');
});
test('school record: shown exactly as stored, tolerant of alternative field names', () => {
  assert.equal(buildSchool(null), null);
  assert.equal(buildSchool({ id: 'x', school_code: 'ab12' }).code, 'ab12');
  assert.equal(buildSchool({ id: 'x', business_code: 'TEST-01', time_zone: 'Africa/Kampala' }).timeZone, 'Africa/Kampala');
});
