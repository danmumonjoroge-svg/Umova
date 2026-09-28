// src/pos-erp/pages/POSDashboard.jsx
//
// "Home" -- the owner's command centre (My Business redesign, brief §8).
// Laid out to answer three questions in order: 1. What happened today?
// 2. What needs my attention? 3. What can I do quickly? Everything else
// (stock value, who owes what, counts) is a quiet list underneath rather
// than a wall of big number cards. Data loading below is UNCHANGED from
// the previous version -- only the presentation was redesigned.
//
// (previous note) Owner-facing "My Business" experience. Enhanced pass: added a performance snapshot (today vs
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
  ShoppingCart, Package, ArrowRight, CalendarClock,
  TrendingUp, TrendingDown, Users, Receipt, Truck, Building2,
} from "lucide-react";
import { useCapabilities } from "../navigation/CapabilitiesContext";
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
  const { enabled: enabledCaps } = useCapabilities();
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

  const retailOn = enabledCaps.includes("retail");
  const rentalsOn = enabledCaps.includes("rentals");
  const salonOn = enabledCaps.includes("salon");

  const quick = [
    { to: "/pos", icon: ShoppingCart, title: "Sell", subtitle: "Ring up a sale", primary: true },
    retailOn && { to: "/pos/goods-receiving", icon: Truck, title: "Receive stock", subtitle: "Record a delivery" },
    { to: "/pos/expenses", icon: Receipt, title: "Record spending", subtitle: "Log what you spent" },
    { to: "/pos/customers", icon: Users, title: "Customers", subtitle: "See who owes you" },
    retailOn && { to: "/pos/inventory", icon: Package, title: "Check stock", subtitle: "See what you have" },
    salonOn && { to: "/pos/appointments", icon: CalendarClock, title: "Appointments", subtitle: "Book or complete a service" },
    rentalsOn && units.length > 0 && { to: "/pos/units", icon: Building2, title: "Rentals", subtitle: "Units and rent" },
  ].filter(Boolean);

  return (
    <div className="px-4 py-4 sm:p-6 lg:p-8 max-w-4xl mx-auto min-w-0">
      <div className="mb-4">
        <h1 className="text-xl md:text-2xl font-bold text-[#26352D]">
          {greeting}{staffName ? `, ${staffName}` : ""}
        </h1>
        <p className="text-sm text-[#68756D]">{tenant?.business_name || "Your business"}</p>
      </div>

      {loadError && (
        <div className="mb-4 text-xs text-[#7a5f1f] bg-[#C6A15B]/15 border border-[#C6A15B]/40 rounded-lg px-3 py-2">{loadError}</div>
      )}

      {/* 1. What happened today? */}
      <div className="bg-[#1B5138] text-white rounded-xl p-4 sm:p-5 mb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider text-white/70">Made today</div>
            <div className="text-3xl font-bold mt-0.5 break-words">{income ? fmt(income.revenue) : "…"}</div>
          </div>
          {vsYesterday != null && <ChangeBadge pct={vsYesterday} />}
        </div>
        <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t border-white/15">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-white/70">My profit</div>
            <div className={`text-lg font-bold ${income && income.netIncome < 0 ? "text-red-200" : ""}`}>{income ? fmt(income.netIncome) : "…"}</div>
          </div>
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-white/70">Spent today</div>
            <div className="text-lg font-bold">{income ? fmt(income.totalExpenses) : "…"}</div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-[#DDE3DD] rounded-xl p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-[#68756D]">This week</div>
          <div className="text-sm font-bold text-[#26352D]">
            {weekTrend ? fmt(weekTrend.reduce((a, v) => a + v, 0)) : "…"} <span className="text-[#68756D] font-normal text-xs">total</span>
          </div>
        </div>
        {weekTrend ? <WeekTrend values={weekTrend} /> : <div className="h-16 flex items-center justify-center text-[#68756D] text-sm">Loading…</div>}
      </div>

      {/* 2. What needs my attention? */}
      <div className="mb-6">
        <div className="text-[11px] font-bold uppercase tracking-wider text-[#68756D] mb-2">Needs your attention</div>
        {attention.length > 0 ? (
          <div className="bg-white border border-[#DDE3DD] rounded-xl divide-y divide-[#DDE3DD] overflow-hidden">
            {attention.map((item, i) => (
              <Link key={i} to={item.to} className="flex items-center justify-between gap-3 px-4 py-3 min-h-[52px] hover:bg-[#F7F6F0] active:bg-[#F7F6F0]">
                <div className="flex items-center gap-3 min-w-0">
                  <Dot tone={item.tone} />
                  <span className="text-sm text-[#26352D]">{item.text}</span>
                </div>
                <span className="text-xs font-semibold text-[#237A52] flex items-center gap-1 shrink-0">{item.action} <ArrowRight size={12} /></span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="bg-white border border-[#DDE3DD] rounded-xl px-4 py-4 text-sm text-[#68756D]">Nothing needs you right now.</div>
        )}
      </div>

      {/* 3. What can I do quickly? */}
      <div className="text-[11px] font-bold uppercase tracking-wider text-[#68756D] mb-2">Quick actions</div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {quick.map((q) => <QuickTile key={q.title} {...q} />)}
      </div>

      {/* Where things stand -- a quiet list, not a wall of KPI cards */}
      <div className="text-[11px] font-bold uppercase tracking-wider text-[#68756D] mb-2">Where things stand</div>
      <div className="bg-white border border-[#DDE3DD] rounded-xl divide-y divide-[#DDE3DD] overflow-hidden">
        {retailOn && <StandRow to="/pos/inventory" icon={Package} label="My stock" value={balances ? fmt(balances.assets.inventoryValue) : "…"} sub={lowStockCount > 0 ? `${lowStockCount} running low` : stockLoading ? null : "All stocked up"} subTone={lowStockCount > 0 ? "warn" : null} />}
        <StandRow to="/pos/customers" icon={Users} label="People who owe me" value={balances ? fmt(balances.assets.accountsReceivable) : "…"} sub={peopleCounts ? `${peopleCounts.customersOwing} of ${peopleCounts.totalCustomers} customers` : null} />
        {retailOn && <StandRow to="/pos/payables" icon={Truck} label="People I owe" value={balances ? fmt(balances.liabilities.accountsPayable) : "…"} sub={peopleCounts ? `${peopleCounts.suppliersOwed} of ${peopleCounts.totalSuppliers} suppliers` : null} />}
        {rentalsOn && units.length > 0 && <StandRow to="/pos/units" icon={Building2} label="Rented units" value={`${occupiedUnits} of ${units.length}`} />}
      </div>
    </div>
  );
}

function fmt(n) {
  return `KES ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function Dot({ tone }) {
  const cls = { red: "bg-red-500", amber: "bg-[#C6A15B]", blue: "bg-[#237A52]", emerald: "bg-[#237A52]" }[tone] || "bg-[#68756D]";
  return <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${cls}`} />;
}

// Real percentage only -- never shown when there's genuinely nothing
// honest to compare against (yesterday being 0 isn't "+infinity %").
function ChangeBadge({ pct }) {
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`shrink-0 inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${up ? "bg-white/15 text-white" : "bg-red-100 text-red-700"}`}>
      <Icon size={12} /> {up ? "+" : ""}{pct}% <span className="font-medium opacity-80 hidden sm:inline">vs yesterday</span>
    </span>
  );
}

function QuickTile({ to, icon: Icon, title, subtitle, primary }) {
  return (
    <Link
      to={to}
      className={`flex flex-col gap-2 rounded-xl p-4 min-h-[88px] border transition-colors min-w-0 ${
        primary ? "bg-[#237A52] border-[#237A52] text-white hover:bg-[#1B5138]" : "bg-white border-[#DDE3DD] text-[#26352D] hover:border-[#237A52]"
      }`}
    >
      <Icon size={22} className={primary ? "text-[#C6A15B]" : "text-[#237A52]"} />
      <div className="min-w-0">
        <div className="font-semibold truncate">{title}</div>
        <div className={`text-xs truncate ${primary ? "text-white/75" : "text-[#68756D]"}`}>{subtitle}</div>
      </div>
    </Link>
  );
}

function StandRow({ to, icon: Icon, label, value, sub, subTone }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-3 min-h-[56px] hover:bg-[#F7F6F0] active:bg-[#F7F6F0]">
      <div className="w-9 h-9 rounded-lg bg-[#237A52]/10 text-[#237A52] flex items-center justify-center shrink-0"><Icon size={17} /></div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[#26352D]">{label}</div>
        {sub && <div className={`text-xs ${subTone === "warn" ? "text-[#7a5f1f] font-semibold" : "text-[#68756D]"}`}>{sub}</div>}
      </div>
      <div className="text-sm font-bold text-[#26352D] shrink-0">{value}</div>
    </Link>
  );
}

// Plain CSS bar strip -- 7 values, tallest bar scaled to the row's own
// max (not a fixed scale), so a slow week and a busy week both render
// legibly instead of one flattening the other out.
function WeekTrend({ values }) {
  const max = Math.max(...values, 1); // avoid divide-by-zero on an all-zero week
  const labels = [6, 5, 4, 3, 2, 1, 0].map((n) => {
    const d = new Date(); d.setDate(d.getDate() - n);
    return d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2);
  });
  return (
    <div className="flex items-end justify-between gap-2 h-20">
      {values.map((v, i) => {
        const isToday = i === values.length - 1;
        const heightPct = Math.max((v / max) * 100, v > 0 ? 6 : 2); // a real but tiny value still shows a sliver
        return (
          <div key={i} className="flex-1 flex flex-col items-center justify-end h-full min-w-0">
            <div className="w-full flex items-end justify-center h-full">
              <div
                className={`w-full max-w-[28px] rounded-t ${isToday ? "bg-[#237A52]" : "bg-[#DDE3DD]"}`}
                style={{ height: `${heightPct}%` }}
                title={fmt(v)}
              />
            </div>
            <div className={`text-[10px] mt-1 font-semibold ${isToday ? "text-[#237A52]" : "text-[#68756D]"}`}>{labels[i]}</div>
          </div>
        );
      })}
    </div>
  );
}
