// src/components/Dashboard/Savings.js

import React, { useEffect, useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../../supabaseClient";
import { Wallet, DownloadCloud } from "lucide-react";
import { PageHero, Card, SearchBar, StatementList, PageLoading, PageNotice, kes } from "./MemberUI";
import { saveText } from "../../utils/saveFile";

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

    saveText(headers.join(",") + csvContent, `Savings_Statement_${memberNo}.csv`)
      .catch((e) => alert(e?.message || "Could not prepare the file."));
  };

  // Error state when user claims are missing
  if (!memberNo) {
    return <PageNotice tone="bad" title="Session problem">No verified member number was found for this session. Please sign in again.</PageNotice>;
  }

  if (loading) return <PageLoading text="Loading your savings…" />;

  const { statementRows, totals } = processedStatement;

  // Same rows as before, newest first for reading; each row keeps the running balance computed chronologically above.
  const listRows = [...statementRows].reverse().map((tx, i) => ({
    id: tx.cod || `${tx.date}-${i}`,
    date: tx.date,
    ref: tx.receipt_no,
    desc: tx.description || "Savings transaction",
    mode: tx.mode,
    amount: tx.currentAmount,
    isIn: tx.isDeposit,
    balance: tx.computedBalance,
  }));

  return (
    <div className="mu">
      <PageHero
        eyebrow="Savings account"
        chip={`Account ${SAVINGS_ACCOUNT}`}
        label="Your savings"
        amount={kes(totals.balance)}
        subs={[
          { label: "Money in", value: kes(totals.deposits) },
          { label: "Money out", value: kes(totals.withdrawals) },
        ]}
      />

      <Card icon={Wallet} title="Statement" hint={`${statementRows.length} ${statementRows.length === 1 ? "entry" : "entries"}`}>
        <div className="mu-tools">
          <SearchBar value={searchTerm} onChange={setSearchTerm} placeholder="Search receipt, description, mode" />
          <div className="mu-tools-btns">
            <button type="button" className="mu-btn mu-btn--ghost" onClick={exportToCSV} disabled={!statementRows.length}>
              <DownloadCloud size={16} /> Export
            </button>
            <button type="button" className="mu-btn mu-btn--soft" onClick={() => setShowStatement(!showStatement)}>
              {showStatement ? "Hide" : "Show"}
            </button>
          </div>
        </div>
        {showStatement && (
          <StatementList rows={listRows} empty="No matching savings transactions yet." />
        )}
      </Card>
    </div>
  );
}
