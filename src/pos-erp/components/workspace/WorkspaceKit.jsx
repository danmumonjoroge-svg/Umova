// src/pos-erp/components/workspace/WorkspaceKit.jsx
//
// The small set of building blocks every workspace page is made from.
// Cards here are NAVIGATION/ACTION containers (brief section 13) -- an
// icon, a title, one useful live line, a short description, and a clear
// action -- not decorative KPI boxes.
//
// Variants keep the page from being a wall of identical tiles:
//   default  white card
//   feature  Forest Green card, for the one thing this workspace is mostly for
//   alert    white card with a Savanna Gold edge -- something needs attention

import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

export function WorkspacePage({ title, subtitle, children }) {
  return (
    <div className="px-4 py-4 sm:p-6 lg:p-8 max-w-5xl mx-auto min-w-0">
      {/* The topbar already shows the page title on phones; the big
          heading is for md+ where the topbar is quieter. */}
      <h1 className="hidden md:block text-2xl font-bold text-[#26352D]">{title}</h1>
      {subtitle && <p className="text-sm text-[#68756D] mt-0 md:mt-1 mb-4 md:mb-6">{subtitle}</p>}
      {children}
    </div>
  );
}

export function SectionTitle({ children, right }) {
  return (
    <div className="flex items-center justify-between mt-6 mb-2.5 first:mt-0">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-[#68756D]">{children}</h2>
      {right}
    </div>
  );
}

export function CardGrid({ children }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{children}</div>;
}

/** Value that shows a quiet placeholder while loading and "—" if it failed -- never a fake number. */
export function Stat({ state, format, fallback = '—' }) {
  if (!state || state.loading) return <span className="inline-block w-16 h-4 rounded bg-[#DDE3DD]/70 animate-pulse align-middle" />;
  if (state.error || state.value == null) return <span>{fallback}</span>;
  return <span>{format ? format(state.value) : String(state.value)}</span>;
}

/**
 * Run an async loader once (and again when deps change). Each stat on a
 * workspace is independent: one failing query leaves that one card
 * showing "—" instead of blanking the whole page.
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

export function ActionCard({
  to, icon: Icon, title, stat, statLabel, description, action = 'Open',
  variant = 'default', badge, span2 = false,
}) {
  const feature = variant === 'feature';
  const alert = variant === 'alert';

  const base = feature
    ? 'bg-[#1B5138] text-white border border-[#123C2A] hover:bg-[#123C2A]'
    : `bg-white text-[#26352D] border border-[#DDE3DD] hover:border-[#237A52] ${alert ? 'border-l-4 border-l-[#C6A15B]' : ''}`;

  return (
    <Link
      to={to}
      className={`group flex flex-col rounded-xl p-4 min-h-[88px] transition-colors min-w-0 ${base} ${span2 ? 'lg:col-span-2' : ''}`}
    >
      <div className="flex items-start gap-3 min-w-0">
        <div className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${feature ? 'bg-white/10 text-[#C6A15B]' : 'bg-[#237A52]/10 text-[#237A52]'}`}>
          <Icon size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold truncate">{title}</span>
            {badge != null && badge !== 0 && (
              <span className={`shrink-0 text-[11px] font-bold px-1.5 py-0.5 rounded-full ${feature ? 'bg-[#C6A15B] text-[#123C2A]' : 'bg-[#C6A15B]/20 text-[#7a5f1f]'}`}>{badge}</span>
            )}
          </div>
          {stat !== undefined && (
            <div className={`text-lg font-bold leading-snug mt-0.5 break-words ${feature ? 'text-white' : 'text-[#26352D]'}`}>
              {stat}
              {statLabel && <span className={`text-xs font-medium ml-1.5 ${feature ? 'text-white/70' : 'text-[#68756D]'}`}>{statLabel}</span>}
            </div>
          )}
          {description && (
            <p className={`text-xs mt-1 leading-snug ${feature ? 'text-white/75' : 'text-[#68756D]'}`}>{description}</p>
          )}
        </div>
      </div>
      <div className={`mt-3 text-xs font-semibold flex items-center gap-1 ${feature ? 'text-[#C6A15B]' : 'text-[#237A52]'}`}>
        {action} <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

/** Compact row for a "recent activity" style list under the cards. */
export function ActivityList({ title, rows, emptyText, viewAllTo, viewAllLabel = 'View all' }) {
  return (
    <div>
      <SectionTitle right={viewAllTo ? <Link to={viewAllTo} className="text-xs font-semibold text-[#237A52]">{viewAllLabel}</Link> : null}>{title}</SectionTitle>
      <div className="bg-white border border-[#DDE3DD] rounded-xl divide-y divide-[#DDE3DD]">
        {rows.length === 0 ? (
          <div className="px-4 py-5 text-center text-sm text-[#68756D]">{emptyText}</div>
        ) : rows.map((r) => (
          <div key={r.key} className="px-4 py-2.5 flex items-center justify-between gap-3 min-w-0">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{r.primary}</div>
              {r.secondary && <div className="text-xs text-[#68756D] truncate">{r.secondary}</div>}
            </div>
            {r.right && <div className="text-xs font-semibold text-[#68756D] shrink-0 text-right">{r.right}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export const kes = (n) => `KES ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
