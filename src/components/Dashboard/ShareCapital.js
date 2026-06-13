// src/components/Dashboard/ShareCapital.js

import React, { useEffect, useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../../supabaseClient";
import { 
  LineChart, DownloadCloud, Search, Calendar, 
  ArrowUpRight, ShieldCheck, AlertCircle 
} from "lucide-react";

const SHARE_ACCOUNT = 1012;

export default function ShareCapital({ memberNo: propMemberNo }) {
  // Pull the verified user parameters directly out of the main dashboard shell
  const routerContext = useOutletContext() || {};
  
  const [memberNo, setMemberNo] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showStatement, setShowStatement] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  // ==========================================
  // SYNC AUTHENTICATED IDENTITY CONTEXT
  // ==========================================
  useEffect(() => {
    const resolved = propMemberNo || routerContext.memberNo;
    
    if (resolved) {
      setMemberNo(resolved);
    } else {
      const stored = localStorage.getItem("member") || localStorage.getItem("user");
      if (stored) {
        const parsed = JSON.parse(stored);
        setMemberNo(parsed?.member_no || parsed?.memberNo || parsed?.profile?.member_no);
      }
    }
  }, [propMemberNo, routerContext.memberNo]);

  // ==========================================
  // GENERAL LEDGER FETCH & REAL-TIME LISTENER
  // ==========================================
  const fetchShareLedger = async (targetMember) => {
    if (!targetMember) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("general_ledger")
        .select("*")
        .eq("member_no", targetMember)
        .order("date", { ascending: true });

      if (error) throw error;

      // Tight transactional filtering strictly parsing account allocations for code 1012
      const sharesOnly = (data || []).filter(
        (x) =>
          Number(x.credit_account_id) === SHARE_ACCOUNT ||
          Number(x.debit_account_id) === SHARE_ACCOUNT ||
          Number(x.id) === SHARE_ACCOUNT
      );

      setRows(sharesOnly);
    } catch (err) {
      console.error("[SHARE_CAPITAL_ERROR]:", err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!memberNo) return;

    fetchShareLedger(memberNo);

    // Duplex streaming channel looking for backend ledger alterations on account 1012
    const sharesChannel = supabase
      .channel(`realtime-shares-${memberNo}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "general_ledger", filter: `member_no=eq.${memberNo}` },
        () => fetchShareLedger(memberNo)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sharesChannel);
    };
  }, [memberNo]);

  // ==========================================
  // MEMOIZED CALCULATION ENGINE & SEARCH FILTERS
  // ==========================================
  const processedLedger = useMemo(() => {
    let runningAccumulator = 0;

    const transformedRows = rows.map((r) => {
      const amount = Number(r.amount || 0);
      const isCredit = Number(r.credit_account_id) === SHARE_ACCOUNT;
      const isDebit = Number(r.debit_account_id) === SHARE_ACCOUNT;

      if (isCredit) runningAccumulator += amount;
      if (isDebit) runningAccumulator -= amount;

      return {
        ...r,
        displayDebit: isDebit ? amount : null,
        displayCredit: isCredit ? amount : null,
        computedPosition: runningAccumulator,
      };
    });

    // Handle client search terms targeting details or transaction codes
    const filteredRows = transformedRows.filter((tx) =>
      tx.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.receipt_no?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      String(tx.id || tx.code).toLowerCase().includes(searchTerm.toLowerCase())
    );

    return {
      statementRows: filteredRows,
      aggregateBalance: runningAccumulator,
    };
  }, [rows, searchTerm]);

  // Client-Side CSV Exporter Engine
  const exportToCSV = () => {
    if (!processedLedger.statementRows.length) return;
    const headers = ["Date", "Tx Reference", "Description", "Debit (Dr)", "Credit (Cr)", "Cumulative Balance\n"];
    const csvData = processedLedger.statementRows.map(r => [
      r.date,
      r.receipt_no || r.id || "N/A",
      r.description || "Share Allocation",
      r.displayDebit || 0,
      r.displayCredit || 0,
      r.computedPosition
    ].join(",")).join("\n");

    const blob = new Blob([headers.join(",") + csvData], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `Share_Capital_Statement_${memberNo}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!memberNo) {
    return (
      <div className="flex items-center gap-3 p-5 bg-red-50 border border-red-200 text-red-700 rounded-2xl max-w-xl mx-auto my-12 shadow-sm">
        <AlertCircle size={20} />
        <span className="font-bold text-sm tracking-tight">Session Error: Missing structural member node identifier.</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-24 space-y-4">
        <div className="w-10 h-10 border-4 border-green-800 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 font-bold text-[11px] tracking-widest uppercase animate-pulse">Computing Share Balance Vectors...</p>
      </div>
    );
  }

  const { statementRows, aggregateBalance } = processedLedger;

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-1 main-content-fade">
      
      {/* HEADER METRICS PROFILE SUMMARY BLOCK */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        
        {/* TOTAL EQUITY CARD */}
        <div className="md:col-span-2 bg-gradient-to-br from-green-950 to-green-900 text-white p-6 rounded-3xl shadow-md flex items-center justify-between relative overflow-hidden group">
          <div className="space-y-2.5 z-10">
            <span className="text-[11px] font-bold text-green-300/80 uppercase tracking-widest block">Total Equity Share Capital</span>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight tabular-nums">
              KES {aggregateBalance.toLocaleString()}
            </h1>
            <p className="text-xs text-green-200/60 font-medium">Account Portfolio Mapping ID Reference: <span className="font-mono font-bold text-white">1012</span></p>
          </div>
          <div className="bg-white/10 text-white p-4 rounded-2xl backdrop-blur-md group-hover:scale-105 transition duration-200">
            <LineChart size={28} />
          </div>
          <div className="absolute -right-6 -bottom-6 text-white/5 pointer-events-none transform scale-150 rotate-12 font-black text-8xl select-none">1012</div>
        </div>

        {/* SECURITY PORTFOLIO COMPLIANCE CARD */}
        <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm flex flex-col justify-between hover:border-slate-300 transition">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Asset Status</span>
            <span className="bg-green-50 text-green-700 text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-green-200/50 flex items-center gap-1">
              <ShieldCheck size={12} /> Compliant
            </span>
          </div>
          <div className="mt-4">
            <p className="text-xs text-slate-400 font-medium">Node Member Assignment</p>
            <h4 className="text-base font-bold text-slate-700 mt-0.5">{memberNo}</h4>
          </div>
        </div>

      </div>

      {/* DETAILED STATEMENT LEDGER MATRICES */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
        
        {/* RUNTIME SYSTEM CONTROL ACTIONS STAGE BAR */}
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-slate-50/50">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text"
              placeholder="Search Ref, Description, Receipt Code..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white border border-slate-200 text-slate-700 placeholder-slate-400 text-sm pl-10 pr-4 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-800 focus:border-transparent transition"
            />
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={exportToCSV}
              disabled={!statementRows.length}
              className="px-4 py-2.5 bg-white border border-slate-200 hover:border-slate-300 disabled:opacity-50 text-slate-700 font-bold text-xs tracking-tight rounded-xl flex items-center gap-2 shadow-sm transition"
            >
              <DownloadCloud size={16} />
              Export Statement
            </button>
            <button 
              onClick={() => setShowStatement(!showStatement)}
              className={`px-4 py-2.5 font-bold text-xs tracking-tight rounded-xl transition ${
                showStatement 
                  ? "bg-slate-200 text-slate-700 hover:bg-slate-300" 
                  : "bg-green-900 hover:bg-green-950 text-white shadow-sm"
              }`}
            >
              {showStatement ? "Hide Asset Ledger" : "Expose Share Capital Matrix"}
            </button>
          </div>
        </div>

        {/* DATA-SHEET GRID VIEW */}
        {showStatement && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 font-bold text-[11px] tracking-wider uppercase border-b border-slate-200">
                  <th className="py-4 px-6 font-semibold flex items-center gap-1.5"><Calendar size={13} /> Value Date</th>
                  <th className="py-4 px-6 font-semibold">Tx Reference ID</th>
                  <th className="py-4 px-6 font-semibold">Operational Description</th>
                  <th className="py-4 px-6 font-semibold text-right text-red-600">Debit (Dr)</th>
                  <th className="py-4 px-6 font-semibold text-right text-emerald-600">Credit (Cr)</th>
                  <th className="py-4 px-6 font-semibold text-right">Cumulative Equity Position</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm text-slate-600 font-medium">
                {statementRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400 font-medium text-xs tracking-tight">
                      No active equity rows discovered under account context code 1012.
                    </td>
                  </tr>
                ) : (
                  statementRows.map((r, idx) => (
                    <tr key={r.cod || idx} className="hover:bg-slate-50/40 transition duration-150">
                      <td className="py-4 px-6 text-slate-500 font-mono text-xs">{r.date}</td>
                      <td className="py-4 px-6 font-bold text-slate-700 font-mono text-xs">
                        {r.receipt_no || r.id || r.code || "—"}
                      </td>
                      <td className="py-4 px-6 text-slate-600 max-w-xs truncate">
                        {r.description || "Capital Equity Investment Assignment"}
                      </td>
                      <td className="py-4 px-6 text-right font-semibold text-red-500 tabular-nums font-mono">
                        {r.displayDebit ? `-${r.displayDebit.toLocaleString()}` : "—"}
                      </td>
                      <td className="py-4 px-6 text-right font-semibold text-emerald-600 tabular-nums font-mono">
                        {r.displayCredit ? `+${r.displayCredit.toLocaleString()}` : "—"}
                      </td>
                      <td className="py-4 px-6 text-right font-black text-slate-800 tabular-nums font-mono">
                        {r.computedPosition.toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>

              {/* CONSOLIDATION FOOTER SUMMARY MATRIX BLOCKS */}
              {statementRows.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-50 border-t border-slate-200 font-black text-slate-700 text-xs uppercase tracking-wider">
                    <td colSpan={5} className="py-5 px-6 text-right font-bold text-slate-400 text-[11px]">Consolidated Cumulative Assets Balance:</td>
                    <td className="py-5 px-6 text-right text-green-900 text-base font-mono tabular-nums">
                      KES {aggregateBalance.toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

      </div>
    </div>
  );
}