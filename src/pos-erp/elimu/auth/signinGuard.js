// Pure helpers for the sign-in screens (no React, no host imports, so they run in plain Node tests).
// A browser-side brake only: it stops a parent hammering the code box and gives a calm "wait a bit" message. The real limit on SMS codes is
// the server's (Supabase Auth rate limits); this just makes the screen kinder.
export const RESEND_SECONDS = 30;
export const MAX_WRONG_CODES = 5;
export const PAUSE_MINUTES = 5;

/** state = { wrong:number, lockedUntil:number|0 } */
export const freshGuard = () => ({ wrong: 0, lockedUntil: 0 });
export const lockedFor = (g, now = Date.now()) => Math.max(0, Math.ceil(((g?.lockedUntil || 0) - now) / 1000));
export function afterWrongCode(g, now = Date.now()) {
  const wrong = (g?.wrong || 0) + 1;
  return wrong >= MAX_WRONG_CODES ? { wrong: 0, lockedUntil: now + PAUSE_MINUTES * 60000 } : { wrong, lockedUntil: g?.lockedUntil || 0 };
}
export const wrongCodeMessage = (g, now = Date.now()) => {
  const left = MAX_WRONG_CODES - (g?.wrong || 0);
  return lockedFor(g, now) > 0 ? `Too many wrong codes. Please wait ${PAUSE_MINUTES} minutes, then ask for a new code.` : `That code is not right or has expired. ${left} ${left === 1 ? 'try' : 'tries'} left.`;
};
export const waitText = (secs) => { const m = Math.floor(secs / 60); const s = secs % 60; return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`; };
/** Turn the auth server's wording into something a parent can act on. */
export function friendlySendError(msg) {
  const t = String(msg || '').toLowerCase();
  if (/rate|too many|seconds|limit/.test(t)) return 'We have just sent a code. Please wait a minute before asking for another.';
  if (/phone|sms|provider|twilio|unsupported/.test(t)) return 'We could not send the SMS right now. Please try again shortly, or ask the school to check your number.';
  return 'We could not send the code. Check the number and try again.';
}

/** Same idea for the parent password screen (school code + username + password). */
export const wrongPasswordMessage = (g, now = Date.now()) => {
  const left = MAX_WRONG_CODES - (g?.wrong || 0);
  return lockedFor(g, now) > 0 ? `Too many wrong tries. Please wait ${PAUSE_MINUTES} minutes, then try again, or ask the school to reset your password.`
    : `The school code, username or password is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`;
};
