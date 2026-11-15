// supabase/functions/_shared/comm/prefs.js
//
// Per-business communication & notification preferences (stored in lb_comm_preferences, one row per business).
// This file only DEFINES the shape and fills defaults; it holds no business identity.

export const AUTOMATION_MODES = ['OFF', 'DRAFT', 'AUTO'];
export const MODE_LABEL = { OFF: 'Off', DRAFT: 'Prepare for me to review', AUTO: 'Send automatically' };

// Each automation is one business event. DRAFT = the system prepares the message and tells the owner; the owner
// reviews and sends. AUTO = sent by the server without anyone opening the app (needs a provider, and only when
// someone with settings permission has switched it on).
export const AUTOMATIONS = [
  { key: 'PAYMENT_RECEIVED', label: 'Customer payment received', hint: 'Thank the customer when a payment is recorded', audience: 'CUSTOMER', channel: 'WHATSAPP', mode: 'DRAFT' },
  { key: 'PAYMENT_REMINDER', label: 'Customer payment reminders', hint: 'Before the due date, on it, and when overdue', audience: 'CUSTOMER', channel: 'WHATSAPP', mode: 'DRAFT' },
  { key: 'APPOINTMENT_REMINDER', label: 'Appointment reminders', hint: 'Shortly before the appointment', audience: 'CUSTOMER', channel: 'WHATSAPP', mode: 'DRAFT' },
  { key: 'APPOINTMENT_RESCHEDULED', label: 'Appointment rescheduled', hint: 'Tell the customer the new time', audience: 'CUSTOMER', channel: 'WHATSAPP', mode: 'DRAFT' },
  { key: 'APPOINTMENT_CANCELLED', label: 'Appointment cancelled', hint: 'Tell the customer it is cancelled', audience: 'CUSTOMER', channel: 'WHATSAPP', mode: 'DRAFT' },
  { key: 'SUPPLIER_PURCHASE_CONFIRMATION', label: 'Purchase order created', hint: 'Confirm the order with the supplier', audience: 'SUPPLIER', channel: 'WHATSAPP', mode: 'DRAFT' },
  { key: 'SUPPLIER_DELIVERY_REMINDER', label: 'Supplier delivery follow-up', hint: 'Flag late deliveries and prepare a follow-up', audience: 'SUPPLIER', channel: 'WHATSAPP', mode: 'DRAFT' },
  { key: 'SUPPLIER_PAYMENT_CONFIRMATION', label: 'Supplier payment made', hint: 'Confirm to the supplier that we paid', audience: 'SUPPLIER', channel: 'WHATSAPP', mode: 'OFF' },
  { key: 'SUPPLIER_GOODS_RECEIVED', label: 'Goods received', hint: 'Tell the supplier the goods arrived', audience: 'SUPPLIER', channel: 'WHATSAPP', mode: 'OFF' },
  { key: 'DAILY_SALES_SUMMARY', label: 'Daily sales summary', hint: 'Sent to the owner each evening', audience: 'OWNER', channel: 'WHATSAPP', mode: 'OFF' },
  { key: 'LOW_STOCK_NOTIFICATION', label: 'Low-stock summary', hint: 'Sent to the owner each morning', audience: 'OWNER', channel: 'WHATSAPP', mode: 'OFF' },
];
export const AUTOMATION_BY_KEY = Object.fromEntries(AUTOMATIONS.map((a) => [a.key, a]));

export const DEFAULT_PREFS = {
  greeting: '',
  sign_off: '',
  payment_instructions: '',
  default_credit_days: 0,
  sms_sender_id: '',
  timing: {
    payment_lead_days: 2,          // upcoming payment reminder this many days before the due date
    overdue_repeat_days: 7,        // first overdue reminder the day after; then every this many days
    overdue_max_reminders: 3,
    appointment_lead_hours: 24,
    delivery_lead_days: 1,
    delivery_overdue_repeat_days: 3,
    delivery_overdue_max_reminders: 3,
    daily_summary_hour: 19,
    low_stock_hour: 8,
  },
  quiet_hours: { start: '20:00', end: '07:00' },
  automations: Object.fromEntries(AUTOMATIONS.map((a) => [a.key, { mode: a.mode, channel: a.channel }])),
  notifications: { payments_received: true, upcoming_payments: true, overdue_balances: true, delayed_deliveries: true, appointments: true, low_stock: true },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function merge(base, over) {
  if (!isObj(over)) return base;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = isObj(base[k]) && isObj(over[k]) ? merge(base[k], over[k]) : over[k] === undefined ? base[k] : over[k];
  return out;
}

/** Row from lb_comm_preferences (or null) -> complete preferences. Unknown/invalid values fall back to defaults. */
export function normalizePrefs(row) {
  const raw = row?.settings && isObj(row.settings) ? row.settings : isObj(row) ? row : {};
  const p = merge(DEFAULT_PREFS, raw);
  for (const a of AUTOMATIONS) {
    const cur = p.automations[a.key] || {};
    p.automations[a.key] = {
      mode: AUTOMATION_MODES.includes(cur.mode) ? cur.mode : a.mode,
      channel: ['WHATSAPP', 'SMS', 'EMAIL'].includes(cur.channel) ? cur.channel : a.channel,
    };
  }
  const num = (v, d, min, max) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d; };
  const t = p.timing;
  t.payment_lead_days = num(t.payment_lead_days, 2, 0, 30);
  t.overdue_repeat_days = num(t.overdue_repeat_days, 7, 1, 60);
  t.overdue_max_reminders = num(t.overdue_max_reminders, 3, 1, 12);
  t.appointment_lead_hours = num(t.appointment_lead_hours, 24, 1, 168);
  t.delivery_lead_days = num(t.delivery_lead_days, 1, 0, 14);
  t.delivery_overdue_repeat_days = num(t.delivery_overdue_repeat_days, 3, 1, 30);
  t.delivery_overdue_max_reminders = num(t.delivery_overdue_max_reminders, 3, 1, 12);
  t.daily_summary_hour = num(t.daily_summary_hour, 19, 0, 23);
  t.low_stock_hour = num(t.low_stock_hour, 8, 0, 23);
  p.default_credit_days = num(p.default_credit_days, 0, 0, 365);
  return p;
}
