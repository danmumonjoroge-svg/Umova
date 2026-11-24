import React, { useState } from 'react';
import { FitPage, DataCard, CardGrid, LoadingBlock, EmptyBlock, Notice, Sheet, fieldClass, saveBtnCls } from '../services/platform.js';
import { setupService } from '../services/ElimuSetupService.js';
import { enrollmentService } from '../services/ElimuEnrollmentService.js';
import { useAsync } from '../hooks/useAsync.js';
import { useElimuAccess, useElimuSetup } from '../hooks/useElimu.js';
import { Field } from '../components/ui.jsx';
import { ClassPlate } from '../ui/cards/index.js';
import { fullName } from '../utils/format.js';
import { friendlyError } from '../utils/validation.js';

export default function ClassesPage({ basePath = '/elimu' }) {
  const { can } = useElimuAccess(); const { period } = useElimuSetup();
  const classes = useAsync(() => setupService.classes(), []); const [edit, setEdit] = useState(null); const [roster, setRoster] = useState(null);
  return (
    <FitPage title="Classes" subtitle={period ? `${period.academic_year_name}${period.term_name ? ` · ${period.term_name}` : ''}` : 'No current year'} action={can('structure.manage') && <button type="button" className="px-3 min-h-[40px] rounded-lg bg-[#1F6B45] text-white text-sm font-semibold" onClick={() => setEdit({})}>Add class</button>}>
      {classes.error && <Notice tone="bad">{classes.error}</Notice>}
      {classes.loading && !classes.data ? <LoadingBlock /> : (classes.data || []).length === 0 ? <EmptyBlock>No classes yet. {can('structure.manage') && 'Add Grade 1, Form 1… with the button above.'}</EmptyBlock> :
        <div className="grid grid-cols-2 gap-3">{classes.data.map((c) => { const st = (c.elimu_streams || []).filter((x) => x.is_active).map((x) => x.name);
          return <ClassPlate key={c.id} name={c.name} streams={st} off={!c.is_active} wide={st.length >= 4}
            footer={<><button type="button" disabled={!period} onClick={() => setRoster(c)}>Class list</button>{can('structure.manage') && <button type="button" onClick={() => setEdit(c)}>Edit</button>}</>} />; })}</div>}
      {edit && <ClassSheet row={edit} onClose={() => setEdit(null)} onSaved={() => classes.reload()} />}
      {roster && period && <RosterSheet klass={roster} period={period} onClose={() => setRoster(null)} basePath={basePath} />}
    </FitPage>
  );
}

function ClassSheet({ row, onClose, onSaved }) {
  const [f, setF] = useState({ name: row.name || '', code: row.code || '', level_order: row.level_order ?? '', is_active: row.is_active ?? true }); const [stream, setStream] = useState(''); const [err, setErr] = useState(null);
  const save = async () => { try { await setupService.saveClass({ ...(row.id ? { id: row.id } : {}), name: f.name.trim(), code: (f.code || f.name).trim().toUpperCase().replace(/\s+/g, '-'), level_order: Number(f.level_order) || 0, is_active: f.is_active }); onSaved(); onClose(); } catch (e) { setErr(friendlyError(e)); } };
  const addStream = async () => { try { await setupService.saveStream({ class_id: row.id, name: stream.trim() }); setStream(''); onSaved(); onClose(); } catch (e) { setErr(friendlyError(e)); } };
  return (
    <Sheet title={row.id ? 'Edit class' : 'New class'} onClose={onClose}>{err && <Notice tone="bad">{err}</Notice>}
      <Field label="Name"><input className={fieldClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Grade 4" /></Field>
      <Field label="Order" hint="Used to sort classes and for promotion (Grade 1 = 1)."><input type="number" className={fieldClass} value={f.level_order} onChange={(e) => setF({ ...f, level_order: e.target.value })} /></Field>
      <label className="flex items-center gap-2 text-sm mb-3"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> In use</label>
      <button type="button" className={`${saveBtnCls} w-full`} disabled={!f.name.trim()} onClick={save}>Save class</button>
      {row.id && <div className="mt-5"><Field label="Add a stream"><div className="flex gap-2"><input className={fieldClass} value={stream} onChange={(e) => setStream(e.target.value)} placeholder="East" /><button type="button" className="px-4 rounded-lg border border-[#E3DBB8] bg-white text-sm" disabled={!stream.trim()} onClick={addStream}>Add</button></div></Field></div>}
    </Sheet>
  );
}

function RosterSheet({ klass, period, onClose, basePath }) {
  const { can } = useElimuAccess();
  const r = useAsync(() => enrollmentService.roster({ academicYearId: period.academic_year_id, classId: klass.id }), [klass.id]);
  const streams = (klass.elimu_streams || []).filter((x) => x.is_active);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [note, setNote] = useState('');
  const rows = r.data || []; const unstreamed = streams.length ? rows.filter((s) => !s.stream_id).length : 0; const canMove = can('enrollment.manage') && streams.length > 0;
  const place = async (s, streamId) => { setBusy(true); setErr(''); setNote('');
    try { await enrollmentService.move(s.enrollment_id, klass.id, streamId || null, 'Stream chosen from the class list'); r.reload(); } catch (e) { setErr(friendlyError(e)); } setBusy(false); };
  const share = async () => { setBusy(true); setErr(''); setNote('');
    try { const x = await enrollmentService.shareStreams(klass.id); setNote(`${x.placed} learner${x.placed === 1 ? '' : 's'} placed across ${streams.length} streams${x.left_over ? `; ${x.left_over} left because the streams are full` : ''}.`); r.reload(); } catch (e) { setErr(friendlyError(e)); } setBusy(false); };
  return (
    <Sheet title={`${klass.name} · class list`} onClose={onClose}>
      {err && <Notice tone="bad">{err}</Notice>}{note && <Notice tone="good">{note}</Notice>}
      {canMove && unstreamed > 0 && <div className="mb-3 rounded-xl border border-[#C9A227] bg-[#F6EBC4] p-3 text-sm"><b>{unstreamed} learner{unstreamed === 1 ? ' is' : 's are'} not in a stream yet.</b> Choose a stream for each below, or share them evenly in one go.
        <button type="button" disabled={busy} onClick={share} className="mt-2 w-full min-h-[42px] rounded-xl bg-[#12261F] text-white font-semibold disabled:opacity-50">{busy ? 'Working…' : `Share evenly across ${streams.map((x) => x.name).join(' / ')}`}</button></div>}
      {r.loading && !r.data ? <LoadingBlock /> : rows.length === 0 ? <EmptyBlock>No students enrolled.</EmptyBlock> :
        <ol className="bg-white border border-[#E3DBB8] rounded-xl divide-y divide-[#EFE8C8]">{rows.map((s, i) => (
          <li key={s.student_id} className="px-3 py-2.5 text-sm flex items-center justify-between gap-2"><span className="min-w-0 truncate">{i + 1}. {fullName(s)}</span>
            {canMove ? <select aria-label={`Stream for ${fullName(s)}`} disabled={busy} value={s.stream_id || ''} onChange={(e) => place(s, e.target.value)} className="h-9 rounded-lg border border-[#DDD6B6] bg-white text-sm px-2 shrink-0"><option value="">No stream yet</option>{streams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              : <span className="text-xs text-[#6F7461] shrink-0">{s.stream_name || ''}</span>}
            <a className="underline text-[#1F6B45] shrink-0" href={`${basePath}/students/${s.student_id}`}>Open</a></li>))}</ol>}
    </Sheet>
  );
}
