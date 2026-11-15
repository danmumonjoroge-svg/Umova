import React, { useEffect, useState } from 'react';
import { Sheet, Field, fieldClass, inputCls, btn, btnPrimary, Notice, StatusPill } from '../../shared/components/kit';
import { attendanceService } from '../services/attendanceService';

/** Correct a SUBMITTED record. A reason is required (school setting); previous value is kept in the amendment history and the audit log. */
export default function AmendSheet({ record, statuses, reasons, requireReason = true, onClose, onDone }) {
  const [status, setStatus] = useState(record.status); const [arrival, setArrival] = useState(record.arrival_time ? String(record.arrival_time).slice(0, 5) : '');
  const [departure, setDeparture] = useState(record.departure_time ? String(record.departure_time).slice(0, 5) : ''); const [reasonId, setReasonId] = useState(record.reason_id || '');
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null); const [history, setHistory] = useState([]);
  useEffect(() => { attendanceService.amendments(record.id).then(setHistory).catch(() => {}); }, [record.id]);
  const save = async () => {
    setBusy(true); setErr(null);
    try { const r = await attendanceService.amend(record.id, { status, arrival_time: arrival || null, departure_time: departure || null, reason_id: reasonId || null }, reason); onDone(r); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title={`Correct attendance · ${record.student_name}`} onClose={onClose}>
      <p className="text-sm mb-2">Now recorded as <StatusPill status={record.status} />. The earlier value is kept in the history.</p>
      {err && <Notice tone="bad">{err}</Notice>}
      <Field label="Correct status"><select className={fieldClass} value={status} onChange={(e) => setStatus(e.target.value)}>{statuses.filter((s) => s.code !== 'NOT_MARKED').map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}</select></Field>
      <div className="grid grid-cols-2 gap-2"><Field label="Arrived"><input type="time" className={inputCls} value={arrival} onChange={(e) => setArrival(e.target.value)} /></Field><Field label="Left"><input type="time" className={inputCls} value={departure} onChange={(e) => setDeparture(e.target.value)} /></Field></div>
      <Field label="Reason (if known)"><select className={fieldClass} value={reasonId} onChange={(e) => setReasonId(e.target.value)}><option value="">Not given</option>{reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></Field>
      <Field label={requireReason ? 'Why is this being corrected? (required)' : 'Why is this being corrected?'}><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Parent brought a clinic slip" /></Field>
      <button className={`${btnPrimary} w-full`} disabled={busy || (requireReason && !reason.trim())} onClick={save}>{busy ? 'Saving…' : 'Save correction'}</button>
      {history.length > 0 && (<div className="mt-4"><h4 className="text-[11.5px] font-bold uppercase text-[#6F7461] mb-1">Earlier corrections</h4>
        {history.map((h) => <div key={h.id} className="text-[12.5px] border-t border-[#EFE9CD] py-1">{new Date(h.amended_at).toLocaleString('en-GB')}: {h.previous_value?.status || h.previous_value?.approval} → {h.new_value?.status || h.new_value?.approval} — {h.reason}</div>)}</div>)}
      <button className={`${btn} w-full mt-3`} onClick={onClose}>Close</button>
    </Sheet>
  );
}
