// src/pos-erp/offline/netErrors.js
//
// ONE place that answers "was that failure just the internet?" and "was that failure a sign-in problem?".
// Pure functions, no imports -- so the sale queue, the shift queue, sign-in, the barcode scanner and the Chama/
// Finance modules can all share the same answer instead of each guessing differently.
//
// WHY THIS EXISTS (found in the audit): supabase-js does NOT throw a TypeError when the network is down. It hands back
// { error: { message: "TypeError: Failed to fetch", ... } } and the services then `throw error` -- a plain object whose
// `.name` is NOT "TypeError". The old checks (`err.name === 'TypeError'`) therefore never matched, so a dropped
// connection in the middle of a sale or a sync was treated as a real rejection ("needs attention") instead of
// "try again later". Matching on the message fixes that.

const NETWORK_MESSAGE = /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|err_network|network error|offline/i;

export function isOfflineNow() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** True when the failure is the connection, not the data. Safe default for money: retry, never discard. */
export function isNetworkFailure(err) {
  if (isOfflineNow()) return true;
  if (!err) return false;
  const name = String(err.name || '');
  if (name === 'AuthRetryableFetchError' || name === 'AbortError') return true;
  if (err.status === 0) return true;
  const msg = typeof err === 'string' ? err : String(err.message || '');
  return NETWORK_MESSAGE.test(msg);
}

/** True when the server is telling us the sign-in is missing/expired (not that the data is bad). */
export function isAuthFailure(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '').toLowerCase();
  return (
    err.status === 401 ||
    code === 'PGRST301' || code === 'PGRST303' ||
    msg.includes('jwt expired') || msg.includes('jwt') && msg.includes('invalid') ||
    msg.includes('not authenticated') || msg.includes('invalid refresh token')
  );
}

/** "Already saved" -- a primary-key / unique-key refusal on a row we supplied the id for. Treated as success on retry. */
export function isDuplicateKey(err) {
  return String(err?.code) === '23505' || /duplicate key/i.test(String(err?.message || ''));
}
