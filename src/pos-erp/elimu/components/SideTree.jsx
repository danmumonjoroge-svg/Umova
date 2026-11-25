// elimu/components/SideTree.jsx -- the laptop sidebar, drawn from the SAME menu tree as the phone menu (navigation/schoolTree.js), so every
// page on the phone is on the laptop. Made for daily use: a find-a-page box ("/" to jump to it), pages you pin, the pages you opened last,
// one module open at a time, and a narrow icon-only mode for more room. Visibility only: the database decides access.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Home, PanelLeftClose, PanelLeftOpen, Pin, Search, X } from 'lucide-react';
import { visibleChildren, leavesOf, soleLeaf, searchPages } from '../navigation/menuKit.js';
import { moduleOfPath } from '../navigation/bottomBar.js';
import { recordOpen, recentAmong } from '../navigation/recents.js';
import { readPins, togglePin } from '../navigation/pins.js';

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

/** Which page is the current one: the longest matching route; a link with a query only when the address has that query. */
export function activePages(sections, rel, search) {
  const all = sections.flatMap((s) => s.pages).map((x) => ({ ...x, ...split(x.to) }));
  const hit = all.filter((x) => rel === x.p || rel.startsWith(`${x.p}/`));
  if (!hit.length) return new Set();
  const longest = Math.max(...hit.map((x) => x.p.length)); const top = hit.filter((x) => x.p.length === longest);
  const withQ = top.filter((x) => x.q && search.includes(x.q)); const pick = withQ.length ? withQ : top.filter((x) => !x.q);
  return new Set((pick.length ? pick : top).map((x) => x.to));
}

/** Every page this person may open, once per key, with the module it lives in. Feeds pins, recents and search. */
export function pageIndex(tree, can, owner) {
  const idx = new Map();
  visibleChildren(tree, can, owner).forEach((m) => leavesOf(m, can, owner).forEach((l) => { if (!idx.has(l.key)) idx.set(l.key, { ...l, mod: m.key, modLabel: m.label }); }));
  return idx;
}

/** Badge colours for sub-branch cards: only theme variables, so they follow whichever colour theme or mix is chosen. Neighbours never match. */
const BADGES = ['var(--e-primary,#1F6B45)', 'var(--e-accent-deep,#8A6D0B)', 'var(--e-primary-deep,#1B5138)', 'var(--e-dark,#12261F)'];
const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--e-primary,#1F6B45)]';
const base = 'relative flex items-center gap-3 min-h-[44px] rounded-xl text-sm font-medium transition-colors';
const onCls = 'bg-[var(--e-tint,#E4F0E8)] text-[var(--e-primary,#1F6B45)] font-semibold'; const offCls = 'text-[var(--e-text,#23382B)] hover:bg-[var(--e-soft,#F4EFD3)]';

export default function SideTree({ tree, basePath, can, isOwner, loc, icons, showHome = true, collapsed = false, onToggle = () => {} }) {
  const nav = useNavigate();
  const rel = loc.pathname.replace(basePath, '').replace(/^\/+|\/+$/g, ''); const search = loc.search || ''; const here = moduleOfPath(tree, rel);
  const [openKey, setOpenKey] = useState(here || null);
  useEffect(() => { if (here) setOpenKey(here); }, [here]);
  const [secOpen, setSecOpen] = useState({});   // sub-branches the person opened or closed by hand: { 'module/section': true|false }
  const [pins, setPins] = useState(() => readPins());
  const [q, setQ] = useState(''); const input = useRef(null); const wantFocus = useRef(false);
  const index = useMemo(() => pageIndex(tree, can, isOwner), [tree, can, isOwner]);
  const unique = useMemo(() => { const seen = new Set(); return [...index.values()].filter((x) => (seen.has(x.to) ? false : seen.add(x.to))); }, [index]);
  const globalAct = useMemo(() => activePages([{ pages: unique }], rel, search), [unique, rel, search]);
  const pinned = pins.map((k) => index.get(k)).filter(Boolean);
  const recent = useMemo(() => recentAmong([...index.keys()], 6).map((k) => index.get(k)).filter((x) => x && !pins.includes(x.key)).slice(0, 3), [index, pins, rel]);   // eslint-disable-line react-hooks/exhaustive-deps
  const hits = useMemo(() => searchPages(tree, q, can, isOwner).filter((x) => !x.soon).slice(0, 8), [tree, q, can, isOwner]);

  // "/" jumps to the search box (unless you are already typing somewhere)
  useEffect(() => {
    const k = (e) => { if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return; const t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return; e.preventDefault(); if (collapsed) { wantFocus.current = true; onToggle(); } else input.current?.focus(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [collapsed, onToggle]);
  useEffect(() => { if (!collapsed && wantFocus.current) { wantFocus.current = false; input.current?.focus(); } }, [collapsed]);

  const go = (p) => { recordOpen(p.key); setQ(''); };
  const pin = (e, key) => { e.preventDefault(); e.stopPropagation(); setPins(togglePin(key)); };
  const mark = (on) => on && <span aria-hidden="true" className="absolute -left-2 top-2.5 bottom-2.5 w-1 rounded-r-full" style={{ background: 'var(--e-primary,#1F6B45)' }} />;
  const icon = (I, on) => <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"><I size={17} strokeWidth={on ? 2.4 : 2} /></span>;

  // one page row: the link, plus a pin button that shows on hover or focus (and stays when pinned)
  const row = (p, on, keyPrefix = '', showWhere = false) => { const isPin = pins.includes(p.key); return (
    <div key={keyPrefix + p.key} className="group relative flex items-center">
      <NavLink to={`${basePath}/${p.to}`} onClick={() => go(p)} aria-current={on ? 'page' : undefined} className={`flex-1 min-w-0 flex flex-col justify-center px-2 pr-8 min-h-[38px] rounded-lg text-[13px] ${focusRing} ${on ? onCls : offCls}`}>
        <span className={showWhere ? 'truncate' : 'leading-snug py-1'}>{p.label}</span>{showWhere && <span className="truncate text-[11px] font-normal text-[var(--e-muted,#6F7461)]">{p.modLabel}</span>}
      </NavLink>
      <button type="button" onClick={(e) => pin(e, p.key)} aria-pressed={isPin} aria-label={isPin ? `Unpin ${p.label}` : `Pin ${p.label} to the top`} title={isPin ? 'Unpin' : 'Pin to the top'}
        className={`absolute right-1 h-7 w-7 flex items-center justify-center rounded-md ${focusRing} ${isPin ? 'text-[var(--e-primary,#1F6B45)]' : 'text-[var(--e-muted,#6F7461)] opacity-0 group-hover:opacity-100 focus:opacity-100'}`}><Pin size={14} fill={isPin ? 'currentColor' : 'none'} /></button>
    </div>); };

  const mods = visibleChildren(tree, can, isOwner);

  // ------------------------------------------------------------- narrow rail: icons only
  if (collapsed) return (
    <>
      <button type="button" onClick={() => { wantFocus.current = true; onToggle(); }} aria-label="Find a page" title="Find a page (press /)" className={`${base} justify-center ${offCls} ${focusRing}`}>{icon(Search)}</button>
      {showHome && <NavLink to={basePath} end aria-label="Dashboard" title="Dashboard" className={({ isActive }) => `${base} justify-center ${focusRing} ${isActive ? onCls : offCls}`}>{icon(Home)}</NavLink>}
      {mods.map((m) => { const I = icons[m.icon] || Home; const sole = soleLeaf(m, can, isOwner); const on = here === m.key;
        return sole
          ? <NavLink key={m.key} to={`${basePath}/${sole.to}`} aria-label={m.label} title={m.label} className={`${base} justify-center ${focusRing} ${on ? onCls : offCls}`}>{icon(I, on)}</NavLink>
          : <button key={m.key} type="button" aria-label={m.label} title={m.label} onClick={() => { setOpenKey(m.key); onToggle(); }} className={`${base} justify-center ${focusRing} ${on ? onCls : offCls}`}>{icon(I, on)}</button>; })}
      <div className="mt-auto pt-2"><button type="button" onClick={onToggle} aria-label="Widen the sidebar" title="Widen the sidebar" className={`${base} w-full justify-center ${offCls} ${focusRing}`}>{icon(PanelLeftOpen)}</button></div>
    </>);

  // ------------------------------------------------------------- full sidebar
  const searching = q.trim().length >= 2;
  return (
    <>
      <div className="sticky top-0 z-10 -mt-1 pb-2 bg-white">
        <div className="relative">
          <Search size={15} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--e-muted,#6F7461)]" />
          <input ref={input} type="text" role="searchbox" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a page" placeholder="Find a page"
            onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); e.currentTarget.blur(); } else if (e.key === 'Enter' && hits[0]) { recordOpen(hits[0].key); nav(`${basePath}/${hits[0].to}`); setQ(''); e.currentTarget.blur(); } }}
            className={`w-full min-h-[40px] pl-9 pr-9 rounded-xl border border-[var(--e-border,#E3DBB8)] bg-[var(--e-bg,#FBF8EA)] text-[13px] placeholder:text-[var(--e-muted,#6F7461)] ${focusRing}`} />
          {q ? <button type="button" onClick={() => { setQ(''); input.current?.focus(); }} aria-label="Clear search" className={`absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded-md text-[var(--e-muted,#6F7461)] ${focusRing}`}><X size={14} /></button>
            : <kbd aria-hidden="true" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] px-1.5 rounded border border-[var(--e-border,#E3DBB8)] text-[var(--e-muted,#6F7461)] bg-white">/</kbd>}
        </div>
      </div>

      {searching ? (
        <div role="region" aria-label="Search results" aria-live="polite">
          {hits.length === 0 ? <p className="px-2 py-3 text-[13px] text-[var(--e-muted,#6F7461)]">Nothing matches "{q.trim()}". Try a shorter word, like "fees" or "exam".</p>
            : hits.map((h) => row({ ...h, modLabel: h.trail }, globalAct.has(h.to), 's-', true))}
        </div>
      ) : (<>
        {pinned.length > 0 && <section aria-label="Pinned pages" className="mb-2">
          <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--e-muted,#6F7461)]">Pinned</div>
          {pinned.map((p) => row(p, globalAct.has(p.to), 'p-', true))}</section>}
        {showHome && <NavLink to={basePath} end className={({ isActive }) => `${base} pl-3 pr-3 mb-0.5 ${focusRing} ${isActive ? onCls : offCls}`}>{({ isActive }) => (<>{mark(isActive)}{icon(Home, isActive)}Dashboard</>)}</NavLink>}
        {mods.map((m) => {
          const I = icons[m.icon] || Home; const sole = soleLeaf(m, can, isOwner); const isHere = here === m.key;
          if (sole) { const on = isHere || rel.startsWith('school-finance'); return (
            <NavLink key={m.key} to={`${basePath}/${sole.to}`} onClick={() => go(sole)} aria-current={on ? 'page' : undefined} className={`${base} pl-3 pr-3 mb-0.5 ${focusRing} ${on ? onCls : offCls}`}>{mark(on)}{icon(I, on)}{m.label}</NavLink>); }
          const secs = moduleSections(m, can, isOwner); if (!secs.length) return null; const isOpen = openKey === m.key; const act = isOpen ? activePages(secs, rel, search) : new Set(); const n = secs.reduce((t, s) => t + s.pages.length, 0);
          return (
            <div key={m.key} className="mb-0.5">
              <button type="button" aria-expanded={isOpen} onClick={() => setOpenKey(isOpen ? null : m.key)} className={`${base} w-full text-left pl-3 pr-3 ${focusRing} ${isHere ? 'text-[var(--e-primary,#1F6B45)] font-semibold hover:bg-[var(--e-soft,#F4EFD3)]' : offCls}`}>
                {mark(isHere && !isOpen)}{icon(I, isHere)}<span className="flex-1">{m.label}</span>
                {!isOpen && <span aria-hidden="true" className="text-[11px] font-medium text-[var(--e-muted,#6F7461)] tabular-nums">{n}</span>}
                <ChevronDown size={15} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" /></button>
              {isOpen && <div className="ml-1 mt-1 mb-1.5 min-w-0">
                {secs.map((s, si) => {
                  if (!s.label) return <div key={s.key} className="mb-1">{s.pages.map((p) => row(p, act.has(p.to)))}</div>;
                  const id = `${m.key}/${s.key}`; const holdsHere = s.pages.some((p) => act.has(p.to));
                  const open = secOpen[id] !== undefined ? secOpen[id] : (holdsHere || secs.filter((x) => x.label).length <= 1);
                  const badge = BADGES[si % BADGES.length];
                  return (<div key={s.key} className="mb-1.5 rounded-2xl overflow-hidden" style={{ background: '#fff', border: `1px solid ${open || holdsHere ? badge : 'var(--e-border,#E3DBB8)'}`, boxShadow: open ? '0 2px 8px rgba(0,0,0,.08)' : 'none' }}>
                    <button type="button" aria-expanded={open} onClick={() => setSecOpen((o) => ({ ...o, [id]: !open }))}
                      className={`w-full flex items-center gap-2.5 min-h-[44px] px-2.5 text-left text-[13px] font-bold hover:bg-[var(--e-soft,#F4EFD3)] ${focusRing}`} style={{ color: 'var(--e-dark,#12261F)' }}>
                      <span aria-hidden="true" className="h-6 w-6 shrink-0 rounded-lg flex items-center justify-center text-[11px] font-extrabold" style={{ background: badge, color: '#fff' }}>{s.label.charAt(0).toUpperCase()}</span>
                      <span className="flex-1 min-w-0 leading-snug break-words">{s.label}</span>
                      <span aria-hidden="true" className="shrink-0 text-[11px] font-semibold rounded-full px-2" style={{ background: 'var(--e-tint,#E4F0E8)', color: 'var(--e-muted,#6F7461)' }}>{s.pages.length}</span>
                      <ChevronRight size={14} aria-hidden="true" className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} style={{ color: 'var(--e-muted,#6F7461)' }} /></button>
                    {open && <div className="pl-2 pr-1.5 pb-2 ml-[18px] mr-1 border-l-2" style={{ borderColor: badge }}>{s.pages.map((p) => row(p, act.has(p.to)))}</div>}
                  </div>);
                })}
              </div>}
            </div>);
        })}
        {recent.length > 0 && <section aria-label="Opened recently" className="mt-3 pt-2 border-t border-[var(--e-border,#E3DBB8)]">
          <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--e-muted,#6F7461)]">Recent</div>
          {recent.map((p) => row(p, globalAct.has(p.to), 'r-', true))}</section>}

        <div className="mt-auto pt-3"><button type="button" onClick={onToggle} className={`${base} w-full px-3 text-[13px] text-[var(--e-muted,#6F7461)] hover:bg-[var(--e-soft,#F4EFD3)] ${focusRing}`}>{icon(PanelLeftClose)}Make narrower</button></div>
      </>)}
    </>);
}
