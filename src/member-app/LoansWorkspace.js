import React, { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { Card, PageHeader, TxRow, kes, shortDate } from "./ui";

const DONE = ["PAID", "COMPLETED", "SETTLED"];

// Real data only: schedule from loan_schedule, applications from loan_application,
// repayments from the member ledger. Anything missing shows as "not available".
function useLoanData(memberNo) {
  const [state, setState] = useState({ schedule: null, applications: [] });
  useEffect(() => {
    if (!memberNo) return;
    let live = true;
    (async () => {
      const [s, a] = await Promise.all([
        supabase.from("loan_schedule").select("*").eq("member_no", memberNo).order("due_date", { ascending: true }),
        supabase.from("loan_application").select("id,loan_type,amount,duration,status,created_at,monthly_installment")
          .eq("member_no", memberNo).order("created_at", { ascending: false }).limit(20),
      ]);
      if (live) setState({ schedule: s.error ? null : s.data || [], applications: a.error ? [] : a.data || [] });
    })();
    return () => { live = false; };
  }, [memberNo]);
  return state;
}

export default function LoansWorkspace() {
  const { memberNo, ledger, ledgerLoading, ledgerMetrics } = useOutletContext();
  const { schedule, applications } = useLoanData(memberNo);
  const owing = ledgerMetrics.loans;
  const pending = schedule ? schedule.filter((r) => !DONE.includes(String(r.status).toUpperCase())) : null;
  const next = pending && pending[0];
  const overdue = next && new Date(next.due_date) < new Date(new Date().toDateString());
  const repayments = ledger.loans.transactions.filter((t) => t.direction === "in");

  let status = "No active loan";
  if (owing > 0) status = !schedule ? "Repayment schedule not available" : overdue ? "Payment overdue" : "Up to date";

  return (
    <>
      <PageHeader title="My Loans" description="Everything about your loan on one screen." />
      <div className="uma-grid c2">
        <Card tone="green" title="Outstanding balance" amount={ledgerLoading ? "…" : kes(owing)}
          note={owing > 0 ? "Includes interest charged" : "You have no outstanding loan"}>
          <div style={{ marginTop: 8 }}><span className={`uma-pill${overdue ? " uma-pill--warn" : ""}`}>{status}</span></div>
        </Card>
        <Card title="Next repayment"
          amount={next ? kes(next.total ?? next.amount) : "—"}
          note={next ? `Due ${shortDate(next.due_date)}` : owing > 0 ? "No schedule on record for this loan" : "Nothing due"} />
      </div>
      <div className="uma-actions">
        <Link className="uma-btn" to="/member/loans/manage?action=apply">Apply for Loan</Link>
        <Link className="uma-btn uma-btn--ghost" to="/member/loans/manage?action=statement">Loan Statement</Link>
        <Link className="uma-btn uma-btn--ghost" to="/member/loans/manage?action=apply">Loan Rules & Eligibility</Link>
      </div>

      {pending && pending.length > 0 && (
        <section className="uma-card" style={{ marginTop: 12 }}>
          <h3>Loan schedule</h3>
          <div className="uma-scroll">
            {pending.slice(0, 12).map((r, i) => (
              <div className="uma-row" key={r.id || i}>
                <span>{shortDate(r.due_date)}</span><b>{kes(r.total)}</b>
                <span className="uma-note">Balance {kes(r.balance)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="uma-card" style={{ marginTop: 12 }}>
        <h3>Repayment history</h3>
        {repayments.length === 0 ? <p className="uma-empty">No repayments recorded yet.</p>
          : [...repayments].reverse().slice(0, 10).map((t, i) => <TxRow key={t.id || i} tx={t} label="Repayment" />)}
      </section>

      <section className="uma-card" style={{ marginTop: 12 }}>
        <h3>Loan history</h3>
        {applications.length === 0 ? <p className="uma-empty">No loan applications yet.</p>
          : applications.map((a) => (
            <div className="uma-row" key={a.id}>
              <div><b>{String(a.loan_type || "Loan").replace(/_/g, " ")}</b>
                <div className="uma-note">{shortDate(a.created_at)}{a.duration ? ` · ${a.duration} months` : ""}</div></div>
              <div style={{ textAlign: "right" }}><b>{kes(a.amount)}</b>
                <div className="uma-note" style={{ textTransform: "capitalize" }}>{a.status}</div></div>
            </div>
          ))}
      </section>
    </>
  );
}
