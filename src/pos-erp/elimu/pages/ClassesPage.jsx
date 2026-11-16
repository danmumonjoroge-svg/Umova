import React, { useMemo, useState } from 'react';
import { FitPage, SearchBox, FilterChips, DataCard, CardGrid, LoadingBlock, EmptyBlock, Notice, Sheet, fieldClass, saveBtnCls } from '../services/platform.js';
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
  const [search, setSearch] = useState(''); const [scope, setScope] = useState('ACTIVE');
  const filtered = useMemo(() => (classes.data || []).filter((c) => (scope === 'ALL' || (scope === 'ACTIVE' ? c.is_active : !c.is_active)) && `${c.name} ${c.code || ''} ${(c.elimu_streams || []).map((x) => x.name).join(' ')}`.toLowerCase().includes(search.toLowerCase())), [classes.data, scope, search]);
  const activeCount = (classes.data || []).filter((c) => c.is_active).length;
  return (
    <FitPage title="Classes & streams" subtitle={period ? `${period.academic_year_name}${period.term_name ? ` · ${period.term_name}` : ''}` : 'No current academic year'} action={can('structure.manage') && <button type="button" className="px-3 min-h-[40px] rounded-xl bg-[#1F6B45] text-white text-sm font-semibold shadow-sm" onClick={() => setEdit({})}>＋ Add class</button>}
      summary={<div className="grid grid-cols-2 gap-2"><div className="rounded-xl border border-[#E3DBB8] bg-white px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-slate-500">Active classes</div><div className="text-lg font-bold text-[#1F6B45]">{classes.data ? activeCount : '—'}</div></div><div className="rounded-xl border border-[#E3DBB8] bg-[#FBF8EA] px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-slate-500">Total configured</div><div className="text-lg font-bold text-[#5C4A12]">{classes.data?.length ?? '—'}</div></div></div>}
      toolbar={<div className="space-y-2"><SearchBox value={search} onChange={setSearch} placeholder="Find a class or stream" /><FilterChips options={[{key:'ACTIVE',label:'In use'},{key:'INACTIVE',label:'Archived'},{key:'ALL',label:'All'}]} value={scope} onChange={setScope} /></div>}>
      {classes.error && <Notice tone="bad">{classes.error}</Notice>}
      {classes.loading && !classes.data ? <LoadingBlock /> : (classes.data || []).length === 0 ? <EmptyBlock>No classes configured yet. {can('structure.manage') && 'Add the first class using the button above.'}</EmptyBlock> : filtered.length === 0 ? <EmptyBlock>No classes match this search or filter.</EmptyBlock> :
        <CardGrid>{filtered.map((c) => (
          <DataCard key={c.id} title={c.name} subtitle={c.code || 'Class code not set'} pill={<span className={`text-[9px] font-bold uppercase rounded-full px-2 py-1 ${c.is_active ? 'bg-[#E3F1E7] text-[#1B5138]' : 'bg-[#EEEBDD] text-[#6B6A55]'}`}>{c.is_active ? 'In use' : 'Archived'}</span>} metrics={[{label:'Streams',value:(c.elimu_streams || []).filter((x) => x.is_active).length},{label:'Status',value:c.is_active ? 'Active' : 'Inactive'}]} dim={!c.is_active}>
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
