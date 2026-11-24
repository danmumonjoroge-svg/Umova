// A drill-down menu: shows the groups under `segs`, with a breadcrumb and (at the top level) a search box. Router-agnostic:
// the caller owns the position (`segs`) and decides what opening a page means (`onOpen(page)`).
import React, { useState } from 'react';
import { ChevronRight, FolderOpen, Search, Building2, ClipboardList, GraduationCap, ShieldCheck, Wallet, Users, Settings, BookOpen, CalendarCheck, DoorOpen, CalendarDays, Megaphone, LifeBuoy } from 'lucide-react';
import { findNode, visibleChildren, searchPages, countPages, leavesOf, soleLeaf } from '../navigation/menuKit.js';
import { recordOpen, recentAmong } from '../navigation/recents.js';
import { MenuCards } from '../ui/cards/MenuCards.jsx';
import { ModuleHub } from '../ui/cards/ModuleCards.jsx';

const ICONS = { Building2, ClipboardList, GraduationCap, ShieldCheck, Wallet, Users, Settings, BookOpen, CalendarCheck, DoorOpen, CalendarDays, Megaphone, LifeBuoy };

export default function MenuTree({ tree, segs, onGo, onOpen, can, owner = true, rootLabel = 'Menu', searchable = true }) {
  const [q, setQ] = useState('');
  const node = findNode(tree, segs);
  if (!node) return <p className="p-4 text-sm text-[#6F7461]">That section does not exist. <button type="button" className="underline" onClick={() => onGo([])}>Back to {rootLabel}</button></p>;
  const hits = searchable && segs.length === 0 && q.trim().length >= 2 ? searchPages(tree, q, can, owner) : null;
  const kids = hits || visibleChildren(node, can, owner);
  const crumbs = [{ label: rootLabel, segs: [] }, ...segs.map((s, i) => ({ label: findNode(tree, segs.slice(0, i + 1))?.label || s, segs: segs.slice(0, i + 1) }))];
  const openPage = (p) => { recordOpen(p.key); onOpen(p); };
  // a group that holds a single page (Finance) opens that page straight away; no screen in between
  const open = (k) => { if (k.soon) return; if (k.children) { const only = soleLeaf(k, can, owner); if (only) openPage(only); else onGo([...segs, k.key]); } else openPage(k); };
  return (
    <div>
      {segs.length > 0 && (
        <nav aria-label="Where you are" className="flex flex-wrap items-center gap-1 text-xs text-[#6F7461] mb-3">
          {crumbs.map((c, i) => (<React.Fragment key={c.segs.join('/') || 'root'}>{i > 0 && <ChevronRight size={12} />}{i === crumbs.length - 1 ? <span className="font-semibold text-[#23382B]">{c.label}</span> : <button type="button" onClick={() => onGo(c.segs)} className="underline-offset-2 hover:underline">{c.label}</button>}</React.Fragment>))}
        </nav>)}
      {searchable && segs.length === 0 && (
        <label className="flex items-center gap-2 rounded-xl border border-[#E3DBB8] bg-white px-3 min-h-[44px] mb-3"><Search size={16} className="text-[#6F7461]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the menu (for example: report card, gate)" className="flex-1 bg-transparent outline-none text-sm" aria-label="Search the menu" /></label>)}
      {!hits && segs.length === 1 && kids.length > 0 ? (
        <ModuleHub node={node} Icon={ICONS[node.icon] || FolderOpen} pages={countPages(node)}
          subs={kids.filter((k) => k.children).map((g) => ({ node: g, Icon: ICONS[g.icon] || FolderOpen, pages: countPages(g),
            items: visibleChildren(g, can, owner).map((c) => (c.children ? { ...c, pagesCount: countPages(c) } : c)) }))}
          allLeaves={leavesOf(node, can, owner)} recentKeys={recentAmong(leavesOf(node, can, owner).map((l) => l.key))}
          pageNodes={kids.filter((k) => !k.children)} onOpenGroup={(g, parent) => onGo(parent ? [...segs, parent.key, g.key] : [...segs, g.key])} onOpenPage={(pg) => openPage(pg)} />
      ) : kids.length === 0 ? <p className="rounded-xl bg-white border border-[#E3DBB8] p-4 text-sm text-[#6F7461]">{hits ? 'No page matches that.' : 'Nothing here is available to your role.'}</p> : (
        <MenuCards kids={kids} depth={hits ? 1 : segs.length} open={open}
          describe={(k) => ({ Icon: ICONS[k.icon] || (k.children ? FolderOpen : undefined), pages: countPages(k), peek: k.children ? visibleChildren(k, can, owner).slice(0, 4).map((c) => c.label) : [] })} />)}
    </div>
  );
}
