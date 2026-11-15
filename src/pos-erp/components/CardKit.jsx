// src/pos-erp/components/CardKit.jsx
//
// Shared "small card" building blocks for every list page (My Stock, My Items,
// Purchase Orders, Suppliers, People I Owe, My Equipment ...).
//
// Why this exists: list pages used to be wide tables inside very long pages.
// Now each record is a SMALL CARD in a compact grid (2 across on a phone, up to
// 6 across on a big screen), and the page FITS THE SCREEN: the title, search
// and summary stay put, only the card area scrolls.
//
// Theme: gold + green (see theme/brand.js). Flat colours, no gradients/glow.
// Every class below is a complete literal string so Tailwind's JIT keeps it.

import React from 'react';
import { Loader2, Search, X, Inbox } from 'lucide-react';

// ── tones ───────────────────────────────────────────────────────────────
const PILL = {
  good:    'bg-[#E3F1E7] text-[#1B5138]',
  warn:    'bg-[#FBF0CC] text-[#7A5A0E]',
  bad:     'bg-[#FBE4E0] text-[#A3352A]',
  info:    'bg-[#EFE9C9] text-[#5C4A12]',
  neutral: 'bg-[#EEEBDD] text-[#6B6A55]',
};
const VALUE_TONE = {
  good: 'text-[#1B6B45]',
  bad: 'text-[#B23A2E]',
  gold: 'text-[#8A6A12]',
  muted: 'text-[#9A987F]',
};

export function Pill({ tone = 'neutral', children }) {
  return (
    <span className={`inline-block shrink-0 text-[9.5px] font-bold uppercase tracking-wide leading-none px-1.5 py-1 rounded-full whitespace-nowrap ${PILL[tone] || PILL.neutral}`}>
      {children}
    </span>
  );
}

// ── page shell: title + toolbar stay put, only the cards scroll ──────────
export function FitPage({ title, subtitle, icon: Icon, action, toolbar, summary, children }) {
  return (
    <div className="h-full flex flex-col min-h-0 px-3 pt-3 sm:px-5 sm:pt-4 max-w-7xl mx-auto w-full">
      <div className="shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2.5">
            <span className="hidden sm:block w-1.5 h-7 rounded-full bg-[#C9A227]" />
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-[#23382B] flex items-center gap-2 truncate">
                {Icon && <Icon size={19} className="text-[#2E7D52] shrink-0" />}
                <span className="truncate">{title}</span>
              </h1>
              {subtitle && <p className="text-[11.5px] sm:text-xs text-[#6F7461] leading-snug line-clamp-1">{subtitle}</p>}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
        {summary && <div className="mt-2.5">{summary}</div>}
        {toolbar && <div className="mt-2.5">{toolbar}</div>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto mt-2.5 pb-3 -mx-1 px-1">
        {children}
      </div>
    </div>
  );
}

// ── controls ────────────────────────────────────────────────────────────
export function AddButton({ onClick, open, label, openLabel = 'Cancel', icon: Icon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl bg-[#1F6B45] hover:bg-[#17553A] text-white text-[13px] font-semibold border-b-2 border-[#C9A227] transition-colors"
    >
      {open ? <X size={15} /> : Icon ? <Icon size={15} /> : null}
      {open ? openLabel : label}
    </button>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Search…' }) {
  return (
    <div className="relative">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A59B6A]" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-9 pr-3 min-h-[40px] rounded-xl border border-[#E3DBB8] bg-white text-sm text-[#23382B] placeholder:text-[#A9A58A] focus:outline-none focus:border-[#C9A227] focus:ring-2 focus:ring-[#C9A227]/25"
      />
    </div>
  );
}

/** Row of small filter chips. options: [{ key, label, count? }] */
export function FilterChips({ options, value, onChange }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pb-0.5">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={`shrink-0 text-[12px] font-semibold px-3 min-h-[30px] rounded-full border transition-colors ${
              on ? 'bg-[#1F6B45] border-[#1F6B45] text-white' : 'bg-white border-[#E3DBB8] text-[#5E6350] hover:border-[#C9A227]'
            }`}
          >
            {o.label}{o.count != null && <span className={`ml-1 ${on ? 'text-[#F3DE8A]' : 'text-[#A08A3C]'}`}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Slim summary tiles, side by side. items: [{ label, value, tone? }] */
export function MiniStats({ items }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((it) => (
        <div key={it.label} className="bg-white border border-[#E3DBB8] border-t-2 border-t-[#C9A227] rounded-xl px-2.5 py-1.5 min-w-0">
          <div className="text-[9.5px] font-bold uppercase tracking-wide text-[#8B8766] truncate">{it.label}</div>
          <div className={`text-[14px] sm:text-base font-bold leading-tight truncate ${VALUE_TONE[it.tone] || 'text-[#23382B]'}`}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}

// ── the cards ───────────────────────────────────────────────────────────
/** 2 across on a phone, 3 on a tablet, up to 6 on a wide screen. */
export function CardGrid({ children }) {
  return <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">{children}</div>;
}

export function IconBtn({ title, onClick, disabled, tone, children }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      className={`w-8 h-8 inline-flex items-center justify-center rounded-lg border border-[#EDE6C6] bg-[#FCFAF0] disabled:opacity-40 transition-colors ${
        tone === 'danger' ? 'text-[#A3352A] hover:bg-[#FBE4E0]' : 'text-[#2E7D52] hover:bg-[#EAF3E4] hover:border-[#C9A227]'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * One small card.
 *   thumb      node shown top-left (icon tile or photo)
 *   title      main line (one line, truncated)
 *   subtitle   small grey line
 *   pill       { tone, label }  top-right status
 *   big        { value, tone, label }  the one number that matters
 *   metrics    [{ label, value, tone }]  up to 3 tiny label/value pairs
 *   actions    node (IconBtns or small text buttons) at the bottom
 *   alert      gold left edge: needs attention
 *   dim        faded (inactive)
 */
export function DataCard({ thumb, title, subtitle, pill, big, metrics, actions, onClick, alert, dim, children }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`text-left flex flex-col min-w-0 rounded-xl bg-white border p-2.5 transition ${
        onClick ? 'active:scale-[0.985] hover:border-[#C9A227] cursor-pointer' : ''
      } ${alert ? 'border-[#E3DBB8] border-l-[3px] border-l-[#C9A227] bg-[#FFFDF4]' : 'border-[#E3DBB8]'} ${dim ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start gap-2 min-w-0">
        {thumb && <div className="shrink-0">{thumb}</div>}
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-bold text-[#23382B] leading-tight truncate" title={typeof title === 'string' ? title : undefined}>{title}</div>
          {subtitle && <div className="text-[10.5px] text-[#8B8766] leading-tight truncate mt-0.5">{subtitle}</div>}
        </div>
        {pill && <Pill tone={pill.tone}>{pill.label}</Pill>}
      </div>

      {big && (
        <div className="mt-1.5 flex items-baseline gap-1 min-w-0">
          <span className={`text-[17px] font-extrabold leading-none truncate ${VALUE_TONE[big.tone] || 'text-[#23382B]'}`}>{big.value}</span>
          {big.label && <span className="text-[10px] font-medium text-[#8B8766] truncate">{big.label}</span>}
        </div>
      )}

      {metrics && metrics.length > 0 && (
        <div className="mt-1.5 grid gap-x-2 gap-y-0.5" style={{ gridTemplateColumns: `repeat(${Math.min(metrics.length, 2)}, minmax(0, 1fr))` }}>
          {metrics.map((m) => (
            <div key={m.label} className="min-w-0">
              <div className="text-[9px] font-bold uppercase tracking-wide text-[#A29E80] truncate">{m.label}</div>
              <div className={`text-[11.5px] font-semibold truncate ${VALUE_TONE[m.tone] || 'text-[#3D4A3F]'}`}>{m.value}</div>
            </div>
          ))}
        </div>
      )}

      {children}

      {actions && <div className="mt-2 pt-1.5 border-t border-[#F0EACF] flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>{actions}</div>}
    </Tag>
  );
}

/** Small round icon tile used as a card thumbnail. */
export function IconTile({ icon: Icon, src, tone = 'green' }) {
  const bg = tone === 'gold' ? 'bg-[#F6EDC4] text-[#8A6A12]' : 'bg-[#E3F1E7] text-[#1F6B45]';
  return (
    <div className={`w-8 h-8 rounded-lg flex items-center justify-center overflow-hidden ${bg}`}>
      {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : <Icon size={16} />}
    </div>
  );
}

/** Small text button for a card's action row. */
export function TextBtn({ onClick, disabled, tone, children, title }) {
  const color = tone === 'danger' ? 'text-[#A3352A]' : tone === 'gold' ? 'text-[#8A6A12]' : 'text-[#1F6B45]';
  return (
    <button
      type="button" title={title} disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      className={`text-[11px] font-bold ${color} hover:underline disabled:opacity-40 disabled:no-underline px-1 min-h-[28px]`}
    >
      {children}
    </button>
  );
}

// ── states ──────────────────────────────────────────────────────────────
export function LoadingBlock({ text = 'Loading…' }) {
  return (
    <div className="py-3" role="status" aria-live="polite">
      <div className="grid gap-2">
        {[0, 1, 2, 3].map((i) => <div key={i} className="pos-skeleton h-[68px]" style={{ opacity: 1 - i * 0.2 }} />)}
      </div>
      <div className="mt-3 text-center text-[12px] text-[#8B8766]"><Loader2 size={13} className="animate-spin inline mr-1.5" />{text}</div>
    </div>
  );
}
export function EmptyBlock({ children }) {
  return (
    <div className="py-10 px-4 text-center text-sm text-[#8B8766] bg-white border border-dashed border-[#E3DBB8] rounded-2xl">
      <div className="mx-auto mb-2 w-11 h-11 rounded-2xl bg-[#F6F1DA] text-[#B8921C] flex items-center justify-center" aria-hidden="true"><Inbox size={20} /></div>
      {children}
    </div>
  );
}
export function Notice({ tone = 'bad', children }) {
  const cls = tone === 'bad' ? 'bg-[#FBE4E0] border-[#F0C2BB] text-[#8F2E24]'
    : tone === 'gold' ? 'bg-[#FBF3D5] border-[#EBD98A] text-[#6B4F0B]'
    : 'bg-[#EEF5E8] border-[#CFE0C3] text-[#1B5138]';
  return <div className={`mb-2 border rounded-xl px-3 py-2 text-[12.5px] ${cls}`}>{children}</div>;
}

/** Card-style form container (the add/edit forms on each page). */
export const formCard = 'bg-white border border-[#E3DBB8] border-t-[3px] border-t-[#C9A227] rounded-xl p-3 mb-3';
export const inputCls = 'w-full border border-[#E3DBB8] rounded-lg px-3 min-h-[40px] text-sm bg-white text-[#23382B] focus:outline-none focus:border-[#C9A227] focus:ring-2 focus:ring-[#C9A227]/25';
export const saveBtnCls = 'bg-[#1F6B45] hover:bg-[#17553A] text-white font-semibold rounded-lg min-h-[42px] border-b-2 border-[#C9A227] disabled:opacity-60';
