// elimu/timetable/components/EntryEditor.jsx -- add / edit one lesson. Clashes are previewed live (browser rules) and re-checked by the database on save.
// Saving over a clash needs the timetable.override permission AND a written reason; nothing is overwritten silently.
import React, { useEffect, useMemo, useState } from 'react';
import { Sheet, Field, SelectField, TimeField, fieldClass, btn, btnPrimary, btnDanger, ErrorLine, ConfirmSheet } from '../../shared/components/kit';
import ConflictList from './ConflictList';
import { findConflicts, hasBlocking, hasUnoverridable } from '../utils/conflicts';
import { timetableService } from '../services/timetableService';
import { DAY_NAMES } from '../../shared/utils/time';

export default function EntryEditor({ entry, seed, ctx, options, canOverride, onClose, onSaved }) {
  const [d, setD] = useState({ entry_kind: 'LESSON', day_of_week: 1, ...(seed || {}), ...(entry || {}) });
  const [serverConf, setServerConf] = useState(null); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null); const [cancelling, setCancelling] = useState(false); const [cancelReason, setCancelReason] = useState('');
  const set = (k) => (v) => { setServerConf(null); setD((x) => ({ ...x, [k]: v })); };
  const local = useMemo(() => (d.class_id && d.start_time && d.end_time ? findConflicts(d, ctx) : []), [d, ctx]);
  const shown = serverConf || local; const blocking = hasBlocking(shown); const hard = hasUnoverridable(shown);
  useEffect(() => { setReason(''); }, [blocking]);
  const valid = d.class_id && d.start_time && d.end_time && (d.entry_kind === 'ACTIVITY' ? d.activity_label : d.subject_id);
  const save = async (override) => {
    setBusy(true); setErr(null);
    try {
      const payload = { ...d, expected_version: entry?.version ?? null };
      const r = await timetableService.save(payload, override ? reason.trim() : null);
      if (r.stale) { setErr(r.message); return; }
      if (r.ok === false) { setServerConf(r.conflicts || []); if (!r.conflicts?.length) setErr(r.message || 'Could not save'); return; }
      onSaved(r);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const cancel = async () => {
    setBusy(true); setErr(null);
    try { const r = await timetableService.cancel(entry.id, { reason: cancelReason.trim(), expectedVersion: entry.version }); if (r.ok === false) { setErr(r.message); setCancelling(false); return; } onSaved(r); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title={entry ? 'Edit lesson' : 'New lesson'} onClose={onClose}>
      <SelectField label="Type" value={d.entry_kind} onChange={(v) => set('entry_kind')(v || 'LESSON')} options={[{ value: 'LESSON', label: 'Lesson' }, { value: 'ACTIVITY', label: 'Activity (games, assembly…)' }]} placeholder="Lesson" />
      <SelectField label="Class" value={d.class_id ? `${d.class_id}|${d.stream_id || ''}` : ''} onChange={(v) => { const [c, s] = String(v || '|').split('|'); setServerConf(null); setD((x) => ({ ...x, class_id: c || null, stream_id: s || null })); }} options={options.classes} />
      {d.entry_kind === 'ACTIVITY' ? <Field label="Activity"><input className={fieldClass} value={d.activity_label || ''} onChange={(e) => set('activity_label')(e.target.value)} /></Field>
        : <SelectField label="Subject" value={d.subject_id} onChange={set('subject_id')} options={options.subjects} />}
      <SelectField label="Teacher" value={d.teacher_id} onChange={set('teacher_id')} options={options.teachers} placeholder="Not assigned" />
      <SelectField label="Room" value={d.room_id} onChange={set('room_id')} options={options.rooms} placeholder="No room" />
      <SelectField label="Day" value={String(d.day_of_week)} onChange={(v) => set('day_of_week')(Number(v || 1))} options={[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: DAY_NAMES[n] }))} placeholder="Day" />
      <div className="grid grid-cols-2 gap-x-3"><TimeField label="Starts" value={d.start_time} onChange={set('start_time')} /><TimeField label="Ends" value={d.end_time} onChange={set('end_time')} /></div>
      <details className="mb-2"><summary className="text-xs text-[#6F7461]">Only for certain dates (optional)</summary>
        <div className="grid grid-cols-2 gap-x-3 mt-1"><Field label="From"><input type="date" className={fieldClass} value={d.valid_from || ''} onChange={(e) => set('valid_from')(e.target.value || null)} /></Field><Field label="To"><input type="date" className={fieldClass} value={d.valid_to || ''} onChange={(e) => set('valid_to')(e.target.value || null)} /></Field></div></details>
      <ConflictList conflicts={shown} />
      {blocking && !hard && (canOverride
        ? <Field label="Save anyway — reason (recorded)"><input className={fieldClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="At least 5 characters" /></Field>
        : <p className="text-xs text-[#B23A2E] mb-2">You do not have permission to save over a clash. Change the time, teacher or room.</p>)}
      <ErrorLine error={err} />
      <div className="flex gap-2">
        {blocking && !hard && canOverride
          ? <button className={`${btnDanger} flex-1`} disabled={busy || !valid || reason.trim().length < 5} onClick={() => save(true)}>Save over clash</button>
          : <button className={`${btnPrimary} flex-1`} disabled={busy || !valid || blocking} onClick={() => save(false)}>{busy ? 'Saving…' : 'Save lesson'}</button>}
        {entry && entry.status !== 'CANCELLED' && <button className={btn} disabled={busy} onClick={() => setCancelling(true)}>Remove</button>}
      </div>
      {cancelling && <ConfirmSheet title="Remove this lesson?" danger confirmLabel="Remove" busy={busy} onCancel={() => setCancelling(false)} onConfirm={cancel}>
        <p>This takes the lesson off the weekly timetable. The change is kept in the history.</p>
        <input className={fieldClass} placeholder="Reason (required)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
        {cancelReason.trim().length < 3 && <p className="text-xs text-[#8A8F78]">Type a reason to continue.</p>}</ConfirmSheet>}
    </Sheet>
  );
}
