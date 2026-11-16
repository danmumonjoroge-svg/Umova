// Run (needs dexie + fake-indexeddb installed):  node --experimental-default-type=module --test elimu/tests/offline.test.mjs
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { elimuOffline, overlayPending, PENDING_STATUS } from '../offline/elimuOfflineStore.js';

const reset = async () => { const { elimuDb } = await import('../offline/elimuOfflineStore.js'); await elimuDb.pending.clear(); await elimuDb.sheets.clear(); };
const entry = (id, marks, extra = {}) => ({ enrollment_id: id, mark_status: 'PRESENT', obtained_marks: marks, base_version: 1, ...extra });


test('offline: mark queues and caches are isolated by tenant', async () => {
  await reset();
  await elimuOffline.queue('school-1', 'A1', entry('e1', 10));
  await elimuOffline.queue('school-2', 'A1', entry('e1', 20));
  assert.equal((await elimuOffline.list('school-1', 'A1')).length, 1);
  assert.equal((await elimuOffline.list('school-1', 'A1'))[0].obtained_marks, 10);
  assert.equal((await elimuOffline.list('school-2', 'A1'))[0].obtained_marks, 20);
  await elimuOffline.cacheSheet('school-1', 'A1', { rows: [{ enrollment_id: 'e1' }] });
  assert.equal((await elimuOffline.getCachedSheet('school-2', 'A1')), null);
});
test('offline: edits queue locally, the latest edit per student wins, base_version stays the first seen', async () => {
  await reset();
  await elimuOffline.queue('school-1', 'A1', entry('e1', 10, { base_version: 3 }));
  await elimuOffline.queue('school-1', 'A1', entry('e1', 12, { base_version: 9 }));
  const rows = await elimuOffline.list('school-1', 'A1');
  assert.equal(rows.length, 1); assert.equal(rows[0].obtained_marks, 12); assert.equal(rows[0].base_version, 3);
  assert.deepEqual(await elimuOffline.counts('school-1', 'A1'), { waiting: 1, needsAttention: 0, legacyUnscoped: 0, total: 1 });
});
test('offline: while offline nothing is lost and nothing is called synced', async () => {
  await reset(); await elimuOffline.queueMany('school-1', 'A1', [entry('e1', 5), entry('e2', 6)]);
  const r = await elimuOffline.syncAll('school-1', async () => { throw new Error('TypeError: Failed to fetch'); });
  assert.equal(r.offline, true); assert.equal(r.synced, 0); assert.equal((await elimuOffline.counts('school-1')).waiting, 2);
});
test('offline: sync clears OK rows, keeps conflicts / rejections visible with the reason', async () => {
  await reset(); await elimuOffline.queueMany('school-1', 'A1', [entry('e1', 5), entry('e2', 6), entry('e3', 7), entry('e4', 8)]);
  const r = await elimuOffline.syncAll('school-1', async (_a, entries) => ({ results: entries.map((e) => ({
    e1: { enrollment_id: 'e1', ok: true, code: 'OK' }, e2: { enrollment_id: 'e2', ok: true, code: 'UNCHANGED' },
    e3: { enrollment_id: 'e3', ok: false, code: 'CONFLICT', message: 'Someone else changed this mark', version: 4 },
    e4: { enrollment_id: 'e4', ok: false, code: 'SUBMITTED_LOCKED', message: 'These marks were submitted.' } }[e.enrollment_id])) }));
  assert.equal(r.synced, 2); assert.equal(r.attention, 2);
  const left = await elimuOffline.list('school-1', 'A1'); assert.deepEqual(left.map((x) => [x.enrollment_id, x.status]).sort(), [['e3', 'CONFLICT'], ['e4', 'REJECTED']]);
  assert.equal(left.find((x) => x.enrollment_id === 'e3').obtained_marks, 7, 'the phone value is kept, not overwritten');
});
test('offline: resolving a conflict: keep mine re-queues against the server version; use server drops it', async () => {
  await reset(); await elimuOffline.queue('school-1', 'A1', entry('e3', 7));
  await elimuOffline.syncAll('school-1', async () => ({ results: [{ enrollment_id: 'e3', ok: false, code: 'CONFLICT', message: 'x', version: 4 }] }));
  const [c] = await elimuOffline.list('school-1', 'A1'); await elimuOffline.resolve('school-1', c.id, 'keepMine');
  const [again] = await elimuOffline.list('school-1', 'A1'); assert.equal(again.status, PENDING_STATUS.PENDING); assert.equal(again.base_version, 4);
  await elimuOffline.resolve('school-1', again.id, 'useServer'); assert.equal((await elimuOffline.list('school-1', 'A1')).length, 0);
});
test('offline: a whole-request rejection (e.g. no longer assigned) is parked for attention, not retried forever', async () => {
  await reset(); await elimuOffline.queue('school-1', 'A1', entry('e1', 5));
  const r = await elimuOffline.syncAll('school-1', async () => { throw new Error('Assessment not found.'); });
  assert.equal(r.attention, 1); const [x] = await elimuOffline.list('school-1', 'A1'); assert.equal(x.status, 'REJECTED'); assert.match(x.message, /not found/);
});
test('offline: expired sign-in stops the sync and keeps everything', async () => {
  await reset(); await elimuOffline.queue('school-1', 'A1', entry('e1', 5));
  const r = await elimuOffline.syncAll('school-1', async () => { const e = new Error('JWT expired'); e.status = 401; throw e; });
  assert.equal(r.authExpired, true); assert.equal((await elimuOffline.counts('school-1')).waiting, 1);
});
test('offline: cached sheet round-trips and unsent edits overlay it', async () => {
  await reset(); await elimuOffline.cacheSheet('school-1', 'A1', { rows: [{ enrollment_id: 'e1', mark_status: 'PENDING' }] });
  assert.equal((await elimuOffline.getCachedSheet('school-1', 'A1')).sheet.rows.length, 1);
  await elimuOffline.queue('school-1', 'A1', entry('e1', 9));
  const o = overlayPending([{ enrollment_id: 'e1', mark_status: 'PENDING' }, { enrollment_id: 'e2', mark_status: 'PENDING' }], await elimuOffline.list('school-1', 'A1'));
  assert.equal(o[0].obtained_marks, 9); assert.equal(o[0].localState, 'PENDING'); assert.equal(o[1].localState, undefined);
});
