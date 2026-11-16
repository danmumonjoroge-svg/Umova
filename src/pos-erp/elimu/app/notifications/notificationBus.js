// elimu/app/notifications/notificationBus.js -- pure helpers for the bell and the notifications page.
// An item is { id, tone: 'warn' | 'info' | 'ok', title, detail?, to? }. NOTHING here sends a message: a notification only points at work for a person.
const TONE_ORDER = { warn: 0, info: 1, ok: 2 };

/** Flatten several lists, drop malformed items, de-duplicate by id (the first one wins), most urgent first (stable inside a tone). */
export function mergeNotifications(...lists) {
  const seen = new Set(); const out = [];
  for (const it of lists.flat()) {
    if (!it || !it.id || !it.title || seen.has(it.id)) continue;
    seen.add(it.id); out.push({ ...it, tone: TONE_ORDER[it.tone] === undefined ? 'info' : it.tone });
  }
  return out.map((it, i) => [it, i]).sort((a, b) => TONE_ORDER[a[0].tone] - TONE_ORDER[b[0].tone] || a[1] - b[1]).map(([it]) => it);
}
/** How many items the person has not looked at. `seen` is a Set or array of ids. */
export function unseenCount(items, seen) {
  const s = seen instanceof Set ? seen : new Set(seen || []);
  return items.filter((i) => !s.has(i.id)).length;
}
export const badgeText = (n) => (n > 99 ? '99+' : n > 0 ? String(n) : '');
/** Per-person key for remembering which items were seen (ids only; nothing sensitive). */
export const seenKey = (schoolId, userId) => `elimu:notif-seen:${schoolId || '-'}:${userId || '-'}`;
/** Run providers independently: one failing provider never hides the others. Returns the merged list. */
export async function collectNotifications(providers, ctx) {
  const lists = await Promise.all((providers || []).map(async (p) => { try { return (await p(ctx)) || []; } catch { return []; } }));
  return mergeNotifications(...lists);
}
