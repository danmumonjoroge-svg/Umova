// src/pos-erp/pages/POSDashboard.jsx
//
// STAGE 1A, SECTION 1-2: "Home" screen for the owner-facing "My Business"
// experience. This is a UI/composition change only — no new tables, no
// new services, no changed accounting/inventory logic. Every number here
// comes from a service that already existed and was already correct:
//   - Made today / My Profit  -> financialReportsService.getIncomeStatement()
//     (today→today). Reused rather than reimplemented — this is the same
//     revenue/COGS/netIncome math FinancialReportsPage already shows,
//     just filtered to today and relabeled for the owner.
//   - My Stock / People Who Owe Me / People I Owe
//                              -> financialReportsService.getBalanceSheet()
//     (inventoryValue / accountsReceivable / accountsPayable — already
//     "as of now" running balances, see that file's own header note).
//   - Low stock                -> useLowStock() (unchanged, was already here)
//   - Today's appointments     -> useAppointments() (unchanged, was already here)
//   - Cashier shift state      -> useCashierShifts() (unchanged, was already here)
//
// WHAT'S DELIBERATELY NOT HERE: the brief's own example (§7/§8) shows
// "due today" / "due in 3 days" attention items. receivablesService.js
// and supplierService.js both document that lb_customers /
// lb_customer_credit_transactions / lb_suppliers have no due_date column
// anywhere in this schema — only outstanding_balance (a running total).
// The brief itself says "Do not fake ageing. Use actual due dates." So
// the attention panel below surfaces balances (real) but never invents a
// due date or an "overdue" flag for customers/suppliers. Adding real due
// dates would mean a schema change (a new column + migration), which is
// a bigger, separate piece of work than this pass.

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ShoppingCart, Package, AlertTriangle, Wallet, ArrowRight, Home, CalendarClock,
  TrendingUp, Users, Receipt, MessageSquare, Truck,
} from "lucide-react";
import { usePosErpAuth } from "../auth/usePosErpAuth";
import { useCashierShifts } from "../hooks/useCashierShifts";
import { useLowStock } from "../hooks/useLowStock";
import { useUnits } from "../hooks/useProperty";
import { useAppointments } from "../hooks/useSalon";
import { financialReportsService } from "../services/financialReportsService";

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function POSDashboard() {
  const { staffName, tenant } = usePosErpAuth();
  const { activeShift, loading: shiftsLoading } = useCashierShifts();
  const { lowStock, outOfStock, loading: stockLoading } = useLowStock();
  const { units } = useUnits();
  const { appointments } = useAppointments();

  const [income, setIncome] = useState(null);
  const [balances, setBalances] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (!tenant?.id) return;
    const date = todayStr();
    Promise.all([
      financialReportsService.getIncomeStatement({ tenantId: tenant.id, fromDate: date, toDate: date }),
      financialReportsService.getBalanceSheet({ tenantId: tenant.id }),
    ])
      .then(([incomeRes, balancesRes]) => {
        setIncome(incomeRes);
        setBalances(balancesRes);
      })
      .catch((err) => {
        console.error("[POSDashboard/Home] failed to load today's numbers:", err);
        setLoadError("Some numbers couldn't be loaded right now.");
      });
  }, [tenant]);

  const lowStockCount = lowStock.length + outOfStock.length;
  const todaysAppointments = appointments.filter(
    (a) => a.appointment_date === todayStr() && ["SCHEDULED", "CONFIRMED"].includes(a.status)
  ).length;

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();

  // "What needs my attention" — only real, currently-true facts. No
  // fabricated due dates (see header note). Each item links to where the
  // owner would actually act on it.
  const attention = [];
  if (lowStockCount > 0) {
    attention.push({
      tone: "amber",
      text: `${lowStockCount} item${lowStockCount === 1 ? "" : "s"} running low on stock`,
      to: "/pos/inventory",
      action: "Check Stock",
    });
  }
  if (balances && balances.assets.accountsReceivable > 0) {
    attention.push({
      tone: "red",
      text: `People owe you ${fmt(balances.assets.accountsReceivable)} in total`,
      to: "/pos/customers",
      action: "View",
    });
  }
  if (balances && balances.liabilities.accountsPayable > 0) {
    attention.push({
      tone: "amber",
      text: `You owe suppliers ${fmt(balances.liabilities.accountsPayable)} in total`,
      to: "/pos/payables",
      action: "View",
    });
  }
  if (todaysAppointments > 0) {
    attention.push({
      tone: "blue",
      text: `${todaysAppointments} appointment${todaysAppointments === 1 ? "" : "s"} today`,
      to: "/pos/appointments",
      action: "View",
    });
  }
  if (!shiftsLoading && !activeShift) {
    attention.push({
      tone: "amber",
      text: "No cashier shift is open yet",
      to: "/pos",
      action: "Start Shift",
    });
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">
        {greeting}{staffName ? `, ${staffName}` : ""} 👋
      </h1>
      <p className="text-slate-500 text-sm mb-6">
        {tenant?.business_name || "Your business"} — here's how today looks.
      </p>

      {loadError && (
        <div className="mb-6 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2">
          {loadError}
        </div>
      )}

      <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Today</div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <MoneyCard icon={TrendingUp} label="Made Today" value={income ? fmt(income.revenue) : "…"} tone="slate" />
        <MoneyCard icon={Wallet} label="My Profit" value={income ? fmt(income.netIncome) : "…"} tone={income && income.netIncome < 0 ? "red" : "emerald"} />
        <MoneyCard icon={Package} label="My Stock" value={balances ? fmt(balances.assets.inventoryValue) : "…"} tone="slate" />
        <MoneyCard icon={Users} label="People Who Owe Me" value={balances ? fmt(balances.assets.accountsReceivable) : "…"} tone="amber" />
        <MoneyCard icon={Truck} label="People I Owe" value={balances ? fmt(balances.liabilities.accountsPayable) : "…"} tone="amber" />
        <MoneyCard
          icon={AlertTriangle}
          label="Low Stock"
          value={stockLoading ? "…" : String(lowStockCount)}
          tone={lowStockCount > 0 ? "red" : "slate"}
        />
      </div>

      {attention.length > 0 && (
        <div className="mb-8">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">What Needs My Attention</div>
          <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
            {attention.map((item, i) => (
              <Link
                key={i}
                to={item.to}
                className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition"
              >
                <div className="flex items-center gap-3">
                  <Dot tone={item.tone} />
                  <span className="text-sm text-slate-700">{item.text}</span>
                </div>
                <span className="text-xs font-semibold text-emerald-700 flex items-center gap-1 shrink-0 ml-3">
                  {item.action} <ArrowRight size={12} />
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Quick Actions</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <QuickLink to="/pos" icon={ShoppingCart} title="Sell" subtitle="Ring up a sale" />
        <QuickLink to="/pos/goods-receiving" icon={Package} title="Add Stock" subtitle="Record a new delivery" />
        <QuickLink to="/pos/expenses" icon={Receipt} title="Record Money" subtitle="Log an expense or spend" />
        <QuickLink to="/pos/inventory" icon={Package} title="Check Stock" subtitle="See what you have" />
        <QuickLink to="/pos/customers" icon={Users} title="Customers" subtitle="See who owes you" />
        <QuickLink to="/pos/suppliers" icon={Truck} title="Suppliers" subtitle="See who you owe" />
        <QuickLink to="/pos/messages" icon={MessageSquare} title="Messages" subtitle="Send a WhatsApp message" />
        {units.length > 0 && <QuickLink to="/pos/units" icon={Home} title="Units" subtitle="Manage occupancy and rent" />}
        {appointments.length > 0 && <QuickLink to="/pos/appointments" icon={CalendarClock} title="Appointments" subtitle="Book or complete a service" />}
      </div>
    </div>
  );
}

function fmt(n) {
  return `KES ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function Dot({ tone }) {
  const cls = { red: "bg-red-500", amber: "bg-amber-500", blue: "bg-blue-500", emerald: "bg-emerald-500" }[tone] || "bg-slate-400";
  return <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${cls}`} />;
}

function MoneyCard({ icon: Icon, label, value, tone }) {
  const toneClasses = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    red: "bg-red-50 text-red-700 border-red-200",
    slate: "bg-slate-50 text-slate-700 border-slate-200",
  }[tone];

  return (
    <div className={`rounded-2xl border p-4 md:p-5 ${toneClasses}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={15} />
        <span className="text-[11px] font-bold uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-xl md:text-2xl font-black break-words">{value}</div>
    </div>
  );
}

function QuickLink({ to, icon: Icon, title, subtitle }) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between bg-white border border-slate-200 rounded-2xl p-5 hover:border-emerald-300 hover:shadow-sm transition group"
    >
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-700"><Icon size={18} /></div>
        <div>
          <div className="font-semibold text-slate-800">{title}</div>
          <div className="text-xs text-slate-500">{subtitle}</div>
        </div>
      </div>
      <ArrowRight size={16} className="text-slate-300 group-hover:text-emerald-600 transition" />
    </Link>
  );
}
