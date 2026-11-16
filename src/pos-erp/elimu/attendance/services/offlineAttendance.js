// elimu/attendance/services/offlineAttendance.js
//
// OFFLINE ATTENDANCE -- built ON the POS offline layer, not beside it:
//   * same IndexedDB database (offline/db.js): drafts in the existing `meta` table, queued actions in the existing `outbox` table
//   * same network helpers (offline/netErrors.js), same "Local / Pending / Synced / Needs attention" honesty as sales
//   * NO new Dexie version, NO change to syncEngine.js
//
// WHY THE OUTBOX ROWS USE THEIR OWN STATUS NAMES (ELIMU_PENDING ...): the POS syncEngine drains every row whose status is
// 'PENDING' and marks unknown kinds FAILED. Using ELIMU_* statuses keeps its hands off our rows until a handler is
// registered for kind 'elimu_attendance' (see INTEGRATION.md "Offline": a 6-line change to syncEngine.HANDLERS that the POS owner can make).
// Until then, drainElimuQueue() below is called by the Elimu pages whenever the connection returns.
//
// WHAT WORKS OFFLINE      : marking a register that was OPENED while online on this device (it is cached when opened; there is no bulk "pre-load all classes" button),
//                           bulk marks, drafts that survive closing the app, submitting (queued), queued guardian messages.
// WHAT NEEDS A CONNECTION : opening a class register for the first time (the roster comes from the server), amending a submitted
//                           register, approving excuses, anything in the timetable.
// CONFLICTS               : each mark carries the server's `updated_at` it was based on; if someone else changed that student
//                           meanwhile the server refuses to overwrite and the item becomes NEEDS_ATTENTION with both values.
// DUPLICATES              : marks are idempotent upserts keyed by (session, enrollment); the server refuses a second session
//                           for the same class/date/lesson; queued items for one session are merged, not stacked.

export const KIND = 'elimu_attendance';
export const S = { PENDING: 'ELIMU_PENDING', SYNCING: 'ELIMU_SYNCING', SYNCED: 'ELIMU_SYNCED', ATTENTION: 'ELIMU_NEEDS_ATTENTION', FAILED: 'ELIMU_FAILED' };
let attendanceDrainBusy = false;

/** Default store: the POS Dexie database. Loaded lazily so pure tests can inject an in-memory store instead. */
export async function dexieStore() {
  const { db, getMeta, setMeta } = await import('../../../offline/db');
  return {
    getMeta, setMeta, delMeta: (k) => db.meta.delete(k),
    addQueue: (row) => db.outbox.add(row), updateQueue: (id, patch) => db.outbox.update(id, patch),
    listQueue: async () => (await db.outbox.where('kind').equals(KIND).toArray()).sort((a, b) => a.id - b.id),
  };
}
/** In-memory store with the same shape (tests, and the fallback when IndexedDB is unavailable). */
export function memoryStore() {
  const meta = new Map(); const rows = []; let seq = 1;
  return {
    getMeta: async (k) => meta.get(k), setMeta: async (k, v) => { meta.set(k, v); }, delMeta: async (k) => { meta.delete(k); },
    addQueue: async (row) => { const r = { ...row, id: seq++ }; rows.push(r); return r.id; },
    updateQueue: async (id, patch) => { Object.assign(rows.find((r) => r.id === id) || {}, patch); },
    listQueue: async () => rows.map((r) => ({ ...r })),
  };
}

export function createOfflineAttendance({ store, now = () => new Date().toISOString(), isNetworkFailure = (e) => !!e?.network }) {
  const draftKey = (tenantId, key) => `elimu:draft:${tenantId}:${key}`;
  const sessKey = (tenantId, key) => `elimu:session:${tenantId}:${key}`;
  return {
    // ---- drafts (survive closing the app) ----
    saveDraft: (tenantId, key, draft) => store.setMeta(draftKey(tenantId, key), { ...draft, savedAt: now() }),
    loadDraft: (tenantId, key) => store.getMeta(draftKey(tenantId, key)),
    clearDraft: (tenantId, key) => store.delMeta(draftKey(tenantId, key)),
    // ---- a register downloaded while online so it can be marked with no signal ----
    cacheSession: (tenantId, key, payload) => store.setMeta(sessKey(tenantId, key), { ...payload, cachedAt: now() }),
    getCachedSession: (tenantId, key) => store.getMeta(sessKey(tenantId, key)),

    /** Queue marks for a session. Pending mark-batches for the same session are MERGED (latest tap per student wins): no duplicates. */
    async enqueueMarks({ tenantId, sessionId, marks, source = 'OFFLINE' }) {
      if (!tenantId || !sessionId) throw new Error('A school and attendance session are required.');
      const rows = await store.listQueue();
      const open = rows.find((r) => r.status === S.PENDING && r.payload.type === 'marks' && r.payload.sessionId === sessionId && r.tenantId === tenantId);
      const stamped = marks.map((m) => ({ ...m, marked_at: m.marked_at || now() }));
      if (open) {
        const byE = new Map(open.payload.marks.map((m) => [m.enrollment_id, m])); stamped.forEach((m) => byE.set(m.enrollment_id, { ...byE.get(m.enrollment_id), ...m }));
        await store.updateQueue(open.id, { payload: { ...open.payload, marks: [...byE.values()] } });
        return open.id;
      }
      return store.addQueue({ kind: KIND, status: S.PENDING, tenantId, createdAt: now(), clientReference: `ELIMU-MARKS-${sessionId}-${now()}`, payload: { type: 'marks', sessionId, marks: stamped, source } });
    },
    /** Queue a submit. If one is already waiting for this session, nothing is added. */
    async enqueueSubmit({ tenantId, sessionId, confirmUnmarked }) {
      if (!tenantId || !sessionId) throw new Error('A school and attendance session are required.');
      const rows = await store.listQueue();
      if (rows.some((r) => r.tenantId === tenantId && [S.PENDING, S.SYNCING, S.SYNCED].includes(r.status) && r.payload.type === 'submit' && r.payload.sessionId === sessionId)) return null;
      return store.addQueue({ kind: KIND, status: S.PENDING, tenantId, createdAt: now(), clientReference: `ELIMU-SUBMIT-${sessionId}`, payload: { type: 'submit', sessionId, confirmUnmarked: !!confirmUnmarked } });
    },
    /** Queue a guardian message. It is NOT sent/recorded until synced: the screen says "waiting", never "sent". */
    async enqueueMessage({ tenantId, message }) {
      if (!tenantId || !message?.recordId || !message?.purpose || !message?.channel) throw new Error('A school and complete message reference are required.');
      const clientReference = `ELIMU-MSG-${message.recordId}-${message.purpose}-${message.guardianId || ''}-${message.channel}`;
      const rows = await store.listQueue();
      const existing = rows.find((r) => r.tenantId === tenantId && r.clientReference === clientReference && [S.PENDING, S.SYNCING, S.SYNCED].includes(r.status));
      if (existing) return existing.id;
      return store.addQueue({ kind: KIND, status: S.PENDING, tenantId, createdAt: now(), clientReference, payload: { type: 'message', message } });
    },
    list: async (tenantId) => (await store.listQueue()).filter((r) => !tenantId || r.tenantId === tenantId),
    async summary(tenantId) {
      const rows = await this.list(tenantId); const c = (s) => rows.filter((r) => r.status === s).length;
      return { pending: c(S.PENDING) + c(S.SYNCING), needsAttention: c(S.ATTENTION) + c(S.FAILED), synced: c(S.SYNCED), total: rows.length };
    },
    /** Retry an item after the teacher dealt with its problem. */
    retry: (id) => store.updateQueue(id, { status: S.PENDING, error: null, conflicts: null }),

    /**
     * Sends waiting items oldest-first. handlers = { marks(payload)->result, submit(payload)->result, message(payload)->result }.
     * Stops at the first network failure (everything after it waits). A server refusal does NOT stop other sessions.
     */
    async drain({ tenantId, handlers }) {
      if (!tenantId) return { synced: 0, attention: 0, failed: 0, waiting: 0, stoppedOffline: false, skipped: true };
      const run = async () => {
      const rows = (await this.list(tenantId)).filter((r) => r.status === S.PENDING || r.status === S.SYNCING);
      const out = { synced: 0, attention: 0, failed: 0, waiting: 0, stoppedOffline: false }; const blockedSessions = new Set();
      for (const row of rows) {
        const p = row.payload;
        if (p.sessionId && blockedSessions.has(p.sessionId)) { out.waiting++; continue; } // a submit must not overtake marks that need attention
        await store.updateQueue(row.id, { status: S.SYNCING, lastTriedAt: now() });
        try {
          const r = await handlers[p.type](p);
          if (r && r.ok === false) {
            const why = r.reason || 'REFUSED';
            await store.updateQueue(row.id, { status: S.ATTENTION, error: r.message || why, result: r }); out.attention++; if (p.sessionId) blockedSessions.add(p.sessionId);
          } else if (r && r.conflicts && r.conflicts.length) {
            // the rest was saved; the disputed students were NOT overwritten
            await store.updateQueue(row.id, { status: S.ATTENTION, error: `${r.conflicts.length} student(s) were changed by someone else. Choose which mark to keep.`, conflicts: r.conflicts, result: r }); out.attention++; if (p.sessionId) blockedSessions.add(p.sessionId);
          } else { await store.updateQueue(row.id, { status: S.SYNCED, syncedAt: now(), error: null, result: r }); out.synced++; }
        } catch (e) {
          if (isNetworkFailure(e)) { await store.updateQueue(row.id, { status: S.PENDING }); out.stoppedOffline = true; out.waiting += rows.length - out.synced - out.attention - out.failed; break; }
          await store.updateQueue(row.id, { status: S.FAILED, error: e?.message || String(e) }); out.failed++; if (p.sessionId) blockedSessions.add(p.sessionId);
        }
      }
      return out;
      };
      if (typeof navigator !== 'undefined' && navigator.locks?.request) return navigator.locks.request('elimu-attendance-sync', run);
      if (attendanceDrainBusy) return { synced: 0, attention: 0, failed: 0, waiting: 0, stoppedOffline: false, skipped: true };
      attendanceDrainBusy = true;
      try { return await run(); } finally { attendanceDrainBusy = false; }
    },
  };
}
let singleton = null;
/** The app-wide instance on the real POS offline database. Never silently fall back to memory:
 * doing so would tell staff their work is saved when it will disappear on reload. */
export async function getOfflineAttendance() {
  if (!singleton) {
    const store = await dexieStore();
    const { isNetworkFailure } = await import('../../../offline/netErrors');
    singleton = createOfflineAttendance({ store, isNetworkFailure: (e) => !!e?.network || isNetworkFailure(e) });
  }
  return singleton;
}
