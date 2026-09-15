import { useEffect, useState, useMemo } from "react";
import { supabase } from "../../supabaseClient";
import { generateReceiptPDF } from "../../utils/generateReceiptPDF";
import logo from "../../asset/logo/umovalogo.png";
import { postJournal } from "../../services/journalAPI";
import { getSystemAccount } from "../../services/chartOfAccountsAPI";

// Loaded from chart_of_accounts (system_account_key) at mount instead of
// hardcoded — see SYSTEM_ACCOUNT_KEYS below and the useEffect that
// resolves them. Keeping the { code, name } shape the existing dropdown
// already expects.
const SYSTEM_ACCOUNT_KEYS = [
  { key: "CASH", name: "Cash" },
  { key: "MEMBER_SAVINGS", name: "Savings" },
  { key: "LOAN_RECEIVABLE", name: "Loans" },
  { key: "INTEREST_INCOME", name: "Interest" },
  { key: "SHARE_CAPITAL", name: "Share Capital" },
];

const num = (v) => (v === "" || v === null || isNaN(v) ? 0 : Number(v));

export default function Payments() {
  const [members, setMembers] = useState([]);
  const [ledger, setLedger] = useState([]);

  const [memberNo, setMemberNo] = useState("");
  const [memberName, setMemberName] = useState("");

  const [receiptCode, setReceiptCode] = useState("");
  const [mode, setMode] = useState("M-Pesa");

  const [transactionDate, setTransactionDate] = useState("");

  const [allocations, setAllocations] = useState([
    { account: "", amount: "" },
  ]);

  const [loading, setLoading] = useState(false);
  const [accountIds, setAccountIds] = useState(null); // { CASH: id, MEMBER_SAVINGS: id, ... }
  const [accountsLoading, setAccountsLoading] = useState(true);

  // ================= LOAD =================
  useEffect(() => {
    fetchMembers();
    fetchLedger();
    loadSystemAccounts();
  }, []);

  const loadSystemAccounts = async () => {
    setAccountsLoading(true);
    try {
      const resolved = {};
      for (const { key } of SYSTEM_ACCOUNT_KEYS) {
        resolved[key] = await getSystemAccount(key);
      }
      setAccountIds(resolved);
      // Default allocation now that we know MEMBER_SAVINGS's real id.
      setAllocations([{ account: resolved.MEMBER_SAVINGS, amount: "" }]);
    } catch (err) {
      console.error("Failed to resolve system accounts", err);
      alert(`Failed to load Chart of Accounts mapping: ${err.message || err}`);
    } finally {
      setAccountsLoading(false);
    }
  };


  const fetchMembers = async () => {
    const { data } = await supabase.from("members").select("*");
    setMembers(data || []);
  };

  const fetchLedger = async () => {
    const { data } = await supabase
      .from("general_ledger")
      .select("*")
      .order("date", { ascending: false });

    setLedger(data || []);
  };

  // ================= MEMBER =================
  const selectMember = (no) => {
    setMemberNo(no);
    const m = members.find((x) => x.member_no === no);
    setMemberName(m?.name || "");
  };

  // ================= ALLOCATIONS =================
  const updateAllocation = (i, field, value) => {
    const copy = [...allocations];
    copy[i][field] = value;
    setAllocations(copy);
  };

  const addRow = () => {
    setAllocations([...allocations, { account: accountIds?.MEMBER_SAVINGS || "", amount: "" }]);
  };

  const removeRow = (i) => {
    const copy = allocations.filter((_, idx) => idx !== i);
    setAllocations(copy.length ? copy : [{ account: accountIds?.MEMBER_SAVINGS || "", amount: "" }]);
  };

  const total = useMemo(
    () => allocations.reduce((s, a) => s + num(a.amount), 0),
    [allocations]
  );

  // ================= VALIDATION =================
  const validate = () => {
    if (!memberNo) return "Select member";
    if (!receiptCode) return "Enter receipt code";
    if (!transactionDate) return "Enter transaction date";
    if (total <= 0) return "Amount must be greater than 0";

    const sumAlloc = allocations.reduce((s, a) => s + num(a.amount), 0);
    if (sumAlloc !== total) return "Allocation must equal total";

    return null;
  };

  // ================= POST PAYMENT =================
  const submitPayment = async () => {
    const errorMsg = validate();
    if (errorMsg) return alert(errorMsg);

    if (!accountIds) {
      alert("Chart of Accounts mapping hasn't loaded yet — please wait a moment and try again.");
      return;
    }

    setLoading(true);

    try {
      // Routed through the central posting engine instead of writing
      // general_ledger directly. This also fixes a pre-existing bug: the
      // old code wrote the cash debit and each allocation credit as
      // separate incomplete rows (debit_account_id set with
      // credit_account_id null, and vice versa), which isn't a valid
      // double-entry line anywhere else in the app. This is one balanced
      // journal: a single debit to cash for the full amount, and one
      // credit line per allocation.
      await postJournal({
        member_no: memberNo,
        reference: receiptCode,
        date: transactionDate,
        description: `Payment received (${mode})`,
        lines: [
          { account_id: accountIds.CASH, debit: total, credit: 0 },
          ...allocations.map((a) => ({
            account_id: Number(a.account),
            debit: 0,
            credit: num(a.amount),
          })),
        ],
      });

      alert("✅ Payment posted successfully");

      setMemberNo("");
      setMemberName("");
      setReceiptCode("");
      setTransactionDate("");
      setAllocations([{ account: accountIds.MEMBER_SAVINGS, amount: "" }]);

      fetchLedger();
    } catch (e) {
      alert(e.message);
    }

    setLoading(false);
  };

  // ================= LOGO =================
  const getBase64 = async (imgPath) => {
    const res = await fetch(imgPath);
    const blob = await res.blob();

    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  };

  // ================= DOWNLOAD =================
  const downloadReceipt = async (row) => {
    try {
      const { data } = await supabase
        .from("general_ledger")
        .select("*")
        .eq("reference", row.reference);

      const logoBase64 = await getBase64(logo);

      await generateReceiptPDF(data, row.reference, logoBase64);
    } catch (err) {
      alert("Download failed");
    }
  };

  // ================= APPROVE =================
  const approve = async (row) => {
    await supabase
      .from("general_ledger")
      .update({ status: "APPROVED" })
      .eq("reference", row.reference);

    fetchLedger();
    alert("✅ Approved");
  };

  return (
    <div className="payments">

      {/* HEADER */}
      <div className="header">
        <h2>💳 Payments Terminal</h2>
        <p>Core Banking Dashboard</p>
      </div>

      <div className="grid">

        {/* ================= PAYMENT CARD ================= */}
        <div className="card payment-card">

          <h3>New Payment</h3>

          <div className="form-grid-3">

            <div>
              <label>Member</label>
              <select value={memberNo} onChange={(e) => selectMember(e.target.value)}>
                <option value="">Select Member</option>
                {members.map((m) => (
                  <option key={m.id} value={m.member_no}>
                    {m.member_no} - {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label>Receipt Code</label>
              <input
                value={receiptCode}
                onChange={(e) => setReceiptCode(e.target.value)}
                placeholder="MPESA / Reference"
              />
            </div>

            <div>
              <label>Date</label>
              <input
                type="date"
                value={transactionDate}
                onChange={(e) => setTransactionDate(e.target.value)}
              />
            </div>

            <div>
              <label>Mode</label>
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option>M-Pesa</option>
                <option>Cash</option>
                <option>Bank</option>
              </select>
            </div>

            <div className="alloc-btn">
              <button onClick={addRow}>+ Add Allocation</button>
            </div>

          </div>

          <div className="member-box">
            Member: <strong>{memberName || "Not Selected"}</strong>
          </div>

          <h4>Allocations</h4>

          {allocations.map((a, i) => (
            <div key={i} className="row">

              <select
                value={a.account}
                onChange={(e) => updateAllocation(i, "account", e.target.value)}
                disabled={accountsLoading}
              >
                {SYSTEM_ACCOUNT_KEYS.map((x) => (
                  <option key={x.key} value={accountIds?.[x.key] || ""}>
                    {x.name}
                  </option>
                ))}
              </select>

              <input
                type="number"
                value={a.amount}
                onChange={(e) => updateAllocation(i, "amount", e.target.value)}
                placeholder="Amount"
              />

              <button onClick={() => removeRow(i)}>✕</button>

            </div>
          ))}

          <div className="footer">
            <span>Total: {total.toLocaleString()}</span>
            <button onClick={submitPayment} disabled={loading}>
              {loading ? "Processing..." : "Post Payment"}
            </button>
          </div>

        </div>

        {/* ================= TRANSACTIONS ================= */}
        <div className="card wide">
          <h3>Transactions</h3>

          {/* SCROLLABLE TABLE WRAPPER */}
          <div className="table-container">
            <table>

              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Member</th>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id}>
                    <td>{l.reference}</td>
                    <td>{l.name}</td>
                    <td>{l.date}</td>
                    <td>{num(l.amount).toLocaleString()}</td>

                    <td className={l.status === "APPROVED" ? "approved" : "pending"}>
                      {l.status}
                    </td>

                    <td>
                      <button onClick={() => downloadReceipt(l)}>Download</button>
                      <button onClick={() => approve(l)}>Approve</button>
                    </td>
                  </tr>
                ))}
              </tbody>

            </table>
          </div>

        </div>

      </div>

      {/* ================= STYLES ================= */}
      <style>{`
        .payments{
          padding:24px;
          background:linear-gradient(135deg,#eef2f7,#f6f8fc);
          font-family:Segoe UI;
        }

        .header{
          background:#0f5132;
          color:#fff;
          padding:18px;
          border-radius:14px;
          margin-bottom:18px;
        }

        .grid{
          display:grid;
          grid-template-columns:1fr 2fr;
          gap:18px;
        }

        .card{
          background:#fff;
          padding:18px;
          border-radius:14px;
          box-shadow:0 10px 25px rgba(0,0,0,0.06);
        }

        .form-grid-3{
          display:grid;
          grid-template-columns:repeat(2,1fr);
          gap:12px;
        }

        .alloc-btn{
          display:flex;
          align-items:end;
        }

        input,select{
          width:100%;
          padding:10px;
          border-radius:10px;
          border:1px solid #ddd;
        }

        .member-box{
          margin:10px 0;
          padding:10px;
          background:#f3f4f6;
          border-radius:10px;
        }

        .row{
          display:grid;
          grid-template-columns:2fr 1fr 40px;
          gap:10px;
          margin-bottom:8px;
        }

        .footer{
          display:flex;
          justify-content:space-between;
          margin-top:10px;
          font-weight:bold;
        }

        /* SCROLL FIX */
        .table-container{
          max-height:420px;
          overflow-y:auto;
          border-radius:10px;
        }

        thead th{
          position:sticky;
          top:0;
          background:#f3f4f6;
          z-index:2;
        }

        table{
          width:100%;
          border-collapse:collapse;
        }

        th,td{
          padding:10px;
          border-bottom:1px solid #eee;
        }

        .approved{color:green;font-weight:bold}
        .pending{color:orange;font-weight:bold}
      `}</style>

    </div>
  );
}