// Licensing + support inbox. Staff side: licence status and help log. Owner side (Elimu management page): schools, payments, inbox.
import { supabase, unwrap } from './platform.js';

export const licenceService = {
  async status() { try { return unwrap(await supabase.rpc('elimu_licence_status')) || { state: 'none', blocked: false }; } catch { return { state: 'none', blocked: false }; } },
  async helpLog(channel, message, name) { return unwrap(await supabase.rpc('elimu_help_log', { p_channel: channel, p_message: message || null, p_name: name || null })); },
};
export const ownerService = {
  async isOwner() { try { return !!unwrap(await supabase.rpc('elimu_is_platform_owner')); } catch { return false; } },
  async schools() { return unwrap(await supabase.rpc('elimu_owner_schools')) || []; },
  async setLicence(tenant, f) { return unwrap(await supabase.rpc('elimu_owner_licence_set', { p_tenant: tenant, p_paid_until: f.paid_until || null, p_grace_days: f.grace_days ?? null, p_price: f.price ?? null, p_suspended: f.suspended ?? null, p_reason: f.reason || null, p_note: f.note ?? null })); },
  async pay(tenant, p) { return unwrap(await supabase.rpc('elimu_owner_payment', { p_tenant: tenant, p_amount: Number(p.amount), p_months: Number(p.months), p_reference: p.reference || null, p_method: p.method || null, p_note: p.note || null })); },
  async payments(tenant) { return unwrap(await supabase.rpc('elimu_owner_payments', { p_tenant: tenant })) || []; },
  async inbox(status) { return unwrap(await supabase.rpc('elimu_owner_inbox', { p_status: status || null })) || []; },
  async unread() { try { return unwrap(await supabase.rpc('elimu_owner_unread')) || 0; } catch { return 0; } },
  async setInbox(id, status, note) { return unwrap(await supabase.rpc('elimu_owner_inbox_set', { p_id: id, p_status: status, p_note: note || null })); },
};
// Exported for the pure-function tests.
export const licenceNotice = (s) => {
  if (!s) return null;
  if (s.state === 'grace') return { tone: 'warn', text: `Your school's Elimu subscription is overdue. Please pay within ${s.days_left} day${s.days_left === 1 ? '' : 's'} to avoid the service being stopped.` };
  if (s.state === 'active' && s.days_left != null && s.days_left <= 7) return { tone: 'info', text: `Your school's Elimu subscription is due in ${s.days_left} day${s.days_left === 1 ? '' : 's'}.` };
  return null;
};
