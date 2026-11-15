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
  Search, Store, Bell, UserCog, RotateCcw, Calculator, Briefcase, ClipboardCheck, Banknote, Coins, Target, Printer, MoreHorizontal, BookUser, BedDouble, DoorOpen, Dumbbell, Factory, ChefHat,
} from 'lucide-react';

// `optIn: true` -- a capability that is NEVER on just because the owner hasn't chosen yet. Existing
// businesses (which have no saved choice) therefore see exactly the menu they had before; a new
// capability only appears once the owner switches it on in Settings.
// Which of YOUR existing permission keys opens each area. The database refuses the action
// regardless; this only decides what to show. '@owner' = business owner only.
const RETAIL_PERMS = ['products.manage', 'inventory.view', 'inventory.scan', 'inventory.receive', 'inventory.adjust', 'inventory.stocktake', 'inventory.transfer', 'purchases.create'];
const MONEY_PERMS = ['finance.view', 'balances.view', 'expenses.record', 'reports.export'];
// M-Pesa is also the cashier's job: a received payment is matched to a bill and cleared with payments.record.
const MPESA_PERMS = [...MONEY_PERMS, 'payments.record'];
const PEOPLE_PERMS = ['sales.view', 'sales.create', 'balances.view', 'payments.record'];
// Everyday operations screens (rentals, salon, rooms, production, services, messages) use the existing 'operations.use' key.
const OPS_PERMS = ['operations.use'];
// New screens reuse existing keys only. Printable Reports: any report-viewing right (downloading needs reports.export, checked on the page).
const REPORT_VIEW_PERMS = ['finance.view', 'sales.view', 'inventory.view', 'balances.view', 'reports.export'];
const BUDGET_VIEW_PERMS = ['finance.view'];
// My Business Network reuses these existing keys (no new permission keys): publish = products.manage, order = purchases.create,
// receive = inventory.receive, answer/dispatch incoming = sales.create. The database enforces them; this only decides what to show.
const NETWORK_PERMS = ['products.manage', 'purchases.create', 'inventory.receive', 'sales.view', 'sales.create'];
const NETWORK_FIND_PERMS = ['purchases.create', 'inventory.view'];
const NETWORK_ORDER_PERMS = ['purchases.create', 'inventory.receive', 'sales.view', 'sales.create'];

export const CAPABILITIES = {
  retail: { label: 'Retail', hint: 'Sell items and manage stock, suppliers and purchases' },
  rentals: { label: 'Rentals', hint: 'Manage rental units, rent charges and meter readings' },
  salon: { label: 'Salon & Services', hint: 'Sell services and manage appointments' },
  folios: { label: 'Customer Folios', hint: 'Keep one running bill per customer and settle it all at once', optIn: true },
  services: { label: 'Services & Activities', hint: 'Sell swimming, gym, massage, a conference room and more. Charge them to a guest\'s folio', optIn: true },
  production: { label: 'Production', hint: 'Make things from your materials: bakery, butchery, kitchen, juice. See yield, wastage and real cost', optIn: true },
  packages: { label: 'Packages', hint: 'Sell a bundle at one price (Family Package, Bed & Breakfast). Needs Customer Folios', optIn: true, requires: ['folios'] },
  efficiency: { label: 'How we are doing', hint: 'Occupancy, guest spend, yield and wastage, worked out from your real records', optIn: true },
  network: { label: 'My Business Network', hint: 'Find stock from other businesses, order it, and sell to them. You choose what you publish', optIn: true },
  rooms: { label: 'Rooms & Stays', hint: 'Rooms, bookings, check-in and check-out. Each guest gets one bill (turns on Customer Folios too)', optIn: true, requires: ['folios'] },
};

/** A capability that needs others switches them on with it (Rooms & Stays bills through Customer Folios). */
export function withRequired(keys) {
  const out = new Set(keys);
  keys.forEach((k) => (CAPABILITIES[k]?.requires || []).forEach((r) => out.add(r)));
  return [...out];
}
export const ALL_CAPABILITY_KEYS = Object.keys(CAPABILITIES);
/** What an owner who hasn't chosen yet sees: everything except opt-in capabilities. */
export const DEFAULT_CAPABILITY_KEYS = ALL_CAPABILITY_KEYS.filter((k) => !CAPABILITIES[k].optIn);

export const MODULES = [
  {
    key: 'home', label: 'Home', icon: LayoutDashboard, to: '/pos/dashboard',
    blurb: "Today's numbers and what needs you",
    tab: { label: 'Home' },
    children: [],
  },
  {
    key: 'sell', perm: ['sales.create'], label: 'Sell', icon: ShoppingCart, to: '/pos/sell',
    blurb: 'Ring up a sale',
    tab: { label: 'Sell' },
    children: [],
  },
  {
    key: 'retail', perm: RETAIL_PERMS, label: 'Retail', icon: ShoppingBag, to: '/pos/retail', capability: 'retail',
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
    key: 'network', perm: NETWORK_PERMS, label: 'Network', icon: Store, to: '/pos/network', capability: 'network',
    blurb: 'Find stock from suppliers, order and track delivery',
    children: [
      { to: '/pos/network/find', label: 'Find Stock', icon: Search, perm: NETWORK_FIND_PERMS },
      { to: '/pos/network/orders', label: 'My Orders', icon: ClipboardList, perm: NETWORK_ORDER_PERMS },
      { to: '/pos/network/suppliers', label: 'My Suppliers', icon: Users, perm: NETWORK_ORDER_PERMS },
      { to: '/pos/network/offers', label: 'My Offers', icon: Package, perm: ['products.manage'] },
    ],
  },
  {
    key: 'rentals', perm: OPS_PERMS, label: 'Rentals', icon: Building2, to: '/pos/rentals', capability: 'rentals',
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
    key: 'salon', perm: OPS_PERMS, label: 'Salon', icon: Scissors, to: '/pos/salon', capability: 'salon',
    blurb: 'Services and appointments',
    children: [
      { to: '/pos/services', label: 'Services', icon: Scissors },
      { to: '/pos/appointments', label: 'Appointments', icon: CalendarClock },
    ],
  },
  {
    key: 'rooms', perm: OPS_PERMS, label: 'Rooms', icon: BedDouble, to: '/pos/rooms', capability: 'rooms',
    blurb: 'Rooms, bookings, who is in, check-out',
    children: [
      { to: '/pos/room-list', label: 'Rooms', icon: BedDouble },
      { to: '/pos/stays', label: 'Stays & Bookings', icon: DoorOpen },
    ],
  },
  {
    key: 'production', perm: OPS_PERMS, label: 'Production', icon: Factory, to: '/pos/production', capability: 'production',
    blurb: 'Recipes, batches, yield and wastage',
    children: [
      { to: '/pos/production-runs', label: 'Production Runs', icon: Factory },
      { to: '/pos/recipes', label: 'Recipes', icon: ChefHat },
    ],
  },
  {
    // Same page as the Salon module's Services, reached from its own entry for businesses that are not salons.
    key: 'activities', perm: OPS_PERMS, label: 'Services', icon: Dumbbell, to: '/pos/activities', capability: 'services',
    blurb: 'Swimming, gym, massage, hall hire and other things you sell by the hour or visit',
    children: [],
  },
  {
    key: 'packages', perm: OPS_PERMS, label: 'Packages', icon: Package, to: '/pos/packages', capability: 'packages',
    blurb: 'Bundles sold at one price',
    children: [],
  },
  {
    key: 'efficiency', perm: ['finance.view'], label: 'How We Are Doing', icon: Gauge, to: '/pos/efficiency', capability: 'efficiency',
    blurb: 'Real numbers from your rooms, bills and production',
    children: [],
  },
  {
    key: 'money', perm: MPESA_PERMS, label: 'My Money', icon: Landmark, to: '/pos/money',
    blurb: 'Cash, M-Pesa, spending and reports',
    tab: { label: 'Money' },
    children: [
      { to: '/pos/cash', label: 'Cash', icon: Wallet, perm: MONEY_PERMS },
      { to: '/pos/mpesa', label: 'M-Pesa', icon: Smartphone },
      { to: '/pos/expenses', label: 'My Spending', icon: Receipt, perm: MONEY_PERMS },
      // My Loans shows for everyone with My Money by default (no Settings switch): an empty screen is harmless and loans are common.
      { to: '/pos/loans', label: 'My Loans', icon: Coins, perm: MONEY_PERMS },
      { to: '/pos/reports', label: 'My Reports', icon: BarChart3, perm: MONEY_PERMS },
      { to: '/pos/report-centre', label: 'Printable Reports', icon: Printer, perm: REPORT_VIEW_PERMS },
      { to: '/pos/budgets', label: 'Targets & Budget', icon: Target, perm: BUDGET_VIEW_PERMS },
      { to: '/pos/financials', label: 'Financial Statements', icon: FileBarChart, perm: MONEY_PERMS },
      { to: '/pos/equipment', label: 'My Equipment', icon: HardHat, perm: MONEY_PERMS },
    ],
  },
  {
    key: 'people', perm: PEOPLE_PERMS, label: 'Customers', icon: UserRound, to: '/pos/people',
    blurb: 'Customers, who owes you, statements',
    tab: { label: 'People' },
    children: [
      { to: '/pos/customers', label: 'Customers', icon: UserRound },
      { to: '/pos/folios', label: 'Customer Folios', icon: BookUser, capability: 'folios' },
    ],
  },
  {
    key: 'messages', perm: ['operations.use', 'sales.view'], label: 'Messages', icon: MessageSquare, to: '/pos/comms',
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
      { to: '/pos/settings', label: 'Settings', icon: Settings, perm: ['settings.manage'] },
      { to: '/pos/reversals', label: 'Sale corrections', icon: RotateCcw, perm: ['refunds.request', 'refunds.approve'] },
      { to: '/pos/reconcile', label: 'Close the day', icon: Calculator, perm: ['finance.view'] },
      { to: '/pos/staff', label: 'Staff', icon: UserCog, perm: ['@owner'] },
      { to: '/pos/hr', label: 'Staff records', icon: Briefcase, perm: ['employees.manage'] },
      { to: '/pos/payroll', label: 'Payroll', icon: Banknote, perm: ['payroll.access'] },
      { to: '/pos/control', label: 'Control report', icon: ClipboardCheck, perm: ['audit.view'] },
      { to: '/pos/audit', label: 'Audit', icon: ShieldCheck, perm: ['audit.view'] },
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
export function visibleModules(enabledCapabilities, canAny) {
  return MODULES.filter((m) => (!m.capability || enabledCapabilities.includes(m.capability)) && (!canAny || !m.perm || canAny(m.perm)));
}

/** A module's pages that are switched on (a child without a `capability` is always shown). */
export function visibleChildren(module, enabledCapabilities, canAny) {
  return (module?.children || []).filter((c) => (!c.capability || enabledCapabilities.includes(c.capability)) && (!canAny || !c.perm || canAny(c.perm)));
}

/** Route -> permission (page level). Gated in POSApp with RequirePermission; the database enforces the data. */
export const ROUTE_PERMISSIONS = {
  sell: ['sales.create'],
  'report-centre': REPORT_VIEW_PERMS, budgets: BUDGET_VIEW_PERMS,
  equipment: MONEY_PERMS,
  'room-list': OPS_PERMS, stays: OPS_PERMS, 'production-runs': OPS_PERMS, recipes: OPS_PERMS,
  units: OPS_PERMS, charges: OPS_PERMS, meters: OPS_PERMS, invoices: OPS_PERMS, maintenance: OPS_PERMS,
  services: OPS_PERMS, activities: OPS_PERMS, packages: OPS_PERMS, appointments: OPS_PERMS,
  efficiency: ['finance.view'], communication: ['operations.use', 'sales.view'], messages: ['operations.use', 'sales.view'],
  // workspace landing pages follow their module
  retail: RETAIL_PERMS, network: NETWORK_PERMS, money: MPESA_PERMS, people: PEOPLE_PERMS,
  comms: ['operations.use', 'sales.view'], rentals: OPS_PERMS, salon: OPS_PERMS, rooms: OPS_PERMS, production: OPS_PERMS,
  products: RETAIL_PERMS, inventory: RETAIL_PERMS, 'goods-receiving': RETAIL_PERMS,
  'purchase-orders': RETAIL_PERMS, suppliers: RETAIL_PERMS, payables: RETAIL_PERMS,
  cash: MONEY_PERMS, mpesa: MPESA_PERMS, expenses: MONEY_PERMS, loans: MONEY_PERMS,
  reports: MONEY_PERMS, financials: MONEY_PERMS,
  customers: PEOPLE_PERMS, folios: PEOPLE_PERMS,
  reversals: ['refunds.request', 'refunds.approve'],
  'network/find': NETWORK_FIND_PERMS, 'network/orders': NETWORK_ORDER_PERMS, 'network/suppliers': NETWORK_ORDER_PERMS, 'network/offers': ['products.manage'],
  settings: ['settings.manage'], audit: ['audit.view'], staff: ['@owner'],
  reconcile: ['finance.view'], hr: ['employees.manage'], payroll: ['payroll.access'], control: ['audit.view'],
};

/** Which bottom tab should look active for this module? Modules that live under "More" light up More. */
export function activeTabKey(moduleKey) {
  if (!moduleKey) return null;
  return MOBILE_TABS.some((t) => t.key === moduleKey) ? moduleKey : 'more';
}
