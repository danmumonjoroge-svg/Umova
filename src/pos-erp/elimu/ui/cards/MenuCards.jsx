// elimu/ui/cards/MenuCards.jsx -- the cards that make up the menus (staff menu, Finance hub, parent home).
// Three shapes, so you can tell what a thing is before you read it:
//   FolderCard  a section (Academics, Finance): big, with a tab, a page count and a peek of what is inside. Sizes alternate so a screen never looks stamped out.
//   StackCard   a group inside a section: a few sheets stacked, so it looks like it holds things.
//   PageRow     a page you can open: a slim line with a coloured edge, nothing else.
// Colours come from the theme (ui/cards/tokens.js), each section keeps its own colour so it is easy to find again.
import React from 'react';
import { ChevronRight, FolderOpen } from 'lucide-react';
import { V, SHAPE, lift } from './tokens.js';

// A fixed colour "personality" per section. [background, ink, soft ink, icon-disc background]
const LOOKS = [
  { bg: V.primary, fg: '#fff', sub: 'rgba(255,255,255,.78)', disc: 'rgba(255,255,255,.16)' },
  { bg: V.accentTint, fg: V.dark, sub: V.accentDeep, disc: 'rgba(255,255,255,.65)' },
  { bg: V.dark, fg: '#fff', sub: 'rgba(255,255,255,.7)', disc: 'rgba(255,255,255,.12)' },
  { bg: V.tint, fg: V.deep, sub: V.muted, disc: 'rgba(255,255,255,.7)' },
  { bg: V.soft, fg: V.dark, sub: V.muted, disc: '#fff' },
  { bg: V.accent, fg: V.dark, sub: 'rgba(18,38,31,.72)', disc: 'rgba(255,255,255,.4)' },
];
const SHAPES = [SHAPE.tab, SHAPE.hero, SHAPE.gauge, SHAPE.ledger, SHAPE.ticket, SHAPE.spine];
/** Stable look for a section key, so Finance is always the same colour. */
export function lookFor(key, index = 0) { let h = index; for (const ch of String(key || '')) h = (h * 17 + ch.charCodeAt(0)) >>> 0; return { look: LOOKS[h % LOOKS.length], shape: SHAPES[(h >> 3) % SHAPES.length] }; }

const Tap = ({ onClick, disabled, className = '', style, children, label }) => (
  <button type="button" onClick={onClick} disabled={disabled} aria-disabled={disabled} aria-label={label}
    className={`text-left transition-transform duration-150 active:scale-[.985] hover:-translate-y-0.5 ${className}`} style={style}>{children}</button>);

/** Big section card. size 'lg' spans two columns on a phone. */
export function FolderCard({ label, desc, Icon = FolderOpen, pages = 0, peek = [], size = 'md', look, shape, onClick }) {
  const L = look || LOOKS[0]; const big = size === 'lg';
  return (
    <Tap onClick={onClick} label={`${label}, ${pages} pages`} className={`relative overflow-hidden ${big ? 'col-span-2 p-5 min-h-[150px]' : 'p-4 min-h-[148px]'}`}
      style={{ background: L.bg, color: L.fg, borderRadius: shape || SHAPE.tab, boxShadow: lift }}>
      <span aria-hidden className="absolute -right-6 -bottom-6 opacity-[.12]"><Icon size={big ? 128 : 104} strokeWidth={1.2} /></span>
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: L.disc }}><Icon size={22} /></span>
      <span className={`block mt-3 font-extrabold leading-tight ${big ? 'text-[21px]' : 'text-[17px]'}`}>{label}</span>
      {desc && <span className={`block mt-1 text-[12.5px] leading-snug ${big ? 'max-w-[85%]' : 'line-clamp-2'}`} style={{ color: L.sub }}>{desc}</span>}
      <span className="relative mt-3 flex flex-wrap items-center gap-1.5">
        {peek.slice(0, big ? 4 : 2).map((p) => <span key={p} className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: L.disc, color: L.fg }}>{p}</span>)}
        <span className="text-[11px] font-semibold" style={{ color: L.sub }}>{pages} page{pages === 1 ? '' : 's'}</span>
      </span>
    </Tap>);
}

/** A group inside a section. Two paper sheets peek out from behind it. */
export function StackCard({ label, desc, Icon = FolderOpen, pages = 0, onClick }) {
  return (
    <div className="relative pb-2 pr-2">
      <span aria-hidden className="absolute inset-0 translate-x-2 translate-y-2 rounded-[18px]" style={{ background: V.soft, border: `1px solid ${V.border}` }} />
      <span aria-hidden className="absolute inset-0 translate-x-1 translate-y-1 rounded-[18px]" style={{ background: '#fff', border: `1px solid ${V.border}` }} />
      <Tap onClick={onClick} label={`${label}, ${pages} pages`} className="relative block w-full p-3.5 min-h-[92px]" style={{ background: '#fff', border: `1px solid ${V.border}`, borderRadius: 18 }}>
        <span className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: V.tint, color: V.primary }}><Icon size={20} /></span>
          <span className="min-w-0 flex-1"><span className="block font-bold text-[15px] leading-tight" style={{ color: V.dark }}>{label}</span>
            {desc && <span className="block mt-0.5 text-xs line-clamp-2" style={{ color: V.muted }}>{desc}</span>}</span>
        </span>
        <span className="mt-2 flex items-center justify-between text-[11px] font-semibold" style={{ color: V.primary }}><span>{pages} page{pages === 1 ? '' : 's'}</span><ChevronRight size={15} /></span>
      </Tap>
    </div>);
}

/** A page you can open: thin, with a coloured edge. Planned pages are shown dimmed. */
export function PageRow({ label, desc, trail, Icon, soon, accent, onClick }) {
  return (
    <Tap onClick={soon ? undefined : onClick} disabled={!!soon} className="relative flex w-full items-center gap-3 pl-4 pr-3 py-2.5 min-h-[54px] overflow-hidden"
      style={{ background: soon ? V.soft : '#fff', border: `1px solid ${V.border}`, borderRadius: '6px 16px 16px 6px', color: soon ? V.mutedSoft : V.text }}>
      <span aria-hidden className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: soon ? V.border : (accent || V.primary) }} />
      {Icon && <Icon size={18} style={{ color: soon ? V.mutedSoft : V.primary }} />}
      <span className="min-w-0 flex-1"><span className="block font-semibold text-[14.5px] leading-tight" style={{ color: soon ? V.mutedSoft : V.dark }}>{label}</span>
        {(trail || desc) && <span className="block text-xs truncate" style={{ color: V.muted }}>{trail ? `${trail} · ` : ''}{desc}</span>}</span>
      {soon ? <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: V.border2, color: V.muted }}>SOON</span> : <ChevronRight size={16} style={{ color: V.mutedSoft }} />}
    </Tap>);
}

/** Lays a list of nodes out: sections as folder cards (size rhythm: wide, two small, two small, wide...), groups as stacks, pages as rows.
 *  describe(node) -> { Icon, pages, peek:[labels] }.  open(node). */
export function MenuCards({ kids, describe, open, depth = 0, accent }) {
  const groups = kids.filter((k) => k.children); const pages = kids.filter((k) => !k.children);
  return (
    <div className="space-y-4">
      {groups.length > 0 && (depth === 0 ? (
        <div className="grid grid-cols-2 gap-3">{groups.map((g, i) => { const d = describe(g); const { look, shape } = lookFor(g.key, i);
          const wide = i === 0 || (groups.length > 3 && i % 5 === 3) || (groups.length % 2 === 1 && i === groups.length - 1);
          return <FolderCard key={g.key} label={g.label} desc={g.desc} Icon={d.Icon} pages={d.pages} peek={d.peek} size={wide ? 'lg' : 'md'} look={look} shape={shape} onClick={() => open(g)} />; })}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{groups.map((g) => { const d = describe(g); return <StackCard key={g.key} label={g.label} desc={g.desc} Icon={d.Icon} pages={d.pages} onClick={() => open(g)} />; })}</div>
      ))}
      {pages.length > 0 && <div className="space-y-1.5">{pages.map((p) => <PageRow key={p.key + (p.trail || '')} label={p.label} desc={p.desc} trail={p.trail} soon={p.soon} accent={accent} Icon={describe(p).Icon} onClick={() => open(p)} />)}</div>}
    </div>);
}
