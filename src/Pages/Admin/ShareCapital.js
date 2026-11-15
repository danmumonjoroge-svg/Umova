// src/components/Dashboard/ShareCapital.js

import React, { useEffect, useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../../supabaseClient";
import { LineChart, DownloadCloud } from "lucide-react";
import { PageHero, Card, SearchBar, StatementList, PageLoading, PageNotice, kes } from "./MemberUI";
import { saveText } from "../../utils/saveFile";

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

    const totalContributions = transformedRows.reduce((s, r) => s + (r.displayCredit || 0), 0);
    const totalWithdrawals   = transformedRows.reduce((s, r) => s + (r.displayDebit  || 0), 0);

    return {
      statementRows: filteredRows,
      aggregateBalance: runningAccumulator,
      totalContributions,
      totalWithdrawals,
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

    saveText(headers.join(",") + csvData, `Share_Capital_Statement_${memberNo}.csv`)
      .catch((e) => alert(e?.message || "Could not prepare the file."));
  };

  if (!memberNo) {
    return <PageNotice tone="bad" title="Session problem">No verified member number was found for this session. Please sign in again.</PageNotice>;
  }

  if (loading) return <PageLoading text="Loading your shares…" />;

  const { statementRows, aggregateBalance, totalContributions, totalWithdrawals } = processedLedger;

  // Newest first for reading; each row keeps the cumulative position computed chronologically above.
  const listRows = [...statementRows].reverse().map((r, i) => ({
    id: r.cod || `${r.date}-${i}`,
    date: r.date,
    ref: r.receipt_no || r.id || r.code,
    desc: r.description || "Share capital transaction",
    amount: r.displayCredit || r.displayDebit || 0,
    isIn: Boolean(r.displayCredit),
    balance: r.computedPosition,
  }));

  return (
    <div className="mu">
      <PageHero
        label="Your shares"
        amount={kes(aggregateBalance)}
        subs={[
          { label: "Money in", value: kes(totalContributions) },
          { label: "Money out", value: kes(totalWithdrawals) },
        ]}
      />

      <Card icon={LineChart} title="Statement" hint={`${statementRows.length} ${statementRows.length === 1 ? "entry" : "entries"}`}>
        <div className="mu-tools">
          <SearchBar value={searchTerm} onChange={setSearchTerm} placeholder="Search reference, description" />
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
          <StatementList rows={listRows} empty="No share capital transactions yet." />
        )}
      </Card>
    </div>
  );
}
