// The phone bottom bar: Home + the school's MAJOR modules (the top level of the menu tree), then Menu for everything else.
// A major module is a whole area of the school (Academics, Registration, Finance...), not a single page, so a teacher taps
// Academics and finds attendance, exams, timetable and materials grouped inside it (as sub and sub-sub menus).
// Pure helpers (no React) so they are tested in plain Node.
import { visibleChildren, soleLeaf } from './menuKit.js';

/** Which modules earn a tab, best first. The first MAX_MODULE_TABS the person can actually see get one; the rest live under Menu. */
export const TAB_ORDER = ['academics', 'registration', 'finance', 'security', 'administration', 'parents'];   // Settings never takes a tab: everyone can see "My sign-in", so it would crowd out a gate officer's Security tab
export const MAX_MODULE_TABS = 3;
export const SHORT_LABEL = { registration: 'Students', parents: 'Parents' };   // the bar is narrow: "Students" says what Registration holds

export function bottomTabs(tree, can, owner = true) {
  const vis = visibleChildren(tree, can, owner);
  const byKey = new Map(vis.map((m) => [m.key, m]));
  const picked = TAB_ORDER.filter((k) => byKey.has(k)).slice(0, MAX_MODULE_TABS).map((k) => byKey.get(k));
  const pickedKeys = new Set(picked.map((m) => m.key));
  // a module that holds a single page (Finance) opens that page directly: `to` is its route, otherwise the tab opens the module screen
  return { modules: picked.map((m) => ({ key: m.key, label: SHORT_LABEL[m.key] || m.label, icon: m.icon, to: soleLeaf(m, can, owner)?.to || null })), rest: vis.filter((m) => !pickedKeys.has(m.key)).map((m) => m.key) };
}

/** Which module a page belongs to, from its route (relative to the school base, e.g. "attendance/take" or "menu/finance/fees"). Longest page path wins. */
export function moduleOfPath(tree, rel) {
  const path = String(rel || '').replace(/^\/+|\/+$/g, '');
  const m = path.match(/^menu\/([^/]+)/); if (m) return m[1];
  let best = { len: -1, key: null };
  const walk = (n, mod) => {
    for (const c of n.children || []) {
      const top = mod || c.key;
      if (c.children) walk(c, top);
      else if (c.to && (path === c.to || path.startsWith(`${c.to}/`)) && c.to.length > best.len) best = { len: c.to.length, key: top };
    }
  };
  walk(tree, null);
  return best.key;
}
