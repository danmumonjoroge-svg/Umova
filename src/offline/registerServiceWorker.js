// src/offline/registerServiceWorker.js
//
// OFFLINE MODE, part 1 (shared by POS, Chama and Finance): registers public/service-worker.js so the app can open with no
// internet, and asks the browser to keep the phone's saved data (sales waiting to be sent, item list, etc.) safe.
//
// Skipped in: development (it fights hot-reload), the installed Android/iOS app (its files are already on the phone),
// and plain http (browsers only allow this on https or localhost).

/** Ask the browser not to clear this site's saved data when the phone is short of space. */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      return await navigator.storage.persist();
    }
    return true;
  } catch { return false; }
}

export function registerServiceWorker() {
  try {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    requestPersistentStorage(); // useful even where the worker itself is skipped
    if (window.Capacitor?.isNativePlatform?.()) return;
    if (process.env.NODE_ENV !== 'production') return;
    const secure = window.location.protocol === 'https:' || window.location.hostname === 'localhost';
    if (!secure) return;
    const url = `${process.env.PUBLIC_URL || ''}/service-worker.js`;
    const start = () => navigator.serviceWorker.register(url).catch((err) => console.warn('[offline] service worker not registered:', err));
    if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
  } catch { /* the app works the same without it, just not offline */ }
}
