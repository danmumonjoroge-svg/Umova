// supabase/functions/_shared/comm/sender.js
//
// Sends ONE prepared outbox row through the right provider and records exactly what the provider said.
// Used by comm-send (a person pressed Send) and comm-dispatch (an authorised automation).
// `svc` is the service-role client. It only ever updates lb_communication_log; it never touches a business record.

import { sendVia, isConfigured, PROVIDER_NAME } from './providers.js';

export function nextRetryDelayMinutes(attempts) {
  return [5, 15, 60, 240][Math.min(Math.max(attempts, 1), 4) - 1];
}
export const MAX_ATTEMPTS = 4;

/**
 * @returns {{ state: 'SUBMITTED'|'FAILED'|'NOT_CONFIGURED', transient?: boolean, code?: string, message?: string }}
 */
export async function sendLogRow({ svc, row, env, fetchFn, businessName, senderId }) {
  if (!isConfigured(row.channel, env)) return { state: 'NOT_CONFIGURED', code: 'PROVIDER_NOT_CONFIGURED', message: `${row.channel === 'EMAIL' ? 'Email' : row.channel === 'SMS' ? 'SMS' : 'WhatsApp'} sending is not set up on the server yet.` };
  const to = row.recipient;
  const res = await sendVia(row.channel, { to, text: row.rendered_message, subject: row.subject, businessName, senderId }, { env, fetchFn });
  const now = new Date().toISOString();
  if (res.ok) {
    await svc.from('lb_communication_log').update({
      provider: res.provider, provider_message_id: res.providerId, status: 'SUBMITTED', submitted_at: now,
      attempts: (row.attempts || 0) + 1, failure_reason: null, error_code: null,
    }).eq('id', row.id);
    return { state: 'SUBMITTED' };
  }
  await svc.from('lb_communication_log').update({
    provider: res.provider, status: 'FAILED', attempts: (row.attempts || 0) + 1, failure_reason: res.message, error_code: res.code,
  }).eq('id', row.id);
  return { state: 'FAILED', transient: res.transient, code: res.code, message: res.message };
}

export { PROVIDER_NAME };
