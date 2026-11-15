// elimu/calendar/pages/CalendarPage.jsx -- school holidays, closings, events. Events marked "no attendance" make that day a non-school day.
import React, { useCallback, useEffect, useState } from 'react';
import { useElimu } from '../../shared/hooks/ElimuContext';
import { FitPage, Field, SelectField, LoadingBlock, EmptyBlock, Pill, Sheet, fieldClass, btnPrimary, btn, ErrorLine, ConfirmSheet } from '../../shared/components/kit';
import { calendarService, EVENT_TYPES, NO_SCHOOL_TYPES } from '../services/calendarService';
import { prettyDate, addDays } from '../../shared/utils/time';

export default function CalendarPage() {
  const { today, can, tenantId, businessId, userId } = useElimu(); const manage = can('calendar.manage');
  const [from, setFrom] = useState(`${today().slice(0, 7)}-01`); const [rows, setRows] = useState([]); const [loading, setLoading] = useState(true); const [err, setErr] = useState(null); const [edit, setEdit] = useState(null); const [del, setDel] = useState(null);
  const to = addDays(from, 90);
  const load = useCallback(async () => { setLoading(true); setErr(null); try { setRows(await calendarService.range(from, to)); } catch (e) { setErr(e.message); } finally { setLoading(false); } }, [from, to]);
  useEffect(() => { load(); }, [load]);
  return (
    <FitPage title="School calendar" subtitle="Next three months from the date below">
      <Field label="Start from"><input type="date" className={fieldClass} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <ErrorLine error={err} />
      {manage && <button className={`${btnPrimary} w-full mb-3`} onClick={() => setEdit({ event_type: 'HOLIDAY', start_date: today(), end_date: today(), title: '' })}>Add event</button>}
      {loading ? <LoadingBlock /> : rows.length === 0 ? <EmptyBlock><b>Nothing scheduled.</b> No holidays or events in this period.</EmptyBlock> : (
        <ul className="space-y-1.5">{rows.map((e) => (
          <li key={e.id} className="rounded-xl border border-[#E3DBB8] bg-white px-3 py-2.5 flex justify-between gap-2">
            <button className="text-left" disabled={!manage} onClick={() => setEdit(e)}><div className="text-sm font-semibold text-[#23382B]">{e.title}</div><div className="text-xs text-[#6F7461]">{prettyDate(e.start_date)}{e.end_date !== e.start_date ? ` to ${prettyDate(e.end_date)}` : ''}</div></button>
            <Pill tone={e.affects_attendance ? 'warn' : 'neutral'}>{e.affects_attendance ? 'no attendance' : (EVENT_TYPES.find((t) => t[0] === e.event_type)?.[1] || e.event_type)}</Pill>
          </li>))}</ul>)}
      {edit && <EventSheet ev={edit} ids={{ tenant_id: tenantId, business_id: businessId, created_by: userId ?? null }} onCancelEvent={() => { setDel(edit); }} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {del && <ConfirmSheet title="Cancel this event?" danger confirmLabel="Cancel event" onCancel={() => setDel(null)} onConfirm={async () => { try { await calendarService.cancel(del.id); setDel(null); setEdit(null); load(); } catch (e) { setErr(e.message); setDel(null); } }}><p>Days it covered become normal school days again.</p></ConfirmSheet>}
    </FitPage>
  );
}

function EventSheet({ ev, ids, onClose, onSaved, onCancelEvent }) {
  const [v, setV] = useState({ ...ev, affects_attendance: ev.id ? ev.affects_attendance : NO_SCHOOL_TYPES.includes(ev.event_type) }); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr(null);
    try { const { id, created_at, updated_at, ...r0 } = v; const rest = { ...r0, expected_amount: r0.expected_amount === '' || r0.expected_amount == null ? null : Number(r0.expected_amount), expected_note: (r0.expected_note || '').trim() || null }; await calendarService.save(ev.id ? { id: ev.id, ...rest } : { ...ids, ...rest }); onSaved(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title={ev.id ? 'Edit event' : 'New event'} onClose={onClose}>
      <Field label="Title"><input className={fieldClass} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
      <SelectField label="Type" value={v.event_type} onChange={(t) => setV({ ...v, event_type: t || 'OTHER', affects_attendance: NO_SCHOOL_TYPES.includes(t) })} options={EVENT_TYPES.map(([value, label]) => ({ value, label }))} placeholder="Type" />
      <div className="grid grid-cols-2 gap-x-3"><Field label="From"><input type="date" className={fieldClass} value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value, end_date: v.end_date < e.target.value ? e.target.value : v.end_date })} /></Field><Field label="To"><input type="date" className={fieldClass} min={v.start_date} value={v.end_date} onChange={(e) => setV({ ...v, end_date: e.target.value })} /></Field></div>
      <label className="flex items-center gap-2 text-sm mb-2"><input type="checkbox" checked={!!v.affects_attendance} onChange={(e) => setV({ ...v, affects_attendance: e.target.checked })} /> No attendance is taken on these days</label>
      <div className="grid grid-cols-2 gap-x-3"><Field label="Money expected (KES)" hint="Shown to parents"><input type="number" inputMode="decimal" min="0" className={fieldClass} value={v.expected_amount ?? ''} onChange={(e) => setV({ ...v, expected_amount: e.target.value })} /></Field>
        <Field label="Note to parents"><input className={fieldClass} value={v.expected_note || ''} onChange={(e) => setV({ ...v, expected_note: e.target.value })} placeholder="e.g. bring lunch" /></Field></div>
      <ErrorLine error={err} />
      <div className="flex gap-2"><button className={`${btnPrimary} flex-1`} disabled={busy || !v.title?.trim() || !v.start_date || !v.end_date} onClick={save}>Save</button>{ev.id && <button className={btn} onClick={onCancelEvent}>Cancel event</button>}</div>
    </Sheet>
  );
}
