// src/pos-erp/pages/POSDashboard.jsx
//
// STAGE 1A, SECTION 1-2: "Home" screen for the owner-facing "My Business"
// experience. Enhanced pass: added a performance snapshot (today vs
// yesterday, a 7-day trend) and a "People & Activity" count row
// (customers, suppliers, who-owes-you counts, appointments, rental
// tenants) — everything the owner previously had to click into a
// separate page to see even a headline number for.
//
// EVERY NUMBER HERE STILL COMES FROM AN EXISTING, ALREADY-CORRECT
// SOURCE. Nothing below recomputes a total a service already owns —
// this file only asks for MORE of what those services already expose
// (a count alongside a sum, a week of daily totals alongside today's):
//   - Made today / My Profit / vs yesterday / 7-day trend
//                              -> financialReportsService.getIncomeStatement()
//                                 (today, unchanged) + reportsService.getDailySummary()
//                                 (one call per day, for yesterday + the trend —
//                                 reportsService already computes total_sales
//                                 per day for the daily-closing flow; reused
//                                 here rather than reimplemented)
//   - My Stock / People Who Owe Me / People I Owe
//                              -> financialReportsService.getBalanceSheet() (unchanged)
//   - Customers who owe / Suppliers you owe (COUNTS)
//                              -> customerService.getWithOutstandingBalances() /
//                                 supplierService.getWithOutstandingBalances()
//                                 (both already existed for other pages —
//                                 supplierService's was already live; a
//                                 customerService equivalent was added
//                                 this pass, mirroring it exactly, since
//                                 no count-of-debtors query existed yet)
//   - Total customers / suppliers -> customerService.getAll()/supplierService.getAll()'s
//                                 own `count` (Supabase's exact count on
//                                 the query, not a second fetch-everything)
//   - Low stock                -> useLowStock() (unchanged)
//   - Today's appointments     -> useAppointments() (unchanged)
//   - Active tenants           -> useUnits() (unchanged) filtered to
//                                 status === 'OCCUPIED' — a property
//                                 "tenant" IS the customer assigned to an
//                                 occupied unit (see propertyService.js's
//                                 own header note); there is no separate
//                                 tenants table to query
//   - Cashier shift state      -> useCashierShifts() (unchanged)
//
// WHAT'S STILL DELIBERATELY NOT HERE: fabricated due dates / "overdue"
// flags. Same reasoning as before — no due_date column exists anywhere
// in this schema for customers or suppliers, and the brief is explicit:
// "Do not fake ageing. Use actual due dates." The attention panel and
// the new count rows surface real balances and real counts, never an
// invented date.

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ShoppingCart, Package, AlertTriangle, Wallet, ArrowRight, Home, CalendarClock,
  TrendingUp, TrendingDown, Users, Receipt, MessageSquare, Truck, UserRound, Building2,
} from "lucide-react";
import { usePosErpAuth } from "../auth/usePosErpAuth";
import { useCashierShifts } from "../hooks/useCashierShifts";
import { useLowStock } from "../hooks/useLowStock";
import { useUnits } from "../hooks/useProperty";
import { useAppointments } from "../hooks/useSalon";
import { financialReportsService } from "../services/financialReportsService";
import { reportsService } from "../services/reportsService";
import { customerService } from "../services/customerService";
import { supplierService } from "../services/supplierService";

const todayStr = () => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

export default function POSDashboard() {
  const { staffName, tenant } = usePosErpAuth();
  const { activeShift, loading: shiftsLoading } = useCashierShifts();
  const { lowStock, outOfStock, loading: stockLoading } = useLowStock();
  const { units } = useUnits();
  const { appointments } = useAppointments();

  const [income, setIncome] = useState(null);
  const [balances, setBalances] = useState(null);
  // Performance: last 7 days' total_sales, oldest first, today last —
  // one array does double duty as both the trend strip and the source
  // for "vs yesterday" (its second-to-last entry).
  const [weekTrend, setWeekTrend] = useState(null);
  const [peopleCounts, setPeopleCounts] = useState(null); // { totalCustomers, customersOwing, totalSuppliers, suppliersOwed }
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (!tenant?.id) return;
    const date = todayStr();

    Promise.all([
      financialReportsService.getIncomeStatement({ tenantId: tenant.id, fromDate: date, toDate: date }),
      financialReportsService.getBalanceSheet({ tenantId: tenant.id }),
      // 7 lightweight per-day summaries (today + the 6 before it) rather
      // than one heavier range query — reportsService.getDailySummary()
      // is the function the daily-closing flow already trusts for a
      // single day's total_sales, so the trend is built from exactly
      // the same source a closed day's own figure would show, not a
      // second calculation that could disagree with it later.
      Promise.all([0, 1, 2, 3, 4, 5, 6].map((n) => reportsService.getDailySummary({ tenantId: tenant.id, date: isoDaysAgo(n) }))),
      customerService.getAll({ activeOnly: true, limit: 1 }),
      customerService.getWithOutstandingBalances(),
      supplierService.getAll({ activeOnly: true, limit: 1 }),
      supplierService.getWithOutstandingBalances(),
    ])
      .then(([incomeRes, balancesRes, dailySummaries, customersRes, customersOwing, suppliersRes, suppliersOwed]) => {
        setIncome(incomeRes);
        setBalances(balancesRes);
        setWeekTrend(dailySummaries.map((d) => Number(d.total_sales || 0)).reverse()); // oldest -> today
        setPeopleCounts({
          totalCustomers: customersRes.count || 0,
          customersOwing: customersOwing.length,
          totalSuppliers: suppliersRes.count || 0,
          suppliersOwed: suppliersOwed.length,
        });
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
  const occupiedUnits = units.filter((u) => u.status === "OCCUPIED").length;

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();

  // vs yesterday — only shown when yesterday actually had a number to
  // compare against. Yesterday being exactly 0 isn't "infinite percent
  // better," it's "nothing to compare to" — shown as such, not as a
  // fabricated headline percentage.
  const todaySales = weekTrend ? weekTrend[6] : null;
  const yesterdaySales = weekTrend ? weekTrend[5] : null;
  const vsYesterday = todaySales != null && yesterdaySales
    ? Math.round(((todaySales - yesterdaySales) / yesterdaySales) * 100)
    : null;

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
      text: `${peopleCounts ? `${peopleCounts.customersOwing} ${peopleCounts.customersOwing === 1 ? "person owes" : "people owe"} you` : "People owe you"} ${fmt(balances.assets.accountsReceivable)} in total`,
      to: "/pos/customers",
      action: "View",
    });
  }
  if (balances && balances.liabilities.accountsPayable > 0) {
    attention.push({
      tone: "amber",
      text: `You owe ${peopleCounts ? `${peopleCounts.suppliersOwed} supplier${peopleCounts.suppliersOwed === 1 ? "" : "s"}` : "suppliers"} ${fmt(balances.liabilities.accountsPayable)} in total`,
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
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <MoneyCard
          icon={TrendingUp}
          label="Made Today"
          value={income ? fmt(income.revenue) : "…"}
          tone="slate"
          badge={vsYesterday != null ? <ChangeBadge pct={vsYesterday} /> : null}
        />
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

      {/* Performance — a 7-day glance, not a full report. Bars are plain
          CSS (no charting library), matching the rest of this app's
          dependency-light style. Each day's total_sales comes from the
          same reportsService function the daily-closing flow trusts, so
          this can never quietly disagree with a day once it's closed. */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">This Week's Performance</div>
          <div className="text-sm font-bold text-slate-700">
            {weekTrend ? fmt(weekTrend.reduce((s, v) => s + v, 0)) : "…"} <span className="text-slate-400 font-normal text-xs">total</span>
          </div>
        </div>
        {weekTrend ? <WeekTrend values={weekTrend} /> : <div className="h-24 flex items-center justify-center text-slate-300 text-sm">Loading…</div>}
      </div>

      {/* People & Activity — counts an owner previously had to open a
          separate page to even glimpse. Every figure is a genuine count
          from the service that owns it (see the header note table),
          never derived from a total that was built for a different
          purpose. */}
      <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">People &amp; Activity</div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <StatCard icon={UserRound} label="Customers" value={peopleCounts ? String(peopleCounts.totalCustomers) : "…"} sub={peopleCounts ? `${peopleCounts.customersOwing} owe you` : null} to="/pos/customers" />
        <StatCard icon={Truck} label="Suppliers" value={peopleCounts ? String(peopleCounts.totalSuppliers) : "…"} sub={peopleCounts ? `${peopleCounts.suppliersOwed} you owe` : null} to="/pos/suppliers" />
        <StatCard icon={CalendarClock} label="Appointments Today" value={String(todaysAppointments)} to="/pos/appointments" />
        {units.length > 0 && (
          <StatCard icon={Building2} label="Active Tenants" value={String(occupiedUnits)} sub={`of ${units.length} units`} to="/pos/units" />
        )}
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

// Real percentage only — never shown when there's genuinely nothing
// honest to compare against (yesterday being 0 isn't "+∞%").
function ChangeBadge({ pct }) {
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded-full ${up ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
      <Icon size={10} /> {up ? "+" : ""}{pct}%
    </span>
  );
}

function MoneyCard({ icon: Icon, label, value, tone, badge }) {
  const toneClasses = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    red: "bg-red-50 text-red-700 border-red-200",
    slate: "bg-slate-50 text-slate-700 border-slate-200",
  }[tone];

  return (
    <div className={`rounded-2xl border p-4 md:p-5 ${toneClasses}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Icon size={15} />
          <span className="text-[11px] font-bold uppercase tracking-wide">{label}</span>
        </div>
        {badge}
      </div>
      <div className="text-xl md:text-2xl font-black break-words">{value}</div>
    </div>
  );
}

// A count-focused sibling to MoneyCard — same visual weight, but for
// "how many" rather than "how much", with an optional one-line
// sub-detail (e.g. "3 owe you") instead of a percentage badge.
function StatCard({ icon: Icon, label, value, sub, to }) {
  const content = (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 hover:border-emerald-300 hover:shadow-sm transition h-full">
      <div className="flex items-center gap-2 mb-2 text-slate-500">
        <Icon size={15} />
        <span className="text-[11px] font-bold uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-xl md:text-2xl font-black text-slate-800">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
  return to ? <Link to={to}>{content}</Link> : content;
}

// Plain CSS bar strip — 7 values, tallest bar scaled to the row's own
// max (not a fixed scale), so a slow week and a busy week both render
// legibly instead of one flattening the other out.
function WeekTrend({ values }) {
  const max = Math.max(...values, 1); // avoid divide-by-zero on an all-zero week
  const labels = [6, 5, 4, 3, 2, 1, 0].map((n) => {
    const d = new Date(); d.setDate(d.getDate() - n);
    return d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2);
  });
  return (
    <div className="flex items-end justify-between gap-2 h-24">
      {values.map((v, i) => {
        const isToday = i === values.length - 1;
        const heightPct = Math.max((v / max) * 100, v > 0 ? 6 : 2); // a real but tiny value still shows a sliver, not nothing
        return (
          <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
            <div className="w-full flex items-end justify-center h-full">
              <div
                className={`w-full max-w-[28px] rounded-t-md ${isToday ? "bg-emerald-600" : "bg-slate-200"}`}
                style={{ height: `${heightPct}%` }}
                title={fmt(v)}
              />
            </div>
            <div className={`text-[10px] mt-1.5 font-semibold ${isToday ? "text-emerald-700" : "text-slate-400"}`}>{labels[i]}</div>
          </div>
        );
      })}
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
