// Elimu finance message PURPOSES and DEFAULT TEMPLATES. Rendering, channel formatting, SMS segmenting, status honesty and provider sending all
// come from the POS communication engine (utils/comm + commEngineService). This file only declares WHAT finance wants to say.
// Syntax is the engine's: {{name}} required (reported as missing), {{name?}} optional (line dropped when empty).
export const FINANCE_VARIABLES = [
  'guardian_name', 'student_name', 'admission_number', 'class_name', 'term', 'academic_year', 'amount', 'balance', 'due_date',
  'receipt_number', 'payment_method', 'transaction_reference', 'school_name',
  // extras used by some purposes
  'invoice_number', 'installment_number', 'installment_amount', 'adjustment_type', 'sponsor_name', 'reason', 'credit_balance',
];
export const FINANCE_VARIABLE_LABELS = {
  guardian_name: 'Guardian name', student_name: 'Student name', admission_number: 'Admission number', class_name: 'Class', term: 'Term',
  academic_year: 'Academic year', amount: 'Amount', balance: 'Balance', due_date: 'Due date', receipt_number: 'Receipt number',
  payment_method: 'Payment method', transaction_reference: 'Transaction reference', school_name: 'School name', invoice_number: 'Invoice number',
  installment_number: 'Instalment number', installment_amount: 'Instalment amount', adjustment_type: 'Type', sponsor_name: 'Sponsor', reason: 'Reason',
  credit_balance: 'Credit balance',
};

const base = (key, label, description, vars, extra = {}) => ({ key, label, description, audience: 'GUARDIAN', module: 'ELIMU_FINANCE', variables: vars, ...extra });
const CORE = ['guardian_name', 'student_name', 'admission_number', 'school_name'];

export const FINANCE_PURPOSES = [
  base('ELIMU_INVOICE_GENERATED', 'Invoice generated', 'Fees have been billed.', [...CORE, 'invoice_number', 'term', 'academic_year', 'amount', 'balance', 'due_date']),
  base('ELIMU_PAYMENT_RECEIVED', 'Payment received (awaiting confirmation)', 'A payment was recorded but is not yet confirmed.', [...CORE, 'amount', 'payment_method', 'transaction_reference']),
  base('ELIMU_PAYMENT_CONFIRMED', 'Payment confirmed', 'Money confirmed and applied to the account.', [...CORE, 'amount', 'balance', 'receipt_number', 'payment_method', 'transaction_reference']),
  base('ELIMU_RECEIPT_ISSUED', 'Receipt issued', 'Sends the receipt details.', [...CORE, 'amount', 'balance', 'receipt_number', 'payment_method', 'class_name']),
  base('ELIMU_INSTALLMENT_REMINDER', 'Instalment approaching', 'Friendly reminder before an instalment is due.', [...CORE, 'installment_number', 'installment_amount', 'due_date', 'balance']),
  base('ELIMU_INSTALLMENT_OVERDUE', 'Instalment overdue', 'An agreed instalment has passed its date.', [...CORE, 'installment_number', 'installment_amount', 'due_date', 'balance']),
  base('ELIMU_BALANCE_REMINDER', 'Outstanding balance', 'States the balance. No penalties are mentioned.', [...CORE, 'balance', 'class_name', 'term', 'academic_year', 'due_date']),
  base('ELIMU_PLAN_APPROVED', 'Payment arrangement approved', 'A payment plan was agreed.', [...CORE, 'amount', 'installment_number', 'due_date']),
  base('ELIMU_SCHOLARSHIP_AWARDED', 'Scholarship awarded', 'A scholarship was applied.', [...CORE, 'amount', 'balance', 'term', 'academic_year']),
  base('ELIMU_BURSARY_RECEIVED', 'Bursary received', 'A bursary was received and credited.', [...CORE, 'amount', 'sponsor_name', 'balance']),
  base('ELIMU_REFUND_PROCESSED', 'Refund processed', 'A refund was approved and paid.', [...CORE, 'amount', 'payment_method', 'transaction_reference', 'balance']),
  base('ELIMU_PAYMENT_REVERSED', 'Payment reversed', 'A payment was reversed after approval.', [...CORE, 'amount', 'receipt_number', 'reason', 'balance']),
];
export const FINANCE_PURPOSE_BY_KEY = Object.fromEntries(FINANCE_PURPOSES.map(p => [p.key, p]));

const sign = '\n{{school_name}}';
export const FINANCE_DEFAULT_TEMPLATES = {
  ELIMU_INVOICE_GENERATED: {
    SMS: 'Dear {{guardian_name}}, fees invoice {{invoice_number}} of KES {{amount}} has been issued for {{student_name}} ({{admission_number}}), {{term?}} {{academic_year?}}. Balance KES {{balance}}, due {{due_date}}. {{school_name}}.',
    WHATSAPP: 'Dear {{guardian_name}},\n\nA fees invoice ({{invoice_number}}) of *KES {{amount}}* has been issued for {{student_name}} ({{admission_number}}).\nTerm: {{term?}} {{academic_year?}}\nOutstanding balance: *KES {{balance}}*\nDue date: {{due_date}}\n\nThank you.' + sign,
    EMAIL: { subject: 'Fees invoice {{invoice_number}} - {{student_name}}', body: 'Dear {{guardian_name}},\n\nA fees invoice ({{invoice_number}}) of KES {{amount}} has been issued for {{student_name}} ({{admission_number}}).\nOutstanding balance: KES {{balance}}. Due date: {{due_date}}.\n\nThank you.' + sign },
  },
  ELIMU_PAYMENT_RECEIVED: {
    SMS: 'Dear {{guardian_name}}, we have noted your {{payment_method}} payment of KES {{amount}} for {{student_name}} ({{admission_number}}), ref {{transaction_reference?}}. It will be confirmed shortly. {{school_name}}.',
    WHATSAPP: 'Dear {{guardian_name}},\n\nWe have noted your {{payment_method}} payment of *KES {{amount}}* for {{student_name}} ({{admission_number}}).\nReference: {{transaction_reference?}}\nIt will be confirmed shortly and a receipt sent.\n\nThank you.' + sign,
    EMAIL: { subject: 'Payment noted - {{student_name}}', body: 'Dear {{guardian_name}},\n\nWe have noted your {{payment_method}} payment of KES {{amount}} for {{student_name}} ({{admission_number}}). It will be confirmed shortly.\n\nThank you.' + sign },
  },
  ELIMU_PAYMENT_CONFIRMED: {
    SMS: 'Dear {{guardian_name}}, payment of KES {{amount}} has been received for {{student_name}} ({{admission_number}}). Your outstanding school fee balance is KES {{balance}}. Thank you. {{school_name}}.',
    WHATSAPP: 'Dear {{guardian_name}},\n\nPayment of *KES {{amount}}* has been received for {{student_name}} ({{admission_number}}).\nReceipt: {{receipt_number}}\nOutstanding school fee balance: *KES {{balance}}*\n\nThank you.' + sign,
    EMAIL: { subject: 'Payment received - {{student_name}} - {{receipt_number}}', body: 'Dear {{guardian_name}},\n\nPayment of KES {{amount}} has been received for {{student_name}} ({{admission_number}}).\nReceipt number: {{receipt_number}}\nOutstanding school fee balance: KES {{balance}}.\n\nThank you.' + sign },
  },
  ELIMU_RECEIPT_ISSUED: {
    SMS: 'Receipt {{receipt_number}}: KES {{amount}} received via {{payment_method}} for {{student_name}} ({{admission_number}}). Balance KES {{balance}}. {{school_name}}.',
    WHATSAPP: '*Receipt {{receipt_number}}*\n{{student_name}} ({{admission_number}}), {{class_name?}}\nAmount: *KES {{amount}}* via {{payment_method}}\nBalance: KES {{balance}}\n\nThank you.' + sign,
    EMAIL: { subject: 'Receipt {{receipt_number}} - {{student_name}}', body: 'Dear {{guardian_name}},\n\nReceipt {{receipt_number}}: KES {{amount}} received via {{payment_method}} for {{student_name}} ({{admission_number}}).\nBalance: KES {{balance}}.\n\nThank you.' + sign },
  },
  ELIMU_INSTALLMENT_REMINDER: {
    SMS: 'Dear {{guardian_name}}, a reminder that instalment {{installment_number}} of KES {{installment_amount}} for {{student_name}} ({{admission_number}}) is due on {{due_date}}. {{school_name}}.',
    WHATSAPP: 'Dear {{guardian_name}},\n\nA friendly reminder: instalment {{installment_number}} of *KES {{installment_amount}}* for {{student_name}} ({{admission_number}}) is due on {{due_date}}.\n\nThank you.' + sign,
    EMAIL: { subject: 'Instalment reminder - {{student_name}}', body: 'Dear {{guardian_name}},\n\nInstalment {{installment_number}} of KES {{installment_amount}} for {{student_name}} ({{admission_number}}) is due on {{due_date}}.\n\nThank you.' + sign },
  },
  ELIMU_INSTALLMENT_OVERDUE: {
    SMS: 'Dear {{guardian_name}}, instalment {{installment_number}} of KES {{installment_amount}} for {{student_name}} ({{admission_number}}) was due on {{due_date}}. If you have already paid, please ignore this. Please contact the bursar if you need to adjust the plan. {{school_name}}.',
    WHATSAPP: 'Dear {{guardian_name}},\n\nInstalment {{installment_number}} of *KES {{installment_amount}}* for {{student_name}} ({{admission_number}}) was due on {{due_date}}.\nIf you have already paid, please ignore this message. If you need to adjust the plan, please contact the bursar.\n\nThank you.' + sign,
    EMAIL: { subject: 'Instalment past due date - {{student_name}}', body: 'Dear {{guardian_name}},\n\nInstalment {{installment_number}} of KES {{installment_amount}} for {{student_name}} ({{admission_number}}) was due on {{due_date}}. If you have already paid, please disregard this. If you need to adjust the plan, please contact the bursar.\n\nThank you.' + sign },
  },
  ELIMU_BALANCE_REMINDER: {
    SMS: 'Dear {{guardian_name}}, the school fee balance for {{student_name}} ({{admission_number}}) is KES {{balance}}. If you have already paid, please ignore this. {{school_name}}.',
    WHATSAPP: 'Dear {{guardian_name}},\n\nThe school fee balance for {{student_name}} ({{admission_number}}), {{class_name?}} is *KES {{balance}}*.\nIf you have already paid, please ignore this message. Please contact the bursar if you would like to discuss a payment plan.\n\nThank you.' + sign,
    EMAIL: { subject: 'School fee balance - {{student_name}}', body: 'Dear {{guardian_name}},\n\nThe school fee balance for {{student_name}} ({{admission_number}}) is KES {{balance}}. If you have already paid, please disregard this. Please contact the bursar if you would like to discuss a payment plan.\n\nThank you.' + sign },
  },
  ELIMU_PLAN_APPROVED: {
    SMS: 'Dear {{guardian_name}}, the payment arrangement for {{student_name}} ({{admission_number}}) totalling KES {{amount}} has been approved. First instalment due {{due_date}}. {{school_name}}.',
    WHATSAPP: 'Dear {{guardian_name}},\n\nThe payment arrangement for {{student_name}} ({{admission_number}}) totalling *KES {{amount}}* has been approved.\nFirst instalment is due on {{due_date}}.\n\nThank you.' + sign,
    EMAIL: { subject: 'Payment arrangement approved - {{student_name}}', body: 'Dear {{guardian_name}},\n\nThe payment arrangement for {{student_name}} ({{admission_number}}) totalling KES {{amount}} has been approved. The first instalment is due on {{due_date}}.\n\nThank you.' + sign },
  },
  ELIMU_SCHOLARSHIP_AWARDED: {
    SMS: 'Dear {{guardian_name}}, a scholarship of KES {{amount}} has been applied to {{student_name}} ({{admission_number}}). Balance KES {{balance}}. {{school_name}}.',
    WHATSAPP: 'Dear {{guardian_name}},\n\nCongratulations. A scholarship of *KES {{amount}}* has been applied to {{student_name}} ({{admission_number}}).\nBalance: KES {{balance}}\n\nThank you.' + sign,
    EMAIL: { subject: 'Scholarship awarded - {{student_name}}', body: 'Dear {{guardian_name}},\n\nA scholarship of KES {{amount}} has been applied to {{student_name}} ({{admission_number}}). Balance: KES {{balance}}.\n\nThank you.' + sign },
  },
  ELIMU_BURSARY_RECEIVED: {
    SMS: 'Dear {{guardian_name}}, a bursary of KES {{amount}} from {{sponsor_name}} has been credited to {{student_name}} ({{admission_number}}). Balance KES {{balance}}. {{school_name}}.',
    WHATSAPP: 'Dear {{guardian_name}},\n\nA bursary of *KES {{amount}}* from {{sponsor_name}} has been credited to {{student_name}} ({{admission_number}}).\nBalance: KES {{balance}}\n\nThank you.' + sign,
    EMAIL: { subject: 'Bursary received - {{student_name}}', body: 'Dear {{guardian_name}},\n\nA bursary of KES {{amount}} from {{sponsor_name}} has been credited to {{student_name}} ({{admission_number}}). Balance: KES {{balance}}.\n\nThank you.' + sign },
  },
  ELIMU_REFUND_PROCESSED: {
    SMS: 'Dear {{guardian_name}}, a refund of KES {{amount}} for {{student_name}} ({{admission_number}}) has been processed via {{payment_method}}, ref {{transaction_reference?}}. {{school_name}}.',
    WHATSAPP: 'Dear {{guardian_name}},\n\nA refund of *KES {{amount}}* for {{student_name}} ({{admission_number}}) has been processed via {{payment_method}}.\nReference: {{transaction_reference?}}\n\nThank you.' + sign,
    EMAIL: { subject: 'Refund processed - {{student_name}}', body: 'Dear {{guardian_name}},\n\nA refund of KES {{amount}} for {{student_name}} ({{admission_number}}) has been processed via {{payment_method}}.\n\nThank you.' + sign },
  },
  ELIMU_PAYMENT_REVERSED: {
    SMS: 'Dear {{guardian_name}}, payment {{receipt_number}} of KES {{amount}} for {{student_name}} ({{admission_number}}) has been reversed: {{reason}}. Balance KES {{balance}}. Please contact the bursar. {{school_name}}.',
    WHATSAPP: 'Dear {{guardian_name}},\n\nPayment {{receipt_number}} of *KES {{amount}}* for {{student_name}} ({{admission_number}}) has been reversed.\nReason: {{reason}}\nBalance: KES {{balance}}\nPlease contact the bursar if you have a question.\n\nThank you.' + sign,
    EMAIL: { subject: 'Payment reversed - {{student_name}}', body: 'Dear {{guardian_name}},\n\nPayment {{receipt_number}} of KES {{amount}} for {{student_name}} ({{admission_number}}) has been reversed. Reason: {{reason}}. Balance: KES {{balance}}.\n\nPlease contact the bursar if you have a question.\n\nThank you.' + sign },
  },
};
