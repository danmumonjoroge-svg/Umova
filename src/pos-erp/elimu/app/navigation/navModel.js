// elimu/app/navigation/navModel.js -- the menu model. Pure (runs in plain Node).
// ONE source of entries: NAV_ITEMS in utils/permissions.js (key, label, path, action, owned, ownerOnly, anyOf, also). This file only adds
// grouping and the rules for what a person sees and which entry is "current". Hiding an entry is presentation only: routes are guarded and
// the database (RLS) decides what a click may do.
import { NAV_ITEMS } from '../../utils/permissions.js';

export const NAV_GROUPS = [
  { key: 'main', label: '' },
  { key: 'people', label: 'People' },
  { key: 'academics', label: 'Academics' },
  { key: 'daily', label: 'Daily operations' },
  { key: 'money', label: 'Finance & reports' },
];
const GROUP_OF = {
  dashboard: 'main',
  students: 'people', guardians: 'people', admissions: 'people', staff: 'people',
  classes: 'academics', academics: 'academics', timetable: 'academics', rooms: 'academics',
  attendance: 'daily', gate: 'daily', calendar: 'daily', communication: 'daily',
  fees: 'money', reports: 'money',
};
/** Pinned at the foot of the sidebar instead of a group. */
export const PINNED_KEYS = ['settings'];
/** Tabs shown on the phone's bottom bar (when the person may see them); everything else goes under "More". */
export const PRIMARY_TABS = ['dashboard', 'students', 'attendance', 'fees'];

const trim = (p) => String(p || '').replace(/\/+$/, '') || '/';

/** Entries this person may see. `modules` = Set of registered module keys; `can(action)`; `isOwner`. */
export function visibleNav({ can = () => false, isOwner = false, modules = new Set() } = {}) {
  return NAV_ITEMS.filter((n) =>
    (!n.ownerOnly || isOwner) &&
    (n.owned || modules.has(n.key)) &&
    (n.anyOf ? n.anyOf.some((a) => can(a)) : can(n.action)));
}

/** [{ key, label, items }] for the sidebar (pinned entries excluded, empty groups dropped, catalog order kept). */
export function groupNav(items) {
  const body = items.filter((n) => !PINNED_KEYS.includes(n.key));
  return NAV_GROUPS.map((g) => ({ ...g, items: body.filter((n) => (GROUP_OF[n.key] || 'daily') === g.key) })).filter((g) => g.items.length);
}
export const pinnedNav = (items) => items.filter((n) => PINNED_KEYS.includes(n.key));

/** Phone bottom bar: { tabs, rest }. `rest` feeds the More sheet (pinned entries such as Settings included). */
export function splitTabs(items) {
  return { tabs: items.filter((n) => PRIMARY_TABS.includes(n.key)), rest: items.filter((n) => !PRIMARY_TABS.includes(n.key)) };
}

export const navHref = (item, base) => `${trim(base) === '/' ? '' : trim(base)}${item.to}`;

/** Length of the path prefix of `item` that matches `pathname` (0 = no match). Dashboard matches only the base itself. */
function matchLength(item, pathname, base) {
  const b = trim(base) === '/' ? '' : trim(base); const p = trim(pathname);
  if (item.to === '') return p === (b || '/') || p === `${b}/dashboard` ? b.length + 1 : 0;
  let best = 0;
  for (const prefix of [item.to, ...(item.also || [])]) {
    const full = `${b}${prefix}`;
    if (p === full || p.startsWith(`${full}/`)) best = Math.max(best, full.length);
  }
  return best;
}
export const isActive = (item, pathname, base) => matchLength(item, pathname, base) > 0;

/** The entry that owns `pathname`: the one with the LONGEST matching prefix (so /finance beats nothing, /students/s1 -> Students). */
export function activeItem(items, pathname, base) {
  let hit = null; let len = 0;
  for (const n of items) { const l = matchLength(n, pathname, base); if (l > len) { hit = n; len = l; } }
  return hit;
}
