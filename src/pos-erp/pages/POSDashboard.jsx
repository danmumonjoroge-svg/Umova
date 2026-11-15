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
  ShoppingCart, Package, ArrowRight, CalendarClock, ChevronRight,
  TrendingUp, TrendingDown, Users, Receipt, Truck, Building2,
  Smartphone, Printer, Target, Wallet, AlertTriangle, HandCoins,
} from "lucide-react";
import { usePermissions } from "../navigation/PermissionsContext";
import { ROUTE_PERMISSIONS } from "../navigation/navConfig";
import { mpesaService } from "../services/mpesaService";
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
  const { canAny } = usePermissions();
  const seeMoney = canAny(["finance.view", "sales.view", "balances.view"]);
  // Payments customers sent to the till that nobody has matched to a bill yet (phase43). Best effort: no table / no access = no row.
  const [mpesaWaiting, setMpesaWaiting] = useState(0);
  useEffect(() => {
    if (!tenant?.business_id || !canAny(["payments.record", "finance.view"])) { setMpesaWaiting(0); return; }
    mpesaService.c2bList(tenant.business_id, { status: "OPEN", limit: 50 }).then((r) => setMpesaWaiting(r.length)).catch(() => setMpesaWaiting(0));
  }, [tenant?.business_id]); // eslint-disable-line react-hooks/exhaustive-deps

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
  if (mpesaWaiting > 0) {
    attention.push({
      tone: "red",
      text: `${mpesaWaiting} M-Pesa payment${mpesaWaiting === 1 ? "" : "s"} waiting to be matched to a bill`,
      to: "/pos/mpesa",
      action: "Clear bills",
    });
  }
  if (lowStockCount > 0) {
    attention.push({
      tone: "amber",
      text: `${lowStockCount} item${lowStockCount === 1 ? "" : "s"} running low on stock`,
      to: "/pos/inventory",
      action: "Check Stock",
    });
  }
  if (seeMoney && balances && balances.assets.accountsReceivable > 0) {
    attention.push({
      tone: "red",
      text: `${peopleCounts ? `${peopleCounts.customersOwing} ${peopleCounts.customersOwing === 1 ? "person owes" : "people owe"} you` : "People owe you"} ${fmt(balances.assets.accountsReceivable)} in total`,
      to: "/pos/customers",
      action: "View",
    });
  }
  if (seeMoney && balances && balances.liabilities.accountsPayable > 0) {
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

  // Shortcuts: only what this person is allowed to open (same keys as the menu), so a cashier never sees a dead button.
  const allowed = (route) => canAny(ROUTE_PERMISSIONS[route]);
  const shortcuts = [
    allowed("sell") && { to: "/pos", icon: ShoppingCart, title: "Sell", color: "#1F6B45" },
    retailOn && allowed("goods-receiving") && { to: "/pos/goods-receiving", icon: Truck, title: "Receive", color: "#2A7357" },
    allowed("expenses") && { to: "/pos/expenses", icon: Receipt, title: "Spending", color: "#B8921C" },
    allowed("mpesa") && { to: "/pos/mpesa", icon: Smartphone, title: "M-Pesa", color: "#3E8A5A", badge: mpesaWaiting },
    allowed("customers") && { to: "/pos/customers", icon: Users, title: "Customers", color: "#5E8F3E" },
    retailOn && allowed("inventory") && { to: "/pos/inventory", icon: Package, title: "Stock", color: "#17553A" },
    allowed("budgets") && { to: "/pos/budgets", icon: Target, title: "Budget", color: "#8A6A12" },
    allowed("report-centre") && { to: "/pos/report-centre", icon: Printer, title: "Reports", color: "#9C7A1B" },
    salonOn && allowed("appointments") && { to: "/pos/appointments", icon: CalendarClock, title: "Bookings", color: "#C2A02E" },
    rentalsOn && units.length > 0 && allowed("units") && { to: "/pos/units", icon: Building2, title: "Rentals", color: "#5E8F3E" },
  ].filter(Boolean);

  const dateLine = new Date().toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long" });
  const weekTotal = weekTrend ? weekTrend.reduce((a, v) => a + v, 0) : null;

  return (
    <div className="px-3.5 py-3.5 sm:p-6 lg:p-8 max-w-4xl mx-auto min-w-0">
      {/* Hero: greeting + today's money + the week at a glance, on one dark card */}
      <div className="rounded-3xl bg-[#17553A] text-white p-4 sm:p-5 mb-4 relative overflow-hidden">
        <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-[#C9A227]/15" aria-hidden="true" />
        <div className="absolute -right-2 top-16 w-20 h-20 rounded-full bg-white/5" aria-hidden="true" />
        <div className="relative">
          <div className="text-[12px] text-white/70">{dateLine}</div>
          <h1 className="text-xl font-bold leading-tight">{greeting}{staffName ? `, ${staffName.split(" ")[0]}` : ""}</h1>
          <div className="text-[12.5px] text-white/70 truncate">{tenant?.business_name || "Your business"}</div>

          {seeMoney ? (
            <>
              <div className="flex items-end justify-between gap-3 mt-4">
                <div className="min-w-0">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[#E8C65A]">Made today</div>
                  <div className="text-[32px] leading-none font-extrabold mt-1 break-words">{income ? fmt(income.revenue) : "…"}</div>
                </div>
                {vsYesterday != null && <ChangeBadge pct={vsYesterday} />}
              </div>
              <div className="grid grid-cols-2 gap-2.5 mt-4">
                <div className="rounded-2xl bg-white/10 px-3 py-2">
                  <div className="text-[10.5px] uppercase tracking-wide text-white/70">Profit</div>
                  <div className={`text-[15px] font-bold ${income && income.netIncome < 0 ? "text-red-200" : ""}`}>{income ? fmt(income.netIncome) : "…"}</div>
                </div>
                <div className="rounded-2xl bg-white/10 px-3 py-2">
                  <div className="text-[10.5px] uppercase tracking-wide text-white/70">Spent</div>
                  <div className="text-[15px] font-bold">{income ? fmt(income.totalExpenses) : "…"}</div>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-white/15">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-white/70">This week</div>
                  <div className="text-[12.5px] font-bold">{weekTotal != null ? fmt(weekTotal) : "…"}</div>
                </div>
                {weekTrend ? <WeekTrend values={weekTrend} /> : <div className="h-16 flex items-center justify-center text-white/60 text-sm">Loading…</div>}
              </div>
            </>
          ) : (
            <div className="mt-4 rounded-2xl bg-white/10 px-4 py-3 text-[13px] text-white/90">
              {activeShift ? "Your shift is open. Ready to sell." : "Start your shift from the Sell screen."}
            </div>
          )}
        </div>
      </div>

      {loadError && (
        <div className="mb-3 text-xs text-[#7a5f1f] bg-[#C9A227]/15 border border-[#C9A227]/40 rounded-xl px-3 py-2">{loadError}</div>
      )}

      {/* Shortcuts: round buttons, what you do most */}
      <div className="grid grid-cols-4 sm:grid-cols-5 gap-x-2 gap-y-3 mb-5">
        {shortcuts.map((q) => <Shortcut key={q.title} {...q} />)}
      </div>

      {/* What needs me */}
      <SectionLabel>Needs your attention</SectionLabel>
      {attention.length > 0 ? (
        <div className="bg-white border border-[#E3DBB8] rounded-2xl divide-y divide-[#EFE9CD] overflow-hidden mb-5">
          {attention.map((item, i) => (
            <Link key={i} to={item.to} className="flex items-center justify-between gap-3 px-4 py-3 min-h-[52px] hover:bg-[#FAF7EA] active:bg-[#FAF7EA]">
              <div className="flex items-center gap-3 min-w-0">
                <Dot tone={item.tone} />
                <span className="text-[13.5px] text-[#23382B] leading-snug">{item.text}</span>
              </div>
              <span className="text-xs font-bold text-[#1F6B45] flex items-center gap-1 shrink-0">{item.action} <ArrowRight size={12} /></span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="bg-[#EEF5E8] border border-[#CFE0C3] rounded-2xl px-4 py-3.5 text-[13.5px] text-[#1B5138] mb-5">All clear. Nothing needs you right now.</div>
      )}

      {/* Where things stand: coloured tiles */}
      {seeMoney && (
        <>
          <SectionLabel>Where things stand</SectionLabel>
          <div className="grid grid-cols-2 gap-2.5 mb-2">
            {retailOn && <StandTile to="/pos/inventory" icon={Package} label="My stock" value={balances ? fmt(balances.assets.inventoryValue) : "…"} sub={lowStockCount > 0 ? `${lowStockCount} running low` : stockLoading ? null : "All stocked up"} warn={lowStockCount > 0} color="#1F6B45" />}
            <StandTile to="/pos/customers" icon={HandCoins} label="Owed to me" value={balances ? fmt(balances.assets.accountsReceivable) : "…"} sub={peopleCounts ? `${peopleCounts.customersOwing} of ${peopleCounts.totalCustomers} customers` : null} color="#B8921C" />
            {retailOn && <StandTile to="/pos/payables" icon={Wallet} label="I owe" value={balances ? fmt(balances.liabilities.accountsPayable) : "…"} sub={peopleCounts ? `${peopleCounts.suppliersOwed} of ${peopleCounts.totalSuppliers} suppliers` : null} color="#9C7A1B" />}
            {rentalsOn && units.length > 0 && <StandTile to="/pos/units" icon={Building2} label="Rented units" value={`${occupiedUnits} of ${units.length}`} color="#5E8F3E" />}
          </div>
        </>
      )}
    </div>
  );
}

function fmt(n) {
  return `KES ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function SectionLabel({ children }) {
  return <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[#6F7461] mb-2 px-0.5"><span className="w-1 h-3.5 rounded-full bg-[#C9A227]" />{children}</div>;
}

function Dot({ tone }) {
  const cls = { red: "bg-[#D9534F]", amber: "bg-[#C9A227]", blue: "bg-[#1F6B45]", emerald: "bg-[#1F6B45]" }[tone] || "bg-[#6F7461]";
  return <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${cls}`} />;
}

// Real percentage only -- never shown when there's genuinely nothing honest to compare against.
function ChangeBadge({ pct }) {
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`shrink-0 inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-full ${up ? "bg-[#E8C65A] text-[#3B2F06]" : "bg-red-100 text-red-700"}`}>
      <Icon size={13} /> {up ? "+" : ""}{pct}% <span className="font-medium opacity-80 hidden min-[380px]:inline">vs yesterday</span>
    </span>
  );
}

function Shortcut({ to, icon: Icon, title, color, badge }) {
  return (
    <Link to={to} className="flex flex-col items-center gap-1.5 min-w-0 active:scale-95 transition-transform">
      <span className="relative w-14 h-14 rounded-2xl flex items-center justify-center bg-white border border-[#E3DBB8] shadow-sm" style={{ color }}>
        <span className="absolute inset-0 rounded-2xl" style={{ background: `${color}14` }} />
        <Icon size={24} className="relative" />
        {badge > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded-full bg-[#D9534F] text-white text-[10.5px] font-bold flex items-center justify-center">{badge > 9 ? "9+" : badge}</span>}
      </span>
      <span className="text-[11.5px] font-semibold text-[#23382B] truncate max-w-full">{title}</span>
    </Link>
  );
}

function StandTile({ to, icon: Icon, label, value, sub, warn, color }) {
  return (
    <Link to={to} className="rounded-2xl bg-white border border-[#E3DBB8] p-3 min-w-0 hover:border-[#C9A227] active:bg-[#FAF7EA] transition-colors" style={{ borderTop: `3px solid ${color}` }}>
      <div className="flex items-center justify-between">
        <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}1F`, color }}><Icon size={16} /></span>
        <ChevronRight size={15} className="text-[#B9B28A]" />
      </div>
      <div className="text-[11px] font-bold uppercase tracking-wide text-[#6F7461] mt-2">{label}</div>
      <div className="text-[16px] font-extrabold text-[#23382B] leading-tight break-words">{value}</div>
      {sub && <div className={`text-[11px] mt-0.5 flex items-center gap-1 ${warn ? "text-[#7a5f1f] font-semibold" : "text-[#6F7461]"}`}>{warn && <AlertTriangle size={11} />}{sub}</div>}
    </Link>
  );
}

// Plain CSS bars for the 7 days; today is gold, the best day gets a small crown line. Scaled to the week's own max.
function WeekTrend({ values }) {
  const max = Math.max(...values, 1);
  const best = values.indexOf(Math.max(...values));
  const labels = [6, 5, 4, 3, 2, 1, 0].map((n) => {
    const d = new Date(); d.setDate(d.getDate() - n);
    return d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2);
  });
  return (
    <div className="flex items-end justify-between gap-2 h-[84px] mt-1">
      {values.map((v, i) => {
        const isToday = i === values.length - 1;
        const heightPct = Math.max((v / max) * 100, v > 0 ? 8 : 3);
        return (
          <div key={i} className="flex-1 flex flex-col items-center justify-end h-full min-w-0">
            <div className="w-full flex items-end justify-center h-full">
              <div
                className={`w-full max-w-[26px] rounded-t-md ${isToday ? "bg-[#E8C65A]" : v > 0 ? "bg-white/45" : "bg-white/15"}`}
                style={{ height: `${heightPct}%`, outline: v > 0 && i === best && !isToday ? "1.5px solid #E8C65A" : "none" }}
                title={fmt(v)}
              />
            </div>
            <div className={`text-[10px] mt-1 font-semibold ${isToday ? "text-[#E8C65A]" : "text-white/60"}`}>{labels[i]}</div>
          </div>
        );
      })}
    </div>
  );
}
