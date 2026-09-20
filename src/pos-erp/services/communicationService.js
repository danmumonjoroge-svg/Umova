// src/pos-erp/services/communicationService.js
//
// Phase 7 — customer communication (brief §51-54). Kept separate from
// notificationsService.js (internal alerts, already built).
//
// send() renders a template and inserts a QUEUED row into
// lb_communication_log — nothing here ever calls an SMS/email/WhatsApp
// API or flips a message to SENT. Per the brief: "Do not fake external
// integrations. Build the internal communication architecture first and
// connect providers through services." When a real provider is wired in
// later, it should be a new service that reads QUEUED rows from this log
// and updates their status — this file's job stops at queuing.
//
// Phase 8 adds WhatsApp (brief §16), which is the one channel that does
// NOT need a provider: whatsappService below renders a message, opens a
// wa.me link, and tracks the three states §16 asks for —
// prepared (QUEUED) / opened in WhatsApp (OPENED) / sent by the owner
// (SENT, owner-attested). It never sets DELIVERED, because without a
// real API nothing here can observe delivery (§43).

import { posSupabase as supabase } from './posSupabaseClient';

// §52's exact default set — seeded per-business on first visit to
// CustomerCommunicationPage.jsx (via templateService.ensureDefaults()),
// not a global cross-tenant system row like lb_expense_categories, since
// message wording is business-specific and editable per tenant from the start.
const DEFAULT_TEMPLATES = [
  { message_type: 'WELCOME', channel: 'SMS', body: 'Welcome to {{business_name}}, {{customer_name}}! We\'re glad to have you.' },
  { message_type: 'PAYMENT_RECEIVED', channel: 'SMS', body: 'Payment of {{amount}} received. Thank you, {{customer_name}}! New balance: {{balance}}.' },
  { message_type: 'PAYMENT_DUE', channel: 'SMS', body: 'Hi {{customer_name}}, a payment of {{amount}} is due on {{due_date}}.' },
  { message_type: 'PAYMENT_OVERDUE', channel: 'SMS', body: '{{customer_name}}, your account with {{business_name}} has an outstanding balance of {{balance}}. Please settle at your earliest convenience.' },
  { message_type: 'RECEIPT', channel: 'SMS', body: 'Receipt {{receipt_number}} for {{amount}} — thank you for shopping with {{business_name}}.' },
  { message_type: 'STATEMENT', channel: 'SMS', body: 'Hi {{customer_name}}, your current balance with {{business_name}} is {{balance}}.' },
  { message_type: 'APPOINTMENT_REMINDER', channel: 'SMS', body: 'Reminder: your appointment at {{business_name}} is at {{appointment_time}}.' },

  // Phase 8 — WHATSAPP versions of the same §52 set. Separate rows, not
  // a channel switch on the SMS ones: WhatsApp has no 160-character
  // pressure, so the wording is warmer and can carry a greeting. The
  // UNIQUE (business_id, message_type, channel) constraint means these
  // coexist with the SMS set rather than replacing it.
  { message_type: 'WELCOME', channel: 'WHATSAPP', body: 'Hi {{customer_name}}, welcome to {{business_name}}! Karibu. Save this number so you can reach us any time.' },
  { message_type: 'PAYMENT_RECEIVED', channel: 'WHATSAPP', body: 'Hi {{customer_name}}, we have received your payment of KES {{amount}}. Thank you! Your balance is now KES {{balance}}. — {{business_name}}' },
  // No {{due_date}} in the WhatsApp variant, unlike the SMS one. Nothing
  // in this schema can supply a real per-invoice due date (the same gap
  // already recorded against Payables and the Home screen), and this is
  // the template the Customers page's "Remind" button fires — so it must
  // not imply a date that was never recorded. §7: do not fake ageing.
  { message_type: 'PAYMENT_DUE', channel: 'WHATSAPP', body: 'Hi {{customer_name}}, a reminder that your balance with {{business_name}} is KES {{balance}}. Kindly settle when you can. Thank you.' },
  { message_type: 'PAYMENT_OVERDUE', channel: 'WHATSAPP', body: 'Hi {{customer_name}}, your balance with {{business_name}} is KES {{balance}} and is now overdue. Kindly settle when you can. Thank you.' },
  { message_type: 'RECEIPT', channel: 'WHATSAPP', body: 'Hi {{customer_name}}, here is your receipt {{receipt_number}} for KES {{amount}}. Thank you for your business. — {{business_name}}' },
  { message_type: 'STATEMENT', channel: 'WHATSAPP', body: 'Hi {{customer_name}}, your current balance with {{business_name}} is KES {{balance}}. Reply here if anything looks wrong.' },
  { message_type: 'APPOINTMENT_REMINDER', channel: 'WHATSAPP', body: 'Hi {{customer_name}}, this is a reminder about your appointment at {{business_name}} at {{appointment_time}}. See you then!' },
];

// Phase 10 — supplier-facing defaults (§15's second list). {{supplier_name}}
// instead of {{customer_name}}; renderTemplate() doesn't care which
// variable names a template uses, so no rendering-code change was needed.
const DEFAULT_SUPPLIER_TEMPLATES = [
  { message_type: 'SUPPLIER_ORDER', channel: 'WHATSAPP', body: 'Hi {{supplier_name}}, we would like to place an order. Details: {{order_details}}. Please confirm availability. — {{business_name}}' },
  { message_type: 'SUPPLIER_PAYMENT_SENT', channel: 'WHATSAPP', body: 'Hi {{supplier_name}}, we have sent a payment of KES {{amount}}. Reference: {{reference}}. Thank you. — {{business_name}}' },
  // No {{due_date}} — same reason as the customer PAYMENT_DUE template:
  // lb_purchase_orders/lb_goods_received_notes have no due-date column,
  // so nothing here can supply one honestly (§7's "do not fake ageing").
  { message_type: 'SUPPLIER_PAYMENT_DUE', channel: 'WHATSAPP', body: 'Hi {{supplier_name}}, our current balance with you is KES {{balance}}. We will settle this shortly. — {{business_name}}' },
  { message_type: 'SUPPLIER_STATEMENT', channel: 'WHATSAPP', body: 'Hi {{supplier_name}}, our current outstanding balance with you is KES {{balance}}. Let us know if this does not match your records.' },
  { message_type: 'SUPPLIER_DELIVERY_REMINDER', channel: 'WHATSAPP', body: 'Hi {{supplier_name}}, checking in on the delivery for our recent order. Please let us know the expected date. Thank you. — {{business_name}}' },
];

// Exported (Phase 14: receipt sending) so receiptService.js can render
// the same RECEIPT template wording for a walk-in customer who has no
// lb_customers row to attach a tracked communicationLogService entry
// to — see receiptService.js's header for why that path can't use
// whatsappService.prepare() directly.
export function renderTemplate(body, variables) {
  return (body || '').replace(/\{\{(\w+)\}\}/g, (match, key) => (variables[key] != null ? String(variables[key]) : match));
}

export const templateService = {
  async getAll({ businessId } = {}) {
    let q = supabase.from('lb_communication_templates').select('*').order('message_type');
    if (businessId) q = q.eq('business_id', businessId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  /**
   * Seeds any missing default template — idempotent, and gap-filling
   * rather than all-or-nothing.
   *
   * It used to bail out entirely if the business had ANY template, which
   * meant a business seeded in Phase 7 (7 SMS rows) would never receive
   * the Phase 8 WHATSAPP set. Now it inserts only the
   * (message_type, channel) pairs it doesn't already have, so an
   * existing business picks up the new channel on its next visit and an
   * owner's own edits to existing rows are never overwritten.
   */
  async ensureDefaults({ tenantId, businessId, createdBy }) {
    const existing = await this.getAll({ businessId });
    const have = new Set(existing.map(t => `${t.message_type}|${t.channel}`));
    const wanted = [...DEFAULT_TEMPLATES, ...DEFAULT_SUPPLIER_TEMPLATES];
    const missing = wanted.filter(t => !have.has(`${t.message_type}|${t.channel}`));
    if (missing.length === 0) return existing;

    const rows = missing.map(t => ({ ...t, tenant_id: tenantId, business_id: businessId ?? null, created_by: createdBy ?? null }));
    const { data, error } = await supabase.from('lb_communication_templates').insert(rows).select();
    if (error) throw error;
    return [...existing, ...(data || [])].sort((a, b) => a.message_type.localeCompare(b.message_type));
  },

  async update(id, { subject, body, is_active }) {
    const { data, error } = await supabase
      .from('lb_communication_templates')
      .update({ subject: subject || null, body, is_active, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};

// Both selects below join whichever recipient the row actually has —
// exactly one, enforced by lb_communication_log_one_recipient_chk — so
// history rows for customers and suppliers can share one table and one
// query shape without ambiguity.
const LOG_SELECT = '*, customer:lb_customers(id, name, phone, email), supplier:lb_suppliers(id, name, phone, email)';

/**
 * Shared insert for both communicationLogService.send() (customers) and
 * .sendToSupplier() (suppliers) — the ONLY write path onto
 * lb_communication_log either way. Never sends anything; always QUEUED.
 */
async function insertLog({ tenantId, businessId, customerId, supplierId, nameVar, recipientRow, template, variables, referenceType, referenceId, createdBy }) {
  if (!template) throw new Error('communicationService: a template is required.');
  if (!recipientRow) throw new Error('communicationService: a recipient is required.');

  const mergedVariables = { [nameVar]: recipientRow.name, ...variables };
  const rendered = renderTemplate(template.body, mergedVariables);
  const recipientContact = template.channel === 'EMAIL' ? recipientRow.email : recipientRow.phone;

  const { data, error } = await supabase
    .from('lb_communication_log')
    .insert({
      tenant_id: tenantId,
      business_id: businessId ?? null,
      customer_id: customerId ?? null,
      supplier_id: supplierId ?? null,
      template_id: template.id,
      channel: template.channel,
      message_type: template.message_type,
      recipient: recipientContact || null,
      rendered_message: rendered,
      status: 'QUEUED',
      reference_type: referenceType || null,
      reference_id: referenceId || null,
      created_by: createdBy ?? null,
    })
    .select(LOG_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export const communicationLogService = {
  async getHistory({ businessId, customerId, supplierId, limit = 100 } = {}) {
    let q = supabase
      .from('lb_communication_log')
      .select(LOG_SELECT)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (businessId) q = q.eq('business_id', businessId);
    if (customerId) q = q.eq('customer_id', customerId);
    if (supplierId) q = q.eq('supplier_id', supplierId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  /**
   * Renders `template` against `variables` and queues it for a customer.
   * @returns {Promise<object>} the new lb_communication_log row (status: 'QUEUED')
   */
  async send({ tenantId, businessId, customer, template, variables, referenceType, referenceId, createdBy }) {
    return insertLog({
      tenantId, businessId, customerId: customer?.id, nameVar: 'customer_name', recipientRow: customer,
      template, variables, referenceType, referenceId, createdBy,
    });
  },

  /**
   * Phase 10 — the supplier equivalent of send(). Same table, same
   * QUEUED-only rule, template must be a SUPPLIER_* message type.
   * @returns {Promise<object>} the new lb_communication_log row (status: 'QUEUED')
   */
  async sendToSupplier({ tenantId, businessId, supplier, template, variables, referenceType, referenceId, createdBy }) {
    if (template && !String(template.message_type).startsWith('SUPPLIER_')) {
      throw new Error('communicationLogService.sendToSupplier: template must be a supplier message type.');
    }
    return insertLog({
      tenantId, businessId, supplierId: supplier?.id, nameVar: 'supplier_name', recipientRow: supplier,
      template, variables, referenceType, referenceId, createdBy,
    });
  },
};

// ============================================================
// Phase 8 — WhatsApp without an API (brief §16)
// ============================================================

/**
 * Normalises a Kenyan phone number to the bare international form wa.me
 * needs (2547XXXXXXXX — digits only, no +, no spaces).
 *
 * Returns null when the number can't be normalised with confidence.
 * That is deliberate: a wa.me link built from a wrong number opens a
 * chat with a stranger, or silently fails, and the owner has no way to
 * tell which. Better to refuse and say the number looks wrong.
 *
 * Handles the four shapes Kenyan numbers actually get typed in as:
 *   0712345678 / 0112345678   (local, 10 digits)
 *   712345678  / 112345678    (local without the 0, 9 digits)
 *   254712345678              (international, no +)
 *   +254 712 345 678          (international, punctuated)
 */
export function normalizePhoneForWhatsApp(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;

  // 254 7XXXXXXXX / 254 1XXXXXXXX
  if (digits.length === 12 && digits.startsWith('254') && /^[71]/.test(digits.slice(3))) return digits;
  // 0 7XXXXXXXX / 0 1XXXXXXXX
  if (digits.length === 10 && digits.startsWith('0') && /^[71]/.test(digits.slice(1))) return `254${digits.slice(1)}`;
  // 7XXXXXXXX / 1XXXXXXXX
  if (digits.length === 9 && /^[71]/.test(digits)) return `254${digits}`;

  // Anything else — a non-Kenyan number, a landline, a typo. Don't guess.
  return null;
}

/** Builds the native WhatsApp deep link. Opens the app on mobile, WhatsApp Web on desktop. */
export function buildWhatsAppUrl(phone, message) {
  const normalized = normalizePhoneForWhatsApp(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message || '')}`;
}

export const whatsappService = {
  normalizePhoneForWhatsApp,
  buildWhatsAppUrl,

  /**
   * Prepares a WhatsApp message: renders the template, logs it QUEUED,
   * and returns the row plus the wa.me URL to open.
   *
   * Nothing is sent here. QUEUED means "prepared" — §16's first state.
   * Preparing works with no internet; opening the link doesn't.
   */
  async prepare({ tenantId, businessId, customer, template, variables, referenceType, referenceId, createdBy }) {
    if (!template) throw new Error('whatsappService.prepare: a template is required.');
    if (!customer) throw new Error('whatsappService.prepare: a customer is required.');
    if (template.channel !== 'WHATSAPP') throw new Error('whatsappService.prepare: template must be a WHATSAPP template.');

    const normalized = normalizePhoneForWhatsApp(customer.phone);
    if (!normalized) {
      throw new Error(
        `${customer.name} has no usable WhatsApp number (${customer.phone || 'none on file'}). ` +
        'Add a Kenyan mobile number like 0712345678 on the customer first.'
      );
    }

    const row = await communicationLogService.send({
      tenantId, businessId, customer, template, variables, referenceType, referenceId, createdBy,
    });

    return { log: row, url: buildWhatsAppUrl(customer.phone, row.rendered_message) };
  },

  /**
   * Phase 10 — the supplier equivalent of prepare(). Same three states
   * (QUEUED/OPENED/SENT), same phone-number refusal rule: a wa.me link
   * built from a number that doesn't parse is worse than no link.
   */
  async prepareForSupplier({ tenantId, businessId, supplier, template, variables, referenceType, referenceId, createdBy }) {
    if (!template) throw new Error('whatsappService.prepareForSupplier: a template is required.');
    if (!supplier) throw new Error('whatsappService.prepareForSupplier: a supplier is required.');
    if (template.channel !== 'WHATSAPP') throw new Error('whatsappService.prepareForSupplier: template must be a WHATSAPP template.');

    const normalized = normalizePhoneForWhatsApp(supplier.phone);
    if (!normalized) {
      throw new Error(
        `${supplier.name} has no usable WhatsApp number (${supplier.phone || 'none on file'}). ` +
        'Add a Kenyan mobile number like 0712345678 on the supplier first.'
      );
    }

    const row = await communicationLogService.sendToSupplier({
      tenantId, businessId, supplier, template, variables, referenceType, referenceId, createdBy,
    });

    return { log: row, url: buildWhatsAppUrl(supplier.phone, row.rendered_message) };
  },

  /**
   * §16 state 2 — the wa.me link was opened; WhatsApp/WhatsApp Web launched.
   * This is all this device can actually observe. It does NOT mean the
   * owner pressed Send, and must never be displayed as if it did.
   */
  async markOpened(logId) {
    const { data, error } = await supabase
      .from('lb_communication_log')
      .update({ status: 'OPENED', opened_at: new Date().toISOString() })
      .eq('id', logId)
      .select('*, customer:lb_customers(id, name, phone, email)')
      .single();
    if (error) throw error;
    return data;
  },

  /**
   * §16 state 3 — the owner came back and confirmed they pressed Send.
   * Owner-attested, not observed: there is no WhatsApp API here to
   * confirm it, and the UI labels it "Sent by you" rather than "Sent"
   * for exactly that reason. DELIVERED is never set on this channel.
   */
  async markSentByOwner(logId) {
    const { data, error } = await supabase
      .from('lb_communication_log')
      .update({ status: 'SENT', sent_at: new Date().toISOString() })
      .eq('id', logId)
      .select('*, customer:lb_customers(id, name, phone, email)')
      .single();
    if (error) throw error;
    return data;
  },

  /** Owner says they didn't send it after all — back to prepared, so the history isn't a lie. */
  async markNotSent(logId) {
    const { data, error } = await supabase
      .from('lb_communication_log')
      .update({ status: 'QUEUED', sent_at: null })
      .eq('id', logId)
      .select('*, customer:lb_customers(id, name, phone, email)')
      .single();
    if (error) throw error;
    return data;
  },
};
