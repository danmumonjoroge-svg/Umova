import React, { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "../../supabaseClient";
import { 
  TrendingUp, ShieldAlert, Award, Activity, 
  Calendar, RefreshCw, Layers, CheckCircle2, AlertTriangle, ArrowUpRight 
} from "lucide-react";

export default function LedgerLoanAnalytics() {
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewTimeframe, setViewTimeframe] = useState("ALL"); // ALL, 30_DAYS, 90_DAYS
  const [vintageSelection, setVintageSelection] = useState("ALL");

  // --- COMPREHENSIVE FINANCIAL DOUBLE-ENTRY INGESTION ---
  const fetchLedgerData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Extract rows tracking Principal (1011), Interest Revenue (1020), and Guarantor Cash Collateral Pools (1030)
      const { data, error: ledgerError } = await supabase
        .from("general_ledger")
        .select("*")
        .or("debit_account_id.in.(1011,1020,1030),credit_account_id.in.(1011,1020,1030)");

      if (ledgerError) throw ledgerError;
      setLedger(data || []);
    } catch (err) {
      console.error("Critical Failure in Analytics Data Pipeline Ingestion:", err);
      setError(err.message || "Failed to structure ledger ledger sheets.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLedgerData();

    const ledgerSubscription = supabase
      .channel("realtime-ledger-telemetry-advanced")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "general_ledger" },
        () => fetchLedgerData()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ledgerSubscription);
    };
  }, [fetchLedgerData]);

  // --- TIME BOUND TRANSFORMATION LAYER ---
  const filteredLedger = useMemo(() => {
    let result = ledger;
    
    if (viewTimeframe !== "ALL") {
      const cutoffDate = new Date();
      if (viewTimeframe === "30_DAYS") cutoffDate.setDate(cutoffDate.getDate() - 30);
      if (viewTimeframe === "90_DAYS") cutoffDate.setDate(cutoffDate.getDate() - 90);
      result = result.filter((entry) => new Date(entry.created_at) >= cutoffDate);
    }

    if (vintageSelection !== "ALL") {
      result = result.filter((entry) => {
        const year = new Date(entry.created_at).getFullYear().toString();
        return year === vintageSelection;
      });
    }

    return result;
  }, [ledger, viewTimeframe, vintageSelection]);

  // --- ADVANCED BANKING METRICS CALCULATOR ENGINE ---
  const financialMetrics = useMemo(() => {
    let grossDisbursed = 0;      // Dr 1011
    let recoveredPrincipal = 0;  // Cr 1011
    let interestAccrued = 0;     // Cr 1020
    let guarantorPoolSize = 0;   // Cr 1030 (Guarantor deposits locked)
    let guarantorReleased = 0;  // Dr 1030 (Guarantor collateral claims cleared)
    
    let par30Volume = 0;         // Portfolio At Risk (30 Days default window)
    let par90Volume = 0;         // Portfolio At Risk (90 Days terminal write-off)
    
    const nowTimestamp = new Date().getTime();

    filteredLedger.forEach((entry) => {
      const amt = Number(entry.amount || 0);
      const dr = String(entry.debit_account_id);
      const cr = String(entry.credit_account_id);
      const entryAgeDays = (nowTimestamp - new Date(entry.created_at).getTime()) / (1000 * 60 * 60 * 24);

      // Core Accounting Flow Mapping Matrices
      if (dr === "1011") grossDisbursed += amt;
      if (cr === "1011") recoveredPrincipal += amt;
      if (cr === "1020") interestAccrued += amt;
      if (cr === "1030") guarantorPoolSize += amt;
      if (dr === "1030") guarantorReleased += amt;

      // Delinquency Aging Logic Analysis (Portfolio at Risk Modeling)
      // If a loan profile structure has zero repayment postings inside risk buckets
      if (dr === "1011" && !entry.is_settled) {
        if (entryAgeDays > 90) {
          par90Volume += amt;
        } else if (entryAgeDays > 30) {
          par30Volume += amt;
        }
      }
    });

    const netActivePortfolio = grossDisbursed - recoveredPrincipal;
    const lockedCollateral = guarantorPoolSize - guarantorReleased;
    
    // Core Institutional Performance Metrics ratios
    const portfolioRecoveryYield = grossDisbursed > 0 ? (recoveredPrincipal / grossDisbursed) * 100 : 0;
    const interestToPrincipalRatio = recoveredPrincipal > 0 ? (interestAccrued / recoveredPrincipal) * 100 : 0;
    const par30Ratio = netActivePortfolio > 0 ? (par30Volume / netActivePortfolio) * 100 : 0;
    const par90Ratio = netActivePortfolio > 0 ? (par90Volume / netActivePortfolio) * 100 : 0;
    
    // Capital Coverage Multiplier Rule: How well does collateral backstop risk book?
    const collateralCoverageRatio = netActivePortfolio > 0 ? (lockedCollateral / netActivePortfolio) * 100 : 0;

    return {
      grossDisbursed,
      recoveredPrincipal,
      interestAccrued,
      netActivePortfolio,
      lockedCollateral,
      portfolioRecoveryYield,
      interestToPrincipalRatio,
      par30Volume,
      par90Volume,
      par30Ratio,
      par90Ratio,
      collateralCoverageRatio,
      totalEntriesCount: filteredLedger.length
    };
  }, [filteredLedger]);

  const formatCurrency = (val) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorBanner message={error} onRetry={fetchLedgerData} />;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 bg-slate-900 min-h-screen text-slate-100 font-sans">
      
      {/* 1. TOP STATUS PANEL HUB */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between border-b border-slate-800 pb-6 gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <h1 className="text-3xl font-black text-white tracking-tight">Advanced Credit Telemetry Desk</h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 animate-pulse">
              ● Live Engine Syncing
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">GAAP Double-Entry ledger validation engine analyzing portfolio aging, guarantor risk distributions, and recovery margins.</p>
        </div>
        
        {/* FILTERS FRAME */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Dynamic Timeline Range</span>
            <select
              value={viewTimeframe}
              onChange={(e) => setViewTimeframe(e.target.value)}
              className="text-xs bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 font-bold text-slate-200 shadow-sm outline-none"
            >
              <option value="ALL">All-Time Cumulative</option>
              <option value="90_DAYS">Past 90 Execution Days</option>
              <option value="30_DAYS">Past 30 Execution Days</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Vintage Allocation Filter</span>
            <select
              value={vintageSelection}
              onChange={(e) => setVintageSelection(e.target.value)}
              className="text-xs bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 font-bold text-slate-200 shadow-sm outline-none"
            >
              <option value="ALL">All Financial Vintages</option>
              <option value="2026">2026 Vintage Book</option>
              <option value="2025">2025 Vintage Book</option>
              <option value="2024">2024 Vintage Book</option>
            </select>
          </div>
        </div>
      </div>

      {/* 2. CORE LEDGER VALUE MATRICES */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <MetricTile 
          title="Gross Portfolio Issued"
          value={formatCurrency(financialMetrics.grossDisbursed)}
          subtitle="Total Account Dr Postings (1011)"
          icon={<TrendingUp className="text-blue-400" size={18} />}
          gradient="from-blue-500/10 to-indigo-500/5 border-blue-500/20"
        />
        <MetricTile 
          title="Amortized Capital Liquidated"
          value={formatCurrency(financialMetrics.recoveredPrincipal)}
          subtitle="Total Account Cr Postings (1011)"
          icon={<CheckCircle2 className="text-emerald-400" size={18} />}
          gradient="from-emerald-500/10 to-teal-500/5 border-emerald-500/20"
        />
        <MetricTile 
          title="Net Active Outstanding Asset"
          value={formatCurrency(financialMetrics.netActivePortfolio)}
          subtitle="Current Total Book Exposure Value"
          icon={<Layers className="text-purple-400" size={18} />}
          gradient="from-purple-500/10 to-pink-500/5 border-purple-500/20"
        />
        <MetricTile 
          title="Realized Interest Margin"
          value={formatCurrency(financialMetrics.interestAccrued)}
          subtitle="Total Cr Performance (1020)"
          icon={<ArrowUpRight className="text-amber-400" size={18} />}
          gradient="from-amber-500/10 to-orange-500/5 border-amber-500/20"
        />
      </div>

      {/* 3. RISK PROFILE MANAGEMENT MATRICES (PAR DECK) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* PAR MATRIX BUCKET LIST */}
        <div className="bg-slate-800/60 p-6 rounded-2xl border border-slate-800 space-y-6 lg:col-span-2">
          <div className="flex justify-between items-center border-b border-slate-700/50 pb-4">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <ShieldAlert className="text-rose-400" size={20} /> 
                Institutional Portfolio At Risk (PAR) Analytics
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">Real-time asset impairment vectors tracking overdue principal distributions.</p>
            </div>
            <span className="text-xs font-black bg-rose-500/10 text-rose-400 border border-rose-500/20 px-3 py-1 rounded-lg">
              Aggregate Impairment Rate: {(financialMetrics.par30Ratio + financialMetrics.par90Ratio).toFixed(2)}%
            </span>
          </div>

          <div className="space-y-6">
            <EnhancedProgressBar 
              label="PAR 30 Profile (Early Stage Arrears Breakdown)"
              value={financialMetrics.par30Volume}
              max={financialMetrics.netActivePortfolio}
              ratio={financialMetrics.par30Ratio}
              colorClass="bg-amber-500"
              formatter={formatCurrency}
            />
            <EnhancedProgressBar 
              label="PAR 90 Profile (Severe Impairment Default Risks)"
              value={financialMetrics.par90Volume}
              max={financialMetrics.netActivePortfolio}
              ratio={financialMetrics.par90Ratio}
              colorClass="bg-rose-600"
              formatter={formatCurrency}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-900/50 p-4 rounded-xl border border-slate-800 text-xs">
            <div className="space-y-1">
              <span className="text-slate-400 block font-medium">Yield Efficiency Factor</span>
              <span className="text-sm font-bold text-emerald-400">{financialMetrics.interestToPrincipalRatio.toFixed(2)}% Margins</span>
              <p className="text-[11px] text-slate-500">Interest collected relative to principal recovered weights.</p>
            </div>
            <div className="space-y-1">
              <span className="text-slate-400 block font-medium">Liquidity Velocity Matrix</span>
              <span className="text-sm font-bold text-blue-400">{financialMetrics.portfolioRecoveryYield.toFixed(2)}% Recovery Rate</span>
              <p className="text-[11px] text-slate-500">Portion of total allocated credit capital safely recovered to bank vault tokens.</p>
            </div>
          </div>
        </div>

        {/* GUARANTOR CAPITAL MATRIX COVERAGE ENGINE */}
        <div className="bg-slate-800/60 p-6 rounded-2xl border border-slate-800 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="border-b border-slate-700/50 pb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Award className="text-teal-400" size={20} /> 
                Collateral Backstops
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">Total funds held in Guarantor Pools (1030) backing outstanding books.</p>
            </div>

            <div className="text-center py-6 bg-slate-900/40 rounded-xl border border-slate-800">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Net Locked Guarantor Pools Balance</span>
              <span className="text-3xl font-black text-white tracking-tight mt-1 block">
                {formatCurrency(financialMetrics.lockedCollateral)}
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-slate-400">Net Risk Portfolio Margin Buffer</span>
                <span className={financialMetrics.collateralCoverageRatio >= 100 ? "text-emerald-400" : "text-amber-400"}>
                  {financialMetrics.collateralCoverageRatio.toFixed(1)}% Bound
                </span>
              </div>
              <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-700">
                <div 
                  className={`h-full rounded-full transition-all duration-1000 ${financialMetrics.collateralCoverageRatio >= 100 ? "bg-emerald-500" : "bg-amber-500"}`}
                  style={{ width: `${Math.min(financialMetrics.collateralCoverageRatio, 100)}%` }} 
                />
              </div>
              <p className="text-[11px] text-slate-500 text-center italic">
                {financialMetrics.collateralCoverageRatio >= 100 
                  ? "Book liability safely covered by deposit pool locks." 
                  : "Under-collateralized risk vectors detected across segment groups."}
              </p>
            </div>
          </div>
        </div>

      </div>

      {/* 4. GRANULAR HISTORICAL POSTINGS DOUBLE AUDIT BLOCK */}
      <div className="bg-slate-800/60 rounded-2xl border border-slate-800 overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-slate-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Activity className="text-indigo-400" size={18} /> Granular Financial Postings Audit Desk
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">Isolating ledger entry traces flowing into general accounts matrices.</p>
          </div>
          <span className="text-xs font-black text-indigo-400 bg-indigo-500/10 px-3 py-1.5 rounded-lg border border-indigo-500/20">
            Parsing {financialMetrics.totalEntriesCount} System Traces
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900/80 text-xs font-bold text-slate-400 uppercase border-b border-slate-800 tracking-wider">
                <th className="p-4">Post Date</th>
                <th className="p-4">Transaction Code Token</th>
                <th className="p-4 text-center">Debit System Destination (Dr)</th>
                <th className="p-4 text-center">Credit System Destination (Cr)</th>
                <th className="p-4 text-right">Raw Amount Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-sm text-slate-300 font-medium">
              {filteredLedger.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-slate-500 font-bold italic bg-slate-900/10">
                    No bookkeeping tracks mapped inside specified ranges.
                  </td>
                </tr>
              ) : (
                filteredLedger.map((entry) => {
                  const isDisbursement = String(entry.debit_account_id) === "1011";
                  const isCollateral = String(entry.debit_account_id) === "1030" || String(entry.credit_account_id) === "1030";
                  
                  return (
                    <tr key={entry.id} className="hover:bg-slate-700/30 transition-colors duration-150">
                      <td className="p-4 text-slate-400 text-xs">
                        <div className="flex items-center gap-2">
                          <Calendar size={12} className="text-slate-500" />
                          {new Date(entry.created_at).toLocaleDateString("en-US", { dateStyle: "medium" })}
                        </div>
                      </td>
                      <td className="p-4 font-mono text-xs text-indigo-400 font-bold tracking-tight">
                        TX-{String(entry.id).slice(0, 8).toUpperCase()}
                      </td>
                      <td className="p-4 text-center">
                        <span className={`px-2.5 py-1 rounded-md text-xs font-extrabold tracking-wide block mx-auto max-w-[80px] ${drBadgeColor(entry.debit_account_id)}`}>
                          {entry.debit_account_id}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <span className={`px-2.5 py-1 rounded-md text-xs font-extrabold tracking-wide block mx-auto max-w-[80px] ${crBadgeColor(entry.credit_account_id)}`}>
                          {entry.credit_account_id}
                        </span>
                      </td>
                      <td className={`p-4 text-right font-mono font-bold text-sm ${isCollateral ? "text-purple-400" : isDisbursement ? "text-rose-400" : "text-emerald-400"}`}>
                        {isCollateral ? "◈ " : isDisbursement ? "- " : "+ "}
                        {formatCurrency(entry.amount)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// --- COLOR TRANSLATION MATRIX ENGINE ---
function drBadgeColor(code) {
  switch (String(code)) {
    case "1011": return "bg-blue-500/10 text-blue-400 border border-blue-500/20";
    case "1030": return "bg-purple-500/10 text-purple-400 border border-purple-500/20";
    case "1007": return "bg-slate-500/10 text-slate-400 border border-slate-500/20";
    default:     return "bg-slate-800 text-slate-400 border border-slate-700";
  }
}

function crBadgeColor(code) {
  switch (String(code)) {
    case "1011": return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
    case "1020": return "bg-amber-500/10 text-amber-400 border border-amber-500/20";
    case "1030": return "bg-purple-500/10 text-purple-400 border border-purple-500/20";
    case "1007": return "bg-slate-500/10 text-slate-400 border border-slate-500/20";
    default:     return "bg-slate-800 text-slate-400 border border-slate-700";
  }
}

// --- STRUCTURAL SUB-COMPONENTS MODULE PACKET ---
function MetricTile({ title, value, subtitle, icon, gradient }) {
  return (
    <div className={`bg-gradient-to-br ${gradient} p-6 rounded-2xl border backdrop-blur-sm shadow-xl flex flex-col justify-between`}>
      <div className="flex justify-between items-start gap-2">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{title}</p>
        <div className="p-2 bg-slate-900/60 rounded-xl border border-slate-800">{icon}</div>
      </div>
      <div className="mt-4">
        <h3 className="text-2xl font-black text-white tracking-tight">{value}</h3>
        {subtitle && <p className="text-[11px] mt-1 text-slate-500 font-medium italic">{subtitle}</p>}
      </div>
    </div>
  );
}

function EnhancedProgressBar({ label, value, max, ratio, colorClass, formatter }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs font-bold">
        <span className="text-slate-300">{label}</span>
        <span className="font-mono text-slate-400">
          {formatter(value)} <span className="text-slate-500">/</span> <span className={ratio > 15 ? "text-rose-400" : "text-slate-400"}>{ratio.toFixed(2)}%</span>
        </span>
      </div>
      <div className="w-full bg-slate-900 rounded-full h-3 overflow-hidden border border-slate-700/60 p-[2px]">
        <div 
          className={`${colorClass} h-full rounded-full transition-all duration-1000 ease-out shadow-inner`} 
          style={{ width: `${Math.min(ratio, 100)}%` }} 
        />
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-pulse bg-slate-900 min-h-screen">
      <div className="h-12 bg-slate-800 rounded-xl w-1/4" />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-slate-800 rounded-2xl" />)}
      </div>
      <div className="h-56 bg-slate-800 rounded-2xl" />
    </div>
  );
}

function ErrorBanner({ message, onRetry }) {
  return (
    <div className="p-8 max-w-xl mx-auto text-center mt-20 bg-slate-900 min-h-screen">
      <div className="bg-rose-950/20 border border-rose-900/50 p-8 rounded-2xl space-y-4 shadow-2xl">
        <h3 className="text-lg font-bold text-rose-400">Analytics Pipeline Impairment</h3>
        <p className="text-sm text-rose-300/80 font-medium">{message}</p>
        <button onClick={onRetry} className="bg-rose-600 text-white text-xs font-bold px-5 py-2.5 rounded-xl hover:bg-rose-700 transition flex items-center gap-2 mx-auto shadow-lg shadow-rose-950">
          <RefreshCw size={14} /> Re-Initialize Telemetry Link
        </button>
      </div>
    </div>
  );
}