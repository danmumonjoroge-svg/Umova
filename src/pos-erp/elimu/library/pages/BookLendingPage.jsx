// elimu/library/pages/BookLendingPage.jsx -- the librarian's desk: issue and return books, see who is late, fines, and the catalogue.
import React, { useEffect, useState } from 'react';
import { BookMarked } from 'lucide-react';
import { FitPage, LoadingBlock, EmptyBlock, Notice, Sheet, fieldClass } from '../../services/platform.js';
import { useAsync, useDebounced } from '../../hooks/useAsync.js';
import { studentService } from '../../services/ElimuStudentService.js';
import { bookService, bookProblems, money, LOAN_VIEWS } from '../services/bookService.js';
import { friendlyError } from '../../utils/validation.js';
import { BookCard } from '../../ui/cards/index.js';

const btnP = 'min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-[#1F6B45] text-white disabled:opacity-50';
const btnS = 'min-h-[40px] px-3 rounded-xl text-xs font-semibold border border-[#E3DBB8] bg-white text-[#23382B] disabled:opacity-50';
const day = (v) => (v ? new Date(v).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }) : '');

function IssueSheet({ onClose, onDone }) {
  const [acc, setAcc] = useState(''); const [q, setQ] = useState(''); const dq = useDebounced(q, 300); const [stu, setStu] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const found = useAsync(() => (dq.trim().length >= 2 && !stu ? studentService.list({ search: dq }) : Promise.resolve({ rows: [] })), [dq, stu]);
  const send = async () => { setBusy(true); setErr(''); try { const r = await bookService.issue(acc.trim(), stu.id); onDone(`Issued "${r.title}" to ${stu.full_name}, due ${day(r.due_on)}.`); } catch (e) { setErr(friendlyError(e)); } setBusy(false); };
  return (
    <Sheet title="Issue a book" onClose={onClose}><div className="space-y-3">{err && <Notice tone="bad">{err}</Notice>}
      <input className={fieldClass} placeholder="Accession number on the book (scan or type)" value={acc} onChange={(e) => setAcc(e.target.value)} autoFocus />
      {stu ? <div className="flex items-center justify-between rounded-xl border border-[#E3DBB8] bg-white p-3"><div><b>{stu.full_name}</b><div className="text-xs text-[#6F7461]">{stu.admission_no}{stu.class_name ? ` · ${stu.class_name}` : ''}</div></div><button type="button" className={btnS} onClick={() => setStu(null)}>Change</button></div>
        : (<><input className={fieldClass} placeholder="Search the student by name or admission number" value={q} onChange={(e) => setQ(e.target.value)} />
          {(found.data?.rows || []).slice(0, 6).map((r) => <button key={r.id} type="button" onClick={() => setStu(r)} className="w-full text-left rounded-xl border border-[#E3DBB8] bg-white p-2 min-h-[48px]"><b className="text-sm">{r.full_name}</b><div className="text-xs text-[#6F7461]">{r.admission_no}{r.class_name ? ` · ${r.class_name}` : ''}</div></button>)}</>)}
      <button type="button" className={btnP} disabled={busy || !acc.trim() || !stu} onClick={send}>{busy ? 'Saving...' : 'Issue book'}</button></div></Sheet>
  );
}

function AddSheet({ onClose, onDone }) {
  const [f, setF] = useState({ title: '', author: '', isbn: '', copies: '1', price: '', accessions: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value })); const probs = bookProblems(f);
  const send = async () => { setBusy(true); setErr(''); try { const r = await bookService.add(f); onDone(`Added ${r.accessions.length} cop${r.accessions.length === 1 ? 'y' : 'ies'}: ${r.accessions.slice(0, 3).join(', ')}${r.accessions.length > 3 ? '...' : ''}`); } catch (e) { setErr(friendlyError(e)); } setBusy(false); };
  return (
    <Sheet title="Add a book" onClose={onClose}><div className="space-y-3">{err && <Notice tone="bad">{err}</Notice>}
      <input className={fieldClass} placeholder="Title" value={f.title} onChange={set('title')} />
      <div className="grid grid-cols-2 gap-2"><input className={fieldClass} placeholder="Author" value={f.author} onChange={set('author')} /><input className={fieldClass} placeholder="ISBN" value={f.isbn} onChange={set('isbn')} /></div>
      <div className="grid grid-cols-2 gap-2"><label className="text-xs">Copies<input type="number" className={fieldClass} value={f.copies} onChange={set('copies')} /></label><label className="text-xs">Price each (for lost books)<input type="number" className={fieldClass} value={f.price} onChange={set('price')} /></label></div>
      <label className="text-xs block">Or type your own accession numbers (separated by spaces or commas)<input className={fieldClass} value={f.accessions} onChange={set('accessions')} placeholder="Leave empty to number them automatically" /></label>
      <button type="button" className={btnP} disabled={busy || probs.length > 0} onClick={send}>{busy ? 'Saving...' : 'Add to catalogue'}</button>{f.title && probs[0] && <p className="text-xs text-[#6F7461]">{probs[0]}</p>}</div></Sheet>
  );
}

function SettingsSheet({ onClose, onDone }) {
  const s = useAsync(() => bookService.getSettings(), []); const [f, setF] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { if (s.data) setF(s.data); }, [s.data]);
  const save = async () => { try { await bookService.setSettings(f); onDone('Lending rules saved.'); } catch (e) { setErr(friendlyError(e)); } };
  return (
    <Sheet title="Lending rules" onClose={onClose}>{!f ? <LoadingBlock /> : <div className="space-y-3">{err && <Notice tone="bad">{err}</Notice>}
      <label className="text-xs block">Loan period (days)<input type="number" className={fieldClass} value={f.loan_days} onChange={(e) => setF({ ...f, loan_days: e.target.value })} /></label>
      <label className="text-xs block">Fine per day late (KES, 0 for none)<input type="number" className={fieldClass} value={f.fine_per_day} onChange={(e) => setF({ ...f, fine_per_day: e.target.value })} /></label>
      <label className="text-xs block">Books a student may hold at once<input type="number" className={fieldClass} value={f.max_loans} onChange={(e) => setF({ ...f, max_loans: e.target.value })} /></label>
      <button type="button" className={btnP} onClick={save}>Save</button><p className="text-xs text-[#6F7461]">Fines are recorded here and marked paid or waived; they are not added to the school fee account.</p></div>}</Sheet>
  );
}

export default function BookLendingPage() {
  const [view, setView] = useState('out'); const [q, setQ] = useState(''); const dq = useDebounced(q, 300); const [tick, setTick] = useState(0); const [sheet, setSheet] = useState(null); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const data = useAsync(() => (view === 'books' ? bookService.list(dq) : bookService.loans(view, dq)), [view, dq, tick]);
  const rows = data.data || [];
  const done = (m) => { setSheet(null); setMsg(m); setErr(''); setTick((x) => x + 1); };
  const act = async (fn, ok) => { try { const r = await fn(); setMsg(typeof ok === 'function' ? ok(r) : ok); setErr(''); setTick((x) => x + 1); } catch (e) { setErr(friendlyError(e)); } };
  return (
    <FitPage title="Book lending" icon={BookMarked} subtitle="Issue and return books, overdue and fines">
      <div className="space-y-3">{msg && <Notice tone="good">{msg}</Notice>}{err && <Notice tone="bad">{err}</Notice>}
        <div className="flex gap-2 flex-wrap"><button type="button" className={btnP} onClick={() => setSheet('issue')}>Issue a book</button><button type="button" className={btnS} onClick={() => setSheet('add')}>Add a book</button><button type="button" className={btnS} onClick={() => setSheet('rules')}>Rules</button></div>
        <div className="flex gap-1.5 overflow-x-auto">{LOAN_VIEWS.map(([k, l]) => <button key={k} type="button" onClick={() => setView(k)} className={`h-9 px-3 rounded-full text-xs font-semibold border shrink-0 ${view === k ? 'bg-[#12261F] text-white' : 'bg-white border-[#E3DBB8]'}`}>{l}</button>)}</div>
        <input className={fieldClass} placeholder={view === 'books' ? 'Search title, author, ISBN or accession number' : 'Search book, accession number or student'} value={q} onChange={(e) => setQ(e.target.value)} />
        {data.loading ? <LoadingBlock /> : data.error ? <Notice tone="bad">{friendlyError(data.error)}</Notice> : rows.length === 0 ? <EmptyBlock title={view === 'books' ? 'No books yet' : 'Nothing here'} /> : view === 'books' ? (
          <ul className="space-y-2">{rows.map((b) => <li key={b.id} className="rounded-[18px] border border-[#E3DBB8] bg-white shadow-[0_1px_2px_rgba(18,38,31,.06),0_6px_14px_-8px_rgba(18,38,31,.18)] p-3 text-sm"><b>{b.title}</b><div className="text-xs text-[#6F7461]">{[b.author, b.isbn].filter(Boolean).join(' · ')}</div><div className="text-xs mt-1">{b.available} on the shelf · {b.on_loan} out · {b.copies} copies{b.lost ? ` · ${b.lost} lost` : ''}</div></li>)}</ul>
        ) : (
          <div className="space-y-3">{rows.map((l) => (
            <BookCard key={l.id} title={l.title} author={`${l.student_name} · ${l.admission_no} · ${l.accession_no}`} overdue={!!l.overdue}
              due={l.status === 'ON_LOAN' ? (l.overdue ? `${l.days_late} days late` : `Due ${day(l.due_on)}`) : l.status === 'LOST' ? 'Lost' : `Returned ${day(l.returned_on)}`}
              status={l.status === 'ON_LOAN' ? (l.overdue ? { label: 'Overdue', tone: 'bad' } : { label: 'On loan', tone: 'ok' }) : l.status === 'LOST' ? { label: 'Lost', tone: 'bad' } : { label: 'Back', tone: 'quiet' }}
              footer={<>
              {l.fine_amount > 0 && <div className="text-xs mt-1">Fine {money(l.fine_amount)} · {l.fine_status.toLowerCase()}</div>}
              <div className="flex gap-2 mt-2 flex-wrap">
                {l.status === 'ON_LOAN' && <><button type="button" className={btnP} onClick={() => act(() => bookService.giveBack(l.id, false), (r) => (r.fine > 0 ? `Returned. Fine ${money(r.fine)} for ${r.days_late} days late.` : 'Returned.'))}>Returned</button>
                  <button type="button" className={btnS} onClick={() => window.confirm('Mark this book as lost? The student is charged its price.') && act(() => bookService.giveBack(l.id, true), (r) => `Marked lost. Charge ${money(r.fine)}.`)}>Lost</button></>}
                {l.fine_status === 'UNPAID' && <><button type="button" className={btnS} onClick={() => act(() => bookService.settle(l.id, 'paid'), 'Marked paid.')}>Fine paid</button><button type="button" className={btnS} onClick={() => window.confirm('Waive this fine?') && act(() => bookService.settle(l.id, 'waived'), 'Fine waived.')}>Waive</button></>}
              </div></>} />))}</div>)}
      </div>
      {sheet === 'issue' && <IssueSheet onClose={() => setSheet(null)} onDone={done} />}{sheet === 'add' && <AddSheet onClose={() => setSheet(null)} onDone={done} />}{sheet === 'rules' && <SettingsSheet onClose={() => setSheet(null)} onDone={done} />}
    </FitPage>
  );
}
