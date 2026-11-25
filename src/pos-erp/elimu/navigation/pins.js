// Pinned pages for the laptop sidebar: the pages this person starred, on this device only (browser storage; best effort). Pure with an injected store.
const KEY = 'elimu-pinned-pages';
const ls = () => (typeof localStorage !== 'undefined' ? localStorage : null);
export function readPins(store = ls()) { try { const v = JSON.parse(store?.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; } }
/** Pin or unpin a page; returns the new list (newest first, at most 12). */
export function togglePin(key, store = ls()) {
  const cur = readPins(store); const next = cur.includes(key) ? cur.filter((k) => k !== key) : [key, ...cur].slice(0, 12);
  try { store?.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked: the pin lasts until the page is closed */ }
  return next;
}
export const readFlag = (name, store = ls()) => { try { return store?.getItem(name) === '1'; } catch { return false; } };
export const writeFlag = (name, on, store = ls()) => { try { store?.setItem(name, on ? '1' : '0'); } catch { /* best effort */ } };
