// services/commEngineService.js
//
// App-side orchestration for the communication engine (phase 50). The rules live in the shared engine
// (utils/comm -> supabase/functions/_shared/comm); this file only talks to Supabase.
//
// Honesty rules (also enforced by the database trigger comm_log_guard):
//   - Preparing a message writes a QUEUED row ("prepared").
//   - Opening WhatsApp/SMS/email on this phone is recorded as OPENED, never SENT.
//   - SENT is only ever set on a manual message when the user confirms they sent it.
//   - SUBMITTED / DELIVERED / READ come only from a provider (server side).
//   - Nothing here touches sales, payments, stock or accounts. A failure here cannot affect them.
import { posSupabase as supabase } from './posSupabaseClient';
import * as C from '../utils/comm';

const LOG_COLS = '*';

export const commEngineService = {
  /** Everything the composer needs for one purpose; pure data in, nothing written. */
  async prepare({ tenantId, businessId, purpose, channel, recipient, reference, inputs, now = new Date() }) {
    const [business, prefs, templates] = await Promise.all([
      C.loaders.loadBusiness(supabase, { tenantId, businessId }),
      C.loaders.loadPrefs(supabase, { tenantId, businessId }),
      C.loaders.loadTemplates(supabase, { tenantId, businessId }),
    ]);
    const tz = business.time_zone || C.DEFAULT_TZ;
    const { recipient: rec, records } = await C.loadForPurpose({ db: supabase, tenantId, purpose, recipient, reference, tz, prefs });
    const result = C.compose({ purpose, channel, business, prefs, templates, recipient: rec, records, inputs, now });
    return { ...result, recipientRecord: rec, business, prefs, refType: reference?.type || null, refId: reference?.id || null, refLabel: reference?.label || null };
  },

  /** Records a prepared message. `final` is what the user will actually send (possibly edited). */
  async record({ tenantId, businessId, userId, composed, final, channel }) {
    const edited = final.body !== composed.body || (final.subject || '') !== (composed.subject || '');
    const row = {
      tenant_id: tenantId, business_id: businessId ?? null,
      customer_id: composed.recipientRecord?.kind === 'CUSTOMER' ? composed.recipientRecord.id : null,
      supplier_id: composed.recipientRecord?.kind === 'SUPPLIER' ? composed.recipientRecord.id : null,
      template_id: composed.templateId || null,
      channel, message_type: composed.purpose, purpose: composed.purpose,
      recipient_kind: composed.recipientRecord?.kind || 'OTHER', recipient_name: composed.recipientRecord?.name || null,
      recipient: final.to || composed.to || null, subject: final.subject || null,
      generated_message: composed.body, rendered_message: final.body, was_edited: edited,
      template_source: composed.source || null, status: 'QUEUED', initiated_by: 'USER',
      reference_type: composed.refType || null, reference_id: composed.refId || null, reference_label: composed.refLabel || null,
      created_by: userId ?? null,
    };
    const { data, error } = await supabase.from('lb_communication_log').insert(row).select(LOG_COLS).single();
    if (error) throw error;
    return data;
  },

  async setStatus(id, status, extra = {}) {
    if (!C.USER_SETTABLE.includes(status)) throw new Error('That status can only be set by the provider.');
    const stamp = { OPENED: { opened_at: new Date().toISOString() }, SENT: { sent_at: new Date().toISOString() } }[status] || {};
    const { data, error } = await supabase.from('lb_communication_log').update({ status, ...stamp, ...extra }).eq('id', id).select(LOG_COLS).single();
    if (error) throw error;
    return data;
  },

  /** Server-side provider send. Never throws for "not configured": returns { ok:false, code } so the UI can offer the phone route. */
  async sendViaProvider(logId) {
    try {
      const { data, error } = await supabase.functions.invoke('comm-send', { body: { log_id: logId } });
      if (error) {
        let body = null; try { body = await error.context?.json?.(); } catch { /* */ }
        return { ok: false, code: body?.error || 'SEND_FAILED', message: body?.message || 'The message could not be sent right now.', retryable: !!body?.retryable };
      }
      return { ok: !!data?.ok, code: data?.error, message: data?.message };
    } catch (e) {
      return { ok: false, code: 'OFFLINE', message: 'No connection. The message is saved as prepared; you can send it when you are back online.', retryable: true };
    }
  },

  /** Phone-native route: returns the URL to open (WhatsApp / SMS app / mail app). */
  deepLink(channel, { to, subject, body }) {
    if (channel === 'WHATSAPP') return to ? `https://wa.me/${String(to).replace(/\D/g, '')}?text=${encodeURIComponent(body)}` : null;
    if (channel === 'SMS') return to ? `sms:${to}?body=${encodeURIComponent(body)}` : null;
    if (channel === 'EMAIL') return to ? `mailto:${to}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body)}` : null;
    return null;
  },

  async history({ tenantId, businessId, customerId, supplierId, referenceId, limit = 100 }) {
    let q = supabase.from('lb_communication_log').select(LOG_COLS).eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(limit);
    if (businessId) q = q.eq('business_id', businessId);
    if (customerId) q = q.eq('customer_id', customerId);
    if (supplierId) q = q.eq('supplier_id', supplierId);
    if (referenceId) q = q.eq('reference_id', referenceId);
    const { data, error } = await q; if (error) throw error; return data || [];
  },

  /** Jobs the scheduler prepared for the owner to review. */
  async toSend({ tenantId, businessId }) {
    let q = supabase.from('lb_comm_jobs').select('*').eq('tenant_id', tenantId).eq('status', 'READY').order('run_at', { ascending: true }).limit(100);
    if (businessId) q = q.eq('business_id', businessId);
    const { data, error } = await q; if (error) throw error; return data || [];
  },
  async completeJob(id, logId) {
    const { error } = await supabase.from('lb_comm_jobs').update({ status: 'DONE', log_id: logId || null }).eq('id', id); if (error) throw error;
  },
  async dismissJob(id) {
    const { error } = await supabase.from('lb_comm_jobs').update({ status: 'CANCELLED' }).eq('id', id); if (error) throw error;
  },

  // ---- preferences & templates ------------------------------------------------------------------
  async getPrefs({ tenantId, businessId }) { return C.loaders.loadPrefs(supabase, { tenantId, businessId }); },
  async savePrefs({ tenantId, businessId, settings, userId }) {
    const { error } = await supabase.from('lb_comm_preferences').upsert({ tenant_id: tenantId, business_id: businessId, settings, updated_by: userId ?? null, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,business_id' });
    if (error) throw error;
  },
  async listTemplates({ tenantId, businessId }) { return C.loaders.loadTemplates(supabase, { tenantId, businessId }); },
  /** Saves the business's own wording for a purpose+channel. Friendly {Customer name} tokens are converted back. */
  async saveTemplate({ tenantId, businessId, purpose, channel, subject, body, userId }) {
    const payload = { tenant_id: tenantId, business_id: businessId, purpose, message_type: purpose, channel, subject: channel === 'EMAIL' ? (C.fromFriendly(subject || '')) : null, body: C.fromFriendly(body), is_active: true, is_customised: true, updated_by: userId ?? null };
    const { data: existing } = await supabase.from('lb_communication_templates').select('id').eq('tenant_id', tenantId).eq('business_id', businessId).eq('purpose', purpose).eq('channel', channel).maybeSingle();
    const q = existing?.id ? supabase.from('lb_communication_templates').update(payload).eq('id', existing.id) : supabase.from('lb_communication_templates').insert(payload);
    const { error } = await q.select('id').single(); if (error) throw error;
  },
  /** Back to the system default: removes only the business's override. */
  async resetTemplate({ tenantId, businessId, purpose, channel }) {
    const { error } = await supabase.from('lb_communication_templates').update({ is_customised: false, is_active: false }).eq('tenant_id', tenantId).eq('business_id', businessId).eq('purpose', purpose).eq('channel', channel);
    if (error) throw error;
  },
};
