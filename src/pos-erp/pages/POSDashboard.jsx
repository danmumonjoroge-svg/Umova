// src/pos-erp/pages/POSDashboard.jsx
//
// FIXED: the low-stock widget filtered products on p.stock_quantity and
// p.reorder_level — neither exists on lb_products (quantity lives on
// lb_inventory, per warehouse). Replaced with useLowStock(), which reads
// lb_inventory.stock_status directly (kept correct by applyStockMovement
// on every stock-affecting write). warehouseId is omitted here — single
// warehouse per tenant, and RLS already scopes lb_inventory rows to the
// caller's tenant, so there's nothing to disambiguate for this business
// shape. If that assumption changes (a tenant with >1 warehouse), this
// needs an explicit warehouseId.

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ShoppingCart, Package, AlertTriangle, Wallet, ArrowRight, Home, CalendarClock } from "lucide-react";
import { usePosErpAuth } from "../auth/usePosErpAuth";
import { useCashierShifts } from "../hooks/useCashierShifts";
import { useProducts } from "../hooks/useProducts";
import { useLowStock } from "../hooks/useLowStock";
import { useUnits } from "../hooks/useProperty";
import { useAppointments } from "../hooks/useSalon";
import { reportsService } from "../services/reportsService";

export default function POSDashboard() {
  const { staffName, tenant } = usePosErpAuth();
  const { activeShift, loading: shiftsLoading } = useCashierShifts();
  const { products, loading: productsLoading } = useProducts();
  const { lowStock, outOfStock, loading: stockLoading } = useLowStock();
  // Capability-aware widgets (brief §56): get_pos_profile() doesn't return
  // business_type, so there's no field to branch on — instead these only
  // render when the tenant actually has units/appointments, which adapts
  // to real usage without needing a schema change to expose business_type.
  const { units } = useUnits();
  const { appointments } = useAppointments();

  const [todaySummary, setTodaySummary] = useState(null);
  useEffect(() => {
    if (!tenant?.id) return;
    reportsService.getDailySummary({ tenantId: tenant.id, date: new Date().toISOString().slice(0, 10) })
      .then(setTodaySummary)
      .catch((err) => console.error('[POSDashboard] today summary failed:', err));
  }, [tenant]);

  const lowStockCount = lowStock.length + outOfStock.length;
  const occupiedUnits = units.filter(u => u.status === 'OCCUPIED').length;
  const todaysAppointments = appointments.filter(a => a.appointment_date === new Date().toISOString().slice(0, 10) && ['SCHEDULED', 'CONFIRMED'].includes(a.status)).length;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">
        {tenant?.business_name || "POS Dashboard"}
      </h1>
      <p className="text-slate-500 text-sm mb-6">Welcome back, {staffName || "there"}.</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        <StatCard
          icon={Wallet}
          label="Cashier Shift"
          value={shiftsLoading ? "…" : activeShift ? "Open" : "Not started"}
          tone={activeShift ? "emerald" : "amber"}
          detail={activeShift ? `Opened with ${activeShift.opening_float?.toLocaleString()}` : "Start a shift on the Till to begin selling"}
        />
        <StatCard
          icon={Package}
          label="Products"
          value={productsLoading ? "…" : products.length}
          tone="slate"
          detail="Total active products"
        />
        <StatCard
          icon={AlertTriangle}
          label="Low Stock"
          value={stockLoading ? "…" : lowStockCount}
          tone={lowStockCount > 0 ? "red" : "slate"}
          detail={lowStockCount > 0 ? "Items at or below reorder level" : "Nothing low right now"}
        />
        {units.length > 0 && (
          <StatCard
            icon={Home}
            label="Units Occupied"
            value={`${occupiedUnits} / ${units.length}`}
            tone={occupiedUnits === units.length ? "emerald" : "amber"}
            detail="Property occupancy"
          />
        )}
        {appointments.length > 0 && (
          <StatCard
            icon={CalendarClock}
            label="Today's Appointments"
            value={todaysAppointments}
            tone={todaysAppointments > 0 ? "emerald" : "slate"}
            detail="Scheduled or confirmed"
          />
        )}
      </div>

      {/* FIXED: was a hardcoded "coming once sale recording is wired up"
          placeholder — saleService.js and reportsService.js are both
          fully built now (confirmed this session), so this reads the
          real number via the same getDailySummary() the Reports page uses. */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-8 flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-slate-400 uppercase">Today's Sales</div>
          <div className="text-2xl font-black text-slate-800">
            {todaySummary ? Number(todaySummary.total_sales).toLocaleString() : "…"}
          </div>
        </div>
        <Link to="/pos/reports" className="text-sm text-amber-700 font-semibold hover:underline flex items-center gap-1">
          Full report <ArrowRight size={14} />
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <QuickLink to="/pos" icon={ShoppingCart} title="Go to Till" subtitle="Ring up a sale" />
        <QuickLink to="/pos/goods-receiving" icon={Package} title="Receive Goods" subtitle="Record a new stock delivery" />
        {units.length > 0 && <QuickLink to="/pos/units" icon={Home} title="Units" subtitle="Manage occupancy and rent" />}
        {appointments.length > 0 && <QuickLink to="/pos/appointments" icon={CalendarClock} title="Appointments" subtitle="Book or complete a service" />}
      </div>

      {lowStockCount > 0 && (
        <div className="mt-8 bg-red-50 border border-red-200 rounded-2xl p-5">
          <h3 className="font-bold text-red-800 text-sm mb-3 flex items-center gap-2">
            <AlertTriangle size={16} /> Low stock ({lowStockCount})
          </h3>
          <ul className="space-y-1 text-sm text-red-700">
            {[...outOfStock, ...lowStock].slice(0, 5).map((i) => (
              <li key={i.id}>{i.product?.name || "Unknown product"} — {i.quantity ?? 0} left</li>
            ))}
          </ul>
          {lowStockCount > 5 && (
            <div className="text-xs text-red-500 mt-2">+ {lowStockCount - 5} more</div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone, detail }) {
  const toneClasses = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    red: "bg-red-50 text-red-700 border-red-200",
    slate: "bg-slate-50 text-slate-700 border-slate-200",
  }[tone];

  return (
    <div className={`rounded-2xl border p-5 ${toneClasses}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} />
        <span className="text-xs font-bold uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-black mb-1">{value}</div>
      <div className="text-xs opacity-80">{detail}</div>
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
