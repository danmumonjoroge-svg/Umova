// Resolves the text a message starts with. Pure: give it the data, get text. It never sends and never talks to the network.
//   level 1  system default      communication/templateLibrary.js
//   level 2  school override     a row in lb_communication_templates (purpose = ELIMU_*, channel) — the table every Umova module shares
//   level 3  per-message edit    done in the composer; the generated text is kept beside the final text so "edited" is provable
import { systemTemplate } from './templateLibrary.js';
import { getPurpose } from './purposes.js';
import { firstName } from '../utils/phone.js';

const FIELD = /\{\{\s*([a-z_]+)\s*\}\}/gi;

export function render(text, vars = {}) {
  const missing = new Set();
  const out = String(text ?? '').replace(FIELD, (_, k) => {
    const v = vars[k];
    if (v === undefined || v === null || String(v).trim() === '') { missing.add(k); return ''; }
    return String(v);
  });
  // tidy the gaps an empty field leaves behind
  return { text: out.replace(/[ \t]{2,}/g, ' ').replace(/ +([.,!?])/g, '$1').replace(/\n{3,}/g, '\n\n').trim(), missing: [...missing] };
}

/** Merge values we can know from the records. Anything not known stays empty and is reported as "missing" so the UI can ask. */
export function buildVars({ guardian, student, application, school, klass, extra = {} } = {}) {
  return {
    guardian_name: firstName(guardian?.first_name) ? `${guardian.first_name}` : '',
    student_name: student?.preferred_name || student?.first_name || '',
    admission_no: student?.admission_no || '',
    application_no: application?.application_no || '',
    class_name: klass?.name || student?.class_name || '',
    academic_year: extra.academic_year || '',
    school_name: school?.name || '',
    ...extra,
  };
}

/** overrides: rows of lb_communication_templates (or []). Returns { subject, body, source, templateId, missing }. */
export function resolveTemplate({ purpose, channel, overrides = [], vars = {} }) {
  if (!getPurpose(purpose)) throw new Error(`Unknown purpose ${purpose}`);
  const ch = channel === 'WHATSAPP' ? 'WHATSAPP' : channel;
  const own = overrides.find((t) => t.purpose === purpose && t.channel === ch && t.is_active !== false)
          || (ch === 'WHATSAPP' ? overrides.find((t) => t.purpose === purpose && t.channel === 'SMS' && t.is_active !== false) : null);
  const base = own ? { subject: own.subject || null, body: own.body, source: 'BUSINESS', templateId: own.id } : (() => {
    const sys = systemTemplate(purpose, channel);
    return sys ? { ...sys, templateId: null } : { subject: null, body: '{{guardian_name}}, {{message}}', source: 'SYSTEM', templateId: null };
  })();
  const b = render(base.body, vars);
  const s = base.subject ? render(base.subject, vars) : { text: null, missing: [] };
  return { subject: s.text, body: b.text, source: base.source, templateId: base.templateId, missing: [...new Set([...b.missing, ...s.missing])] };
}
