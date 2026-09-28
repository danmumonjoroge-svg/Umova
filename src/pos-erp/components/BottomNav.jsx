// src/pos-erp/components/BottomNav.jsx
//
// Phone navigation (brief section 3): Home, Sell, Money, People, More.
// Fixed to the bottom, safe-area aware (iPhone home bar / Android
// gesture bar), 56px+ touch targets, hidden from md: up where the
// sidebar takes over, and hidden when printing.
//
// NOTE for deployment: env(safe-area-inset-bottom) is only non-zero if
// the app's index.html viewport meta includes `viewport-fit=cover`.
// Without it the bar still works, it just has no extra bottom inset.

import React from 'react';
import { NavLink } from 'react-router-dom';
import { MOBILE_TABS, activeTabKey } from '../navigation/navConfig';

export default function BottomNav({ moduleKey }) {
  const activeKey = activeTabKey(moduleKey);
  return (
    <nav
      aria-label="Main"
      className="md:hidden print:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-[#DDE3DD]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <ul className="grid grid-cols-5">
        {MOBILE_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = tab.key === activeKey;
          return (
            <li key={tab.key} className="min-w-0">
              <NavLink
                to={tab.to}
                end={!!tab.exact}
                aria-current={active ? 'page' : undefined}
                className={`relative flex flex-col items-center justify-center gap-0.5 min-h-[56px] px-1 text-[11px] font-semibold ${
                  active ? 'text-[#237A52]' : 'text-[#68756D]'
                }`}
              >
                {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 h-[3px] w-8 rounded-b bg-[#C6A15B]" />}
                <Icon size={22} strokeWidth={active ? 2.4 : 1.9} />
                <span className="truncate max-w-full">{tab.label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
