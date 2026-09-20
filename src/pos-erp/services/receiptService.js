// src/pos-erp/services/receiptService.js
//
// The "remaining part" brief section 3 always implied but this project
// never built: a completed sale gets a receipt the cashier can actually
// hand to the customer, in whatever form fits — paper, WhatsApp, email.
//
// saleService.create() has always written a `receipt_data` snapshot to
// lb_receipts (see its own comment: "Sending/printing UI is a separate
// phase"). This file is that phase. It does not create receipts —
// saleService.create() still does that, once, at sale time — it only
// renders and delivers what's already there.
//
// WHY WHATSAPP AND EMAIL ARE BOTH "HAND OFF TO THE DEVICE'S OWN APP",
// NOT "SEND FROM OUR SERVER": consistent with brief section 16's own
// rule for WhatsApp (no API, use wa.me and let the owner press Send) —
// this project has no SMS/email provider connected at all (see
// SettingsPage's own disabled communication toggle), so there is no
// server-side send capability to build a receipt-email feature on top
// of without inventing one. Email uses a `mailto:` link for the exact
// same reason wa.me was chosen for WhatsApp: it opens the customer's
// own configured app with the message ready, and never claims more than
// that happened (section 43 — never say "sent" or "delivered" for
// something that was only opened).
//
// A WALK-IN customer (no lb_customers row — the common case at a kiosk
// till) can still get their receipt by WhatsApp or email: the cashier
// types a phone/email into the receipt screen. That send is NOT logged
// to lb_communication_log, because that table's own CHECK constraint
// requires exactly one of customer_id/supplier_id, and a walk-in has
// neither — logging it against a fabricated ID would be worse than not
// logging it. A SAVED customer's receipt send DOES go through the
// normal tracked whatsappService.prepare() path (Prepared/Opened/Sent
// by you), so it shows up in that customer's own message history same
// as any other WhatsApp message this system sends.

import { posSupabase as supabase } from './posSupabaseClient';
import { templateService, communicationLogService, whatsappService, normalizePhoneForWhatsApp, renderTemplate } from './communicationService';
import { printDocument, escapeHtml } from '../utils/printDocument';

export const receiptService = {
  /** Full receipt (with sale/customer join) for a given sale — used right after checkout and for a later reprint. */
  async getBySaleId(saleId) {
    const { data, error } = await supabase
      .from('lb_receipts')
      .select('*, sale:lb_sales(id, sale_number, customer:lb_customers(id, name, phone, email))')
      .eq('sale_id', saleId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  // ---------- Rendering ----------

  /** Plain-text rendition — used for both the WhatsApp message body and the email body. Kept identical between the two so "what the customer sees" doesn't quietly differ by channel. */
  buildReceiptText(receipt, business) {
    const d = receipt.receipt_data || {};
    const lines = [];
    lines.push(business?.name || 'Receipt');
    if (business?.phone) lines.push(business.phone);
    lines.push('');
    lines.push(`Receipt ${receipt.receipt_number}${d.sale_number ? ` (Sale ${d.sale_number})` : ''}`);
    lines.push(new Date(d.completed_at || receipt.created_at).toLocaleString());
    lines.push('-----------------------------');
    for (const item of d.items || []) {
      const name = item.name || 'Item';
      const lineTotal = Number(item.total_price ?? item.quantity * item.unit_price).toLocaleString();
      lines.push(`${item.quantity} x ${name} @ ${Number(item.unit_price).toLocaleString()} = ${lineTotal}`);
    }
    lines.push('-----------------------------');
    lines.push(`Subtotal: ${Number(d.subtotal || 0).toLocaleString()}`);
    if (Number(d.discount_total) > 0) lines.push(`Discount: -${Number(d.discount_total).toLocaleString()}`);
    if (Number(d.tax_total) > 0) lines.push(`Tax: ${Number(d.tax_total).toLocaleString()}`);
    lines.push(`TOTAL: ${Number(d.total_amount || 0).toLocaleString()}`);
    for (const p of d.payments || []) {
      lines.push(`Paid (${String(p.payment_method || '').replace('_', ' ')}): ${Number(p.amount).toLocaleString()}`);
    }
    lines.push('');
    lines.push('Thank you for your business.');
    return lines.join('\n');
  },

  /** Printable HTML — narrow, thermal-receipt-styled. logoUrl/header/footer are optional business branding (Phase 13/settings). */
  buildReceiptHtml(receipt, business, posSettings) {
    const d = receipt.receipt_data || {};
    const fmt = (n) => Number(n || 0).toLocaleString();
    const itemsHtml = (d.items || []).map(item => `
      <tr>
        <td>${escapeHtml(item.name || 'Item')}<br/><span class="muted">${item.quantity} x ${fmt(item.unit_price)}</span></td>
        <td class="right">${fmt(item.total_price ?? item.quantity * item.unit_price)}</td>
      </tr>`).join('');
    const paymentsHtml = (d.payments || []).map(p => `
      <tr><td class="muted">${escapeHtml(String(p.payment_method || '').replace('_', ' '))}</td><td class="right muted">${fmt(p.amount)}</td></tr>`).join('');

    return `
      <div class="center">
        ${business?.logo_url ? `<img class="logo" src="${escapeHtml(business.logo_url)}" alt="" />` : ''}
        <div class="bold" style="font-size:16px;">${escapeHtml(business?.name || 'Receipt')}</div>
        ${business?.address ? `<div class="muted">${escapeHtml(business.address)}</div>` : ''}
        ${business?.phone ? `<div class="muted">${escapeHtml(business.phone)}</div>` : ''}
        ${posSettings?.receipt_header ? `<div style="margin-top:4px;">${escapeHtml(posSettings.receipt_header)}</div>` : ''}
      </div>
      <div class="divider"></div>
      <div>Receipt: <span class="bold">${escapeHtml(receipt.receipt_number)}</span></div>
      ${d.sale_number ? `<div class="muted">Sale: ${escapeHtml(d.sale_number)}</div>` : ''}
      <div class="muted">${new Date(d.completed_at || receipt.created_at).toLocaleString()}</div>
      <div class="divider"></div>
      <table>${itemsHtml}</table>
      <div class="divider"></div>
      <table>
        <tr><td>Subtotal</td><td class="right">${fmt(d.subtotal)}</td></tr>
        ${Number(d.discount_total) > 0 ? `<tr><td>Discount</td><td class="right">-${fmt(d.discount_total)}</td></tr>` : ''}
        ${Number(d.tax_total) > 0 ? `<tr><td>Tax</td><td class="right">${fmt(d.tax_total)}</td></tr>` : ''}
        <tr class="bold" style="font-size:15px;"><td>TOTAL</td><td class="right">${fmt(d.total_amount)}</td></tr>
      </table>
      <div class="divider"></div>
      <table>${paymentsHtml}</table>
      <div class="divider"></div>
      <div class="center muted" style="margin-top:6px;">${escapeHtml(posSettings?.receipt_footer || 'Thank you for your business.')}</div>
    `;
  },

  // ---------- Actions ----------

  print(receipt, business, posSettings) {
    printDocument(`Receipt ${receipt.receipt_number}`, this.buildReceiptHtml(receipt, business, posSettings));
  },

  /**
   * @param {object} params
   * @param {object} params.receipt - the lb_receipts row
   * @param {object} params.business - { name, ... } for {{business_name}}
   * @param {object|null} params.customer - a real lb_customers row, or null for a walk-in
   * @param {string} [params.phoneOverride] - required when customer is null (or to send to a different number than the one on file)
   * @returns {Promise<{url: string, tracked: boolean}>} tracked is true when this was logged against a real customer
   */
  async sendWhatsApp({ receipt, business, customer, phoneOverride, tenantId, businessId, createdBy }) {
    const d = receipt.receipt_data || {};
    const phone = phoneOverride || customer?.phone;
    const normalized = normalizePhoneForWhatsApp(phone);
    if (!normalized) {
      throw new Error(phone ? `"${phone}" doesn't look like a Kenyan mobile number.` : 'Enter a phone number to send the receipt to.');
    }

    const templates = await templateService.getAll({ businessId });
    const template = templates.find(t => t.channel === 'WHATSAPP' && t.message_type === 'RECEIPT');
    if (!template) throw new Error('No WhatsApp receipt wording is set up yet. Open Messages once to create the defaults.');

    if (customer?.id) {
      // Real customer -- goes through the normal tracked path, same as
      // every other WhatsApp message this system sends (Prepared /
      // Opened in WhatsApp / Sent by you). Shows up in that customer's
      // own message history in Messages, not just here.
      const { log, url } = await whatsappService.prepare({
        tenantId, businessId, customer, template,
        variables: { receipt_number: receipt.receipt_number, amount: Number(d.total_amount).toLocaleString() },
        referenceType: 'SALE', referenceId: d.sale_number || null, createdBy,
      });
      return { url, tracked: true, logId: log.id };
    }

    // Walk-in -- no customer row to attach a tracked log entry to (see
    // this file's header for why that's not logged rather than faked).
    const message = renderTemplate(template.body, {
      customer_name: 'there', receipt_number: receipt.receipt_number,
      amount: Number(d.total_amount).toLocaleString(), business_name: business?.name || '',
    });
    const url = `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
    return { url, tracked: false };
  },

  /**
   * mailto: link -- opens the customer's own mail app with the receipt
   * as plain text. There is no way to attach a file to a mailto: link
   * and no way to know whether the customer actually pressed Send once
   * their mail app opens -- both stated up front in the UI that calls
   * this, not just here, so the cashier isn't surprised later.
   */
  buildEmailLink({ receipt, business, emailOverride, customer }) {
    const email = emailOverride || customer?.email;
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      throw new Error(email ? `"${email}" doesn't look like a valid email address.` : 'Enter an email address to send the receipt to.');
    }
    const subject = `Receipt ${receipt.receipt_number} — ${business?.name || ''}`;
    const body = this.buildReceiptText(receipt, business);
    // mailto: bodies have a practical length ceiling (browsers/clients
    // vary, but well under 2000 chars is safe everywhere) -- a receipt
    // with a very long item list is truncated with a note rather than
    // silently producing a mailto: link some mail clients refuse to open.
    const safeBody = body.length > 1500 ? `${body.slice(0, 1450)}\n\n… (receipt continues — see printed copy for the full item list)` : body;
    return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(safeBody)}`;
  },
};
