// elimu/materials/pages/StudyMaterialsPage.jsx -- teachers post notes, revision and past papers for a class and subject they teach; management sees all.
import React, { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { FitPage, LoadingBlock, EmptyBlock, Notice, Sheet, fieldClass } from '../../services/platform.js';
import { useAsync } from '../../hooks/useAsync.js';
import { materialService, CATEGORIES, CATEGORY_LABEL } from '../services/materialService.js';
import { fileProblem, fileSize } from '../../shared/services/fileStorage.js';
import { friendlyError } from '../../utils/validation.js';
import { DocCard } from '../../ui/cards/index.js';

const btnP = 'min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-[#1F6B45] text-white disabled:opacity-50';
const btnS = 'min-h-[40px] px-3 rounded-xl text-xs font-semibold border border-[#E3DBB8] bg-white text-[#23382B] disabled:opacity-50';
const scopeLabel = (s) => `${s.class_name}${s.stream_name ? ` ${s.stream_name}` : ''} · ${s.subject_name}`;

function PostSheet({ scopes, onClose, onDone }) {
  const [i, setI] = useState(0); const [title, setTitle] = useState(''); const [category, setCategory] = useState('NOTES'); const [description, setDescription] = useState(''); const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const problem = file ? fileProblem(file) : '';
  const ok = scopes[i] && title.trim().length >= 2 && file && !problem;
  const send = async () => { setBusy(true); setErr(''); try { await materialService.post({ scope: scopes[i], title: title.trim(), category, description, file }); onDone(); } catch (e) { setErr(friendlyError(e)); } setBusy(false); };
  return (
    <Sheet title="Post study material" onClose={onClose}>
      <div className="space-y-3">
        {err && <Notice tone="bad">{err}</Notice>}
        <label className="text-xs block">Class and subject<select className={fieldClass} value={i} onChange={(e) => setI(Number(e.target.value))}>{scopes.map((s, k) => <option key={k} value={k}>{scopeLabel(s)}</option>)}</select></label>
        <label className="text-xs block">Title<input className={fieldClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example: Algebra notes, chapter 1" /></label>
        <div className="flex gap-1.5 flex-wrap">{CATEGORIES.map(([k, l]) => <button key={k} type="button" onClick={() => setCategory(k)} className={`h-10 px-3 rounded-full text-xs font-semibold border ${category === k ? 'bg-[#12261F] text-white border-[#12261F]' : 'bg-white border-[#E3DBB8]'}`}>{l}</button>)}</div>
        <label className="text-xs block">Short note for students (optional)<input className={fieldClass} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <label className="text-xs block">File<input type="file" className={fieldClass} accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
        {file && <p className={`text-xs ${problem ? 'text-red-700' : 'text-[#6F7461]'}`}>{problem || `${file.name} · ${fileSize(file.size)}`}</p>}
        <button type="button" className={btnP} disabled={!ok || busy} onClick={send}>{busy ? 'Uploading...' : 'Post to students'}</button>
        <p className="text-xs text-[#6F7461]">Students' parents in this class{scopes[i]?.stream_name ? ' and stream' : ''} will see it in their portal.</p>
      </div>
    </Sheet>
  );
}

export default function StudyMaterialsPage() {
  const [tick, setTick] = useState(0); const [open, setOpen] = useState(false); const [filter, setFilter] = useState(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const sc = useAsync(() => materialService.scopes(), [tick]);
  const list = useAsync(() => materialService.list(), [tick]);
  const scopes = (sc.data || []).filter((s) => s.can_post);
  const rows = (list.data || []).filter((m) => !filter || `${m.class_id}|${m.subject_id}` === filter);
  const combos = Array.from(new Map((list.data || []).map((m) => [`${m.class_id}|${m.subject_id}`, `${m.class_name} · ${m.subject_name}`])).entries());
  const remove = async (m) => { if (!window.confirm(`Remove "${m.title}"? Students will no longer see it.`)) return; try { await materialService.remove(m.id); setTick((x) => x + 1); } catch (e) { setErr(friendlyError(e)); } };
  const view = async (m) => { try { await materialService.open(m.path, m.file_name); } catch (e) { setErr(friendlyError(e)); } };
  return (
    <FitPage title="Study materials" icon={BookOpen} subtitle="Notes, revision and past papers by class and subject">
      <div className="space-y-3">
        {msg && <Notice tone="good">{msg}</Notice>}{err && <Notice tone="bad">{err}</Notice>}
        <div className="flex items-center justify-between gap-2">
          <select className={`${fieldClass} max-w-[60%]`} value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">All classes and subjects</option>{combos.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {scopes.length > 0 && <button type="button" className={btnP} onClick={() => setOpen(true)}>Post material</button>}
        </div>
        {sc.data && scopes.length === 0 && <Notice tone="warn">You can post once the school allocates you a subject in a class (Academics → Teacher allocations).</Notice>}
        {list.loading ? <LoadingBlock /> : rows.length === 0 ? <EmptyBlock title="No study materials yet" /> : (
          <div className="space-y-2">{rows.map((m) => (
            <DocCard key={m.id} tab={CATEGORY_LABEL[m.category]} title={m.title}
              meta={`${m.class_name}${m.stream_name ? ` ${m.stream_name}` : ''} · ${m.subject_name} · ${m.posted_by || 'teacher'} · ${new Date(m.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}${m.description ? ` — ${m.description}` : ''}`}
              footer={<div className="flex gap-2"><button type="button" className={btnS} onClick={() => view(m)}>Open · {fileSize(m.size_bytes)}</button><button type="button" className={btnS} onClick={() => remove(m)}>Remove</button></div>} />))}</div>)}
      </div>
      {open && <PostSheet scopes={scopes} onClose={() => setOpen(false)} onDone={() => { setOpen(false); setMsg('Posted. Parents of the class can now see it.'); setTick((x) => x + 1); }} />}
    </FitPage>
  );
}
