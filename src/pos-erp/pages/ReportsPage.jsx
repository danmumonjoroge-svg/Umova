// src/pos-erp/pages/ReportsPage.jsx
//
// Daily sales / cash closing summary. Shows a "Live" badge when the day
// hasn't been closed yet (computed on the fly from lb_sales/lb_payments/
// lb_expenses/lb_cash_movements) vs. "Closed" when reading back a real
// lb_daily_closings row. "Close Day" actually writes that row for the
// first time — see reportsService.js header note on why that mattered.

import React, { useState, useEffect, useCallback } from "react";
import { BarChart3, Loader2, Lock, CheckCircle2 } from "lucide-react";
import { usePosErpAuth } from "../auth/usePosErpAuth";
import { reportsService } from "../services/reportsService";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const { staffId, tenant } = usePosErpAuth();
  const [date, setDate] = useState(todayISO());
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [closing, setClosing] = useState(false);

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await reportsService.getDailySummary({ tenantId: tenant.id, date });
      setSummary(result);
    } catch (err) {
      setError(err.message || "Failed to load report.");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [tenant, date]);

  useEffect(() => { load(); }, [load]);

  const handleCloseDay = async () => {
    if (!window.confirm(`Close ${date}? This locks the day's summary and can't be undone from here.`)) return;
    setClosing(true);
    setError(null);
    try {
      const result = await reportsService.closeDay({
        tenantId: tenant?.id,
        businessId: tenant?.business_id ?? null,
        date,
        closedBy: staffId,
      });
      setSummary({ ...result, source: "closed" });
    } catch (err) {
      setError(err.message || "Failed to close day.");
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <BarChart3 size={22} className="text-emerald-600" /> Daily Closing
          </h1>
          <p className="text-slate-500 text-sm">Sales, payments and cash summary for a single day.</p>
        </div>
        <input
          type="date"
          value={date}
          max={todayISO()}
          onChange={(e) => setDate(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-2 text-sm"
        />
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3 mb-4">{error}</div>}

      {loading && (
        <div className="text-center text-slate-400 py-10">
          <Loader2 size={18} className="animate-spin inline mr-2" /> Loading…
        </div>
      )}

      {!loading && summary && (
        <>
          <div className="flex items-center gap-2 mb-5">
            {summary.source === "closed" ? (
              <span className="flex items-center gap-1.5 text-xs font-bold uppercase bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full">
                <Lock size={11} /> Closed
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-bold uppercase bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full">
                Live — not yet closed
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
            <SummaryCard label="Total Sales" value={summary.total_sales} highlight />
            <SummaryCard label="Cash" value={summary.total_cash_payments} />
            <SummaryCard label="Mobile Money" value={summary.total_mobile_payments} />
            <SummaryCard label="Card" value={summary.total_card_payments} />
            <SummaryCard label="Credit" value={summary.total_credit_sales} />
            <SummaryCard label="Other" value={summary.total_other_payments} />
            <SummaryCard label="Expenses" value={summary.total_expenses} tone="red" />
            <SummaryCard label="Refunds*" value={summary.total_refunds} tone="red" />
            <SummaryCard label="Cash In" value={summary.total_cash_in} />
            <SummaryCard label="Cash Out" value={summary.total_cash_out} tone="red" />
            <SummaryCard label="Stock Movements" value={summary.stock_movement_count} isCount />
          </div>

          <p className="text-xs text-slate-400 mb-6">
            *Refunds not yet netted in — lb_refunds schema hasn't been confirmed. See reportsService.js.
          </p>

          {summary.source === "live" && (
            <button
              onClick={handleCloseDay}
              disabled={closing}
              className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition"
            >
              <CheckCircle2 size={16} /> {closing ? "Closing…" : `Close ${date}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, tone, highlight, isCount }) {
  const toneClass = tone === "red" ? "text-red-600" : highlight ? "text-emerald-700" : "text-slate-800";
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">{label}</div>
      <div className={`text-xl font-black ${toneClass}`}>
        {isCount ? value : Number(value || 0).toLocaleString()}
      </div>
    </div>
  );
}
