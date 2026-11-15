// supabase/functions/_shared/comm/engine.js
//
// compose(): records + purpose + channel  ->  a ready-to-review message.
//
// The three levels of customisation meet here:
//   1. system default   (library.js)                       - always available
//   2. business template (lb_communication_templates row)  - the owner's saved wording for this business
//   3. this message's edits                                - applied by the UI to the output; NEVER written back
//      to the template (compose() returns plain data and has no way to save anything)

import { buildContext } from './context.js';
import { renderText, smsSanitize, smsInfo, whatsappFormat, contactFor, tidy, emailHtml } from './render.js';
import { DEFAULT_TEMPLATES, DEFAULT_GREETING, DEFAULT_SIGN_OFF, VARIABLE_LABELS, PURPOSE_BY_KEY } from './library.js';
import { normalizePrefs } from './prefs.js';
import { LEGACY_TYPE_TO_PURPOSE, isLegacySeedBody } from './legacy.js';

/** Names older templates used for the same facts, so wording an owner saved earlier keeps working. */
function withLegacyAliases(vars) {
  const v = { ...vars };
  // older templates wrote the currency themselves ("KES {{balance}}"), so aliases carry the bare figure
  const bare = (x) => (typeof x === 'string' ? x.replace(/^[A-Z]{3} /, '') : x);
  const pick = (...ks) => bare(ks.map((k) => v[k]).find((x) => x != null && x !== ''));
  const set = (k, ...from) => { if (v[k] == null || v[k] === '') { const x = pick(...from); if (x != null) v[k] = x; } };
  set('amount', 'due_amount', 'payment_amount', 'total_amount', 'po_total');
  set('balance', 'outstanding_total', 'supplier_balance');
  set('appointment_time', 'appointment_sentence');
  set('reference', 'payment_reference', 'invoice_ref');
  set('order_details', 'po_summary');
  set('invoice_number', 'invoice_ref');
  return v;
}

/** Business template row usable for (purpose, channel)? Returns the row or null. */
export function findBusinessTemplate(rows, purpose, channel) {
  const list = (rows || []).filter((r) => r && r.is_active !== false && r.channel === channel);
  // new-style rows: explicit purpose
  const direct = list.find((r) => r.purpose === purpose && r.is_customised !== false);
  if (direct) return direct;
  // old-style rows: message_type, only when the owner really edited them
  const legacy = list.find((r) => !r.purpose && LEGACY_TYPE_TO_PURPOSE[r.message_type] === purpose && !isLegacySeedBody(r.body));
  return legacy || null;
}

function renderChannel(channel, text) {
  if (channel === 'SMS') return smsSanitize(text);
  if (channel === 'WHATSAPP') return whatsappFormat(text);
  return tidy(text);
}

/**
 * @returns {{
 *   ok:boolean, purpose:string, requestedPurpose:string, switchedNote:string, channel:string,
 *   subject:string, body:string, source:'SYSTEM'|'BUSINESS', templateId:string|null, to:string|null,
 *   sms:object|null, details:{label:string,value:string}[], blocking:{code,message}[], warnings:{code,message}[]
 * }}
 */
export function compose({ purpose, channel, business, prefs: prefsIn, templates = [], recipient, records = {}, inputs = {}, now = new Date() }) {
  const prefs = prefsIn?.timing ? prefsIn : normalizePrefs(prefsIn);
  const meta = PURPOSE_BY_KEY[purpose];
  if (!meta) return { ok: false, purpose, requestedPurpose: purpose, switchedNote: '', channel, subject: '', body: '', source: 'SYSTEM', templateId: null, to: null, sms: null, details: [], blocking: [{ code: 'UNKNOWN_PURPOSE', message: 'This kind of message is not available.' }], warnings: [] };

  const ctx = buildContext({ purpose, channel, business, recipient, records, inputs, now });
  const resolved = DEFAULT_TEMPLATES[ctx.purpose] ? ctx.purpose : 'PAYMENT_BALANCE';
  const blocking = [...ctx.blocking]; const warnings = [...ctx.warnings];

  // greeting / sign-off / payment instructions (a business can set its own; otherwise a channel default)
  const base = { ...ctx.vars };
  const greetingSrc = prefs.greeting || DEFAULT_GREETING[channel];
  const signSrc = prefs.sign_off || DEFAULT_SIGN_OFF[channel];
  base.greeting = renderText(greetingSrc, base).text;
  base.sign_off = renderText(signSrc, base).text;
  base.payment_instructions = renderText(prefs.payment_instructions || '', base).text;
  const vars = withLegacyAliases(base);

  // level 2 (business) then level 1 (system); a business template that cannot be filled falls back to the system one
  const sys = DEFAULT_TEMPLATES[resolved][channel];
  const biz = findBusinessTemplate(templates, resolved, channel);
  let used = sys; let source = 'SYSTEM'; let templateId = null;
  let out = null;
  const attempt = (tpl) => ({ body: renderText(tpl.body, vars, VARIABLE_LABELS), subject: channel === 'EMAIL' ? renderText(tpl.subject || '', vars, VARIABLE_LABELS) : null });
  if (biz) {
    const r = attempt(biz);
    const miss = [...r.body.missing, ...(r.subject?.missing || [])];
    if (!miss.length) { out = r; used = biz; source = 'BUSINESS'; templateId = biz.id || null; }
    else warnings.push({ code: 'TEMPLATE_FALLBACK', message: 'Your saved wording for this message uses details that are not available here, so the standard wording was used.' });
  }
  if (!out) out = attempt(sys);

  const missing = [...new Set([...out.body.missing, ...(out.subject?.missing || [])])];
  // variables that are missing only because the record has no value, e.g. no amount: tell the user plainly
  // if the record already ruled the message out, the gaps are just a consequence: report only the real reason
  if (missing.length && !ctx.blocking.length) blocking.push({ code: 'MISSING_INFO', message: `Some details are missing: ${missing.map((k) => VARIABLE_LABELS[k] || k).join(', ')}.` });

  const body = renderChannel(channel, out.body.text);
  const subject = channel === 'EMAIL' ? tidy(out.subject?.text || '').replace(/\s*\n\s*/g, ' ') : '';

  const to = contactFor(channel, recipient || {});
  if (!to) {
    const what = channel === 'EMAIL' ? 'an email address' : channel === 'WHATSAPP' ? 'a valid WhatsApp number' : 'a valid phone number';
    blocking.push({ code: 'NO_CONTACT', message: `${recipient?.name || 'This contact'} has no ${what} on file. Add it on their profile first.` });
  }

  return {
    ok: blocking.length === 0,
    purpose: ctx.purpose, requestedPurpose: purpose, switchedNote: ctx.switchedNote,
    channel, subject, body, source, templateId,
    to, sms: channel === 'SMS' ? smsInfo(body) : null,
    details: ctx.details, blocking, warnings,
    tz: ctx.tz, usedTemplate: used === sys ? 'system' : 'business',
  };
}

/**
 * Checks the FINAL text (after the user edited it) before it may be recorded or sent.
 * Edits are local to this message: this function never touches a template.
 */
export function checkFinal({ channel, subject, body, to }) {
  const blocking = []; const warnings = [];
  const text = String(body ?? '').trim();
  if (!text) blocking.push({ code: 'EMPTY', message: 'The message is empty.' });
  if (channel === 'EMAIL' && !String(subject ?? '').trim()) blocking.push({ code: 'NO_SUBJECT', message: 'Please give the email a subject.' });
  if (!to) blocking.push({ code: 'NO_CONTACT', message: 'There is no valid contact to send this to.' });
  if (/\{\{|\}\}/.test(`${subject ?? ''}${text}`)) blocking.push({ code: 'BRACES', message: 'The message still contains unfinished placeholders. Please remove the curly brackets.' });
  const leftover = text.match(/\[(Customer name|Supplier name|Amount|Due date|Balance|Total outstanding|Business name|Invoice \/ reference)\]/i);
  if (leftover) warnings.push({ code: 'PLACEHOLDER', message: `The message still says "${leftover[0]}". Replace it before sending.` });
  const sms = channel === 'SMS' ? smsInfo(text) : null;
  if (sms?.unicode) warnings.push({ code: 'UNICODE_SMS', message: 'This SMS has special characters, so each part holds fewer letters (70 instead of 160) and may cost more.' });
  if (sms && sms.segments > 3) warnings.push({ code: 'LONG_SMS', message: `This SMS is ${sms.segments} parts long and will cost more. Consider shortening it, or use WhatsApp.` });
  return { ok: blocking.length === 0, blocking, warnings, sms };
}

export { emailHtml };
