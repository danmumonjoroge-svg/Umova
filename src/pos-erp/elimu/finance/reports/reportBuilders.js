// Finance reports as DATA in the POS report shape (see utils/reportPdf.js), so the existing PDF engine draws them, plus CSV export.
// EXCEL: the POS has no .xlsx library. CSV (UTF-8 with BOM) opens directly in Excel; true .xlsx is a documented gap.
// All numbers come from the paged server reports (E008); nothing here loads whole history.
import { fromDb, formatMoney } from '../utils/money';

const kes = (v) => formatMoney(fromDb(v));
const niceDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export function debtorsReport(rows, { period, filtersNote } = {}) {
  const total = rows.reduce((s, r) => s + fromDb(r.outstanding), 0);
  return { title: 'FEE DEBTORS', subtitle: filtersNote || 'Students with an outstanding fee balance', period: period || '', orientation: 'landscape',
    summary: [{ label: 'Students listed', value: String(rows.length) }, { label: 'Outstanding (listed)', value: formatMoney(total) }],
    sections: [{ heading: 'Debtors', columns: [{ key: 'adm', label: 'Adm no', w: 1.2 }, { key: 'name', label: 'Student', w: 3 }, { key: 'cls', label: 'Class', w: 1.5 }, { key: 'guardian', label: 'Guardian', w: 2.5 },
      { key: 'phone', label: 'Phone', w: 1.8 }, { key: 'billed', label: 'Billed', align: 'right', w: 1.6 }, { key: 'paid', label: 'Paid', align: 'right', w: 1.6 }, { key: 'owed', label: 'Outstanding', align: 'right', w: 1.8 },
      { key: 'days', label: 'Days late', align: 'right', w: 1 }, { key: 'last', label: 'Last payment', w: 1.6 }, { key: 'next', label: 'Next instalment', w: 1.6 }],
      rows: rows.map(r => ({ adm: r.admission_no, name: r.student_name, cls: [r.class_name, r.stream_name].filter(Boolean).join(' '), guardian: r.guardian_name || '', phone: r.guardian_phone || '',
        billed: kes(r.total_billed), paid: kes(r.total_paid), owed: kes(r.outstanding), days: r.days_overdue ? String(r.days_overdue) : '-', last: niceDate(r.last_payment_date), next: niceDate(r.next_installment_due) })) }],
    footnote: 'An outstanding balance is not an accusation: many families are on agreed arrangements. Check follow-up notes and payment plans before contacting.' };
}

export function agingReport(a) {
  const B = [['not_yet_due', 'Not yet due'], ['days_1_30', '1-30 days'], ['days_31_60', '31-60 days'], ['days_61_90', '61-90 days'], ['over_90', 'Over 90 days']];
  return { title: 'DEBTORS AGEING', subtitle: `As at ${niceDate(a.as_of)}`, summary: [{ label: 'Total outstanding', value: kes(a.total.amount) }, { label: 'Students', value: String(a.total.students) }],
    sections: [{ heading: 'By age of invoice (days past due date)', columns: [{ key: 'b', label: 'Age', w: 3 }, { key: 'n', label: 'Students', align: 'right', w: 1 }, { key: 'a', label: 'Amount', align: 'right', w: 2 }],
      rows: [...B.map(([k, l]) => ({ b: l, n: String(a[k].students), a: kes(a[k].amount) })), { b: 'Total', n: String(a.total.students), a: kes(a.total.amount), _kind: 'total' }] }] };
}

export function collectionsReport(rows, { from, to, group }) {
  const tot = rows.reduce((s, r) => s + fromDb(r.net), 0);
  return { title: 'FEE COLLECTIONS', subtitle: `By ${String(group).toLowerCase()}`, period: `${niceDate(from)} to ${niceDate(to)}`,
    summary: [{ label: 'Net collected (confirmed)', value: formatMoney(tot) }],
    sections: [{ heading: 'Collections', note: 'Confirmed payments only. Pending and failed payments are never counted. "Reversed" is shown for information and is not in the net.',
      columns: [{ key: 'b', label: String(group), w: 3 }, { key: 'n', label: 'Payments', align: 'right', w: 1 }, { key: 'c', label: 'Collected', align: 'right', w: 2 }, { key: 'r', label: 'Reversed', align: 'right', w: 2 }],
      rows: [...rows.map(r => ({ b: r.bucket, n: String(r.payments), c: kes(r.collected), r: fromDb(r.reversed) ? kes(r.reversed) : '' })), { b: 'Total', n: String(rows.reduce((s, r) => s + Number(r.payments), 0)), c: formatMoney(tot), r: '', _kind: 'total' }] }] };
}

export function feeSummaryReport(s, label = 'All periods') {
  const adj = s.adjustments || {};
  return { title: 'FEES BILLED, COLLECTED AND OUTSTANDING', subtitle: label, summary: [{ label: 'Total billed', value: kes(s.total_billed) }, { label: 'Settled', value: kes(s.settled) }, { label: 'Outstanding', value: kes(s.outstanding) }],
    sections: [{ heading: 'Summary', columns: [{ key: 'l', label: 'Item', w: 4 }, { key: 'v', label: 'Amount', align: 'right', w: 2 }], rows: [
      { l: 'Gross charges', v: kes(s.gross_charges) }, { l: 'Discounts on invoices', v: kes(s.invoice_discounts) }, { l: 'Total billed', v: kes(s.total_billed), _kind: 'total' },
      { l: 'Settled (paid or covered)', v: kes(s.settled) }, { l: 'Outstanding', v: kes(s.outstanding), _kind: 'total' },
      { l: 'Discounts granted (approved)', v: kes(adj.DISCOUNT || 0) }, { l: 'Scholarships', v: kes(adj.SCHOLARSHIP || 0) }, { l: 'Bursaries', v: kes(adj.BURSARY || 0) }, { l: 'Credit notes', v: kes(adj.CREDIT_NOTE || 0) }, { l: 'Write-offs', v: kes(adj.WRITE_OFF || 0) }] }] };
}

export function budgetReport(b, { name }) {
  return { title: 'BUDGET VERSUS ACTUAL', subtitle: name, summary: [{ label: 'Budget', value: kes(b.total_budget) }, { label: 'Actual', value: kes(b.total_actual) }, { label: 'Variance', value: kes(b.total_variance) }, { label: 'Variance %', value: b.total_variance_pct == null ? '-' : `${b.total_variance_pct}%` }],
    sections: [{ heading: 'By department and category', note: b.note, columns: [{ key: 'd', label: 'Department', w: 2 }, { key: 'c', label: 'Category', w: 3 }, { key: 'b', label: 'Budget', align: 'right', w: 2 }, { key: 'a', label: 'Actual', align: 'right', w: 2 }, { key: 'v', label: 'Variance', align: 'right', w: 2 }, { key: 'p', label: '%', align: 'right', w: 1 }],
      rows: b.lines.map(l => ({ d: l.department || 'All', c: l.category, b: kes(l.budget), a: kes(l.actual), v: kes(l.variance), p: l.variance_pct == null ? '-' : `${l.variance_pct}%` })) }] };
}

/** Flatten any report spec to CSV (UTF-8 BOM so Excel reads KES text and names correctly). */
export function reportToCsv(report) {
  const esc = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const out = [[report.title], [report.subtitle || ''], [report.period || ''], []];
  for (const sec of report.sections || []) {
    if (sec.heading) out.push([sec.heading]);
    if (sec.columns?.length) { out.push(sec.columns.map(c => c.label)); for (const r of sec.rows || []) out.push(sec.columns.map(c => r[c.key])); }
    out.push([]);
  }
  return '\uFEFF' + out.map(r => r.map(esc).join(',')).join('\r\n');
}
