// src/pos-erp/components/workspace/WorkspaceKit.jsx
//
// Building blocks for every "My Business" workspace page.
//
// v2 redesign -- smaller, denser, and each workspace has its own identity:
//   * Every workspace gets an ACCENT colour (Retail = emerald, My Money =
//     gold, Customers = teal, Messages = indigo, Rentals = terracotta,
//     Salon = rose, Rooms = navy, Production = bronze). It is picked from
//     the URL, so the nine existing workspace pages need no changes.
//   * ActionCard is now a compact TILE: 2 across on a phone, 3-4 on bigger
//     screens. The "feature" card is a slim full-width hero row.
//   * MiniCard / MiniGrid = the sub-cards (secondary actions, one line each).
//   * StatStrip = a row of small number tiles (e.g. made / spent / profit).
//
// The props of WorkspacePage, SectionTitle, CardGrid, ActionCard, Stat,
// useStat, ActivityList and kes are unchanged, so nothing that already
// imports them breaks. Cards stay NAVIGATION containers: an icon, a title,
// one live line, a short description. Colours are inline styles (not built
// Tailwind class strings) so the JIT never purges an accent.

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, ChevronDown } from 'lucide-react';

// ── accents ────────────────────────────────────────────────────────────
const ACCENTS = {
  retail:     '#1F6B45',
  network:    '#2A7357',
  money:      '#B8921C',
  people:     '#3E8A5A',
  comms:      '#9C7A1B',
  rentals:    '#5E8F3E',
  salon:      '#C2A02E',
  rooms:      '#2A7357',
  production: '#8A6A12',
  more:       '#17553A',
};
const DEFAULT_ACCENT = '#1F6B45';
const tint = (hex, a = '1A') => `${hex}${a}`; // 8-digit hex = colour + alpha

const AccentContext = createContext(DEFAULT_ACCENT);
export const useAccent = () => useContext(AccentContext);

function accentFromPath(pathname) {
  const seg = (pathname.split('/')[2] || '').toLowerCase();
  return ACCENTS[seg] || DEFAULT_ACCENT;
}

const clamp = (n) => ({
  display: '-webkit-box', WebkitLineClamp: n, WebkitBoxOrient: 'vertical', overflow: 'hidden',
});

// ── page + section ─────────────────────────────────────────────────────
export function WorkspacePage({ title, subtitle, accent, children }) {
  const { pathname } = useLocation();
  const color = accent || accentFromPath(pathname);
  return (
    <AccentContext.Provider value={color}>
      <div className="px-3.5 py-3.5 sm:p-6 lg:p-8 max-w-5xl mx-auto min-w-0">
        {/* Topbar already shows the title on phones; the big heading is for md+. */}
        <div className="hidden md:flex items-center gap-3">
          <span className="w-1.5 h-7 rounded-full" style={{ background: color }} />
          <h1 className="text-2xl font-bold text-[#23382B]">{title}</h1>
        </div>
        {subtitle && <p className="text-[13px] text-[#6F7461] mt-0 md:mt-1.5 mb-3.5 md:mb-5 md:pl-[18px]">{subtitle}</p>}
        {children}
      </div>
    </AccentContext.Provider>
  );
}

export function SectionTitle({ children, right }) {
  const color = useAccent();
  return (
    <div className="flex items-center justify-between mt-5 mb-2 first:mt-0">
      <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[#6F7461]">
        <span className="w-[3px] h-3 rounded-full" style={{ background: color }} />
        {children}
      </h2>
      {right}
    </div>
  );
}

// Tiles: 2 across on phones, 3 on tablets, 4 on desktop.
export function CardGrid({ children }) {
  return <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">{children}</div>;
}

// ── live values ────────────────────────────────────────────────────────
/** Quiet placeholder while loading, "—" if it failed -- never a fake number. */
export function Stat({ state, format, fallback = '—' }) {
  if (!state || state.loading) return <span className="inline-block w-12 h-3.5 rounded bg-[#E3DBB8]/70 animate-pulse align-middle" />;
  if (state.error || state.value == null) return <span>{fallback}</span>;
  return <span>{format ? format(state.value) : String(state.value)}</span>;
}

/**
 * Run an async loader once (and again when deps change). Each stat is
 * independent: one failing query leaves that card showing "—" instead of
 * blanking the whole page.
 */
export function useStat(loader, deps) {
  const [state, setState] = useState({ loading: true, value: null, error: null });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    setState((s) => ({ ...s, loading: true }));
    Promise.resolve()
      .then(loader)
      .then((value) => { if (alive.current) setState({ loading: false, value, error: null }); })
      .catch((error) => {
        console.error('[workspace stat] failed:', error);
        if (alive.current) setState({ loading: false, value: null, error });
      });
    return () => { alive.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

// ── cards ──────────────────────────────────────────────────────────────
function Badge({ n, onDark, color }) {
  if (n == null || n === 0) return null;
  return (
    <span
      className="shrink-0 text-[10px] font-extrabold leading-none px-1.5 py-1 rounded-full"
      style={onDark ? { background: '#C9A227', color: '#0F3B2A' } : { background: tint(color, '26'), color: '#6b5214' }}
    >
      {n}
    </span>
  );
}

/**
 * The main card.
 *   default  compact white tile
 *   feature  slim full-width hero (Forest Green) -- the one thing this
 *            workspace is mostly for
 *   alert    tile with a Savanna Gold edge -- something needs attention
 * `action` is kept for compatibility and used as the accessible label.
 */
export function ActionCard({
  to, icon: Icon, title, stat, statLabel, description, action = 'Open',
  variant = 'default', badge, span2 = false,
}) {
  const accent = useAccent();

  if (variant === 'feature') {
    return (
      <Link
        to={to} aria-label={`${title} — ${action}`}
        className="group col-span-full flex items-center gap-3.5 rounded-2xl p-3.5 min-w-0 text-white active:scale-[0.99] transition-transform"
        style={{ background: '#17553A', borderLeft: `4px solid ${accent === '#17553A' ? '#C9A227' : accent}` }}
      >
        <div className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center bg-white/10 text-[#C9A227]"><Icon size={22} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-white/85 truncate">{title}</span>
            <Badge n={badge} onDark />
          </div>
          {stat !== undefined && (
            <div className="text-xl font-bold leading-tight break-words">
              {stat}{statLabel && <span className="text-xs font-medium ml-1.5 text-white/65">{statLabel}</span>}
            </div>
          )}
          {description && <p className="text-[11.5px] mt-0.5 leading-snug text-white/70" style={clamp(2)}>{description}</p>}
        </div>
        <ChevronRight size={18} className="shrink-0 text-white/50 group-hover:text-[#C9A227] transition-colors" />
      </Link>
    );
  }

  const alert = variant === 'alert';
  return (
    <Link
      to={to} aria-label={`${title} — ${action}`}
      className={`group flex flex-col rounded-xl p-3 min-h-[96px] min-w-0 bg-white border text-[#23382B] active:scale-[0.98] transition ${span2 ? 'sm:col-span-2' : ''}`}
      style={{
        borderColor: '#E3DBB8',
        borderLeft: alert ? '3px solid #C9A227' : '1px solid #E3DBB8',
        background: alert ? '#FFFDF7' : '#fff',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = accent; if (alert) e.currentTarget.style.borderLeftColor = '#C9A227'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#E3DBB8'; if (alert) e.currentTarget.style.borderLeftColor = '#C9A227'; }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: tint(accent, '1A'), color: accent }}>
          <Icon size={17} />
        </div>
        <Badge n={badge} color={accent} />
      </div>
      <div className="mt-2 text-[13.5px] font-semibold leading-tight truncate">{title}</div>
      {stat !== undefined && (
        <div className="mt-0.5 text-[15px] font-bold leading-tight break-words" style={{ color: '#23382B' }}>
          {stat}{statLabel && <span className="text-[11px] font-medium ml-1 text-[#6F7461]">{statLabel}</span>}
        </div>
      )}
      {description && <p className="mt-1 text-[11px] leading-snug text-[#6F7461]" style={clamp(2)}>{description}</p>}
    </Link>
  );
}

/** Sub-card: one-line secondary action. Use inside <MiniGrid>. */
export function MiniCard({ to, icon: Icon, title, desc, badge }) {
  const accent = useAccent();
  return (
    <Link
      to={to}
      className="group flex items-center gap-2.5 min-w-0 px-2.5 py-2 min-h-[48px] rounded-lg bg-white border border-[#E3DBB8] active:bg-[#FAF7EA] hover:border-[#D6C98A] transition-colors"
    >
      <div className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center" style={{ background: tint(accent, '1A'), color: accent }}>
        <Icon size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-[#23382B] truncate">{title}</div>
        {desc && <div className="text-[11px] text-[#6F7461] truncate">{desc}</div>}
      </div>
      <Badge n={badge} color={accent} />
      <ChevronRight size={14} className="shrink-0 text-[#B9B28A] group-hover:text-[#6F7461]" />
    </Link>
  );
}

export function MiniGrid({ children }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{children}</div>;
}

/** The accent colour a module key (retail, money, ...) uses. */
export const accentFor = (key) => ACCENTS[key] || DEFAULT_ACCENT;

/**
 * A parent card that groups related sub-cards (e.g. Retail -> My Items,
 * My Stock ...). The header is a link to the group's own workspace when
 * `to` is given; the body holds <SubCard/>s. The group's accent colour is
 * provided to its children, so the sub-cards pick it up automatically.
 */
export function GroupCard({ icon: Icon, title, blurb, to, accent, children, open, onToggle, count, openLabel }) {
  const inherited = useAccent();
  const color = accent || inherited;
  // Collapsible when the parent passes onToggle (the More screen): tap the card to show / hide its pages.
  // Otherwise it behaves as before: always open, header links to the workspace when `to` is given.
  const collapsible = typeof onToggle === 'function';
  const head = (
    <>
      <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: tint(color, '1F'), color }}>
        <Icon size={19} />
      </div>
      <div className="min-w-0 flex-1 text-left">
        <div className="text-[14.5px] font-bold text-[#23382B] leading-tight truncate">{title}</div>
        {blurb && <div className="text-[11px] text-[#6F7461] leading-snug truncate">{blurb}</div>}
      </div>
      {collapsible && count > 0 && <span className="shrink-0 text-[11px] font-bold rounded-full px-2 py-0.5" style={{ background: tint(color, '1F'), color }}>{count}</span>}
      {collapsible
        ? <ChevronDown size={18} className="shrink-0 text-[#B9B28A] transition-transform duration-200" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
        : to && <ChevronRight size={16} className="shrink-0 text-[#B9B28A] group-hover:text-[#6F7461] transition-colors" />}
    </>
  );
  const showBody = !collapsible || open;
  return (
    <AccentContext.Provider value={color}>
      <section className="rounded-2xl bg-white border border-[#E3DBB8] overflow-hidden min-w-0" style={{ borderTop: `3px solid ${color}` }}>
        {collapsible ? (
          <button type="button" onClick={onToggle} aria-expanded={!!open} className="w-full flex items-center gap-3 px-3 py-3 min-h-[60px] active:bg-[#FAF7EA] hover:bg-[#FCFAF0] transition-colors">{head}</button>
        ) : to ? (
          <Link to={to} className="group flex items-center gap-2.5 px-3 pt-2.5 pb-2 active:bg-[#FAF7EA] hover:bg-[#FCFAF0] transition-colors">{head}</Link>
        ) : (
          <div className="flex items-center gap-2.5 px-3 pt-2.5 pb-2">{head}</div>
        )}
        {showBody && (
          <div className={collapsible ? 'px-2.5 pb-2.5 pt-0.5 border-t border-[#F1ECD2]' : 'px-2 pb-2 grid grid-cols-1 min-[420px]:grid-cols-2 gap-1.5'}>
            {collapsible && to && (
              <Link to={to} className="flex items-center justify-between gap-2 mt-2 mb-1 px-3 min-h-[40px] rounded-lg text-[12.5px] font-bold" style={{ background: tint(color, '14'), color }}>
                <span>{openLabel || `Open ${title}`}</span><ChevronRight size={15} />
              </Link>
            )}
            {collapsible ? <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-1.5 mt-1.5">{children}</div> : children}
          </div>
        )}
      </section>
    </AccentContext.Provider>
  );
}

/** Small tile inside a <GroupCard/>. */
export function SubCard({ to, icon: Icon, title, desc, badge }) {
  const accent = useAccent();
  return (
    <Link
      to={to}
      className="group flex items-center gap-2 min-w-0 px-2 py-1.5 min-h-[42px] rounded-lg bg-[#FAF8EC] border border-[#EFE9CD] active:bg-[#F3EFD6] hover:border-[#D6C98A] transition-colors"
    >
      <Icon size={15} className="shrink-0" style={{ color: accent }} />
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-semibold text-[#23382B] leading-tight truncate">{title}</div>
        {desc && <div className="text-[10.5px] text-[#6F7461] leading-tight truncate">{desc}</div>}
      </div>
      <Badge n={badge} color={accent} />
    </Link>
  );
}

/**
 * A row of small number tiles. items: [{ label, value, tone? }]
 * tone: 'good' (green) | 'bad' (red) | undefined. `value` can be a <Stat/>.
 */
export function StatStrip({ items }) {
  const accent = useAccent();
  return (
    <div className="grid gap-2 mb-1" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((it) => (
        <div key={it.label} className="bg-white border border-[#E3DBB8] rounded-xl px-3 py-2.5 min-w-0" style={{ borderTop: `3px solid ${accent}` }}>
          <div className="text-[10px] font-bold uppercase tracking-wide text-[#6F7461] truncate">{it.label}</div>
          <div className={`text-[15px] sm:text-lg font-bold truncate ${it.tone === 'bad' ? 'text-red-600' : it.tone === 'good' ? 'text-[#1F6B45]' : 'text-[#23382B]'}`}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}

/** Compact list for "recent activity" under the cards. */
export function ActivityList({ title, rows, emptyText, viewAllTo, viewAllLabel = 'View all' }) {
  const accent = useAccent();
  return (
    <div>
      <SectionTitle right={viewAllTo ? <Link to={viewAllTo} className="text-xs font-semibold" style={{ color: accent }}>{viewAllLabel}</Link> : null}>{title}</SectionTitle>
      <div className="bg-white border border-[#E3DBB8] rounded-xl divide-y divide-[#F0EACF] overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-4 py-4 text-center text-[13px] text-[#6F7461]">{emptyText}</div>
        ) : rows.map((r) => (
          <div key={r.key} className="px-3.5 py-2 flex items-center justify-between gap-3 min-w-0">
            <div className="min-w-0">
              <div className="text-[13px] font-medium truncate">{r.primary}</div>
              {r.secondary && <div className="text-[11px] text-[#6F7461] truncate">{r.secondary}</div>}
            </div>
            {r.right && <div className="text-[11px] font-semibold text-[#6F7461] shrink-0 text-right">{r.right}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export const kes = (n) => `KES ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
