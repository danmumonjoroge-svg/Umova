// src/pos-erp/services/invoicePdfService.js
// Builds a real PDF document (text + drawn table) from invoiceService.getDetail() data —
// not a screenshot of the UI. Requires the `jspdf` package (npm i jspdf).
import { jsPDF } from 'jspdf';

const money = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const day = (d) => (d ? new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
/** [label, value] rows for the HOW TO PAY block. Only what the owner has actually entered; a label of '' = free text. */
export function paymentLines({ payInfo = {}, mpesa, invoice, business }) {
  const p = payInfo || {}, rows = [];
  if (p.paybill) rows.push(['M-Pesa Paybill', `${p.paybill}   ·   Account: ${(p.paybill_account || '').trim() || invoice.invoice_number}`]);
  if (p.till) rows.push(['M-Pesa Till (Buy Goods)', String(p.till)]);
  if (!p.paybill && !p.till && mpesa?.shortcode) rows.push(['M-Pesa', `${mpesa.shortcode}   ·   Account: ${invoice.invoice_number}`]);
  if (p.bank_name || p.bank_account_number) {
    rows.push(['Bank', [p.bank_name, p.bank_branch].filter(Boolean).join(' — ') || '—']);
    if (p.bank_account_name) rows.push(['Account name', p.bank_account_name]);
    if (p.bank_account_number) rows.push(['Account number', p.bank_account_number]);
    rows.push(['Reference', invoice.invoice_number]);
  }
  if (p.other) rows.push(['', p.other]);
  if (invoice.notes) rows.push(['', invoice.notes]);
  if (business?.phone) rows.push(['Questions', business.phone]);
  if (!rows.some(([k]) => k && k !== 'Questions') && !p.other) rows.unshift(['', 'Please contact us for payment details.']);
  return rows;
}

const monthName = (d) => new Date(d).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });

export function buildInvoicePdf({ invoice, lines, payments, customer, unit, business, mpesa, logo, payInfo }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 16; let y = 18;
  const green = [18, 60, 42], gold = [198, 161, 91], grey = [104, 117, 109];
  const text = (t, x, yy, o = {}) => { doc.setFont('helvetica', o.bold ? 'bold' : 'normal'); doc.setFontSize(o.size || 10); doc.setTextColor(...(o.color || [38, 53, 45])); doc.text(String(t), x, yy, { align: o.align || 'left' }); };
  const ensure = (need) => { if (y + need > 280) { doc.addPage(); y = 18; } };

  // header (logo is optional — skipped silently if the business has none or it could not be loaded)
  let tx = M; const top = y - 6;
  if (logo?.dataUrl) {
    const h = 18, w = Math.min(44, h * (logo.width / logo.height));
    try { doc.addImage(logo.dataUrl, 'PNG', M, top, w, h); tx = M + w + 5; y = top + 6; } catch { /* draw without logo */ }
  }
  text(business?.name || 'Business', tx, y, { bold: true, size: 16, color: green });
  text('INVOICE', W - M, y, { bold: true, size: 16, color: green, align: 'right' }); y += 6;
  [business?.address, [business?.phone, business?.email].filter(Boolean).join('  ·  ')].filter(Boolean).forEach((l) => { text(l, tx, y, { size: 9, color: grey }); y += 4.5; });
  if (logo?.dataUrl) y = Math.max(y, top + 20);
  let ry = 24;
  [['Invoice no.', invoice.invoice_number], ['Invoice date', day(invoice.issue_date)], ['Due date', day(invoice.due_date)], ['Period', monthName(invoice.period)]].forEach(([k, v]) => {
    text(k, W - M - 44, ry, { size: 9, color: grey }); text(v, W - M, ry, { size: 9, bold: true, align: 'right' }); ry += 5;
  });
  y = Math.max(y, ry) + 4;
  doc.setDrawColor(...gold); doc.setLineWidth(0.6); doc.line(M, y, W - M, y); y += 8;

  // bill to
  text('BILL TO', M, y, { size: 8, bold: true, color: grey }); y += 5;
  text(customer?.name || '—', M, y, { bold: true, size: 11 }); y += 5;
  [unit?.unit_number ? `Unit ${unit.unit_number}` : null, customer?.phone, customer?.email].filter(Boolean).forEach((l) => { text(l, M, y, { size: 9, color: grey }); y += 4.5; });
  y += 4;

  // items
  doc.setFillColor(...green); doc.rect(M, y, W - 2 * M, 8, 'F');
  text('Description', M + 3, y + 5.3, { bold: true, size: 9, color: [255, 255, 255] });
  text('Amount', W - M - 3, y + 5.3, { bold: true, size: 9, color: [255, 255, 255], align: 'right' }); y += 8;
  lines.forEach((l, i) => {
    ensure(9);
    if (i % 2) { doc.setFillColor(247, 246, 240); doc.rect(M, y, W - 2 * M, 8, 'F'); }
    text(l.charge?.charge_name || 'Charge', M + 3, y + 5.3); text(money(l.amount), W - M - 3, y + 5.3, { align: 'right' }); y += 8;
  });
  y += 4;

  // totals
  const paid = Number(invoice.paid_amount || 0), due = Number(invoice.balance_due || 0), prev = Number(invoice.previous_balance || 0);
  const rows = [['Invoice total', money(invoice.total_amount)]];
  if (prev > 0) rows.unshift(['Previous balance', money(prev)]);
  if (paid > 0) rows.push(['Payments received', `− ${money(paid)}`]);
  rows.push(['Amount due now', money(due)]);
  if (prev > 0) rows.push(['Total outstanding', money(prev + due)]);
  rows.forEach(([k, v], i) => {
    ensure(8); const last = i >= rows.length - (prev > 0 ? 2 : 1) && (k === 'Amount due now' || k === 'Total outstanding');
    text(k, W - M - 62, y, { bold: last, size: last ? 11 : 10 }); text(v, W - M, y, { bold: last, size: last ? 11 : 10, align: 'right', color: last ? green : undefined }); y += 6.5;
  });
  const shown = invoice.display_status;
  if (shown === 'PAID' || shown === 'CANCELLED') { text(shown, M, y - 6, { bold: true, size: 20, color: shown === 'PAID' ? [35, 122, 82] : [162, 59, 43] }); }
  y += 4;

  // payments received
  if (payments.length) {
    ensure(14 + payments.length * 5); text('PAYMENTS RECEIVED', M, y, { size: 8, bold: true, color: grey }); y += 5;
    payments.forEach((p) => {
      const how = p.source === 'MPESA_PROMPT' ? 'M-Pesa (confirmed)' : p.source === 'MPESA_MANUAL' ? 'M-Pesa (recorded by owner)' : String(p.payment_method || '').replace(/_/g, ' ').toLowerCase();
      text(`${day(p.created_at)} — ${how}${p.reference_no ? ` — ${p.reference_no}` : ''}`, M, y, { size: 9 }); text(money(p.amount), W - M, y, { size: 9, align: 'right' }); y += 5;
    }); y += 3;
  }

  // payment instructions — only what is actually configured
  const how = paymentLines({ payInfo, mpesa, invoice, business });
  ensure(14 + how.length * 5); text('HOW TO PAY', M, y, { size: 8, bold: true, color: grey }); y += 5;
  how.forEach(([k, v]) => {
    ensure(6);
    if (k) { text(k, M, y, { size: 9, bold: true }); text(v, M + 42, y, { size: 9 }); y += 5; }
    else doc.splitTextToSize(v, W - 2 * M).forEach((ln) => { ensure(5); text(ln, M, y, { size: 9 }); y += 4.5; });
  });
  text('Thank you.', M, 289, { size: 9, color: grey });

  const filename = `${invoice.invoice_number}.pdf`;
  return { doc, filename, blob: () => doc.output('blob') };
}

export const downloadInvoicePdf = (detail) => { const { doc, filename } = buildInvoicePdf(detail); doc.save(filename); };

/** Prints the real PDF through a hidden iframe (browser print dialog; "Save as PDF" also lives there). */
export function printInvoicePdf(detail) {
  const url = URL.createObjectURL(buildInvoicePdf(detail).blob());
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; f.src = url;
  f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { window.open(url, '_blank'); } setTimeout(() => { URL.revokeObjectURL(url); f.remove(); }, 60000); };
  document.body.appendChild(f);
}

/** Phone share sheet with the PDF attached (WhatsApp/Email). Returns false when the browser can't attach files. */
export async function sharePdf(detail, text) {
  const { blob, filename } = buildInvoicePdf(detail);
  const file = new File([blob()], filename, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: filename, text }); return true; }
  return false;
}
