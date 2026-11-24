// ELIMU parent portal:  <Route path="/parent/*" element={<ParentApp />} />
// Phone number + one-time SMS code. Read-only: the child's attendance (with arrival time), published report cards, school calendar
// (with money expected per event) and fees. Everything comes from SECURITY DEFINER functions that start from the signed-in phone.
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarCheck, GraduationCap, CalendarDays, Wallet, LogOut, Home as HomeIcon, ShieldCheck } from 'lucide-react';
import { parentSupabase, parentApi, parentEmail } from './parentClient.js';
import { freshGuard, lockedFor, afterWrongCode, wrongPasswordMessage, waitText } from '../auth/signinGuard.js';
import { openFile, fileSize } from '../shared/services/fileStorage.js';
import MenuTree from '../components/MenuTree.jsx';
import HelpCentre from '../help/HelpCentre.jsx';
import { NoticeCard, TripCard, DocCard, BookCard, EmptyNote } from '../ui/cards/index.js';
import { humanError, humanMessage } from '../utils/humanError.js';
import { isParentApp } from './appMode.js';
import { ChildHero, QuickTiles, Skeleton } from './ParentHome.jsx';
import { ChildDetails, ClassPerformance, WhatsNew } from './ParentExtras.jsx';
import ProgressView from '../shared/components/ProgressChart.jsx';
import { PARENT_TREE } from '../navigation/parentTree.js';

const money = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' }) : '');
const hhmm = (t) => (t ? String(t).slice(0, 5) : '');
const CSS = '.elimu-skel{background:linear-gradient(90deg,#EFE9CC 25%,#F7F2DA 37%,#EFE9CC 63%);background-size:400% 100%;animation:elimuSk 1.3s ease infinite}@keyframes elimuSk{0%{background-position:100% 50%}100%{background-position:0 50%}}@media (prefers-reduced-motion:reduce){.elimu-skel{animation:none}}.parent-app{-webkit-tap-highlight-color:transparent;touch-action:manipulation;overscroll-behavior:none}.parent-app input{font-size:16px}';
const GROUP = { PRESENT: ['Present', 'bg-emerald-100 text-emerald-800'], ABSENT: ['Absent', 'bg-red-100 text-red-800'], EXCUSED: ['Excused', 'bg-amber-100 text-amber-800'], NEUTRAL: ['—', 'bg-slate-100 text-slate-600'] };

function useData(fn, deps) {
  const [s, set] = useState({ loading: true, data: null, error: '' });
  const [n, setN] = useState(0);
  useEffect(() => { let live = true; set({ loading: true, data: null, error: '' });
    fn().then((data) => live && set({ loading: false, data, error: '' })).catch((e) => live && set({ loading: false, data: null, error: humanMessage(e) }));
    return () => { live = false; }; /* eslint-disable-next-line */ }, [...deps, n]);
  return { ...s, reload: () => setN((x) => x + 1) };
}
const Box = ({ s, children }) => (s.loading ? <Skeleton /> : s.error ? <p className="m-3 rounded-xl bg-red-50 text-red-800 text-sm p-3">{s.error}</p> : children(s.data));
const Card = ({ children, className = '' }) => <div className={`rounded-2xl bg-white border border-[#E3DBB8] p-3 ${className}`}>{children}</div>;

export function SignIn({ onDone }) {
  const [guard, setGuard] = useState(() => { try { return JSON.parse(localStorage.getItem('elimu-parent-guard') || 'null') || freshGuard(); } catch { return freshGuard(); } });
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const saveGuard = (g) => { setGuard(g); try { localStorage.setItem('elimu-parent-guard', JSON.stringify(g)); } catch { /* ignore */ } };
  const lockLeft = lockedFor(guard, now);
  const [code, setCode] = useState(() => { try { return localStorage.getItem('elimu-parent-code') || ''; } catch { return ''; } });
  const [showHelp, setShowHelp] = useState(false); const [user, setUser] = useState(''); const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async (e) => { e.preventDefault(); setErr('');
    if (lockLeft > 0) return setErr(`Too many wrong tries. Try again in ${waitText(lockLeft)}.`);
    const email = parentEmail(code, user);
    if (!email || !pw) return setErr('Enter the school code, your username and your password.');
    setBusy(true);
    const { error } = await parentSupabase.auth.signInWithPassword({ email, password: pw });
    if (error) { setBusy(false); if (!/invalid|credentials/i.test(error.message || '')) return setErr('Could not sign in. Check your internet connection and try again.'); const g = afterWrongCode(guard); saveGuard(g); return setErr(wrongPasswordMessage(g)); }
    saveGuard(freshGuard()); try { localStorage.setItem('elimu-parent-code', code.trim().toUpperCase()); } catch { /* ignore */ }
    setBusy(false); onDone(); };
  const field = 'w-full h-12 rounded-xl border border-[#DDD6B6] px-4 bg-white';
  return (
    <div className="flex-1 min-h-0 overflow-y-auto" style={{ background: 'linear-gradient(180deg,#12261F 0,#12261F 190px,#FBF8EA 190px)' }}>
      <form onSubmit={submit} className="w-full max-w-sm mx-auto px-5 pt-10 pb-8">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px_22px_22px_6px] bg-[#C9A227] text-[#12261F] shadow-lg"><GraduationCap size={32} /></div>
        <h1 className="text-center text-2xl font-bold text-white mt-3">Elimu</h1><p className="text-center text-xs text-white/70 -mt-0.5 mb-7">for parents</p>
        <div className="rounded-[26px] bg-white border border-[#E3DBB8] p-5 shadow-[0_12px_28px_-16px_rgba(18,38,31,.45)]">
        <p className="text-sm text-slate-600 mb-4">Sign in with the school code and username the school gave you.</p>
        {err && <p role="alert" className="mb-3 rounded-xl bg-red-50 text-red-800 text-sm p-3">{err}</p>}
        <label className="block text-xs font-semibold text-slate-600 mb-1">School code</label>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="organization" placeholder="e.g. A1B2C3" className={`${field} mb-3 tracking-widest`} />
        <label className="block text-xs font-semibold text-slate-600 mb-1">Username</label>
        <input value={user} onChange={(e) => setUser(e.target.value)} autoCapitalize="characters" autoComplete="username" placeholder="e.g. 1024-A" className={`${field} mb-3`} />
        <label className="block text-xs font-semibold text-slate-600 mb-1">Password</label>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" className={field} />
        <button disabled={busy || lockLeft > 0} className="mt-4 w-full h-12 rounded-xl bg-[#1F6B45] text-white font-semibold disabled:opacity-60">{busy ? 'Please wait…' : lockLeft > 0 ? `Try again in ${waitText(lockLeft)}` : 'Sign in'}</button>
        <p className="mt-3 text-xs text-slate-500 text-center">You stay signed in on this phone. Lost your password? The school office can give you a new one.</p>
        <p className="mt-5 flex items-start gap-2 text-xs text-slate-500"><ShieldCheck size={16} className="shrink-0 mt-0.5" />You will only see your own children.</p></div>
        <button type="button" onClick={() => setShowHelp((v) => !v)} className="block mx-auto mt-4 text-sm text-[#1F6B45] underline min-h-[44px]">{showHelp ? 'Hide help' : 'Need help signing in?'}</button>
        {showHelp && <div className="-mx-3"><HelpCentre audience="parent" onLog={(ch, m) => parentApi.helpLog(ch, m, null, (() => { try { return localStorage.getItem('elimu-parent-code'); } catch { return null; } })())} /></div>}
        {!isParentApp() && <a href="/school" className="block text-center mt-4 text-sm text-slate-500 underline">School staff? Sign in here</a>}
      </form>
    </div>
  );
}

/** First sign-in: the one-time password must be replaced by one the parent chooses. */
export function ChoosePassword({ name, onDone, onSignOut }) {
  const [a, setA] = useState(''); const [b, setB] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const save = async (e) => { e.preventDefault(); setErr('');
    if (a.length < 8) return setErr('Use at least 8 characters.');
    if (a !== b) return setErr('The two passwords are not the same.');
    setBusy(true);
    try { const { error } = await parentSupabase.auth.updateUser({ password: a }); if (error) throw humanError(error); await parentApi.passwordDone(); onDone(); }
    catch (x) { setErr(humanMessage(x)); } finally { setBusy(false); } };
  const field = 'w-full h-12 rounded-xl border border-[#DDD6B6] px-4 bg-white';
  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center p-5">
      <form onSubmit={save} className="w-full max-w-sm">
        <h1 className="text-center text-xl font-bold">Welcome{name ? `, ${name.split(' ')[0]}` : ''}</h1>
        <p className="text-center text-sm text-slate-600 mt-1 mb-5">Choose your own password. Only you will know it.</p>
        {err && <p role="alert" className="mb-3 rounded-xl bg-red-50 text-red-800 text-sm p-3">{err}</p>}
        <input type="password" value={a} onChange={(e) => setA(e.target.value)} autoComplete="new-password" placeholder="New password" className={`${field} mb-3`} />
        <input type="password" value={b} onChange={(e) => setB(e.target.value)} autoComplete="new-password" placeholder="Type it again" className={field} />
        <button disabled={busy} className="mt-4 w-full h-12 rounded-xl bg-[#1F6B45] text-white font-semibold disabled:opacity-60">{busy ? 'Saving…' : 'Save and continue'}</button>
        <button type="button" onClick={onSignOut} className="mt-2 w-full h-11 text-sm text-slate-500">Sign out</button>
      </form>
    </div>
  );
}

const Attendance = ({ id }) => (
  <Box s={useData(() => parentApi.attendance(id), [id])}>{(d) => (
    <div className="p-3 space-y-3">
      <div className="grid grid-cols-4 gap-2 text-center">{[['Present', d.present, 'text-emerald-700'], ['Absent', d.absent, 'text-red-700'], ['Excused', d.excused, 'text-amber-700'], ['Late', d.late, 'text-slate-700']].map(([k, v, c]) => (
        <Card key={k} className="!p-2"><div className={`text-xl font-bold ${c}`}>{v}</div><div className="text-[11px] text-slate-500">{k}</div></Card>))}</div>
      <p className="text-xs text-slate-500">Last 30 days</p>
      {d.days.length === 0 && <p className="text-sm text-slate-500">No attendance recorded yet.</p>}
      {d.days.map((x) => { const g = GROUP[x.group] || GROUP.NEUTRAL; return (
        <Card key={x.date} className="flex items-center justify-between"><div><div className="font-semibold text-sm">{day(x.date)}</div>
          <div className="text-xs text-slate-500">{x.arrival_time ? `Arrived ${hhmm(x.arrival_time)}` : ''}{x.late_minutes > 0 ? ` · ${x.late_minutes} min late` : ''}</div></div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${g[1]}`}>{g[0]}</span></Card>); })}
    </div>)}</Box>
);
const ResultsBody = ({ id }) => (
  <Box s={useData(() => parentApi.results(id), [id])}>{(rows) => (
    <div className="p-3 space-y-3">{rows.length === 0 && <p className="text-sm text-slate-500">No report card has been published yet.</p>}
      {rows.map((r) => (<Card key={r.report_card_id}><div className="flex items-baseline justify-between"><div className="font-bold">{r.term} · {r.year}</div><div className="text-2xl font-bold text-[#1F6B45]">{r.grade || '—'}</div></div>
        <div className="text-sm text-slate-600 mt-1">Mean {r.mean_percentage != null ? `${Number(r.mean_percentage).toFixed(1)}%` : '—'}{r.class_position ? ` · Position ${r.class_position} of ${r.class_size}` : ''}</div>
        {r.class_teacher_remarks && <p className="text-sm mt-2"><b>Class teacher:</b> {r.class_teacher_remarks}</p>}{r.head_remarks && <p className="text-sm mt-1"><b>Head:</b> {r.head_remarks}</p>}</Card>))}</div>)}</Box>
);
const Results = ({ id, allowed }) => !allowed ? <p className="p-4 text-sm text-slate-500">Results are not shared with this phone number. Ask the school if you need access.</p> : <ResultsBody id={id} />;
const Calendar = ({ id }) => (
  <Box s={useData(() => parentApi.calendar(id), [id])}>{(rows) => (
    <div className="p-3 space-y-2">{rows.length === 0 && <p className="text-sm text-slate-500">Nothing on the calendar.</p>}
      {rows.map((e) => (<Card key={e.id}><div className="flex justify-between gap-2"><div><div className="font-semibold text-sm">{e.title}</div>
        <div className="text-xs text-slate-500">{day(e.start_date)}{e.end_date !== e.start_date ? ` – ${day(e.end_date)}` : ''}{e.start_time ? ` · ${hhmm(e.start_time)}` : ''}{e.location ? ` · ${e.location}` : ''}</div></div>
        {e.expected_amount > 0 && <div className="text-right shrink-0"><div className="text-sm font-bold text-[#8A6D0B]">{money(e.expected_amount)}</div><div className="text-[10px] text-slate-500">expected</div></div>}</div>
        {e.expected_note && <p className="text-xs text-slate-600 mt-1">{e.expected_note}</p>}</Card>))}</div>)}</Box>
);
const FeesBody = ({ id }) => (
  <Box s={useData(() => parentApi.fees(id), [id])}>{(d) => (
    <div className="p-3 space-y-3"><Card className="text-center"><div className="text-xs text-slate-500">Balance to pay</div><div className="text-3xl font-bold text-[#1F6B45]">{money(d.outstanding_total)}</div>
      {d.pay_reference && <div className="mt-2 text-xs text-slate-600">Pay using reference <b className="tracking-wider text-sm">{d.pay_reference}</b></div>}</Card>
      {d.invoices.map((i) => (<Card key={i.invoice_no}><div className="flex justify-between text-sm"><b>{i.term ? `${i.term} · ` : ''}{i.academic_year || i.invoice_no}</b><span className="text-slate-500">Due {day(i.due_date)}</span></div>
        <div className="mt-1 text-xs text-slate-600">Total {money(i.total)} · Paid {money(i.paid)} · <b>Balance {money(i.outstanding)}</b></div></Card>))}</div>)}</Box>
);
const Fees = ({ id, allowed }) => !allowed ? <p className="p-4 text-sm text-slate-500">Fees are not shared with this phone number. Ask the school if you need access.</p> : <FeesBody id={id} />;

const ExamTimetableBody = ({ id }) => (
  <Box s={useData(() => parentApi.examTimetable(id), [id])}>{(rows) => (
    <div className="p-3 space-y-2">{rows.length === 0 && <p className="text-sm text-slate-500">No exam dates have been published yet.</p>}
      {rows.map((e, i) => (<Card key={i}><div className="flex justify-between gap-2"><div><div className="font-semibold text-sm">{e.subject} · {e.name}</div><div className="text-xs text-slate-500">{day(e.exam_date)} · {hhmm(e.start_time)}–{hhmm(e.end_time)}{e.venue ? ` · ${e.venue}` : ''}</div></div></div>{e.notes && <p className="text-xs text-slate-600 mt-1">{e.notes}</p>}</Card>))}</div>)}</Box>);
const ExamTimetable = ({ id, allowed }) => !allowed ? <p className="p-4 text-sm text-slate-500">Exam dates are not shared with this phone number. Ask the school if you need access.</p> : <ExamTimetableBody id={id} />;
const ProgressBody = ({ id }) => (
  <Box s={useData(() => parentApi.progress(id), [id])}>{(d) => <div className="p-3"><ProgressView data={d} /></div>}</Box>);
const Progress = ({ id, allowed }) => !allowed ? <p className="p-4 text-sm text-slate-500">Results are not shared with this phone number. Ask the school if you need access.</p> : <ProgressBody id={id} />;

const MAT_LABEL = { NOTES: 'Notes', REVISION: 'Revision', PAST_PAPER: 'Past paper', OTHER: 'Other' };
const dmy = (d, o = { day: 'numeric', month: 'short' }) => new Date(d).toLocaleDateString('en-KE', o);
const btnOpen = 'min-h-[44px] px-3 rounded-xl text-xs font-semibold border border-slate-300 bg-white';
const MaterialsBody = ({ id }) => (
  <Box s={useData(() => parentApi.materials(id), [id])}>{(rows) => (
    <div className="p-3 space-y-2">{rows.length === 0 && <EmptyNote title="Nothing posted yet">No study materials have been posted for this class yet.</EmptyNote>}
      {rows.map((m) => (<DocCard key={m.id} tab={MAT_LABEL[m.category]} title={m.title} meta={`${m.subject_name} · ${m.posted_by || 'Teacher'}${m.description ? ` — ${m.description}` : ''}`}
        footer={<button type="button" className={btnOpen} onClick={() => openFile(parentSupabase, m.path, m.file_name).catch((e) => window.alert(humanMessage(e)))}>Open · {fileSize(m.size_bytes)}</button>} />))}</div>)}</Box>);
const Materials = ({ id, allowed }) => !allowed ? <p className="p-4 text-sm text-slate-500">School work is not shared with this phone number. Ask the school if you need access.</p> : <MaterialsBody id={id} />;

function TripList({ id }) {
  const st = useData(() => parentApi.trips(id), [id]); const [msg, setMsg] = useState('');
  const answer = async (t, yes) => {
    const note = window.prompt(yes ? 'Optional note for the school (allergies, medicine):' : 'Optional note for the school:') || '';
    try { await parentApi.answerTrip(t.id, id, yes, note); setMsg(yes ? 'Thank you. You have agreed to the trip.' : 'Noted. Your child will not go on this trip.'); st.reload(); } catch (e) { setMsg(humanMessage(e)); }
  };
  return (
    <Box s={st}>{(rows) => (
      <div className="p-3 space-y-3">{msg && <p className="text-sm rounded-xl p-2" style={{ background: '#E4F0E8' }}>{msg}</p>}
        {rows.length === 0 && <EmptyNote title="No trips planned">No trips are planned for this class.</EmptyNote>}
        {rows.map((t) => { const d = new Date(t.trip_date);
          return <TripCard key={t.id} title={t.title} day={d.getDate()} month={d.toLocaleDateString('en-KE', { month: 'short' })} place={t.destination || 'School'}
            time={`${Number(t.cost) > 0 ? `KES ${Number(t.cost).toLocaleString('en-KE')}` : 'Free'}${t.consent_deadline && !t.cancelled ? ` · reply by ${dmy(t.consent_deadline)}` : ''}`}
            status={t.cancelled ? { label: 'Cancelled', tone: 'bad' } : t.consent === 'YES' ? { label: 'Agreed', tone: 'ok' } : t.consent === 'NO' ? { label: 'Declined', tone: 'quiet' } : { label: 'Please answer', tone: 'warn' }}
            footer={<>{t.description && <div className="whitespace-pre-line">{t.description}</div>}{t.cancelled && <div className="text-red-700">Cancelled: {t.cancel_reason}</div>}
              {t.can_answer && <div className="flex gap-2 mt-2"><button type="button" className="flex-1 min-h-[44px] rounded-xl text-white text-xs font-semibold" style={{ background: '#1F6B45' }} onClick={() => answer(t, true)}>{t.consent === 'YES' ? 'Agreed (change)' : 'Yes, my child may go'}</button>
                <button type="button" className="flex-1 min-h-[44px] rounded-xl border border-slate-300 bg-white text-xs font-semibold" onClick={() => answer(t, false)}>{t.consent === 'NO' ? 'Declined (change)' : 'No'}</button></div>}</>} />; })}</div>)}</Box>);
}
const Notices = ({ id }) => (
  <Box s={useData(() => parentApi.notices(id), [id])}>{(rows) => (
    <div className="p-3 space-y-3">{rows.length === 0 && <EmptyNote title="All quiet">There are no notices from the school right now.</EmptyNote>}
      {rows.map((n) => { const d = new Date(n.at); return <NoticeCard key={n.id} full title={n.title} body={n.body} pinned={!!n.important} audience={n.class_name || 'School'} day={d.getDate()} month={d.toLocaleDateString('en-KE', { month: 'short' })} footer={n.posted_by || 'School'} />; })}</div>)}</Box>);
const BooksBody = ({ id }) => (
  <Box s={useData(() => parentApi.books(id), [id])}>{(rows) => (
    <div className="p-3 space-y-3">{rows.length === 0 && <EmptyNote title="No books out">No books borrowed recently.</EmptyNote>}
      {rows.map((b) => <BookCard key={b.id} title={b.title} overdue={!!b.overdue}
        status={b.status === 'ON_LOAN' ? (b.overdue ? { label: 'Overdue', tone: 'bad' } : { label: 'On loan', tone: 'ok' }) : b.status === 'LOST' ? { label: 'Lost', tone: 'bad' } : { label: 'Returned', tone: 'quiet' }}
        author={`Borrowed ${dmy(b.issued_on)}`} due={b.status === 'ON_LOAN' ? `Due ${dmy(b.due_on)}` : ''}
        footer={b.fine_status === 'UNPAID' ? <span className="text-xs text-red-700">Fine to pay at school: KES {Number(b.fine_amount).toLocaleString('en-KE')}</span> : null} />)}</div>)}</Box>);
const Books = ({ id, allowed }) => !allowed ? <p className="p-4 text-sm text-slate-500">School work is not shared with this phone number. Ask the school if you need access.</p> : <BooksBody id={id} />;
const LIB_LABEL = { PAST_PAPER: 'Past paper', REVISION_BOOK: 'Revision book', REFERENCE: 'Reference', SCHOOL_DOCUMENT: 'School document', OTHER: 'Other' };
const LibraryBody = ({ id }) => (
  <Box s={useData(() => parentApi.library(id), [id])}>{(rows) => (
    <div className="p-3 space-y-2">{rows.length === 0 && <EmptyNote title="Library is empty">The school has not added anything to the library yet.</EmptyNote>}
      {rows.map((m) => (<DocCard key={m.id} tab={LIB_LABEL[m.category]} title={m.title} meta={`${m.subject_name || 'All subjects'}${m.description ? ` — ${m.description}` : ''}`}
        footer={<button type="button" className={btnOpen} onClick={() => openFile(parentSupabase, m.path, m.file_name).catch((e) => window.alert(humanMessage(e)))}>Open · {fileSize(m.size_bytes)}</button>} />))}</div>)}</Box>);
const Library = ({ id, allowed }) => !allowed ? <p className="p-4 text-sm text-slate-500">School work is not shared with this phone number. Ask the school if you need access.</p> : <LibraryBody id={id} />;
const SUB_TEXT = { SUBMITTED: 'Handed in', MARKED: 'Marked' };
function AssignmentList({ id }) {
  const st = useData(() => parentApi.assignments(id), [id]); const [busy, setBusy] = useState(null); const [msg, setMsg] = useState('');
  const pick = async (a, file) => {
    if (!file) return; setBusy(a.id); setMsg('');
    try { const r = await parentApi.handIn({ assignmentId: a.id, studentId: id, file, note: '' }); setMsg(r.late ? 'Handed in. It was after the deadline, so the teacher will see it as late.' : 'Handed in. Thank you.'); st.reload(); }
    catch (e) { setMsg(humanMessage(e)); } setBusy(null);
  };
  return (
    <Box s={st}>{(rows) => (
      <div className="p-3 space-y-2">{msg && <p className="text-sm rounded-xl bg-[#E4F0E8] p-2">{msg}</p>}
        {rows.length === 0 && <p className="text-sm text-slate-500">No assignments have been set for this class yet.</p>}
        {rows.map((a) => (<Card key={a.id}>
          <div className="flex justify-between gap-2"><div className="font-semibold text-sm">{a.title}</div><div className="text-xs text-slate-500">{a.sub_status ? SUB_TEXT[a.sub_status] : a.closed ? 'Closed' : a.overdue ? 'Overdue' : 'To do'}</div></div>
          <div className="text-xs text-slate-500">{a.subject_name} · due {new Date(a.due_at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{a.max_marks ? ` · out of ${a.max_marks}` : ''}</div>
          {a.instructions && <div className="text-xs mt-1">{a.instructions}</div>}
          {a.attachment_path && <button type="button" className="mt-1 min-h-[40px] px-3 rounded-xl text-xs border border-slate-300 bg-white" onClick={() => openFile(parentSupabase, a.attachment_path, a.attachment_name).catch((e) => window.alert(humanMessage(e)))}>Open: {a.attachment_name}</button>}
          {a.sub_status && <div className="text-xs mt-1">Handed in {a.sub_file}{a.sub_late ? ' (late)' : ''}{a.marks != null ? ` · Mark ${a.marks}${a.max_marks ? `/${a.max_marks}` : ''}` : ''}{a.teacher_comment ? ` · Teacher: ${a.teacher_comment}` : ''}</div>}
          {a.sub_status !== 'MARKED' && !a.closed && <label className="mt-2 flex min-h-[44px] items-center justify-center rounded-xl bg-[#1F6B45] text-white text-xs font-semibold px-3 cursor-pointer">{busy === a.id ? 'Uploading...' : a.sub_status ? 'Replace with new file' : 'Hand in work'}
            <input type="file" className="hidden" disabled={busy === a.id} onChange={(e) => { pick(a, e.target.files?.[0]); e.target.value = ''; }} /></label>}
        </Card>))}</div>)}</Box>);
}
const Assignments = ({ id, allowed }) => !allowed ? <p className="p-4 text-sm text-slate-500">School work is not shared with this phone number. Ask the school if you need access.</p> : <AssignmentList id={id} />;

const PASS_LABEL = { REQUESTED: 'Waiting for your answer', PARENT_ACCEPTED: 'You accepted', PARENT_REFUSED: 'You refused', CANCELLED: 'Cancelled by the school', EXITED: 'Left school', EXPIRED: 'Expired' };
function GatePassList({ id }) {
  const s = useData(() => parentApi.gatePasses(id), [id]); const [busy, setBusy] = useState(null); const [msg, setMsg] = useState(null);
  const answer = async (p, accept) => {
    if (accept && !window.confirm(`Allow your child to leave school? Reason given: ${p.reason}`)) return;
    const note = window.prompt(accept ? 'Optional note for the school (who will collect, when):' : 'Optional note for the school (why not):') || '';
    setBusy(p.id); setMsg(null);
    try { await parentApi.answerGatePass(p.id, accept, note.trim()); setMsg({ ok: true, text: accept ? 'You accepted. The gate officer can now let your child leave.' : 'You refused. Your child will stay at school.' }); s.reload && s.reload(); }
    catch (e) { setMsg({ ok: false, text: humanMessage(e) }); } finally { setBusy(null); }
  };
  return (<Box s={s}>{(rows) => (
    <div className="p-3 space-y-2">{msg && <p className={`rounded-xl text-sm p-3 ${msg.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'}`}>{msg.text}</p>}
      {rows.length === 0 && <p className="text-sm text-slate-500">The school has not asked to let your child leave.</p>}
      {rows.map((p) => (<Card key={p.id}><div className="flex justify-between gap-2"><div className="font-semibold text-sm">{p.reason}</div><span className="text-[11px] font-semibold text-slate-600 shrink-0">{PASS_LABEL[p.state] || p.state}</span></div>
        <div className="text-xs text-slate-500 mt-0.5">From {p.requested_by_name || 'a teacher'} · {new Date(p.requested_at).toLocaleString('en-KE', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}{p.collector_name ? ` · collector: ${p.collector_name}` : ''}</div>
        {p.state === 'REQUESTED' && <div className="flex gap-2 mt-2"><button type="button" disabled={busy === p.id} onClick={() => answer(p, true)} className="flex-1 min-h-[44px] rounded-xl bg-[#1F6B45] text-white font-bold disabled:opacity-50">Accept</button><button type="button" disabled={busy === p.id} onClick={() => answer(p, false)} className="flex-1 min-h-[44px] rounded-xl border border-[#8A3B2E] text-[#8A3B2E] font-bold disabled:opacity-50">Refuse</button></div>}</Card>))}</div>)}</Box>);
}
const GatePass = ({ id }) => <GatePassList id={id} />;

// One colour per child, so a parent with several children always knows whose page they are on.
const KID_COLOURS = ['#1F6B45', '#8A4B2A', '#2F5D8A', '#7A3E7A', '#9A7B12', '#1E7A7A'];
const kidColour = (list, id) => KID_COLOURS[Math.max(0, list.findIndex((c) => c.student_id === id)) % KID_COLOURS.length];
const TABS = [['home', 'Home', HomeIcon], ['attendance', 'Attendance', CalendarCheck], ['results', 'Results', GraduationCap], ['calendar', 'Calendar', CalendarDays], ['fees', 'Fees', Wallet]];

function Portal({ onSignOut }) {
  const nav = useNavigate(); const [tab, setTab] = useState('home'); const [sel, setSelRaw] = useState(() => { try { return sessionStorage.getItem('elimu-parent-child') || null; } catch { return null; } }); const [segs, setSegs] = useState([]);
  const setSel = (id) => { setSelRaw(id); try { sessionStorage.setItem('elimu-parent-child', id); } catch { /* ignore */ } };
  const kids = useData(() => parentApi.children(), []);
  const list = kids.data || []; const child = list.find((c) => c.student_id === sel) || list[0];
  return (
    <>
      <header className="shrink-0 bg-[#12261F] text-white pt-[env(safe-area-inset-top)]"><div className="flex items-center gap-3 px-3 h-14">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#C9A227] text-[#12261F]"><GraduationCap size={20} /></span>
        <div className="min-w-0 flex-1 leading-tight"><div className="font-bold text-[15px]">Elimu</div><div className="text-[11.5px] text-white/70 truncate">{child ? child.school_name : 'Parent'}</div></div>
        {!isParentApp() && <button type="button" onClick={() => nav('/')} aria-label="Umova home" className="h-10 w-10 flex items-center justify-center rounded-full active:bg-white/10"><HomeIcon size={19} /></button>}
        <button type="button" onClick={onSignOut} aria-label="Sign out" className="h-10 w-10 flex items-center justify-center rounded-full active:bg-white/10"><LogOut size={19} /></button></div></header>
      {kids.loading ? <Skeleton rows={4} /> : kids.error ? <p className="m-3 rounded-xl bg-red-50 text-red-800 text-sm p-3">{kids.error}</p> : !child ? (
        <section role="status" aria-live="polite" className="m-4 rounded-[18px] border border-[#E3DBB8] bg-white shadow-[0_1px_2px_rgba(18,38,31,.06),0_6px_14px_-8px_rgba(18,38,31,.18)] p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E4F0E8] text-[#1F6B45]"><ShieldCheck size={21} /></span>
            <div className="min-w-0">
              <h2 className="font-bold text-[#12261F]">No child found for your login</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">The school has not linked a child to your login yet. Ask the school office to check your record, then sign in again.</p>
            </div>
          </div>
          <div className="mt-4 rounded-xl bg-[#FBF8EA] p-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[#6F5A17]">What to do next</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
              <li>Contact the school office or class administrator.</li>
              <li>Provide your name, the learner’s name and admission number.</li>
              <li>Bring identification if the school requests it so staff can verify the relationship.</li>
              <li>After the school confirms the link, sign out and sign in again.</li>
            </ol>
          </div>
          <p className="mt-3 text-xs text-slate-500">Never share your password with anyone, including school staff. The school can give you a new one if you lose it.</p>
        </section>
      ) : (<>
        {list.length > 1 && <div className="shrink-0 px-3 pt-3"><div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Your children">{list.map((c) => { const on = c.student_id === child.student_id; const col = kidColour(list, c.student_id); return (
          <button key={c.student_id} type="button" role="tab" aria-selected={on} onClick={() => setSel(c.student_id)} className="shrink-0 rounded-2xl px-3 py-2 text-left border-2" style={{ borderColor: col, background: on ? col : '#fff', color: on ? '#fff' : '#23382B' }}>
            <div className="text-sm font-semibold">{c.name.split(' ')[0]}</div><div className="text-[11px]" style={{ opacity: .8 }}>{c.class_name || '—'}</div></button>); })}</div></div>}
        {tab !== 'home' && <div className="shrink-0 mx-3 mt-2 rounded-xl px-3 py-2 text-white flex items-center gap-2" style={{ background: kidColour(list, child.student_id) }} data-testid="child-banner">
          <span className="text-[11px] uppercase tracking-wide opacity-80">Showing</span><span className="font-semibold truncate">{child.name}</span><span className="text-xs opacity-80 ml-auto whitespace-nowrap">{child.class_name || ''}{child.admission_no ? ` · ${child.admission_no}` : ''}</span></div>}
        <main key={child.student_id} className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {tab === 'home' && <div className="p-3 space-y-4"><ChildHero child={child} colour={kidColour(list, child.student_id)} onOpen={setTab} /><QuickTiles child={child} onOpen={setTab} /><section><h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">What's new for {child.name.split(' ')[0]}</h2><WhatsNew id={child.student_id} canResults={child.can_see_results} canFees={child.can_see_fees} onOpen={setTab} /></section><MenuTree tree={PARENT_TREE} segs={segs} can={() => true} rootLabel="Home" searchable={false} onGo={setSegs} onOpen={(p) => setTab(p.tab)} /></div>}{tab === 'details' && <ChildDetails id={child.student_id} colour={kidColour(list, child.student_id)} />}{tab === 'classperf' && <ClassPerformance id={child.student_id} allowed={child.can_see_results} colour={kidColour(list, child.student_id)} />}{tab === 'attendance' && <Attendance id={child.student_id} />}{tab === 'results' && <Results id={child.student_id} allowed={child.can_see_results} />}
          {tab === 'help' && <HelpCentre audience="parent" onLog={(ch, m) => parentApi.helpLog(ch, m, null, (() => { try { return localStorage.getItem('elimu-parent-code'); } catch { return null; } })())} />}{tab === 'gatepass' && <GatePass id={child.student_id} />}{tab === 'assignments' && <Assignments id={child.student_id} allowed={child.can_see_results} />}{tab === 'trips' && <TripList id={child.student_id} />}{tab === 'notices' && <Notices id={child.student_id} />}{tab === 'books' && <Books id={child.student_id} allowed={child.can_see_results} />}{tab === 'library' && <Library id={child.student_id} allowed={child.can_see_results} />}{tab === 'materials' && <Materials id={child.student_id} allowed={child.can_see_results} />}{tab === 'extimetable' && <ExamTimetable id={child.student_id} allowed={child.can_see_results} />}{tab === 'progress' && <Progress id={child.student_id} allowed={child.can_see_results} />}{tab === 'calendar' && <Calendar id={child.student_id} />}{tab === 'fees' && <Fees id={child.student_id} allowed={child.can_see_fees} />}</main>
        <nav className="shrink-0 grid grid-cols-5 bg-white border-t border-[#E3DBB8] pb-[env(safe-area-inset-bottom)]">{TABS.map(([k, label, Icon]) => (
          <button key={k} type="button" onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined} style={tab === k ? { color: kidColour(list, child.student_id) } : undefined} className={`flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] font-semibold ${tab === k ? 'text-[#1F6B45]' : 'text-[#6F7461]'}`}>
            <span className={`flex h-7 w-12 items-center justify-center rounded-full ${tab === k ? 'bg-[#E4F0E8]' : ''}`}><Icon size={20} /></span>{label}</button>))}</nav></>)}
    </>
  );
}

export default function ParentApp() {
  const [state, setState] = useState('checking');          // checking | out | change | in | denied
  const [who, setWho] = useState(null); const [msg, setMsg] = useState('');
  const refresh = useCallback(async () => {
    const { data } = await parentSupabase.auth.getSession();
    if (!data?.session) { setState('out'); return; }
    try { const s = await parentApi.session(); setWho(s); setState(s.must_change ? 'change' : 'in'); }
    catch (e) { setMsg(humanMessage(e)); setState('denied'); }
  }, []);
  useEffect(() => { refresh(); const { data } = parentSupabase.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') setState('out'); }); return () => data?.subscription?.unsubscribe?.(); }, [refresh]);
  const out = async () => { await parentSupabase.auth.signOut(); setState('out'); };
  return (
    <div className="parent-app fixed inset-0 flex flex-col bg-[#FBF8EA] text-[#23382B]" style={{ height: '100dvh' }}><style>{CSS}</style>
      {state === 'checking' ? <p className="p-6 text-sm text-slate-500">Loading…</p>
        : state === 'out' ? <SignIn onDone={refresh} />
        : state === 'change' ? <ChoosePassword name={who?.name} onDone={refresh} onSignOut={out} />
        : state === 'denied' ? <div className="p-6"><p role="alert" className="rounded-xl bg-red-50 text-red-800 text-sm p-3">{msg}</p><button type="button" onClick={out} className="mt-3 w-full h-12 rounded-xl bg-[#1F6B45] text-white font-semibold">Back to sign in</button></div>
        : <Portal onSignOut={out} />}
    </div>
  );
}
