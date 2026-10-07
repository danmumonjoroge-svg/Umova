import { useState, useMemo } from "react";
import { supabase } from "../../supabaseClient";
import { generateStatementPDF } from "../../utils/generateStatementPDF";
import {
  Page, SectionCard, Field, KpiCard, PrimaryButton, SecondaryButton,
  EmptyState, LoadingState, kes,
} from "./AdminUI";
import "./MemberStatements.css";

// Account ids used by the statement (same ids the PDF uses).
const ACC = { SAVINGS: 1018, SHARES: 1012, LOANS: 1011, LOAN_INT: 1020, SAV_INT: 1006 };

const PAGE = 1000;   // Supabase caps a response at 1000 rows → always page.
const CHUNK = 150;   // journal numbers per .in() request (keeps URL short).

// Read every row of a query, 1000 at a time.
async function fetchAll(build) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

const rowKey = (t) => t.id ?? t.cod ?? `${t.journal_no}|${t.line_no}|${t.date}|${t.amount}`;
const refOf = (t) => t.reference_no || t.journal_no || t.reference || "";

// Debit/credit shown from the member's point of view on each row.
function classify(t) {
  const dr = Number(t.debit_account_id) || 0;
  const cr = Number(t.credit_account_id) || 0;
  const amt = Number(t.amount) || 0;
  let label = "Other", memberDr = 0, memberCr = 0;
  if (dr === ACC.SAVINGS || cr === ACC.SAVINGS) { label = "Savings"; if (dr === ACC.SAVINGS) memberDr = amt; else memberCr = amt; }
  else if (dr === ACC.SHARES || cr === ACC.SHARES) { label = "Shares"; if (dr === ACC.SHARES) memberDr = amt; else memberCr = amt; }
  else if (dr === ACC.LOANS || cr === ACC.LOANS) { label = "Loan"; if (dr === ACC.LOANS) memberDr = amt; else memberCr = amt; }
  else if (dr === ACC.LOAN_INT || cr === ACC.LOAN_INT) { label = "Loan interest"; if (dr === ACC.LOAN_INT) memberDr = amt; else memberCr = amt; }
  else if (cr === ACC.SAV_INT || dr === ACC.SAV_INT) { label = "Savings interest"; memberCr = cr === ACC.SAV_INT ? amt : 0; memberDr = dr === ACC.SAV_INT ? amt : 0; }
  return { label, memberDr, memberCr };
}

export default function AdminMemberStatement() {
  const [memberNo, setMemberNo] = useState("");
  const [member, setMember] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loans, setLoans] = useState([]);
  const [selectedLoanId, setSelectedLoanId] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [newestFirst, setNewestFirst] = useState(true);

  const fetchStatement = async (loanOverride) => {
    const no = memberNo.trim();
    if (!no) return setResult({ ok: false, text: "Enter a member number." });
    setLoading(true);
    setResult(null);
    const activeLoan = loanOverride !== undefined ? loanOverride : selectedLoanId;

    try {
      const { data: m } = await supabase.from("members").select("*").eq("member_no", no).maybeSingle();

      const { data: loanAccounts } = await supabase
        .from("loan_account").select("*").eq("member_no", no)
        .order("disbursed_at", { ascending: false });
      setLoans(loanAccounts || []);

      const dateFilter = (q) => {
        if (fromDate) q = q.gte("date", fromDate);
        if (toDate) q = q.lte("date", toDate);
        if (activeLoan !== "all") q = q.eq("loan_id", activeLoan);
        return q;
      };

      // 1) rows stamped with the member number
      const direct = await fetchAll(() =>
        dateFilter(supabase.from("general_ledger").select("*").eq("member_no", no))
          .order("date", { ascending: true })
      );

      // 2) rows that belong to the member's journals but were stored WITHOUT a
      //    member_no (older posting code). journal_lines is the source of truth.
      let linked = [];
      try {
        const jl = await fetchAll(() => supabase.from("journal_lines").select("journal_id").eq("member_no", no));
        const ids = [...new Set(jl.map((r) => r.journal_id).filter(Boolean))];
        const refs = [];
        for (let i = 0; i < ids.length; i += CHUNK) {
          const { data } = await supabase.from("journal_entries").select("reference").in("id", ids.slice(i, i + CHUNK));
          (data || []).forEach((r) => r.reference && refs.push(r.reference));
        }
        for (let i = 0; i < refs.length; i += CHUNK) {
          const part = refs.slice(i, i + CHUNK);
          const rows = await fetchAll(() =>
            dateFilter(supabase.from("general_ledger").select("*").in("journal_no", part).is("member_no", null))
              .order("date", { ascending: true })
          );
          linked.push(...rows);
        }
      } catch (e) {
        console.warn("Journal-linked lookup skipped:", e.message || e);
      }

      const seen = new Set();
      const merged = [...direct, ...linked].filter((t) => {
        const k = rowKey(t);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      merged.sort((a, b) =>
        String(a.date || "").localeCompare(String(b.date || "")) ||
        String(a.created_at || "").localeCompare(String(b.created_at || "")) ||
        (Number(a.cod) || 0) - (Number(b.cod) || 0));

      setMember(m || null);
      setLedger(merged.map((t) => ({ ...t, amount: Number(t.amount || 0), ...classify(t) })));
      if (!m) setResult({ ok: false, text: `No member found with number ${no}. Showing ledger rows only.` });
    } catch (err) {
      setResult({ ok: false, text: `Failed to load statement: ${err.message || err}` });
    } finally {
      setLoading(false);
    }
  };

  const onMemberChange = (v) => {
    setMemberNo(v);
    setSelectedLoanId("all");
    setLoans([]);
    setMember(null);
    setLedger([]);
  };

  const selectedLoan = selectedLoanId === "all" ? null : loans.find((l) => l.loan_id === selectedLoanId);

  const summary = useMemo(() => ledger.reduce((a, t) => {
    const dr = Number(t.debit_account_id), cr = Number(t.credit_account_id), amt = t.amount;
    // Member's own balances: savings & shares are credit balances, loans are debit balances.
    if (cr === ACC.SAVINGS) a.savings += amt;
    if (dr === ACC.SAVINGS) a.savings -= amt;
    if (cr === ACC.SHARES) a.shares += amt;
    if (dr === ACC.SHARES) a.shares -= amt;
    if (dr === ACC.LOANS) a.loans += amt;
    if (cr === ACC.LOANS) a.loans -= amt;
    if (dr === ACC.LOAN_INT) { a.loans += amt; a.loan_interest += amt; }
    if (cr === ACC.LOAN_INT) { a.loans -= amt; a.loan_interest -= amt; }
    if (cr === ACC.SAV_INT) { a.savings += amt; a.savings_interest += amt; }
    if (dr === ACC.SAV_INT) { a.savings -= amt; a.savings_interest -= amt; }
    return a;
  }, { savings: 0, loans: 0, shares: 0, loan_interest: 0, savings_interest: 0 }), [ledger]);

  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    const rows = ledger.filter((t) =>
      (typeFilter === "all" || t.label === typeFilter) &&
      (!s || `${refOf(t)} ${t.description || ""}`.toLowerCase().includes(s)));
    return newestFirst ? [...rows].reverse() : rows;
  }, [ledger, typeFilter, search, newestFirst]);

  const types = useMemo(() => ["all", ...new Set(ledger.map((t) => t.label))], [ledger]);

  const downloadPDF = async () => {
    await generateStatementPDF(member, ledger, {
      summary, loan: selectedLoan || null, generated_at: new Date().toISOString(),
    });
  };

  return (
    <Page
      intro="Generate a member's statement from the general ledger. Includes the newest postings."
      result={result}
      onCloseResult={() => setResult(null)}
    >
      <SectionCard title="Statement filters">
        <div className="ms-filters">
          <Field label="Member number" htmlFor="ms-no">
            <input id="ms-no" value={memberNo} onChange={(e) => onMemberChange(e.target.value)}
              placeholder="e.g. TEST001" autoCapitalize="characters"
              onKeyDown={(e) => e.key === "Enter" && fetchStatement()} />
          </Field>
          <Field label="From" htmlFor="ms-from">
            <input id="ms-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </Field>
          <Field label="To" htmlFor="ms-to">
            <input id="ms-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </Field>
          {member && loans.length > 0 && (
            <Field label="Account" htmlFor="ms-loan">
              <select id="ms-loan" value={selectedLoanId}
                onChange={(e) => { setSelectedLoanId(e.target.value); fetchStatement(e.target.value); }}>
                <option value="all">All accounts (savings, loans, shares)</option>
                {loans.map((l) => (
                  <option key={l.loan_id} value={l.loan_id}>
                    {l.loan_id} — {l.loan_type || "Loan"} ({kes(l.outstanding_balance)} outstanding)
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <div className="ms-actions">
          <PrimaryButton onClick={() => fetchStatement()} disabled={loading}>
            {loading ? "Generating…" : "Generate statement"}
          </PrimaryButton>
          {member && <SecondaryButton onClick={downloadPDF}>Download PDF</SecondaryButton>}
        </div>
      </SectionCard>

      {loading && <LoadingState message="Loading statement…" />}

      {!loading && (member || ledger.length > 0) && (
        <>
          {member && (
            <SectionCard title={member.name || member.member_no} subtitle={member.member_no}>
              <div className="ms-kpis">
                <KpiCard label="Savings" value={kes(summary.savings)} />
                <KpiCard label="Shares" value={kes(summary.shares)} />
                <KpiCard label="Loan balance" value={kes(summary.loans)} />
                <KpiCard label="Loan interest due" value={kes(summary.loan_interest)} />
                <KpiCard label="Savings interest" value={kes(summary.savings_interest)} />
              </div>
            </SectionCard>
          )}

          {selectedLoan && (
            <SectionCard title={selectedLoan.loan_id} subtitle={`${selectedLoan.loan_type || "Loan"} • ${selectedLoan.status || ""}`}>
              <div className="ms-kpis">
                <KpiCard label="Principal" value={kes(selectedLoan.principal)} />
                <KpiCard label="Outstanding" value={kes(selectedLoan.outstanding_balance)} />
                <KpiCard label="Instalment" value={kes(selectedLoan.monthly_installment)} />
                <KpiCard label="Arrears (days)" value={selectedLoan.arrears_days || 0} />
              </div>
            </SectionCard>
          )}

          <SectionCard title="Transactions" subtitle={`${shown.length} of ${ledger.length} entries${ledger.length ? ` · latest posting ${ledger[ledger.length - 1].date}` : ""}`}>
            <div className="ms-filters">
              <Field label="Type">
                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                  {types.map((t) => <option key={t} value={t}>{t === "all" ? "All types" : t}</option>)}
                </select>
              </Field>
              <Field label="Order">
                <select value={newestFirst ? "new" : "old"} onChange={(e) => setNewestFirst(e.target.value === "new")}>
                  <option value="new">Newest first</option>
                  <option value="old">Oldest first</option>
                </select>
              </Field>
              <Field label="Search">
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Reference or description" />
              </Field>
            </div>

            {shown.length === 0 ? (
              <EmptyState title="No transactions" message="Nothing matches these filters." />
            ) : (
              <table className="ua-table stack">
                <thead>
                  <tr><th>Date</th><th>Ref</th><th>Type</th><th>Description</th>
                    <th className="num">Debit</th><th className="num">Credit</th><th className="num">Amount</th></tr>
                </thead>
                <tbody>
                  {shown.map((t) => (
                    <tr key={rowKey(t)}>
                      <td data-label="Date">{t.date}</td>
                      <td data-label="Ref">{refOf(t)}</td>
                      <td data-label="Type">{t.label}</td>
                      <td data-label="Description">{t.description}</td>
                      <td data-label="Debit" className="num ms-dr">{t.memberDr ? kes(t.memberDr) : "—"}</td>
                      <td data-label="Credit" className="num ms-cr">{t.memberCr ? kes(t.memberCr) : "—"}</td>
                      <td data-label="Amount" className="num"><b>{kes(t.amount)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </SectionCard>
        </>
      )}
    </Page>
  );
}
