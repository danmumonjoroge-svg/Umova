// A drill-down menu: shows the groups under `segs`, with a breadcrumb and (at the top level) a search box. Router-agnostic:
// the caller owns the position (`segs`) and decides what opening a page means (`onOpen(page)`).
import React, { useState } from 'react';
import { ChevronRight, FolderOpen, Search, Building2, ClipboardList, GraduationCap, ShieldCheck, Wallet, Users, Settings, BookOpen, CalendarCheck, DoorOpen, CalendarDays } from 'lucide-react';
import { findNode, visibleChildren, searchPages, countSoon } from '../navigation/menuKit.js';

const ICONS = { Building2, ClipboardList, GraduationCap, ShieldCheck, Wallet, Users, Settings, BookOpen, CalendarCheck, DoorOpen, CalendarDays };

export default function MenuTree({ tree, segs, onGo, onOpen, can, owner = true, rootLabel = 'Menu', searchable = true }) {
  const [q, setQ] = useState('');
  const node = findNode(tree, segs);
  if (!node) return <p className="p-4 text-sm text-[#6F7461]">That section does not exist. <button type="button" className="underline" onClick={() => onGo([])}>Back to {rootLabel}</button></p>;
  const hits = searchable && segs.length === 0 && q.trim().length >= 2 ? searchPages(tree, q, can, owner) : null;
  const kids = hits || visibleChildren(node, can, owner);
  const crumbs = [{ label: rootLabel, segs: [] }, ...segs.map((s, i) => ({ label: findNode(tree, segs.slice(0, i + 1))?.label || s, segs: segs.slice(0, i + 1) }))];
  const open = (k) => { if (k.soon) return; if (k.children) onGo([...segs, k.key]); else onOpen(k); };
  return (
    <div>
      {segs.length > 0 && (
        <nav aria-label="Where you are" className="flex flex-wrap items-center gap-1 text-xs text-[#6F7461] mb-3">
          {crumbs.map((c, i) => (<React.Fragment key={c.segs.join('/') || 'root'}>{i > 0 && <ChevronRight size={12} />}{i === crumbs.length - 1 ? <span className="font-semibold text-[#23382B]">{c.label}</span> : <button type="button" onClick={() => onGo(c.segs)} className="underline-offset-2 hover:underline">{c.label}</button>}</React.Fragment>))}
        </nav>)}
      {searchable && segs.length === 0 && (
        <label className="flex items-center gap-2 rounded-xl border border-[#E3DBB8] bg-white px-3 min-h-[44px] mb-3"><Search size={16} className="text-[#6F7461]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the menu (for example: report card, gate)" className="flex-1 bg-transparent outline-none text-sm" aria-label="Search the menu" /></label>)}
      {kids.length === 0 ? <p className="rounded-xl bg-white border border-[#E3DBB8] p-4 text-sm text-[#6F7461]">{hits ? 'No page matches that.' : 'Nothing here is available to your role.'}</p> : (
        <ul className="space-y-2">
          {kids.map((k) => {
            const Icon = ICONS[k.icon] || (k.children ? FolderOpen : ChevronRight); const soonCount = k.children ? countSoon(k) : 0;
            return (
              <li key={k.key + (k.trail || '')}>
                <button type="button" onClick={() => open(k)} disabled={!!k.soon} aria-disabled={!!k.soon}
                  className={`w-full text-left flex items-center gap-3 rounded-2xl border p-3 min-h-[60px] ${k.soon ? 'bg-[#F5F1DC] border-[#E3DBB8] text-[#8A8F7C]' : 'bg-white border-[#E3DBB8] active:bg-[#EFE8C8]'}`}>
                  {(k.icon || k.children) && <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${k.soon ? 'bg-[#ECE6C8] text-[#A5A88F]' : 'bg-[#E4F0E8] text-[#1F6B45]'}`}><Icon size={22} /></span>}
                  <span className="min-w-0 flex-1"><span className="block font-semibold text-[15px] text-inherit">{k.label}</span>
                    <span className="block text-xs text-[#6F7461]">{k.trail ? `${k.trail} · ` : ''}{k.desc}</span></span>
                  {k.soon ? <span className="rounded-full bg-[#ECE6C8] px-2 py-0.5 text-[10px] font-semibold text-[#8A8F7C]">SOON</span>
                    : <>{soonCount > 0 && <span className="text-[10px] text-[#8A8F7C]">{soonCount} soon</span>}<ChevronRight size={18} className="text-[#A5A88F]" /></>}
                </button>
              </li>);
          })}
        </ul>)}
    </div>
  );
}
