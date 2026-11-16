// elimu/exams/hooks/useMarkSheet.js — one mark sheet: load (online, or the cached copy offline), edit, save drafts, submit, sync.
// Offline: edits are queued in elimuOffline and shown as "saved on this phone — not yet sent" until the server confirms them.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOnline } from '../../../components/network/networkKit';
import { examService } from '../services/examService';
import { elimuOffline, overlayPending } from '../../offline/elimuOfflineStore';
import { buildSavePayload, parseMarks } from '../utils/markValidation';
import { isNetworkFailure } from '../../../offline/netErrors';
import { useElimu } from '../../shared/hooks/ElimuContext';

const PAGE = 100;
const toRow = (r) => ({ ...r, marksText: r.obtained_marks == null ? '' : String(r.obtained_marks), dirty: false, error: null });

export function useMarkSheet(assessmentId) {
  const online = useOnline();
  const { tenantId } = useElimu();
  const [sheet, setSheet] = useState(null);                 // { assessment, total, summary }
  const [rows, setRows] = useState([]);
  const [state, setState] = useState({ loading: true, error: null, saving: false, fromCache: false });
  const [search, setSearch] = useState(''); const [page, setPage] = useState(0);
  const [sync, setSync] = useState({ waiting: 0, needsAttention: 0, legacyUnscoped: 0 }); const [notice, setNotice] = useState(null);
  const busy = useRef(false);

  const refreshSync = useCallback(async () => { if (tenantId && assessmentId) setSync(await elimuOffline.counts(tenantId, assessmentId)); }, [tenantId, assessmentId]);

  const load = useCallback(async () => {
    if (!tenantId || !assessmentId) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    let data = null; let fromCache = false;
    try { data = await examService.getMarkSheet(assessmentId, { search: search || null, limit: PAGE, offset: page * PAGE }); if (!search && page === 0) await elimuOffline.cacheSheet(tenantId, assessmentId, data); }
    catch (e) {
      if (isNetworkFailure(e) || e?.isNetwork) { const c = await elimuOffline.getCachedSheet(tenantId, assessmentId); if (c) { data = c.sheet; fromCache = true; } }
      if (!data) { setState({ loading: false, error: e.message, saving: false, fromCache: false }); return; }
    }
    const pending = await elimuOffline.list(tenantId, assessmentId);
    setSheet({ assessment: data.assessment, total: data.total, summary: data.summary });
    setRows(overlayPending(data.rows, pending).map((r) => ({ ...toRow(r), dirty: !!r.pendingId })));
    setState({ loading: false, error: null, saving: false, fromCache }); await refreshSync();
  }, [tenantId, assessmentId, search, page, refreshSync]);
  useEffect(() => { load(); }, [load]);

  const edit = useCallback((enrollmentId, patch) => setRows((rs) => rs.map((r) => {
    if (r.enrollment_id !== enrollmentId) return r;
    const n = { ...r, ...patch, dirty: true, error: null };
    if ('marksText' in patch && !('mark_status' in patch)) {          // typing marks implies Present; clearing them never implies zero
      const { value } = parseMarks(patch.marksText); n.mark_status = value === null && String(patch.marksText).trim() === '' ? (r.mark_status === 'PRESENT' ? 'PENDING' : r.mark_status) : 'PRESENT';
    }
    if (patch.mark_status && patch.mark_status !== 'PRESENT') n.marksText = '';
    return n;
  })), []);

  const applyResults = useCallback((results) => setRows((rs) => rs.map((r) => {
    const x = results.find((q) => q.enrollment_id === r.enrollment_id); if (!x) return r;
    if (x.ok) return { ...r, dirty: false, error: null, version: x.version ?? r.version, localState: undefined };
    return { ...r, error: x.message || x.code, conflict: x.code === 'CONFLICT' };
  })), []);

  /** Save drafts (what changed). Online -> server; offline / connection lost -> queued on the phone. */
  const saveDraft = useCallback(async ({ submit = false } = {}) => {
    if (busy.current || !sheet) return null; busy.current = true; setState((s) => ({ ...s, saving: true })); setNotice(null);
    try {
      const { entries, errors, hasErrors } = buildSavePayload(rows, Number(sheet.assessment.max_marks));
      if (hasErrors) { setRows((rs) => rs.map((r) => (errors[r.enrollment_id] ? { ...r, error: errors[r.enrollment_id] } : r))); setNotice({ tone: 'bad', text: 'Fix the highlighted rows first. Nothing was saved.' }); return null; }
      if (!entries.length) { setNotice({ tone: 'info', text: 'No changes to save.' }); return { saved: 0 }; }
      try {
        const res = await examService.saveMarks(assessmentId, entries, { submit });
        applyResults(res.results || []);
        setNotice(res.rejected ? { tone: 'warn', text: `${res.saved} saved, ${res.rejected} need your attention (see the red rows).` } : { tone: 'good', text: submit ? 'Saved and submitted.' : `Saved ${res.saved} draft${res.saved === 1 ? '' : 's'}.` });
        if (res.saved > 0) await load();
        return res;
      } catch (e) {
        if (!(isNetworkFailure(e) || e?.isNetwork)) { setNotice({ tone: 'bad', text: e.message }); return null; }
        await elimuOffline.queueMany(tenantId, assessmentId, entries);                       // offline: keep on the phone, say so honestly
        setRows((rs) => rs.map((r) => (entries.some((x) => x.enrollment_id === r.enrollment_id) ? { ...r, localState: 'PENDING', error: null } : r)));
        setNotice({ tone: 'warn', text: `No connection. ${entries.length} change${entries.length === 1 ? '' : 's'} saved on this phone only — NOT yet sent. They will upload when you are back online.${submit ? ' Submitting needs a connection.' : ''}` });
        await refreshSync(); return { queued: entries.length };
      }
    } finally { busy.current = false; setState((s) => ({ ...s, saving: false })); }
  }, [tenantId, rows, sheet, assessmentId, applyResults, load, refreshSync]);

  /** Finalize: needs a connection. If students are still PENDING the server says so; pass markRemainingAs to decide for them explicitly. */
  const submit = useCallback(async (markRemainingAs = null) => {
    if (!online) { setNotice({ tone: 'bad', text: 'Submitting needs a connection. Your drafts are safe on this phone.' }); return null; }
    if (rows.some((r) => r.dirty)) { const r = await saveDraft(); if (!r || r.queued) return null; }
    try {
      const res = await examService.submitMarks(assessmentId, markRemainingAs);
      if (!res.ok) { setNotice({ tone: 'warn', text: res.message }); return res; }
      setNotice({ tone: 'good', text: `Submitted ${res.submitted} mark${res.submitted === 1 ? '' : 's'}.` }); await load(); return res;
    } catch (e) { setNotice({ tone: 'bad', text: e.message }); return null; }
  }, [online, rows, assessmentId, saveDraft, load]);

  const syncNow = useCallback(async () => {
    const r = await elimuOffline.syncAll(tenantId, examService.saveMarks);
    if (r.authExpired) setNotice({ tone: 'bad', text: 'Your sign-in expired. Sign in again; nothing was lost.' });
    else if (r.offline) setNotice({ tone: 'warn', text: 'Still offline. Your changes are kept on this phone.' });
    else setNotice({ tone: r.attention ? 'warn' : 'good', text: `${r.synced} uploaded${r.attention ? `, ${r.attention} need attention` : ''}.` });
    await load(); return r;
  }, [tenantId, load]);
  useEffect(() => { if (online) elimuOffline.counts(tenantId).then((c) => { if (c.waiting) syncNow(); }); }, [online, tenantId, syncNow]);

  const resolveConflict = useCallback(async (pendingId, choice) => { await elimuOffline.resolve(tenantId, pendingId, choice); if (choice === 'keepMine') await syncNow(); else await load(); }, [tenantId, syncNow, load]);

  const dirtyCount = useMemo(() => rows.filter((r) => r.dirty).length, [rows]);
  return { online, sheet, rows, ...state, search, setSearch: (v) => { setPage(0); setSearch(v); }, page, setPage, pageSize: PAGE, edit, saveDraft, submit, syncNow, resolveConflict, reload: load, sync, dirtyCount, notice, setNotice };
}
