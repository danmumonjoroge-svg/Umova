import { useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { useAuth } from "../../Context/AuthContext";
import { useMemberLedger } from "../../hooks/useMemberLedger";
import { generateStatementPDF } from "../../utils/generateStatementPDF";

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
  { key: "savings", label: "Savings", owed: false },
  { key: "shares", label: "Shares", owed: false },
  { key: "loans", label: "Loans", owed: true },
];

const money = (n) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export default function Statements() {
  const { memberNo } = useOutletContext() || {};
  const { profile } = useAuth();
  const { ledger, rows, loading, error } = useMemberLedger(memberNo);

  const [view, setView] = useState("savings");
  const [query, setQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

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

  if (!memberNo && !loading) {
    return (
      <div className="max-w-5xl mx-auto p-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <h2 className="text-lg font-bold text-slate-800">Your statement isn't available yet</h2>
          <p className="mt-2 text-slate-500">
            We couldn't find a member number on your account. Contact the SACCO office to have it linked.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-4 md:p-8 animate-pulse">
        <div className="h-32 rounded-2xl bg-slate-100" />
        <div className="mt-6 h-10 w-64 rounded-lg bg-slate-100" />
        <div className="mt-6 space-y-3">
          {[...Array(6)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-slate-100" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto p-8">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-8">
          <h2 className="font-bold text-red-800">Your statement couldn't be loaded</h2>
          <p className="mt-2 text-sm text-red-700">{error}</p>
          <button onClick={() => window.location.reload()} className="mt-4 rounded-lg bg-red-700 px-5 py-2 font-semibold text-white hover:bg-red-800">
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-8">

      {/* Net position — the question members actually open this page to answer. */}
      <section className="rounded-2xl bg-slate-900 p-7 text-white">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-sm text-slate-400">Your position with the SACCO today</p>
            <p className="mt-2 text-4xl font-black tracking-tight">
              KES {money(ledger.netPosition)}
            </p>
            <p className="mt-2 max-w-md text-sm text-slate-400">
              Savings and shares, less the {ledger.loans.balance > 0 ? "KES " + money(ledger.loans.balance) + " you still owe" : "loans you owe"}.
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold">{profile?.name || "Member"}</p>
            <p className="text-slate-400">{memberNo}</p>
            <p className="mt-3 text-slate-500">{rows.length} posted transactions</p>
          </div>
        </div>
      </section>

      {/* Account selector — doubles as the balance summary, so the three
          figures aren't repeated in separate cards above. */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {ACCOUNT_VIEWS.map((acct) => {
          const selected = view === acct.key;
          const balance = ledger[acct.key].balance;
          return (
            <button
              key={acct.key}
              onClick={() => setView(acct.key)}
              aria-pressed={selected}
              className={`rounded-xl border p-4 text-left transition-colors ${
                selected
                  ? "border-green-600 bg-green-50"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <p className="text-sm text-slate-500">{acct.label}</p>
              <p className={`mt-1 text-xl font-bold ${acct.owed && balance > 0 ? "text-red-700" : "text-slate-800"}`}>
                KES {money(balance)}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {ledger[acct.key].transactions.length} entries
              </p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[200px] text-sm">
          <span className="text-slate-600">Search this statement</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Description or reference"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-green-500"
          />
        </label>
        <label className="text-sm">
          <span className="text-slate-600">From</span>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-green-500" />
        </label>
        <label className="text-sm">
          <span className="text-slate-600">To</span>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-green-500" />
        </label>
        <button
          onClick={() => generateStatementPDF({ ...profile, member_no: memberNo }, rows)}
          disabled={rows.length === 0}
          className="rounded-lg bg-green-700 px-5 py-2.5 font-semibold text-white transition-colors hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Download statement
        </button>
      </div>

      {/* Ledger with running balance — the passbook view. */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Description</th>
                <th className="px-4 py-3 font-semibold">Reference</th>
                <th className="px-4 py-3 text-right font-semibold">Amount</th>
                <th className="px-4 py-3 text-right font-semibold">Balance</th>
              </tr>
            </thead>
            <tbody>
              {visibleTransactions.map((tx) => (
                <tr key={tx.cod} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(tx.date)}</td>
                  <td className="px-4 py-3 text-slate-800">{tx.description || "Transaction"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{tx.reference_no || tx.reference || "—"}</td>
                  <td className={`whitespace-nowrap px-4 py-3 text-right font-semibold ${tx.direction === "in" ? "text-green-700" : "text-slate-700"}`}>
                    {tx.direction === "in" ? "+" : "−"} {money(tx.amount)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-bold text-slate-800">{money(tx.runningBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {visibleTransactions.length === 0 && (
          <div className="p-10 text-center">
            {isFiltered ? (
              <>
                <p className="font-semibold text-slate-700">No entries match these filters</p>
                <button
                  onClick={() => { setQuery(""); setFromDate(""); setToDate(""); }}
                  className="mt-3 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Clear filters
                </button>
              </>
            ) : (
              <>
                <p className="font-semibold text-slate-700">
                  No {view} activity yet
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {view === "loans"
                    ? "You don't have any loan activity on record."
                    : `Your ${view} transactions will appear here once the SACCO posts them.`}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-400">
        Shows posted transactions only. Balances update once the SACCO office posts a transaction.
      </p>
    </div>
  );
}
