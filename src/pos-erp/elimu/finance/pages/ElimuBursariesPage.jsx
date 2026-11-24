// Bursaries, scholarships, discounts, credit notes and write-offs. The database does the work (E004): who may request, who must approve
// (never the requester), and the ledger entries. This page shows what is waiting, what standing awards exist, and lets staff raise them.
import React, { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useElimuFinance } from '../hooks/useElimuFinance';
import { AwardCard } from '../../ui/cards/index.js';
import { FitPage, LoadingBlock, EmptyBlock, Notice, DataCard, inputCls } from '../../../components/CardKit';
import Sheet from '../../components/AppSheet.jsx';
import { fromDb, formatMoney, toCents, MoneyError } from '../utils/money';

const M = (v) => formatMoney(fromDb(v));
const KINDS = [['BURSARY', 'Bursary (paid by a sponsor)'], ['SCHOLARSHIP', 'Scholarship'], ['DISCOUNT', 'Discount (sibling, staff child, early payment)'], ['CREDIT_NOTE', 'Credit note (billing correction)'], ['WRITE_OFF', 'Write-off (fee will not be collected)']];
const KIND_LABEL = { BURSARY: 'Bursary', SCHOLARSHIP: 'Scholarship', DISCOUNT: 'Discount', CREDIT_NOTE: 'Credit note', WRITE_OFF: 'Write-off', OPENING_CREDIT: 'Opening credit' };
const SPONSORS = [['GOVERNMENT', 'Government'], ['COUNTY', 'County / NG-CDF'], ['NGO', 'NGO / foundation'], ['INDIVIDUAL', 'Individual'], ['SCHOOL', 'The school itself'], ['NONE', 'No sponsor']];
const STATUS_TONE = { PENDING_APPROVAL: 'Waiting for approval', APPLIED: 'Applied', REJECTED: 'Declined', CANCELLED: 'Withdrawn', REVERSED: 'Reversed' };
const Go = ({ busy, onClick, children, disabled }) => <button type="button" disabled={busy || disabled} onClick={onClick} className="w-full h-12 rounded-2xl bg-[#12261F] text-white font-bold disabled:opacity-50">{busy ? 'Saving…' : children}</button>;
const Small = ({ children, ...p }) => <button type="button" {...p} className={`px-3 min-h-[38px] rounded-lg text-sm disabled:opacity-50 ${p.solid ? 'bg-[#1F6B45] text-white' : 'border border-[#1F6B45] text-[#1F6B45]'}`}>{children}</button>;

function StudentPicker({ ctx, value, onPick }) {
  const [q, setQ] = useState(''); const [res, setRes] = useState([]);
  useEffect(() => { if (value) return undefined; const h = setTimeout(() => { ctx.api.searchStudents(ctx.businessId, q).then(setRes).catch(() => setRes([])); }, 250); return () => clearTimeout(h); }, [q, value, ctx.api, ctx.businessId]);
  if (value) return <div className="flex items-center justify-between rounded-xl border border-[#E3DBB8] p-2 text-sm"><span><b>{value.full_name}</b> · {value.admission_no}{value.class_name ? ` · ${value.class_name}` : ''}</span><button type="button" className="text-xs underline" onClick={() => onPick(null)}>Change</button></div>;
  return (<div><input className={inputCls} placeholder="Find the student (name or admission no.)" value={q} onChange={(e) => setQ(e.target.value)} />
    {res.map((s) => <button type="button" key={s.student_id} onClick={() => onPick(s)} className="block w-full text-left px-2 py-2 border-b border-[#F0ECD9] text-sm">{s.full_name} <span className="text-xs text-[#6F7461]">· {s.admission_no}{s.class_name ? ` · ${s.class_name}` : ''}</span></button>)}</div>);
}

function useInvoices(ctx, studentId) {
  const [inv, setInv] = useState([]);
  useEffect(() => { if (!studentId) { setInv([]); return; } ctx.api.list('elimu_fin_invoices', ctx.businessId, { filters: { student_id: studentId }, order: { col: 'due_date', asc: false }, limit: 30 }).then((r) => setInv((r || []).filter((i) => i.status !== 'CANCELLED'))).catch(() => setInv([])); }, [ctx.api, ctx.businessId, studentId]);
  return inv;
}
const invLabel = (i) => `${i.invoice_no} · ${i.academic_year || ''} ${i.term || ''} · owing ${M(i.outstanding)}`;

function RequestSheet({ ctx, onClose, onDone }) {
  const [st, setSt] = useState(null); const inv = useInvoices(ctx, st?.student_id);
  const [f, setF] = useState({ kind: 'BURSARY', mode: 'amount', amount: '', percent: '', invoiceId: '', reason: '', sponsor: '', sponsorRef: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const credit = f.kind === 'OPENING_CREDIT';
  const save = async () => {
    setErr(''); if (!st) return setErr('Choose the student.'); if (f.reason.trim().length < 3) return setErr('Give a reason (at least 3 characters).');
    let cents = null; const pct = f.mode === 'percent' && !credit ? Number(f.percent) : null;
    if (pct !== null) { if (!(pct > 0 && pct <= 100)) return setErr('Percentage must be between 0 and 100.'); if (!f.invoiceId) return setErr('A percentage needs the invoice it applies to.'); }
    else { try { cents = toCents(f.amount); } catch (e) { return setErr(e instanceof MoneyError ? e.message : 'Enter the amount.'); } if (cents <= 0) return setErr('The amount must be above zero.'); }
    if (f.kind === 'BURSARY' && !f.sponsor.trim()) return setErr('Name the sponsor of the bursary.');
    setBusy(true);
    try {
      if (credit) await ctx.api.openingCredit(ctx.businessId, st.student_id, cents, f.reason.trim());
      else await ctx.api.requestAdjustment(ctx.businessId, st.student_id, { kind: f.kind, amountCents: cents, percent: pct, reason: f.reason.trim(), invoiceId: f.invoiceId || null, sponsorName: f.sponsor.trim() || null, sponsorReference: f.sponsorRef.trim() || null });
      await onDone(credit ? 'Opening credit added.' : 'Request sent for approval.'); onClose();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (<Sheet title="New request" onClose={onClose}>{err && <Notice tone="bad">{err}</Notice>}<div className="space-y-3">
    <StudentPicker ctx={ctx} value={st} onPick={setSt} />
    <select className={inputCls} value={f.kind} onChange={set('kind')}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}{ctx.can('approve') && <option value="OPENING_CREDIT">Opening credit (family already overpaid)</option>}</select>
    {!credit && <select className={inputCls} value={f.invoiceId} onChange={set('invoiceId')}><option value="">Not tied to one invoice</option>{inv.map((i) => <option key={i.id} value={i.id}>{invLabel(i)}</option>)}</select>}
    {!credit && <div className="flex gap-2">{[['amount', 'Fixed amount'], ['percent', '% of invoice']].map(([k, l]) => <button key={k} type="button" onClick={() => setF((x) => ({ ...x, mode: k }))} className={`flex-1 h-10 rounded-xl border text-sm font-semibold ${f.mode === k ? 'bg-[#12261F] text-white border-[#12261F]' : 'bg-white border-[#E3DBB8]'}`}>{l}</button>)}</div>}
    {f.mode === 'percent' && !credit ? <input className={inputCls} inputMode="decimal" placeholder="Percent (e.g. 25)" value={f.percent} onChange={set('percent')} /> : <input className={inputCls} inputMode="decimal" placeholder="Amount (KES)" value={f.amount} onChange={set('amount')} />}
    {(f.kind === 'BURSARY' || f.kind === 'SCHOLARSHIP') && !credit && <><input className={inputCls} placeholder={f.kind === 'BURSARY' ? 'Sponsor (required)' : 'Sponsor (optional)'} value={f.sponsor} onChange={set('sponsor')} /><input className={inputCls} placeholder="Sponsor reference / cheque no. (optional)" value={f.sponsorRef} onChange={set('sponsorRef')} /></>}
    <input className={inputCls} placeholder="Reason (required)" value={f.reason} onChange={set('reason')} />
    <p className="text-xs text-[#6F7461]">{credit ? 'Applied straight away; it is held as credit for the student.' : 'Nothing changes on the student account until someone else approves it.'}</p>
    <Go busy={busy} onClick={save}>{credit ? 'Add credit' : 'Send for approval'}</Go></div></Sheet>);
}

function AwardSheet({ ctx, onClose, onDone }) {
  const [st, setSt] = useState(null); const [periods, setPeriods] = useState([]);
  const [f, setF] = useState({ type: 'BURSARY', sponsorType: 'GOVERNMENT', sponsor: '', coverage: 'PARTIAL', valueType: 'PERCENT', value: '', scope: 'ANNUAL', year: String(new Date().getFullYear()), periodId: '', note: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { ctx.api.list('elimu_fin_periods', ctx.businessId, { order: { col: 'start_date', asc: false }, limit: 24 }).then((r) => setPeriods(r || [])).catch(() => setPeriods([])); }, [ctx.api, ctx.businessId]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const full = f.coverage === 'FULL';
  const save = async () => {
    setErr(''); if (!st) return setErr('Choose the student.');
    let value = full ? 100 : Number(f.value); const vt = full ? 'PERCENT' : f.valueType;
    if (!full) { if (vt === 'FIXED') { try { value = toCents(f.value) / 100; } catch (e) { return setErr(e instanceof MoneyError ? e.message : 'Enter the value.'); } } if (!(value > 0) || (vt === 'PERCENT' && value > 100)) return setErr(vt === 'PERCENT' ? 'Percent must be above 0 and at most 100.' : 'Enter an amount above zero.'); }
    if (f.scope === 'TERM' && !f.periodId) return setErr('Choose the term this award covers.');
    if (!f.year.trim()) return setErr('Enter the academic year.');
    setBusy(true);
    try { await ctx.api.createAward(ctx.businessId, st.student_id, { type: f.type, sponsorType: f.sponsorType, sponsorName: f.sponsor.trim() || null, coverage: f.coverage, valueType: vt, value, scope: f.scope, academicYear: f.year.trim(), periodId: f.scope === 'TERM' ? f.periodId : null, note: f.note.trim() || null }); await onDone('Award recorded. Apply it to each invoice from the Awards list.'); onClose(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (<Sheet title="New standing award" onClose={onClose}>{err && <Notice tone="bad">{err}</Notice>}<div className="space-y-3">
    <StudentPicker ctx={ctx} value={st} onPick={setSt} />
    <div className="grid grid-cols-2 gap-2"><select className={inputCls} value={f.type} onChange={set('type')}><option value="BURSARY">Bursary</option><option value="SCHOLARSHIP">Scholarship</option></select><select className={inputCls} value={f.sponsorType} onChange={set('sponsorType')}>{SPONSORS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
    <input className={inputCls} placeholder="Sponsor name (e.g. County Bursary Fund)" value={f.sponsor} onChange={set('sponsor')} />
    <div className="grid grid-cols-2 gap-2"><select className={inputCls} value={f.coverage} onChange={set('coverage')}><option value="PARTIAL">Part of the fees</option><option value="FULL">Full fees (100%)</option></select>{!full && <select className={inputCls} value={f.valueType} onChange={set('valueType')}><option value="PERCENT">Percent of invoice</option><option value="FIXED">Fixed amount per invoice</option></select>}</div>
    {!full && <input className={inputCls} inputMode="decimal" placeholder={f.valueType === 'PERCENT' ? 'Percent (e.g. 50)' : 'Amount (KES)'} value={f.value} onChange={set('value')} />}
    <div className="grid grid-cols-2 gap-2"><select className={inputCls} value={f.scope} onChange={set('scope')}><option value="ANNUAL">Whole year</option><option value="TERM">One term</option></select><input className={inputCls} placeholder="Academic year" value={f.year} onChange={set('year')} /></div>
    {f.scope === 'TERM' && <select className={inputCls} value={f.periodId} onChange={set('periodId')}><option value="">Choose the term</option>{periods.map((p) => <option key={p.id} value={p.id}>{p.academic_year} {p.term || ''}</option>)}</select>}
    <input className={inputCls} placeholder="Approval note (optional)" value={f.note} onChange={set('note')} />
    <p className="text-xs text-[#6F7461]">Recording an award is itself the approval, so it needs the approve right. Applying it to an invoice then posts the discount.</p>
    <Go busy={busy} onClick={save}>Record award</Go></div></Sheet>);
}

function ApplySheet({ ctx, award, onClose, onDone }) {
  const inv = useInvoices(ctx, award.student_id); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const fits = inv.filter((i) => i.academic_year === award.academic_year && (award.scope === 'ANNUAL' || i.period_id === award.period_id) && i.kind !== 'OPENING_BALANCE' && Number(i.outstanding) > 0);
  const go = async (i) => { setBusy(true); setErr(''); try { const r = await ctx.api.applyAward(award.id, i.id); await onDone(`Applied ${M(r.amount)} to ${i.invoice_no}.`); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (<Sheet title="Apply award to an invoice" onClose={onClose}>{err && <Notice tone="bad">{err}</Notice>}{!fits.length ? <EmptyBlock>No unpaid invoice for this award's year or term.</EmptyBlock> : fits.map((i) => <div key={i.id} className="flex items-center justify-between gap-2 border-b border-[#F0ECD9] py-2 text-sm"><span>{invLabel(i)}</span><Small solid disabled={busy} onClick={() => go(i)}>Apply</Small></div>)}</Sheet>);
}

export default function ElimuBursariesPage() {
  const ctx = useElimuFinance(); const { api, businessId, can, ready } = ctx;
  const [tab, setTab] = useState('pending'); const [adj, setAdj] = useState(null); const [awards, setAwards] = useState(null);
  const [err, setErr] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false);
  const [names, setNames] = useState({}); const [req, setReq] = useState(false); const [aw, setAw] = useState(false); const [apply, setApply] = useState(null);
  const load = useCallback(async () => {
    try { setErr(null); const [a, w] = await Promise.all([api.list('elimu_fin_adjustments', businessId, { order: { col: 'requested_at', asc: false }, limit: 200 }), api.list('elimu_fin_awards', businessId, { order: { col: 'created_at', asc: false }, limit: 200 })]);
      setAdj(a || []); setAwards(w || []);
      const ids = [...new Set((w || []).map((x) => x.student_id))];
      if (ids.length) { const r = await api.studentsByIds(businessId, ids); setNames(Object.fromEntries(r.map((x) => [x.student_id, `${x.full_name} · ${x.admission_no}`]))); } }
    catch (e) { setErr(e.message); setAdj([]); setAwards([]); }
  }, [api, businessId]);
  useEffect(() => { if (ready && can('view')) load(); }, [ready, can, load]);
  if (!ready) return <LoadingBlock />;
  if (!can('view')) return <FitPage title="Bursaries"><Notice tone="gold">You do not have access to this page.</Notice></FitPage>;
  const done = async (m) => { setNote(m); await load(); };
  const act = async (fn, msg) => { setBusy(true); setErr(null); try { await fn(); await done(msg); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const decide = (a, yes) => { let why = null; if (!yes) { why = window.prompt('Why is this declined?'); if (!why) return; } act(() => api.decideAdjustment(a.id, yes, why), yes ? 'Approved and posted to the student account.' : 'Declined.'); };
  const withdraw = (a) => { const why = window.prompt('Why is it being withdrawn? (optional)') ?? null; act(() => api.withdrawAdjustment(a.id, why), 'Request withdrawn.'); };
  const pending = (adj || []).filter((a) => a.status === 'PENDING_APPROVAL'); const past = (adj || []).filter((a) => a.status !== 'PENDING_APPROVAL');
  const AdjCard = ({ a }) => (<AwardCard key={a.id} kind={KIND_LABEL[a.kind] || a.kind} title={a.student_name} sub={`${a.admission_no} · ${a.reason}${a.sponsor_name ? ` · ${a.sponsor_name}` : ''}${a.decision_note ? ` · "${a.decision_note}"` : ''}`} amountText={M(a.amount)} state={STATUS_TONE[a.status] || a.status}
    tone={a.status === 'APPLIED' ? 'in' : a.status === 'PENDING_APPROVAL' ? 'wait' : a.status === 'REJECTED' ? 'owed' : 'quiet'}>
    {a.status === 'PENDING_APPROVAL' && <>{can('approve') && <><Small solid disabled={busy} onClick={() => decide(a, true)}>Approve</Small><Small disabled={busy} onClick={() => decide(a, false)}>Decline</Small></>}<Small disabled={busy} onClick={() => withdraw(a)}>Withdraw</Small></>}</AwardCard>);
  return (
    <FitPage title="Bursaries & scholarships" subtitle="Discounts, sponsors, credit notes and write-offs" action={(can('collect') || can('bill')) ? <button type="button" onClick={() => setReq(true)} className="h-10 px-3 rounded-xl bg-[#12261F] text-white text-sm font-semibold flex items-center gap-1"><Plus size={16} />Request</button> : null}>
      {err && <Notice tone="bad">{err}</Notice>}{note && <Notice tone="good">{note}</Notice>}
      <div className="flex gap-1.5 mb-3 overflow-x-auto">{[['pending', `Waiting (${pending.length})`], ['awards', 'Standing awards'], ['history', 'History']].map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={`h-9 px-3 rounded-full text-sm font-semibold border whitespace-nowrap ${tab === k ? 'bg-[#12261F] text-white border-[#12261F]' : 'bg-white border-[#E3DBB8]'}`}>{l}</button>)}</div>
      {adj === null ? <LoadingBlock /> : tab === 'pending' ? (!pending.length ? <EmptyBlock>Nothing is waiting for approval.</EmptyBlock> : pending.map((a) => <AdjCard key={a.id} a={a} />))
        : tab === 'history' ? (!past.length ? <EmptyBlock>No past adjustments.</EmptyBlock> : past.map((a) => <AdjCard key={a.id} a={a} />))
        : (<>{can('approve') && <button type="button" onClick={() => setAw(true)} className="w-full h-11 mb-3 rounded-xl border border-[#1F6B45] text-[#1F6B45] font-semibold">+ Record a standing award</button>}
          {!(awards || []).length ? <EmptyBlock>No standing awards. Record one when a sponsor commits to a learner for a term or a year.</EmptyBlock> : awards.map((w) => (
            <div key={w.id} className="mb-3"><AwardCard kind={w.award_type === 'BURSARY' ? 'Bursary' : 'Scholarship'} title={w.sponsor_name || 'No sponsor named'}
              sub={`${names[w.student_id] || 'Student'} · ${w.academic_year} · ${w.scope === 'ANNUAL' ? 'whole year' : 'one term'}`} amountText={w.value_type === 'PERCENT' ? `${Number(w.value)}%` : M(w.value)} state={w.status.toLowerCase()} tone={w.status === 'ACTIVE' ? 'in' : 'quiet'}>
              {w.status === 'ACTIVE' && can('bill') && <Small solid disabled={busy} onClick={() => setApply(w)}>Apply to an invoice</Small>}</AwardCard></div>))}</>)}
      {req && <RequestSheet ctx={ctx} onClose={() => setReq(false)} onDone={done} />}
      {aw && <AwardSheet ctx={ctx} onClose={() => setAw(false)} onDone={done} />}
      {apply && <ApplySheet ctx={ctx} award={apply} onClose={() => setApply(null)} onDone={done} />}
    </FitPage>);
}
