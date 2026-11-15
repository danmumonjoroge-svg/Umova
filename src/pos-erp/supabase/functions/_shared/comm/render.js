// supabase/functions/_shared/comm/render.js
//
// Rendering and channel formatting: variable substitution, SMS length/segments, WhatsApp spacing,
// email HTML, phone numbers, and the friendly <-> technical variable round trip used by the template editor.

// ---------- variable substitution ----------
// {{name}}  required: if empty it is reported in `missing` (and shown as [name] in the text)
// {{name?}} optional: if empty, the whole line it sits on is dropped
const VAR = /\{\{\s*([a-zA-Z0-9_]+)(\?)?\s*\}\}/g;

export function renderText(body, vars = {}, labels = {}) {
  const missing = [];
  const lines = String(body ?? '').split('\n');
  const out = [];
  for (const line of lines) {
    let dropLine = false;
    const text = line.replace(VAR, (_m, key, optional) => {
      const v = vars[key];
      const has = v !== undefined && v !== null && String(v).trim() !== '';
      if (has) return String(v);
      if (optional) { dropLine = true; return ''; }
      if (!missing.includes(key)) missing.push(key);
      return `[${labels[key] || key.replace(/_/g, ' ')}]`;
    });
    if (!dropLine) out.push(text);
  }
  return { text: tidy(out.join('\n')), missing };
}

/** Collapse 3+ blank lines to one, trim trailing spaces and ends. */
export function tidy(text) {
  return String(text ?? '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

export function variablesIn(body) {
  const found = [];
  String(body ?? '').replace(VAR, (_m, key) => { if (!found.includes(key)) found.push(key); return ''; });
  return found;
}

// ---------- friendly editing (no {{technical}} variables shown to ordinary users) ----------
export function toFriendly(body, labels = {}) {
  return String(body ?? '').replace(VAR, (_m, key, optional) => `[${labels[key] || key.replace(/_/g, ' ')}${optional ? '?' : ''}]`);
}
export function fromFriendly(text, labels = {}) {
  const byLabel = new Map(Object.entries(labels).map(([k, v]) => [String(v).toLowerCase(), k]));
  return String(text ?? '').replace(/\[([^\[\]\n]{1,40}?)(\?)?\]/g, (m, label, optional) => {
    const key = byLabel.get(label.trim().toLowerCase());
    return key ? `{{${key}${optional ? '?' : ''}}}` : m;
  });
}

// ---------- SMS ----------
const GSM7 = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'.split(''),
);
const GSM7_EXT = new Set('^{}\\[~]|€'.split(''));

/** Replace typographic characters that would force a (costlier) Unicode SMS with plain equivalents. */
export function smsSanitize(text) {
  return String(text ?? '')
    .replace(/[‘’‛]/g, "'").replace(/[“”‟]/g, '"')
    .replace(/[–—]/g, '-').replace(/…/g, '...').replace(/ /g, ' ')
    .replace(/[•·]/g, '-');
}

/** Encoding, length and number of SMS parts. Pure arithmetic, no provider needed. */
export function smsInfo(text) {
  const chars = Array.from(String(text ?? ''));
  let gsm = true; let units = 0;
  for (const ch of chars) {
    if (GSM7.has(ch)) units += 1;
    else if (GSM7_EXT.has(ch)) units += 2;
    else { gsm = false; break; }
  }
  if (!gsm) {
    // UCS-2: astral characters (emoji) take two units
    units = chars.reduce((n, ch) => n + (ch.codePointAt(0) > 0xffff ? 2 : 1), 0);
  }
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  const segments = units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / multi);
  const perSegment = segments <= 1 ? single : multi;
  const capacity = segments <= 1 ? single : segments * multi;
  return { encoding: gsm ? 'GSM-7' : 'Unicode', length: units, characters: chars.length, segments, perSegment, remaining: Math.max(0, capacity - units), unicode: !gsm };
}

// ---------- WhatsApp ----------
/** Readable spacing: no leading indents, single blank lines between blocks, *bold* kept as written. */
export function whatsappFormat(text) {
  return tidy(String(text ?? '').split('\n').map((l) => l.replace(/^[ \t]+/, '')).join('\n'));
}

// ---------- email ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain-text email body -> simple, clean HTML (paragraphs, "Label: value" rows kept as lines). */
export function emailHtml(text, { businessName = '' } = {}) {
  const blocks = String(text ?? '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const body = blocks.map((b) => `<p style="margin:0 0 14px;line-height:1.55">${esc(b).replace(/\n/g, '<br>')}</p>`).join('');
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f6f4ea"><div style="max-width:560px;margin:0 auto;padding:20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#23382B;background:#ffffff">${body}${businessName ? `<p style="margin:18px 0 0;font-size:12px;color:#8a8a7a">Sent by ${esc(businessName)}</p>` : ''}</div></body></html>`;
}

// ---------- phone numbers & email addresses ----------
/**
 * E.164 digits (no +) for a number we can trust, else null. Kenyan shapes (0712..., 712..., 254712..., +254 712...)
 * plus any explicit +<country code> international number. Never guesses: a wrong number messages a stranger.
 */
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

/** The contact a channel needs, normalised; null when the record has none usable. */
export function contactFor(channel, { phone, email } = {}) {
  if (channel === 'EMAIL') return isValidEmail(email) ? email.trim() : null;
  const ms = normalizeMsisdn(phone);
  return ms ? (channel === 'SMS' ? `+${ms}` : ms) : null;
}

export function firstName(name) {
  const n = String(name ?? '').trim();
  return n ? n.split(/\s+/)[0] : '';
}
