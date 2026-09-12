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
];

function renderTemplate(body, variables) {
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

  /** Seeds the §52 default set for a business if it has none yet — idempotent. */
  async ensureDefaults({ tenantId, businessId, createdBy }) {
    const existing = await this.getAll({ businessId });
    if (existing.length > 0) return existing;
    const rows = DEFAULT_TEMPLATES.map(t => ({ ...t, tenant_id: tenantId, business_id: businessId ?? null, created_by: createdBy ?? null }));
    const { data, error } = await supabase.from('lb_communication_templates').insert(rows).select();
    if (error) throw error;
    return data || [];
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

export const communicationLogService = {
  async getHistory({ businessId, customerId, limit = 100 } = {}) {
    let q = supabase
      .from('lb_communication_log')
      .select('*, customer:lb_customers(id, name, phone, email)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (businessId) q = q.eq('business_id', businessId);
    if (customerId) q = q.eq('customer_id', customerId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  /**
   * Renders `template` against `variables` and queues it — the ONLY
   * write path onto lb_communication_log. Never sends anything.
   * @returns {Promise<object>} the new lb_communication_log row (status: 'QUEUED')
   */
  async send({ tenantId, businessId, customer, template, variables, referenceType, referenceId, createdBy }) {
    if (!template) throw new Error('communicationLogService.send: a template is required.');
    if (!customer) throw new Error('communicationLogService.send: a customer is required.');

    const mergedVariables = { customer_name: customer.name, ...variables };
    const rendered = renderTemplate(template.body, mergedVariables);
    const recipient = template.channel === 'EMAIL' ? customer.email : customer.phone;

    const { data, error } = await supabase
      .from('lb_communication_log')
      .insert({
        tenant_id: tenantId,
        business_id: businessId ?? null,
        customer_id: customer.id,
        template_id: template.id,
        channel: template.channel,
        message_type: template.message_type,
        recipient: recipient || null,
        rendered_message: rendered,
        status: 'QUEUED',
        reference_type: referenceType || null,
        reference_id: referenceId || null,
        created_by: createdBy ?? null,
      })
      .select('*, customer:lb_customers(id, name, phone, email)')
      .single();
    if (error) throw error;
    return data;
  },
};
