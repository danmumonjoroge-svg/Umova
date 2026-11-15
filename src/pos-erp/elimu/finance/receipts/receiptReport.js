// Receipts and statements, built as DATA in the POS report shape so the EXISTING engines draw them:
//   - buildReportPdf (jsPDF) for a real A4 PDF / save / share (utils/reportPdf)
//   - printDocument + businessHeaderHtml for browser/thermal printing (utils/printDocument, utils/businessHeader)
// No new document engine. School logo/name/contacts come from the school's lb_businesses row via the same header the POS uses.
import { printDocument, escapeHtml } from '../../../utils/printDocument';
import { businessHeaderHtml } from '../../../utils/businessHeader';
import { fromDb, formatMoney } from '../utils/money';

const kes = (v) => formatMoney(fromDb(v));
const niceDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const METHOD = { CASH: 'Cash', MPESA: 'M-Pesa', BANK: 'Bank', CHEQUE: 'Cheque', OTHER: 'Other' };

/** @param data elimu_fin_receipt_data() result */
export function receiptReport(data) {
  const paidFor = (data.paid_for || []);
  const bal = fromDb(data.balance_after);
  return {
    title: data.reversed ? `${data.title} (REVERSED)` : data.title,
    subtitle: `${data.receipt_no}${data.reversed ? ' - this receipt has been reversed' : ''}`,
    period: niceDate(data.payment_date),
    summary: [
      { label: 'Student', value: `${data.student.name} (${data.student.admission_no})` },
      { label: 'Class', value: data.student.class_name || '-' },
      { label: 'Amount received', value: kes(data.amount) },
      { label: 'Method', value: METHOD[data.method] || data.method },
      ...(data.transaction_ref ? [{ label: 'Reference', value: data.transaction_ref }] : []),
      ...(data.deposit_slip_ref ? [{ label: 'Deposit slip', value: data.deposit_slip_ref }] : []),
      { label: bal > 0 ? 'Balance outstanding' : bal < 0 ? 'Credit balance' : 'Balance', value: formatMoney(Math.abs(bal)) },
      { label: 'Received by', value: data.received_by || '-' },
    ],
    sections: [
      ...(paidFor.length ? [{ heading: 'Items paid for', columns: [{ key: 'inv', label: 'Invoice', w: 2 }, { key: 'desc', label: 'Fees', w: 4 }, { key: 'amt', label: 'Paid', align: 'right', w: 2 }],
        rows: paidFor.map(p => ({ inv: `${p.invoice_no}${p.term ? ' - ' + p.term : ''}`, desc: (p.lines || []).join(', '), amt: kes(p.amount) })) }] : []),
      ...(fromDb(data.unallocated) > 0 ? [{ heading: 'Held as credit', note: `${kes(data.unallocated)} is held on the student's account and will be applied to future fees.`, columns: [], rows: [] }] : []),
    ],
    footnote: [data.footer, data.confirmation_basis ? `Confirmed: ${String(data.confirmation_basis).replace(/_/g, ' ').toLowerCase()}.` : null].filter(Boolean).join(' '),
  };
}

/** Thermal/browser print. Uses the POS print window. */
export function printReceipt(data, opts = {}) {
  const e = escapeHtml; const bal = fromDb(data.balance_after);
  const rows = (data.paid_for || []).map(p => `<tr><td>${e(p.invoice_no)}${p.term ? ' ' + e(p.term) : ''}</td><td class="right">${e(kes(p.amount))}</td></tr>`).join('');
  const body = `${businessHeaderHtml({ ...data.school })}
    <div class="divider"></div><div class="center bold">${e(data.title)}${data.reversed ? ' - REVERSED' : ''}</div>
    <div class="center">${e(data.receipt_no)} &middot; ${e(niceDate(data.payment_date))}</div><div class="divider"></div>
    <div>Student: <span class="bold">${e(data.student.name)}</span></div><div>Adm no: ${e(data.student.admission_no)}${data.student.class_name ? ' &middot; ' + e(data.student.class_name) : ''}</div>
    <div class="divider"></div>${rows ? `<table>${rows}</table><div class="divider"></div>` : ''}
    <table><tr><td class="bold">Amount received</td><td class="right bold">${e(kes(data.amount))}</td></tr>
    <tr><td>Method</td><td class="right">${e(METHOD[data.method] || data.method)}</td></tr>
    ${data.transaction_ref ? `<tr><td>Reference</td><td class="right">${e(data.transaction_ref)}</td></tr>` : ''}
    <tr><td>${bal > 0 ? 'Balance due' : bal < 0 ? 'Credit balance' : 'Balance'}</td><td class="right">${e(formatMoney(Math.abs(bal)))}</td></tr></table>
    <div class="divider"></div><div class="muted">Received by ${e(data.received_by || '-')}</div>${data.footer ? `<div class="center muted">${e(data.footer)}</div>` : ''}`;
  return printDocument(`Receipt ${data.receipt_no}`, body, '', opts);
}

/** Student / parent statement (term, class or full-history statements are the same report with different rows). */
export function statementReport({ school, account, rows, from, to, footer }) {
  const s = account.student;
  return {
    title: 'FEE STATEMENT', subtitle: `${s.name} (${s.admission_no}) - ${s.class_name || ''}${s.stream_name ? ' ' + s.stream_name : ''}`.trim(),
    period: from || to ? `${niceDate(from) || 'start'} to ${niceDate(to) || 'today'}` : 'All activity',
    summary: [
      { label: 'Guardian', value: s.guardian_name || '-' }, { label: 'Billed', value: kes(account.billed) }, { label: 'Paid', value: kes(account.payments) },
      { label: 'Discounts / scholarships / bursaries', value: formatMoney(fromDb(account.discounts) + fromDb(account.scholarships) + fromDb(account.bursaries)) },
      { label: 'Outstanding', value: kes(account.outstanding) }, { label: 'Arrears (past due)', value: kes(account.arrears) },
      { label: 'Credit held', value: kes(account.credit_available) }, { label: 'Balance', value: kes(account.current_balance) },
    ],
    sections: [{ heading: 'Account activity', columns: [{ key: 'date', label: 'Date', w: 2 }, { key: 'type', label: 'Type', w: 2 }, { key: 'desc', label: 'Details', w: 5 }, { key: 'dr', label: 'Charged', align: 'right', w: 2 }, { key: 'cr', label: 'Credited', align: 'right', w: 2 }, { key: 'bal', label: 'Balance', align: 'right', w: 2 }],
      rows: rows.map(r => ({ date: niceDate(r.entry_date), type: String(r.entry_type).replace(/_/g, ' ').toLowerCase(), desc: r.description || r.invoice_no || '',
        dr: fromDb(r.debit) ? kes(r.debit) : '', cr: fromDb(r.credit) ? kes(r.credit) : '', bal: kes(r.balance) })) }],
    footnote: footer || 'A positive balance is owed to the school; a negative balance is credit held for the student.',
  };
}
