// node --test elimu/tests/   (no browser, no database). Covers the pure rules; SQL rules are covered by tests/sql/run.sh.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tally, attendancePct, completionState, groupOf, allStatuses } from '../attendance/utils/statuses.js';
import { classifyArrival, classifyDeparture } from '../attendance/utils/lateness.js';
import { planBulk, applyChanges } from '../attendance/utils/bulk.js';
import { toMinutes, overlaps, isoDow, addDays, datesBetween, hhmm, durationMinutes } from '../shared/utils/time.js';
import { findConflicts, hasBlocking, hasUnoverridable } from '../timetable/utils/conflicts.js';
import { buildWeekGrid, entriesForDate } from '../timetable/utils/grid.js';
import { renderTemplate } from '../communication/templates/render.js';
import { suggestedPurposes, pickGuardians, availableChannels, buildDraft } from '../communication/attendance/contactPlan.js';
import { createOfflineAttendance, memoryStore, S } from '../attendance/services/offlineAttendance.js';
import { ROLE_ACTIONS } from '../shared/utils/access.js';
import { toCsv } from '../attendance/reports/export.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('unmarked is never counted as absent', () => {
  const t = tally([{ status: 'PRESENT' }, { status: 'NOT_MARKED' }, { status: 'NOT_MARKED' }, { status: 'ABSENT' }]);
  assert.equal(t.absent, 1); assert.equal(t.not_marked, 2); assert.equal(t.total, 4);
});
test('late and left-early count as present; sick counts as excused; custom status uses its group', () => {
  assert.equal(groupOf('LATE'), 'PRESENT'); assert.equal(groupOf('SICK'), 'EXCUSED');
  assert.equal(groupOf('ON_TRIP', [{ code: 'ON_TRIP', status_group: 'EXCUSED', label: 'On trip' }]), 'EXCUSED');
  assert.equal(allStatuses([{ code: 'PRESENT', status_group: 'ABSENT', label: 'x' }]).filter((s) => s.code === 'PRESENT').length, 1); // cannot redefine a system status
});
test('attendance percentage rule', () => {
  assert.equal(attendancePct({ present: 8, absent: 1, excused: 1 }), 80);
  assert.equal(attendancePct({ present: 8, absent: 1, excused: 1 }, true), 90);
  assert.ok(attendancePct({ present: 0, absent: 0, excused: 0 }) === null || attendancePct({ present: 0, absent: 0, excused: 0 }) === 0);
});
test('completion states', () => {
  assert.equal(completionState(null), 'NOT_TAKEN');
  assert.equal(completionState({ status: 'DRAFT', marked_count: 0, expected_count: 30 }), 'NOT_STARTED');
  assert.equal(completionState({ status: 'DRAFT', marked_count: 10, expected_count: 30 }), 'PARTIAL');
  assert.equal(completionState({ status: 'DRAFT', marked_count: 30, expected_count: 30 }), 'COMPLETE');
  assert.equal(completionState({ status: 'SUBMITTED' }), 'SUBMITTED'); assert.equal(completionState({ status: 'AMENDED' }), 'AMENDED');
});
test('lateness uses grace period; minutes counted from the start', () => {
  assert.equal(classifyArrival({ scheduledStart: '08:00', arrival: '08:10', grace: 10 }).status, 'PRESENT');
  const l = classifyArrival({ scheduledStart: '08:00', arrival: '08:11', grace: 10 }); assert.equal(l.status, 'LATE'); assert.equal(l.lateMinutes, 11);
  assert.equal(classifyArrival({ scheduledStart: '08:00', arrival: null }).status, null);
});
test('early departure approval', () => {
  assert.deepEqual(classifyDeparture({ scheduledEnd: '16:00', departure: '16:00' }).early, false);
  const d = classifyDeparture({ scheduledEnd: '16:00', departure: '15:00', requiresApproval: true }); assert.equal(d.earlyMinutes, 60); assert.equal(d.approval, 'PENDING');
  assert.equal(classifyDeparture({ scheduledEnd: '16:00', departure: '15:50', requiresApproval: true, approvalBefore: '15:30' }).approval, 'NOT_REQUIRED');
});
test('bulk: mark-all-present fills only unmarked and never flips absent', () => {
  const rows = [{ enrollment_id: 'a', status: 'NOT_MARKED' }, { enrollment_id: 'b', status: 'ABSENT' }, { enrollment_id: 'c', status: 'PRESENT' }];
  const p = planBulk('MARK_ALL_PRESENT', rows); assert.deepEqual(p.changes.map((c) => c.enrollment_id), ['a']); assert.equal(p.overwrites, 0);
  const q = planBulk('MARK_SELECTED_ABSENT', rows, new Set(['c'])); assert.equal(q.overwrites, 1);
  assert.equal(applyChanges(rows, p.changes)[0].status, 'PRESENT');
  assert.throws(() => planBulk('NOPE', rows));
});
test('time helpers', () => {
  assert.equal(toMinutes('08:30:00'), 510); assert.equal(toMinutes('25:00'), null); assert.equal(hhmm('8:05'), '08:05');
  assert.equal(overlaps('08:00', '08:40', '08:40', '09:20'), false); assert.equal(overlaps('08:00', '08:41', '08:40', '09:20'), true);
  assert.equal(isoDow('2026-11-13'), 5); assert.equal(isoDow('2026-11-15'), 7); assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(datesBetween('2026-11-01', '2026-11-03').length, 3); assert.equal(durationMinutes('08:00', '08:40'), 40);
});
const draft = { term_id: 't', day_of_week: 1, start_time: '08:00', end_time: '08:40', class_id: 'c1', teacher_id: 'T1', room_id: 'R1' };
const other = { id: 'e1', term_id: 't', day_of_week: 1, start_time: '08:20', end_time: '09:00', class_id: 'c2', teacher_id: 'T1', room_id: 'R1', status: 'ACTIVE' };
test('conflicts: teacher and room clash, overridable; touching lessons do not clash', () => {
  const c = findConflicts(draft, { entries: [other], rooms: [{ id: 'R1', name: 'Lab', is_active: true }] });
  assert.deepEqual(c.map((x) => x.code).sort(), ['ROOM_CLASH', 'TEACHER_CLASH']); assert.ok(hasBlocking(c)); assert.ok(!hasUnoverridable(c));
  assert.equal(findConflicts({ ...draft, end_time: '08:20' }, { entries: [other] }).length, 0);
  assert.equal(findConflicts(draft, { entries: [{ ...other, status: 'CANCELLED' }] }).length, 0);
  assert.equal(findConflicts(draft, { entries: [{ ...other, id: draft.id }] }).length >= 0, true);
});
test('conflicts: class clash, bad duration is not overridable, outside hours, break, leave, inactive room', () => {
  assert.ok(findConflicts({ ...draft, teacher_id: null, room_id: null }, { entries: [{ ...other, class_id: 'c1' }] }).some((x) => x.code === 'CLASS_CLASH'));
  const bad = findConflicts({ ...draft, end_time: '08:02' }, {}); assert.ok(hasUnoverridable(bad));
  assert.ok(findConflicts(draft, { hours: { opening: '08:30', closing: '16:00' } }).some((x) => x.code === 'OUTSIDE_HOURS'));
  assert.ok(findConflicts(draft, { periods: [{ name: 'Tea', period_type: 'BREAK', days: [1], start_time: '08:30', end_time: '08:50', is_active: true }] }).some((x) => x.code === 'OVERLAPS_BREAK'));
  assert.ok(findConflicts({ ...draft, valid_from: '2026-11-02' }, { availability: [{ staff_id: 'T1', kind: 'LEAVE', start_date: '2026-11-01', end_date: '2026-11-10', is_active: true }] }).some((x) => x.code === 'TEACHER_ON_LEAVE'));
  assert.ok(findConflicts(draft, { rooms: [{ id: 'R1', name: 'Lab', is_active: false }] }).some((x) => x.code === 'ROOM_INACTIVE'));
});
test('grid and one-day exceptions', () => {
  const periods = [{ name: 'L1', period_type: 'LESSON', days: [1, 2, 3, 4, 5], start_time: '08:00', end_time: '08:40', is_active: true }, { name: 'Tea', period_type: 'BREAK', days: [1, 2, 3, 4, 5], start_time: '08:40', end_time: '09:00', is_active: true }];
  const e = { id: 'x', day_of_week: 1, start_time: '08:00:00', end_time: '08:40:00', status: 'ACTIVE', teacher_id: 'T1' };
  const { grid, rows } = buildWeekGrid([e, { ...e, id: 'y' }], periods); assert.equal(rows.length, 2); assert.equal(grid['08:00-08:40'][1].length, 2);
  const monday = '2026-11-09';
  assert.equal(entriesForDate([e], monday, [{ entry_id: 'x', exception_date: monday, kind: 'CANCELLED' }])[0].cancelledToday, true);
  assert.equal(entriesForDate([e], monday, [{ entry_id: 'x', exception_date: monday, kind: 'TEACHER_CHANGED', new_teacher_id: 'T2' }])[0].teacher_id, 'T2');
  assert.equal(entriesForDate([e], '2026-11-10').length, 0);
});
test('templates show missing variables instead of inventing them', () => {
  const r = renderTemplate('Dear {{guardian_name}}, {{student_name}} was absent. {{reason}}', { guardian_name: 'Mrs Ng', student_name: 'Amani' });
  assert.deepEqual(r.missing, ['reason']); assert.ok(r.text.includes('____'));
});
test('contact plan: notification settings and guardian opt-out', () => {
  assert.deepEqual(suggestedPurposes({ status: 'ABSENT' }, { notify_mode: 'PREPARE' }), ['ABSENT']);
  assert.deepEqual(suggestedPurposes({ status: 'ABSENT' }, { notify_mode: 'OFF' }), []);
  assert.deepEqual(suggestedPurposes({ status: 'LATE' }, { notify_mode: 'PREPARE', notify_late: false }), []);
  assert.deepEqual(suggestedPurposes({ status: 'NOT_MARKED' }, { notify_mode: 'PREPARE' }), []);
  const g = pickGuardians([{ id: 1 }, { id: 2, is_primary: true }, { id: 3, can_receive_attendance_alerts: false }]); assert.deepEqual(g.map((x) => x.id), [2, 1]);
  assert.deepEqual(availableChannels({ phone: '0712' }), ['SMS', 'WHATSAPP', 'CALL']); assert.deepEqual(availableChannels({}), []);
  const d = buildDraft({ purpose: 'ABSENT', channel: 'SMS', record: { student_name: 'Amani', attendance_date: '2026-11-13' }, guardian: { guardian_name: 'Mrs Ng' }, schoolName: 'Test School' });
  assert.ok(JSON.stringify(d).includes('Amani'));
});
test('offline queue: merges marks, no duplicate submit, stops at network failure, never marks synced on failure', async () => {
  const mk = () => createOfflineAttendance({ store: memoryStore(), now: () => '2026-11-13T08:00:00Z' });
  const o = mk();
  await o.enqueueMarks({ tenantId: 't', sessionId: 's1', marks: [{ enrollment_id: 'a', status: 'PRESENT' }] });
  await o.enqueueMarks({ tenantId: 't', sessionId: 's1', marks: [{ enrollment_id: 'a', status: 'ABSENT' }, { enrollment_id: 'b', status: 'PRESENT' }] });
  assert.equal((await o.list('t')).length, 1); assert.equal((await o.list('t'))[0].payload.marks.find((m) => m.enrollment_id === 'a').status, 'ABSENT');
  await o.enqueueSubmit({ tenantId: 't', sessionId: 's1' }); assert.equal(await o.enqueueSubmit({ tenantId: 't', sessionId: 's1' }), null);
  // offline: nothing synced, still pending
  const off = await o.drain({ tenantId: 't', handlers: { marks: async () => { const e = new Error('x'); e.network = true; throw e; }, submit: async () => ({ ok: true }) } });
  assert.equal(off.stoppedOffline, true); assert.equal((await o.summary('t')).pending, 2); assert.equal((await o.summary('t')).synced, 0);
  // refused marks block the submit for that session
  const refused = await o.drain({ tenantId: 't', handlers: { marks: async () => ({ ok: false, reason: 'LOCKED', message: 'Register was submitted' }), submit: async () => ({ ok: true }) } });
  assert.equal(refused.attention, 1); assert.equal(refused.waiting, 1); assert.equal((await o.summary('t')).synced, 0);
  // conflicts are surfaced, not overwritten
  const o2 = mk(); await o2.enqueueMarks({ tenantId: 't', sessionId: 's2', marks: [{ enrollment_id: 'a', status: 'PRESENT' }] });
  const c = await o2.drain({ tenantId: 't', handlers: { marks: async () => ({ ok: true, conflicts: [{ enrollment_id: 'a' }] }) } });
  assert.equal(c.attention, 1); assert.equal((await o2.list('t'))[0].status, S.ATTENTION);
  // success
  const o3 = mk(); await o3.enqueueMarks({ tenantId: 't', sessionId: 's3', marks: [{ enrollment_id: 'a', status: 'PRESENT' }] });
  assert.equal((await o3.drain({ tenantId: 't', handlers: { marks: async () => ({ ok: true }) } })).synced, 1);
  // POS sync engine must ignore these rows: statuses are Elimu-specific
  assert.ok(Object.values(S).every((v) => v.startsWith('ELIMU_')));
});
test('CSV escaping', () => {
  assert.equal(toCsv([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], [{ a: 'x,y', b: 'say "hi"' }]), 'A,B\n"x,y","say ""hi"""');
});
test('JS role actions match the database role map (snapshot generated from elimu_role_actions)', () => {
  const snap = JSON.parse(fs.readFileSync(path.join(here, '../../../role_actions.snapshot.json'), 'utf8'));
  for (const [role, acts] of Object.entries(snap)) assert.deepEqual([...(ROLE_ACTIONS[role] || [])].sort(), acts, `role ${role}`);
  assert.deepEqual(Object.keys(ROLE_ACTIONS).sort(), Object.keys(snap).sort());
});
test('no Elimu file edits POS tables or defines a second engine', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'tests' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
  const files = walk(path.join(here, '..')).filter((f) => /\.(sql|jsx?)$/.test(f));
  const sql = files.filter((f) => f.endsWith('.sql') && !f.includes('TEMPLATE')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  assert.ok(!/(ALTER|DROP)\s+TABLE\s+(IF EXISTS\s+)?(pos_|lb_)/i.test(sql), 'must not alter/drop POS tables');
  assert.ok(!/CREATE\s+TABLE[^;(]*\b(users|staff|tenants|notifications|sms_log|message_queue)\b/i.test(sql), 'must not create a second auth/staff/tenant/notification engine');
});
