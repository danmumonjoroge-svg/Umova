import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import { postJournal } from "../../services/journalAPI";
import { getSystemAccount } from "../../services/chartOfAccountsAPI";
import "./LoanDisbursement.css";

export default function LoanDisbursement() {

  const [applications, setApplications] = useState([]);
  const [selectedLoan, setSelectedLoan] = useState(null);
  const [reference, setReference] = useState("");
  const [disbursementDate, setDisbursementDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);

  const n = (v) => Number(v || 0);

  const format = (v) =>
    Number(v || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  // ================= LOAD APPROVED (NOT YET DISBURSED) LOANS =================
  const loadApplications = async () => {

    setListLoading(true);

    const { data, error } = await supabase
      .from("loan_application")
      .select("*")
      .eq("status", "approved")
      .order("created_at", { ascending: false });

    if (!error) setApplications(data || []);

    setListLoading(false);
  };

  useEffect(() => {
    loadApplications();
  }, []);

  // ================= DISBURSE LOAN =================
  const disburseLoan = async () => {

    if (!selectedLoan) {
      alert("Select a loan first");
      return;
    }

    if (!reference) {
      alert("Enter M-Pesa / Bank Reference");
      return;
    }

    if (!disbursementDate) {
      alert("Select disbursement date");
      return;
    }

    setLoading(true);

    try {

      const amount = n(selectedLoan.amount);
      const totalInterest = n(selectedLoan.total_interest);

      // ================= 1. CREATE LOAN RECORD =================
      const { data: loan, error: loanError } = await supabase
        .from("loans")
        .insert([{
          member_no: selectedLoan.member_no,
          amount,
          loan_type: selectedLoan.loan_type,
          status: "active",

          disbursed_at: disbursementDate,
          reference_code: reference
        }])
        .select()
        .single();

      if (loanError) throw loanError;

      // ================= 2. POST TO ACCOUNTING — PRINCIPAL DISBURSEMENT =================
      // Routed through the central posting engine (journal_entries ->
      // journal_lines -> general_ledger) instead of writing general_ledger
      // directly, so this disbursement is traceable back to a journal entry
      // and validated for debit=credit before it's allowed to post.
      const glReference = `LN-${Date.now()}`;

      const loanReceivableAcct = await getSystemAccount("LOAN_RECEIVABLE");
      const cashAcct = await getSystemAccount("CASH");

      await postJournal({
        member_no: selectedLoan.member_no,
        reference: glReference,
        date: disbursementDate,
        description: `Loan Disbursement (Ext. Ref: ${reference})`,
        lines: [
          { account_id: loanReceivableAcct, debit: amount, credit: 0 },
          { account_id: cashAcct, debit: 0, credit: amount },
        ],
      });

      // ================= 3. POST TO ACCOUNTING — INTEREST CHARGE =================
      // Only post if the application carries a total_interest figure.
      // NOTE: this debits Interest Income and credits General Income, which
      // is the same treatment the pre-existing code used before this was
      // migrated to system-account lookups — worth a real accounting
      // review, since the more usual entry would debit a receivable and
      // credit Interest Income, not the reverse. Left unchanged here since
      // that's a business-logic decision, not a hardcoding cleanup.
      if (totalInterest > 0) {

        const intReference = `LN-INT-${Date.now()}`;
        const interestIncomeAcct = await getSystemAccount("INTEREST_INCOME");
        const generalIncomeAcct = await getSystemAccount("GENERAL_INCOME");

        await postJournal({
          member_no: selectedLoan.member_no,
          reference: intReference,
          date: disbursementDate,
          description: "Interest on Loan Charged",
          lines: [
            { account_id: interestIncomeAcct, debit: totalInterest, credit: 0 },
            { account_id: generalIncomeAcct, debit: 0, credit: totalInterest },
          ],
        });
      }

      // ================= 4. UPDATE APPLICATION STATUS =================
      const { error: appError } = await supabase
        .from("loan_application")
        .update({
          status: "disbursed",
          disbursed_at: disbursementDate,
          reference_code: reference
        })
        .eq("id", selectedLoan.id);

      if (appError) throw appError;

      alert("Loan Disbursed Successfully");

      // ================= 5. OPTIMISTIC + AUTHORITATIVE REFRESH =================
      // Remove immediately from the visible list so it can't be
      // double-clicked, then re-sync with the server.
      setApplications((prev) => prev.filter((a) => a.id !== selectedLoan.id));

      setSelectedLoan(null);
      setReference("");
      setDisbursementDate("");

      await loadApplications();

    } catch (err) {
      alert(err.message);
    }

    setLoading(false);
  };

  // ================= UI =================
  return (
    <div className="disbursementPage">

      <div className="header">
        <span className="eyebrow">Disbursement · Ledger 1011 / 1020 / 1007 / 1005</span>
        <h1>Loan Disbursement Engine</h1>
        <p>Approved applications awaiting payout. Disbursing posts principal and interest entries and removes the loan from this queue.</p>
      </div>

      <div className="layout">

        {/* LEFT: APPROVED APPLICATIONS */}
        <div className="panel">

          <h2>
            Approved — Awaiting Disbursement
            {applications.length > 0 && (
              <span className="badgeCount">{applications.length}</span>
            )}
          </h2>

          {listLoading ? (
            <p className="loadingText">Loading applications…</p>
          ) : applications.length === 0 ? (
            <p className="loadingText">No approved loans pending disbursement.</p>
          ) : (
            <div className="loanList">
              {applications.map((l) => (
                <div
                  key={l.id}
                  onClick={() => setSelectedLoan(l)}
                  className={`loanCard ${selectedLoan?.id === l.id ? "active" : ""}`}
                >
                  <div className="loanCardTop">
                    <span className="memberNo">{l.member_no}</span>
                    <span className="statusTag">{l.status}</span>
                  </div>
                  <div className="loanCardMeta">
                    {l.loan_type} · KES {format(l.amount)}
                  </div>
                  {n(l.total_interest) > 0 && (
                    <div className="loanCardInterest">
                      Interest to charge (1020): KES {format(l.total_interest)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

        </div>

        {/* RIGHT: DISBURSEMENT PANEL */}
        <div className="panel">

          <h2>Disburse Loan</h2>

          {selectedLoan ? (
            <>
              <div className="selectedSummary">
                <div className="snapRow">
                  <span>Member</span>
                  <strong>{selectedLoan.member_no}</strong>
                </div>
                <div className="snapRow">
                  <span>Product</span>
                  <strong>{selectedLoan.loan_type}</strong>
                </div>
                <div className="snapRow">
                  <span>Principal (1011)</span>
                  <strong>KES {format(selectedLoan.amount)}</strong>
                </div>
                {n(selectedLoan.total_interest) > 0 && (
                  <div className="snapRow">
                    <span>Interest Charge (1020)</span>
                    <strong className="interest">KES {format(selectedLoan.total_interest)}</strong>
                  </div>
                )}
                <div className="snapRow">
                  <span>Duration</span>
                  <strong>{selectedLoan.duration || "—"} mo</strong>
                </div>
              </div>

              <label className="field">
                <span>Disbursement Date</span>
                <input
                  type="date"
                  value={disbursementDate}
                  onChange={(e) => setDisbursementDate(e.target.value)}
                />
              </label>

              <label className="field">
                <span>M-Pesa / Bank Reference Code</span>
                <input
                  type="text"
                  placeholder="e.g. QFT5XJ2K9P"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>

              <div className="postingPreview">
                <div className="postingTitle">Postings on Disbursement</div>
                <div className="postingRow">
                  <span>Dr 1011 Loan Principal</span>
                  <strong>KES {format(selectedLoan.amount)}</strong>
                </div>
                <div className="postingRow">
                  <span>Cr 1007 Disbursement Clearing</span>
                  <strong>KES {format(selectedLoan.amount)}</strong>
                </div>
                {n(selectedLoan.total_interest) > 0 && (
                  <>
                    <div className="postingRow">
                      <span>Dr 1020 Interest on Loan</span>
                      <strong className="interest">KES {format(selectedLoan.total_interest)}</strong>
                    </div>
                    <div className="postingRow">
                      <span>Cr 1005 Interest Income</span>
                      <strong className="interest">KES {format(selectedLoan.total_interest)}</strong>
                    </div>
                  </>
                )}
              </div>

              <button
                className="btn btnPrimary"
                onClick={disburseLoan}
                disabled={loading}
              >
                {loading ? "Processing…" : "✓ Disburse Loan"}
              </button>
            </>
          ) : (
            <p className="loadingText">Select a loan application to disburse.</p>
          )}

        </div>

      </div>

    </div>
  );
}