// src/pos-erp/navigation/navConfig.js
//
// The single source of truth for navigation. Sidebar, bottom bar, the
// More screen, the topbar title/breadcrumb and every workspace all read
// from here -- add a route to a module's `children` and it shows up
// everywhere it should, with the right active state.
//
// ARCHITECTURE (brief section 5):   MODULE -> WORKSPACE -> PAGE
//   module     one line in the sidebar (Retail, My Money, ...)
//   workspace  the module's full-screen landing page (`to`)
//   page       a `children` entry -- an existing route, unchanged
//
// CAPABILITIES (brief section 10): a module with `capability: 'x'` is
// only shown in navigation when that capability is enabled for the
// business (see CapabilitiesContext). Modules without one are always
// shown. Routes themselves are NEVER removed by a capability being off
// -- a deep link or bookmark still works; only the navigation entry is
// hidden. Adding a new business type later = add a key to CAPABILITIES,
// one module below, and its workspace page. No layout changes.

import {
  LayoutDashboard, ShoppingCart, ShoppingBag, Package, Boxes, Truck, Users, UserRound,
  Wallet, Receipt, Building2, Home, Repeat, Gauge, FileText, Wrench, Scissors, CalendarClock, MessageSquare,
  Settings, ShieldCheck, Landmark, Smartphone, BarChart3, FileBarChart, HardHat, ClipboardList,
  Bell, MoreHorizontal,
} from 'lucide-react';

export const CAPABILITIES = {
  retail: { label: 'Retail', hint: 'Sell items and manage stock, suppliers and purchases' },
  rentals: { label: 'Rentals', hint: 'Manage rental units, rent charges and meter readings' },
  salon: { label: 'Salon & Services', hint: 'Sell services and manage appointments' },
};
export const ALL_CAPABILITY_KEYS = Object.keys(CAPABILITIES);

export const MODULES = [
  {
    key: 'home', label: 'Home', icon: LayoutDashboard, to: '/pos/dashboard',
    blurb: "Today's numbers and what needs you",
    tab: { label: 'Home' },
    children: [],
  },
  {
    key: 'sell', label: 'Sell', icon: ShoppingCart, to: '/pos', exact: true,
    blurb: 'Ring up a sale',
    tab: { label: 'Sell' },
    children: [],
  },
  {
    key: 'retail', label: 'Retail', icon: ShoppingBag, to: '/pos/retail', capability: 'retail',
    blurb: 'Items, stock, suppliers and purchases',
    children: [
      { to: '/pos/products', label: 'My Items', icon: Package },
      { to: '/pos/inventory', label: 'My Stock', icon: Boxes },
      { to: '/pos/purchase-orders', label: 'Purchase Orders', icon: ClipboardList },
      { to: '/pos/goods-receiving', label: 'Receive Stock', icon: Truck },
      { to: '/pos/suppliers', label: 'Suppliers', icon: Users },
      { to: '/pos/payables', label: 'People I Owe', icon: Wallet },
    ],
  },
  {
    key: 'rentals', label: 'Rentals', icon: Building2, to: '/pos/rentals', capability: 'rentals',
    blurb: 'Units, rent, meters, invoices and maintenance',
    children: [
      { to: '/pos/units', label: 'Units', icon: Home },
      { to: '/pos/charges', label: 'Rent & Charges', icon: Repeat },
      { to: '/pos/meters', label: 'Meters', icon: Gauge },
      { to: '/pos/invoices', label: 'My Invoices', icon: FileText },
      { to: '/pos/maintenance', label: 'My Maintenance', icon: Wrench },
    ],
  },
  {
    key: 'salon', label: 'Salon', icon: Scissors, to: '/pos/salon', capability: 'salon',
    blurb: 'Services and appointments',
    children: [
      { to: '/pos/services', label: 'Services', icon: Scissors },
      { to: '/pos/appointments', label: 'Appointments', icon: CalendarClock },
    ],
  },
  {
    key: 'money', label: 'My Money', icon: Landmark, to: '/pos/money',
    blurb: 'Cash, M-Pesa, spending and reports',
    tab: { label: 'Money' },
    children: [
      { to: '/pos/cash', label: 'Cash', icon: Wallet },
      { to: '/pos/mpesa', label: 'M-Pesa', icon: Smartphone },
      { to: '/pos/expenses', label: 'My Spending', icon: Receipt },
      { to: '/pos/reports', label: 'My Reports', icon: BarChart3 },
      { to: '/pos/financials', label: 'Financial Statements', icon: FileBarChart },
      { to: '/pos/equipment', label: 'My Equipment', icon: HardHat },
    ],
  },
  {
    key: 'people', label: 'Customers', icon: UserRound, to: '/pos/people',
    blurb: 'Customers, who owes you, statements',
    tab: { label: 'People' },
    children: [
      { to: '/pos/customers', label: 'Customers', icon: UserRound },
    ],
  },
  {
    key: 'messages', label: 'Messages', icon: MessageSquare, to: '/pos/comms',
    blurb: 'WhatsApp, email and notifications',
    children: [
      { to: '/pos/messages', label: 'Customer Messages', icon: MessageSquare },
      { to: '/pos/communication', label: 'Notifications', icon: Bell },
    ],
  },
  {
    key: 'more', label: 'More', icon: MoreHorizontal, to: '/pos/more',
    blurb: 'Settings, audit and everything else',
    tab: { label: 'More' },
    children: [
      { to: '/pos/settings', label: 'Settings', icon: Settings },
      { to: '/pos/audit', label: 'Audit', icon: ShieldCheck },
    ],
  },
];

/** Bottom-bar tabs (brief section 3): Home, Sell, Money, People, More. */
export const MOBILE_TABS = MODULES.filter((m) => m.tab).map((m) => ({ ...m, label: m.tab.label }));

/** path === prefix, or path is inside prefix -- so '/pos/communication' never matches '/pos/comms'. */
function within(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

/**
 * Where is this URL in the module -> workspace -> page tree?
 * Independent of which capabilities are enabled (a deep link into a
 * hidden module still gets a correct title and back link).
 * Returns { module, page, isWorkspaceRoot }.
 */
export function resolveLocation(pathname) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

  for (const m of MODULES) {
    if (path === m.to) {
      return { module: m, page: null, isWorkspaceRoot: true };
    }
  }
  for (const m of MODULES) {
    const child = m.children.find((c) => within(path, c.to));
    if (child) return { module: m, page: child, isWorkspaceRoot: false };
  }
  return { module: null, page: null, isWorkspaceRoot: false };
}

/** Modules to show in navigation given the enabled capability keys. */
export function visibleModules(enabledCapabilities) {
  return MODULES.filter((m) => !m.capability || enabledCapabilities.includes(m.capability));
}

/** Which bottom tab should look active for this module? Modules that live under "More" light up More. */
export function activeTabKey(moduleKey) {
  if (!moduleKey) return null;
  return MOBILE_TABS.some((t) => t.key === moduleKey) ? moduleKey : 'more';
}
