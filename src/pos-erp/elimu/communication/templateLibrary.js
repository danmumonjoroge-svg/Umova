// System default templates (level 1 of 3). A school may override any of them in lb_communication_templates
// (level 2, same table every Umova module uses) and the person sending may edit the text for that one message (level 3).
// {{field}} merge syntax matches the Umova engine's renderText(). SMS bodies stay short; email gets subject + longer body.
// Tone: plain, polite, no jargon, no threats. Nothing here mentions money amounts unless the sender supplies them.

const sms = {
  ELIMU_ADMISSION_RECEIVED: 'Dear {{guardian_name}}, we have received the application for {{student_name}} (ref {{application_no}}). We will update you soon. {{school_name}}',
  ELIMU_ADMISSION_UPDATE: 'Dear {{guardian_name}}, an update on the application for {{student_name}} (ref {{application_no}}): {{outcome}}. {{school_name}}',
  ELIMU_ADMISSION_OFFER: 'Dear {{guardian_name}}, we are pleased to offer {{student_name}} a place in {{class_name}}. Please reply by {{reply_by}} to confirm. {{school_name}}',
  ELIMU_WELCOME: 'Dear {{guardian_name}}, welcome to {{school_name}}! {{student_name}} is admitted, admission no. {{admission_no}}, {{class_name}}.',
  ELIMU_ENROLLMENT_CONFIRMATION: 'Dear {{guardian_name}}, {{student_name}} is enrolled in {{class_name}} for {{academic_year}}. {{school_name}}',
  ELIMU_DATA_UPDATE_REQUEST: 'Dear {{guardian_name}}, please confirm that our contact details for {{student_name}} are correct, or tell us what has changed. {{school_name}}',
  ELIMU_GENERAL_NOTICE: 'Dear {{guardian_name}}, {{message}} {{school_name}}',
  ELIMU_EVENT_REMINDER: 'Dear {{guardian_name}}, a reminder: {{event_name}} on {{event_date}}. {{school_name}}',
  ELIMU_MEETING_REQUEST: 'Dear {{guardian_name}}, we would like to meet you about {{student_name}} on {{meeting_date}}. Please confirm if this suits you. {{school_name}}',
  ELIMU_CLASS_NOTICE: 'Dear {{guardian_name}}, notice for {{class_name}}: {{message}} {{school_name}}',
  ELIMU_HEALTH_NOTICE: 'Dear {{guardian_name}}, about {{student_name}}: {{message}} Please call the school. {{school_name}}',
  ELIMU_ABSENCE_FOLLOWUP: 'Dear {{guardian_name}}, {{student_name}} was not at school on {{date}}. Please let us know if all is well. {{school_name}}',
  ELIMU_FEE_REMINDER: 'Dear {{guardian_name}}, a gentle reminder of the school fees balance for {{student_name}}: {{amount}}, due {{due_date}}. {{school_name}}',
  ELIMU_RESULTS_AVAILABLE: 'Dear {{guardian_name}}, {{term_name}} results for {{student_name}} are now available. {{school_name}}',
  ELIMU_EMERGENCY: 'URGENT from {{school_name}}: {{message}} Regarding {{student_name}}. Please call the school now.',
};

const emailSubject = {
  ELIMU_ADMISSION_RECEIVED: 'Application received for {{student_name}}',
  ELIMU_ADMISSION_UPDATE: 'Update on the application for {{student_name}}',
  ELIMU_ADMISSION_OFFER: 'Offer of a place for {{student_name}}',
  ELIMU_WELCOME: 'Welcome to {{school_name}}',
  ELIMU_ENROLLMENT_CONFIRMATION: 'Enrolment confirmed for {{student_name}}',
  ELIMU_DATA_UPDATE_REQUEST: 'Please confirm your contact details',
  ELIMU_GENERAL_NOTICE: 'A notice from {{school_name}}',
  ELIMU_EVENT_REMINDER: 'Reminder: {{event_name}}',
  ELIMU_MEETING_REQUEST: 'Meeting request about {{student_name}}',
  ELIMU_CLASS_NOTICE: 'Notice for {{class_name}}',
  ELIMU_HEALTH_NOTICE: 'About {{student_name}}',
  ELIMU_ABSENCE_FOLLOWUP: '{{student_name}} was absent on {{date}}',
  ELIMU_FEE_REMINDER: 'School fees reminder for {{student_name}}',
  ELIMU_RESULTS_AVAILABLE: '{{term_name}} results for {{student_name}}',
  ELIMU_EMERGENCY: 'URGENT: {{school_name}}',
};

/** Email bodies = the SMS text with a proper greeting/sign-off. WhatsApp uses the SMS text as is. */
function emailBody(smsText) {
  return `${smsText.replace(/\s*\{\{school_name\}\}\s*$/, '')}\n\nKind regards,\n{{school_name}}`;
}

export function systemTemplate(purpose, channel) {
  const s = sms[purpose];
  if (!s) return null;
  if (channel === 'EMAIL') return { subject: emailSubject[purpose] || '{{school_name}}', body: emailBody(s), source: 'SYSTEM' };
  return { subject: null, body: s, source: 'SYSTEM' };
}

export const hasSystemTemplate = (purpose) => !!sms[purpose];
