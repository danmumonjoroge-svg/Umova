// elimu/ui/cards/ModuleCards.jsx -- what you see when you tap a MAJOR MODULE (Academics, Students, Finance...).
// A module screen is a small desk, not a list:
//   ModuleHero     the module's own banner: colour, icon, purpose, size, a search box for the module and "Pick up where you left off" chips.
//   SubModuleCard  each sub-module (Attendance, Exams & results...) as its own card. EVERY card has its own colour personality (all taken from
//                  the theme variables, so they follow the theme switcher), a watermark icon, and its pages as tappable lines: the page you use
//                  most is one tap away. Cards differ in size and corner shape: many pages = wide, few = compact.
//   SubSubTile     a group inside a sub-module (Results & reports inside Exams & results): a small dashed tile with a count.
import React, { useState } from 'react';
import { ChevronRight, FolderOpen, Search, History } from 'lucide-react';
import { V, SHAPE, lift } from './tokens.js';
import { lookFor } from './MenuCards.jsx';

const Tap = ({ onClick, disabled, className = '', style, children, label }) => (
  <button type="button" onClick={onClick} disabled={disabled} aria-label={label}
    className={`text-left transition-transform duration-150 active:scale-[.985] ${className}`} style={style}>{children}</button>);

const W = (a) => `rgba(255,255,255,${a})`;
/** Six colour personalities for sub-module cards, all from theme variables. bg/fg/sub: card; edge: top edge and tile border; disc: icon disc; line*: page lines; dot: bullet. */
export const CARD_LOOKS = [
  { bg: V.tint, fg: V.deep, sub: V.muted, edge: V.primary, disc: V.primary, discFg: '#fff', line: '#fff', lineBd: V.border, lineFg: V.dark, dot: V.primary, mark: V.primary },
  { bg: V.accentTint, fg: V.dark, sub: V.accentDeep, edge: V.accent, disc: V.accent, discFg: V.dark, line: '#fff', lineBd: V.border, lineFg: V.dark, dot: V.accentDeep, mark: V.accentDeep },
  { bg: V.dark, fg: '#fff', sub: W(0.72), edge: V.accent, disc: W(0.14), discFg: '#fff', line: W(0.09), lineBd: W(0.18), lineFg: '#fff', dot: V.accent, mark: '#fff' },
  { bg: '#fff', fg: V.dark, sub: V.muted, edge: V.deep, disc: V.tint, discFg: V.primary, line: V.soft, lineBd: V.border, lineFg: V.dark, dot: V.primary, mark: V.primary },
  { bg: V.primary, fg: '#fff', sub: W(0.78), edge: V.accent, disc: W(0.16), discFg: '#fff', line: W(0.12), lineBd: W(0.22), lineFg: '#fff', dot: '#fff', mark: '#fff' },
  { bg: V.soft, fg: V.dark, sub: V.muted, edge: V.accentDeep, disc: '#fff', discFg: V.accentDeep, line: '#fff', lineBd: V.border, lineFg: V.dark, dot: V.accentDeep, mark: V.accentDeep },
];
/** Looks for the cards of one module: a stable starting point per module, then each card takes the next one, so neighbours never match (up to six cards). */
export function looksFor(moduleKey, count) {
  let h = 7; for (const ch of String(moduleKey || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Array.from({ length: count }, (_, i) => (h + i) % CARD_LOOKS.length);
}

/** Banner at the top of a module, with a search box and "pick up where you left off". */
export function ModuleHero({ label, desc, Icon = FolderOpen, pages = 0, subs = 0, look, shape, query, onQuery, recent = [], onOpenPage }) {
  const L = look;
  return (
    <div className="relative overflow-hidden p-5 mb-4" style={{ background: L.bg, color: L.fg, borderRadius: shape || SHAPE.hero, boxShadow: lift }}>
      <span aria-hidden className="absolute -right-5 -top-5 opacity-[.13]"><Icon size={140} strokeWidth={1.1} /></span>
      <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: L.disc }}><Icon size={24} /></span>
      <h2 className="relative mt-3 text-[22px] font-extrabold leading-tight">{label}</h2>
      {desc && <p className="relative mt-1 text-[13px] leading-snug max-w-[88%]" style={{ color: L.sub }}>{desc}</p>}
      <p className="relative mt-2 text-[11px] font-bold uppercase tracking-[.09em]" style={{ color: L.sub }}>{subs} section{subs === 1 ? '' : 's'} · {pages} page{pages === 1 ? '' : 's'}</p>
      {onQuery && <label className="relative mt-3 flex items-center gap-2 rounded-xl px-3 min-h-[44px]" style={{ background: W(0.92), color: V.dark }}>
        <Search size={16} style={{ color: V.muted }} /><input value={query || ''} onChange={(e) => onQuery(e.target.value)} placeholder={`Search ${label}`} aria-label={`Search ${label}`} className="flex-1 bg-transparent outline-none text-sm" /></label>}
      {recent.length > 0 && !query && <div className="relative mt-3"><p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-[.09em]" style={{ color: L.sub }}><History size={12} />Pick up where you left off</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">{recent.map((r) => <button key={r.key} type="button" onClick={() => onOpenPage(r)} className="rounded-full px-3 min-h-[36px] text-[12.5px] font-bold" style={{ background: L.disc, color: L.fg }}>{r.label}</button>)}</div></div>}
    </div>);
}

/** A group inside a sub-module: a small dashed tile with a count. */
export function SubSubTile({ label, pages, look, onClick }) {
  return (
    <Tap onClick={onClick} label={`${label}, ${pages} pages`} className="flex items-center gap-2 min-h-[44px] px-3 rounded-xl w-full" style={{ background: 'transparent', border: `1.5px dashed ${look.edge}`, color: look.lineFg }}>
      <FolderOpen size={16} style={{ color: look.dot }} /><span className="flex-1 min-w-0 truncate text-[13.5px] font-semibold">{label}</span>
      <span className="text-[11px] font-bold rounded-full px-1.5" style={{ background: look.line, color: look.lineFg }}>{pages}</span><ChevronRight size={15} style={{ opacity: .6 }} />
    </Tap>);
}

/** A page line inside a sub-module card (or a search result, with its trail). */
export function PageLine({ label, trail, soon, look, onClick }) {
  const L = look || CARD_LOOKS[3];
  return (
    <Tap onClick={soon ? undefined : onClick} disabled={!!soon} className="flex items-center gap-2 min-h-[44px] px-3 rounded-xl w-full" style={{ background: soon ? 'transparent' : L.line, border: `1px solid ${L.lineBd}`, color: L.lineFg, opacity: soon ? .55 : 1 }}>
      <i aria-hidden className="h-2 w-2 rounded-full shrink-0" style={{ background: L.dot }} />
      <span className="flex-1 min-w-0"><span className="block truncate text-[13.5px] font-semibold">{label}</span>{trail && <span className="block truncate text-[11px]" style={{ opacity: .65 }}>{trail}</span>}</span>
      {soon ? <span className="text-[10px] font-bold">SOON</span> : <ChevronRight size={15} style={{ opacity: .55 }} />}
    </Tap>);
}

const SHAPES = [SHAPE.ledger, SHAPE.tab, SHAPE.spine];
/** One sub-module. items = its visible children (pages and groups). wide = many items (full width, pages in two columns on a tablet). lookIndex picks its colour. */
export function SubModuleCard({ node, items = [], Icon = FolderOpen, pages = 0, wide, lookIndex = 0, index = 0, onOpenGroup, onOpenPage }) {
  const L = CARD_LOOKS[lookIndex % CARD_LOOKS.length]; const leaves = items.filter((i) => !i.children); const groups = items.filter((i) => i.children);
  return (
    <section aria-label={node.label} className={`relative overflow-hidden p-3.5 ${wide ? 'col-span-2' : ''}`}
      style={{ background: L.bg, color: L.fg, border: `1px solid ${L.bg === '#fff' ? V.border : 'transparent'}`, borderTop: `4px solid ${L.edge}`, borderRadius: SHAPES[index % SHAPES.length], boxShadow: lift }}>
      <span aria-hidden className="absolute -right-4 -bottom-4 opacity-[.08]" style={{ color: L.mark }}><Icon size={wide ? 120 : 96} strokeWidth={1.2} /></span>
      <Tap onClick={() => onOpenGroup(node)} label={`Open ${node.label}`} className="relative flex items-start gap-2.5 w-full">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: L.disc, color: L.discFg }}><Icon size={19} /></span>
        <span className="min-w-0 flex-1"><span className="block font-extrabold text-[16px] leading-tight">{node.label}</span>
          {node.desc && <span className="block text-xs mt-0.5 line-clamp-2" style={{ color: L.sub }}>{node.desc}</span>}</span>
        <span className="mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: L.disc, color: L.discFg }}>{pages}</span>
      </Tap>
      {leaves.length > 0 && <div className={`relative mt-2.5 grid gap-1.5 grid-cols-1 ${wide ? 'sm:grid-cols-2' : ''}`}>
        {leaves.map((l) => <PageLine key={l.key} label={l.label} soon={l.soon} look={L} onClick={() => onOpenPage(l)} />)}</div>}
      {groups.length > 0 && <div className={`relative ${leaves.length ? 'mt-1.5' : 'mt-2.5'} grid gap-1.5 grid-cols-1 ${wide ? 'sm:grid-cols-2' : ''}`}>
        {groups.map((g) => <SubSubTile key={g.key} label={g.label} pages={g.pagesCount} look={L} onClick={() => onOpenGroup(g, node)} />)}</div>}
    </section>);
}

/** The whole module screen. node = the module; subs = [{node, items, Icon, pages}] (items carry pagesCount for groups);
 *  allLeaves = every page in the module (for search and "left off"); recentKeys = page keys opened lately, newest first. */
export function ModuleHub({ node, Icon, pages, subs, onOpenGroup, onOpenPage, pageNodes = [], allLeaves = [], recentKeys = [] }) {
  const [q, setQ] = useState(''); const { look, shape } = lookFor(node.key, 0); const looks = looksFor(node.key, subs.length);
  const weight = (s) => s.items.length;
  const needle = q.trim().toLowerCase(); const hits = needle.length >= 2 ? allLeaves.filter((l) => `${l.label} ${l.desc || ''} ${l.trail || ''}`.toLowerCase().includes(needle)) : null;
  const recent = recentKeys.map((k) => allLeaves.find((l) => l.key === k)).filter(Boolean);
  return (
    <div>
      <ModuleHero label={node.label} desc={node.desc} Icon={Icon} pages={pages} subs={subs.length} look={look} shape={shape} query={q} onQuery={allLeaves.length > 4 ? setQ : undefined} recent={recent} onOpenPage={onOpenPage} />
      {hits ? (hits.length === 0 ? <p className="rounded-xl p-4 text-sm" style={{ background: '#fff', border: `1px solid ${V.border}`, color: V.muted }}>No page in {node.label} matches that.</p>
        : <div className="space-y-1.5">{hits.map((l) => <PageLine key={l.key} label={l.label} trail={l.trail} look={CARD_LOOKS[3]} onClick={() => onOpenPage(l)} />)}</div>) : (<>
        <div className="grid grid-cols-2 gap-3 [grid-auto-flow:row_dense]">
          {subs.map((s, i) => <SubModuleCard key={s.node.key} node={s.node} items={s.items} Icon={s.Icon} pages={s.pages} lookIndex={looks[i]} index={i} wide={weight(s) >= 4 || (i === 0 && weight(s) >= 3)} onOpenGroup={onOpenGroup} onOpenPage={onOpenPage} />)}
        </div>
        {pageNodes.length > 0 && <div className="mt-3 space-y-1.5">{pageNodes.map((p) => <PageLine key={p.key} label={p.label} soon={p.soon} look={CARD_LOOKS[3]} onClick={() => onOpenPage(p)} />)}</div>}</>)}
    </div>);
}
