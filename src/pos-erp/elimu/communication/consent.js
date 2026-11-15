// Consent / eligibility, JS mirror of the database function elimu_contact_eligibility() (006). The DATABASE is authoritative:
// elimu_record_message() refuses ineligible sends. This mirror only lets the UI grey out a button and say why BEFORE the tap.
import { contactFor } from '../utils/phone.js';
import { isEmergency } from './purposes.js';

export const CONSENT = { ALLOWED: 'ALLOWED', OPTED_OUT: 'OPTED_OUT', NOT_ASKED: 'NOT_ASKED' };

const CONSENT_CHANNEL = { SMS: 'SMS', EMAIL: 'EMAIL', WHATSAPP: 'WHATSAPP', CALL: 'PHONE' };

/**
 * guardian: { contacts: [{id, kind, value, is_primary, is_whatsapp}], consent: [{channel, status}] }
 * settings: { require_explicit_consent }
 * Returns { ok, reason, contact, recipient, override }.
 */
export function eligibility({ guardian, channel, purpose, settings = {}, contactId = null }) {
  const kind = channel === 'EMAIL' ? 'EMAIL' : 'PHONE';
  const list = (guardian?.contacts || []).filter((c) => c.kind === kind && (!contactId || c.id === contactId));
  const usable = list.filter((c) => contactFor(channel, kind === 'EMAIL' ? { email: c.value } : { phone: c.value }));
  usable.sort((a, b) => (channel === 'WHATSAPP' ? Number(!!b.is_whatsapp) - Number(!!a.is_whatsapp) : 0) || Number(!!b.is_primary) - Number(!!a.is_primary));
  const contact = usable[0];
  if (!contact) return { ok: false, reason: kind === 'EMAIL' ? 'No email address on record.' : 'No phone number on record.' };
  const status = (guardian.consent || []).find((c) => c.channel === CONSENT_CHANNEL[channel])?.status || CONSENT.NOT_ASKED;
  const emergency = isEmergency(purpose);
  const recipient = contactFor(channel, kind === 'EMAIL' ? { email: contact.value } : { phone: contact.value });
  if (status === CONSENT.OPTED_OUT) {
    return emergency
      ? { ok: true, override: true, contact, recipient, reason: 'Guardian opted out of this channel; allowed for an emergency only.' }
      : { ok: false, contact, reason: 'This guardian has opted out of this channel.' };
  }
  if (status === CONSENT.NOT_ASKED && settings.require_explicit_consent && !emergency) {
    return { ok: false, contact, reason: 'This school requires consent on record before contacting by this channel.' };
  }
  return { ok: true, override: false, contact, recipient };
}

/** Which channels can reach this guardian right now, with the reason for any that cannot. */
export function channelsFor({ guardian, purpose, settings }) {
  return ['SMS', 'WHATSAPP', 'EMAIL', 'CALL'].map((channel) => ({ channel, ...eligibility({ guardian, channel, purpose, settings }) }));
}

export const preferredFirst = (results, preferred) => [...results].sort((a, b) => Number(b.ok) - Number(a.ok) || Number(b.channel === preferred) - Number(a.channel === preferred));
