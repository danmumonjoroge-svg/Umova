// elimu/letters/pages/AdmissionLettersPage.jsx -- prepare, print and log offer / joining / waiting-list / regret letters; edit the wording.
import React, { useState } from 'react';
import { FileText } from 'lucide-react';
import { FitPage, LoadingBlock, EmptyBlock, Notice, Sheet, fieldClass } from '../../services/platform.js';
import { useAsync } from '../../hooks/useAsync.js';
import { admissionService } from '../../services/ElimuAdmissionService.js';
import { letterService, lettersFor, fillLetter, templateProblems, LETTER_KINDS, PLACEHOLDERS } from '../services/letterService.js';
import { friendlyError } from '../../utils/validation.js';

const btnP = 'min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-[#1F6B45] text-white disabled:opacity-50';
const btnS = 'min-h-[40px] px-3 rounded-xl text-xs font-semibold border border-[#E3DBB8] bg-white text-[#23382B] disabled:opacity-50';
const CATS = [['ADMITTED', 'Admitted'], ['ACCEPTED', 'Accepted'], ['WAITLISTED', 'Waiting list'], ['REJECTED', 'Not accepted']];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function printLetter(school, subject, body) {
  const w = window.open('', '_blank'); if (!w) return false;
  w.document.write(`<!doctype html><html><head><title>${esc(subject)}</title><style>body{font-family:Georgia,serif;max-width:680px;margin:48px auto;line-height:1.6;color:#111}h1{font-size:20px;margin:0 0 4px}.s{color:#555;font-size:13px;margin-bottom:28px}.b{white-space:pre-wrap}</style></head><body><h1>${esc(school)}</h1><div class="s">${esc(subject)}</div><div class="b">${esc(body)}</div></body></html>`);
  w.document.close(); w.focus(); w.print(); return true;
}

function LetterSheet({ app, kind, onClose, onIssued }) {
  const p = useAsync(() => letterService.preview(app.id, kind), [app.id, kind]); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const subject = p.data ? fillLetter(p.data.subject, p.data.fields) : ''; const body = p.data ? fillLetter(p.data.body, p.data.fields) : '';
  const go = async () => { setBusy(true); setErr(''); try { await letterService.issue(app.id, kind); if (!printLetter(p.data.fields.school_name, subject, body)) setErr('Your browser blocked the print window. Allow pop-ups and try again.'); else onIssued(); } catch (e) { setErr(friendlyError(e)); } setBusy(false); };
  return (
    <Sheet title={LETTER_KINDS[kind]} onClose={onClose}><div className="space-y-3">{err && <Notice tone="bad">{err}</Notice>}
      {p.loading ? <LoadingBlock /> : p.error ? <Notice tone="bad">{friendlyError(p.error)}</Notice> : <>
        <div className="rounded-xl border border-[#E3DBB8] bg-white p-3"><div className="text-xs text-[#6F7461]">Subject</div><div className="text-sm font-semibold">{subject}</div><pre className="mt-2 text-sm whitespace-pre-wrap font-sans">{body}</pre></div>
        <button type="button" className={btnP} disabled={busy} onClick={go}>{busy ? 'Preparing...' : 'Print or save as PDF'}</button>
        <p className="text-xs text-[#6F7461]">Printing records who issued this letter and when. In the print window choose "Save as PDF" to send it by email or WhatsApp.</p></>}
    </div></Sheet>
  );
}

function WordingSheet({ onClose }) {
  const [tick, setTick] = useState(0); const t = useAsync(() => letterService.templates(), [tick]); const [kind, setKind] = useState('OFFER'); const [d, setD] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  const cur = t.data ? t.data[kind] : null; const subject = d?.kind === kind ? d.subject : cur?.subject || ''; const body = d?.kind === kind ? d.body : cur?.body || '';
  const edit = (k) => (e) => setD({ kind, subject, body, [k]: e.target.value }); const probs = templateProblems(subject, body);
  const run = async (fn, msg) => { setBusy(true); setErr(''); setOk(''); try { await fn(); setD(null); setTick((n) => n + 1); setOk(msg); } catch (e) { setErr(friendlyError(e)); } setBusy(false); };
  return (
    <Sheet title="Letter wording" onClose={onClose}><div className="space-y-3">{err && <Notice tone="bad">{err}</Notice>}{ok && <Notice tone="good">{ok}</Notice>}
      <div className="flex gap-1.5 flex-wrap">{Object.entries(LETTER_KINDS).map(([k, l]) => <button key={k} type="button" className={btnS + (k === kind ? ' !bg-[#1F6B45] !text-white' : '')} onClick={() => { setKind(k); setD(null); setOk(''); }}>{l}</button>)}</div>
      {t.loading ? <LoadingBlock /> : <>
        <input className={fieldClass} value={subject} onChange={edit('subject')} aria-label="Subject" />
        <textarea className={fieldClass} rows={12} value={body} onChange={edit('body')} aria-label="Letter text" />
        <p className="text-xs text-[#6F7461]">Fill-in words you can use: {PLACEHOLDERS.map((x) => `{{${x}}}`).join('  ')}</p>
        <div className="flex gap-2"><button type="button" className={btnP} disabled={busy || probs.length > 0} onClick={() => run(() => letterService.saveTemplate(kind, subject, body), 'Wording saved.')}>Save wording</button>
          <button type="button" className={btnS} disabled={busy} onClick={() => run(() => letterService.resetTemplate(kind), 'Standard wording restored.')}>Use standard wording</button></div>
        {probs.length > 0 && <p className="text-xs text-red-700">{probs[0]}</p>}</>}
    </div></Sheet>
  );
}

export default function AdmissionLettersPage() {
  const [cat, setCat] = useState('ADMITTED'); const [search, setSearch] = useState(''); const [tick, setTick] = useState(0); const [open, setOpen] = useState(null); const [wording, setWording] = useState(false);
  const list = useAsync(() => admissionService.list({ category: cat, search }), [cat, search, tick]);
  const rows = list.data?.rows || [];
  return (
    <FitPage title="Admission letters" subtitle="Offer letters, joining instructions, waiting-list and regret letters" icon={FileText}>
      <div className="space-y-3">
        <div className="flex gap-1.5 flex-wrap items-center">{CATS.map(([k, l]) => <button key={k} type="button" className={btnS + (k === cat ? ' !bg-[#1F6B45] !text-white' : '')} onClick={() => setCat(k)}>{l}</button>)}
          <button type="button" className={btnS + ' ml-auto'} onClick={() => setWording(true)}>Edit wording</button></div>
        <input className={fieldClass} placeholder="Search by name or application number" value={search} onChange={(e) => setSearch(e.target.value)} />
        {list.loading ? <LoadingBlock /> : list.error ? <Notice tone="bad">{friendlyError(list.error)}</Notice> : rows.length === 0 ? <EmptyBlock title="No applications here" hint="Decide an application on the Applications page first." /> :
          <div className="space-y-2">{rows.map((r) => (
            <div key={r.id} className="rounded-[18px] border border-[#E3DBB8] bg-white shadow-[0_1px_2px_rgba(18,38,31,.06),0_6px_14px_-8px_rgba(18,38,31,.18)] p-3">
              <div className="text-sm font-semibold">{r.student?.first_name} {r.student?.last_name}</div>
              <div className="text-xs text-[#6F7461]">{r.application_no} · {r.status?.label}</div>
              <div className="flex gap-2 flex-wrap mt-2">{lettersFor(r.status?.category).map((k) => <button key={k} type="button" className={btnS} onClick={() => setOpen({ app: r, kind: k })}>{LETTER_KINDS[k]}</button>)}</div>
            </div>))}</div>}
      </div>
      {open && <LetterSheet app={open.app} kind={open.kind} onClose={() => setOpen(null)} onIssued={() => { setOpen(null); setTick((n) => n + 1); }} />}
      {wording && <WordingSheet onClose={() => setWording(false)} />}
    </FitPage>
  );
}
