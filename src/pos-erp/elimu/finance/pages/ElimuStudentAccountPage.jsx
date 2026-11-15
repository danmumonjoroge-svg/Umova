// One student's fee account: what was billed, paid, discounted, owed, held as credit; the chronological statement; follow-ups; reminders.
// Statement/PDF/CSV use the POS report engine. Amendments and cancellations are database-gated and always ask for a reason.
import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useElimuFinance } from '../hooks/useElimuFinance';
import { FitPage, LoadingBlock, Notice, MiniStats, DataCard, Pill, TextBtn, inputCls, saveBtnCls, formCard } from '../../../components/CardKit';
import { buildReportPdf, savePdf, sharePdf, reportFileName } from '../../../utils/reportPdf';
import { statementReport } from '../receipts/receiptReport';
import { reportToCsv } from '../reports/reportBuilders';
import { fromDb, formatMoney } from '../utils/money';
import { studentViewWithCopy } from '../offline/feeOfflineQueue';
import { buildVars } from '../../communication/finance/financeComm';
import MessageComposer from '../components/MessageComposer';

const niceDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const STATUS_TONE = { PAID: 'good', PARTIALLY_PAID: 'warn', ISSUED: 'neutral', CANCELLED: 'bad' };

export default function ElimuStudentAccountPage({ studentId: propId }) {
  const ctx = useElimuFinance(); const { api, businessId, tenantId, can } = ctx;
  const studentId = propId || useParams().studentId;
  const [v, setV] = useState(null); const [invoices, setInvoices] = useState([]); const [followups, setFollowups] = useState([]);
  const [err, setErr] = useState(null); const [note, setNote] = useState(''); const [reason, setReason] = useState(''); const [compose, setCompose] = useState(false);

  const load = useCallback(async () => {
    try {
      setErr(null);
      const view = await studentViewWithCopy({ api, tenantId, businessId, studentId, statementLimit: 100 }); setV(view);
      if (!view.fromCache) {
        setInvoices(await api.list('elimu_fin_invoices', businessId, { filters: { student_id: studentId }, order: { col: 'due_date', asc: false }, limit: 50 }));
        setFollowups(await api.list('elimu_fin_followups', businessId, { filters: { student_id: studentId }, order: { col: 'created_at', asc: false }, limit: 20 }));
      }
    } catch (e) { setErr(e.message); }
  }, [api, tenantId, businessId, studentId]);
  useEffect(() => { if (ctx.ready) load(); }, [ctx.ready, load]);

  const run = (fn) => async () => { try { setErr(null); await fn(); await load(); } catch (e) { setErr(e.message); } };
  const needReason = () => { if (reason.trim().length < 3) throw new Error('Type a reason first (at least 3 characters).'); return reason.trim(); };
  if (!ctx.ready || !v) return err ? <FitPage title="Student account"><Notice tone="bad">{err}</Notice></FitPage> : <LoadingBlock />;

  const a = v.account; const s = a.student; const bal = fromDb(a.current_balance);
  const report = statementReport({ school: ctx.school, account: a, rows: v.statement });
  const pdf = () => buildReportPdf(report, { business: ctx.school });
  const vars = buildVars({ school: ctx.school, student: s, guardian: { name: s.guardian_name }, balanceCents: bal });

  return (
    <FitPage title={s.name} subtitle={`${s.admission_no} - ${s.class_name || ''} ${s.stream_name || ''}`}>
      {v.fromCache && <Notice tone="warn">Saved copy{v.savedAt ? ` from ${new Date(v.savedAt).toLocaleString('en-KE')}` : ''}. Editing is disabled until you are online.</Notice>}
      {err && <Notice tone="bad">{err}</Notice>}
      <MiniStats items={[{ label: bal > 0 ? 'Balance owed' : bal < 0 ? 'Credit held' : 'Balance', value: formatMoney(Math.abs(bal)) }, { label: 'Billed', value: formatMoney(fromDb(a.billed)) }, { label: 'Paid', value: formatMoney(fromDb(a.payments)) },
        { label: 'Outstanding', value: formatMoney(fromDb(a.outstanding)) }, { label: 'Arrears (past due)', value: formatMoney(fromDb(a.arrears)) }, { label: 'Credit available', value: formatMoney(fromDb(a.credit_available)) }]} />
      <div className="text-xs text-[#68756D] mb-2">Discounts {formatMoney(fromDb(a.discounts))} - Scholarships {formatMoney(fromDb(a.scholarships))} - Bursaries {formatMoney(fromDb(a.bursaries))} - Refunds {formatMoney(fromDb(a.refunds))} - Reversals {formatMoney(fromDb(a.reversals))}. A credit balance is money the school holds for the family; it is not income.</div>
      {a.next_installment && <Notice tone="neutral">Next instalment: {formatMoney(fromDb(a.next_installment.remaining))} due {niceDate(a.next_installment.due_date)}.</Notice>}
      <div className="flex gap-2 flex-wrap mb-3">
        <TextBtn onClick={run(async () => savePdf(pdf(), reportFileName({ ...report, title: `statement-${s.admission_no}` }), 'Fee statement'))}>Statement PDF</TextBtn>
        <TextBtn onClick={run(async () => sharePdf(pdf(), reportFileName({ ...report, title: `statement-${s.admission_no}` }), 'Fee statement'))}>Share</TextBtn>
        <TextBtn onClick={() => { const b = new Blob([reportToCsv(report)], { type: 'text/csv;charset=utf-8' }); const u = URL.createObjectURL(b); Object.assign(document.createElement('a'), { href: u, download: `statement-${s.admission_no}.csv` }).click(); URL.revokeObjectURL(u); }}>Excel (CSV)</TextBtn>
        {bal > 0 && !v.fromCache && <TextBtn onClick={() => setCompose(true)}>Send balance reminder</TextBtn>}
        {s.guardian_phone && <a className="underline text-sm self-center" href={`tel:${s.guardian_phone}`}>Call {s.guardian_name || 'guardian'}</a>}
      </div>
      {compose && <MessageComposer ctx={ctx} purpose="ELIMU_BALANCE_REMINDER" vars={vars} contact={{ phone: s.guardian_phone, email: s.guardian_email }} studentId={studentId} reference={{ type: 'ELIMU_ACCOUNT', id: studentId, label: 'Balance reminder' }} onClose={() => setCompose(false)} />}

      {!v.fromCache && <>
        <div className="font-semibold mt-2 mb-1">Invoices</div>
        {invoices.map(i => (<DataCard key={i.id} title={`${i.invoice_no} - ${i.term || i.kind}`} subtitle={`${i.academic_year || ''} - due ${niceDate(i.due_date)}`} pill={<Pill tone={STATUS_TONE[i.status]}>{i.status.replace('_', ' ').toLowerCase()}</Pill>}
          metrics={[{ label: 'Total', value: formatMoney(fromDb(i.total)) }, { label: 'Settled', value: formatMoney(fromDb(i.settled)) }, { label: 'Owing', value: formatMoney(fromDb(i.outstanding)) }]}
          actions={can('bill') && i.status !== 'CANCELLED' ? [{ label: 'Cancel invoice', onClick: run(async () => { await api.cancelInvoice(i.id, needReason()); setReason(''); }) }] : []} />))}
        {can('bill') && <input className={inputCls + ' my-2'} placeholder="Reason (needed to cancel or amend an invoice)" value={reason} onChange={e => setReason(e.target.value)} />}
        <div className="font-semibold mt-2 mb-1">Statement</div>
        {v.statement.slice().reverse().map(r => (<div key={r.seq} className="flex justify-between text-sm border-b py-1"><span>{niceDate(r.entry_date)} - {r.description || r.entry_type}</span>
          <span>{fromDb(r.debit) ? `+${formatMoney(fromDb(r.debit))}` : `-${formatMoney(fromDb(r.credit))}`} <b>{formatMoney(fromDb(r.balance))}</b></span></div>))}
        {!v.complete && <div className="text-xs">Showing the most recent entries. Download the statement for the full list.</div>}
        <div className="font-semibold mt-3 mb-1">Follow-ups</div>
        {followups.map(f => (<div key={f.id} className="text-sm border-b py-1">{niceDate(f.created_at)} - <b>{f.action_type.replace('_', ' ').toLowerCase()}</b> {f.outcome || f.notes} {f.promise_date ? `(promised ${niceDate(f.promise_date)})` : ''}</div>))}
        {(can('bill') || can('collect')) && (<div className={formCard}><input className={inputCls + ' mb-2'} placeholder="Note what happened (call, promise, meeting...)" value={note} onChange={e => setNote(e.target.value)} />
          <button className={saveBtnCls} disabled={note.trim().length < 3} onClick={run(async () => { await api.recordFollowup(businessId, studentId, { action: 'NOTE', notes: note.trim() }); setNote(''); })}>Save note</button></div>)}
      </>}
    </FitPage>
  );
}
