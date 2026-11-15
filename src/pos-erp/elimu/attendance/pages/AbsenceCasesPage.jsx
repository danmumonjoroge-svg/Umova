// elimu/attendance/pages/AbsenceCasesPage.jsx -- absence follow-up: explanation received, guardian contacted, excuse decision, close.
import React, { useCallback, useEffect, useState } from 'react';
import { useElimu } from '../../shared/hooks/ElimuContext';
import { useFoundation } from '../../shared/hooks/useFoundation';
import { useAttendanceConfig } from '../hooks/useAttendanceConfig';
import { FitPage, SelectField, Field, LoadingBlock, EmptyBlock, Pill, Sheet, fieldClass, btn, btnPrimary, ErrorLine, ConfirmSheet } from '../../shared/components/kit';
import { absenceService } from '../services/absenceService';
import { prettyDate } from '../../shared/utils/time';

const STATUS = [['', 'Open and in progress'], ['OPEN', 'Open'], ['IN_PROGRESS', 'In progress'], ['RESOLVED', 'Resolved'], ['CLOSED', 'Closed']];
const CHANNELS = ['CALL', 'SMS', 'WHATSAPP', 'EMAIL', 'IN_PERSON', 'OTHER'];

export default function AbsenceCasesPage() {
  const { can } = useElimu(); const f = useFoundation(); const cfg = useAttendanceConfig();
  const [status, setStatus] = useState(''); const [rows, setRows] = useState([]); const [loading, setLoading] = useState(true); const [err, setErr] = useState(null); const [open, setOpen] = useState(null);
  const load = useCallback(async () => { setLoading(true); setErr(null); try { setRows(await absenceService.list({ status: status || null })); } catch (e) { setErr(e.message); } finally { setLoading(false); } }, [status]);
  useEffect(() => { load(); }, [load]);
  return (
    <FitPage title="Absence follow-up" subtitle="Cases created when a student is submitted as absent or sick">
      <SelectField label="Show" value={status} onChange={(v) => setStatus(v || '')} options={STATUS.slice(1).map(([value, label]) => ({ value, label }))} placeholder="Open and in progress" />
      <ErrorLine error={err} />
      {loading ? <LoadingBlock /> : rows.length === 0 ? <EmptyBlock><b>No cases.</b> Nothing needs follow-up right now.</EmptyBlock> : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.id}><button className="w-full text-left rounded-xl border border-[#E3DBB8] bg-white px-3 py-2.5" onClick={() => setOpen(r)}>
              <div className="flex justify-between gap-2"><span className="text-sm font-semibold text-[#23382B]">{prettyDate(r.absence_date)}</span><Pill tone={r.status === 'OPEN' ? 'warn' : r.status === 'IN_PROGRESS' ? 'info' : 'good'}>{r.status.replace('_', ' ').toLowerCase()}</Pill></div>
              <div className="text-xs text-[#6F7461]">{f.classLabel(r.class_id, r.stream_id)} · {r.guardian_contacted ? 'guardian contacted' : 'guardian not yet contacted'} · {r.explanation_received ? 'explanation received' : 'no explanation yet'}{r.excuse_status === 'PENDING' ? ' · excuse awaiting decision' : ''}</div>
            </button></li>))}
        </ul>)}
      {open && <CaseSheet row={open} reasons={cfg.reasons} canDecide={can('absence.approve')} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); }} />}
    </FitPage>
  );
}

function CaseSheet({ row, reasons, canDecide, onClose, onSaved }) {
  const [v, setV] = useState({ reason_id: row.reason_id || '', explanation_received: row.explanation_received, explanation_note: row.explanation_note || '', guardian_contacted: row.guardian_contacted, contact_channel: row.contact_channel || '', notes: row.notes || '', follow_up_due: row.follow_up_due || '' });
  const [excuse, setExcuse] = useState(''); const [excuseNote, setExcuseNote] = useState(''); const [closing, setClosing] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async (extra = {}) => {
    setBusy(true); setErr(null);
    try {
      const changes = { ...v, reason_id: v.reason_id || null, contact_channel: v.contact_channel || null, follow_up_due: v.follow_up_due || null, ...extra };
      const r = await absenceService.update(row.id, changes);
      if (r && r.ok === false) throw new Error(r.message || 'Could not save');
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Absence case" onClose={onClose}>
      <Field label="Reason given"><select className={fieldClass} value={v.reason_id} onChange={set('reason_id')}><option value="">Not stated</option>{reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></Field>
      <label className="flex items-center gap-2 text-sm mb-2"><input type="checkbox" checked={v.explanation_received} onChange={set('explanation_received')} /> Explanation received</label>
      {v.explanation_received && <Field label="What was said"><textarea className={fieldClass} rows={2} value={v.explanation_note} onChange={set('explanation_note')} /></Field>}
      <label className="flex items-center gap-2 text-sm mb-2"><input type="checkbox" checked={v.guardian_contacted} onChange={set('guardian_contacted')} /> Guardian contacted (a prepared message does not count until you confirm it was sent or the call was made)</label>
      {v.guardian_contacted && <Field label="How"><select className={fieldClass} value={v.contact_channel} onChange={set('contact_channel')}><option value="">Choose</option>{CHANNELS.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}</select></Field>}
      <Field label="Follow up by"><input type="date" className={fieldClass} value={v.follow_up_due} onChange={set('follow_up_due')} /></Field>
      <Field label="Notes"><textarea className={fieldClass} rows={2} value={v.notes} onChange={set('notes')} /></Field>
      {canDecide && row.status !== 'CLOSED' && (
        <div className="rounded-xl border border-[#E3DBB8] p-2.5 mb-2"><div className="text-xs font-bold uppercase text-[#6F7461] mb-1">Excuse decision{row.excuse_status !== 'NONE' ? ` (now: ${row.excuse_status.toLowerCase()})` : ''}</div>
          <select className={fieldClass} value={excuse} onChange={(e) => setExcuse(e.target.value)}><option value="">No change</option><option value="APPROVED">Approve as excused</option><option value="REJECTED">Do not excuse</option></select>
          {excuse && <input className={`${fieldClass} mt-1.5`} placeholder="Note (required)" value={excuseNote} onChange={(e) => setExcuseNote(e.target.value)} />}
        </div>)}
      <ErrorLine error={err} />
      <div className="flex gap-2 mt-2">
        <button className={`${btnPrimary} flex-1`} disabled={busy || (excuse && excuseNote.trim().length < 3)} onClick={() => save(excuse ? { excuse_decision: excuse, excuse_note: excuseNote.trim() } : {})}>Save</button>
        {row.status !== 'CLOSED' && <button className={btn} disabled={busy} onClick={() => setClosing(true)}>Close case</button>}
      </div>
      {closing && <ConfirmSheet title="Close this case?" confirmLabel="Close case" busy={busy} onCancel={() => setClosing(false)} onConfirm={() => save({ close: true, closed_reason: 'RESOLVED' })}>
        <p>Closing marks follow-up as done. The attendance record itself is not changed.</p></ConfirmSheet>}
    </Sheet>
  );
}
