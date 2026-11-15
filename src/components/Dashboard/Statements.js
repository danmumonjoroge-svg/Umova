import { useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { useAuth } from "../../Context/AuthContext";
import { useMemberLedger } from "../../hooks/useMemberLedger";
import { generateStatementPDF } from "../../utils/generateStatementPDF";
import { Download } from "lucide-react";
import { PageHero, Card, Tabs, SearchBar, StatementList, PageLoading, PageNotice } from "./MemberUI";

/**
 * Member statement.
 *
 * Previously read the member from localStorage["member"] — a key nothing
 * in the app ever writes, so it always returned null, bailed out at the
 * guard clause, and rendered an empty statement for every member. It now
 * takes memberNo from the dashboard's outlet context (the same source
 * every other member page uses) and profile from useAuth.
 *
 * Ledger parsing moved to useMemberLedger, shared with the other member
 * pages rather than reimplemented here against hardcoded account ids.
 */

const ACCOUNT_VIEWS = [
  { key: "savings", label: "Savings", owed: false, heroLabel: "Your savings" },
  { key: "shares", label: "Shares", owed: false, heroLabel: "Your shares" },
  { key: "loans", label: "Loans", owed: true, heroLabel: "You owe" },
];

const money = (n) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Statements() {
  const { memberNo } = useOutletContext() || {};
  const { profile } = useAuth();
  const { ledger, rows, loading, error } = useMemberLedger(memberNo);

  const [view, setView] = useState("savings");
  const [query, setQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [dlMsg, setDlMsg] = useState("");

  const active = ledger[view];

  const visibleTransactions = useMemo(() => {
    let list = active?.transactions || [];

    if (fromDate) list = list.filter((t) => t.date >= fromDate);
    if (toDate) list = list.filter((t) => t.date <= toDate);

    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (t) =>
          t.description?.toLowerCase().includes(q) ||
          t.reference_no?.toLowerCase().includes(q) ||
          t.reference?.toLowerCase().includes(q)
      );
    }
    // Newest first for reading; the running balance was computed
    // chronologically, so each row still shows the balance as it stood
    // after that transaction.
    return [...list].reverse();
  }, [active, query, fromDate, toDate]);

  const isFiltered = Boolean(query.trim() || fromDate || toDate);

  // Totals for the account being viewed only (not affected by the search / date filters).
  const accountTotals = useMemo(() => {
    const all = active?.transactions || [];
    return {
      inn: all.filter((t) => t.direction === "in").reduce((s, t) => s + Number(t.amount || 0), 0),
      out: all.filter((t) => t.direction !== "in").reduce((s, t) => s + Number(t.amount || 0), 0),
    };
  }, [active]);
  const activeView = ACCOUNT_VIEWS.find((a) => a.key === view);

  const downloadStatement = async () => {
    setDlMsg("");
    setDownloading(true);
    try {
      await generateStatementPDF({ ...profile, member_no: memberNo }, rows);
    } catch (e) {
      console.error("[STATEMENT DOWNLOAD]", e);
      setDlMsg(e?.message || "Could not prepare your statement. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  if (!memberNo && !loading) {
    return (
      <PageNotice tone="warn" title="Your statement isn't available yet">
        We couldn't find a member number on your account. Contact the SACCO office to have it linked.
      </PageNotice>
    );
  }

  if (loading) return <PageLoading text="Loading your statement…" />;

  if (error) {
    return (
      <PageNotice
        tone="bad"
        title="Your statement couldn't be loaded"
        action={<button type="button" className="mu-btn mu-btn--dark" onClick={() => window.location.reload()}>Try again</button>}
      >
        {error}
      </PageNotice>
    );
  }

  // visibleTransactions is already newest first; each row's running balance was computed chronologically.
  const listRows = visibleTransactions.map((tx) => ({
    id: tx.cod,
    date: tx.date,
    ref: tx.reference_no || tx.reference,
    desc: tx.description || "Transaction",
    amount: tx.amount,
    isIn: tx.direction === "in",
    balance: tx.runningBalance,
  }));

  const clearFilters = () => { setQuery(""); setFromDate(""); setToDate(""); };

  return (
    <div className="mu">
      {/* Pick an account; the balance below is for that account only. */}
      <Tabs items={ACCOUNT_VIEWS} value={view} onChange={setView} label="Account" />

      <PageHero
        eyebrow={profile?.name || "Member"}
        chip={memberNo}
        label={activeView?.heroLabel}
        amount={`KES ${money(active?.balance)}`}
        subs={activeView?.owed ? [] : [
          { label: "Money in (KES)", value: money(accountTotals.inn) },
          { label: "Money out (KES)", value: money(accountTotals.out) },
        ]}
      />

      <Card title="Filter & download">
        <div className="mu-filters">
          <div className="full">
            <span className="mu-label">Search this statement</span>
            <SearchBar value={query} onChange={setQuery} placeholder="Description or reference" />
          </div>
          <label>
            <span className="mu-label">From</span>
            <input type="date" className="mu-input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label>
            <span className="mu-label">To</span>
            <input type="date" className="mu-input" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
          <button
            type="button"
            className="mu-btn mu-btn--primary full"
            onClick={downloadStatement}
            disabled={rows.length === 0 || downloading}
          >
            <Download size={16} /> {downloading ? "Preparing…" : "Download statement"}
          </button>
          {dlMsg && <p className="mu-note full" role="alert">{dlMsg}</p>}
        </div>
      </Card>

      <Card title={ACCOUNT_VIEWS.find((a) => a.key === view)?.label} hint={`${visibleTransactions.length} ${visibleTransactions.length === 1 ? "entry" : "entries"}`}>
        {visibleTransactions.length === 0 ? (
          isFiltered ? (
            <div className="mu-empty">
              <p><b>No entries match these filters</b></p>
              <button type="button" className="mu-btn mu-btn--ghost" style={{ marginTop: 10 }} onClick={clearFilters}>Clear filters</button>
            </div>
          ) : (
            <div className="mu-empty">
              <p><b>No {view} activity yet</b></p>
              <p style={{ marginTop: 4 }}>
                {view === "loans"
                  ? "You don't have any loan activity on record."
                  : `Your ${view} transactions will appear here once the SACCO posts them.`}
              </p>
            </div>
          )
        ) : (
          <StatementList rows={listRows} money={money} />
        )}
      </Card>

      <p className="mu-note">Shows posted transactions only. Balances update once the SACCO office posts a transaction.</p>
    </div>
  );
}
