// The approver's queue: payments awaiting confirmation, adjustments, reversals/refunds, payment plans, cashier sessions.
// The DATABASE enforces maker-checker (you cannot approve what you requested) and permissions; this page only presents and asks for reasons.
import React, { useCallback, useEffect, useState } from 'react';
import { useElimuFinance } from '../hooks/useElimuFinance';
import { FitPage, LoadingBlock, EmptyBlock, Notice, DataCard, inputCls } from '../../../components/CardKit';
import { fromDb, formatMoney } from '../utils/money';

export default function ElimuApprovalsPage() {
  const ctx = useElimuFinance(); const { api, businessId, can } = ctx;
  const [q, setQ] = useState(null); const [err, setErr] = useState(null); const [note, setNote] = useState(''); const [busy, setBusy] = useState(null);
  const load = useCallback(async () => { try { setErr(null); setQ(await api.approvalQueue(businessId)); } catch (e) { setErr(e.message); setQ({}); } }, [api, businessId]);
  useEffect(() => { if (ctx.ready && can('approve')) load(); }, [ctx.ready, can, load]);
  if (!ctx.ready) return <LoadingBlock />;
  if (!can('approve')) return <FitPage title="Approvals"><Notice tone="gold">Only an authorised approver can open this page.</Notice></FitPage>;

  const act = (id, fn, needsNote) => async () => {
    if (needsNote && note.trim().length < 3) return setErr('Type a reason first (at least 3 characters).');
    setBusy(id); try { setErr(null); await fn(); setNote(''); await load(); } catch (e) { setErr(e.message); } finally { setBusy(null); }
  };
  const Pair = ({ id, yes, no, noNeedsNote = true, yesLabel = 'Approve', noLabel = 'Decline' }) => (
    <div className="flex gap-2"><button disabled={busy === id} className="px-3 min-h-[38px] rounded-lg bg-[#1F6B45] text-white text-sm" onClick={act(id, yes, false)}>{yesLabel}</button>
      {no && <button disabled={busy === id} className="px-3 min-h-[38px] rounded-lg border text-sm" onClick={act(id, no, noNeedsNote)}>{noLabel}</button>}</div>);
  const list = (arr, render) => (arr?.length ? arr.map(render) : <EmptyBlock>Nothing waiting.</EmptyBlock>);
  const M = (v) => formatMoney(fromDb(v));

  return (
    <FitPage title="Approvals" subtitle="Nothing here has changed anyone's balance yet">
      {err && <Notice tone="bad">{err}</Notice>}
      <input className={inputCls + ' mb-3'} placeholder="Reason / note (required to decline)" value={note} onChange={e => setNote(e.target.value)} />
      {!q ? <LoadingBlock /> : <>
        <h3 className="font-semibold mt-2">Payments awaiting confirmation</h3>
        {list(q.payments, p => (<DataCard key={p.id} title={`${p.student} (${p.admission_no})`} subtitle={`${p.method} ${p.ref || ''} - ${p.date}`} big={M(p.amount)}>
          <div className="text-xs mb-1">Confirm only after you have seen the money on the bank statement / M-Pesa statement. You cannot confirm a payment you recorded yourself.</div>
          <Pair id={p.id} yes={() => api.confirmPayment(p.id, p.method === 'BANK' ? 'BANK_STATEMENT' : 'MANUAL_ATTESTATION', note || null)} no={() => api.failPayment(p.id, note)} yesLabel="Confirm received" noLabel="Not received" /></DataCard>))}
        <h3 className="font-semibold mt-3">Adjustments (discounts, scholarships, bursaries, credit notes)</h3>
        {list(q.adjustments, a => (<DataCard key={a.id} title={`${a.student} - ${a.kind.toLowerCase().replace('_', ' ')}`} subtitle={a.reason} big={M(a.amount)}><Pair id={a.id} yes={() => api.decideAdjustment(a.id, true, note || null)} no={() => api.decideAdjustment(a.id, false, note)} /></DataCard>))}
        <h3 className="font-semibold mt-3">Reversals and refunds</h3>
        {list(q.corrections, c => (<DataCard key={c.id} title={`${c.student} - ${c.kind.toLowerCase().replace('_', ' ')}`} subtitle={c.reason} big={M(c.amount)}><Pair id={c.id} yes={() => api.decideCorrection(c.id, true, note || null)} no={() => api.decideCorrection(c.id, false, note)} /></DataCard>))}
        <h3 className="font-semibold mt-3">Payment arrangements</h3>
        {list(q.plans, p => (<DataCard key={p.id} title={p.student} subtitle={p.reason} big={M(p.total)}><Pair id={p.id} yes={() => api.decidePlan(p.id, true, note || null)} no={() => api.decidePlan(p.id, false, note)} /></DataCard>))}
        <h3 className="font-semibold mt-3">Closed cashier sessions</h3>
        {list(q.sessions, s => (<DataCard key={s.id} title={`Closed ${new Date(s.closed_at).toLocaleString('en-KE')}`} subtitle={fromDb(s.variance) === 0 ? 'Cash balanced' : `Variance ${M(s.variance)}`}><Pair id={s.id} yes={() => api.approveSession(s.id, note || null)} yesLabel="Approve handover" /></DataCard>))}
      </>}
    </FitPage>
  );
}
