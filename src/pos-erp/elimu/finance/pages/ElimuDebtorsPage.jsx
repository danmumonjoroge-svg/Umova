// Debtors and arrears. Server-paged (50 at a time). Ageing across the school. Tone: an outstanding balance is not misconduct.
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useElimuFinance } from '../hooks/useElimuFinance';
import { FitPage, LoadingBlock, EmptyBlock, Notice, MiniStats, DataCard, TextBtn, inputCls, formCard } from '../../../components/CardKit';
import { buildReportPdf, savePdf, reportFileName } from '../../../utils/reportPdf';
import { debtorsReport, agingReport, reportToCsv } from '../reports/reportBuilders';
import { toCents, fromDb, formatMoney } from '../utils/money';
import { buildVars } from '../../communication/finance/financeComm';
import MessageComposer from '../components/MessageComposer';
import { AgeingBar, DebtorCard } from '../../ui/cards/index.js';

const PAGE = 50;
export default function ElimuDebtorsPage() {
  const ctx = useElimuFinance(); const { api, businessId, can } = ctx; const nav = useNavigate();
  const [f, setF] = useState({ classId: '', minDays: '', minAmount: '' }); const [rows, setRows] = useState(null); const [aging, setAging] = useState(null);
  const [page, setPage] = useState(0); const [err, setErr] = useState(null); const [msgFor, setMsgFor] = useState(null);

  const load = useCallback(async () => {
    try {
      setErr(null);
      const filt = { classId: f.classId || null, minDaysOverdue: f.minDays ? Number(f.minDays) : null, minOutstandingCents: f.minAmount ? toCents(f.minAmount) : null, limit: PAGE, offset: page * PAGE };
      const [r, a] = await Promise.all([api.debtors(businessId, filt), api.aging(businessId, { classId: f.classId || null })]); setRows(r); setAging(a);
    } catch (e) { setErr(e.message); setRows([]); }
  }, [api, businessId, f, page]);
  useEffect(() => { if (ctx.ready) load(); }, [ctx.ready, load]);

  if (!ctx.ready) return <LoadingBlock />;
  if (!(can('report') || can('bill'))) return <FitPage title="Debtors"><Notice tone="gold">You do not have permission to view debtors.</Notice></FitPage>;
  const total = rows?.[0]?.total_count ? Number(rows[0].total_count) : 0;
  const exportPdf = () => { const r = debtorsReport(rows); savePdf(buildReportPdf(r, { business: ctx.school }), reportFileName(r), 'Fee debtors'); };
  const exportCsv = () => { const b = new Blob([reportToCsv(debtorsReport(rows))], { type: 'text/csv;charset=utf-8' }); const u = URL.createObjectURL(b); Object.assign(document.createElement('a'), { href: u, download: 'fee-debtors.csv' }).click(); URL.revokeObjectURL(u); };

  return (
    <FitPage title="Fee debtors" subtitle="Who owes, how much, and since when">
      {err && <Notice tone="bad">{err}</Notice>}
      {aging && <AgeingBar totalText={formatMoney(fromDb(aging.total.amount))} buckets={[['Not yet due', aging.not_yet_due], ['1-30 days', aging.days_1_30], ['31-60 days', aging.days_31_60], ['61-90 days', aging.days_61_90], ['Over 90 days', aging.over_90]].map(([label, x]) => ({ label, value: fromDb(x.amount), text: formatMoney(fromDb(x.amount)) }))} />}
      <div className={formCard}><div className="flex gap-2 flex-wrap">
        <input className={inputCls} style={{ maxWidth: 160 }} placeholder="Min days overdue" inputMode="numeric" value={f.minDays} onChange={e => { setPage(0); setF({ ...f, minDays: e.target.value.replace(/\D/g, '') }); }} />
        <input className={inputCls} style={{ maxWidth: 160 }} placeholder="Min amount owing" inputMode="decimal" value={f.minAmount} onChange={e => { setPage(0); setF({ ...f, minAmount: e.target.value }); }} />
        <TextBtn onClick={exportPdf}>PDF</TextBtn><TextBtn onClick={exportCsv}>Excel (CSV)</TextBtn></div></div>
      {rows === null ? <LoadingBlock /> : rows.length === 0 ? <EmptyBlock>No students match.</EmptyBlock> : rows.map(r => (
        <div key={r.student_id} className="mb-3"><DebtorCard name={`${r.student_name} (${r.admission_no})`} meta={[r.class_name, r.stream_name].filter(Boolean).join(' ')} guardian={`${r.guardian_name || 'no guardian on file'} ${r.guardian_phone || ''}`.trim()}
          owedText={formatMoney(fromDb(r.outstanding))} billed={fromDb(r.total_billed)} paid={fromDb(r.total_paid)} billedText={formatMoney(fromDb(r.total_billed))} paidText={formatMoney(fromDb(r.total_paid))}
          days={Number(r.days_overdue) || 0} lastPayment={r.last_payment_date || ''} onClick={() => nav(`../account/${r.student_id}`)}
          actions={<>{r.guardian_phone && <TextBtn onClick={() => { window.location.href = `tel:${r.guardian_phone}`; }}>Call</TextBtn>}<TextBtn onClick={() => setMsgFor(r)}>Message</TextBtn></>} /></div>))}
      {msgFor && <MessageComposer ctx={ctx} purpose="ELIMU_BALANCE_REMINDER" studentId={msgFor.student_id} contact={{ phone: msgFor.guardian_phone, email: msgFor.guardian_email }}
        vars={buildVars({ school: ctx.school, student: { name: msgFor.student_name, admission_no: msgFor.admission_no, class_name: msgFor.class_name }, guardian: { name: msgFor.guardian_name }, balanceCents: fromDb(msgFor.outstanding) })}
        reference={{ type: 'ELIMU_ACCOUNT', id: msgFor.student_id, label: 'Balance reminder' }} onClose={() => setMsgFor(null)} />}
      <div className="flex justify-between mt-2 text-sm"><TextBtn disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</TextBtn><span>{total ? `${page * PAGE + 1}-${Math.min((page + 1) * PAGE, total)} of ${total}` : ''}</span><TextBtn disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Next</TextBtn></div>
    </FitPage>
  );
}
