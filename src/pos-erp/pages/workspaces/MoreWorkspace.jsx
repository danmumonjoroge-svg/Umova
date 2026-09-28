// src/pos-erp/pages/workspaces/MoreWorkspace.jsx
//
// The "More" tab (brief section 3). On a phone the bottom bar only fits
// five destinations, so every other module lives here as a plain list --
// this is the primary way a phone user reaches Retail, Rentals, Salon
// and Messages. Also holds Settings, Audit and Sign out. Uses the same
// navConfig as the sidebar, so it can never drift out of step with it.

import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, LogOut, SlidersHorizontal } from 'lucide-react';
import { usePosErpAuth } from '../../auth/usePosErpAuth';
import { useCapabilities } from '../../navigation/CapabilitiesContext';
import { MODULES, visibleModules } from '../../navigation/navConfig';
import { WorkspacePage, SectionTitle } from '../../components/workspace/WorkspaceKit';

function Row({ to, icon: Icon, label, blurb }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-3 min-h-[56px] hover:bg-[#F7F6F0] active:bg-[#F7F6F0]">
      <div className="w-9 h-9 rounded-lg bg-[#237A52]/10 text-[#237A52] flex items-center justify-center shrink-0"><Icon size={18} /></div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{label}</div>
        {blurb && <div className="text-xs text-[#68756D] truncate">{blurb}</div>}
      </div>
      <ChevronRight size={16} className="text-[#68756D] shrink-0" />
    </Link>
  );
}

export default function MoreWorkspace() {
  const { staffName, role, tenant, logout } = usePosErpAuth();
  const { enabled } = useCapabilities();

  // Everything that is not a bottom-bar tab and not More itself.
  const others = visibleModules(enabled).filter((m) => !m.tab);
  const more = MODULES.find((m) => m.key === 'more');

  return (
    <WorkspacePage title="More" subtitle={tenant?.business_name ? `${tenant.business_name}${staffName ? ` · ${staffName}` : ''}${role ? ` (${role})` : ''}` : undefined}>
      <SectionTitle>Your business</SectionTitle>
      <div className="bg-white border border-[#DDE3DD] rounded-xl divide-y divide-[#DDE3DD] overflow-hidden">
        {others.map((m) => <Row key={m.key} to={m.to} icon={m.icon} label={m.label} blurb={m.blurb} />)}
      </div>

      <SectionTitle>Manage</SectionTitle>
      <div className="bg-white border border-[#DDE3DD] rounded-xl divide-y divide-[#DDE3DD] overflow-hidden">
        {more.children.map((c) => <Row key={c.to} to={c.to} icon={c.icon} label={c.label} />)}
        <Row to="/pos/settings" icon={SlidersHorizontal} label="What my business does" blurb="Choose Retail, Rentals or Salon to show" />
      </div>

      <button
        onClick={logout}
        className="mt-6 w-full flex items-center justify-center gap-2 min-h-[48px] bg-white border border-[#DDE3DD] rounded-xl text-sm font-semibold text-[#26352D] hover:bg-[#F7F6F0]"
      >
        <LogOut size={16} /> Sign out
      </button>
    </WorkspacePage>
  );
}
