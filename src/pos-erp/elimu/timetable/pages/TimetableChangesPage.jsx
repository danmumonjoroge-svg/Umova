// elimu/timetable/pages/TimetableChangesPage.jsx -- change history, one-day changes (cancel / swap teacher or room), and notice preparation.
// A notice is only PREPARED (status QUEUED in the communication log) until staff actually send it; the same change is never recorded twice for one recipient.
import React, { useCallback, useEffect, useState } from 'react';
import { useElimu } from '../../shared/hooks/ElimuContext';
import { useFoundation } from '../../shared/hooks/useFoundation';
import { FitPage, LoadingBlock, EmptyBlock, Pill, Sheet, Field, SelectField, DateField, fieldClass, btn, btnPrimary, ErrorLine, Notice } from '../../shared/components/kit';
import { timetableService } from '../services/timetableService';
import { audienceFor, buildNotice, recordNotice } from '../../communication/timetable/changeNotices';
import { TIMETABLE_CHANGE_LABELS } from '../../communication/templates/timetableTemplates';
import { prettyDate, hhmm, DAY_NAMES } from '../../shared/utils/time';

export default function TimetableChangesPage() {
  const { can, tenantId, businessId, userId, schoolName, today } = useElimu(); const f = useFoundation({ subjects: true, teachers: true });
  const [rows, setRows] = useState([]); const [rooms, setRooms] = useState([]); const [entries, setEntries] = useState([]); const [loading, setLoading] = useState(true); const [err, setErr] = useState(null);
  const [notice, setNotice] = useState(null); const [oneDay, setOneDay] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { const [h, r, e] = await Promise.all([timetableService.history({}), timetableService.rooms(), timetableService.entries({})]); setRows(h); setRooms(r); setEntries(e); } catch (x) { setErr(x.message); } finally { setLoading(false); } }, []);
  useEffect(() => { load(); }, [load]);
  const names = { ...f.names, room: (id) => rooms.find((r) => r.id === id)?.name || '' };
  return (
    <FitPage title="Timetable changes" subtitle="Every change is recorded with who made it and why">
      <ErrorLine error={err} />
      {can('timetable.manage') && <button className={`${btnPrimary} w-full mb-3`} onClick={() => setOneDay(true)}>Change a lesson for one day</button>}
      {loading ? <LoadingBlock /> : rows.length === 0 ? <EmptyBlock><b>No changes yet.</b> Changes will be listed here.</EmptyBlock> : (
        <ul className="space-y-1.5">{rows.map((c) => (
          <li key={c.id} className="rounded-xl border border-[#E3DBB8] bg-white px-3 py-2.5">
            <div className="flex justify-between gap-2"><span className="text-sm font-semibold text-[#23382B]">{TIMETABLE_CHANGE_LABELS[c.change_type] || c.change_type}</span><Pill tone={c.override_conflicts ? 'warn' : 'neutral'}>{c.override_conflicts ? 'saved over a clash' : prettyDate(String(c.changed_at).slice(0, 10))}</Pill></div>
            <div className="text-xs text-[#6F7461]">{f.classLabel(c.class_id, c.stream_id)}{c.effective_date ? ` · ${prettyDate(c.effective_date)}` : ' · every week'}{c.reason ? ` · ${c.reason}` : ''}</div>
            {can('comms.send') && <button className="text-xs font-semibold text-[#1F6B45] mt-1 min-h-[36px]" onClick={() => setNotice(c)}>Prepare notice</button>}
          </li>))}</ul>)}
      {notice && <NoticeSheet change={notice} names={names} ctx={{ tenantId, businessId, userId, schoolName }} onClose={() => setNotice(null)} />}
      {oneDay && <OneDaySheet entries={entries} f={f} rooms={rooms} today={today()} canOverride={can('timetable.override')} onClose={() => setOneDay(false)} onSaved={() => { setOneDay(false); load(); }} />}
    </FitPage>
  );
}

function NoticeSheet({ change, names, ctx, onClose }) {
  const plan = audienceFor(change).filter((a) => a.audience !== 'GUARDIAN'); // guardians: use the class notice wording and the guardian message sheet
  const [pick, setPick] = useState(plan[0]); const [to, setTo] = useState(''); const [channel, setChannel] = useState('SMS');
  const [name, setName] = useState(''); const [body, setBody] = useState(''); const [msg, setMsg] = useState(null); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (pick) setBody(buildNotice(change, names, name || 'Teacher', ctx.schoolName).body); }, [pick, name]); // eslint-disable-line
  const prepare = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await recordNotice({ ...ctx, change, audience: pick.audience, recipientRef: pick.ref, recipientName: name, channel, to, body });
      setMsg(r.duplicate ? 'A notice for this change was already prepared for this recipient. Nothing new was created.' : 'Prepared. It is waiting in the communication log until you send it — it has not been sent.');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Prepare notice" onClose={onClose}>
      <SelectField label="Who" value={pick?.ref} onChange={(v) => setPick(plan.find((p) => p.ref === v))} options={plan.map((p) => ({ value: p.ref, label: p.label }))} placeholder="Choose" />
      <Field label="Recipient name"><input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-x-3"><Field label="Phone / email"><input className={fieldClass} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <SelectField label="Channel" value={channel} onChange={(v) => setChannel(v || 'SMS')} options={['SMS', 'WHATSAPP', 'EMAIL'].map((c) => ({ value: c, label: c }))} placeholder="SMS" /></div>
      <Field label="Message (you can edit it)"><textarea rows={4} className={fieldClass} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <ErrorLine error={err} />{msg && <Notice tone="good">{msg}</Notice>}
      <button className={`${btnPrimary} w-full`} disabled={busy || !pick || !to || !name || !body.trim()} onClick={prepare}>{busy ? 'Preparing…' : 'Prepare message'}</button>
    </Sheet>
  );
}

function OneDaySheet({ entries, f, rooms, today, canOverride, onClose, onSaved }) {
  const [date, setDate] = useState(today); const [entryId, setEntryId] = useState(''); const [kind, setKind] = useState('TEACHER_CHANGED'); const [teacher, setTeacher] = useState(''); const [room, setRoom] = useState('');
  const [reason, setReason] = useState(''); const [ov, setOv] = useState(''); const [conf, setConf] = useState(null); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
  const todays = entries.filter((e) => e.day_of_week === dow);
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await timetableService.changeForDate({ entryId, date, kind, teacherId: teacher || null, roomId: room || null, reason: reason.trim(), overrideReason: conf && canOverride ? ov.trim() : null });
      if (r.ok === false) { setConf(r.conflicts || []); if (!r.conflicts?.length) setErr(r.message || 'Could not save'); return; }
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Change for one day" onClose={onClose}>
      <DateField value={date} onChange={(v) => { setDate(v); setEntryId(''); }} />
      <SelectField label="Lesson" value={entryId} onChange={(v) => setEntryId(v || '')} options={todays.map((e) => ({ value: e.id, label: `${hhmm(e.start_time)} ${e.entry_kind === 'ACTIVITY' ? e.activity_label : f.names.subject(e.subject_id)} · ${f.classLabel(e.class_id, e.stream_id)}` }))} placeholder={todays.length ? 'Choose a lesson' : `No lessons on ${DAY_NAMES[dow]}`} />
      <SelectField label="What changes" value={kind} onChange={(v) => setKind(v || 'TEACHER_CHANGED')} options={[{ value: 'TEACHER_CHANGED', label: 'Different teacher' }, { value: 'ROOM_CHANGED', label: 'Different room' }, { value: 'CANCELLED', label: 'Lesson cancelled' }]} placeholder="Choose" />
      {kind === 'TEACHER_CHANGED' && <SelectField label="Teacher" value={teacher} onChange={(v) => setTeacher(v || '')} options={f.teachers.map((t) => ({ value: t.teacher_id, label: t.teacher_name }))} />}
      {kind === 'ROOM_CHANGED' && <SelectField label="Room" value={room} onChange={(v) => setRoom(v || '')} options={rooms.filter((r) => r.is_active).map((r) => ({ value: r.id, label: r.name }))} />}
      <Field label="Reason (required)"><input className={fieldClass} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {conf?.length > 0 && <>{conf.map((c, i) => <Notice key={i} tone="bad">{c.message}</Notice>)}{canOverride ? <Field label="Save anyway — reason"><input className={fieldClass} value={ov} onChange={(e) => setOv(e.target.value)} /></Field> : <p className="text-xs text-[#B23A2E]">You cannot save over a clash.</p>}</>}
      <ErrorLine error={err} />
      <button className={`${btnPrimary} w-full`} disabled={busy || !entryId || reason.trim().length < 3 || (kind === 'TEACHER_CHANGED' && !teacher) || (kind === 'ROOM_CHANGED' && !room) || (conf?.length && ov.trim().length < 5)} onClick={go}>{busy ? 'Saving…' : 'Save change'}</button>
    </Sheet>
  );
}
