// "Pick up where you left off": remembers which menu pages this person opened, on this device only (browser storage; best effort).
// Pure with an injected store so it is tested in plain Node. A page is counted by key; recency wins, then how often.
const KEY = 'elimu-recent-pages';
const read = (store) => { try { const v = JSON.parse(store?.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
export function recordOpen(key, store = (typeof localStorage !== 'undefined' ? localStorage : null), now = Date.now()) {
  if (!key || !store) return;
  try { const all = read(store); const prev = all[key] || { n: 0 }; all[key] = { n: prev.n + 1, t: now };
    const keep = Object.entries(all).sort((a, b) => b[1].t - a[1].t).slice(0, 60); store.setItem(KEY, JSON.stringify(Object.fromEntries(keep))); } catch { /* storage blocked: nothing is remembered */ }
}
/** Up to `limit` of the given page keys this person opened most recently. */
export function recentAmong(keys, limit = 3, store = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  const all = read(store); const set = new Set(keys);
  return Object.entries(all).filter(([k]) => set.has(k)).sort((a, b) => b[1].t - a[1].t || b[1].n - a[1].n).slice(0, limit).map(([k]) => k);
}
