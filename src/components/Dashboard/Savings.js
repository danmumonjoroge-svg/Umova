// src/components/Dashboard/Savings.js

import React, { useEffect, useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../../supabaseClient";
import { 
  ArrowUpRight, ArrowDownLeft, TrendingUp, 
  DownloadCloud, Search, Calendar, AlertCircle 
} from "lucide-react";

const SAVINGS_ACCOUNT = 1018;

export default function Savings({ memberNo: propMemberNo }) {
  // Pull the reactive context data passed down from DashboardMain's <Outlet />
  const routerContext = useOutletContext() || {};
  
  const [memberNo, setMemberNo] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showStatement, setShowStatement] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  // ==========================================
  // RESOLVE AUTHENTICATED IDENTITY PIPELINE
  // ==========================================
  useEffect(() => {
    // Priority 1: Direct component property injection
    // Priority 2: Shared App Router Context from Dashboard Shell
    // Priority 3: Legacy local storage key fallback strings
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
  // CORE DB FETCHER & REAL-TIME RE-SYNC PIPELINE
  // ==========================================
  const loadSavingsLedger = async (targetMember) => {
    if (!targetMember) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("general_ledger")
        .select("*")
        .eq("member_no", targetMember)
        .order("date", { ascending: true });

      if (error) throw error;

      // Strict account filtering parsing transactions targeting Code 1018
      const savingsTx = (data || []).filter((tx) => {
        const d = Number(tx.debit_account_id); 
        const c = Number(tx.credit_account_id);
        const targetId = Number(tx.id);
        return d === SAVINGS_ACCOUNT || c === SAVINGS_ACCOUNT || targetId === SAVINGS_ACCOUNT;
      });

      setRows(savingsTx);
    } catch (err) {
      console.error("[SAVINGS_LEDGER_ERROR]:", err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!memberNo) return;

    loadSavingsLedger(memberNo);

    // Initialize duplex real-time sync channel focused on this member's modifications
    const savingsChannel = supabase
      .channel(`realtime-savings-${memberNo}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "general_ledger", filter: `member_no=eq.${memberNo}` },
        () => loadSavingsLedger(memberNo)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(savingsChannel);
    };
  }, [memberNo]);

  // ==========================================
  // MEMOIZED LEDGER TRANSFORMATIONS & BALANCING
  // ==========================================
  const processedStatement = useMemo(() => {
    let runningBalance = 0;
    let totalDeposits = 0;
    let totalWithdrawals = 0;

    const transformed = rows.map((tx) => {
      const amount = Number(tx.amount || 0);
      const isDeposit = Number(tx.credit_account_id) === SAVINGS_ACCOUNT;
      const isWithdrawal = Number(tx.debit_account_id) === SAVINGS_ACCOUNT;

      if (isDeposit) {
        runningBalance += amount;
        totalDeposits += amount;
      } else if (isWithdrawal) {
        runningBalance -= amount;
        totalWithdrawals += amount;
      }

      return {
        ...tx,
        isDeposit,
        isWithdrawal,
        currentAmount: amount,
        computedBalance: runningBalance
      };
    });

    // Reactive filtering string evaluations (Receipts, Methods, Descriptions)
    const filtered = transformed.filter(tx => 
      tx.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.receipt_no?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.mode?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return {
      statementRows: filtered,
      totals: {
        deposits: totalDeposits,
        withdrawals: totalWithdrawals,
        balance: runningBalance
      }
    };
  }, [rows, searchTerm]);

  // Client-Side CSV Ledger Generator
  const exportToCSV = () => {
    if (!processedStatement.statementRows.length) return;
    const headers = ["Date", "Receipt No", "Description", "Mode", "Type", "Amount", "Running Balance\n"];
    const csvContent = processedStatement.statementRows.map(tx => [
      tx.date,
      tx.receipt_no || "N/A",
      tx.description || "Savings Ledger Action",
      tx.mode || "System",
      tx.isDeposit ? "CREDIT" : "DEBIT",
      tx.currentAmount,
      tx.computedBalance
    ].join(",")).join("\n");

    const blob = new Blob([headers.join(",") + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `Savings_Statement_${memberNo}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Error boundary indicator view when user claims are missing
  if (!memberNo) {
    return (
      <div className="flex items-center gap-3 p-5 bg-red-50 border border-red-200 text-red-700 rounded-2xl max-w-xl mx-auto my-12 shadow-sm">
        <AlertCircle size={20} />
        <span className="font-bold text-sm tracking-tight">Session Authentication Fault: No verified member code discovered.</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-24 space-y-4">
        <div className="w-10 h-10 border-4 border-green-800 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 font-bold text-[11px] tracking-widest uppercase animate-pulse">Parsing Ledger Assets...</p>
      </div>
    );
  }

  const { statementRows, totals } = processedStatement;

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-1 main-content-fade">
      
      {/* SECTION SUMMARY BALANCE METRIC HOVERS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        
        {/* DEPOSITS (CREDITS) CARD */}
        <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm flex items-center justify-between relative overflow-hidden group hover:border-slate-300 transition">
          <div className="space-y-2 z-10">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Gross Capital Savings</span>
            <h3 className="text-2xl font-black text-slate-800 tracking-tight">KES {totals.deposits.toLocaleString()}</h3>
          </div>
          <div className="bg-emerald-50 text-emerald-600 p-3.5 rounded-2xl group-hover:scale-110 transition duration-200">
            <ArrowUpRight size={24} />
          </div>
          <div className="absolute -right-4 -bottom-4 text-emerald-500/5 pointer-events-none transform scale-150 rotate-12 font-black text-7xl select-none">1018</div>
        </div>

        {/* WITHDRAWALS (DEBITS) CARD */}
        <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm flex items-center justify-between relative overflow-hidden group hover:border-slate-300 transition">
          <div className="space-y-2 z-10">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Withdrawn Capital</span>
            <h3 className="text-2xl font-black text-slate-800 tracking-tight">KES {totals.withdrawals.toLocaleString()}</h3>
          </div>
          <div className="bg-red-50 text-red-600 p-3.5 rounded-2xl group-hover:scale-110 transition duration-200">
            <ArrowDownLeft size={24} />
          </div>
        </div>

        {/* NET SAVINGS POSITION BALANCE */}
        <div className="bg-gradient-to-br from-green-950 to-green-800 text-white p-6 rounded-3xl shadow-md flex items-center justify-between relative overflow-hidden group">
          <div className="space-y-2 z-10">
            <span className="text-[11px] font-bold text-green-300/80 uppercase tracking-wider block">Net Ledger Balance</span>
            <h3 className="text-2xl font-black tracking-tight">KES {totals.balance.toLocaleString()}</h3>
          </div>
          <div className="bg-white/10 text-white p-3.5 rounded-2xl backdrop-blur-md group-hover:scale-110 transition duration-200">
            <TrendingUp size={24} />
          </div>
        </div>

      </div>

      {/* RE-ARCHITECTED STATEMENT INTERFACE BASECARD */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
        
        {/* RUNTIME FILTER CONTROLS HUB */}
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-slate-50/50">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text"
              placeholder="Search Receipt No, Description, Mode..."
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
              Export CSV
            </button>
            <button 
              onClick={() => setShowStatement(!showStatement)}
              className={`px-4 py-2.5 font-bold text-xs tracking-tight rounded-xl transition ${
                showStatement 
                  ? "bg-slate-200 text-slate-700 hover:bg-slate-300" 
                  : "bg-green-900 hover:bg-green-950 text-white shadow-sm"
              }`}
            >
              {showStatement ? "Hide Ledger Workspace" : "Open Statement Matrix"}
            </button>
          </div>
        </div>

        {/* LEDGER MATRIX DATA-SHEET VIEW */}
        {showStatement && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 font-bold text-[11px] tracking-wider uppercase border-b border-slate-200">
                  <th className="py-4 px-6 font-semibold flex items-center gap-1.5"><Calendar size={13} /> Posting Date</th>
                  <th className="py-4 px-6 font-semibold">Receipt Ref</th>
                  <th className="py-4 px-6 font-semibold">Operational Description</th>
                  <th className="py-4 px-6 font-semibold text-center">Protocol Mode</th>
                  <th className="py-4 px-6 font-semibold text-right">Delta Amount</th>
                  <th className="py-4 px-6 font-semibold text-right">Running Position</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm text-slate-600 font-medium">
                {statementRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400 font-medium text-xs tracking-tight">
                      No matching account logs verified within Account 1018.
                    </td>
                  </tr>
                ) : (
                  statementRows.map((tx, idx) => (
                    <tr key={tx.cod || idx} className="hover:bg-slate-50/50 transition duration-150">
                      <td className="py-4 px-6 text-slate-500 font-mono text-xs">{tx.date}</td>
                      <td className="py-4 px-6 font-bold text-slate-700 font-mono text-xs">{tx.receipt_no || "—"}</td>
                      <td className="py-4 px-6 text-slate-600 max-w-xs truncate">{tx.description || "General Ledger Deposit"}</td>
                      <td className="py-4 px-6 text-center">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase ${
                          tx.isDeposit 
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-100" 
                            : "bg-red-50 text-red-700 border border-red-100"
                        }`}>
                          {tx.isDeposit ? "Inflow (Cr)" : "Outflow (Dr)"}
                        </span>
                      </td>
                      <td className={`py-4 px-6 text-right font-bold tabular-nums ${tx.isDeposit ? "text-emerald-600" : "text-red-600"}`}>
                        {tx.isDeposit ? "+" : "-"}{tx.currentAmount.toLocaleString()}
                      </td>
                      <td className="py-4 px-6 text-right font-bold text-slate-800 tabular-nums">
                        {tx.computedBalance.toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
                
                {/* BOTTOM SUMMARY TOTAL AGGREGATES */}
                {statementRows.length > 0 && (
                  <>
                    <tr className="bg-slate-50/50 font-bold border-t border-slate-200">
                      <td colSpan={4} className="py-4 px-6 text-slate-500 text-xs uppercase tracking-wider text-right">Aggregate Processing Inflows:</td>
                      <td className="py-4 px-6 text-right text-emerald-600 font-black tabular-nums font-mono text-base">+{totals.deposits.toLocaleString()}</td>
                      <td></td>
                    </tr>
                    <tr className="bg-slate-50/50 font-bold">
                      <td colSpan={4} className="py-4 px-6 text-slate-500 text-xs uppercase tracking-wider text-right">Aggregate Processing Outflows:</td>
                      <td className="py-4 px-6 text-right text-red-600 font-black tabular-nums font-mono text-base">-{totals.withdrawals.toLocaleString()}</td>
                      <td></td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}

      </div>
    </div>
  );
}