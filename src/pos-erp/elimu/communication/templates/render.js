// elimu/communication/templates/render.js -- {{variable}} rendering for Elimu messages. Pure.
// This is only WORDING. Sending, history and delivery status stay in the POS communication engine / lb_communication_log.
export const VARIABLES = ['guardian_name', 'student_name', 'admission_number', 'class_name', 'stream_name', 'attendance_date', 'arrival_time', 'late_minutes', 'school_name', 'reason'];

/** Replaces {{name}}. Unknown/blank variables are reported in `missing` and left visible as ____ so staff notice before sending. */
export function renderTemplate(body, vars = {}) {
  const missing = [];
  const text = String(body || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k) => {
    const v = vars[k];
    if (v === undefined || v === null || String(v).trim() === '') { if (!missing.includes(k)) missing.push(k); return '____'; }
    return String(v);
  });
  return { text, missing };
}
export function variablesIn(body) {
  return [...new Set([...String(body || '').matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((m) => m[1]))];
}
/** Full class label, e.g. "Class 4 North". */
export const classLabel = (className, streamName) => [className, streamName].filter(Boolean).join(' ');
