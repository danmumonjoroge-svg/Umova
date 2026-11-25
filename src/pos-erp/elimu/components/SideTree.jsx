// elimu/components/SideTree.jsx -- the laptop sidebar, drawn from the SAME menu tree as the phone menu (navigation/schoolTree.js), so every
// page on the phone is on the laptop. Each major module opens to show its sub-modules and pages. Visibility only: the database decides access.
import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronDown, Home } from 'lucide-react';
import { visibleChildren, leavesOf, soleLeaf } from '../navigation/menuKit.js';
import { moduleOfPath } from '../navigation/bottomBar.js';

const split = (to) => { const [p, q] = String(to).split('?'); return { p, q: q || '' }; };

/** The pages of one module as sections [{label, pages}], with pages that open the same screen listed once. */
export function moduleSections(m, can, owner) {
  const seen = new Set(); const out = []; const loose = [];
  const take = (pages) => pages.filter((x) => { if (seen.has(x.to)) return false; seen.add(x.to); return true; });
  visibleChildren(m, can, owner).forEach((c) => {
    if (c.children) { const pages = take(leavesOf(c, can, owner)); if (pages.length) out.push({ key: c.key, label: c.label, pages }); }
    else if (!c.soon) loose.push(c);
  });
  const l = take(loose); if (l.length) out.unshift({ key: '_', label: '', pages: l });
  return out;
}

/** Which of a module's pages is the current one: the longest matching route; a link with a query only when the address has that query. */
export function activePages(sections, rel, search) {
  const all = sections.flatMap((s) => s.pages).map((x) => ({ ...x, ...split(x.to) }));
  const hit = all.filter((x) => rel === x.p || rel.startsWith(`${x.p}/`));
  if (!hit.length) return new Set();
  const longest = Math.max(...hit.map((x) => x.p.length)); const top = hit.filter((x) => x.p.length === longest);
  const withQ = top.filter((x) => x.q && search.includes(x.q)); const pick = withQ.length ? withQ : top.filter((x) => !x.q);
  return new Set((pick.length ? pick : top).map((x) => x.to));
}

export default function SideTree({ tree, basePath, can, isOwner, loc, icons, showHome = true }) {
  const rel = loc.pathname.replace(basePath, '').replace(/^\/+|\/+$/g, ''); const here = moduleOfPath(tree, rel);
  const [open, setOpen] = useState(() => new Set(here ? [here] : []));
  useEffect(() => { if (here) setOpen((o) => (o.has(here) ? o : new Set([...o, here]))); }, [here]);
  const toggle = (k) => setOpen((o) => { const n = new Set(o); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const link = 'relative flex items-center gap-3 pl-3 pr-3 min-h-[44px] mb-0.5 rounded-xl text-sm font-medium transition-colors';
  const onCls = 'bg-[#E4F0E8] text-[#1F6B45] font-semibold'; const offCls = 'text-[#23382B] hover:bg-[#F4EFD3]';
  const mark = (on) => on && <span aria-hidden="true" className="absolute -left-2 top-2.5 bottom-2.5 w-1 rounded-r-full" style={{ background: 'var(--e-primary,#1F6B45)' }} />;
  return (
    <>
      {showHome && <NavLink to={basePath} end className={({ isActive }) => `${link} ${isActive ? onCls : offCls}`}>{({ isActive }) => (<>{mark(isActive)}<span className="flex h-7 w-7 items-center justify-center rounded-lg"><Home size={17} /></span>Dashboard</>)}</NavLink>}
      {visibleChildren(tree, can, isOwner).map((m) => {
        const Icon = icons[m.icon] || Home; const sole = soleLeaf(m, can, isOwner); const isHere = here === m.key;
        if (sole) { const on = isHere || rel.startsWith('school-finance'); return (
          <NavLink key={m.key} to={`${basePath}/${sole.to}`} aria-current={on ? 'page' : undefined} className={`${link} ${on ? onCls : offCls}`}>{mark(on)}<span className="flex h-7 w-7 items-center justify-center rounded-lg"><Icon size={17} /></span>{m.label}</NavLink>); }
        const secs = moduleSections(m, can, isOwner); if (!secs.length) return null; const isOpen = open.has(m.key); const act = isOpen ? activePages(secs, rel, loc.search || '') : new Set();
        return (
          <div key={m.key} className="mb-0.5">
            <button type="button" aria-expanded={isOpen} onClick={() => toggle(m.key)} className={`${link} w-full text-left ${isHere ? 'text-[#1F6B45] font-semibold' : 'text-[#23382B] hover:bg-[#F4EFD3]'}`}>
              {mark(isHere && !isOpen)}<span className="flex h-7 w-7 items-center justify-center rounded-lg"><Icon size={17} strokeWidth={isHere ? 2.4 : 2} /></span><span className="flex-1">{m.label}</span><ChevronDown size={15} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" /></button>
            {isOpen && <div className="ml-6 pl-3 border-l border-[#E3DBB8] mb-1">
              {secs.map((s) => (<div key={s.key}>
                {s.label && <div className="px-2 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-[#6F7461]">{s.label}</div>}
                {s.pages.map((p) => { const on = act.has(p.to); return <NavLink key={p.key} to={`${basePath}/${p.to}`} aria-current={on ? 'page' : undefined} className={`flex items-center px-2 min-h-[38px] rounded-lg text-[13px] ${on ? 'bg-[#E4F0E8] text-[#1F6B45] font-semibold' : 'text-[#23382B] hover:bg-[#F4EFD3]'}`}>{p.label}</NavLink>; })}
              </div>))}
            </div>}
          </div>);
      })}
    </>);
}
