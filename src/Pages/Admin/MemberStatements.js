import { useState } from "react"; 
import { supabase } from "../../supabaseClient";
import { generateStatementPDF } from "../../utils/generateStatementPDF";
import QRCode from "react-qr-code";

const format = (n) =>
  Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function AdminMemberStatement() {

  const [memberNo, setMemberNo] = useState("");
  const [member, setMember] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hash, setHash] = useState("");

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const fetchStatement = async () => {

    if (!memberNo) return alert("Enter member number");

    setLoading(true);

    const { data: m } = await supabase
      .from("members")
      .select("*")
      .eq("member_no", memberNo)
      .single();

    let query = supabase
      .from("general_ledger")
      .select("*")
      .eq("member_no", memberNo)
      .order("date", { ascending: true });

    if (fromDate) query = query.gte("date", fromDate);
    if (toDate) query = query.lte("date", toDate);

    const { data: l } = await query;

    const cleanLedger = (l || []).map(t => ({
      ...t,
      debit: Number(t.debit || 0),
      credit: Number(t.credit || 0),
      amount: Number(t.amount || 0)
    }));

    setMember(m || null);
    setLedger(cleanLedger);
    setLoading(false);
  };

  const summary = ledger.reduce((acc, t) => {

    const amt = t.amount;

    if (Number(t.debit_account_id) === 1018) acc.savings += amt;
    if (Number(t.credit_account_id) === 1018) acc.savings -= amt;

    if (Number(t.debit_account_id) === 1011) {
      acc.loans += amt;
    }

    if (Number(t.credit_account_id) === 1011) {
      acc.loans -= amt;
    }

    // ================= LOAN INTEREST (1020 FIXED) =================
    if (Number(t.credit_account_id) === 1020) {
      acc.loan_interest = (acc.loan_interest || 0) + amt;
    }

    // ================= SAVINGS INTEREST (1006 FIXED) =================
    if (Number(t.credit_account_id) === 1006) {
      acc.savings_interest = (acc.savings_interest || 0) + amt;
    }

    if (Number(t.debit_account_id) === 1012) acc.shares += amt;
    if (Number(t.credit_account_id) === 1012) acc.shares -= amt;

    return acc;

  }, { savings: 0, loans: 0, shares: 0 });

  const downloadPDF = async () => {
    await generateStatementPDF(member, ledger, {
      summary,
      generated_at: new Date().toISOString()
    });
  };

  return (
    <div className="statement-page">

      {/* HEADER */}
      <div className="header">

        <div className="header-left">
          <h1>🏦 Member Statement Engine</h1>
          <p>Core Banking • Audit-Ready Financial Statements</p>
        </div>

        {hash && (
          <div className="qr">
            <QRCode value={hash} size={70} />
          </div>
        )}

      </div>

      {/* FILTER BAR */}
      <div className="filter-bar">

        <input
          value={memberNo}
          onChange={(e) => setMemberNo(e.target.value)}
          placeholder="Enter Member No"
        />

        <input type="date" onChange={(e) => setFromDate(e.target.value)} />
        <input type="date" onChange={(e) => setToDate(e.target.value)} />

        <button className="btn-blue" onClick={fetchStatement}>
          {loading ? "Generating..." : "Generate Statement"}
        </button>

        {member && (
          <button className="btn-green" onClick={downloadPDF}>
            Download PDF
          </button>
        )}

      </div>

      {/* MEMBER CARD */}
      {member && (
        <div className="member-card">

          <div className="member-left">
            <div className="avatar">
              {member.name?.charAt(0)?.toUpperCase()}
            </div>

            <div>
              <h2>{member.name}</h2>
              <p>{member.member_no}</p>
            </div>
          </div>

          <div className="member-right">
            <div className="stat">
              <span>Savings</span>
              <b>{format(summary.savings)}</b>
            </div>

            <div className="stat">
              <span>Loans</span>
              <b>{format(summary.loans)}</b>
            </div>

            <div className="stat">
              <span>Loan Interest (1020)</span>
              <b>{format(summary.loan_interest)}</b>
            </div>

            <div className="stat">
              <span>Savings Interest (1006)</span>
              <b>{format(summary.savings_interest)}</b>
            </div>

            <div className="stat">
              <span>Shares</span>
              <b>{format(summary.shares)}</b>
            </div>

          </div>

        </div>
      )}

      {/* TABLE */}
      <div className="table-card">

        <div className="table-header">
          <h3>Transaction Ledger</h3>
          <span>{ledger.length} entries</span>
        </div>

        <div className="table-wrapper">

          <table>

            <thead>
              <tr>
                <th>Date</th>
                <th>Ref</th>
                <th>Description</th>
                <th>Debit</th>
                <th>Credit</th>
                <th>Amount</th>
              </tr>
            </thead>

            <tbody>
              {ledger.map((t, i) => (
                <tr key={i}>
                  <td>{t.date}</td>
                  <td className="muted">{t.reference}</td>
                  <td>{t.description}</td>
                  <td className="debit">{format(t.debit)}</td>
                  <td className="credit">{format(t.credit)}</td>
                  <td className="amount">{format(t.amount)}</td>
                </tr>
              ))}
            </tbody>

          </table>

        </div>

      </div>

      {/* STYLES */}
      <style>{`
        .statement-page{
          padding:24px;
          background:linear-gradient(135deg,#eef2f7,#f8fafc);
          font-family:Segoe UI, Arial;
        }

        .header{
          display:flex;
          justify-content:space-between;
          align-items:center;
          background:linear-gradient(135deg,#0f5132,#198754);
          color:white;
          padding:18px;
          border-radius:16px;
          margin-bottom:16px;
          box-shadow:0 10px 25px rgba(0,0,0,0.1);
        }

        .header h1{margin:0;font-size:20px}
        .header p{margin:4px 0 0;font-size:12px;opacity:0.85}

        .filter-bar{
          display:flex;
          gap:10px;
          flex-wrap:wrap;
          background:white;
          padding:14px;
          border-radius:14px;
          box-shadow:0 8px 20px rgba(0,0,0,0.05);
        }

        .filter-bar input{
          padding:10px;
          border:1px solid #ddd;
          border-radius:10px;
        }

        .btn-blue{
          background:#2563eb;
          color:white;
          border:none;
          padding:10px 14px;
          border-radius:10px;
        }

        .btn-green{
          background:#16a34a;
          color:white;
          border:none;
          padding:10px 14px;
          border-radius:10px;
        }

        .member-card{
          margin-top:16px;
          background:white;
          padding:18px;
          border-radius:16px;
          display:flex;
          justify-content:space-between;
          align-items:center;
          box-shadow:0 10px 25px rgba(0,0,0,0.06);
        }

        .member-left{
          display:flex;
          align-items:center;
          gap:12px;
        }

        .avatar{
          width:50px;
          height:50px;
          border-radius:50%;
          background:#198754;
          color:white;
          display:flex;
          align-items:center;
          justify-content:center;
          font-weight:bold;
          font-size:20px;
        }

        .member-right{
          display:flex;
          gap:20px;
        }

        .stat{
          text-align:right;
        }

        .stat span{
          font-size:12px;
          color:#666;
        }

        .stat b{
          display:block;
          font-size:14px;
        }

        .table-card{
          margin-top:18px;
          background:white;
          border-radius:16px;
          padding:14px;
          box-shadow:0 10px 25px rgba(0,0,0,0.06);
        }

        .table-header{
          display:flex;
          justify-content:space-between;
          margin-bottom:10px;
        }

        .table-wrapper{
          max-height:420px;
          overflow-y:auto;
          border-radius:10px;
        }

        table{
          width:100%;
          border-collapse:collapse;
          font-size:13px;
        }

        thead{
          position:sticky;
          top:0;
          background:#f3f4f6;
        }

        th,td{
          padding:10px;
          border-bottom:1px solid #eee;
          text-align:left;
        }

        .muted{color:#666}
        .debit{color:#dc2626;font-weight:500}
        .credit{color:#16a34a;font-weight:500}
        .amount{font-weight:bold}
      `}</style>

    </div>
  );
}