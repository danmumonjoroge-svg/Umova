// src/pos-erp/offline/readThrough.js
//
// "Try the server; if the phone has no internet, show the copy saved on the phone." One helper for every list page, built on
// the EXISTING local database (the `meta` table under the "cache:" prefix, which sign-out and a different business signing in
// already empty -- see offlineCache.clearOfflineCaches / ensureCacheOwner). No second database, no second sync engine.
//
// HONESTY RULES
//   * A copy is only used when the failure really is "no connection" (isNetworkFailure). A refusal (permissions, bad data) is
//     still shown as an error -- never hidden behind old data.
//   * Every copy carries the business it belongs to and when it was saved. A copy for a different business is never returned.
//   * Whatever is shown from a copy is reported as fromCache=true with savedAt, so the screen can say "saved copy from 14:02".
//   * A copy can be incomplete (a big business can exceed the saved limit): complete=false is reported too.
//   * This file only ever reads/writes `cache:rt:*` rows. It never touches the sync queue.

import { getMeta, setMeta } from './db';
import { isNetworkFailure } from './netErrors';

const keyOf = (collection) => `cache:rt:${collection}`;

/** Save a full list for a collection. `rows` = everything we could fetch; `complete` = false if we hit the safety cap. */
export async function saveSnapshot(collection, tenantId, rows, { complete = true } = {}) {
  if (!tenantId || !Array.isArray(rows)) return false;
  try {
    await setMeta(keyOf(collection), { value: { tenantId, rows, complete }, at: new Date().toISOString() });
    return true;
  } catch { return false; } // storage full / unavailable: the page still works online
}

/** -> { rows, complete, savedAt } or null (none, unreadable, or it belongs to another business). */
export async function readSnapshot(collection, tenantId) {
  try {
    const rec = await getMeta(keyOf(collection));
    if (!rec?.value || !Array.isArray(rec.value.rows)) return null;
    if (!tenantId || rec.value.tenantId !== tenantId) return null; // tenant isolation: never show another business's copy
    return { rows: rec.value.rows, complete: rec.value.complete !== false, savedAt: rec.at || null };
  } catch { return null; }
}

/** Search + page a saved list the way the server would, so the same screen works unchanged. */
export function applyParams(rows, params = {}, { searchFields = [], where } = {}) {
  let out = rows;
  const term = String(params.search || '').trim().toLowerCase();
  if (term && searchFields.length) out = out.filter((r) => searchFields.some((f) => String(r?.[f] ?? '').toLowerCase().includes(term)));
  if (where) out = out.filter((r) => where(r, params));
  const limit = Number(params.limit) > 0 ? Number(params.limit) : 50;
  const page = Number(params.page) > 0 ? Number(params.page) : 1;
  return { data: out.slice((page - 1) * limit, page * limit), count: out.length, page, limit };
}

/**
 * @param {string} collection  e.g. 'expenses'
 * @param {() => Promise<any>} fetcher  the normal server call (returns what the page already expects)
 * @param {{tenantId:string, params?:object, searchFields?:string[], where?:Function, shape?:'paged'|'list'}} opts
 * @returns {Promise<{result:any, fromCache:boolean, savedAt:string|null, complete:boolean}>}
 */
export async function readThrough(collection, fetcher, { tenantId, params = {}, searchFields = [], where, shape = 'paged' } = {}) {
  try {
    const result = await fetcher();
    return { result, fromCache: false, savedAt: null, complete: true };
  } catch (err) {
    if (!isNetworkFailure(err)) throw err;
    const snap = await readSnapshot(collection, tenantId);
    if (!snap) throw err; // nothing saved yet on this phone: let the page show its normal error
    const result = shape === 'list' ? snap.rows : applyParams(snap.rows, params, { searchFields, where });
    return { result, fromCache: true, savedAt: snap.savedAt, complete: snap.complete };
  }
}

/** Fetch up to maxPages pages of `pageSize` rows. complete=false when the cap was hit with a full last page. */
export async function pullPages(fetchPage, { pageSize = 500, maxPages = 4 } = {}) {
  const rows = [];
  let complete = true;
  for (let page = 1; page <= maxPages; page++) {
    const r = await fetchPage(page, pageSize);
    const got = r?.data || [];
    rows.push(...got);
    if (got.length < pageSize) return { rows, complete: true };
    if (page === maxPages) complete = false;
  }
  return { rows, complete };
}
