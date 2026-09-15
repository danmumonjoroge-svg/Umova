import React, { useEffect, useMemo, useState } from "react";
import "./JournalEntry.css";
// Adjust this import to wherever your Supabase client is initialized.
// Expected shape: createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
import { supabase } from "../../supabaseClient";
import { postJournal as postJournalToEngine } from "../../services/journalAPI";

/**
 * Posts through the central journal-engine edge function
 * (journal_entries -> journal_lines -> general_ledger), instead of writing
 * general_ledger directly. general_ledger is still updated (via the edge
 * function) since ~30 other screens still read balances/status from it
 * directly, but journal_entries/journal_lines are now the traceable,
 * validated source of truth for every entry this page creates.
 */

const ACCOUNT_OPTIONS = [
  { id: "1001", name: "Computer" },
  { id: "1002", name: "Software" },
  { id: "1003", name: "Accumulated Depreciation - Computer" },
  { id: "1004", name: "Accumulated Depreciation - Software" },
  { id: "1005", name: "General Income" },
  { id: "1006", name: "Interest Receivable" },
  { id: "1007", name: "Cashbook" },
  { id: "1008", name: "CIC Bank" },
  { id: "1009", name: "Cash At Hand" },
  { id: "1010", name: "Inventory" },
  { id: "1011", name: "Loans Control Account" },
  { id: "1012", name: "Share Capital" },
  { id: "1013", name: "Retained Earnings" },
  { id: "1014", name: "Reserves" },
  { id: "1015", name: "Payables" },
  { id: "1016", name: "Interest Payables" },
  { id: "1017", name: "Other Loans" },
  { id: "1018", name: "Savings Control Account" },
  { id: "1019", name: "Other Payables" },
  { id: "1020", name: "Loan Interest Income" },
  { id: "1021", name: "Other Income" },
  { id: "1022", name: "Dividend Income" },
  { id: "1023", name: "Administrative Expenses" },
  { id: "1024", name: "Financial Expenses" },
  { id: "1025", name: "Governance Expenses" },
  { id: "1026", name: "Marketing Expenses" },
  { id: "1027", name: "Depreciation Expense" },
  { id: "1028", name: "IT Expenses" },
  { id: "1029", name: "Personnel Expenses" },
  { id: "1030", name: "Tax Expense" },
  { id: "1031", name: "Surplus" },
  { id: "1101", name: "Loan Interest Receivable" },
  { id: "1102", name: "Loan Penalty Receivable" },
  { id: "1103", name: "Loan Principal Receivable" },
  { id: "1999", name: "Suspense Account" },
  { id: "2101", name: "Member Deposit Control Account" },
  { id: "2102", name: "Share Capital Control Account" },
  { id: "2999", name: "Clearing Account" },
];

const TRANSACTION_TYPES = [
  "General Journal",
  "Savings Deposit",
  "Savings Withdrawal",
  "Share Capital",
  "Loan Disbursement",
  "Loan Repayment",
  "Interest Accrual",
  "Interest Payment",
  "Penalty Charge",
  "Penalty Payment",
  "Expense",
  "Income",
  "Asset Purchase",
  "Depreciation",
  "Adjustment",
  "Opening Balance",
  "Closing Entry",
  "Member Transfer",
  "Cash Transaction",
  "Bank Transaction",
];

const TRANSFER_TYPE_ACCOUNTS = {
  Savings: "1018", // Savings Control Account
  "Share Capital": "1012", // Share Capital
  Loan: "1011", // Loans Control Account
  Other: "1999", // Suspense Account
};

// UI-level workflow status. general_ledger.status is a separate, freer-form
// text field (PENDING / APPROVED / REVERSED / ...) written when we post.
const STATUS_LABELS = {
  Draft: "Draft",
  Posted: "Posted",
  Reversed: "Reversed",
};

const money = (value) =>
  Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// Round to cents to avoid floating point noise (e.g. 0.1 + 0.2) breaking the balance check.
const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const createJournalLine = (lineNo = 1) => ({
  id: crypto.randomUUID(),
  line_no: lineNo,
  account_id: "",
  member_no: "",
  debit_amount: "",
  credit_amount: "",
  narration: "",
});

const renumberLines = (lines) =>
  lines.map((line, index) => ({ ...line, line_no: index + 1 }));

const generateJournalId = () => {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const datePart = `${yyyy}${mm}${dd}`;
  const counterKey = `JV_COUNTER_${datePart}`;

  let counter = Number(localStorage.getItem(counterKey) || "0");
  counter += 1;
  localStorage.setItem(counterKey, counter);

  return `JV-${datePart}-${String(counter).padStart(6, "0")}`;
};

const todayDate = () => new Date().toISOString().split("T")[0];

const slugify = (text) => (text || "").toLowerCase().trim().replace(/\s+/g, "_");

const buildEmptyHeader = () => ({
  journal_id: generateJournalId(),
  posting_date: todayDate(),
  transaction_type: "General Journal",
  purpose: "",
  reference_no: "",
  description: "",
  status: "Draft",
  created_by: localStorage.getItem("full_name") || "",
  created_at: new Date().toISOString(),
  posted_by: "",
  posted_at: "",
});




const JournalEntry = () => {
  const [activeTab, setActiveTab] = useState("journal");
  const [journalHeader, setJournalHeader] = useState(buildEmptyHeader);
  const [journalLines, setJournalLines] = useState([
    createJournalLine(1),
    createJournalLine(2),
  ]);

  // Member register, read from public.members, used only to populate dropdowns.
  const [members, setMembers] = useState([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);

  const [searchText, setSearchText] = useState("");
  const [journalHistory, setJournalHistory] = useState([]);
  const [isPosting, setIsPosting] = useState(false);
  const [isReversing, setIsReversing] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Member Transfer tab state
  const [transfer, setTransfer] = useState({
    from_member_no: "",
    to_member_no: "",
    transfer_type: "Savings",
    amount: "",
    purpose: "",
    narration: "",
  });
  const [isTransferring, setIsTransferring] = useState(false);

  useEffect(() => {
    fetchMembers();
    fetchJournalHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const fetchMembers = async () => {
    setIsLoadingMembers(true);
    try {
      const { data, error } = await supabase
        .from("members")
        .select("member_no, name")
        .order("name", { ascending: true });

      if (error) throw error;
      setMembers(data || []);
    } catch (error) {
      console.error("Failed to load members", error);
    } finally {
      setIsLoadingMembers(false);
    }
  };

  // Pulls every general_ledger row that belongs to a journal (journal_no is
  // set) and groups the lines back into journal-level summaries for the
  // History table below.
  const fetchJournalHistory = async () => {
    setIsLoadingHistory(true);

    try {
      const { data, error } = await supabase
        .from("general_ledger")
        .select("*")
        .not("journal_no", "is", null)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const grouped = {};

      for (const row of data || []) {
        if (!grouped[row.journal_no]) {
          grouped[row.journal_no] = {
            journal_id: row.journal_no,
            posting_date: row.date,
            transaction_type: row.type,
            purpose: row.description,
            reference_no: row.reference_no,
            status: row.reversed ? "REVERSED" : row.status || "PENDING",
            lines: [],
          };
        }
        grouped[row.journal_no].lines.push(row);
      }

      setJournalHistory(Object.values(grouped));
    } catch (error) {
      console.error("Failed to load journal history", error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const debitTotal = useMemo(
    () =>
      round2(
        journalLines.reduce((sum, row) => sum + Number(row.debit_amount || 0), 0)
      ),
    [journalLines]
  );

  const creditTotal = useMemo(
    () =>
      round2(
        journalLines.reduce((sum, row) => sum + Number(row.credit_amount || 0), 0)
      ),
    [journalLines]
  );

  const difference = useMemo(
    () => round2(debitTotal - creditTotal),
    [debitTotal, creditTotal]
  );

  const isEditable = journalHeader.status === "Draft";

  const updateHeader = (field, value) => {
    if (!isEditable) return;
    setJournalHeader((prev) => ({ ...prev, [field]: value }));
  };

  // Typing an amount into one side of a line clears the other side, since a
  // single journal line can only be a debit OR a credit, never both.
  const updateLine = (id, field, value) => {
    if (!isEditable) return;

    setJournalLines((prev) =>
      prev.map((line) => {
        if (line.id !== id) return line;

        if (field === "debit_amount") {
          return {
            ...line,
            debit_amount: value,
            credit_amount: value ? "" : line.credit_amount,
          };
        }

        if (field === "credit_amount") {
          return {
            ...line,
            credit_amount: value,
            debit_amount: value ? "" : line.debit_amount,
          };
        }

        return { ...line, [field]: value };
      })
    );
  };

  const addLine = () => {
    if (!isEditable) return;
    setJournalLines((prev) => [...prev, createJournalLine(prev.length + 1)]);
  };

  const duplicateLine = (id) => {
    if (!isEditable) return;

    const selected = journalLines.find((x) => x.id === id);
    if (!selected) return;

    const copy = { ...selected, id: crypto.randomUUID() };
    setJournalLines((prev) => renumberLines([...prev, copy]));
  };

  const deleteLine = (id) => {
    if (!isEditable) return;
    if (journalLines.length <= 2) {
      alert("A journal entry needs at least two lines (one debit and one credit).");
      return;
    }

    setJournalLines((prev) => renumberLines(prev.filter((x) => x.id !== id)));
  };

  const clearJournal = () => {
    setJournalHeader(buildEmptyHeader());
    setJournalLines([createJournalLine(1), createJournalLine(2)]);
  };

  const validateJournal = () => {
    if (!journalHeader.posting_date) {
      alert("Posting Date is required.");
      return false;
    }

    if (!journalHeader.purpose.trim()) {
      alert("Purpose is required.");
      return false;
    }

    if (journalLines.length < 2) {
      alert("A journal entry needs at least two lines (one debit and one credit).");
      return false;
    }

    let hasDebit = false;
    let hasCredit = false;

    for (const line of journalLines) {
      if (!line.account_id) {
        alert(`Line ${line.line_no}: Account is required.`);
        return false;
      }

      const debit = Number(line.debit_amount || 0);
      const credit = Number(line.credit_amount || 0);

      if (debit > 0 && credit > 0) {
        alert(`Line ${line.line_no}: enter an amount in only one of Debit or Credit, not both.`);
        return false;
      }

      if (debit <= 0 && credit <= 0) {
        alert(`Line ${line.line_no}: enter a Debit or Credit amount greater than zero.`);
        return false;
      }

      if (debit > 0) hasDebit = true;
      if (credit > 0) hasCredit = true;
    }

    if (!hasDebit || !hasCredit) {
      alert("A journal entry needs at least one Debit line and one Credit line.");
      return false;
    }

    if (difference !== 0) {
      alert(
        `Journal is not balanced. Total Debit (${money(debitTotal)}) must equal Total Credit (${money(
          creditTotal
        )}). Difference: ${money(difference)}.`
      );
      return false;
    }

    return true;
  };

  // Draft is intentionally local-only: general_ledger has no draft/workflow
  // table backing it, so nothing is written to Supabase until Post.
  const saveDraft = () => {
    const draft = {
      ...journalHeader,
      lines: journalLines,
      saved_at: new Date().toISOString(),
    };

    console.log("Draft Saved", draft);
    alert("Draft saved successfully (local only — not yet posted to the ledger).");
  };

  const postJournalEntry = async () => {
    if (journalHeader.status !== "Draft") {
      alert("Only Draft journals can be posted.");
      return;
    }

    if (!validateJournal()) return;

    setIsPosting(true);

    try {
      const lines = journalLines.map((line) => ({
        account_id: Number(line.account_id),
        debit: Number(line.debit_amount || 0),
        credit: Number(line.credit_amount || 0),
        member_no: line.member_no || null, // per-line member, e.g. inter-member transfers
        description: line.narration || journalHeader.purpose,
      }));

      await postJournalToEngine({
        reference: journalHeader.reference_no || journalHeader.journal_id,
        description: journalHeader.purpose,
        date: journalHeader.posting_date,
        lines,
      });

      const postedBy = localStorage.getItem("full_name") || "";
      const postedAt = new Date().toISOString();

      setJournalHeader((prev) => ({
        ...prev,
        status: "Posted",
        posted_by: postedBy,
        posted_at: postedAt,
      }));

      await fetchJournalHistory();
      alert("Journal posted.");
    } catch (error) {
      console.error("Failed to post journal", error);
      alert(`Failed to post journal: ${error.message || error}`);
    } finally {
      setIsPosting(false);
    }
  };

  // A reversal is its own posted journal, with debit/credit swapped on every
  // line. It's linked back to the original journal_entries row via
  // reversal_of/reversed — never a silent local status flip.
  const reverseJournal = async () => {
    if (journalHeader.status !== "Posted") {
      alert("Only Posted journals can be reversed.");
      return;
    }

    if (!window.confirm("Reverse this journal? This will post an offsetting reversal entry.")) {
      return;
    }

    setIsReversing(true);

    try {
      const reversalId = generateJournalId();
      const originalReference = journalHeader.reference_no || journalHeader.journal_id;

      // Look up the original journal_entries row so both sides can be
      // linked by id, not just by reference text.
      const { data: originalEntry, error: lookupError } = await supabase
        .from("journal_entries")
        .select("id")
        .eq("reference", originalReference)
        .single();
      if (lookupError) throw lookupError;

      const reversalLines = journalLines.map((line) => ({
        account_id: Number(line.account_id),
        debit: Number(line.credit_amount || 0),
        credit: Number(line.debit_amount || 0),
        member_no: line.member_no || null,
        description: line.narration || `Reversal of ${originalReference}`,
      }));

      // post_journal (Postgres RPC) returns { journal_entry_id, reference,
      // total_debit, total_credit } — a known, fixed shape, unlike the
      // edge function this used to guess at.
      const reversalResult = await postJournalToEngine({
        reference: reversalId,
        description: `Reversal of ${originalReference}: ${journalHeader.purpose}`,
        date: todayDate(),
        lines: reversalLines,
      });
      const reversalEntryId = reversalResult?.journal_entry_id || null;

      if (reversalEntryId) {
        const { error: linkError } = await supabase
          .from("journal_entries")
          .update({ reversal_of: originalEntry.id })
          .eq("id", reversalEntryId);
        if (linkError) throw linkError;
      }

      const { error: updateError } = await supabase
        .from("journal_entries")
        .update({ reversed: true })
        .eq("id", originalEntry.id);
      if (updateError) throw updateError;

      // Keep the legacy general_ledger flags in sync too, since ~30 other
      // screens still read status/reversed directly off general_ledger.
      await supabase
        .from("general_ledger")
        .update({
          reversed: true,
          reversal_reference: reversalId,
          status: "REVERSED",
        })
        .eq("journal_no", originalReference);

      setJournalHeader((prev) => ({
        ...prev,
        status: "Reversed",
      }));

      await fetchJournalHistory();
      alert(`Journal reversed. Reversal entry ${reversalId} has been posted.`);
    } catch (error) {
      console.error("Failed to reverse journal", error);
      alert(`Failed to reverse journal: ${error.message || error}`);
    } finally {
      setIsReversing(false);
    }
  };

  const updateTransfer = (field, value) => {
    setTransfer((prev) => ({ ...prev, [field]: value }));
  };

  // Builds a balanced two-line journal (debit the receiving member's
  // control account, credit the sending member's control account) and
  // posts it straight to general_ledger, same as a manual journal.
  const postTransfer = async () => {
    const { from_member_no, to_member_no, transfer_type, amount, purpose, narration } = transfer;

    if (!from_member_no || !to_member_no) {
      alert("Select both a From Member and a To Member.");
      return;
    }
    if (from_member_no === to_member_no) {
      alert("From Member and To Member must be different.");
      return;
    }
    const amt = Number(amount || 0);
    if (amt <= 0) {
      alert("Enter a transfer amount greater than zero.");
      return;
    }
    if (!purpose.trim()) {
      alert("Purpose is required.");
      return;
    }

    setIsTransferring(true);

    try {
      const accountId = TRANSFER_TYPE_ACCOUNTS[transfer_type] || TRANSFER_TYPE_ACCOUNTS.Other;
      const transferJournalId = generateJournalId();

      await postJournalToEngine({
        reference: transferJournalId,
        description: purpose,
        date: todayDate(),
        lines: [
          {
            account_id: Number(accountId),
            debit: 0,
            credit: amt,
            member_no: to_member_no,
            description: narration || `Transfer out to ${to_member_no}`,
          },
          {
            account_id: Number(accountId),
            debit: amt,
            credit: 0,
            member_no: from_member_no,
            description: narration || `Transfer in from ${from_member_no}`,
          },
        ],
      });

      await fetchJournalHistory();
      alert(`Transfer posted to the General Ledger as ${transferJournalId}.`);

      setTransfer({
        from_member_no: "",
        to_member_no: "",
        transfer_type: "Savings",
        amount: "",
        purpose: "",
        narration: "",
      });
    } catch (error) {
      console.error("Failed to post transfer", error);
      alert(`Failed to post transfer: ${error.message || error}`);
    } finally {
      setIsTransferring(false);
    }
  };

  const filteredHistory = useMemo(() => {
    if (!searchText.trim()) return journalHistory;

    const needle = searchText.toLowerCase();

    return journalHistory.filter((journal) => {
      return (
        (journal.journal_id || "").toLowerCase().includes(needle) ||
        (journal.purpose || "").toLowerCase().includes(needle) ||
        (journal.transaction_type || "").toLowerCase().includes(needle) ||
        (journal.reference_no || "").toLowerCase().includes(needle)
      );
    });
  }, [journalHistory, searchText]);

  // Reusable member dropdown: every "member" field in this screen renders
  // through this so the list always comes from the members table.
  const MemberSelect = ({ value, onChange, disabled, placeholder = "Select member" }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">{isLoadingMembers ? "Loading members..." : placeholder}</option>
      {members.map((m) => (
        <option key={m.member_no} value={m.member_no}>
          {m.member_no} - {m.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="journal-entry-container">
      {/* ================= HEADER ================= */}
      <div className="journal-header">
        <div className="journal-title">
          <span className="eyebrow">General Ledger</span>
          <h2>Journal Entry</h2>
        </div>

        <div className="journal-actions">
          <button className="btn btn-primary" onClick={clearJournal}>
            New Journal
          </button>

          <button className="btn btn-secondary" onClick={saveDraft} disabled={!isEditable}>
            Save Draft
          </button>

          <button
            className="btn btn-success"
            disabled={isPosting || !isEditable}
            onClick={postJournalEntry}
          >
            {isPosting ? "Posting…" : "Post"}
          </button>

          <button
            className="btn btn-danger"
            disabled={isReversing || journalHeader.status !== "Posted"}
            onClick={reverseJournal}
          >
            {isReversing ? "Reversing…" : "Reverse"}
          </button>
        </div>
      </div>

      {/* ================= TABS ================= */}
      <div className="journal-tabs">
        <button
          className={activeTab === "journal" ? "active" : ""}
          onClick={() => setActiveTab("journal")}
        >
          Manual Journal
        </button>

        <button
          className={activeTab === "transfer" ? "active" : ""}
          onClick={() => setActiveTab("transfer")}
        >
          Member Transfer
        </button>
      </div>

      {/* ================= HEADER DETAILS ================= */}
      {activeTab === "journal" && (
        <>
          <div className="journal-card">
            <div className="journal-grid">
              <div className="form-group">
                <label>Journal ID</label>
                <input value={journalHeader.journal_id} readOnly />
              </div>

              <div className="form-group">
                <label>Posting Date</label>
                <input
                  type="date"
                  value={journalHeader.posting_date}
                  onChange={(e) => updateHeader("posting_date", e.target.value)}
                  disabled={!isEditable}
                />
              </div>

              <div className="form-group">
                <label>Transaction Type</label>
                <select
                  value={journalHeader.transaction_type}
                  onChange={(e) => updateHeader("transaction_type", e.target.value)}
                  disabled={!isEditable}
                >
                  {TRANSACTION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Status</label>
                {/* Status is set only by Post / Reverse — never typed directly. */}
                <input value={STATUS_LABELS[journalHeader.status]} readOnly />
              </div>

              <div className="form-group full-width">
                <label>Purpose</label>
                <input
                  value={journalHeader.purpose}
                  onChange={(e) => updateHeader("purpose", e.target.value)}
                  disabled={!isEditable}
                />
              </div>

              <div className="form-group">
                <label>Reference Number</label>
                <input
                  value={journalHeader.reference_no}
                  onChange={(e) => updateHeader("reference_no", e.target.value)}
                  disabled={!isEditable}
                />
              </div>

              <div className="form-group">
                <label>Created By</label>
                <input value={journalHeader.created_by} readOnly />
              </div>

              <div className="form-group full-width">
                <label>Description / Narration</label>
                <textarea
                  rows="3"
                  value={journalHeader.description}
                  onChange={(e) => updateHeader("description", e.target.value)}
                  disabled={!isEditable}
                />
              </div>
            </div>
          </div>

          {/* ================= JOURNAL LINES ================= */}
          <div className="journal-card">
            <div className="card-header">
              <h3>Journal Lines</h3>
              <button className="btn btn-primary" onClick={addLine} disabled={!isEditable}>
                + Add Line
              </button>
            </div>

            <div className="table-responsive">
              <table className="journal-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Account</th>
                    <th>Member</th>
                    <th>Debit</th>
                    <th>Credit</th>
                    <th>Narration</th>
                    <th>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {journalLines.map((line) => (
                    <tr key={line.id}>
                      <td>{line.line_no}</td>

                      <td>
                        <select
                          value={line.account_id}
                          onChange={(e) => updateLine(line.id, "account_id", e.target.value)}
                          disabled={!isEditable}
                        >
                          <option value="">Select Account</option>
                          {ACCOUNT_OPTIONS.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.id} - {account.name}
                            </option>
                          ))}
                        </select>
                      </td>

                      <td>
                        <MemberSelect
                          value={line.member_no}
                          onChange={(value) => updateLine(line.id, "member_no", value)}
                          disabled={!isEditable}
                          placeholder="No member"
                        />
                      </td>

                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={line.debit_amount}
                          onChange={(e) => updateLine(line.id, "debit_amount", e.target.value)}
                          disabled={!isEditable}
                        />
                      </td>

                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={line.credit_amount}
                          onChange={(e) => updateLine(line.id, "credit_amount", e.target.value)}
                          disabled={!isEditable}
                        />
                      </td>

                      <td>
                        <input
                          type="text"
                          placeholder="Narration"
                          value={line.narration}
                          onChange={(e) => updateLine(line.id, "narration", e.target.value)}
                          disabled={!isEditable}
                        />
                      </td>

                      <td>
                        <div className="row-actions">
                          <button
                            className="btn btn-info"
                            onClick={() => duplicateLine(line.id)}
                            disabled={!isEditable}
                          >
                            Duplicate
                          </button>

                          <button
                            className="btn btn-danger"
                            onClick={() => deleteLine(line.id)}
                            disabled={!isEditable}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ================= JOURNAL TOTALS ================= */}
          <div className="journal-summary">
            <div className="summary-card">
              <h4>Journal Summary</h4>

              <div className="summary-row">
                <span>Total Debit</span>
                <strong>{money(debitTotal)}</strong>
              </div>

              <div className="summary-row">
                <span>Total Credit</span>
                <strong>{money(creditTotal)}</strong>
              </div>

              <div className="summary-row">
                <span>Difference</span>
                <strong className={difference === 0 ? "balanced" : "not-balanced"}>
                  {money(difference)}
                </strong>
              </div>

              <div className={`summary-status ${difference === 0 ? "ok" : "warn"}`}>
                {difference === 0 ? "Journal balanced" : "Journal not balanced"}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ================= MEMBER TRANSFER ================= */}
      {activeTab === "transfer" && (
        <div className="journal-card">
          <div className="card-header">
            <h3>Member to Member Transfer</h3>
          </div>

          <div className="journal-grid">
            <div className="form-group">
              <label>From Member</label>
              <MemberSelect
                value={transfer.from_member_no}
                onChange={(value) => updateTransfer("from_member_no", value)}
              />
            </div>

            <div className="form-group">
              <label>To Member</label>
              <MemberSelect
                value={transfer.to_member_no}
                onChange={(value) => updateTransfer("to_member_no", value)}
              />
            </div>

            <div className="form-group">
              <label>Transfer Type</label>
              <select
                value={transfer.transfer_type}
                onChange={(e) => updateTransfer("transfer_type", e.target.value)}
              >
                {Object.keys(TRANSFER_TYPE_ACCOUNTS).map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Amount</label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={transfer.amount}
                onChange={(e) => updateTransfer("amount", e.target.value)}
              />
            </div>

            <div className="form-group full-width">
              <label>Purpose</label>
              <input
                type="text"
                placeholder="Reason for transfer"
                value={transfer.purpose}
                onChange={(e) => updateTransfer("purpose", e.target.value)}
              />
            </div>

            <div className="form-group full-width">
              <label>Narration</label>
              <textarea
                rows="3"
                value={transfer.narration}
                onChange={(e) => updateTransfer("narration", e.target.value)}
              />
            </div>
          </div>

          <div className="transfer-actions">
            <button className="btn btn-success" disabled={isTransferring} onClick={postTransfer}>
              {isTransferring ? "Posting…" : "Post Transfer"}
            </button>
            <button className="btn btn-secondary" onClick={() => setActiveTab("journal")}>
              Back to Journal
            </button>
          </div>
        </div>
      )}

      {/* ================= SEARCH ================= */}
      <div className="journal-card">
        <div className="card-header">
          <h3>Journal Search</h3>
        </div>

        <div className="search-box">
          <input
            type="text"
            placeholder="Search Journal ID, Purpose, Reference..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
      </div>

      {/* ================= HISTORY ================= */}
      <div className="journal-card">
        <div className="card-header">
          <h3>Journal History</h3>
          <button className="btn btn-secondary" onClick={fetchJournalHistory} disabled={isLoadingHistory}>
            {isLoadingHistory ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div className="table-responsive">
          <table className="journal-table">
            <thead>
              <tr>
                <th>Journal No</th>
                <th>Date</th>
                <th>Transaction Type</th>
                <th>Purpose / Description</th>
                <th>Reference</th>
                <th>Lines</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>
              {filteredHistory.length === 0 ? (
                <tr>
                  <td colSpan="7" className="empty-cell">
                    {isLoadingHistory ? "Loading..." : "No journals found"}
                  </td>
                </tr>
              ) : (
                filteredHistory.map((journal) => (
                  <tr key={journal.journal_id}>
                    <td>{journal.journal_id}</td>
                    <td>{journal.posting_date}</td>
                    <td>{journal.transaction_type}</td>
                    <td>{journal.purpose}</td>
                    <td>{journal.reference_no}</td>
                    <td>{journal.lines.length}</td>
                    <td>
                      <span className={`status-badge status-${slugify(journal.status)}`}>
                        {journal.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default JournalEntry;