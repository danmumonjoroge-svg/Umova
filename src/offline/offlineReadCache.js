// src/offline/offlineReadCache.js
//
// OFFLINE READING for the whole app, added once at the point where the app talks to the database, so no screen has to change.
//
//   createCachedFetch(...) returns a fetch() for supabase-js (createClient(..., { global: { fetch } })).
//     * Online: every successful READ (GET /rest/v1/<table>) of an approved table is passed through unchanged and a copy is
//       kept on the phone.
//     * Offline (the request fails because of the network): if a recent copy of that exact request exists, it is returned
//       instead of an error, and the app is told "this is saved data from <time>" (see getStaleInfo / subscribeStale).
//
// What it NEVER does:
//   * It never caches or fakes a write (POST / PATCH / PUT / DELETE), an RPC call, or a HEAD request. Offline, those fail
//     exactly as they do today. Money actions are never queued or "done" by this file.
//   * It never replaces a real answer from the server: a 401 / 403 / 500 is returned as is, not swapped for saved data.
//   * It never keeps tables that hold secrets (staff accounts, audit logs, passkeys, M-Pesa secrets, documents ...).
//
// Safety of what is kept on the phone:
//   * Encrypted (AES-GCM). The key is created on the phone and kept in the Android Keystore (secure storage), never in code.
//   * Stored per signed-in user (taken from the access token), so one person never gets another's saved data.
//   * The request URL is stored only as a hash (URLs can contain names, phone numbers, ids).
//   * Expires after 7 days; capped per item and in total (oldest-used removed first); wiped by clearOfflineReadCache()
//     on logout; a damaged or tampered copy is treated as "no copy", never as data.
//   * Only runs inside the phone app (Capacitor native). On the web it does nothing.

import { Capacitor } from "@capacitor/core";

export const CACHE_POLICY = Object.freeze({
  ttlMs: 7 * 24 * 60 * 60 * 1000,        // a saved copy older than this is not used
  maxEntryBytes: 1.5 * 1024 * 1024,      // one response larger than this is not kept
  maxTotalBytes: 40 * 1024 * 1024,       // everything together; oldest-used copies are removed beyond this
  // Tables approved for offline reading (prefix match). Everything else is passed through and never kept.
  allow: [
    "members", "loans", "loan_", "general_ledger", "chart_of_accounts", "accounting_periods", "journal_entries",
    "customer_invoices", "supplier_invoices", "suppliers", "fixed_assets", "notifications", "member_stories", "transactions",
    "chama_", "welfare_", "lb_",
  ],
  // Kept ONLY when the request is for the signed-in user's own row (…?auth_user_id=eq.<their id>). The app needs that one
  // row to work out the user's role; the staff list as a whole is never kept.
  ownRowOnly: ["users"],
  // Never kept, even if a prefix above would match.
  deny: [
    "audit_logs", "webauthn_", "trusted_devices", "chama_trusted_devices", "chama_users", "whatsapp_outbox",
    "profile_photo", "loan_documents", "membership_applications", "pos_registration_requests",
    "lb_mpesa_secrets", "lb_mpesa_config",
  ],
});

const DB_NAME = "umova_readcache";
const STORE = "entries";
const EVENT = "umova:offline-read";
const KEY_NAME = "umova.readcache.key.v1";

// ---------------------------------------------------------------- policy ----
const tableOf = (url) => {
  const m = /\/rest\/v1\/([^/?#]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
};

export function isCacheable(method, url, userKey = "anon") {
  if (method !== "GET") return false;
  if (!/\/rest\/v1\//.test(url) || /\/rest\/v1\/rpc\//.test(url)) return false;
  const t = tableOf(url);
  if (!t) return false;
  if (CACHE_POLICY.ownRowOnly.includes(t)) {
    const sub = userKey.startsWith("u:") ? userKey.slice(2) : null;
    return !!sub && url.includes(`auth_user_id=eq.${sub}`) && !/[?&]or=/.test(url);
  }
  if (CACHE_POLICY.deny.some((d) => t === d || t.startsWith(d))) return false;
  return CACHE_POLICY.allow.some((a) => t === a || t.startsWith(a));
}

const isNetworkFailure = (e) =>
  e?.name !== "AbortError" && (e instanceof TypeError || /failed to fetch|network|load failed|offline/i.test(String(e?.message || e)));

// Who is asking? From the access token's claims (never stored); "anon" for the public key (Chama signs in without a token).
export function userKeyFromAuth(authHeader) {
  try {
    const token = /^Bearer\s+(.+)$/i.exec(authHeader || "")?.[1];
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.sub && payload.role !== "anon" ? `u:${payload.sub}` : "anon";
  } catch {
    return "anon";
  }
}

// ---------------------------------------------------------------- crypto ----
const b64 = {
  // In chunks: spreading a large array into one String.fromCharCode(...) call throws "too many arguments" past ~100 KB.
  enc: (u8) => {
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  },
  dec: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

// The Capacitor plugin object is a Proxy: it must never be returned from an async function, only inside a plain object.
async function defaultKeyStore() {
  const holder = { plugin: (await import("@aparajita/capacitor-secure-storage")).SecureStorage };
  return {
    get: async () => { try { return (await holder.plugin.get(KEY_NAME)) || null; } catch { return null; } },
    set: async (v) => { await holder.plugin.set(KEY_NAME, v); },
  };
}

// Every client the app creates (main + POS) must use the SAME key. If each made its own on first start, the second
// would overwrite the first in secure storage and the first one's saved copies could never be read again.
const customKeys = new WeakMap();
let defaultKeyP = null;
function sharedKey(keyStore) {
  if (keyStore) {
    if (!customKeys.has(keyStore)) customKeys.set(keyStore, loadKey(keyStore));
    return customKeys.get(keyStore);
  }
  if (!defaultKeyP) {
    defaultKeyP = (async () => loadKey(await defaultKeyStore()))().catch((e) => { defaultKeyP = null; throw e; });
  }
  return defaultKeyP;
}

async function loadKey(keyStore) {
  let raw = await keyStore.get();
  if (!raw || typeof raw !== "string") {
    raw = b64.enc(crypto.getRandomValues(new Uint8Array(32)));
    await keyStore.set(raw);
  }
  return crypto.subtle.importKey("raw", b64.dec(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------- IndexedDB ----
function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: "id" }); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const tx = (db, mode, fn) =>
  new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
const dbGet = (db, id) => tx(db, "readonly", (s) => s.get(id));
const dbPut = (db, rec) => tx(db, "readwrite", (s) => s.put(rec));
const dbDelete = (db, id) => tx(db, "readwrite", (s) => s.delete(id));
const dbAll = (db) => tx(db, "readonly", (s) => s.getAll());
const dbClear = (db) => tx(db, "readwrite", (s) => s.clear());

// ------------------------------------------------------- stale-data status ----
let staleInfo = null;                         // { ts, at }  ts = when the saved copy was taken
const listeners = new Set();
export const getStaleInfo = () => staleInfo;
export function subscribeStale(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function announceStale(ts) {
  staleInfo = { ts, at: Date.now() };
  listeners.forEach((fn) => { try { fn(staleInfo); } catch { /* ignore a bad listener */ } });
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: staleInfo })); } catch { /* not in a browser */ }
}
/** Call when the connection is back, so the "showing saved data" notice goes away. */
export function clearStaleInfo() {
  staleInfo = null;
  listeners.forEach((fn) => { try { fn(null); } catch { /* ignore */ } });
}

// ---------------------------------------------------------------- factory ----
const pending = new Set();                    // background saves in flight (flushPending() lets tests wait for them)
export const flushPending = () => Promise.all([...pending]);

let shared = null;                            // clearOfflineReadCache() works on whatever the app created
export async function clearOfflineReadCache() {
  clearStaleInfo();
  if (!shared) return;
  try { await dbClear(await shared.db()); } catch { /* nothing to clear */ }
}

/**
 * @param baseFetch  the real fetch (default: global fetch)
 * @param enabled    () => boolean (default: only inside the native phone app)
 * @param keyStore   { get, set } for the encryption key (default: Android Keystore via secure storage)
 * @param policy     optional overrides for ttlMs / maxEntryBytes / maxTotalBytes (defaults: CACHE_POLICY)
 */
export function createCachedFetch({
  baseFetch = (...a) => fetch(...a),
  enabled = () => { try { return Capacitor.isNativePlatform(); } catch { return false; } },
  keyStore,
  policy,
} = {}) {
  const P = { ...CACHE_POLICY, ...(policy || {}) };
  let dbP;
  const db = () => (dbP ||= openDb());
  const key = () => sharedKey(keyStore);
  shared = { db };

  async function entryId(userKey, url, headers) {
    const parts = [userKey, "GET", url, headers.get("accept") || "", headers.get("range") || "", headers.get("prefer") || "",
      headers.get("accept-profile") || ""];
    return sha256Hex(parts.join("\n"));
  }

  async function save(id, userKey, res) {
    const body = await res.text();
    if (body.length * 2 > P.maxEntryBytes) return;                       // too big to keep
    const k = await key();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const payload = JSON.stringify({ s: res.status, h: { "content-type": res.headers.get("content-type"), "content-range": res.headers.get("content-range") }, b: body });
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(payload)));
    const now = Date.now();
    const handle = await db();
    await dbPut(handle, { id, userKey, ts: now, used: now, size: ct.length, iv: b64.enc(iv), data: b64.enc(ct) });
    // keep the total under the cap: remove the least recently used copies first
    const all = await dbAll(handle);
    let total = all.reduce((n, e) => n + (e.size || 0), 0);
    if (total > P.maxTotalBytes) {
      for (const e of all.sort((a, b) => a.used - b.used)) {
        if (total <= P.maxTotalBytes) break;
        await dbDelete(handle, e.id);
        total -= e.size || 0;
      }
    }
  }

  async function lookup(id, userKey) {
    const handle = await db();
    const e = await dbGet(handle, id);
    if (!e || e.userKey !== userKey) return null;
    if (Date.now() - e.ts > P.ttlMs) { await dbDelete(handle, id); return null; }
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64.dec(e.iv) }, await key(), b64.dec(e.data));
      const rec = JSON.parse(new TextDecoder().decode(plain));
      await dbPut(handle, { ...e, used: Date.now() });
      return { ts: e.ts, status: rec.s, headers: rec.h, body: rec.b };
    } catch {
      await dbDelete(handle, id);                                                    // damaged or tampered: no copy
      return null;
    }
  }

  return async function cachedFetch(input, init) {
    const url = typeof input === "string" ? input : input?.url || String(input);
    const method = String(init?.method || input?.method || "GET").toUpperCase();
    if (!enabled() || method !== "GET" || !/\/rest\/v1\//.test(url)) return baseFetch(input, init);

    const headers = new Headers(init?.headers || input?.headers || {});
    const userKey = userKeyFromAuth(headers.get("authorization"));
    if (!isCacheable(method, url, userKey)) return baseFetch(input, init);
    let id;
    try { id = await entryId(userKey, url, headers); } catch { return baseFetch(input, init); }

    try {
      const res = await baseFetch(input, init);
      if (staleInfo) clearStaleInfo();                                              // the network answered: no longer showing saved data
      if (res.ok && (res.status === 200 || res.status === 206)) {
        const p = save(id, userKey, res.clone()).catch(() => { /* never let saving break a request */ }).finally(() => pending.delete(p));
        pending.add(p);
      }
      return res;
    } catch (err) {
      if (!isNetworkFailure(err)) throw err;
      let hit = null;
      try { hit = await lookup(id, userKey); } catch { /* no usable copy */ }
      if (!hit) throw err;
      announceStale(hit.ts);
      const h = new Headers();
      Object.entries(hit.headers || {}).forEach(([k, v]) => { if (v) h.set(k, v); });
      h.set("x-umova-from-cache", String(hit.ts));
      return new Response(hit.body, { status: hit.status, headers: h });
    }
  };
}
