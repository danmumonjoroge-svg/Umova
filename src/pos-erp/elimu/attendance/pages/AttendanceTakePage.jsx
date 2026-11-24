// elimu/attendance/pages/AttendanceTakePage.jsx -- the teacher's register: pick class + date (or lesson), mark fast, save a draft, submit.
// Mobile first (big tap targets, sticky action bar). Works offline once the register has been opened (see services/offlineAttendance.js).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TallyStrip } from '../../ui/cards';
import { ClipboardCheck, Search, WifiOff, CloudUpload } from 'lucide-react';
import { useElimu } from '../../shared/hooks/ElimuContext';
import { useFoundation } from '../../shared/hooks/useFoundation';
import { accessService } from '../../shared/services/accessService';
import { timetableService } from '../../timetable/services/timetableService';
import { entriesForDate } from '../../timetable/utils/grid';
import { FitPage, DateField, SelectField, classOptions, splitClassValue, btn, btnPrimary, ConfirmSheet, Notice, NotConnected, LoadingBlock, EmptyBlock, CompletionPill, MiniStats, Pill, inputCls } from '../../shared/components/kit';
import StudentRow from '../components/StudentRow';
import AmendSheet from '../components/AmendSheet';
import GuardianMessageSheet from '../../communication/components/GuardianMessageSheet';
import { useAttendanceConfig } from '../hooks/useAttendanceConfig';
import { useOfflineSync } from '../hooks/useOfflineSync';
import { attendanceService } from '../services/attendanceService';
import { getOfflineAttendance } from '../services/offlineAttendance';
import { planBulk, applyChanges, BULK_ACTIONS } from '../utils/bulk';
import { completionState, tally } from '../utils/statuses';
import { suggestedPurposes } from '../../communication/attendance/contactPlan';
import { prettyDate } from '../../shared/utils/time';

const isNet = (e) => !!e?.network || (typeof navigator !== 'undefined' && navigator.onLine === false);
const markPayload = (r) => ({ enrollment_id: r.enrollment_id, status: r.status, arrival_time: r.arrival_time || null, departure_time: r.departure_time || null, reason_id: r.reason_id || null, reason_note: r.reason_note || null, base_updated_at: r.updated_at || null, marked_at: r.client_marked_at || new Date().toISOString() });

export default function AttendanceTakePage() {
  const { tenantId, today, can, schoolName } = useElimu();
  const f = useFoundation({ terms: true }); const cfg = useAttendanceConfig(); const sync = useOfflineSync();
  const [date, setDate] = useState(today()); const [classVal, setClassVal] = useState(''); const [kind, setKind] = useState('DAILY'); const [entryId, setEntryId] = useState('');
  const [allowed, setAllowed] = useState(null); const [lessons, setLessons] = useState([]);
  const [session, setSession] = useState(null); const [rows, setRows] = useState([]); const [loading, setLoading] = useState(false); const [err, setErr] = useState(null); const [note, setNote] = useState(null);
  const [selected, setSelected] = useState(new Set()); const [search, setSearch] = useState(''); const [filter, setFilter] = useState('ALL');
  const [confirm, setConfirm] = useState(null); const [busy, setBusy] = useState(false); const [amend, setAmend] = useState(null); const [contact, setContact] = useState(null); const [after, setAfter] = useState(null);
  const dirty = useRef(new Set()); const saveTimer = useRef(null);

  const { classId, streamId } = splitClassValue(classVal);
  const lockedDay = session && session.status !== 'DRAFT';
  const sessionKey = session ? `${date}|${classId}|${streamId || ''}|${kind}|${entryId || ''}` : null;

  // teachers only see classes they are assigned to (the database enforces it anyway)
  useEffect(() => { if (can('attendance.take_any')) { setAllowed(null); return; } accessService.listAllocations().then((a) => setAllowed(new Set(a.map((x) => x.class_id)))).catch(() => setAllowed(null)); }, [can]);
  const options = useMemo(() => classOptions(f.classStreams, allowed), [f.classStreams, allowed]);
  // lesson picker: the caller's lessons for that date
  useEffect(() => {
    if (kind !== 'LESSON' || !classId) { setLessons([]); return; }
    (async () => { const term = f.terms.find((t) => t.start_date <= date && t.end_date >= date); const e = await timetableService.entries({ termId: term?.term_id || null, classId }).catch(() => []); const ex = await timetableService.exceptions({ from: date, to: date }).catch(() => []); setLessons(entriesForDate(e, date, ex).filter((x) => !x.cancelledToday && (!streamId || !x.stream_id || x.stream_id === streamId))); })();
  }, [kind, classId, streamId, date, f.terms]);

  const load = useCallback(async (s) => {
    const recs = await attendanceService.records(s.id);
    const q = await getOfflineAttendance(); const draft = await q.loadDraft(tenantId, `${date}|${classId}|${streamId || ''}|${kind}|${entryId || ''}`);
    let merged = recs;
    if (draft?.rows && s.status === 'DRAFT') { const d = new Map(draft.rows.map((r) => [r.enrollment_id, r])); merged = recs.map((r) => (d.has(r.enrollment_id) && r.status === 'NOT_MARKED' && d.get(r.enrollment_id).status !== 'NOT_MARKED' ? { ...r, ...d.get(r.enrollment_id), dirty: true } : r)); merged.forEach((r) => r.dirty && dirty.current.add(r.enrollment_id)); }
    setRows(merged); return merged;
  }, [tenantId, date, classId, streamId, kind, entryId]);

  const openRegister = async () => {
    setLoading(true); setErr(null); setNote(null); setSession(null); setRows([]); setSelected(new Set()); dirty.current = new Set(); setAfter(null);
    const key = `${date}|${classId}|${streamId || ''}|${kind}|${entryId || ''}`; const q = await getOfflineAttendance();
    try {
      const cls = f.classStreams.find((c) => c.class_id === classId && (c.stream_id || null) === (streamId || null));
      const term = f.terms.find((t) => t.start_date <= date && t.end_date >= date);
      const r = await attendanceService.open({ date, classId, streamId, kind, entryId: kind === 'LESSON' ? entryId : null, yearId: term?.academic_year_id || cls?.academic_year_id || null, termId: term?.term_id || null, className: cls?.class_name, streamName: streamId ? cls?.stream_name : null });
      if (!r.ok) { setErr(r.message || 'Could not open the register.'); return; }
      if (!r.is_school_day && r.created) setNote('This date is a weekend or a calendar holiday. You can still take attendance if school was open.');
      if (r.late_joiners_added > 0) setNote(`${r.late_joiners_added} student(s) joined this class since the register was opened and were added.`);
      setSession(r.session); const merged = await load(r.session);
      await q.cacheSession(tenantId, key, { session: r.session, rows: merged }); // so it can be marked with no signal
    } catch (e) {
      if (isNet(e)) { const c = await q.getCachedSession(tenantId, key); if (c) { setSession(c.session); setRows(c.rows); const d = await q.loadDraft(tenantId, key); if (d) setRows(d.rows); setNote('Offline: showing the register saved on this phone. Your marks will be saved here and sent when you are back online.'); } else setErr('No connection, and this register has not been opened on this phone before. Open it once while online.'); }
      else setErr(e.message);
    } finally { setLoading(false); }
  };

  // ---- marking ----
  const flush = useCallback(async (current) => {
    if (!session || lockedDay) return;
    const ids = [...dirty.current]; if (!ids.length) return;
    const marks = current.filter((r) => ids.includes(r.enrollment_id)).map(markPayload); const q = await getOfflineAttendance();
    await q.saveDraft(tenantId, sessionKey, { sessionId: session.id, rows: current.map((r) => ({ ...r })) });
    try {
      const res = await attendanceService.saveMarks(session.id, marks);
      if (res.ok === false) { setErr(res.message); return; }
      if (res.conflicts?.length) setNote(`${res.conflicts.length} student(s) were changed by someone else and were not overwritten. Reloaded their current marks.`);
      ids.forEach((i) => dirty.current.delete(i)); const fresh = await attendanceService.records(session.id); setRows(fresh); await q.clearDraft(tenantId, sessionKey); await q.cacheSession(tenantId, sessionKey, { session, rows: fresh });
    } catch (e) {
      if (isNet(e)) { await q.enqueueMarks({ tenantId, sessionId: session.id, marks }); ids.forEach((i) => dirty.current.delete(i)); sync.refresh(); setNote('No connection: your marks are saved on this phone and will be sent automatically.'); }
      else setErr(e.message);
    }
  }, [session, lockedDay, tenantId, sessionKey, sync]);
  const scheduleSave = (next) => { clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => flush(next), 700); };
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const mark = (id, patch) => { const next = rows.map((r) => (r.enrollment_id === id ? { ...r, ...patch, client_marked_at: new Date().toISOString(), dirty: true } : r)); dirty.current.add(id); setRows(next); scheduleSave(next); };
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const runBulk = (action) => { const plan = planBulk(action, rows, selected); if (!plan.count) { setNote('Nothing to change for that action.'); return; } setConfirm({ type: 'bulk', action, plan }); };
  const applyBulk = () => { const next = applyChanges(rows, confirm.plan.changes); confirm.plan.changes.forEach((c) => dirty.current.add(c.enrollment_id)); setRows(next); setSelected(new Set()); setConfirm(null); flush(next); };

  const doSubmit = async (confirmUnmarked) => {
    setBusy(true); setErr(null);
    try {
      await flush(rows);
      const r = await attendanceService.submit(session.id, confirmUnmarked);
      if (r.ok === false) { if (r.reason === 'NEEDS_CONFIRMATION') setConfirm({ type: 'submit', message: r.message, unmarked: r.unmarked }); else setErr(r.message); return; }
      setConfirm(null); const s2 = await attendanceService.session(session.id); setSession(s2); const fresh = await attendanceService.records(session.id); setRows(fresh);
      const q = await getOfflineAttendance(); await q.clearDraft(tenantId, sessionKey); setAfter(r);
    } catch (e) {
      if (isNet(e)) { const q = await getOfflineAttendance(); await q.enqueueMarks({ tenantId, sessionId: session.id, marks: rows.filter((r) => r.status !== 'NOT_MARKED').map(markPayload) }); await q.enqueueSubmit({ tenantId, sessionId: session.id, confirmUnmarked }); sync.refresh(); setConfirm(null); setNote('No connection: the register will be submitted automatically when you are back online. It is NOT submitted yet.'); }
      else setErr(e.message);
    } finally { setBusy(false); }
  };

  const counts = useMemo(() => tally(rows, cfg.custom), [rows, cfg.custom]);
  const visible = rows.filter((r) => (filter === 'ALL' || (filter === 'UNMARKED' ? r.status === 'NOT_MARKED' : r.status === filter)) && (!search || `${r.student_name} ${r.admission_number}`.toLowerCase().includes(search.toLowerCase())));
  const state = completionState(session ? { ...session, marked_count: rows.filter((r) => r.status !== 'NOT_MARKED').length, expected_count: rows.length } : null);
  const classInfo = (() => { const c = f.classStreams.find((x) => x.class_id === classId && (x.stream_id || null) === (streamId || null)); return { class_name: c?.class_name, stream_name: streamId ? c?.stream_name : '' }; })();

  return (
    <FitPage title="Take attendance" subtitle={session ? `${prettyDate(date)} · ${classInfo.class_name || ''} ${classInfo.stream_name || ''}` : 'Pick a class and a day'} icon={ClipboardCheck}
      action={sync.pending + sync.needsAttention > 0 ? <button className={`${btn} !min-h-[36px] text-xs flex items-center gap-1`} onClick={sync.syncNow}>{sync.syncing ? <CloudUpload size={14} /> : <WifiOff size={14} />}{sync.pending} waiting{sync.needsAttention ? ` · ${sync.needsAttention} need you` : ''}</button> : null}>
      <div className="overflow-y-auto min-h-0 flex-1 pb-28">
        {!f.loading && !f.connected && <NotConnected />}
        {err && <Notice tone="bad">{err}</Notice>}{note && <Notice tone="good">{note}</Notice>}
        {!session && (
          <div className="bg-white border border-[#E3DBB8] rounded-xl p-3 mt-2">
            <DateField value={date} onChange={setDate} max={today()} />
            <SelectField label="Class and stream" value={classVal} onChange={setClassVal} options={options} />
            {cfg.settings.daily_mode !== 'DAILY' && <SelectField label="Register type" value={kind} onChange={setKind} options={[{ value: 'DAILY', label: 'Daily register' }, { value: 'LESSON', label: 'Lesson register' }]} placeholder="Daily register" />}
            {kind === 'LESSON' && <SelectField label="Lesson" value={entryId} onChange={setEntryId} options={lessons.map((l) => ({ value: l.id, label: `${String(l.start_time).slice(0, 5)}–${String(l.end_time).slice(0, 5)} ${l.entry_kind === 'ACTIVITY' ? l.activity_label : 'Lesson'}` }))} />}
            <button className={`${btnPrimary} w-full mt-1`} disabled={!classId || loading || (kind === 'LESSON' && !entryId)} onClick={openRegister}>{loading ? 'Opening…' : 'Open register'}</button>
            {loading && <LoadingBlock text="Opening register…" />}
          </div>)}

        {session && (<>
          <div className="flex items-center gap-2 my-2 flex-wrap"><CompletionPill state={state} /><button className={`${btn} !min-h-[36px] text-xs`} onClick={() => { setSession(null); setRows([]); }}>Change class</button></div>
          <TallyStrip items={[{ label: 'Present', value: counts.present, tone: 'ok' }, { label: 'Absent', value: counts.absent, tone: 'bad' }, { label: 'Late', value: counts.late, tone: 'warn' }, { label: 'Not marked', value: counts.not_marked, tone: 'quiet' }]} />
          {!lockedDay && (<div className="my-2 flex gap-1.5 overflow-x-auto pb-1">{Object.entries(BULK_ACTIONS).map(([k, a]) => <button key={k} className={`${btn} !min-h-[38px] whitespace-nowrap text-xs`} onClick={() => runBulk(k)}>{a.label}</button>)}</div>)}
          <div className="flex gap-2 mb-2"><div className="relative flex-1"><Search size={15} className="absolute left-2.5 top-3 text-[#9A987F]" /><input className={`${inputCls} pl-8`} placeholder="Find a student" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <select className={`${inputCls} !w-auto`} value={filter} onChange={(e) => setFilter(e.target.value)}><option value="ALL">All</option><option value="UNMARKED">Not marked</option><option value="ABSENT">Absent</option><option value="LATE">Late</option></select></div>
          {lockedDay && <Notice tone="good">This register was {session.status === 'AMENDED' ? 'submitted and later corrected' : 'submitted'}. {can('attendance.amend') ? 'Tap Correct beside a student to change it.' : 'Only an authorised person can change it.'}</Notice>}
          {visible.length === 0 && <EmptyBlock>No students match.</EmptyBlock>}
          {visible.map((r) => (<div key={r.enrollment_id}><StudentRow row={r} selected={selected.has(r.enrollment_id)} onSelect={toggle} onMark={mark} statuses={cfg.statuses} reasons={cfg.reasons} locked={lockedDay} />
            {lockedDay && can('attendance.amend') && <div className="-mt-1 mb-2 text-right"><button className="text-xs font-semibold text-[#1F6B45] underline" onClick={() => setAmend(r)}>Correct</button></div>}</div>))}
          {after && <AfterSubmit result={after} rows={rows} settings={cfg.settings} onContact={(rec, purpose) => setContact({ rec, purpose })} />}
        </>)}
      </div>

      {session && !lockedDay && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-[#E3DBB8] p-3 flex gap-2 items-center max-w-7xl mx-auto">
          <div className="text-xs text-[#6F7461] flex-1">{rows.filter((r) => r.status !== 'NOT_MARKED').length} of {rows.length} marked{dirty.current.size ? ' · saving…' : ' · draft saved'}</div>
          <button className={btnPrimary} disabled={busy || !rows.length} onClick={() => doSubmit(false)}>Submit attendance</button>
        </div>)}

      {confirm?.type === 'bulk' && <ConfirmSheet title={confirm.plan.label} confirmLabel={`Apply to ${confirm.plan.count}`} onConfirm={applyBulk} onCancel={() => setConfirm(null)}>
        <p>This will mark <b>{confirm.plan.count}</b> student(s) as <b>{confirm.plan.status.replace('_', ' ').toLowerCase()}</b>.</p>
        {confirm.plan.overwrites > 0 && <p className="text-[#A3352A]">{confirm.plan.overwrites} of them already have a different mark that will be replaced.</p>}</ConfirmSheet>}
      {confirm?.type === 'submit' && <ConfirmSheet title="Some students are not marked" confirmLabel="Submit anyway" busy={busy} onConfirm={() => doSubmit(true)} onCancel={() => setConfirm(null)}>
        <p>{confirm.message}</p><p>You can go back and mark them first.</p></ConfirmSheet>}
      {amend && <AmendSheet record={amend} statuses={cfg.statuses} reasons={cfg.reasons} requireReason={cfg.settings.amendment_requires_reason} onClose={() => setAmend(null)}
        onDone={async (r) => { setAmend(null); const s2 = await attendanceService.session(session.id); setSession(s2); setRows(await attendanceService.records(session.id)); if (r.correction_notice_suggested) setContact({ rec: r.record, purpose: 'CORRECTION' }); }} />}
      {contact && <GuardianMessageSheet record={contact.rec} purpose={contact.purpose} settings={cfg.settings} classInfo={classInfo} onClose={() => setContact(null)} />}
    </FitPage>
  );
}

function AfterSubmit({ result, rows, settings, onContact }) {
  const ids = new Set([...(result.notify_candidates?.absent || []), ...(result.notify_candidates?.late || []), ...(result.notify_candidates?.left_early || [])]);
  const list = rows.filter((r) => ids.has(r.id)).map((r) => ({ r, purposes: suggestedPurposes(r, settings) })).filter((x) => x.purposes.length);
  return (
    <div className="bg-[#E3F1E7] border border-[#B9D8C4] rounded-xl p-3 mt-3">
      <p className="font-semibold text-[#1B5138] text-sm">Attendance submitted.</p>
      {result.unmarked > 0 && <p className="text-xs text-[#1B5138]">{result.unmarked} student(s) stay "Not marked" — they were not recorded as absent.</p>}
      {list.length > 0 && <><p className="text-xs mt-2 mb-1 font-semibold">Tell guardians (you review each message before it is sent):</p>
        {list.map(({ r, purposes }) => <div key={r.id} className="flex items-center justify-between py-1 text-sm"><span>{r.student_name} <Pill tone="neutral">{purposes[0].toLowerCase().replace('_', ' ')}</Pill></span><button className={`${btn} !min-h-[34px] text-xs`} onClick={() => onContact(r, purposes[0])}>Contact</button></div>)}</>}
    </div>
  );
}
