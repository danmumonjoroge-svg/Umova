// One place that turns anything that can go wrong into a sentence a parent, teacher or bursar can act on.
// Rules: say what happened in everyday words, say whether anything was saved, say what to do next. Never show codes, SQL, "status 404", "JWT", or stack text.
// Messages the DATABASE wrote for people on purpose (our RAISE EXCEPTION texts) pass through untouched.
const NET = /failed to fetch|networkerror|load failed|network request failed|err_network|err_internet|err_connection|timeout|timed out|aborted/i;
const TECH = /\b(relation|column|syntax error|violates|schema cache|pgrst\d*|sqlstate|jwt|stack|undefined|null value|cannot read|is not a function|unexpected token|typeerror|referenceerror|edge function|non-2xx|invalid input syntax|operator does not exist|function .* does not exist|permission denied for)\b/i;

const BY_STATUS = {
  400: 'We could not understand that request. Please check what you entered and try again.',
  401: 'Your session has ended. Please sign in again.',
  403: 'You do not have permission to do that. If you think you should, ask your school administrator.',
  404: 'We could not find what you were looking for. It may have been moved or removed.',
  406: 'We could not complete that request. Please try again.',
  408: 'That took too long. Please check your connection and try again.',
  409: 'Someone else changed this at the same time. Please refresh and try again.',
  413: 'That file is too big. Please choose a smaller one.',
  415: 'That type of file is not allowed here.',
  422: 'Some of the details are not right. Please check them and try again.',
  429: 'Too many attempts. Please wait a minute and try again.',
  500: 'Something went wrong on our side. Nothing you did caused it. Please try again in a moment.',
  502: 'We could not reach the service just now. Please try again in a moment.',
  503: 'The service is busy or being updated. Please try again in a few minutes.',
  504: 'The service took too long to answer. Please try again.',
};

const BY_CODE = {
  '42501': 'You do not have permission to do that. If you think you should, ask your school administrator.',
  '23505': 'That already exists, so it was not added again.',
  '23503': 'That is still linked to other records, or the record it refers to is missing, so it was not saved.',
  '23502': 'A required detail is missing. Please fill in every required field.',
  '23514': 'One of the values is not allowed. Please check what you entered.',
  '22P02': 'One of the details is in the wrong format. Please check what you entered.',
  '22007': 'That date is not valid. Please check it and try again.',
  '22003': 'That number is too large or too small.',
  '40001': 'The system was busy. Please try again.',
  '40P01': 'The system was busy. Please try again.',
  '57014': 'That took too long and was stopped. Please try again, or narrow what you asked for.',
  '42883': 'This feature is not switched on for your school yet. Please tell your administrator.',
  '42P01': 'This feature is not switched on for your school yet. Please tell your administrator.',
  PGRST202: 'This feature is not switched on for your school yet. Please tell your administrator.',
  PGRST116: 'We could not find that record.',
  PGRST301: 'Your session has ended. Please sign in again.',
};

const BY_TEXT = [
  [/invalid refresh token|refresh token not found|jwt expired|session.*(expired|missing)|not authenticated|auth session missing/i, 'Your session has ended. Please sign in again.'],
  [/invalid login credentials|invalid credentials/i, 'The school code, username or password is not right. Please check and try again.'],
  [/email not confirmed/i, 'This account has not been activated yet. Please contact the school.'],
  [/user already registered|already been registered/i, 'This login already exists. Ask the school to reset the password instead.'],
  [/password should be|password.*(too short|at least)/i, 'That password is too short. Please use at least 8 characters.'],
  [/rate limit|too many requests|over_request_rate_limit/i, 'Too many attempts. Please wait a minute and try again.'],
  [/row-level security|new row violates row-level/i, 'You do not have permission to do that. If you think you should, ask your school administrator.'],
  [/duplicate key|already exists/i, 'That already exists, so it was not added again.'],
  [/payload too large|entity too large|exceeded the maximum allowed size/i, 'That file is too big. Please choose a smaller one.'],
  [/mime type|not supported|invalid file/i, 'That type of file is not allowed here.'],
  [/bucket not found|storage.*not (found|configured)/i, 'File storage is not set up for your school yet. Please tell your administrator.'],
  [/non-2xx|edge function/i, 'The school server could not finish that. Please try again. If it keeps happening, contact support from the Help page.'],
];

const GENERIC = 'Something went wrong. Nothing was lost. Please try again, and if it keeps happening contact support from the Help page.';
const OFFLINE = 'We could not reach the server. Please check your internet connection and try again. Anything you were typing was not saved yet.';

/** The plain-language sentence for any error (Error, Supabase error object, string, response). Never throws. */
export function humanMessage(err) {
  try {
    if (err == null || err === '') return GENERIC;
    const msg = String(err?.message ?? err?.error_description ?? err?.error ?? err);
    const status = Number(err?.status ?? err?.context?.status ?? (msg.match(/\bstatus(?: code)?:?\s*(\d{3})\b/i) || msg.match(/\b(?:HTTP|error)\s*(\d{3})\b/i) || [])[1]);
    const code = String(err?.code ?? '');
    if (err?.isNetwork || err?.network || code === 'NETWORK' || code === 'OFFLINE' || NET.test(msg) || (typeof navigator !== 'undefined' && navigator.onLine === false)) return OFFLINE;
    for (const [re, text] of BY_TEXT) if (re.test(msg)) return text;
    // A message our own database functions wrote for people (RAISE EXCEPTION with a sentence): keep it.
    if (['22023', 'P0002', 'P0001', '23P01', '42501', '23503', '23505', '23514', '23502'].includes(code) && msg && !TECH.test(msg) && !/permission denied|row-level security|^new row/i.test(msg) && /\s/.test(msg) && /^[A-Z]/.test(msg)) return msg;
    if (BY_CODE[code]) return BY_CODE[code];
    if (BY_STATUS[status]) return BY_STATUS[status];
    if (msg && !TECH.test(msg) && /\s/.test(msg) && msg.length < 240 && /[a-z]/.test(msg) && !/^[A-Z_]+$/.test(msg)) return msg;   // already reads like a sentence
    return GENERIC;
  } catch { return GENERIC; }
}

/** An Error whose .message is already plain language. The original is kept on .technical (and logged) for developers. */
export function humanError(err) {
  if (err && err.__human) return err;
  const e = new Error(humanMessage(err));
  e.__human = true; e.code = err?.code; e.status = err?.status; e.technical = String(err?.message ?? err ?? '');
  if (err?.isNetwork || err?.network) e.isNetwork = true;
  try { if (typeof console !== 'undefined') console.warn('[elimu]', e.technical, err?.details || ''); } catch { /* ignore */ }
  return e;
}
