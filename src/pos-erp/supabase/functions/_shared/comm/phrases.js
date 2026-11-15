// supabase/functions/_shared/comm/phrases.js
//
// Wording that depends on WHEN something happens. Kept out of the editable templates on purpose: an owner can
// reword a template freely, and the timing sentence inside it is still always correct for today's date.
// Every sentence is chosen from the date state; no example date or number is written into any string.

import { dateContext, daysLabel } from './dateContext.js';

export function formatMoney(amount, currency = 'KES') {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  const fixed = Math.abs(n).toFixed(2).replace(/\.00$/, '');
  const [whole, frac] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${n < 0 ? '-' : ''}${currency} ${grouped}${frac ? `.${frac}` : ''}`;
}

const ofAmount = (amount, currency) => (amount != null && Number(amount) > 0 ? ` of ${formatMoney(amount, currency)}` : '');

/**
 * "When is it" for an appointment. `ctx` comes from dateContext({date,time,now,tz}).
 */
export function appointmentWhen(ctx, { verb = 'is scheduled for' } = {}) {
  if (!ctx?.valid) return '';
  const at = ctx.timeLabel ? `, at ${ctx.timeLabel}` : '';
  switch (ctx.state) {
    case 'TOMORROW': return `tomorrow, ${ctx.dateLong}${at}`;
    case 'TODAY': return `today, ${ctx.dateLong}${at}`;
    default: return `${ctx.dateLongWithWeekday}${at}`;
  }
}

export function appointmentSentence(ctx, { subject = 'Your appointment' } = {}) {
  if (!ctx?.valid) return '';
  const was = ctx.state === 'PAST' || ctx.timePassed;
  return `${subject} ${was ? 'was scheduled for' : 'is scheduled for'} ${appointmentWhen(ctx)}.`;
}

/**
 * Customer payment timing sentence. `due` = dateContext of the REAL due date.
 *   future:   "Your payment is due on 9 November 2026."
 *   tomorrow: "Your payment is due tomorrow, 8 November 2026."
 *   today:    "Your payment of KES 8,500 is due today, 7 November 2026."
 *   overdue:  "Your payment was due on 6 November 2026 and is now overdue."
 */
export function paymentSentence(due, { amount, currency = 'KES' } = {}) {
  if (!due?.valid) return '';
  const of = ofAmount(amount, currency);
  switch (due.state) {
    case 'PAST': return `Your payment${of} was due on ${due.dateLong} and is now overdue.`;
    case 'TODAY': return `Your payment${of} is due today, ${due.dateLong}.`;
    case 'TOMORROW': return `Your payment${of} is due tomorrow, ${due.dateLong}.`;
    default: return `Your payment${of} is due on ${due.dateLong}.`;
  }
}

/** "3 days overdue" / "due in 2 days" / "due today" — a short tag for lists and statements. */
export function paymentTag(due) {
  if (!due?.valid) return '';
  if (due.state === 'PAST') return `${daysLabel(due.daysOverdue)} overdue`;
  if (due.state === 'TODAY') return 'due today';
  return `due in ${daysLabel(due.daysRemaining)}`;
}

/**
 * Supplier delivery timing sentence, from the EFFECTIVE date (revised if there is one).
 *   overdue: "Your delivery is now 1 day overdue. Kindly confirm when we should expect the goods."
 */
export function deliverySentence(eff, { subject = 'Your delivery' } = {}) {
  if (!eff?.valid) return '';
  switch (eff.state) {
    case 'PAST': return `${subject} is now ${daysLabel(eff.daysOverdue)} overdue. Kindly confirm when we should expect the goods.`;
    case 'TODAY': return `${subject} is due today, ${eff.dateLong}.`;
    case 'TOMORROW': return `${subject} is due tomorrow, ${eff.dateLong}.`;
    default: return `${subject} is due on ${eff.dateLong}.`;
  }
}

/** Only present when the date was revised; the original date is kept for the record. */
export function revisionSentence(original, revised) {
  if (!original?.valid || !revised?.valid || original.date === revised.date) return '';
  return `The delivery date was revised from ${original.dateLong} to ${revised.dateLong}.`;
}

export function rescheduleSentence(prev, next) {
  if (!next?.valid) return '';
  const moved = `Your appointment has been moved to ${appointmentWhen(next)}.`;
  if (!prev?.valid || (prev.date === next.date && prev.time === next.time)) return moved;
  return `${moved} It was previously ${prev.dateLong}${prev.timeLabel ? `, at ${prev.timeLabel}` : ''}.`;
}

export { dateContext };
