// Shared helpers for grouped menus (school staff menu, parent portal menu). A node is { key, label, desc, icon, children } (a group)
// or { key, label, desc, to } (a page) or { ..., soon: true } (planned, shown greyed). Visibility only: the database still decides access.
export function findNode(tree, segments) {
  let node = tree;
  for (const seg of segments.filter(Boolean)) { node = (node.children || []).find((c) => c.key === seg); if (!node) return null; }
  return node;
}
const allowed = (n, can, owner) => (!n.anyOf || n.anyOf.some((a) => can(a))) && (!n.ownerOnly || owner);
/** Children this person may see. A group is shown when at least one page under it is allowed (or planned). Planned (soon) pages are always listed. */
export function visibleChildren(node, can, owner = true) {
  const ok = (n) => (n.children ? n.children.some(ok) : n.soon || allowed(n, can, owner));
  return (node.children || []).filter(ok);
}
/** Every page under a node that the person may open or that is planned, with its breadcrumb text. Used by the menu search box. */
export function searchPages(tree, text, can, owner = true) {
  const q = text.trim().toLowerCase(); if (q.length < 2) return [];
  const out = [];
  const walk = (n, trail, segs) => {
    for (const c of n.children || []) {
      if (c.children) walk(c, [...trail, c.label], [...segs, c.key]);
      else if ((c.soon || allowed(c, can, owner)) && `${c.label} ${c.desc || ''} ${trail.join(' ')}`.toLowerCase().includes(q)) out.push({ ...c, trail: trail.join(' › '), segs: [...segs, c.key] });
    }
  };
  walk(tree, [], []);
  return out;
}
export const countPages = (node) => (node.children ? node.children.reduce((t, c) => t + countPages(c), 0) : 1);
export const countSoon = (node) => (node.children ? node.children.reduce((t, c) => t + countSoon(c), 0) : node.soon ? 1 : 0);
