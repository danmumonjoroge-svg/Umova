// elimu/academic/pages/SubjectsPage.jsx — subjects: code, name, category, compulsory/elective, active, order, levels.
import React, { useState } from 'react';
import { BookOpen, Search, SlidersHorizontal } from 'lucide-react';
import { FitPage, LoadingBlock, EmptyBlock, AddButton, formCard, inputCls, saveBtnCls, Pill } from '../../../components/CardKit';
import { useLoad } from '../../../components/network/networkKit';
import { usePosErpAuth } from '../../../auth/usePosErpAuth';
import { academicService } from '../services/academicService';
import AccessGate from '../components/AccessGate';
import Note from '../components/Note';

const blank = { code: '', name: '', category: '', is_compulsory: true, sort_order: 0, applicable_levels: '' };
export default function SubjectsPage() {
  const { tenant } = usePosErpAuth();
  const { data, loading, error, reload } = useLoad(() => academicService.listSubjects({ includeInactive: true }), []);
  const [form, setForm] = useState(null); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(''); const [status, setStatus] = useState('ALL');
  const visible = (data || []).filter((s) => { const q = query.trim().toLowerCase(); const matches = !q || [s.name, s.code, s.category, ...(s.applicable_levels || [])].some((v) => String(v || '').toLowerCase().includes(q)); return matches && (status === 'ALL' || (status === 'ACTIVE' ? s.is_active : !s.is_active)); });
  const save = async () => {
    setBusy(true); setErr(null);
    try { await academicService.saveSubject(tenant.id, { ...form, applicable_levels: String(form.applicable_levels || '').split(',').map((x) => x.trim()).filter(Boolean) }); setForm(null); reload(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <FitPage title="Subjects" subtitle="What the school teaches" icon={BookOpen} action={<AddButton onClick={() => setForm(form ? null : { ...blank })} open={!!form} label="Add subject" />}>
      <AccessGate need="config.manage">
        {form && (
          <div className={formCard}>
            <div className="grid gap-2 sm:grid-cols-3">
              <input className={inputCls} placeholder="Code (MAT)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              <input className={`${inputCls} sm:col-span-2`} placeholder="Name (Mathematics)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className={inputCls} placeholder="Category (Sciences)" value={form.category || ''} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              <input className={inputCls} placeholder="Levels (blank = all), e.g. SEC,PRI" value={form.applicable_levels || ''} onChange={(e) => setForm({ ...form, applicable_levels: e.target.value })} />
              <input className={inputCls} type="number" placeholder="Order" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
              <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={form.is_compulsory} onChange={(e) => setForm({ ...form, is_compulsory: e.target.checked })} />Compulsory (untick for an elective)</label>
              <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={form.is_active ?? true} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />Active</label>
            </div>
            {err && <Note tone="bad">{err}</Note>}
            <button className={`${saveBtnCls} px-4 mt-2`} disabled={busy || !form.code || !form.name} onClick={save}>{busy ? 'Saving…' : 'Save subject'}</button>
          </div>)}
        {loading && <LoadingBlock />}{error && <Note tone="bad">{error.message}</Note>}
        {data && data.length > 0 && <>
          <div className="mb-3 flex flex-col gap-2 rounded-2xl border border-[#E4EAE4] bg-[#FAFCFA] p-3 sm:flex-row sm:items-center">
            <label className="relative min-w-0 flex-1"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#7A897D]" /><input className={`${inputCls} pl-9`} placeholder="Search name, code, category or level" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
            <label className="flex items-center gap-2 text-xs font-semibold text-[#657367]"><SlidersHorizontal size={15} /><select className={`${inputCls} min-w-[140px]`} value={status} onChange={(e) => setStatus(e.target.value)}><option value="ALL">All subjects</option><option value="ACTIVE">Active only</option><option value="INACTIVE">Inactive only</option></select></label>
            <span className="text-xs text-[#6F7461] sm:whitespace-nowrap">{visible.length} of {data.length}</span>
          </div>
        </>}
        {data && !data.length && <EmptyBlock>No subjects yet. Add the first one.</EmptyBlock>}
        {data?.length > 0 && !visible.length && <EmptyBlock>No subjects match these filters. Try a different search or status.</EmptyBlock>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((s) => (
            <button key={s.id} type="button" onClick={() => setForm({ ...s, applicable_levels: (s.applicable_levels || []).join(',') })} className={`group rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:border-[#A9CBB3] hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2E7D52] ${s.is_active ? 'border-[#E1E8E1]' : 'border-[#E3DBB8] opacity-70'}`}>
              <div className="flex items-start justify-between gap-2"><div className="min-w-0"><b className="block text-[#23382B]">{s.name}</b><span className="mt-1 block font-mono text-xs text-[#6F7461]">{s.code}</span></div><span className="rounded-lg bg-[#E8F2EA] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#2E7D52]">Edit</span></div>
              <div className="mt-3 flex flex-wrap gap-1.5"><Pill tone={s.is_compulsory ? 'good' : 'neutral'}>{s.is_compulsory ? 'Compulsory' : 'Elective'}</Pill>{s.category && <Pill>{s.category}</Pill>}{!s.is_active && <Pill tone="bad">Inactive</Pill>}{s.applicable_levels?.length > 0 && <Pill>{s.applicable_levels.join(', ')}</Pill>}</div>
            </button>))}
        </div>
      </AccessGate>
    </FitPage>
  );
}
