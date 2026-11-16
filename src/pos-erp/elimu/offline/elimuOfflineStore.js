// elimu/offline/elimuOfflineStore.js
// Offline marks entry. WHY a separate local store and not the POS `outbox` table: the POS sync engine's drain() marks any outbox row whose
// `kind` it does not know as FAILED, and its handler list is not extensible without editing offline/syncEngine.js. Rather than modify
// existing POS code, elimu keeps its own small IndexedDB ("umova_elimu_offline") and REUSES the POS pieces that are safe to import:
// isNetworkFailure/isAuthFailure (offline/netErrors) and newUuid (offline/idGenerator). See INTEGRATION.md "Offline" for the optional
// 6-line patch that would let this live in the shared outbox instead.
//
// SAFETY MODEL (the server does the hard part, see elimu_save_marks):
//   * every queued edit remembers base_version = the version the phone last SAW. If someone changed the mark meanwhile the server answers
//     CONFLICT; we KEEP the phone's value and show both - nothing is overwritten silently.
//   * replaying a batch is safe: identical values come back UNCHANGED (no duplicate rows, no double entry).
//   * submitted/locked/forbidden/invalid rows are NEVER dropped quietly: they stay in the list with the reason until the person resolves them.
//   * "Saved on this phone" is not "saved": the UI must say so until syncAll() has cleared the row.
import Dexie from 'dexie';
import { isNetworkFailure, isAuthFailure } from '../../offline/netErrors';
import { newUuid } from '../../offline/idGenerator';

export const elimuDb = new Dexie('umova_elimu_offline');
elimuDb.version(1).stores({
  sheets: 'assessment_id, fetched_at',
  pending: '++id, assessment_id, [assessment_id+enrollment_id], status',
});
// v2 scopes every new cache and queued edit to the active Elimu tenant. Legacy v1 rows
// are deliberately left unscoped: assigning them to whichever tenant signs in next
// could disclose another school's cached marks or replay edits into the wrong school.
elimuDb.version(2).stores({
  sheets: 'assessment_id, tenant_id, [tenant_id+assessment_id], fetched_at',
  pending: '++id, assessment_id, tenant_id, [tenant_id+assessment_id], [tenant_id+assessment_id+enrollment_id], status',
});

export const PENDING_STATUS = Object.freeze({ PENDING: 'PENDING', CONFLICT: 'CONFLICT', REJECTED: 'REJECTED' });

let fallbackSyncBusy = false;

export const elimuOffline = {
  async cacheSheet(tenantId, assessmentId, sheet) {
    if (!tenantId || !assessmentId) throw new Error('A school and assessment are required for offline caching.');
    await elimuDb.sheets.put({ assessment_id: assessmentId, tenant_id: tenantId, sheet, fetched_at: Date.now() });
  },
  async getCachedSheet(tenantId, assessmentId) {
    if (!tenantId || !assessmentId) return null;
    const row = await elimuDb.sheets.get(assessmentId);
    return row?.tenant_id === tenantId ? row : null;
  },

  /** Queue (or replace) the phone's latest edit for one student. base_version is only set the first time, so a conflict check stays honest. */
  async queue(tenantId, assessmentId, entry) {
    if (!tenantId || !assessmentId || !entry?.enrollment_id) throw new Error('A school, assessment and enrolment are required for offline marks.');
    const existing = await elimuDb.pending.where('[tenant_id+assessment_id+enrollment_id]').equals([tenantId, assessmentId, entry.enrollment_id]).first();
    const row = { tenant_id: tenantId, assessment_id: assessmentId, enrollment_id: entry.enrollment_id, mark_status: entry.mark_status, obtained_marks: entry.obtained_marks ?? null, remarks: entry.remarks ?? null,
      base_version: existing ? existing.base_version : (entry.base_version ?? 0), status: PENDING_STATUS.PENDING, message: null, server_version: null, updated_at: Date.now() };
    if (existing) await elimuDb.pending.update(existing.id, row); else await elimuDb.pending.add({ ...row, created_at: Date.now() });
  },
  async queueMany(tenantId, assessmentId, entries) { for (const e of entries) await this.queue(tenantId, assessmentId, e); },

  // Tenant is mandatory. Unscoped v1 records are not returned to any school.
  list: async (tenantId, assessmentId) => {
    if (!tenantId) return [];
    const rows = assessmentId ? await elimuDb.pending.where('assessment_id').equals(assessmentId).toArray() : await elimuDb.pending.toArray();
    return rows.filter((r) => r.tenant_id === tenantId);
  },
  async counts(tenantId, assessmentId) {
    const rows = await this.list(tenantId, assessmentId);
    const legacyRows = await elimuDb.pending.toArray();
    const legacyUnscoped = legacyRows.filter((r) => !r.tenant_id && (!assessmentId || r.assessment_id === assessmentId)).length;
    return { waiting: rows.filter((r) => r.status === 'PENDING' || r.status === 'SYNCING').length, needsAttention: rows.filter((r) => r.status !== 'PENDING' && r.status !== 'SYNCING').length, legacyUnscoped, total: rows.length };
  },

  /**
   * Send everything that is waiting. `save(assessmentId, entries, { batch })` is examService.saveMarks (injected so this file is testable).
   * Returns { synced, attention, offline, authExpired }. Never throws for a network problem: rows simply stay queued.
   */
  async syncAll(tenantId, save) {
    if (!tenantId) return { synced: 0, attention: 0, offline: false, authExpired: false, skipped: true, reason: 'TENANT_REQUIRED' };
    const run = async () => {
      // A prior page close can leave rows SYNCING. Requeue only this tenant's rows.
      const allTenantRows = await this.list(tenantId);
      for (const row of allTenantRows.filter((r) => r.status === 'SYNCING')) await elimuDb.pending.update(row.id, { status: PENDING_STATUS.PENDING });
      const waiting = allTenantRows.filter((r) => r.status === PENDING_STATUS.PENDING);
      const byAssessment = new Map(); for (const r of waiting) { if (!byAssessment.has(r.assessment_id)) byAssessment.set(r.assessment_id, []); byAssessment.get(r.assessment_id).push(r); }
      const out = { synced: 0, attention: 0, offline: false, authExpired: false };
      for (const [assessmentId, rows] of byAssessment) {
        for (let i = 0; i < rows.length; i += 200) {
          const chunk = rows.slice(i, i + 200); const batch = newUuid();
          for (const row of chunk) await elimuDb.pending.update(row.id, { status: 'SYNCING', last_tried_at: Date.now() });
          let res;
          try { res = await save(assessmentId, chunk.map((r) => ({ enrollment_id: r.enrollment_id, mark_status: r.mark_status, obtained_marks: r.obtained_marks, remarks: r.remarks, base_version: r.base_version })), { batch }); }
          catch (e) {
            if (isAuthFailure(e)) { for (const row of chunk) await elimuDb.pending.update(row.id, { status: PENDING_STATUS.PENDING }); out.authExpired = true; return out; }
            if (isNetworkFailure(e) || e?.isNetwork) { for (const row of chunk) await elimuDb.pending.update(row.id, { status: PENDING_STATUS.PENDING }); out.offline = true; return out; }
            for (const r of chunk) await elimuDb.pending.update(r.id, { status: PENDING_STATUS.REJECTED, message: e?.message || 'The server refused this save.' });   // e.g. no longer assigned / assessment locked
            out.attention += chunk.length; continue;
          }
          const byEnr = new Map((res?.results || []).map((x) => [x.enrollment_id, x]));
          for (const r of chunk) {
            const x = byEnr.get(r.enrollment_id);
            if (!x) { await elimuDb.pending.update(r.id, { status: PENDING_STATUS.REJECTED, message: 'The server gave no answer for this student.' }); out.attention += 1; }
            else if (x.ok) { await elimuDb.pending.delete(r.id); out.synced += 1; }
            else if (x.code === 'CONFLICT') { await elimuDb.pending.update(r.id, { status: PENDING_STATUS.CONFLICT, message: x.message, server_version: x.version }); out.attention += 1; }
            else { await elimuDb.pending.update(r.id, { status: PENDING_STATUS.REJECTED, message: x.message || x.code }); out.attention += 1; }
          }
        }
      }
      return out;
    };
    // one sync at a time across tabs
    if (typeof navigator !== 'undefined' && navigator.locks?.request) return navigator.locks.request('elimu-marks-sync', run);
    if (fallbackSyncBusy) return { synced: 0, attention: 0, offline: false, authExpired: false, skipped: true, reason: 'SYNC_IN_PROGRESS' };
    fallbackSyncBusy = true;
    try { return await run(); } finally { fallbackSyncBusy = false; }
  },

  /** Conflict resolution. keepMine: re-queue the phone's value against the server's current version. useServer: drop the phone's value. */
  async resolve(tenantId, id, choice) {
    const r = await elimuDb.pending.get(id); if (!r || !tenantId || r.tenant_id !== tenantId) return;
    if (choice === 'useServer') await elimuDb.pending.delete(id);
    else await elimuDb.pending.update(id, { status: PENDING_STATUS.PENDING, base_version: r.server_version ?? r.base_version, message: null });
  },
  async discard(tenantId, id) { const r = await elimuDb.pending.get(id); if (r?.tenant_id === tenantId) return elimuDb.pending.delete(id); },
};

/** Overlay the phone's unsent edits on a sheet's rows, flagging them so the grid can show "saved on this phone, not yet sent". */
export function overlayPending(rows, pending) {
  const m = new Map(pending.map((p) => [p.enrollment_id, p]));
  return rows.map((r) => { const p = m.get(r.enrollment_id); return p ? { ...r, mark_status: p.mark_status, obtained_marks: p.obtained_marks, remarks: p.remarks, localState: p.status, localMessage: p.message, pendingId: p.id } : r; });
}
