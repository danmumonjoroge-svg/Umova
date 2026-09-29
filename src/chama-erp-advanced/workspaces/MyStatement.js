import React, { useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import { Printer, Share2, Download, AlertCircle } from "lucide-react";
import useCachedQuery from "../shell/useCachedQuery";
import { formatKES, formatDate } from "../shell/format";
import { toCSV } from "../welfare/welfareFormat";
import { Spinner, StaleNote, Notice, SectionTitle, EmptyState } from "../shell/ui";

// -----------------------------------------------------------------------------
// MyStatement — built only from chama_ledger_entries (the single append-only
// ledger every posting function already writes to). Nothing here writes.
//
// Balances accounts: savings / shares / welfare (credit adds, debit subtracts).
// Loans are shown separately because money owed is not a balance you hold.
// If the ledger total for an account disagrees with the balance stored on the
// member row, the statement SAYS SO instead of quietly picking one.
// -----------------------------------------------------------------------------

const ACCOUNTS = [
  { key: "savings", label: "Savings" },
  { key: "shares", label: "Shares" },
  { key: "welfare", label: "Welfare" },
];
const ACCOUNT_LABEL = { savings: "Savings", shares: "Shares", welfare: "Welfare", fine: "Fine", loan_repayment: "Loan repayment", loan_disbursement: "Loan paid out" };
const BAL_FIELD = { savings: "savings_balance", shares: "shares_balance", welfare: "welfare_balance" };

const startOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); };
const PERIODS = [
  { key: "month", label: "This month", from: () => startOfMonth() },
  { key: "3m", label: "Last 3 months", from: () => { const d = startOfMonth(); d.setMonth(d.getMonth() - 2); return d; } },
  { key: "year", label: "This year", from: () => new Date(new Date().getFullYear(), 0, 1) },
  { key: "all", label: "All time", from: () => null },
];

const signed = (e) => (e.direction === "credit" ? 1 : -1) * Number(e.amount || 0);

export default function MyStatement({ memberId: memberIdProp, params = {} }) {
  const { chama, member, hasRole } = useChama();
  // Another member's statement is only requested for officials; the screen
  // that links here checks the same thing, and the data layer must too.
  const canViewOthers = hasRole(["secretary", "treasurer", "chairperson", "admin"]);
  const memberId = memberIdProp || (canViewOthers && params.member) || member?.id;
  const isSelf = memberId === member?.id;
  const [period, setPeriod] = useState("3m");
  const [account, setAccount] = useState(params.account && ACCOUNTS.some((a) => a.key === params.account) ? params.account : "all");

  const { data, loading, error, fromCache, cachedAt, online } = useCachedQuery(
    chama?.id && memberId ? `stmt:${chama.id}:${memberId}` : null,
    async () => {
      const [ent, mem, loans] = await Promise.all([
        supabase.from("chama_ledger_entries").select("id,created_at,account_type,direction,amount,description,source_type").eq("chama_id", chama.id).eq("member_id", memberId).order("created_at", { ascending: true }).limit(5000),
        supabase.from("chama_members").select("id,name,savings_balance,shares_balance,welfare_balance").eq("id", memberId).single(),
        supabase.from("chama_loans").select("id,amount,balance,status,disbursed").eq("chama_id", chama.id).eq("member_id", memberId),
      ]);
      const failed = ent.error || mem.error || loans.error;
      if (failed) throw new Error(failed.message);
      return { entries: ent.data || [], mem: mem.data, loans: loans.data || [] };
    },
    !!(chama?.id && memberId)
  );

  const view = useMemo(() => {
    if (!data) return null;
    const from = PERIODS.find((p) => p.key === period).from();
    const inPeriod = (e) => !from || new Date(e.created_at) >= from;
    const summary = ACCOUNTS.map((a) => {
      const all = data.entries.filter((e) => e.account_type === a.key);
      const opening = all.filter((e) => !inPeriod(e)).reduce((s, e) => s + signed(e), 0);
      const inn = all.filter(inPeriod).filter((e) => e.direction === "credit").reduce((s, e) => s + Number(e.amount || 0), 0);
      const out = all.filter(inPeriod).filter((e) => e.direction === "debit").reduce((s, e) => s + Number(e.amount || 0), 0);
      const ledgerTotal = all.reduce((s, e) => s + signed(e), 0);
      const onFile = Number(data.mem?.[BAL_FIELD[a.key]] || 0);
      return { ...a, opening, inn, out, closing: opening + inn - out, ledgerTotal, onFile, mismatch: Math.abs(ledgerTotal - onFile) > 0.005 };
    });
    const rows = data.entries.filter(inPeriod).filter((e) => account === "all" || e.account_type === account).reverse();
    const repaid = data.entries.filter(inPeriod).filter((e) => e.account_type === "loan_repayment").reduce((s, e) => s + Number(e.amount || 0), 0);
    const paidOut = data.entries.filter(inPeriod).filter((e) => e.account_type === "loan_disbursement").reduce((s, e) => s + Number(e.amount || 0), 0);
    const owed = data.loans.filter((l) => l.disbursed && l.status === "active").reduce((s, l) => s + Number(l.balance ?? l.amount ?? 0), 0);
    return { summary, rows, repaid, paidOut, owed, from };
  }, [data, period, account]);

  if (loading && !data) return <Spinner />;
  if (!data || !view) return <Notice tone="error" icon={AlertCircle}>Could not load the statement{error ? `: ${error}` : ""}.</Notice>;

  const who = data.mem?.name || "Member";
  const periodLabel = PERIODS.find((p) => p.key === period).label;
  const mismatch = view.summary.filter((s) => s.mismatch);

  const textSummary = () => [
    `${chama?.name} — statement for ${who} (${periodLabel})`,
    ...view.summary.map((s) => `${s.label}: opening ${formatKES(s.opening)}, in ${formatKES(s.inn)}, out ${formatKES(s.out)}, closing ${formatKES(s.closing)}`),
    `Loan owed now: ${view.owed > 0 ? formatKES(view.owed) : "none"}`,
  ].join("\n");

  const share = async () => {
    const text = textSummary();
    if (navigator.share) { try { await navigator.share({ title: "Chama statement", text }); return; } catch { /* cancelled */ } }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };

  const download = () => {
    const csv = toCSV(view.rows.map((e) => ({
      Date: formatDate(e.created_at), Account: ACCOUNT_LABEL[e.account_type] || e.account_type,
      Description: e.description || "", "Money in": e.direction === "credit" ? Number(e.amount) : "", "Money out": e.direction === "debit" ? Number(e.amount) : "",
    })));
    if (!csv) return;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `statement-${who.replace(/\s+/g, "-").toLowerCase()}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="cm-statement cm-print-area">
      <StaleNote fromCache={fromCache} cachedAt={cachedAt} online={online} />
      <div className="cm-print-only"><h2>{chama?.name}</h2><p>Statement for {who} · {periodLabel} · printed {formatDate(new Date())}</p></div>

      <div className="cm-toolbar cm-no-print">
        <div className="cm-chips">
          {PERIODS.map((p) => <button key={p.key} className={`cm-chip ${period === p.key ? "on" : ""}`} onClick={() => setPeriod(p.key)}>{p.label}</button>)}
        </div>
        <div className="cm-chips">
          <button className={`cm-chip ${account === "all" ? "on" : ""}`} onClick={() => setAccount("all")}>All</button>
          {ACCOUNTS.map((a) => <button key={a.key} className={`cm-chip ${account === a.key ? "on" : ""}`} onClick={() => setAccount(a.key)}>{a.label}</button>)}
        </div>
      </div>

      {!isSelf && <Notice icon={AlertCircle}>You are viewing {who}'s statement as a Chama official.</Notice>}

      <div className="cm-accs">
        {view.summary.map((s) => (
          <div className="cm-acc" key={s.key}>
            <div className="cm-acc-head"><span>{s.label}</span><strong>{formatKES(s.closing)}</strong></div>
            <div className="cm-acc-row">
              <div><span>Opening</span><b>{formatKES(s.opening)}</b></div>
              <div><span>Paid in</span><b>{formatKES(s.inn)}</b></div>
              <div><span>Paid out</span><b>{formatKES(s.out)}</b></div>
            </div>
          </div>
        ))}
      </div>

      {mismatch.length > 0 && (
        <Notice tone="warn" icon={AlertCircle}>
          {mismatch.map((s) => `${s.label}: records add up to ${formatKES(s.ledgerTotal)} but the balance on file is ${formatKES(s.onFile)}`).join(". ")}. Ask your treasurer to look into the difference — this statement shows the records as they are.
        </Notice>
      )}

      <SectionTitle>Loan</SectionTitle>
      <div className="cm-kv">
        <div><span>Loan paid out to you</span><strong>{formatKES(view.paidOut)}</strong></div>
        <div><span>Repaid in this period</span><strong>{formatKES(view.repaid)}</strong></div>
        <div><span>Still owed today</span><strong>{view.owed > 0 ? formatKES(view.owed) : "Nothing"}</strong></div>
      </div>

      <SectionTitle>What happened</SectionTitle>
      {view.rows.length === 0 ? <EmptyState>No entries in this period.</EmptyState> : (
        <ul className="cm-txns">
          {view.rows.map((e) => (
            <li key={e.id}>
              <div><strong>{ACCOUNT_LABEL[e.account_type] || e.account_type}</strong><small>{formatDate(e.created_at)}{e.description ? ` · ${e.description}` : ""}</small></div>
              <span className={e.direction === "credit" ? "in" : "out"}>{e.direction === "credit" ? "+" : "−"}{formatKES(e.amount)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="cm-actions-row cm-no-print">
        <button className="cm-btn" onClick={() => window.print()}><Printer size={15} /> Print / save as PDF</button>
        <button className="cm-btn" onClick={share}><Share2 size={15} /> Share</button>
        <button className="cm-btn" onClick={download} disabled={!view.rows.length}><Download size={15} /> Download (Excel)</button>
      </div>
    </div>
  );
}
