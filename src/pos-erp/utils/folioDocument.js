// src/pos-erp/utils/folioDocument.js
//
// The invoice and the receipt for a folio are RENDERED from the folio
// (phase19 stores no separate invoice row). Same grouped layout as the
// on-screen bill: Room, Items, Services, Activities... with one total.
// Uses the same narrow print styling as sale receipts via printDocument.

import { escapeHtml } from './printDocument';
import { folioService } from '../services/folioService';

const fmt = (n) => Number(n || 0).toLocaleString();
const METHOD = { CASH: 'Cash', MOBILE_MONEY: 'M-Pesa', CARD: 'Card', BANK: 'Bank', OTHER: 'Other' };

/** kind: 'invoice' | 'receipt'. A receipt is only valid once the folio is settled. */
export function buildFolioDocumentHtml(folio, kind = 'invoice') {
  const biz = folio.business || {};
  const groups = folioService.sections(folio.lines || []);
  const isReceipt = kind === 'receipt';
  const docNo = isReceipt ? folio.receipt_number : (folio.invoice_number || folio.folio_number);
  const paid = folio.status === 'SETTLED';

  const body = groups.map((g) => `
    <table style="margin-top:8px;"><tr class="bold"><td>${escapeHtml(g.label)}${g.isPackage ? ' <span class="muted">(package)</span>' : ''}</td><td class="right">${fmt(g.subtotal)}</td></tr></table>
    <table>${g.lines.map((l) => `
      <tr>
        <td class="muted">${escapeHtml(l.shown)}${Number(l.quantity) !== 1 && !g.isPackage ? ` <span>(${fmt(l.quantity)} x ${fmt(l.unit_price)})</span>` : ''}</td>
        <td class="right muted">${g.isPackage ? '' : fmt(l.amount)}</td>
      </tr>`).join('')}
    </table>`).join('');

  const nightsOf = (st) => (st.status === 'CHECKED_OUT' ? st.nights_charged : st.nights_booked);
  const day = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const stayHtml = (folio.stays || []).map((st) => `<div class="muted">Room ${escapeHtml(st.room_number)} · ${day(st.check_in_date)} to ${day(st.expected_check_out)} (${nightsOf(st)} night${nightsOf(st) === 1 ? '' : 's'})</div>`).join('');

  const pays = (folio.payments || []).map((p) => `
    <tr><td class="muted">${escapeHtml(METHOD[p.payment_method] || p.payment_method)}${p.reference_no ? ` · ${escapeHtml(p.reference_no)}` : ''}</td><td class="right muted">${fmt(p.amount)}</td></tr>`).join('');

  return `
    <div class="center">
      ${biz.logo_url ? `<img class="logo" src="${escapeHtml(biz.logo_url)}" alt="" />` : ''}
      <div class="bold" style="font-size:16px;">${escapeHtml(biz.name || (isReceipt ? 'Receipt' : 'Invoice'))}</div>
      ${biz.address ? `<div class="muted">${escapeHtml(biz.address)}</div>` : ''}
      ${biz.phone ? `<div class="muted">${escapeHtml(biz.phone)}</div>` : ''}
    </div>
    <div class="divider"></div>
    <div>${isReceipt ? 'Receipt' : 'Invoice'}: <span class="bold">${escapeHtml(docNo || '')}</span></div>
    <div class="muted">${new Date(folio.settled_at || folio.opened_at).toLocaleString()}</div>
    <div style="margin-top:6px;">Guest:<br/><span class="bold">${escapeHtml(folio.customer?.name || '')}</span></div>
    ${folio.title ? `<div class="muted">${escapeHtml(folio.title)}</div>` : ''}
    ${stayHtml}
    <div class="divider"></div>
    ${body}
    <div class="divider"></div>
    <table><tr class="bold" style="font-size:15px;"><td>TOTAL</td><td class="right">${fmt(folio.total_charges)}</td></tr></table>
    ${pays ? `<div class="divider"></div><table>${pays}</table>` : ''}
    <div class="divider"></div>
    <div class="center bold">${paid ? 'PAID' : `BALANCE DUE ${fmt(folio.balance_due)}`}</div>
    <div class="center muted" style="margin-top:6px;">Thank you for staying with us.</div>`;
}
