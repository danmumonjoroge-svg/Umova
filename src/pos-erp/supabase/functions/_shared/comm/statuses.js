// supabase/functions/_shared/comm/statuses.js
//
// What each channel can honestly CONFIRM. The history must never claim more than the channel observed.
//
//   QUEUED     prepared (nothing has left the app)
//   OPENED     the WhatsApp / SMS / mail app was opened on this device (the user may not have pressed Send)
//   SUBMITTED  a provider accepted the message for delivery
//   SENT       WhatsApp/SMS/mail by hand: the user says they sent it (attested).  Provider: the provider says it left.
//   DELIVERED  a provider receipt says it reached the recipient's phone/inbox
//   READ       a provider receipt says it was read (WhatsApp API only)
//   FAILED     the provider (or the send attempt) reported failure
//   CANCELLED  withdrawn before it was sent (for example the debt was paid first)

export const STATUS_ORDER = ['QUEUED', 'OPENED', 'SUBMITTED', 'SENT', 'DELIVERED', 'READ'];
export const TERMINAL = ['DELIVERED', 'READ', 'FAILED', 'CANCELLED'];

// Statuses a signed-in user's session may set by hand. Everything else comes only from the server.
export const USER_SETTABLE = ['QUEUED', 'OPENED', 'SENT', 'FAILED', 'CANCELLED'];
export const PROVIDER_ONLY = ['SUBMITTED', 'DELIVERED', 'READ'];

const BASE = {
  QUEUED: { label: 'Prepared', tone: 'neutral', note: 'Saved, not sent yet.' },
  OPENED: { label: 'Opened', tone: 'warn', note: 'The app was opened. We cannot see whether you pressed Send.' },
  SUBMITTED: { label: 'Submitted', tone: 'info', note: 'Handed to the provider for delivery.' },
  SENT: { label: 'Sent', tone: 'good', note: '' },
  DELIVERED: { label: 'Delivered', tone: 'good', note: 'Confirmed by the provider.' },
  READ: { label: 'Read', tone: 'good', note: 'Confirmed by the provider.' },
  FAILED: { label: 'Failed', tone: 'bad', note: '' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', note: 'Withdrawn before sending.' },
};

/** { label, tone, note } shown to the owner for a log row. */
export function describeStatus(row) {
  const s = String(row?.status || 'QUEUED').toUpperCase();
  const manual = !row?.provider || row.provider === 'MANUAL';
  const ch = row?.channel;
  const base = { ...(BASE[s] || BASE.QUEUED) };
  if (manual) {
    if (s === 'OPENED') { base.label = ch === 'WHATSAPP' ? 'Opened in WhatsApp' : ch === 'SMS' ? 'Opened in Messages' : 'Opened in Mail'; }
    if (s === 'SENT') { base.label = 'Sent by you'; base.note = 'You confirmed this. It is not confirmed by the network.'; }
  } else {
    if (s === 'SENT') base.note = 'The provider reports it has left.';
  }
  if (s === 'FAILED' && row?.failure_reason) base.note = row.failure_reason;
  return base;
}

/** What can be known about delivery for this channel + route, for the "how will I know" hint. */
export function trackingCapability(channel, provider) {
  const manual = !provider || provider === 'MANUAL';
  if (manual) return { delivered: false, read: false, text: 'Sent from your own phone. We can record that you opened it and that you pressed Send, but not whether it was delivered.' };
  if (channel === 'SMS') return { delivered: true, read: false, text: 'We record when the SMS network confirms delivery.' };
  if (channel === 'EMAIL') return { delivered: true, read: false, text: 'We record when the email provider confirms delivery or a bounce.' };
  return { delivered: true, read: true, text: 'We record sent, delivered and read as WhatsApp reports them.' };
}

/** Which "mark" buttons make sense on a hand-sent message. */
export function manualActions(row) {
  if (row?.provider && row.provider !== 'MANUAL') return [];
  const s = row?.status;
  if (s === 'QUEUED') return ['OPEN'];
  if (s === 'OPENED') return ['MARK_SENT', 'MARK_NOT_SENT'];
  if (s === 'SENT') return ['MARK_NOT_SENT'];
  return [];
}
