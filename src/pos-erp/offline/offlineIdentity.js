// src/pos-erp/offline/offlineIdentity.js
//
// "Who was signed in on this phone, and may they keep working with no internet?"
//
// THE PROBLEM THIS SOLVES: opening My Business with no signal used to sit on the loading spinner forever (the profile
// check is a server call that never answers), or send the cashier back to the login screen once the sign-in token had
// aged past an hour. A till that cannot be opened in the middle of a power/data outage is not an offline till.
//
// WHAT IT STORES: only the same profile the server already gave this phone after a real online sign-in (staff name, role,
// business). NO password, NO token, NO secret. The real sign-in token still lives where it always did.
//
// SAFETY RULES (deliberate):
//   * It is written only after a successful ONLINE check, so it can never invent a person who never signed in.
//   * It is erased on sign-out (shared phones) and whenever the server says the account is no longer allowed.
//   * It expires: after OFFLINE_GRACE_DAYS without a successful online check the person must sign in with internet again.
//   * It only lets the screen OPEN. It grants nothing extra: the database still decides every save once online, so a
//     staff member disabled while offline is refused when their saved sales are sent (they show as "needs attention").
//   * A person who must change their password is never let in offline.

const KEY = 'umova_pos_offline_identity_v1';
export const OFFLINE_GRACE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function store() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export function saveOfflineIdentity({ staff, tenant }, now = Date.now()) {
  const s = store();
  if (!s || !staff?.id || !tenant?.id) return false;
  try {
    s.setItem(KEY, JSON.stringify({ v: 1, staff, tenant, validatedAt: now }));
    return true;
  } catch { return false; }
}

/** -> { staff, tenant, validatedAt } or null (none saved, unreadable, expired, or must change password). */
export function loadOfflineIdentity(now = Date.now()) {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return null;
    const id = JSON.parse(raw);
    if (!id?.staff?.id || !id?.tenant?.id || !id.validatedAt) return null;
    if (now - id.validatedAt > OFFLINE_GRACE_DAYS * DAY_MS) return null;
    if (id.staff.must_change_password) return null;
    return id;
  } catch { return null; }
}

export function clearOfflineIdentity() {
  const s = store();
  try { s?.removeItem(KEY); } catch { /* nothing to clear */ }
}

/** Light check that the server can really be reached (a phone can say "online" with no route out). */
export async function canReachServer(timeoutMs = 4000) {
  const url = typeof process !== 'undefined' ? process.env?.REACT_APP_SUPABASE_URL : null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  if (!url) return typeof navigator === 'undefined' ? true : navigator.onLine;
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    const res = await fetch(`${url}/rest/v1/`, { method: 'HEAD', signal: c.signal });
    clearTimeout(t);
    return res.status < 500;
  } catch { return false; }
}
