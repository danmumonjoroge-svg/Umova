// supabase/functions/_shared/comm/library.js
//
// LEVEL 1 of customisation: the system-provided message library. Every purpose has its own SMS, WhatsApp and
// Email wording, written for the channel (SMS short and plain; WhatsApp warm with *bold* labels and spacing;
// Email formal with a subject and a contact block).
//
// Nothing here names a business: {{business_name}} and friends are filled per tenant at render time
// (see context.js), and any date wording comes from phrases.js through variables such as {{timing_sentence}}.
//
// Template syntax: {{name}} required, {{name?}} optional (the whole line disappears when empty).
// Owners never see this syntax: the editor shows friendly [Customer name] tokens (render.toFriendly).

export const CHANNELS = ['WHATSAPP', 'SMS', 'EMAIL'];
export const CHANNEL_LABEL = { WHATSAPP: 'WhatsApp', SMS: 'SMS', EMAIL: 'Email' };

export const AUDIENCE_LABEL = { CUSTOMER: 'Customers', SUPPLIER: 'Suppliers', BUSINESS: 'Business' };

// Plain-language names for every variable an owner can insert (and see in the editor).
export const VARIABLE_LABELS = {
  greeting: 'Greeting', sign_off: 'Sign-off', contact_block: 'Business contact details',
  business_name: 'Business name', business_phone: 'Business phone', business_email: 'Business email', business_address: 'Business address',
  recipient_name: 'Recipient name', customer_name: 'Customer name', supplier_name: 'Supplier name',
  payment_instructions: 'How to pay',
  amount: 'Amount', balance: 'Balance', outstanding_total: 'Total outstanding', due_amount: 'Amount due', due_date: 'Due date',
  timing_sentence: 'When it is due', overdue_by: 'Days overdue', days_remaining: 'Days remaining', invoice_ref: 'Invoice / reference',
  sale_number: 'Sale number', sale_date: 'Sale date', receipt_number: 'Receipt number', total_amount: 'Total', items_block: 'Items bought',
  items_summary: 'Items (short)', payment_status_line: 'Payment status',
  payment_amount: 'Payment amount', payment_date: 'Payment date', payment_reference: 'Payment reference', payment_method: 'Payment method', balance_sentence: 'Balance after payment',
  statement_date: 'Statement date', statement_lines: 'Recent activity', next_due_line: 'Next payment due',
  service_name: 'Service', appointment_sentence: 'Appointment time', reschedule_sentence: 'New appointment time', cancelled_sentence: 'Cancelled appointment',
  appointment_date: 'Appointment date', appointment_time: 'Appointment time of day', staff_name: 'Staff member',
  order_number: 'Order number', delivery_sentence: 'Delivery status', delivery_note: 'Delivery note',
  po_number: 'Purchase order number', po_date: 'Order date', po_items: 'Goods ordered', po_summary: 'Goods (short)', po_total: 'Order total',
  expected_date: 'Expected delivery date', original_date: 'Original delivery date', revised_date: 'Revised delivery date', revision_sentence: 'Date revision',
  days_delayed: 'Days delayed', quantity_outstanding: 'Quantity outstanding', delivery_request_sentence: 'Delivery request',
  grn_number: 'Goods received note', received_summary: 'Goods received (short)', received_date: 'Date received', received_items: 'Goods received', outstanding_line: 'Still outstanding',
  supplier_balance: 'Balance owed to supplier', supplier_statement_lines: 'Recent activity', paid_line: 'Payment status',
  low_stock_count: 'Number of products', low_stock_lines: 'Low-stock products',
  summary_date: 'Date', sales_total: 'Total sales', sales_count: 'Number of sales', sales_breakdown: 'Sales by payment type',
  message_text: 'Your message', title: 'Title', task_title: 'Task', task_due: 'Due', task_details: 'Details',
  approval_item: 'What needs approval', approval_detail: 'Approval details', requested_by: 'Requested by',
  announcement_title: 'Heading', announcement_text: 'Announcement',
};

// ---- purposes ----------------------------------------------------------------------------------------------
// key, label, group, audience, source (what record it is built from), legacy (message_type in the older table),
// inputs (the ONLY things the user may need to type, because the database cannot know them).
export const PURPOSES = [
  // ===== CUSTOMERS =====
  { key: 'CUSTOMER_WELCOME', label: 'Welcome', group: 'Customers', audience: 'CUSTOMER', source: 'customer', legacy: 'WELCOME', hint: 'Greet a new customer' },
  { key: 'SALE_CONFIRMATION', label: 'Sale confirmation', group: 'Customers', audience: 'CUSTOMER', source: 'sale', legacy: 'OTHER', hint: 'Confirm what they bought' },
  { key: 'RECEIPT', label: 'Receipt', group: 'Customers', audience: 'CUSTOMER', source: 'sale', legacy: 'RECEIPT', hint: 'Send the receipt' },
  { key: 'PAYMENT_RECEIVED', label: 'Payment received', group: 'Customers', audience: 'CUSTOMER', source: 'payment', legacy: 'PAYMENT_RECEIVED', hint: 'Thank them for paying' },
  { key: 'PAYMENT_REMINDER', label: 'Payment reminder', group: 'Customers', audience: 'CUSTOMER', source: 'receivable', smart: true, legacy: 'PAYMENT_DUE', hint: 'Picks the right wording for today: coming up, due today or overdue' },
  { key: 'PAYMENT_UPCOMING', label: 'Upcoming payment reminder', group: 'Customers', audience: 'CUSTOMER', source: 'receivable', variantOf: 'PAYMENT_REMINDER', legacy: 'PAYMENT_DUE', hint: 'Before the due date' },
  { key: 'PAYMENT_DUE_TODAY', label: 'Payment due today', group: 'Customers', audience: 'CUSTOMER', source: 'receivable', variantOf: 'PAYMENT_REMINDER', legacy: 'PAYMENT_DUE', hint: 'On the due date' },
  { key: 'PAYMENT_OVERDUE', label: 'Overdue payment', group: 'Customers', audience: 'CUSTOMER', source: 'receivable', variantOf: 'PAYMENT_REMINDER', legacy: 'PAYMENT_OVERDUE', hint: 'After the due date' },
  { key: 'PAYMENT_BALANCE', label: 'Balance reminder (no due date)', group: 'Customers', audience: 'CUSTOMER', source: 'receivable', variantOf: 'PAYMENT_REMINDER', legacy: 'PAYMENT_OVERDUE', hint: 'When no due date was recorded' },
  { key: 'CUSTOMER_STATEMENT', label: 'Customer statement', group: 'Customers', audience: 'CUSTOMER', source: 'receivable', legacy: 'STATEMENT', hint: 'Their balance and recent activity' },
  { key: 'APPOINTMENT_CONFIRMATION', label: 'Appointment confirmation', group: 'Customers', audience: 'CUSTOMER', source: 'appointment', legacy: 'OTHER', hint: 'Confirm a booking' },
  { key: 'APPOINTMENT_REMINDER', label: 'Appointment reminder', group: 'Customers', audience: 'CUSTOMER', source: 'appointment', legacy: 'APPOINTMENT_REMINDER', hint: 'Remind them of the time' },
  { key: 'APPOINTMENT_RESCHEDULED', label: 'Appointment rescheduled', group: 'Customers', audience: 'CUSTOMER', source: 'appointment', legacy: 'OTHER', hint: 'Tell them the new time' },
  { key: 'APPOINTMENT_CANCELLED', label: 'Appointment cancelled', group: 'Customers', audience: 'CUSTOMER', source: 'appointment', legacy: 'OTHER', hint: 'Tell them it is cancelled' },
  { key: 'ORDER_CONFIRMATION', label: 'Order confirmation', group: 'Customers', audience: 'CUSTOMER', source: 'sale', legacy: 'OTHER', hint: 'Confirm an order' },
  { key: 'DELIVERY_NOTIFICATION', label: 'Delivery notification', group: 'Customers', audience: 'CUSTOMER', source: 'sale', legacy: 'OTHER', hint: 'On its way, delivered or ready',
    inputs: [
      { key: 'delivery_status', label: 'Status', type: 'select', options: [['ON_THE_WAY', 'On its way'], ['DELIVERED', 'Delivered'], ['READY', 'Ready for collection']], default: 'ON_THE_WAY' },
      { key: 'delivery_date', label: 'Date', type: 'date', optional: true },
      { key: 'delivery_note', label: 'Note (optional)', type: 'text', optional: true },
    ] },

  // ===== SUPPLIERS =====
  { key: 'SUPPLIER_PURCHASE_ORDER', label: 'Purchase order', group: 'Suppliers', audience: 'SUPPLIER', source: 'purchase_order', legacy: 'SUPPLIER_ORDER', hint: 'Send an order' },
  { key: 'SUPPLIER_PURCHASE_CONFIRMATION', label: 'Purchase confirmation', group: 'Suppliers', audience: 'SUPPLIER', source: 'purchase_order', legacy: 'OTHER', hint: 'Confirm an order is placed' },
  { key: 'SUPPLIER_PAYMENT_CONFIRMATION', label: 'Payment confirmation', group: 'Suppliers', audience: 'SUPPLIER', source: 'supplier_payment', legacy: 'SUPPLIER_PAYMENT_SENT', hint: 'Confirm we paid' },
  { key: 'SUPPLIER_STATEMENT', label: 'Supplier statement', group: 'Suppliers', audience: 'SUPPLIER', source: 'supplier', legacy: 'SUPPLIER_STATEMENT', hint: 'Balance and recent activity' },
  { key: 'SUPPLIER_BALANCE', label: 'Outstanding supplier balance', group: 'Suppliers', audience: 'SUPPLIER', source: 'supplier', legacy: 'SUPPLIER_PAYMENT_DUE', hint: 'What we owe them' },
  { key: 'SUPPLIER_DELIVERY_REMINDER', label: 'Delivery reminder', group: 'Suppliers', audience: 'SUPPLIER', source: 'purchase_order', smart: true, legacy: 'SUPPLIER_DELIVERY_REMINDER', hint: 'Picks the right wording: coming up, due today or late' },
  { key: 'SUPPLIER_DELIVERY_DELAYED', label: 'Delayed goods delivery', group: 'Suppliers', audience: 'SUPPLIER', source: 'purchase_order', variantOf: 'SUPPLIER_DELIVERY_REMINDER', legacy: 'SUPPLIER_DELIVERY_REMINDER', hint: 'Goods are late' },
  { key: 'SUPPLIER_GOODS_RECEIVED', label: 'Goods received confirmation', group: 'Suppliers', audience: 'SUPPLIER', source: 'grn', legacy: 'OTHER', hint: 'Confirm we received the goods' },

  // ===== BUSINESS OPERATIONS =====
  { key: 'LOW_STOCK_NOTIFICATION', label: 'Low-stock notification', group: 'Business', audience: 'BUSINESS', source: 'low_stock', legacy: 'OTHER', hint: 'Products running low' },
  { key: 'DAILY_SALES_SUMMARY', label: 'Daily sales summary', group: 'Business', audience: 'BUSINESS', source: 'daily_sales', legacy: 'OTHER', hint: 'Today\'s sales at a glance' },
  { key: 'STAFF_NOTIFICATION', label: 'Staff notification', group: 'Business', audience: 'BUSINESS', source: 'none', legacy: 'OTHER', hint: 'A message to a staff member',
    inputs: [{ key: 'title', label: 'Heading', type: 'text' }, { key: 'message_text', label: 'Message', type: 'textarea' }] },
  { key: 'TASK_REMINDER', label: 'Task reminder', group: 'Business', audience: 'BUSINESS', source: 'none', legacy: 'OTHER', hint: 'Remind someone of a task',
    inputs: [{ key: 'task_title', label: 'Task', type: 'text' }, { key: 'task_due', label: 'Due date', type: 'date', optional: true }, { key: 'task_details', label: 'Details (optional)', type: 'textarea', optional: true }] },
  { key: 'APPROVAL_NOTIFICATION', label: 'Approval notification', group: 'Business', audience: 'BUSINESS', source: 'purchase_order_approval', legacy: 'OTHER', hint: 'Something needs approval',
    inputs: [{ key: 'approval_item', label: 'What needs approval', type: 'text', fromRecord: true }, { key: 'approval_detail', label: 'Details (optional)', type: 'textarea', optional: true }] },
  { key: 'GENERAL_ANNOUNCEMENT', label: 'General announcement', group: 'Business', audience: 'ANY', source: 'none', legacy: 'OTHER', hint: 'Tell people something',
    inputs: [{ key: 'announcement_title', label: 'Heading', type: 'text' }, { key: 'announcement_text', label: 'Announcement', type: 'textarea' }] },
  { key: 'DEFAULT_MESSAGE', label: 'Default message', group: 'Business', audience: 'ANY', source: 'none', legacy: 'OTHER', hint: 'A simple message',
    inputs: [{ key: 'message_text', label: 'Message', type: 'textarea' }] },
];

export const PURPOSE_BY_KEY = Object.fromEntries(PURPOSES.map((p) => [p.key, p]));

// ---- templates -----------------------------------------------------------------------------------------------
const T = (sms, whatsapp, subject, email) => ({ SMS: { body: sms }, WHATSAPP: { body: whatsapp }, EMAIL: { subject, body: email } });

export const DEFAULT_TEMPLATES = {
  // ===== CUSTOMERS =====
  CUSTOMER_WELCOME: T(
    `{{greeting}} Welcome to {{business_name}}! We are glad to have you with us.\nCall us on {{business_phone?}} any time.\n{{sign_off}}`,
    `{{greeting}}\n\nWelcome to *{{business_name}}*! We are delighted to have you as our customer.\n\nSave this number so you can reach us any time:\n{{business_phone?}}\n\n{{sign_off}}`,
    `Welcome to {{business_name}}`,
    `{{greeting}}\n\nWelcome to {{business_name}}. Thank you for choosing us; we look forward to serving you.\n\nIf you have any questions, please get in touch:\n{{contact_block}}\n\n{{sign_off}}`,
  ),
  SALE_CONFIRMATION: T(
    `{{greeting}} Your purchase {{sale_number}} of {{total_amount}} on {{sale_date}} is confirmed. {{payment_status_line}}\n{{sign_off}}`,
    `{{greeting}}\n\nThank you for your purchase from *{{business_name}}*. Here is your confirmation:\n\n*Sale:* {{sale_number}}\n*Date:* {{sale_date}}\n{{items_block?}}\n*Total:* {{total_amount}}\n{{payment_status_line}}\n\n{{sign_off}}`,
    `Your purchase {{sale_number}} is confirmed`,
    `{{greeting}}\n\nThank you for your purchase. This confirms the details below.\n\nSale number: {{sale_number}}\nDate: {{sale_date}}\nTotal: {{total_amount}}\n\n{{items_block?}}\n\n{{payment_status_line}}\n\n{{sign_off}}`,
  ),
  RECEIPT: T(
    `{{greeting}} Receipt {{receipt_number}} from {{business_name}}: {{total_amount}} on {{sale_date}}. {{payment_status_line}} Thank you for shopping with us.\n{{sign_off}}`,
    `{{greeting}}\n\nThank you for shopping with *{{business_name}}*. Here is your receipt:\n\n*Receipt:* {{receipt_number}}\n*Date:* {{sale_date}}\n{{items_block?}}\n*Total:* {{total_amount}}\n{{payment_status_line}}\n\nKaribu tena!\n\n{{sign_off}}`,
    `Your receipt {{receipt_number}} from {{business_name}}`,
    `{{greeting}}\n\nThank you for shopping with {{business_name}}. Your receipt is below.\n\nReceipt number: {{receipt_number}}\nDate: {{sale_date}}\nTotal: {{total_amount}}\n\n{{items_block?}}\n\n{{payment_status_line}}\n\n{{sign_off}}`,
  ),
  PAYMENT_RECEIVED: T(
    `{{greeting}} We have received your payment of {{payment_amount}} on {{payment_date}}. {{balance_sentence}}\n{{sign_off}}`,
    `{{greeting}}\n\nThank you, we have received your payment.\n\n*Amount:* {{payment_amount}}\n*Date:* {{payment_date}}\n*Reference:* {{payment_reference?}}\n\n{{balance_sentence}}\n\n{{sign_off}}`,
    `Payment received: {{payment_amount}}`,
    `{{greeting}}\n\nThank you. We confirm that we have received your payment.\n\nAmount: {{payment_amount}}\nDate: {{payment_date}}\nReference: {{payment_reference?}}\n\n{{balance_sentence}}\n\n{{sign_off}}`,
  ),
  PAYMENT_UPCOMING: T(
    `{{greeting}} Friendly reminder from {{business_name}}: {{timing_sentence}}\nRef: {{invoice_ref?}}\n{{payment_instructions?}}\n{{sign_off}}`,
    `{{greeting}}\n\nThis is a friendly reminder about your payment to *{{business_name}}*.\n\n{{timing_sentence}}\n\n*Amount due:* {{due_amount}}\n*Due date:* {{due_date}}\n*Reference:* {{invoice_ref?}}\n*Total outstanding:* {{outstanding_total}}\n\n{{payment_instructions?}}\n\n{{sign_off}}`,
    `Payment reminder: {{due_amount}} due {{due_date}}`,
    `{{greeting}}\n\nThis is a courtesy reminder about an upcoming payment.\n\n{{timing_sentence}}\n\nAmount due: {{due_amount}}\nDue date: {{due_date}}\nReference: {{invoice_ref?}}\nTotal outstanding: {{outstanding_total}}\n\n{{payment_instructions?}}\n\nIf you have already paid, please disregard this message.\n\n{{sign_off}}`,
  ),
  PAYMENT_DUE_TODAY: T(
    `{{greeting}} {{timing_sentence}}\nRef: {{invoice_ref?}}\n{{payment_instructions?}}\n{{sign_off}}`,
    `{{greeting}}\n\nA quick reminder from *{{business_name}}*.\n\n{{timing_sentence}}\n\n*Amount due:* {{due_amount}}\n*Reference:* {{invoice_ref?}}\n*Total outstanding:* {{outstanding_total}}\n\n{{payment_instructions?}}\n\nThank you for settling today.\n\n{{sign_off}}`,
    `Payment due today: {{due_amount}}`,
    `{{greeting}}\n\n{{timing_sentence}}\n\nAmount due: {{due_amount}}\nReference: {{invoice_ref?}}\nTotal outstanding: {{outstanding_total}}\n\n{{payment_instructions?}}\n\nIf you have already paid, please disregard this message.\n\n{{sign_off}}`,
  ),
  PAYMENT_OVERDUE: T(
    `{{greeting}} {{timing_sentence}} Outstanding: {{outstanding_total}}. Please pay as soon as you can.\nRef: {{invoice_ref?}}\n{{payment_instructions?}}\n{{sign_off}}`,
    `{{greeting}}\n\nWe are following up on your account with *{{business_name}}*.\n\n{{timing_sentence}}\n\n*Overdue by:* {{overdue_by}}\n*Amount overdue:* {{due_amount}}\n*Reference:* {{invoice_ref?}}\n*Total outstanding:* {{outstanding_total}}\n\nKindly settle at your earliest convenience, or let us know if there is a problem.\n{{payment_instructions?}}\n\n{{sign_off}}`,
    `Overdue payment: {{due_amount}}`,
    `{{greeting}}\n\nOur records show a payment that has passed its due date.\n\n{{timing_sentence}}\n\nOverdue by: {{overdue_by}}\nAmount overdue: {{due_amount}}\nReference: {{invoice_ref?}}\nTotal outstanding: {{outstanding_total}}\n\nPlease settle this at your earliest convenience. If you have already paid, or you would like to discuss a payment arrangement, please reply to this email or call us.\n\n{{payment_instructions?}}\n\n{{sign_off}}`,
  ),
  PAYMENT_BALANCE: T(
    `{{greeting}} Your balance with {{business_name}} is {{outstanding_total}}. Please settle when you can.\n{{payment_instructions?}}\n{{sign_off}}`,
    `{{greeting}}\n\nA reminder from *{{business_name}}*.\n\nYour current balance is *{{outstanding_total}}*. Kindly settle when you can.\n\n{{payment_instructions?}}\n\n{{sign_off}}`,
    `Your balance with {{business_name}}`,
    `{{greeting}}\n\nThis is a reminder that your current balance with {{business_name}} is {{outstanding_total}}. Kindly settle at your earliest convenience.\n\n{{payment_instructions?}}\n\nIf you have already paid, please disregard this message.\n\n{{sign_off}}`,
  ),
  CUSTOMER_STATEMENT: T(
    `{{greeting}} Your balance with {{business_name}} as at {{statement_date}} is {{balance}}.\n{{next_due_line?}}\n{{sign_off}}`,
    `{{greeting}}\n\nHere is your statement from *{{business_name}}* as at {{statement_date}}.\n\n*Balance:* {{balance}}\n{{next_due_line?}}\n\n{{statement_lines?}}\n\nReply here if anything looks wrong.\n\n{{sign_off}}`,
    `Your statement as at {{statement_date}}`,
    `{{greeting}}\n\nPlease find your account statement as at {{statement_date}}.\n\nBalance: {{balance}}\n{{next_due_line?}}\n\n{{statement_lines?}}\n\nIf anything does not match your records, please let us know.\n\n{{sign_off}}`,
  ),
  APPOINTMENT_CONFIRMATION: T(
    `{{greeting}} Your {{service_name}} appointment with {{business_name}} is confirmed. {{appointment_sentence}}\n{{sign_off}}`,
    `{{greeting}}\n\nYour appointment with *{{business_name}}* is confirmed.\n\n*Service:* {{service_name}}\n*With:* {{staff_name?}}\n\n{{appointment_sentence}}\n\nPlease let us know if you need to change it.\n\n{{sign_off}}`,
    `Appointment confirmed`,
    `{{greeting}}\n\nThis confirms your appointment with {{business_name}}.\n\nService: {{service_name}}\nWith: {{staff_name?}}\n\n{{appointment_sentence}}\n\nIf you need to change or cancel, please contact us.\n\n{{contact_block}}\n\n{{sign_off}}`,
  ),
  APPOINTMENT_REMINDER: T(
    `{{greeting}} Reminder from {{business_name}}: {{appointment_sentence}} ({{service_name}})\n{{sign_off}}`,
    `{{greeting}}\n\nA friendly reminder about your appointment with *{{business_name}}*.\n\n{{appointment_sentence}}\n\n*Service:* {{service_name}}\n\nPlease let us know if you need to reschedule.\n\n{{sign_off}}`,
    `Appointment reminder`,
    `{{greeting}}\n\nThis is a reminder about your upcoming appointment.\n\n{{appointment_sentence}}\n\nService: {{service_name}}\n\nIf you need to reschedule, please contact us as early as you can.\n\n{{contact_block}}\n\n{{sign_off}}`,
  ),
  APPOINTMENT_RESCHEDULED: T(
    `{{greeting}} {{reschedule_sentence}} ({{service_name}}) Sorry for any inconvenience.\n{{sign_off}}`,
    `{{greeting}}\n\nYour appointment with *{{business_name}}* has been updated.\n\n{{reschedule_sentence}}\n\n*Service:* {{service_name}}\n\nPlease reply if the new time does not suit you.\n\n{{sign_off}}`,
    `Your appointment has been rescheduled`,
    `{{greeting}}\n\nWe are writing to let you know that your appointment has been rescheduled.\n\n{{reschedule_sentence}}\n\nService: {{service_name}}\n\nIf the new time does not suit you, please contact us and we will find another.\n\n{{contact_block}}\n\n{{sign_off}}`,
  ),
  APPOINTMENT_CANCELLED: T(
    `{{greeting}} {{cancelled_sentence}} Please call {{business_phone?}} to rebook.\n{{sign_off}}`,
    `{{greeting}}\n\n{{cancelled_sentence}}\n\n*Service:* {{service_name}}\n\nWe are sorry for any inconvenience. Reply here whenever you would like to book another time.\n\n{{sign_off}}`,
    `Your appointment has been cancelled`,
    `{{greeting}}\n\n{{cancelled_sentence}}\n\nService: {{service_name}}\n\nWe apologise for any inconvenience. To book another time, please contact us.\n\n{{contact_block}}\n\n{{sign_off}}`,
  ),
  ORDER_CONFIRMATION: T(
    `{{greeting}} Thank you for your order {{order_number}} ({{sale_date}}) with {{business_name}}. Total {{total_amount}}. {{payment_status_line}}\n{{sign_off}}`,
    `{{greeting}}\n\nThank you for your order with *{{business_name}}*.\n\n*Order:* {{order_number}}\n*Date:* {{sale_date}}\n{{items_block?}}\n*Total:* {{total_amount}}\n{{payment_status_line}}\n\nWe will update you on delivery.\n\n{{sign_off}}`,
    `Order {{order_number}} confirmed`,
    `{{greeting}}\n\nThank you for your order. We confirm the details below.\n\nOrder number: {{order_number}}\nDate: {{sale_date}}\nTotal: {{total_amount}}\n\n{{items_block?}}\n\n{{payment_status_line}}\n\nWe will keep you updated on delivery.\n\n{{sign_off}}`,
  ),
  DELIVERY_NOTIFICATION: T(
    `{{greeting}} {{delivery_sentence}}\n{{delivery_note?}}\n{{sign_off}}`,
    `{{greeting}}\n\n{{delivery_sentence}}\n\n*Order:* {{order_number?}}\n{{delivery_note?}}\n\n{{sign_off}}`,
    `Update on your order {{order_number?}}`,
    `{{greeting}}\n\n{{delivery_sentence}}\n\nOrder number: {{order_number?}}\n{{delivery_note?}}\n\nThank you for choosing {{business_name}}.\n\n{{sign_off}}`,
  ),

  // ===== SUPPLIERS =====
  SUPPLIER_PURCHASE_ORDER: T(
    `{{greeting}} Purchase order {{po_number}} from {{business_name}}: {{po_summary}}. Total {{po_total}}.\n{{delivery_request_sentence?}}\nPlease confirm.\n{{sign_off}}`,
    `{{greeting}}\n\nPlease find our purchase order from *{{business_name}}*.\n\n*Order:* {{po_number}}\n*Date:* {{po_date}}\n{{po_items}}\n*Total:* {{po_total}}\n{{delivery_request_sentence?}}\n\nKindly confirm availability and delivery.\n\n{{sign_off}}`,
    `Purchase order {{po_number}} from {{business_name}}`,
    `{{greeting}}\n\nPlease find our purchase order below.\n\nOrder number: {{po_number}}\nOrder date: {{po_date}}\n\n{{po_items}}\n\nOrder total: {{po_total}}\n{{delivery_request_sentence?}}\n\nKindly confirm receipt of this order, availability and the delivery date.\n\n{{contact_block}}\n\n{{sign_off}}`,
  ),
  SUPPLIER_PURCHASE_CONFIRMATION: T(
    `{{greeting}} This confirms our purchase {{po_number}} ({{po_summary}}), total {{po_total}}.\n{{delivery_request_sentence?}}\n{{sign_off}}`,
    `{{greeting}}\n\nThis confirms our purchase with you.\n\n*Order:* {{po_number}}\n{{po_items}}\n*Total:* {{po_total}}\n{{delivery_request_sentence?}}\n\nThank you for your service.\n\n{{sign_off}}`,
    `Purchase confirmation: {{po_number}}`,
    `{{greeting}}\n\nWe confirm the following purchase from you.\n\nOrder number: {{po_number}}\nOrder date: {{po_date}}\n\n{{po_items}}\n\nOrder total: {{po_total}}\n{{delivery_request_sentence?}}\n\nThank you for your continued service.\n\n{{sign_off}}`,
  ),
  SUPPLIER_PAYMENT_CONFIRMATION: T(
    `{{greeting}} We have paid {{payment_amount}} on {{payment_date}}.\nRef: {{payment_reference?}}\n{{balance_sentence}}\n{{sign_off}}`,
    `{{greeting}}\n\nWe have made a payment to you.\n\n*Amount:* {{payment_amount}}\n*Date:* {{payment_date}}\n*Method:* {{payment_method?}}\n*Reference:* {{payment_reference?}}\n\n{{balance_sentence}}\n\nKindly confirm receipt.\n\n{{sign_off}}`,
    `Payment confirmation: {{payment_amount}}`,
    `{{greeting}}\n\nThis confirms that we have made the following payment.\n\nAmount: {{payment_amount}}\nDate: {{payment_date}}\nMethod: {{payment_method?}}\nReference: {{payment_reference?}}\n\n{{balance_sentence}}\n\nKindly confirm that you have received it.\n\n{{sign_off}}`,
  ),
  SUPPLIER_STATEMENT: T(
    `{{greeting}} Our records show we owe you {{supplier_balance}} as at {{statement_date}}. Please tell us if this differs from yours.\n{{sign_off}}`,
    `{{greeting}}\n\nHere is our statement as at {{statement_date}}.\n\n*Balance we owe you:* {{supplier_balance}}\n\n{{supplier_statement_lines?}}\n\nPlease let us know if this does not match your records.\n\n{{sign_off}}`,
    `Statement as at {{statement_date}}`,
    `{{greeting}}\n\nPlease find our statement of your account as at {{statement_date}}.\n\nBalance we owe you: {{supplier_balance}}\n\n{{supplier_statement_lines?}}\n\nIf this does not match your records, kindly let us know so that we can reconcile.\n\n{{sign_off}}`,
  ),
  SUPPLIER_BALANCE: T(
    `{{greeting}} Our current balance with you is {{supplier_balance}}. We will settle as agreed. Please confirm it matches your records.\n{{sign_off}}`,
    `{{greeting}}\n\nOur records show an outstanding balance of *{{supplier_balance}}* with you.\n\nPlease confirm that this matches yours. We will update you on payment.\n\n{{sign_off}}`,
    `Outstanding balance: {{supplier_balance}}`,
    `{{greeting}}\n\nOur records show an outstanding balance of {{supplier_balance}} owed to you.\n\nPlease confirm that this matches your records. We will be in touch regarding payment.\n\n{{sign_off}}`,
  ),
  SUPPLIER_DELIVERY_REMINDER: T(
    `{{greeting}} Order {{po_number}} ({{po_summary}}). {{delivery_sentence}}\n{{sign_off}}`,
    `{{greeting}}\n\nA reminder about our order with you.\n\n*Order:* {{po_number}}\n{{po_items}}\n\n{{delivery_sentence}}\n{{revision_sentence?}}\n\nPlease confirm everything is on track.\n\n{{sign_off}}`,
    `Delivery reminder: order {{po_number}}`,
    `{{greeting}}\n\nThis is a reminder about the delivery of our order.\n\nOrder number: {{po_number}}\nOriginal delivery date: {{original_date?}}\nCurrent delivery date: {{expected_date?}}\n\n{{po_items}}\n\n{{delivery_sentence}}\n{{revision_sentence?}}\n\nPlease confirm that everything is on track.\n\n{{contact_block}}\n\n{{sign_off}}`,
  ),
  SUPPLIER_DELIVERY_DELAYED: T(
    `{{greeting}} Order {{po_number}} ({{po_summary}}). {{delivery_sentence}}\n{{sign_off}}`,
    `{{greeting}}\n\nWe are following up on a delayed delivery.\n\n*Order:* {{po_number}}\n{{po_items}}\n*Expected on:* {{expected_date}}\n*Days delayed:* {{days_delayed}}\n\n{{delivery_sentence}}\n{{revision_sentence?}}\n\nWe would appreciate an update as soon as possible.\n\n{{sign_off}}`,
    `Delayed delivery: order {{po_number}}`,
    `{{greeting}}\n\nWe are following up on the delivery of our order, which has not arrived by the agreed date.\n\nOrder number: {{po_number}}\nOriginal delivery date: {{original_date?}}\nCurrent delivery date: {{expected_date}}\nDays delayed: {{days_delayed}}\n\n{{po_items}}\n\n{{delivery_sentence}}\n{{revision_sentence?}}\n\nWe would appreciate an update as soon as possible, as the delay affects our operations.\n\n{{contact_block}}\n\n{{sign_off}}`,
  ),
  SUPPLIER_GOODS_RECEIVED: T(
    `{{greeting}} We received {{received_summary}} on {{received_date}}.\nOrder: {{po_number?}}\n{{outstanding_line?}}\nThank you.\n{{sign_off}}`,
    `{{greeting}}\n\nThis confirms we have received goods from you.\n\n*Received:* {{received_date}}\n*Order:* {{po_number?}}\n*Note:* {{grn_number?}}\n{{received_items}}\n\n{{outstanding_line?}}\n\nThank you.\n\n{{sign_off}}`,
    `Goods received {{received_date}}`,
    `{{greeting}}\n\nThis confirms that we have received the following goods.\n\nDate received: {{received_date}}\nOrder number: {{po_number?}}\nGoods received note: {{grn_number?}}\n\n{{received_items}}\n\n{{outstanding_line?}}\n\nThank you for the delivery.\n\n{{sign_off}}`,
  ),

  // ===== BUSINESS OPERATIONS =====
  LOW_STOCK_NOTIFICATION: T(
    `{{business_name}}: {{low_stock_count}} product(s) are low on stock: {{low_stock_lines}}`,
    `*Low stock at {{business_name}}*\n\n{{low_stock_count}} product(s) need restocking:\n\n{{low_stock_lines}}\n\nPlease arrange to reorder.`,
    `Low stock alert: {{low_stock_count}} product(s)`,
    `{{greeting}}\n\nThe following products are low on stock and need restocking.\n\n{{low_stock_lines}}\n\nPlease arrange to reorder.\n\n{{sign_off}}`,
  ),
  DAILY_SALES_SUMMARY: T(
    `{{business_name}} sales for {{summary_date}}: {{sales_total}} from {{sales_count}} sale(s).`,
    `*{{business_name}}: sales for {{summary_date}}*\n\n*Total:* {{sales_total}}\n*Sales made:* {{sales_count}}\n\n{{sales_breakdown?}}`,
    `Sales summary for {{summary_date}}`,
    `{{greeting}}\n\nHere is the sales summary for {{summary_date}}.\n\nTotal sales: {{sales_total}}\nNumber of sales: {{sales_count}}\n\n{{sales_breakdown?}}\n\n{{sign_off}}`,
  ),
  STAFF_NOTIFICATION: T(
    `{{business_name}}: {{message_text}}`,
    `*{{title?}}*\n\n{{message_text}}\n\n{{business_name}}`,
    `{{title}}`,
    `{{greeting}}\n\n{{message_text}}\n\n{{sign_off}}`,
  ),
  TASK_REMINDER: T(
    `Reminder: {{task_title}}\nDue: {{task_due?}}`,
    `*Task reminder*\n\n*Task:* {{task_title}}\n*Due:* {{task_due?}}\n{{task_details?}}\n\n{{business_name}}`,
    `Reminder: {{task_title}}`,
    `{{greeting}}\n\nThis is a reminder about the following task.\n\nTask: {{task_title}}\nDue: {{task_due?}}\n{{task_details?}}\n\n{{sign_off}}`,
  ),
  APPROVAL_NOTIFICATION: T(
    `{{business_name}}: approval needed.\n{{approval_item}}\n{{approval_detail?}}`,
    `*Approval needed*\n\n{{approval_item}}\n{{approval_detail?}}\n*Requested by:* {{requested_by?}}\n\nPlease review and approve in My Business.\n\n{{business_name}}`,
    `Approval needed: {{approval_item}}`,
    `{{greeting}}\n\nThe following item needs your approval.\n\n{{approval_item}}\n{{approval_detail?}}\nRequested by: {{requested_by?}}\n\nPlease review it in My Business.\n\n{{sign_off}}`,
  ),
  GENERAL_ANNOUNCEMENT: T(
    `{{greeting}} {{announcement_title}}: {{announcement_text}}\n{{sign_off}}`,
    `{{greeting}}\n\n*{{announcement_title}}*\n\n{{announcement_text}}\n\n{{sign_off}}`,
    `{{announcement_title}}`,
    `{{greeting}}\n\n{{announcement_text}}\n\n{{sign_off}}`,
  ),
  DEFAULT_MESSAGE: T(
    `{{greeting}} {{message_text}}\n{{sign_off}}`,
    `{{greeting}}\n\n*A message from {{business_name}}*\n\n{{message_text}}\n\n{{sign_off}}`,
    `A message from {{business_name}}`,
    `{{greeting}}\n\n{{message_text}}\n\n{{sign_off}}\n{{contact_block?}}`,
  ),
};

// ---- channel defaults for greeting / sign-off (a business can override either) -------------------------------
export const DEFAULT_GREETING = {
  SMS: 'Hi {{recipient_greeting_name}},',
  WHATSAPP: 'Hello {{recipient_greeting_name}},',
  EMAIL: 'Dear {{recipient_greeting_name}},',
};
export const DEFAULT_SIGN_OFF = {
  SMS: '- {{business_name}}',
  WHATSAPP: 'Thank you,\n{{business_name}}',
  EMAIL: 'Kind regards,\n{{business_name}}',
};

/** Variable keys a purpose's templates use, for the editor's "insert" chips. */
export function variablesForPurpose(purposeKey, channel) {
  const t = DEFAULT_TEMPLATES[purposeKey]?.[channel];
  if (!t) return [];
  const seen = [];
  const scan = (s) => String(s || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\??\s*\}\}/g, (_m, k) => { if (!seen.includes(k) && VARIABLE_LABELS[k]) seen.push(k); return ''; });
  scan(t.subject); scan(t.body);
  return seen;
}
