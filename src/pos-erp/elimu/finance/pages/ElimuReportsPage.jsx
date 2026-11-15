// Finance reports. Every report is fetched PAGED/AGGREGATED from the server (E008), drawn with the POS report engine, and exportable as PDF or CSV.
import React, { useState } from 'react';
import { useElimuFinance } from '../hooks/useElimuFinance';
import { FitPage, Notice, LoadingBlock, TextBtn, inputCls, saveBtnCls, formCard } from '../../../components/CardKit';
import { buildReportPdf, savePdf, reportFileName } from '../../../utils/reportPdf';
import { collectionsReport, agingReport, feeSummaryReport, budgetReport, debtorsReport, reportToCsv } from '../reports/reportBuilders';
import { fromDb, formatMoney } from '../utils/money';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
const monthStart = () => today().slice(0, 8) + '01';

export default function ElimuReportsPage() {
  const ctx = useElimuFinance(); const { api, businessId, can } = ctx;
  const [from, setFrom] = useState(monthStart()); const [to, setTo] = useState(today()); const [group, setGroup] = useState('DAY');
  const [report, setReport] = useState(null); const [extra, setExtra] = useState(null); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  if (!ctx.ready) return <LoadingBlock />;
  if (!can('report')) return <FitPage title="Finance reports"><Notice tone="warn">You do not have permission to view finance reports.</Notice></FitPage>;

  const go = (fn) => async () => { setBusy(true); setErr(null); setExtra(null); try { setReport(await fn()); } catch (e) { setErr(e.message); setReport(null); } finally { setBusy(false); } };
  const R = {
    collections: go(async () => collectionsReport(await api.collections(businessId, from, to, group), { from, to, group })),
    aging: go(async () => agingReport(await api.aging(businessId))),
    fees: go(async () => feeSummaryReport(await api.feeSummary(businessId))),
    debtors: go(async () => debtorsReport(await api.debtors(businessId, { limit: 200 }), { filtersNote: 'First 200 by amount owing' })),
    ie: go(async () => { const x = await api.incomeExpenditure(businessId, from, to); setExtra(x.basis);
      return { title: 'INCOME AND EXPENDITURE', subtitle: 'Cash basis', period: `${from} to ${to}`, summary: [{ label: 'Net fees received', value: formatMoney(fromDb(x.net_fees_received)) }, { label: 'Expenditure', value: formatMoney(fromDb(x.expenditure)) }, { label: 'Surplus / (deficit)', value: formatMoney(fromDb(x.surplus_deficit)) }],
        sections: [{ heading: 'Expenditure by category', columns: [{ key: 'c', label: 'Category', w: 4 }, { key: 'a', label: 'Amount', align: 'right', w: 2 }], rows: x.expenditure_by_category.map(r => ({ c: r.category || 'Uncategorised', a: formatMoney(fromDb(r.amount)) })) }], footnote: x.basis }; }),
    budget: go(async () => { const bs = await api.list('elimu_fin_budgets', businessId, { order: { col: 'created_at', asc: false }, limit: 1 }); if (!bs.length) throw new Error('No budget has been prepared yet.'); return budgetReport(await api.budgetReport(bs[0].id), { name: bs[0].name }); }),
    owing: go(async () => { const l = await api.studentList(businessId, 'OUTSTANDING', null, 200, 0); return { title: 'STUDENTS WITH OUTSTANDING BALANCES', sections: [{ heading: 'Students', columns: [{ key: 'a', label: 'Adm no', w: 1 }, { key: 'n', label: 'Student', w: 3 }, { key: 'c', label: 'Class', w: 2 }, { key: 'b', label: 'Balance', align: 'right', w: 2 }], rows: l.map(r => ({ a: r.admission_no, n: r.student_name, c: r.class_name || '', b: formatMoney(fromDb(r.balance)) })) }] }; }),
    credit: go(async () => { const l = await api.studentList(businessId, 'CREDIT', null, 200, 0); return { title: 'STUDENTS WITH CREDIT BALANCES', subtitle: 'Money the school holds for families - a liability, not income', sections: [{ heading: 'Students', columns: [{ key: 'a', label: 'Adm no', w: 1 }, { key: 'n', label: 'Student', w: 3 }, { key: 'b', label: 'Credit held', align: 'right', w: 2 }], rows: l.map(r => ({ a: r.admission_no, n: r.student_name, b: formatMoney(Math.abs(fromDb(r.balance))) })) }] }; }),
  };
  const pdf = () => savePdf(buildReportPdf(report, { business: ctx.school }), reportFileName(report), report.title);
  const csv = () => { const b = new Blob([reportToCsv(report)], { type: 'text/csv;charset=utf-8' }); const u = URL.createObjectURL(b); Object.assign(document.createElement('a'), { href: u, download: `${reportFileName(report).replace(/\.pdf$/, '')}.csv` }).click(); URL.revokeObjectURL(u); };

  return (
    <FitPage title="Finance reports" subtitle="Figures come from confirmed records only">
      <div className={formCard}><div className="flex gap-2 flex-wrap items-end">
        <label className="text-xs">From<input type="date" className={inputCls} value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="text-xs">To<input type="date" className={inputCls} value={to} onChange={e => setTo(e.target.value)} /></label>
        <label className="text-xs">Group collections by<select className={inputCls} value={group} onChange={e => setGroup(e.target.value)}>{['DAY', 'WEEK', 'MONTH', 'YEAR', 'METHOD', 'CASHIER'].map(g => <option key={g}>{g}</option>)}</select></label></div>
        <div className="flex gap-2 flex-wrap mt-2">{[['collections', 'Collections'], ['aging', 'Debtors ageing'], ['debtors', 'Debtors'], ['fees', 'Billed / collected'], ['owing', 'Owing'], ['credit', 'Credit balances'], ['ie', 'Income & expenditure'], ['budget', 'Budget vs actual']].map(([k, l]) => (<button key={k} disabled={busy} className={saveBtnCls} onClick={R[k]}>{l}</button>))}</div></div>
      {err && <Notice tone="bad">{err}</Notice>}
      {report && (<div className={formCard}><div className="flex justify-between"><div><div className="font-semibold">{report.title}</div><div className="text-xs">{report.subtitle} {report.period}</div></div><div className="flex gap-2"><TextBtn onClick={pdf}>PDF</TextBtn><TextBtn onClick={csv}>Excel (CSV)</TextBtn></div></div>
        {(report.summary || []).map(s => <div key={s.label} className="text-sm flex justify-between"><span>{s.label}</span><b>{s.value}</b></div>)}
        {(report.sections || []).map((sec, i) => (<div key={i} className="mt-2 overflow-x-auto"><div className="font-medium">{sec.heading}</div>{sec.note && <div className="text-xs">{sec.note}</div>}
          <table className="w-full text-xs"><thead><tr>{(sec.columns || []).map(c => <th key={c.key} className={c.align === 'right' ? 'text-right' : 'text-left'}>{c.label}</th>)}</tr></thead>
            <tbody>{(sec.rows || []).map((r, j) => <tr key={j} className={r._kind === 'total' ? 'font-bold' : ''}>{sec.columns.map(c => <td key={c.key} className={c.align === 'right' ? 'text-right' : ''}>{r[c.key]}</td>)}</tr>)}</tbody></table></div>))}
        {extra && <div className="text-xs mt-2">{extra}</div>}{report.footnote && <div className="text-xs mt-2">{report.footnote}</div>}</div>)}
    </FitPage>
  );
}
