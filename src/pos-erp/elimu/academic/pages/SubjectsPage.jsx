// elimu/academic/pages/SubjectsPage.jsx — subjects: code, name, category, compulsory/elective, active, order, levels.
import React, { useState } from 'react';
import { BookOpen } from 'lucide-react';
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
        {data && !data.length && <EmptyBlock>No subjects yet. Add the first one.</EmptyBlock>}
        <div className="grid gap-2 sm:grid-cols-2">
          {(data || []).map((s) => (
            <button key={s.id} type="button" onClick={() => setForm({ ...s, applicable_levels: (s.applicable_levels || []).join(',') })} className={`text-left bg-white border border-[#E3DBB8] rounded-xl p-3 ${s.is_active ? '' : 'opacity-60'}`}>
              <div className="flex items-center justify-between"><b>{s.name}</b><span className="font-mono text-xs text-[#6F7461]">{s.code}</span></div>
              <div className="flex gap-1.5 mt-1.5 flex-wrap"><Pill tone={s.is_compulsory ? 'good' : 'neutral'}>{s.is_compulsory ? 'Compulsory' : 'Elective'}</Pill>{s.category && <Pill>{s.category}</Pill>}{!s.is_active && <Pill tone="bad">Inactive</Pill>}{s.applicable_levels && <Pill>{s.applicable_levels.join(', ')}</Pill>}</div>
            </button>))}
        </div>
      </AccessGate>
    </FitPage>
  );
}
