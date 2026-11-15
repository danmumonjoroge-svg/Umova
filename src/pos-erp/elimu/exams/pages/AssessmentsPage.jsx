// elimu/exams/pages/AssessmentsPage.jsx — list (filtered, paginated) and create assessments; shows whether the weights add up to 100.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { FitPage, LoadingBlock, EmptyBlock, AddButton, formCard, inputCls, saveBtnCls, Pill } from '../../../components/CardKit';
import { useLoad } from '../../../components/network/networkKit';
import { examService } from '../services/examService';
import { academicService } from '../../academic/services/academicService';
import { useScope } from '../../academic/hooks/useScope';
import ScopeBar from '../../academic/components/ScopeBar';
import AccessGate from '../../academic/components/AccessGate';
import Note from '../../academic/components/Note';

const TONE = { DRAFT: 'neutral', OPEN: 'good', LOCKED: 'warn', CANCELLED: 'bad' };
export default function AssessmentsPage() {
  const s = useScope(); const { scope } = s; const [page, setPage] = useState(0); const [form, setForm] = useState(null); const [msg, setMsg] = useState(null);
  const lookups = useLoad(async () => ({ subjects: await academicService.listSubjects(), types: await examService.listTypes() }), []);
  const list = useLoad(() => (scope.yearId && scope.termId ? examService.listAssessments({ ...scope, page }) : Promise.resolve({ rows: [], total: 0 })), [scope.yearId, scope.termId, scope.classId, scope.streamId, scope.subjectId, page]);
  const types = lookups.data?.types || []; const subjects = lookups.data?.subjects || [];
  const pickType = (id) => { const t = types.find((x) => x.id === id); setForm((f) => ({ ...f, assessment_type_id: id, name: f.name || t?.name || '', max_marks: f.max_marks || t?.default_max_marks || '', weight: f.weight || t?.default_weight || '' })); };
  const create = async () => {
    setMsg(null);
    try {
      const r = await examService.createAssessment({ academic_year_id: scope.yearId, term_id: scope.termId, class_id: scope.classId, stream_id: scope.streamId || null, subject_id: form.subject_id, assessment_type_id: form.assessment_type_id, name: form.name, assessment_date: form.assessment_date || null, max_marks: Number(form.max_marks), weight: Number(form.weight), description: form.description || null, open: !!form.open });
      const bad = (r.weights || []).filter((w) => !w.ok && (!scope.streamId || w.stream_id === scope.streamId || w.stream_id === null));
      setMsg(bad.length ? { tone: 'warn', text: `Created. Weights for this subject add up to ${bad[0].total_weight}, not 100 (${bad[0].remaining > 0 ? bad[0].remaining + ' still to allocate' : -bad[0].remaining + ' too much'}). Results cannot be calculated until they equal 100.` } : { tone: 'good', text: 'Created. Weights add up to 100.' });
      setForm(null); list.reload();
    } catch (e) { setMsg({ tone: 'bad', text: e.message }); }
  };
  const act = async (a, status) => { const reason = ['CANCELLED', 'OPEN'].includes(status) && a.status !== 'DRAFT' ? window.prompt('Reason?') : null; if (['CANCELLED'].includes(status) && !reason) return;
    try { await examService.setAssessmentStatus(a.id, status, reason); list.reload(); } catch (e) { setMsg({ tone: 'bad', text: e.message }); } };
  return (
    <FitPage title="Assessments" subtitle="Tests and exams, with marks and weights" icon={ClipboardList}
      action={scope.classId && <AddButton onClick={() => setForm(form ? null : { open: true })} open={!!form} label="New assessment" />}
      toolbar={<ScopeBar s={s} show={['year', 'term', 'class', 'stream', 'subject']} subjects={subjects} />}>
      <AccessGate need="assessment.create">
        {msg && <Note tone={msg.tone}>{msg.text}</Note>}
        {form && scope.classId && (
          <div className={formCard}><div className="grid gap-2 sm:grid-cols-3">
            <select className={inputCls} value={form.subject_id || ''} onChange={(e) => setForm({ ...form, subject_id: e.target.value })}><option value="">Subject…</option>{subjects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            <select className={inputCls} value={form.assessment_type_id || ''} onChange={(e) => pickType(e.target.value)}><option value="">Type…</option>{types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            <input className={inputCls} placeholder="Name (CAT 1)" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className={inputCls} type="date" value={form.assessment_date || ''} onChange={(e) => setForm({ ...form, assessment_date: e.target.value })} />
            <input className={inputCls} inputMode="decimal" placeholder="Maximum marks" value={form.max_marks || ''} onChange={(e) => setForm({ ...form, max_marks: e.target.value })} />
            <input className={inputCls} inputMode="decimal" placeholder="Weight % of the subject" value={form.weight || ''} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
            <input className={`${inputCls} sm:col-span-2`} placeholder="Instructions / description (optional)" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={!!form.open} onChange={(e) => setForm({ ...form, open: e.target.checked })} />Open for marks entry now</label></div>
            <p className="text-[11px] text-[#6F7461] mt-1">For {s.nameOf('classes', scope.classId)} {scope.streamId ? s.nameOf('streams', scope.streamId) : '(all streams)'} · {s.nameOf('terms', scope.termId)}. The weights of one subject in one term must add up to 100.</p>
            <button className={`${saveBtnCls} px-4 mt-2`} disabled={!form.subject_id || !form.assessment_type_id || !form.max_marks || form.weight === '' || form.weight == null} onClick={create}>Create</button></div>)}
        {list.loading && <LoadingBlock />}{list.error && <Note tone="bad">{list.error.message}</Note>}
        {list.data && !list.data.rows.length && <EmptyBlock>{scope.classId ? 'No assessments match.' : 'Choose a class to create assessments.'}</EmptyBlock>}
        <div className="space-y-1.5">{(list.data?.rows || []).map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-2 bg-white border border-[#E3DBB8] rounded-xl p-2.5">
            <div className="min-w-0 flex-1 text-sm"><b>{a.name}</b> <span className="text-xs text-[#6F7461]">{a.subject?.name} · {a.type?.name}{a.stream_id ? ` · ${s.nameOf('streams', a.stream_id)}` : ''}</span>
              <div className="text-xs text-[#6F7461]">Max {a.max_marks} · weight {a.weight}%{a.assessment_date ? ` · ${a.assessment_date}` : ''}</div></div>
            <Pill tone={TONE[a.status]}>{a.status}</Pill>
            {a.status === 'DRAFT' && <button className="text-xs underline" onClick={() => act(a, 'OPEN')}>Open</button>}
            {a.status === 'OPEN' && <button className="text-xs underline" onClick={() => act(a, 'LOCKED')}>Lock</button>}
            {a.status === 'LOCKED' && <button className="text-xs underline" onClick={() => act(a, 'OPEN')}>Reopen</button>}
            {['DRAFT', 'OPEN'].includes(a.status) && <button className="text-xs underline text-[#A3352A]" onClick={() => act(a, 'CANCELLED')}>Cancel</button>}
            {a.status !== 'CANCELLED' && <Link className="text-xs font-bold text-white bg-[#1F6B45] rounded-lg px-3 py-2" to={`../marks/${a.id}`}>Marks</Link>}
          </div>))}</div>
        {list.data && list.data.total > 25 && <div className="flex justify-between mt-2 text-xs"><button disabled={page === 0} onClick={() => setPage(page - 1)}>← Previous</button><span>{page * 25 + 1}–{Math.min(list.data.total, page * 25 + 25)} of {list.data.total}</span><button disabled={(page + 1) * 25 >= list.data.total} onClick={() => setPage(page + 1)}>Next →</button></div>}
      </AccessGate>
    </FitPage>
  );
}
