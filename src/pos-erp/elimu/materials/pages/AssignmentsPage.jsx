// elimu/materials/pages/AssignmentsPage.jsx -- teachers set work, see who handed in, mark and comment. Management sees all.
import React, { useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { FitPage, LoadingBlock, EmptyBlock, Notice, Sheet, fieldClass } from '../../services/platform.js';
import { useAsync } from '../../hooks/useAsync.js';
import { materialService } from '../services/materialService.js';
import { assignmentService, assignmentProblems, SUB_LABEL } from '../services/assignmentService.js';
import { fileProblem, fileSize } from '../../shared/services/fileStorage.js';
import { friendlyError } from '../../utils/validation.js';

const btnP = 'min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-[#1F6B45] text-white disabled:opacity-50';
const btnS = 'min-h-[40px] px-3 rounded-xl text-xs font-semibold border border-[#E3DBB8] bg-white text-[#23382B] disabled:opacity-50';
const when = (v) => new Date(v).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const scopeLabel = (s) => `${s.class_name}${s.stream_name ? ` ${s.stream_name}` : ''} · ${s.subject_name}`;

function NewSheet({ scopes, onClose, onDone }) {
  const [i, setI] = useState(0); const [title, setTitle] = useState(''); const [instr, setInstr] = useState(''); const [due, setDue] = useState(''); const [maxMarks, setMax] = useState(''); const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const probs = assignmentProblems({ title, due, maxMarks }); const fp = file ? fileProblem(file) : '';
  const send = async () => { setBusy(true); setErr(''); try { await assignmentService.create({ scope: scopes[i], title: title.trim(), instructions: instr, due, maxMarks, file }); onDone(); } catch (e) { setErr(friendlyError(e)); } setBusy(false); };
  return (
    <Sheet title="Set an assignment" onClose={onClose}>
      <div className="space-y-3">
        {err && <Notice tone="bad">{err}</Notice>}
        <label className="text-xs block">Class and subject<select className={fieldClass} value={i} onChange={(e) => setI(Number(e.target.value))}>{scopes.map((s, k) => <option key={k} value={k}>{scopeLabel(s)}</option>)}</select></label>
        <label className="text-xs block">Title<input className={fieldClass} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="text-xs block">Instructions<textarea className={fieldClass} rows={3} value={instr} onChange={(e) => setInstr(e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs block">Deadline<input type="datetime-local" className={fieldClass} value={due} onChange={(e) => setDue(e.target.value)} /></label>
          <label className="text-xs block">Marks out of (optional)<input type="number" className={fieldClass} value={maxMarks} onChange={(e) => setMax(e.target.value)} /></label>
        </div>
        <label className="text-xs block">Attach a file (optional)<input type="file" className={fieldClass} onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
        {fp && <p className="text-xs text-red-700">{fp}</p>}
        <button type="button" className={btnP} disabled={busy || probs.length > 0 || !!fp} onClick={send}>{busy ? 'Saving...' : 'Set assignment'}</button>
        {title && probs.length > 0 && <p className="text-xs text-[#6F7461]">{probs[0]}</p>}
      </div>
    </Sheet>
  );
}

function Marking({ a, onClose, onChanged }) {
  const [tick, setTick] = useState(0); const s = useAsync(() => assignmentService.submissions(a.id), [a.id, tick]);
  const [edit, setEdit] = useState(null); const [marks, setMarks] = useState(''); const [comment, setComment] = useState(''); const [err, setErr] = useState('');
  const save = async () => { try { await assignmentService.mark(edit.submission_id, marks, comment); setEdit(null); setTick((x) => x + 1); onChanged(); } catch (e) { setErr(friendlyError(e)); } };
  const view = async (r) => { try { await assignmentService.open(r.path, r.file_name); } catch (e) { setErr(friendlyError(e)); } };
  const rows = s.data?.rows || [];
  return (
    <Sheet title={a.title} onClose={onClose}>
      <div className="space-y-2">
        {err && <Notice tone="bad">{err}</Notice>}
        {s.loading ? <LoadingBlock /> : rows.map((r) => (
          <div key={r.student_id} className="rounded-xl border border-[#E3DBB8] bg-white p-2.5 text-sm">
            <div className="flex justify-between gap-2"><b>{r.student_name}</b><span className={`text-xs ${r.status === 'MISSING' ? 'text-red-700' : 'text-[#1F6B45]'}`}>{SUB_LABEL[r.status]}{r.is_late ? ' · late' : ''}</span></div>
            <div className="text-xs text-[#6F7461]">{r.admission_no}{r.submitted_at ? ` · ${when(r.submitted_at)}` : ''}{r.marks != null ? ` · ${r.marks}${a.max_marks ? `/${a.max_marks}` : ''}` : ''}</div>
            {r.note && <div className="text-xs italic">Parent note: {r.note}</div>}{r.teacher_comment && <div className="text-xs">Your comment: {r.teacher_comment}</div>}
            {r.submission_id && <div className="flex gap-2 mt-1.5"><button type="button" className={btnS} onClick={() => view(r)}>Open work</button>
              <button type="button" className={btnS} onClick={() => { setEdit(r); setMarks(r.marks ?? ''); setComment(r.teacher_comment || ''); setErr(''); }}>{r.status === 'MARKED' ? 'Change mark' : 'Mark'}</button></div>}
          </div>))}
        {edit && <div className="rounded-xl border border-[#1F6B45] bg-[#F7F4E8] p-2.5 space-y-2"><b className="text-sm">{edit.student_name}</b>
          <input type="number" className={fieldClass} placeholder={`Marks${a.max_marks ? ` out of ${a.max_marks}` : ''}`} value={marks} onChange={(e) => setMarks(e.target.value)} />
          <input className={fieldClass} placeholder="Comment for the parent" value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="flex gap-2"><button type="button" className={btnP} onClick={save}>Save mark</button><button type="button" className={btnS} onClick={() => setEdit(null)}>Cancel</button></div></div>}
      </div>
    </Sheet>
  );
}

export default function AssignmentsPage() {
  const [tick, setTick] = useState(0); const [open, setOpen] = useState(false); const [mark, setMark] = useState(null); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const sc = useAsync(() => materialService.scopes(), []); const list = useAsync(() => assignmentService.list(), [tick]);
  const scopes = (sc.data || []).filter((s) => s.can_post); const rows = list.data || [];
  const run = async (fn, ok) => { try { await fn(); setMsg(ok); setErr(''); setTick((x) => x + 1); } catch (e) { setErr(friendlyError(e)); } };
  return (
    <FitPage title="Assignments" icon={ClipboardList} subtitle="Set work, see who handed in, mark">
      <div className="space-y-3">
        {msg && <Notice tone="good">{msg}</Notice>}{err && <Notice tone="bad">{err}</Notice>}
        {scopes.length > 0 && <div className="flex justify-end"><button type="button" className={btnP} onClick={() => setOpen(true)}>Set assignment</button></div>}
        {sc.data && scopes.length === 0 && <Notice tone="warn">You can set work once the school allocates you a subject in a class.</Notice>}
        {list.loading ? <LoadingBlock /> : rows.length === 0 ? <EmptyBlock title="No assignments yet" /> : (
          <ul className="space-y-2">{rows.map((a) => (
            <li key={a.id} className="rounded-[18px] border border-[#E3DBB8] bg-white shadow-[0_1px_2px_rgba(18,38,31,.06),0_6px_14px_-8px_rgba(18,38,31,.18)] p-3 text-sm">
              <div className="flex justify-between gap-2"><b>{a.title}</b><span className="text-xs text-[#6F7461]">{a.status === 'CLOSED' ? 'Closed' : `Due ${when(a.due_at)}`}</span></div>
              <div className="text-xs text-[#6F7461]">{a.class_name}{a.stream_name ? ` ${a.stream_name}` : ''} · {a.subject_name}</div>
              <div className="text-xs mt-1">{a.submitted} of {a.roster} handed in{a.late ? ` (${a.late} late)` : ''} · {a.marked} marked</div>
              <div className="flex gap-2 mt-2 flex-wrap"><button type="button" className={btnP} onClick={() => setMark(a)}>Submissions</button>
                {a.attachment_path && <button type="button" className={btnS} onClick={() => assignmentService.open(a.attachment_path, a.attachment_name).catch((e) => setErr(friendlyError(e)))}>Attachment · {a.attachment_name}</button>}
                <button type="button" className={btnS} onClick={() => run(() => assignmentService.close(a.id, a.status === 'CLOSED'), a.status === 'CLOSED' ? 'Reopened.' : 'Closed. No more work is accepted.')}>{a.status === 'CLOSED' ? 'Reopen' : 'Close'}</button>
                <button type="button" className={btnS} onClick={() => window.confirm(`Remove "${a.title}" and its handed-in work from view?`) && run(() => assignmentService.remove(a.id), 'Removed.')}>Remove</button></div>
            </li>))}</ul>)}
      </div>
      {open && <NewSheet scopes={scopes} onClose={() => setOpen(false)} onDone={() => { setOpen(false); setMsg('Assignment set. Parents can see it now.'); setTick((x) => x + 1); }} />}
      {mark && <Marking a={mark} onClose={() => setMark(null)} onChanged={() => setTick((x) => x + 1)} />}
    </FitPage>
  );
}
