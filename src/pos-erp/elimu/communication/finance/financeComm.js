// Finance messaging on top of the POS communication engine. NO new engine:
//   rendering / SMS segments / WhatsApp+email formatting / phone validation -> shared engine (utils/comm, render.js)
//   status vocabulary + honesty (QUEUED -> OPENED -> SENT ... never "delivered" unless a provider says so) -> shared statuses
//   provider send (comm-send edge function) + deep links + status updates -> commEngineService
//   the log itself -> lb_communication_log (same table every other message uses)
// Added here: finance purposes/templates, variable building from finance data, and duplicate prevention (elimu_fin_notifications).
import { renderText } from '../../../supabase/functions/_shared/comm/render.js';
import { smsInfo, normalizeMsisdn, isValidEmail, contactFor, whatsappFormat, describeStatus, findBusinessTemplate } from '../../../utils/comm';
import { FINANCE_PURPOSE_BY_KEY, FINANCE_DEFAULT_TEMPLATES, FINANCE_VARIABLE_LABELS, FINANCE_PURPOSES } from '../templates/financeTemplates';
import { toCents, formatMoney } from '../../finance/utils/money';
import { registerPurpose } from '../purposes';

for (const p of FINANCE_PURPOSES) {
  try { registerPurpose({ key: p.key, label: p.label, fields: p.variables || ['guardian_name', 'student_name', 'school_name'] }); } catch (e) { if (!String(e?.message || '').includes('already registered')) throw e; }
}

export const channelsFor = ['SMS', 'WHATSAPP', 'EMAIL'];
const plainMoney = (v) => { try { return formatMoney(toCents(v, { allowNegative: true }), '').trim(); } catch { return String(v ?? ''); } };

/** Build the variable bag. All inputs are optional; anything missing is reported by the renderer, never invented. */
export function buildVars({ school, student, guardian, invoice, payment, receipt, balanceCents, installment, plan, extra = {} } = {}) {
  const v = {
    school_name: school?.name,
    guardian_name: guardian?.name || student?.guardian_name || 'Parent/Guardian',
    student_name: student?.name || student?.full_name,
    admission_number: student?.admission_no || student?.admission_number,
    class_name: student?.class_name,
    term: invoice?.term, academic_year: invoice?.academic_year,
    invoice_number: invoice?.invoice_no, due_date: invoice?.due_date ? longDate(invoice.due_date) : undefined,
    amount: payment?.amount != null ? plainMoney(payment.amount) : invoice?.total != null ? plainMoney(invoice.total) : undefined,
    receipt_number: payment?.receipt_no || receipt?.receipt_no,
    payment_method: payment?.method ? methodLabel(payment.method) : undefined,
    transaction_reference: payment?.transaction_ref,
    balance: balanceCents != null ? plainMoney(balanceCents / 100) : undefined,
    installment_number: installment?.seq, installment_amount: installment?.amount != null ? plainMoney(installment.amount) : undefined,
    ...extra,
  };
  if (installment?.due_date) v.due_date = longDate(installment.due_date);
  if (plan?.total != null) v.amount = plainMoney(plan.total);
  return v;
}
const methodLabel = (m) => ({ CASH: 'cash', MPESA: 'M-Pesa', BANK: 'bank', CHEQUE: 'cheque', OTHER: 'other' }[m] || String(m).toLowerCase());
function longDate(ymd) { const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number); return `${d} ${['January','February','March','April','May','June','July','August','September','October','November','December'][m - 1]} ${y}`; }

/**
 * Compose one message from a template. Pure: writes nothing. Uses a school template when one exists in lb_communication_templates
 * (same lookup the POS uses), otherwise the default.
 * @returns {{purpose,channel,subject,body,to,missing:string[],sms?:object,problems:string[],source}}
 */
export function composeFinanceMessage({ purpose, channel, vars, contact, templates = [] }) {
  const P = FINANCE_PURPOSE_BY_KEY[purpose]; if (!P) throw new Error(`Unknown finance message purpose ${purpose}.`);
  const school = findBusinessTemplate(templates, purpose, channel);
  const def = FINANCE_DEFAULT_TEMPLATES[purpose]?.[channel];
  if (!school && !def) throw new Error(`No ${channel} template for ${purpose}.`);
  const src = school ? { subject: school.subject, body: school.body } : (typeof def === 'string' ? { body: def } : def);
  const body = renderText(src.body, vars, FINANCE_VARIABLE_LABELS);
  const subj = src.subject ? renderText(src.subject, vars, FINANCE_VARIABLE_LABELS) : { text: null, missing: [] };
  const missing = [...new Set([...body.missing, ...subj.missing])];
  const to = contactFor(channel, contact || {});
  const problems = [];
  if (!to) problems.push(channel === 'EMAIL' ? 'No valid email address for the guardian.' : 'No valid phone number for the guardian.');
  if (missing.length) problems.push(`Fill in: ${missing.map(k => FINANCE_VARIABLE_LABELS[k] || k).join(', ')}.`);
  const text = channel === 'WHATSAPP' ? whatsappFormat(body.text) : body.text;
  return { purpose, channel, subject: subj.text, body: text, to, missing, problems, sms: channel === 'SMS' ? smsInfo(text) : undefined, source: school ? 'SCHOOL' : 'DEFAULT' };
}

/** Same notice, same recipient, same channel, same record => same key. A deliberate resend appends a suffix. */
export const eventKey = ({ purpose, referenceId, channel, recipient, resend = 0 }) =>
  [purpose, referenceId || 'none', channel, String(recipient || '').replace(/\s/g, ''), ...(resend ? [`resend:${resend}`] : [])].join('|');

/**
 * Records a reviewed message. Nothing is sent here. Returns the log row (status QUEUED = "prepared").
 * Duplicate: returns {duplicate:true} and does NOT create a second log row.
 * The finance dedupe RPC client and shared guardian-recording adapter are injected so this stays testable.
 */
export async function prepareRecord({ supabase, tenantId, businessId, userId, studentId, guardianId, contactId, composed, final, reference, resend = 0, recordGuardianMessage, fetchLog }) {
  if (composed.problems?.length && !final.to) throw new Error(composed.problems[0]);
  if (final.body !== composed.body && !String(final.body || '').trim()) throw new Error('The message is empty.');
  if (!guardianId) throw new Error('A verified guardian link is required. This finance contact cannot be messaged until it is linked to a guardian record with consent details.');
  if (typeof recordGuardianMessage !== 'function' || typeof fetchLog !== 'function') throw new Error('The shared guardian communication service is required.');
  const key = eventKey({ purpose: composed.purpose, referenceId: reference?.id, channel: composed.channel, recipient: final.to, resend });
  const { data: reg, error: regErr } = await supabase.rpc('elimu_fin_register_notification', {
    p_business: businessId, p_student: studentId, p_purpose: composed.purpose, p_channel: composed.channel, p_recipient: final.to,
    p_reference_type: reference?.type ?? null, p_reference_id: reference?.id ?? null, p_event_key: key, p_comm_log_id: null });
  if (regErr) throw regErr;
  if (reg.duplicate) return { duplicate: true, notificationId: reg.notification_id };
  const recorded = await recordGuardianMessage({
    tenantId, channel: composed.channel, purpose: composed.purpose, guardianId, contactId: contactId || null,
    studentId, subject: final.subject, body: final.body, generated: composed.body,
    templateSource: composed.source || 'ELIMU_FINANCE', referenceLabel: reference?.label || null, status: 'QUEUED',
  });
  const { data: log, error } = await fetchLog(recorded.logId);
  if (error) throw error;
  const { error: attachError } = await supabase.rpc('elimu_fin_attach_comm_log', { p_notification: reg.notification_id, p_comm_log: log.id });
  if (attachError) throw attachError;
  return { duplicate: false, log, notificationId: reg.notification_id };
}

/** What to show next to a message. Uses the engine's own wording: "Prepared", "Opened on this phone", "Delivered" only from a provider. */
export const statusLabel = (row) => describeStatus(row);
export { isValidEmail, normalizeMsisdn };
