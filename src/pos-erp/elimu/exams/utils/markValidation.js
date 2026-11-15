// elimu/exams/utils/markValidation.js
// PURE client-side validation for the mark-entry grid. It gives instant feedback; the database re-checks everything.
// Rule that matters most: a blank is NEVER zero. A mark needs an explicit status.
export const MARK_STATUS = Object.freeze({ PRESENT: 'PRESENT', ABSENT: 'ABSENT', EXEMPTED: 'EXEMPTED', NOT_SUBMITTED: 'NOT_SUBMITTED', PENDING: 'PENDING' });
export const MARK_STATUS_LABEL = Object.freeze({ PRESENT: 'Present', ABSENT: 'Absent', EXEMPTED: 'Exempted', NOT_SUBMITTED: 'Not submitted', PENDING: 'Pending' });
export const MARK_STATUS_HELP = Object.freeze({
  PRESENT: 'Sat / handed in. Needs marks.', ABSENT: 'Did not sit it. Counted as 0 or left out, as the school decides.',
  EXEMPTED: 'Excused. Left out and the other weights are re-scaled.', NOT_SUBMITTED: 'Did not hand it in. Counted as 0 or left out, as the school decides.',
  PENDING: 'No decision yet. Blocks the result until decided.' });

/** Parse what a teacher typed. '' -> null (blank, not zero). Accepts "12", "12.5", "12,5". Returns { value, error }. */
export function parseMarks(text) {
  if (text === null || text === undefined) return { value: null, error: null };
  const t = String(text).trim().replace(',', '.');
  if (t === '') return { value: null, error: null };
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { value: null, error: 'Enter a number such as 15 or 12.5.' };
  return { value: Number(t), error: null };
}

/**
 * Validate one grid row. row: { mark_status, marksText }. Returns { ok, error, entry } where entry is what to send to elimu_save_marks.
 * A row with status PENDING and no marks is simply "nothing to save".
 */
export function validateRow({ mark_status, marksText, remarks }, maxMarks) {
  const status = mark_status || (String(marksText ?? '').trim() !== '' ? 'PRESENT' : 'PENDING');
  const { value, error } = parseMarks(marksText);
  if (error) return { ok: false, error };
  if (status === 'PRESENT') {
    if (value === null) return { ok: false, error: 'Enter the marks, or choose Absent, Exempted, Not submitted or Pending.' };
    if (value < 0) return { ok: false, error: 'Marks cannot be negative.' };
    if (value > maxMarks) return { ok: false, error: `Marks cannot be more than ${maxMarks}.` };
    return { ok: true, entry: { mark_status: 'PRESENT', obtained_marks: value, remarks: remarks || null } };
  }
  if (value !== null) return { ok: false, error: `Remove the marks, or set the status to Present (status is ${MARK_STATUS_LABEL[status]}).` };
  return { ok: true, entry: { mark_status: status, obtained_marks: null, remarks: remarks || null } };
}

/** Build the save payload from grid rows, sending only rows that changed. rows: [{ enrollment_id, mark_status, marksText, remarks, version, dirty }] */
export function buildSavePayload(rows, maxMarks) {
  const entries = []; const errors = {};
  for (const r of rows) {
    if (!r.dirty) continue;
    const v = validateRow(r, maxMarks);
    if (!v.ok) { errors[r.enrollment_id] = v.error; continue; }
    entries.push({ enrollment_id: r.enrollment_id, ...v.entry, base_version: r.version ?? 0 });
  }
  return { entries, errors, hasErrors: Object.keys(errors).length > 0 };
}
