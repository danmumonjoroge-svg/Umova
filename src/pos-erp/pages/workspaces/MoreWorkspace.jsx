// src/pos-erp/pages/workspaces/MoreWorkspace.jsx
//
// The "More" tab. Phone layout: a profile card, a search box, then app-style TILES (3 across) grouped under
// "Your business" and "Manage". Tapping a tile opens a bottom sheet with that area's pages. Search jumps straight
// to any page. Everything still comes from navConfig, so it cannot drift from the sidebar and it respects roles:
// a person only sees tiles and pages they are allowed to open. A page not named in ADMIN_GROUPS lands in "Other".

import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LogOut, SlidersHorizontal, CalendarCheck, UsersRound, ShieldCheck, Settings, LayoutGrid, Search, X, ChevronRight, ArrowRight } from 'lucide-react';
import { usePosErpAuth } from '../../auth/usePosErpAuth';
import { useCapabilities } from '../../navigation/CapabilitiesContext';
import { usePermissions } from '../../navigation/PermissionsContext';
import { MODULES, visibleModules, visibleChildren } from '../../navigation/navConfig';
import { accentFor } from '../../components/workspace/WorkspaceKit';

const ADMIN_GROUPS = [
  { key: 'day',    title: 'Day to day', blurb: 'Close the day, fix a sale', icon: CalendarCheck, color: '#B8921C', paths: ['/pos/reconcile', '/pos/reversals'] },
  { key: 'team',   title: 'Team',       blurb: 'Staff, records and pay',    icon: UsersRound,    color: '#3E8A5A', paths: ['/pos/staff', '/pos/hr', '/pos/payroll'] },
  { key: 'checks', title: 'Oversight',  blurb: 'Reports and audit trail',   icon: ShieldCheck,   color: '#8A6A12', paths: ['/pos/control', '/pos/audit'] },
];

const initials = (name) => String(name || 'MB').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function Tile({ icon: Icon, title, count, color, onClick }) {
  return (
    <button type="button" onClick={onClick} className="relative flex flex-col items-center justify-start gap-2 rounded-2xl bg-white border border-[#E3DBB8] px-2 pt-3.5 pb-3 min-w-0 active:scale-[0.97] transition-transform hover:border-[#C9A227]">
      <span className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: `${color}1F`, color }}><Icon size={23} /></span>
      <span className="text-[12.5px] font-bold text-[#23382B] leading-tight text-center line-clamp-2">{title}</span>
      {count > 0 && <span className="absolute top-2 right-2 min-w-[20px] h-5 px-1.5 rounded-full text-[10.5px] font-bold flex items-center justify-center" style={{ background: `${color}22`, color }}>{count}</span>}
    </button>
  );
}

function Section({ label, children }) {
  return (
    <>
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[#6F7461] mt-5 mb-2.5 px-0.5"><span className="w-1 h-3.5 rounded-full bg-[#C9A227]" />{label}</div>
      <div className="grid grid-cols-3 gap-2.5">{children}</div>
    </>
  );
}

function PageRow({ to, icon: Icon, title, desc, color, onClick }) {
  return (
    <Link to={to} onClick={onClick} className="flex items-center gap-3 px-3 min-h-[54px] rounded-xl bg-[#FAF8EC] border border-[#EFE9CD] active:bg-[#F3EFD6] hover:border-[#D6C98A] transition-colors">
      <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}1F`, color }}><Icon size={17} /></span>
      <span className="min-w-0 flex-1"><span className="block text-[14px] font-semibold text-[#23382B] leading-tight truncate">{title}</span>{desc && <span className="block text-[11.5px] text-[#6F7461] truncate">{desc}</span>}</span>
      <ChevronRight size={16} className="text-[#B9B28A] shrink-0" />
    </Link>
  );
}

export default function MoreWorkspace() {
  const { staffName, role, tenant, logout } = usePosErpAuth();
  const { enabled } = useCapabilities();
  const { canAny } = usePermissions();
  const [sheet, setSheet] = useState(null);   // { title, blurb, icon, color, to, openLabel, pages: [{to,icon,title,desc}] }
  const [q, setQ] = useState('');

  const others = visibleModules(enabled, canAny).filter((m) => !m.tab);
  const more = MODULES.find((m) => m.key === 'more');
  const withPages = others.map((m) => ({ m, kids: visibleChildren(m, enabled, canAny) })).filter((x) => x.kids.length > 0);
  const singles = others.filter((m) => visibleChildren(m, enabled, canAny).length === 0);

  const adminPages = visibleChildren(more, enabled, canAny).filter((c) => c.to !== '/pos/settings');
  const placed = new Set(ADMIN_GROUPS.flatMap((g) => g.paths));
  const adminGroups = ADMIN_GROUPS.map((g) => ({ ...g, items: g.paths.map((p) => adminPages.find((c) => c.to === p)).filter(Boolean) })).filter((g) => g.items.length > 0);
  const leftovers = adminPages.filter((c) => !placed.has(c.to));
  const hasSettingsPage = visibleChildren(more, enabled, canAny).some((c) => c.to === '/pos/settings');

  // Every page, for search.
  const everything = useMemo(() => {
    const list = [];
    withPages.forEach(({ m, kids }) => kids.forEach((c) => list.push({ to: c.to, icon: c.icon, title: c.label, where: m.label, color: accentFor(m.key) })));
    singles.forEach((m) => list.push({ to: m.to, icon: m.icon, title: m.label, where: 'Tools', color: accentFor(m.key) }));
    adminGroups.forEach((g) => g.items.forEach((c) => list.push({ to: c.to, icon: c.icon, title: c.label, where: g.title, color: g.color })));
    leftovers.forEach((c) => list.push({ to: c.to, icon: c.icon, title: c.label, where: 'Other', color: '#17553A' }));
    if (hasSettingsPage) list.push({ to: '/pos/settings', icon: Settings, title: 'Settings', where: 'Settings', color: '#17553A' });
    list.push({ to: '/pos/settings', icon: SlidersHorizontal, title: 'What my business does', where: 'Settings', color: '#17553A' });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, canAny]);
  const term = q.trim().toLowerCase();
  const found = term ? everything.filter((p) => `${p.title} ${p.where}`.toLowerCase().includes(term)) : [];

  const open = (s) => () => setSheet(s);
  const close = () => setSheet(null);
  const subtitle = [staffName, role && `(${role})`].filter(Boolean).join(' ');

  return (
    <div className="px-3.5 py-3.5 sm:p-6 lg:p-8 max-w-3xl mx-auto min-w-0">
      {/* profile */}
      <div className="rounded-3xl bg-[#17553A] text-white p-4 flex items-center gap-3.5 relative overflow-hidden">
        <div className="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-[#C9A227]/15" aria-hidden="true" />
        <div className="relative w-14 h-14 rounded-2xl bg-[#E8C65A] text-[#3B2F06] flex items-center justify-center text-lg font-extrabold shrink-0">{initials(tenant?.business_name || staffName)}</div>
        <div className="relative min-w-0">
          <div className="text-[16px] font-bold leading-tight truncate">{tenant?.business_name || 'My Business'}</div>
          <div className="text-[12.5px] text-white/75 truncate">{subtitle || 'Signed in'}</div>
        </div>
      </div>

      {/* search */}
      <div className="relative mt-3">
        <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9A987F]" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a page, e.g. stock, payroll…" aria-label="Find a page"
          className="w-full min-h-[46px] rounded-2xl bg-white border border-[#E3DBB8] pl-10 pr-10 text-sm text-[#23382B] focus:outline-none focus:border-[#C9A227] focus:ring-2 focus:ring-[#C9A227]/25" />
        {q && <button type="button" onClick={() => setQ('')} aria-label="Clear" className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-[#6F7461]"><X size={16} /></button>}
      </div>

      {term ? (
        <div className="mt-4 grid gap-2">
          {found.length === 0 && <div className="text-center text-sm text-[#8B8766] bg-white border border-dashed border-[#E3DBB8] rounded-2xl py-8">Nothing matches "{q}".</div>}
          {found.map((p, i) => <PageRow key={`${p.to}-${i}`} to={p.to} icon={p.icon} title={p.title} desc={p.where} color={p.color} />)}
        </div>
      ) : (
        <>
          <Section label="Your business">
            {withPages.map(({ m, kids }) => (
              <Tile key={m.key} icon={m.icon} title={m.label} count={kids.length} color={accentFor(m.key)}
                onClick={open({ title: m.label, blurb: m.blurb, icon: m.icon, color: accentFor(m.key), to: m.to, openLabel: `Open ${m.label} home`, pages: kids.map((c) => ({ to: c.to, icon: c.icon, title: c.label })) })} />
            ))}
            {singles.length > 0 && (
              <Tile icon={LayoutGrid} title="Other tools" count={singles.length} color="#17553A"
                onClick={open({ title: 'Other tools', blurb: 'Single-page tools', icon: LayoutGrid, color: '#17553A', pages: singles.map((m) => ({ to: m.to, icon: m.icon, title: m.label, desc: m.blurb })) })} />
            )}
          </Section>

          <Section label="Manage">
            {adminGroups.map((g) => (
              <Tile key={g.key} icon={g.icon} title={g.title} count={g.items.length} color={g.color}
                onClick={open({ title: g.title, blurb: g.blurb, icon: g.icon, color: g.color, pages: g.items.map((c) => ({ to: c.to, icon: c.icon, title: c.label })) })} />
            ))}
            {leftovers.length > 0 && (
              <Tile icon={LayoutGrid} title="Other" count={leftovers.length} color="#17553A"
                onClick={open({ title: 'Other', icon: LayoutGrid, color: '#17553A', pages: leftovers.map((c) => ({ to: c.to, icon: c.icon, title: c.label })) })} />
            )}
            <Tile icon={Settings} title="Settings" color="#17553A"
              onClick={open({ title: 'Settings', blurb: 'Your business and your menu', icon: Settings, color: '#17553A', pages: [
                ...(hasSettingsPage ? [{ to: '/pos/settings', icon: Settings, title: 'Settings' }] : []),
                { to: '/pos/settings', icon: SlidersHorizontal, title: 'What my business does', desc: 'Choose what shows in your menu' },
              ] })} />
          </Section>
        </>
      )}

      <button onClick={logout} className="mt-6 w-full flex items-center justify-center gap-2 min-h-[46px] bg-white border border-[#F0C2BB] rounded-2xl text-[13.5px] font-bold text-[#A3352A] active:bg-[#FBE4E0]">
        <LogOut size={16} /> Sign out
      </button>

      {/* bottom sheet: one area's pages */}
      {sheet && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={close} role="dialog" aria-modal="true" aria-label={sheet.title}>
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-4 pb-6 max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-[#E3DBB8] mx-auto mb-3 sm:hidden" />
            <div className="flex items-center gap-3 mb-3">
              <span className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: `${sheet.color}1F`, color: sheet.color }}><sheet.icon size={23} /></span>
              <div className="min-w-0 flex-1"><div className="text-[17px] font-extrabold text-[#23382B] leading-tight truncate">{sheet.title}</div>{sheet.blurb && <div className="text-[12px] text-[#6F7461] leading-snug">{sheet.blurb}</div>}</div>
              <button type="button" onClick={close} aria-label="Close" className="w-10 h-10 flex items-center justify-center text-[#6F7461] shrink-0"><X size={19} /></button>
            </div>
            {sheet.to && (
              <Link to={sheet.to} onClick={close} className="flex items-center justify-between gap-2 mb-2.5 px-4 min-h-[46px] rounded-xl text-[13.5px] font-bold text-white" style={{ background: sheet.color }}>
                <span>{sheet.openLabel}</span><ArrowRight size={16} />
              </Link>
            )}
            <div className="grid gap-2">
              {sheet.pages.map((p, i) => <PageRow key={`${p.to}-${i}`} to={p.to} icon={p.icon} title={p.title} desc={p.desc} color={sheet.color} onClick={close} />)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
