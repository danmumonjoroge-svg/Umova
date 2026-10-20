/* eslint-disable no-restricted-globals */
// public/service-worker.js
//
// OFFLINE MODE, part 1: lets the app OPEN with no internet.
//
// Without this file, a phone with no signal cannot even load the page, so none of the saved-sales / saved-stock work inside
// the app matters. This keeps a copy of the app's own files (the page, scripts and styles) on the phone, the way a
// downloaded app would.
//
// What it does NOT do (on purpose):
//   * It never touches Supabase or any other website -- only this app's own files. Business data is the app's job
//     (IndexedDB in the browser), never this file's. So it can never serve stale money data.
//   * It never caches POST/PUT/DELETE.
//
// How it behaves:
//   * First visit (online): saves the app shell and every script/style listed in /asset-manifest.json.
//   * Opening a page: tries the internet for up to 4 seconds (so new versions arrive quickly), else uses the saved copy.
//   * Scripts/styles/images (they have unique names per version): saved copy first, internet only if missing.
//   * New version deployed: the next online visit saves the new files and removes the old ones.
//
// Change VERSION only if this file's own logic changes (it forces a clean start).

const VERSION = 'umova-offline-v1';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const BASE = new URL(self.registration.scope).pathname.replace(/\/?$/, '/'); // "/" normally
const INDEX = `${BASE}index.html`;
const OFFLINE_PAGE = `${BASE}offline.html`;
const NAV_TIMEOUT_MS = 4000;

const sameOrigin = (url) => url.origin === self.location.origin;

async function precacheFromManifest({ prune = false } = {}) {
  try {
    const res = await fetch(`${BASE}asset-manifest.json`, { cache: 'no-store' });
    if (!res.ok) return;
    const manifest = await res.json();
    const files = Object.values(manifest.files || {})
      .filter((f) => typeof f === 'string' && !f.endsWith('.map') && !f.endsWith('index.html'))
      .map((f) => new URL(f, self.location.origin + BASE).pathname);
    const cache = await caches.open(ASSETS);
    await Promise.all(files.map(async (f) => {
      if (await cache.match(f)) return;
      try { const r = await fetch(f); if (r.ok) await cache.put(f, r); } catch { /* one missing file must not stop the rest */ }
    }));
    if (prune) {
      const keep = new Set(files);
      for (const req of await cache.keys()) {
        const p = new URL(req.url).pathname;
        if (p.includes('/static/') && !keep.has(p)) await cache.delete(req);
      }
    }
  } catch { /* offline right now -- the next online visit will do it */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    // the page itself (every route is the same single-page app) and the "no internet yet" page
    await Promise.all([INDEX, OFFLINE_PAGE, `${BASE}manifest.json`].map(async (u) => {
      try { const r = await fetch(u, { cache: 'no-store' }); if (r.ok) await shell.put(u, r); } catch { /* optional */ }
    }));
    await precacheFromManifest();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (!k.startsWith(VERSION)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function networkFirstNavigation(request) {
  const shell = await caches.open(SHELL);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), NAV_TIMEOUT_MS);
    const res = await fetch(request, { signal: ctrl.signal });
    clearTimeout(timer);
    const type = res.headers.get('content-type') || '';
    if (res.ok && type.includes('text/html')) {
      shell.put(INDEX, res.clone());                  // remember the newest page
      precacheFromManifest({ prune: true });          // and its new scripts/styles, in the background
    }
    return res;
  } catch {
    return (await shell.match(INDEX)) || (await shell.match(OFFLINE_PAGE)) ||
      new Response('Offline. Open the app once with internet first.', { status: 503, headers: { 'content-type': 'text/plain' } });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  const refresh = fetch(request).then((res) => { if (res.ok) cache.put(request, res.clone()); return res; }).catch(() => null);
  return hit || (await refresh) || new Response('', { status: 504 });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!sameOrigin(url)) return;                                   // Supabase, fonts, etc.: not our business
  if (url.pathname.endsWith('/service-worker.js') || url.pathname.endsWith('/asset-manifest.json')) return;
  if (url.pathname.includes('hot-update') || url.pathname.includes('sockjs-node')) return; // dev server

  if (request.mode === 'navigate') { event.respondWith(networkFirstNavigation(request)); return; }
  if (url.pathname.includes('/static/')) { event.respondWith(cacheFirst(request).catch(() => new Response('', { status: 504 }))); return; }
  event.respondWith(staleWhileRevalidate(request));
});
