// Cashier collection. Financial correctness first, decoration last:
//  - a payment is shown as RECEIVED only when the server says CONFIRMED (receipt number present). Everything else says "awaiting confirmation".
//  - the same button press can never create two payments (client_reference is generated once per attempt and reused on retry).
//  - offline, the only thing possible is a DRAFT. It is labelled "not yet recorded" and can be submitted later.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, Smartphone, Landmark, CircleEllipsis, Search } from 'lucide-react';
import { useElimuFinance } from '../hooks/useElimuFinance';
import { FitPage, SearchBox, LoadingBlock, EmptyBlock, Notice, Pill, inputCls, saveBtnCls, formCard, MiniStats, TextBtn } from '../../../components/CardKit';
import { toCents, toDecimalString, formatMoney, fromDb, MoneyError } from '../utils/money';
import { isNetworkFailure, isOfflineNow } from '../../../offline/netErrors';
import { newUuid } from '../../../offline/idGenerator';
import { createDraftQueue, draftLabel, draftAcknowledgementText, studentViewWithCopy } from '../offline/feeOfflineQueue';
import ReceiptActions from '../components/ReceiptActions';

const METHODS = [{ key: 'CASH', label: 'Cash', icon: Banknote }, { key: 'MPESA', label: 'M-Pesa', icon: Smartphone }, { key: 'BANK', label: 'Bank', icon: Landmark }, { key: 'CHEQUE', label: 'Cheque', icon: CircleEllipsis }];
const queue = createDraftQueue();

export default function ElimuCollectPage() {
  const ctx = useElimuFinance();
  const { api, businessId, tenantId, staffId, can } = ctx;
  const [q, setQ] = useState(''); const [results, setResults] = useState([]); const [student, setStudent] = useState(null);
  const [view, setView] = useState(null); const [session, setSession] = useState(null); const [inbox, setInbox] = useState([]);
  const [form, setForm] = useState({ method: 'CASH', amount: '', ref: '', bank: '', slip: '', payer: '', phone: '' });
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null); const [done, setDone] = useState(null); const [drafts, setDrafts] = useState([]);
  const attempt = useRef(newUuid());                          // one id per payment attempt; reused if the cashier retries after an error

  const loadDrafts = useCallback(async () => setDrafts(await queue.list(tenantId)), [tenantId]);
  useEffect(() => { if (tenantId) loadDrafts(); }, [tenantId, loadDrafts]);
  useEffect(() => { if (businessId && can('collect')) api.c2bInbox(businessId, 20).then(setInbox).catch(() => setInbox([])); }, [businessId, api, can, done]);

  const search = async (text) => {
    setQ(text); if (text.trim().length < 2) return setResults([]);
    try {
      const t = text.trim().replace(/[%,()]/g, '');
      const { data } = await (await import('../../../services/posSupabaseClient')).posSupabase.from('elimu_fin_students').select('student_id,admission_no,full_name,class_name,guardian_name,guardian_phone,guardian_email,status')
        .eq('business_id', businessId).or(`admission_no.ilike.%${t}%,full_name.ilike.%${t}%`).limit(10);
      setResults(data || []);
    } catch { setResults([]); }
  };
  const pick = async (s) => {
    setStudent(s); setResults([]); setQ(''); setDone(null); setMsg(null); attempt.current = newUuid();
    try { setView(await studentViewWithCopy({ api, tenantId, businessId, studentId: s.student_id, statementLimit: 20 })); }
    catch (e) { setView(null); setMsg({ tone: 'bad', text: e.message }); }
  };

  const openSession = async () => { try { const r = await api.openSession(businessId, 0); setSession(r.session_id); } catch (e) { setMsg({ tone: 'bad', text: e.message }); } };

  const parsed = useMemo(() => { try { return { cents: toCents(form.amount) }; } catch (e) { return { error: e instanceof MoneyError ? e.message : 'Invalid amount.' }; } }, [form.amount]);
  const canSubmit = student && parsed.cents > 0 && !busy && (form.method === 'CASH' || form.ref.trim());

  const submit = async () => {
    setBusy(true); setMsg(null); setDone(null);
    const p = { method: form.method, amountCents: parsed.cents, transactionRef: form.ref || null, bankAccount: form.bank || null, depositSlipRef: form.slip || null, payerName: form.payer || null, payerPhone: form.phone || null, clientReference: attempt.current };
    try {
      if (isOfflineNow()) throw Object.assign(new TypeError('Failed to fetch'));
      const r = await api.recordPayment(businessId, student.student_id, p);
      attempt.current = newUuid();
      if (r.status === 'CONFIRMED') {
        const receipt = await api.receiptData(r.payment_id); setDone({ kind: 'CONFIRMED', r, receipt });
      } else setDone({ kind: 'PENDING', r });
      setForm(f => ({ ...f, amount: '', ref: '', slip: '' })); setView(await studentViewWithCopy({ api, tenantId, businessId, studentId: student.student_id, statementLimit: 20 }));
    } catch (e) {
      if (isNetworkFailure(e)) {
        const d = await queue.saveDraft({ tenantId, businessId, staffId, studentId: student.student_id, studentLabel: `${student.full_name} (${student.admission_no})`, method: form.method,
          amountCents: parsed.cents, transactionRef: form.ref || null, bankAccount: form.bank || null, depositSlipRef: form.slip || null, payerName: form.payer || null, payerPhone: form.phone || null });
        await loadDrafts(); setDone({ kind: 'DRAFT', draft: d }); setForm(f => ({ ...f, amount: '', ref: '', slip: '' })); attempt.current = newUuid();
      } else setMsg({ tone: 'bad', text: e.message });
    } finally { setBusy(false); }
  };
  const submitDrafts = async () => { setBusy(true); try { await queue.submitAll(tenantId, api); await loadDrafts(); } finally { setBusy(false); } };

  const acct = view?.account; const bal = acct ? fromDb(acct.current_balance) : 0;
  if (!ctx.ready) return <LoadingBlock />;
  if (!can('collect')) return <FitPage title="Collect fees"><Notice tone="warn">You do not have permission to record payments. Ask the school owner or bursar.</Notice></FitPage>;

  return (
    <FitPage title="Collect fees" subtitle="Record a payment against a student's account">
      {!session && <div className={formCard}><div className="text-sm mb-2">Cash is counted against a cashier session so the till can be reconciled at the end of the shift.</div><button className={saveBtnCls} onClick={openSession}>Open my cashier session</button></div>}
      <SearchBox value={q} onChange={search} placeholder="Admission number or student name" />
      {results.map(s => (<button key={s.student_id} onClick={() => pick(s)} className="w-full text-left border rounded-lg p-2 my-1 bg-white"><Search size={14} className="inline mr-1" />{s.full_name} <span className="text-xs text-[#68756D]">({s.admission_no}, {s.class_name || 'no class'}){s.status !== 'ACTIVE' ? ` - ${s.status.toLowerCase()}` : ''}</span></button>))}

      {student && (<div className={formCard}>
        <div className="font-semibold">{student.full_name} <span className="text-xs">({student.admission_no})</span></div>
        {view?.fromCache && <Notice tone="warn">Showing a copy saved on this phone{view.savedAt ? ` at ${new Date(view.savedAt).toLocaleTimeString('en-KE')}` : ''}. Balances may have changed.</Notice>}
        {acct && <MiniStats items={[{ label: bal > 0 ? 'Owes' : bal < 0 ? 'Credit' : 'Balance', value: formatMoney(Math.abs(bal)) }, { label: 'Arrears (past due)', value: formatMoney(fromDb(acct.arrears)) }, { label: 'Paid so far', value: formatMoney(fromDb(acct.payments)) }]} />}
        <div className="flex gap-2 my-2 flex-wrap">{METHODS.map(m => (<button key={m.key} onClick={() => setForm({ ...form, method: m.key })} className={`px-3 py-2 rounded-lg border text-sm ${form.method === m.key ? 'bg-[#1F6B45] text-white' : 'bg-white'}`}><m.icon size={14} className="inline mr-1" />{m.label}</button>))}</div>
        <input className={inputCls + ' mb-2'} inputMode="decimal" placeholder="Amount (KES)" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} aria-label="Amount" />
        {parsed.error && form.amount && <div className="text-xs text-red-700 mb-1">{parsed.error}</div>}
        {form.method !== 'CASH' && <input className={inputCls + ' mb-2'} placeholder={form.method === 'MPESA' ? 'M-Pesa code (e.g. QGH7K2L9MN)' : 'Bank / cheque reference'} value={form.ref} onChange={e => setForm({ ...form, ref: e.target.value })} autoCapitalize="characters" aria-label="Reference" />}
        {form.method === 'BANK' && <><input className={inputCls + ' mb-2'} placeholder="Bank account" value={form.bank} onChange={e => setForm({ ...form, bank: e.target.value })} /><input className={inputCls + ' mb-2'} placeholder="Deposit slip reference (optional)" value={form.slip} onChange={e => setForm({ ...form, slip: e.target.value })} /></>}
        <input className={inputCls + ' mb-2'} placeholder="Paid by (optional)" value={form.payer} onChange={e => setForm({ ...form, payer: e.target.value })} />
        {form.method === 'MPESA' && <Notice tone="neutral">A code that Safaricom has reported to the school's Paybill is confirmed at once. A code that cannot be verified is saved as <b>awaiting confirmation</b> and counts only after the bursar confirms it.</Notice>}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <button className={saveBtnCls + ' w-full'} disabled={!canSubmit} onClick={submit}>{busy ? 'Saving...' : 'Record payment'}</button>
      </div>)}

      {done?.kind === 'CONFIRMED' && (<div className={formCard}><Notice tone="good">Received. Receipt {done.r.receipt_no}. {fromDb(done.r.unallocated) > 0 ? `${formatMoney(fromDb(done.r.unallocated))} is held as credit.` : ''}</Notice>
        <ReceiptActions ctx={ctx} receipt={done.receipt} guardian={{ name: student?.guardian_name, phone: student?.guardian_phone, email: student?.guardian_email }} studentId={student?.student_id} /></div>)}
      {done?.kind === 'PENDING' && <Notice tone="warn">Saved, but <b>not yet received</b>: it needs confirmation by an approver before it counts. No receipt has been issued.</Notice>}
      {done?.kind === 'DRAFT' && (<div className={formCard}><Notice tone="warn">No connection. Saved as a <b>draft on this phone</b> - it is not recorded and there is no receipt yet. Submit it when you are online.</Notice>
        <pre className="text-xs whitespace-pre-wrap">{draftAcknowledgementText(done.draft, ctx.school?.name)}</pre></div>)}

      {drafts.length > 0 && (<div className={formCard}><div className="font-semibold mb-1">Drafts on this phone</div>
        {drafts.map(d => { const l = draftLabel(d); return (<div key={d.id} className="flex justify-between text-sm border-b py-1"><span>{d.studentLabel} - {formatMoney(d.amountCents)} ({d.method})</span><Pill tone={l.tone}>{l.text}</Pill>
          {['DRAFT', 'FAILED'].includes(d.state) && <TextBtn onClick={async () => { await queue.discard(d.id); loadDrafts(); }}>Discard</TextBtn>}</div>); })}
        {drafts.some(d => d.state === 'DRAFT') && <button className={saveBtnCls + ' mt-2'} disabled={busy || isOfflineNow()} onClick={submitDrafts}>Submit drafts now</button>}</div>)}

      {inbox.length > 0 && (<div className={formCard}><div className="font-semibold mb-1">Paybill payments not yet applied</div>
        {inbox.map(i => (<div key={i.c2b_id} className="text-sm border-b py-1 flex justify-between"><span>{i.trans_id} - {formatMoney(fromDb(i.left_amount))} left {i.payer_name ? `from ${i.payer_name}` : ''}</span>
          {i.suggested_student_id ? <TextBtn onClick={() => { pick({ student_id: i.suggested_student_id, admission_no: i.suggested_admission_no, full_name: i.suggested_name }); setForm(f => ({ ...f, method: 'MPESA', ref: i.trans_id, amount: toDecimalString(fromDb(i.left_amount)) })); }}>Use for {i.suggested_admission_no}</TextBtn> : <span className="text-xs">no matching admission number</span>}</div>))}</div>)}
      {!student && !drafts.length && !inbox.length && <EmptyBlock>Search for a student to begin.</EmptyBlock>}
    </FitPage>
  );
}
