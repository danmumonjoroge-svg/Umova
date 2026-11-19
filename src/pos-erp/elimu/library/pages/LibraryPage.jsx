// elimu/library/pages/LibraryPage.jsx -- the school e-library: past papers, revision books, reference and school documents. Open to staff; parents see it in their portal.
import React, { useState } from 'react';
import { Library } from 'lucide-react';
import { FitPage, LoadingBlock, EmptyBlock, Notice, Sheet, fieldClass } from '../../services/platform.js';
import { useAsync, useDebounced } from '../../hooks/useAsync.js';
import { useElimuAccess } from '../../hooks/useElimu.js';
import { materialService } from '../../materials/services/materialService.js';
import { libraryService, LIB_CATEGORIES, LIB_LABEL } from '../services/libraryService.js';
import { fileProblem, fileSize } from '../../shared/services/fileStorage.js';
import { friendlyError } from '../../utils/validation.js';

const btnP = 'min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-[#1F6B45] text-white disabled:opacity-50';
const btnS = 'min-h-[40px] px-3 rounded-xl text-xs font-semibold border border-[#E3DBB8] bg-white text-[#23382B]';

function AddSheet({ targets, onClose, onDone }) {
  const [i, setI] = useState(0); const [title, setTitle] = useState(''); const [description, setDescription] = useState(''); const [category, setCategory] = useState('PAST_PAPER'); const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const fp = file ? fileProblem(file) : '';
  const send = async () => { setBusy(true); setErr(''); try { await libraryService.add({ scope: targets[i], title: title.trim(), description, category, file }); onDone(); } catch (e) { setErr(friendlyError(e)); } setBusy(false); };
  return (
    <Sheet title="Add to the library" onClose={onClose}>
      <div className="space-y-3">{err && <Notice tone="bad">{err}</Notice>}
        <label className="text-xs block">Who is it for<select className={fieldClass} value={i} onChange={(e) => setI(Number(e.target.value))}>{targets.map((t, k) => <option key={k} value={k}>{t.label}</option>)}</select></label>
        <div className="flex gap-1.5 flex-wrap">{LIB_CATEGORIES.map(([k, l]) => <button key={k} type="button" onClick={() => setCategory(k)} className={`h-10 px-3 rounded-full text-xs font-semibold border ${category === k ? 'bg-[#12261F] text-white border-[#12261F]' : 'bg-white border-[#E3DBB8]'}`}>{l}</button>)}</div>
        <label className="text-xs block">Title<input className={fieldClass} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="text-xs block">Description (optional)<input className={fieldClass} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <label className="text-xs block">File<input type="file" className={fieldClass} onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
        {file && <p className={`text-xs ${fp ? 'text-red-700' : 'text-[#6F7461]'}`}>{fp || `${file.name} · ${fileSize(file.size)}`}</p>}
        <button type="button" className={btnP} disabled={busy || title.trim().length < 2 || !file || !!fp} onClick={send}>{busy ? 'Uploading...' : 'Add to library'}</button>
      </div></Sheet>
  );
}

export default function LibraryPage() {
  const { can } = useElimuAccess(); const mgr = can('marks.manage_all');
  const [tick, setTick] = useState(0); const [category, setCategory] = useState(''); const [q, setQ] = useState(''); const dq = useDebounced(q, 300); const [open, setOpen] = useState(false); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const list = useAsync(() => libraryService.list({ category, search: dq }), [tick, category, dq]);
  const sc = useAsync(() => materialService.scopes(), []);
  const targets = [...(mgr ? [{ label: 'Whole school (all classes)', class_id: null, subject_id: null }] : []), ...(sc.data || []).filter((s) => s.can_post).map((s) => ({ label: `${s.class_name} · ${s.subject_name}`, class_id: s.class_id, subject_id: s.subject_id }))]
    .filter((t, k, a) => a.findIndex((x) => x.label === t.label) === k);
  const rows = list.data || [];
  const view = async (r) => { try { await libraryService.open(r.path, r.file_name); } catch (e) { setErr(friendlyError(e)); } };
  const remove = async (r) => { if (!window.confirm(`Remove "${r.title}" from the library?`)) return; try { await libraryService.remove(r.id); setTick((x) => x + 1); } catch (e) { setErr(friendlyError(e)); } };
  return (
    <FitPage title="E-library" icon={Library} subtitle="Past papers, revision books and school documents">
      <div className="space-y-3">{msg && <Notice tone="good">{msg}</Notice>}{err && <Notice tone="bad">{err}</Notice>}
        <div className="flex gap-2"><input className={fieldClass} placeholder="Search the library" value={q} onChange={(e) => setQ(e.target.value)} />{targets.length > 0 && <button type="button" className={btnP} onClick={() => setOpen(true)}>Add</button>}</div>
        <div className="flex gap-1.5 overflow-x-auto"><button type="button" onClick={() => setCategory('')} className={`h-9 px-3 rounded-full text-xs font-semibold border shrink-0 ${!category ? 'bg-[#12261F] text-white' : 'bg-white border-[#E3DBB8]'}`}>All</button>
          {LIB_CATEGORIES.map(([k, l]) => <button key={k} type="button" onClick={() => setCategory(k)} className={`h-9 px-3 rounded-full text-xs font-semibold border shrink-0 ${category === k ? 'bg-[#12261F] text-white' : 'bg-white border-[#E3DBB8]'}`}>{l}</button>)}</div>
        {list.loading ? <LoadingBlock /> : rows.length === 0 ? <EmptyBlock title="Nothing in the library yet" /> : (
          <ul className="space-y-2">{rows.map((r) => (
            <li key={r.id} className="rounded-2xl border border-[#E3DBB8] bg-white p-3 text-sm">
              <div className="flex justify-between gap-2"><b>{r.title}</b><span className="text-xs text-[#6F7461]">{LIB_LABEL[r.category]}</span></div>
              <div className="text-xs text-[#6F7461]">{r.class_name || 'Whole school'}{r.subject_name ? ` · ${r.subject_name}` : ''} · added by {r.added_by || 'staff'}</div>
              {r.description && <div className="text-xs mt-1">{r.description}</div>}
              <div className="flex gap-2 mt-2"><button type="button" className={btnS} onClick={() => view(r)}>Open · {fileSize(r.size_bytes)}</button>{r.can_remove && <button type="button" className={btnS} onClick={() => remove(r)}>Remove</button>}</div>
            </li>))}</ul>)}
      </div>
      {open && <AddSheet targets={targets} onClose={() => setOpen(false)} onDone={() => { setOpen(false); setMsg('Added to the library.'); setTick((x) => x + 1); }} />}
    </FitPage>
  );
}
