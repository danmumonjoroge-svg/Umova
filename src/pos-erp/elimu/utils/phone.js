// Pure phone/email helpers. These MIRROR the Umova communication engine (supabase/functions/_shared/comm/render.js) and the
// database function elimu_normalize_msisdn(); tests/js/phone.test.js compares them against the engine's own behaviour.
// Copied rather than imported so this folder has no dependency on the edge-function directory. If the engine changes, the parity test fails.

export function normalizeMsisdn(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 12 && digits.startsWith('254') && /^[71]/.test(digits.slice(3))) return digits;
  if (digits.length === 10 && digits.startsWith('0') && /^[71]/.test(digits.slice(1))) return `254${digits.slice(1)}`;
  if (digits.length === 9 && /^[71]/.test(digits)) return `254${digits}`;
  if ((s.startsWith('+') || s.startsWith('00')) && !digits.startsWith('254')) {
    const intl = s.startsWith('00') ? digits.slice(2) : digits;
    if (intl.length >= 8 && intl.length <= 15 && !intl.startsWith('0')) return intl;
  }
  return null;
}

export function isValidEmail(raw) {
  return typeof raw === 'string' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(raw.trim());
}

export function normalizeEmail(raw) {
  return isValidEmail(raw) ? raw.trim().toLowerCase() : null;
}

/** What each channel needs: sms:+254.., wa.me digits, mailto, tel. Null when the number/address is not usable. */
export function contactFor(channel, { phone, email } = {}) {
  if (channel === 'EMAIL') return isValidEmail(email) ? email.trim() : null;
  const ms = normalizeMsisdn(phone);
  return ms ? (channel === 'SMS' || channel === 'CALL' ? `+${ms}` : ms) : null;
}

/** "0712 345 678" -> "0712 345 678"; used only for display. */
export function displayPhone(raw) {
  const ms = normalizeMsisdn(raw);
  if (!ms) return String(raw ?? '');
  return ms.startsWith('254') && ms.length === 12 ? `0${ms.slice(3, 6)} ${ms.slice(6, 9)} ${ms.slice(9)}` : `+${ms}`;
}

export const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0] || '';
