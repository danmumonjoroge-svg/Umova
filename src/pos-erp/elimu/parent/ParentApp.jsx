// ELIMU parent portal:  <Route path="/parent/*" element={<ParentApp />} />
// Phone number + one-time SMS code. Read-only: the child's attendance (with arrival time), published report cards, school calendar
// (with money expected per event) and fees. Everything comes from SECURITY DEFINER functions that start from the signed-in phone.
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarCheck, GraduationCap, CalendarDays, Wallet, LogOut, Home as HomeIcon, ShieldCheck } from 'lucide-react';
import { parentSupabase, parentApi, toE164 } from './parentClient.js';

const money = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' }) : '');
const hhmm = (t) => (t ? String(t).slice(0, 5) : '');
const CSS = '.parent-app{-webkit-tap-highlight-color:transparent;touch-action:manipulation;overscroll-behavior:none}.parent-app input{font-size:16px}';
const GROUP = { PRESENT: ['Present', 'bg-emerald-100 text-emerald-800'], ABSENT: ['Absent', 'bg-red-100 text-red-800'], EXCUSED: ['Excused', 'bg-amber-100 text-amber-800'], NEUTRAL: ['—', 'bg-slate-100 text-slate-600'] };

function useData(fn, deps) {
  const [s, set] = useState({ loading: true, data: null, error: '' });
  useEffect(() => { let live = true; set({ loading: true, data: null, error: '' });
    fn().then((data) => live && set({ loading: false, data, error: '' })).catch((e) => live && set({ loading: false, data: null, error: e.message }));
    return () => { live = false; }; /* eslint-disable-next-line */ }, deps);
  return s;
}
const Box = ({ s, children }) => (s.loading ? <p className="p-6 text-sm text-slate-500">Loading…</p> : s.error ? <p className="m-3 rounded-xl bg-red-50 text-red-800 text-sm p-3">{s.error}</p> : children(s.data));
const Card = ({ children, className = '' }) => <div className={`rounded-2xl bg-white border border-[#E3DBB8] p-3 ${className}`}>{children}</div>;

function SignIn({ onDone }) {
  const [phone, setPhone] = useState(''); const [code, setCode] = useState(''); const [step, setStep] = useState('phone'); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const e164 = toE164(phone);
  const send = async (e) => { e.preventDefault(); setErr('');
    if (!e164) return setErr('Enter the phone number the school has for you, like 0722 111 222.');
    setBusy(true); const { error } = await parentSupabase.auth.signInWithOtp({ phone: e164 }); setBusy(false);
    if (error) return setErr(error.message); setStep('code'); };
  const verify = async (e) => { e.preventDefault(); setErr(''); setBusy(true);
    const { error } = await parentSupabase.auth.verifyOtp({ phone: e164, token: code.trim(), type: 'sms' });
    if (error) { setBusy(false); return setErr('That code is not right or has expired.'); }
    try { await parentApi.link(); } catch (x) { setErr(x.message); setBusy(false); return; }
    setBusy(false); onDone(); };
  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center p-5">
      <form onSubmit={step === 'phone' ? send : verify} className="w-full max-w-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#C9A227] text-[#12261F]"><GraduationCap size={28} /></div>
        <h1 className="text-center text-xl font-bold">Elimu for parents</h1>
        <p className="text-center text-sm text-slate-600 mt-1 mb-5">{step === 'phone' ? 'Use the phone number your child’s school has on file.' : `Enter the 6-digit code sent to ${e164}.`}</p>
        {err && <p className="mb-3 rounded-xl bg-red-50 text-red-800 text-sm p-3">{err}</p>}
        {step === 'phone'
          ? <input autoFocus inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0722 111 222" className="w-full h-12 rounded-xl border border-[#DDD6B6] px-4 bg-white" />
          : <input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="______" className="w-full h-12 rounded-xl border border-[#DDD6B6] px-4 bg-white tracking-[0.5em] text-center" />}
        <button disabled={busy} className="mt-3 w-full h-12 rounded-xl bg-[#1F6B45] text-white font-semibold disabled:opacity-60">{busy ? 'Please wait…' : step === 'phone' ? 'Send code' : 'Sign in'}</button>
        {step === 'code' && <button type="button" onClick={() => { setStep('phone'); setCode(''); }} className="mt-2 w-full h-11 text-sm text-[#1F6B45]">Use a different number</button>}
        <p className="mt-5 flex items-start gap-2 text-xs text-slate-500"><ShieldCheck size={16} className="shrink-0 mt-0.5" />You will only see your own children. If nothing shows after signing in, ask the school to add this number to your record.</p>
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
const Results = ({ id, allowed }) => !allowed ? <p className="p-4 text-sm text-slate-500">Results are not shared with this phone number. Ask the school if you need access.</p> : (
  <Box s={useData(() => parentApi.results(id), [id])}>{(rows) => (
    <div className="p-3 space-y-3">{rows.length === 0 && <p className="text-sm text-slate-500">No report card has been published yet.</p>}
      {rows.map((r) => (<Card key={r.report_card_id}><div className="flex items-baseline justify-between"><div className="font-bold">{r.term} · {r.year}</div><div className="text-2xl font-bold text-[#1F6B45]">{r.grade || '—'}</div></div>
        <div className="text-sm text-slate-600 mt-1">Mean {r.mean_percentage != null ? `${Number(r.mean_percentage).toFixed(1)}%` : '—'}{r.class_position ? ` · Position ${r.class_position} of ${r.class_size}` : ''}</div>
        {r.class_teacher_remarks && <p className="text-sm mt-2"><b>Class teacher:</b> {r.class_teacher_remarks}</p>}{r.head_remarks && <p className="text-sm mt-1"><b>Head:</b> {r.head_remarks}</p>}</Card>))}</div>)}</Box>
);
const Calendar = ({ id }) => (
  <Box s={useData(() => parentApi.calendar(id), [id])}>{(rows) => (
    <div className="p-3 space-y-2">{rows.length === 0 && <p className="text-sm text-slate-500">Nothing on the calendar.</p>}
      {rows.map((e) => (<Card key={e.id}><div className="flex justify-between gap-2"><div><div className="font-semibold text-sm">{e.title}</div>
        <div className="text-xs text-slate-500">{day(e.start_date)}{e.end_date !== e.start_date ? ` – ${day(e.end_date)}` : ''}{e.start_time ? ` · ${hhmm(e.start_time)}` : ''}{e.location ? ` · ${e.location}` : ''}</div></div>
        {e.expected_amount > 0 && <div className="text-right shrink-0"><div className="text-sm font-bold text-[#8A6D0B]">{money(e.expected_amount)}</div><div className="text-[10px] text-slate-500">expected</div></div>}</div>
        {e.expected_note && <p className="text-xs text-slate-600 mt-1">{e.expected_note}</p>}</Card>))}</div>)}</Box>
);
const Fees = ({ id, allowed }) => !allowed ? <p className="p-4 text-sm text-slate-500">Fees are not shared with this phone number. Ask the school if you need access.</p> : (
  <Box s={useData(() => parentApi.fees(id), [id])}>{(d) => (
    <div className="p-3 space-y-3"><Card className="text-center"><div className="text-xs text-slate-500">Balance to pay</div><div className="text-3xl font-bold text-[#1F6B45]">{money(d.outstanding_total)}</div>
      {d.pay_reference && <div className="mt-2 text-xs text-slate-600">Pay using reference <b className="tracking-wider text-sm">{d.pay_reference}</b></div>}</Card>
      {d.invoices.map((i) => (<Card key={i.invoice_no}><div className="flex justify-between text-sm"><b>{i.term ? `${i.term} · ` : ''}{i.academic_year || i.invoice_no}</b><span className="text-slate-500">Due {day(i.due_date)}</span></div>
        <div className="mt-1 text-xs text-slate-600">Total {money(i.total)} · Paid {money(i.paid)} · <b>Balance {money(i.outstanding)}</b></div></Card>))}</div>)}</Box>
);

const TABS = [['attendance', 'Attendance', CalendarCheck], ['results', 'Results', GraduationCap], ['calendar', 'Calendar', CalendarDays], ['fees', 'Fees', Wallet]];

function Portal({ onSignOut }) {
  const nav = useNavigate(); const [tab, setTab] = useState('attendance'); const [sel, setSel] = useState(null);
  const kids = useData(() => parentApi.children(), []);
  const list = kids.data || []; const child = list.find((c) => c.student_id === sel) || list[0];
  return (
    <>
      <header className="shrink-0 bg-[#12261F] text-white pt-[env(safe-area-inset-top)]"><div className="flex items-center gap-3 px-3 h-14">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#C9A227] text-[#12261F]"><GraduationCap size={20} /></span>
        <div className="min-w-0 flex-1 leading-tight"><div className="font-bold text-[15px]">Elimu</div><div className="text-[11.5px] text-white/70 truncate">{child ? child.school_name : 'Parent'}</div></div>
        <button type="button" onClick={() => nav('/')} aria-label="Umova home" className="h-10 w-10 flex items-center justify-center rounded-full active:bg-white/10"><HomeIcon size={19} /></button>
        <button type="button" onClick={onSignOut} aria-label="Sign out" className="h-10 w-10 flex items-center justify-center rounded-full active:bg-white/10"><LogOut size={19} /></button></div></header>
      {kids.loading ? <p className="p-6 text-sm text-slate-500">Loading…</p> : kids.error ? <p className="m-3 rounded-xl bg-red-50 text-red-800 text-sm p-3">{kids.error}</p> : !child ? (
        <p className="m-4 text-sm text-slate-600">We could not find a child linked to this phone number. Ask the school to add it to your record, then sign in again.</p>
      ) : (<>
        <div className="shrink-0 px-3 pt-3"><div className="flex gap-2 overflow-x-auto pb-1">{list.map((c) => (
          <button key={c.student_id} type="button" onClick={() => setSel(c.student_id)} className={`shrink-0 rounded-2xl px-3 py-2 text-left border ${c.student_id === child.student_id ? 'bg-[#1F6B45] border-[#1F6B45] text-white' : 'bg-white border-[#E3DBB8]'}`}>
            <div className="text-sm font-semibold">{c.name}</div><div className={`text-[11px] ${c.student_id === child.student_id ? 'text-white/80' : 'text-slate-500'}`}>{c.class_name || '—'} · {c.school_name}</div></button>))}</div></div>
        <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {tab === 'attendance' && <Attendance id={child.student_id} />}{tab === 'results' && <Results id={child.student_id} allowed={child.can_see_results} />}
          {tab === 'calendar' && <Calendar id={child.student_id} />}{tab === 'fees' && <Fees id={child.student_id} allowed={child.can_see_fees} />}</main>
        <nav className="shrink-0 grid grid-cols-4 bg-white border-t border-[#E3DBB8] pb-[env(safe-area-inset-bottom)]">{TABS.map(([k, label, Icon]) => (
          <button key={k} type="button" onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined} className={`flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] font-semibold ${tab === k ? 'text-[#1F6B45]' : 'text-[#6F7461]'}`}>
            <span className={`flex h-7 w-12 items-center justify-center rounded-full ${tab === k ? 'bg-[#E4F0E8]' : ''}`}><Icon size={20} /></span>{label}</button>))}</nav></>)}
    </>
  );
}

export default function ParentApp() {
  const [state, setState] = useState('checking');          // checking | out | in
  const refresh = useCallback(async () => { const { data } = await parentSupabase.auth.getSession(); setState(data?.session ? 'in' : 'out'); }, []);
  useEffect(() => { refresh(); const { data } = parentSupabase.auth.onAuthStateChange((_e, s) => setState(s ? 'in' : 'out')); return () => data?.subscription?.unsubscribe?.(); }, [refresh]);
  const out = async () => { await parentSupabase.auth.signOut(); setState('out'); };
  return (
    <div className="parent-app fixed inset-0 flex flex-col bg-[#FBF8EA] text-[#23382B]" style={{ height: '100dvh' }}><style>{CSS}</style>
      {state === 'checking' ? <p className="p-6 text-sm text-slate-500">Loading…</p> : state === 'out' ? <SignIn onDone={refresh} /> : <Portal onSignOut={out} />}
    </div>
  );
}
