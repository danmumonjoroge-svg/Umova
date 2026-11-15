// supabase/functions/_shared/comm/providers.js
//
// Provider adapters. SERVER-SIDE ONLY: credentials come from environment secrets and never reach the browser.
//
//   SMS       Africa's Talking     AT_USERNAME, AT_API_KEY, [AT_SENDER_ID]       (use AT_USERNAME=sandbox to test)
//   Email     Resend               RESEND_API_KEY, COMM_EMAIL_FROM  e.g. "My Business <no-reply@yourdomain.com>"
//   WhatsApp  Meta Cloud API       WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID      (optional; see note)
//
// NOTE on WhatsApp: the Cloud API only lets a business send free-text messages inside the 24 hours after the
// customer last wrote to it. Anything else needs a template approved by Meta. This adapter sends free text and reports
// Meta's refusal plainly; until templates are set up, WhatsApp stays on the hand-sent route (wa.me), which is also the
// default. Nothing is "delivered" because we asked: delivery comes only from webhooks.
//
// NOT TESTED against the live providers: no credentials were available. The request shapes follow each provider's
// public API documentation and are covered by unit tests with a mocked fetch.
//
// Result: { ok, provider, providerId, transient, code, message }
//   transient = true  -> worth retrying later (network, 5xx, rate limit)
//   transient = false -> will not succeed by retrying (bad number, rejected, not configured)

import { emailHtml } from './render.js';

export const PROVIDER_NAME = { SMS: 'AFRICASTALKING', EMAIL: 'RESEND', WHATSAPP: 'WHATSAPP_CLOUD' };

export function isConfigured(channel, env) {
  const g = (k) => (typeof env === 'function' ? env(k) : env?.[k]);
  if (channel === 'SMS') return !!(g('AT_USERNAME') && g('AT_API_KEY'));
  if (channel === 'EMAIL') return !!(g('RESEND_API_KEY') && g('COMM_EMAIL_FROM'));
  if (channel === 'WHATSAPP') return !!(g('WHATSAPP_TOKEN') && g('WHATSAPP_PHONE_NUMBER_ID'));
  return false;
}

const fail = (provider, code, message, transient = false) => ({ ok: false, provider, providerId: null, transient, code, message });

async function call(fetchFn, url, init, timeoutMs = 20000) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try { return await fetchFn(url, { ...init, signal: ctl?.signal }); } finally { if (t) clearTimeout(t); }
}

export async function sendSms({ to, text, senderId }, { env, fetchFn = fetch }) {
  const g = (k) => (typeof env === 'function' ? env(k) : env?.[k]);
  const P = PROVIDER_NAME.SMS;
  if (!isConfigured('SMS', env)) return fail(P, 'PROVIDER_NOT_CONFIGURED', 'SMS sending is not set up yet.');
  const sandbox = g('AT_USERNAME') === 'sandbox';
  const url = `https://api.${sandbox ? 'sandbox.' : ''}africastalking.com/version1/messaging`;
  const form = new URLSearchParams({ username: g('AT_USERNAME'), to, message: text });
  const from = senderId || g('AT_SENDER_ID');
  if (from) form.set('from', from);
  let res;
  try {
    res = await call(fetchFn, url, { method: 'POST', headers: { apiKey: g('AT_API_KEY'), Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  } catch (e) { return fail(P, 'NETWORK', `Could not reach the SMS provider (${e?.message || e}).`, true); }
  if (res.status >= 500 || res.status === 429) return fail(P, `HTTP_${res.status}`, 'The SMS provider is busy. It will be retried.', true);
  let body = null; try { body = await res.json(); } catch { /* not json */ }
  if (!res.ok) return fail(P, `HTTP_${res.status}`, `The SMS provider refused the request (${res.status}).`, false);
  const r = body?.SMSMessageData?.Recipients?.[0];
  if (!r) return fail(P, 'NO_RECIPIENT_RESULT', body?.SMSMessageData?.Message || 'The SMS provider gave no result for this number.', false);
  // 100 Processed, 101 Sent, 102 Queued = accepted.  Everything else is a refusal for this number.
  if ([100, 101, 102].includes(Number(r.statusCode))) return { ok: true, provider: P, providerId: r.messageId || null, transient: false, code: String(r.statusCode), message: r.status || 'Accepted' };
  const transient = ['InsufficientBalance', 'InternalServerError', 'GatewayError'].includes(r.status) ? r.status !== 'InsufficientBalance' : false;
  return fail(P, String(r.statusCode || r.status), r.status === 'InsufficientBalance' ? 'The SMS account is out of credit.' : `The SMS was not accepted (${r.status || r.statusCode}).`, transient);
}

export async function sendEmail({ to, subject, text, businessName }, { env, fetchFn = fetch }) {
  const g = (k) => (typeof env === 'function' ? env(k) : env?.[k]);
  const P = PROVIDER_NAME.EMAIL;
  if (!isConfigured('EMAIL', env)) return fail(P, 'PROVIDER_NOT_CONFIGURED', 'Email sending is not set up yet.');
  let res;
  try {
    res = await call(fetchFn, 'https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${g('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: businessName ? `${String(businessName).replace(/[<>"]/g, '')} <${/<(.+)>/.exec(g('COMM_EMAIL_FROM'))?.[1] || g('COMM_EMAIL_FROM')}>` : g('COMM_EMAIL_FROM'), to: [to], subject, text, html: emailHtml(text, { businessName }) }),
    });
  } catch (e) { return fail(P, 'NETWORK', `Could not reach the email provider (${e?.message || e}).`, true); }
  let body = null; try { body = await res.json(); } catch { /* */ }
  if (res.status >= 500 || res.status === 429) return fail(P, `HTTP_${res.status}`, 'The email provider is busy. It will be retried.', true);
  if (!res.ok) return fail(P, `HTTP_${res.status}`, body?.message || `The email provider refused the message (${res.status}).`, false);
  return { ok: true, provider: P, providerId: body?.id || null, transient: false, code: 'ACCEPTED', message: 'Accepted' };
}

export async function sendWhatsApp({ to, text }, { env, fetchFn = fetch }) {
  const g = (k) => (typeof env === 'function' ? env(k) : env?.[k]);
  const P = PROVIDER_NAME.WHATSAPP;
  if (!isConfigured('WHATSAPP', env)) return fail(P, 'PROVIDER_NOT_CONFIGURED', 'Automatic WhatsApp sending is not set up.');
  let res;
  try {
    res = await call(fetchFn, `https://graph.facebook.com/v20.0/${g('WHATSAPP_PHONE_NUMBER_ID')}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${g('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: false, body: text } }),
    });
  } catch (e) { return fail(P, 'NETWORK', `Could not reach WhatsApp (${e?.message || e}).`, true); }
  let body = null; try { body = await res.json(); } catch { /* */ }
  if (res.status >= 500 || res.status === 429) return fail(P, `HTTP_${res.status}`, 'WhatsApp is busy. It will be retried.', true);
  if (!res.ok) {
    const code = body?.error?.code;
    const msg = code === 131047 ? 'WhatsApp only allows free-text messages within 24 hours of the customer last writing to you. Send this one from your own WhatsApp, or set up approved message templates.' : (body?.error?.message || `WhatsApp refused the message (${res.status}).`);
    return fail(P, String(code || res.status), msg, false);
  }
  return { ok: true, provider: P, providerId: body?.messages?.[0]?.id || null, transient: false, code: 'ACCEPTED', message: 'Accepted' };
}

export function sendVia(channel, args, ctx) {
  if (channel === 'SMS') return sendSms(args, ctx);
  if (channel === 'EMAIL') return sendEmail(args, ctx);
  if (channel === 'WHATSAPP') return sendWhatsApp(args, ctx);
  return Promise.resolve(fail('NONE', 'BAD_CHANNEL', 'Unknown channel.'));
}
