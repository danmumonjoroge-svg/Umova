import React, { useState } from 'react';
import { FitPage, DataCard, CardGrid, LoadingBlock, EmptyBlock, Notice, Sheet, fieldClass, saveBtnCls } from '../services/platform.js';
import { setupService } from '../services/ElimuSetupService.js';
import { enrollmentService } from '../services/ElimuEnrollmentService.js';
import { useAsync } from '../hooks/useAsync.js';
import { useElimuAccess, useElimuSetup } from '../hooks/useElimu.js';
import { Field } from '../components/ui.jsx';
import { fullName } from '../utils/format.js';
import { friendlyError } from '../utils/validation.js';

export default function ClassesPage({ basePath = '/elimu' }) {
  const { can } = useElimuAccess(); const { period } = useElimuSetup();
  const classes = useAsync(() => setupService.classes(), []); const [edit, setEdit] = useState(null); const [roster, setRoster] = useState(null);
  return (
    <FitPage title="Classes" subtitle={period ? `${period.academic_year_name}${period.term_name ? ` · ${period.term_name}` : ''}` : 'No current year'} action={can('structure.manage') && <button type="button" className="px-3 min-h-[40px] rounded-lg bg-[#1F6B45] text-white text-sm font-semibold" onClick={() => setEdit({})}>Add class</button>}>
      {classes.error && <Notice tone="bad">{classes.error}</Notice>}
      {classes.loading && !classes.data ? <LoadingBlock /> : (classes.data || []).length === 0 ? <EmptyBlock>No classes yet. {can('structure.manage') && 'Add Grade 1, Form 1… with the button above.'}</EmptyBlock> :
        <CardGrid>{classes.data.map((c) => (
          <DataCard key={c.id} title={c.name} subtitle={c.elimu_streams?.length ? `Streams: ${c.elimu_streams.filter((s) => s.is_active).map((s) => s.name).join(', ')}` : 'No streams'} dim={!c.is_active}>
            <div className="flex gap-3 text-sm font-semibold text-[#1F6B45]"><button type="button" className="underline" disabled={!period} onClick={() => setRoster(c)}>Class list</button>{can('structure.manage') && <button type="button" className="underline" onClick={() => setEdit(c)}>Edit</button>}</div>
          </DataCard>))}</CardGrid>}
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
  const r = useAsync(() => enrollmentService.roster({ academicYearId: period.academic_year_id, classId: klass.id }), [klass.id]);
  return (
    <Sheet title={`${klass.name} · class list`} onClose={onClose}>
      {r.loading && !r.data ? <LoadingBlock /> : (r.data || []).length === 0 ? <EmptyBlock>No students enrolled.</EmptyBlock> :
        <ol className="bg-white border border-[#E3DBB8] rounded-xl divide-y divide-[#EFE8C8]">{r.data.map((s, i) => <li key={s.student_id} className="px-3 py-2.5 text-sm flex justify-between"><span>{i + 1}. {fullName(s)}</span><a className="underline text-[#1F6B45]" href={`${basePath}/students/${s.student_id}`}>Open</a></li>)}</ol>}
    </Sheet>
  );
}
