// supabase/functions/_shared/comm/legacy.js
//
// The older Messages screen (phase 7/8/10) copied a small set of default templates into every business's
// lb_communication_templates table. Those rows are untouched seeds unless the owner edited them. The new engine
// must not let an untouched old seed shadow the new, date-aware default for the same message, but it must keep
// honouring wording the owner really wrote. This file recognises the old seeds so the two can be told apart.

// message_type (old enum) -> purpose (new). Only unambiguous one-to-one mappings.
export const LEGACY_TYPE_TO_PURPOSE = {
  WELCOME: 'CUSTOMER_WELCOME',
  RECEIPT: 'RECEIPT',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  STATEMENT: 'CUSTOMER_STATEMENT',
  APPOINTMENT_REMINDER: 'APPOINTMENT_REMINDER',
  SUPPLIER_ORDER: 'SUPPLIER_PURCHASE_ORDER',
  SUPPLIER_PAYMENT_SENT: 'SUPPLIER_PAYMENT_CONFIRMATION',
  SUPPLIER_STATEMENT: 'SUPPLIER_STATEMENT',
  SUPPLIER_DELIVERY_REMINDER: 'SUPPLIER_DELIVERY_REMINDER',
  PAYMENT_OVERDUE: 'PAYMENT_OVERDUE',
};

const SEEDS = [
  "Welcome to {{business_name}}, {{customer_name}}! We're glad to have you.",
  'Payment of {{amount}} received. Thank you, {{customer_name}}! New balance: {{balance}}.',
  'Hi {{customer_name}}, a payment of {{amount}} is due on {{due_date}}.',
  '{{customer_name}}, your account with {{business_name}} has an outstanding balance of {{balance}}. Please settle at your earliest convenience.',
  'Thank you for shopping with {{business_name}}! Receipt {{receipt_number}} for {{amount}}. Karibu tena.',
  'Hi {{customer_name}}, your current balance with {{business_name}} is {{balance}}.',
  'Reminder: your appointment at {{business_name}} is at {{appointment_time}}.',
  'Hi {{customer_name}}, welcome to {{business_name}}! Karibu. Save this number so you can reach us any time.',
  'Hi {{customer_name}}, we have received your payment of KES {{amount}}. Thank you! Your balance is now KES {{balance}}. — {{business_name}}',
  'Hi {{customer_name}}, a reminder that your balance with {{business_name}} is KES {{balance}}. Kindly settle when you can. Thank you.',
  'Hi {{customer_name}}, your balance with {{business_name}} is KES {{balance}} and is now overdue. Kindly settle when you can. Thank you.',
  'Hi {{customer_name}}, thank you for shopping with {{business_name}}! Here is your receipt {{receipt_number}} for KES {{amount}}. Karibu tena.',
  'Hi {{customer_name}}, your current balance with {{business_name}} is KES {{balance}}. Reply here if anything looks wrong.',
  'Hi {{customer_name}}, this is a reminder about your appointment at {{business_name}} at {{appointment_time}}. See you then!',
  'Hi {{supplier_name}}, we would like to place an order. Details: {{order_details}}. Please confirm availability. — {{business_name}}',
  'Hi {{supplier_name}}, we have sent a payment of KES {{amount}}. Reference: {{reference}}. Thank you. — {{business_name}}',
  'Hi {{supplier_name}}, our current balance with you is KES {{balance}}. We will settle this shortly. — {{business_name}}',
  'Hi {{supplier_name}}, our current outstanding balance with you is KES {{balance}}. Let us know if this does not match your records.',
  'Hi {{supplier_name}}, checking in on the delivery for our recent order. Please let us know the expected date. Thank you. — {{business_name}}',
];
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const SEED_SET = new Set(SEEDS.map(norm));

/** True when a stored template body is one of the untouched phase 7/8/10 seeds (so it is NOT the owner's wording). */
export function isLegacySeedBody(body) {
  return SEED_SET.has(norm(body));
}
