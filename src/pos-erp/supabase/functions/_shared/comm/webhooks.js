// supabase/functions/_shared/comm/webhooks.js
//
// Turns provider delivery receipts into status updates. A status is only ever recorded because a provider reported it.
// Updates never go backwards (a late "sent" cannot undo "delivered").

const RANK = { QUEUED: 0, OPENED: 1, SUBMITTED: 2, SENT: 3, DELIVERED: 4, READ: 5 };

/** Should `next` replace `current`? FAILED may follow anything but a delivered/read message; nothing replaces FAILED/CANCELLED except a real later delivery. */
export function shouldAdvance(current, next) {
  if (!next) return false;
  if (current === 'DELIVERED' || current === 'READ') return next === 'READ' && current === 'DELIVERED';
  if (next === 'FAILED') return current !== 'CANCELLED';
  if (current === 'FAILED' || current === 'CANCELLED') return next === 'DELIVERED' || next === 'READ';
  return (RANK[next] ?? -1) > (RANK[current] ?? -1);
}

/** Africa's Talking delivery report (form fields). */
export function parseAfricasTalking(form) {
  const id = form.get ? form.get('id') : form.id; const st = String((form.get ? form.get('status') : form.status) || '');
  const reason = (form.get ? form.get('failureReason') : form.failureReason) || '';
  if (!id) return [];
  const s = st.toLowerCase();
  let status = null;
  if (s === 'success' || s === 'delivered') status = 'DELIVERED';
  else if (s === 'sent' || s === 'submitted' || s === 'buffered') status = 'SENT';
  else if (s) status = 'FAILED';
  return status ? [{ provider: 'AFRICASTALKING', id, status, reason: status === 'FAILED' ? (reason || st) : '' }] : [];
}

/** Resend webhook JSON. */
export function parseResend(body) {
  const type = String(body?.type || ''); const id = body?.data?.email_id;
  if (!id) return [];
  const map = { 'email.sent': 'SENT', 'email.delivered': 'DELIVERED', 'email.bounced': 'FAILED', 'email.complained': 'FAILED', 'email.failed': 'FAILED' };
  const status = map[type];
  return status ? [{ provider: 'RESEND', id, status, reason: status === 'FAILED' ? (body?.data?.bounce?.message || type.replace('email.', '')) : '' }] : [];
}

/** WhatsApp Cloud API webhook JSON. */
export function parseWhatsApp(body) {
  const out = [];
  for (const e of body?.entry || []) for (const c of e.changes || []) for (const s of c.value?.statuses || []) {
    const map = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' };
    const status = map[s.status];
    if (s.id && status) out.push({ provider: 'WHATSAPP_CLOUD', id: s.id, status, reason: status === 'FAILED' ? (s.errors?.[0]?.title || s.errors?.[0]?.message || 'failed') : '' });
  }
  return out;
}

export function timingSafeEqual(a, b) {
  const x = new TextEncoder().encode(String(a ?? '')); const y = new TextEncoder().encode(String(b ?? ''));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** X-Hub-Signature-256 check for WhatsApp. */
export async function verifyMetaSignature(rawBody, header, appSecret) {
  if (!appSecret || !header?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(hex, header.slice(7));
}
