import {
  Home, Users, CreditCard, FileText, BarChart3, Settings as SettingsIcon,
  DollarSign, BookOpen, TrendingUp, Activity, Store, Building2, ClipboardList,
  Lock, Package, Wallet, Landmark, MoreHorizontal,
} from "lucide-react";

// Single source of truth for Admin navigation. Every `to` is an existing
// route under /admin (see App.js). Modules with `children` also get a
// workspace page at /admin/hub/<key> that shows those children as cards.

export const APPROVER_ROLES = ["admin", "superadmin", "manager"];

export const NAV = [
  { key: "dashboard", label: "Dashboard", icon: Home, to: "dashboard" },
  {
    key: "money", label: "Money", icon: Wallet, blurb: "Receive, pay out and manage cash",
    children: [
      { label: "Payments", to: "payments", icon: DollarSign, desc: "Receive member payments" },
      { label: "Withdrawals", to: "withdrawal", icon: CreditCard, desc: "Pay out member funds" },
      { label: "Cash & Bank", to: "cash-bank", icon: Building2, desc: "Balances and transfers" },
      { label: "Accounts Payable", to: "accounts-payable", icon: ClipboardList, desc: "Bills you owe" },
      { label: "Accounts Receivable", to: "accounts-receivable", icon: FileText, desc: "Money owed to you" },
      { label: "Fixed Assets", to: "fixed-assets", icon: Package, desc: "Assets and depreciation" },
    ],
  },
  {
    key: "loans", label: "Loans", icon: CreditCard, blurb: "From application to repayment",
    children: [
      { label: "Loan Portfolio", to: "loans", icon: BarChart3, desc: "All loans at a glance" },
      { label: "Applications", to: "loan-application", icon: FileText, desc: "New and pending requests" },
      { label: "Approval", to: "loan-approval", icon: ClipboardList, desc: "Review and decide" },
      { label: "Disbursement", to: "loan-disbursement", icon: DollarSign, desc: "Release approved loans" },
      { label: "Repayments", to: "loan-repayments", icon: Wallet, desc: "Record loan payments" },
      { label: "Loan Schedule", to: "loan-schedule", icon: BookOpen, desc: "Instalments and dates" },
      { label: "Penalties", to: "loan-penalties", icon: Activity, desc: "Arrears and charges" },
    ],
  },
  {
    key: "members", label: "Members", icon: Users, blurb: "Members and their statements",
    children: [
      { label: "Members", to: "members", icon: Users, desc: "Register and manage" },
      { label: "Member Statements", to: "member-statements", icon: FileText, desc: "Statements and PDFs" },
    ],
  },
  {
    key: "accounting", label: "Accounting", icon: BookOpen, blurb: "Journals and financial statements",
    children: [
      { label: "Journal", to: "journal-entry", icon: BookOpen, desc: "Post and reverse journals" },
      { label: "Trial Balance", to: "trial-balance", icon: BarChart3, desc: "Debits versus credits" },
      { label: "Income Statement", to: "income-statement", icon: TrendingUp, desc: "Income and expenses" },
      { label: "Balance Sheet", to: "balance-sheet", icon: BarChart3, desc: "Assets, liabilities, equity" },
      { label: "Accounting Periods", to: "accounting-periods", icon: Lock, desc: "Open and close periods" },
    ],
  },
  {
    key: "reports", label: "Reports", icon: BarChart3, blurb: "Reports and risk",
    children: [
      { label: "Financial Reports", to: "reports", icon: BarChart3, desc: "Standard reports" },
      { label: "ERP Overview", to: "erp-dashboard", icon: Activity, desc: "Organisation snapshot" },
      { label: "Interest Dashboard", to: "interest-dashboard", icon: TrendingUp, desc: "Interest earned" },
      { label: "Risk Engine", to: "stories", icon: Activity, desc: "Portfolio risk" },
    ],
  },
  { key: "pos", label: "POS", icon: Store, to: "pos", approverOnly: true, desc: "POS businesses and requests" },
  { key: "chama", label: "Chama", icon: Landmark, to: "chama", approverOnly: true, desc: "Chama oversight" },
  { key: "settings", label: "Settings", icon: SettingsIcon, to: "settings", desc: "System settings" },
];

// What the "More" tab lists.
export const MORE_KEYS = ["members", "accounting", "reports", "pos", "chama", "settings"];

export const MORE_MODULE = { key: "more", label: "More", icon: MoreHorizontal };

export const hubPath = (key) => `/admin/hub/${key}`;
export const adminPath = (to) => `/admin/${to}`;

export const visibleNav = (isApprover) => NAV.filter((n) => !n.approverOnly || isApprover);
export const moduleByKey = (key) => NAV.find((n) => n.key === key);

// Which module owns this pathname (null = unknown).
export function moduleForPath(pathname, nav = NAV) {
  const hub = pathname.match(/^\/admin\/hub\/([^/]+)/);
  if (hub) return hub[1] === "more" ? MORE_MODULE : nav.find((n) => n.key === hub[1]) || null;
  for (const n of nav) {
    if (n.children) {
      if (n.children.some((c) => pathname === adminPath(c.to) || pathname.startsWith(adminPath(c.to) + "/"))) return n;
    } else if (pathname === adminPath(n.to) || pathname.startsWith(adminPath(n.to) + "/")) {
      return n;
    }
  }
  return null;
}
