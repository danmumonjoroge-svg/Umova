import { useState } from "react";
import { supabase } from "../../supabaseClient";
import { createHash } from "../../utils/hash";
import { generateStatementPDF } from "../../utils/generateStatementPDF";
import QRCode from "react-qr-code";

export default function MemberStatements() {

  const [memberNo, setMemberNo] = useState("");
  const [member, setMember] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [hash, setHash] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(false);

  // ================= FORMAT =================
  const format = (n) =>
    Number(n || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
    });

  // ================= FETCH STATEMENT =================
  const fetchData = async () => {

    if (!memberNo) {
      alert("Enter Member Number");
      return;
    }

    setLoading(true);

    // 1. FETCH MEMBER
    const { data: m } = await supabase
      .from("members")
      .select("*")
      .eq("member_no", memberNo)
      .single();

    // 2. FETCH STATEMENT FROM ERP VIEW
    let query = supabase
      .from("member_statement_view")
      .select("*")
      .eq("member_id", memberNo);

    if (fromDate) query = query.gte("date", fromDate);
    if (toDate) query = query.lte("date", toDate);

    const { data: l } = await query.order("date", { ascending: true });

    setMember(m || null);
    setLedger(l || []);
    setLoading(false);
  };

  // ================= LEDGER SUMMARY ENGINE =================
  const summary = ledger.reduce(
    (acc, tx) => {
      const amt = Number(tx.amount || 0);

      if (tx.account_id === 1018) acc.savings += amt; // savings
      if (tx.account_id === 1011) acc.loans += amt;   // loans
      if (tx.account_id === 1012) acc.shares += amt;  // shares

      return acc;
    },
    { savings: 0, loans: 0, shares: 0 }
  );

  // ================= HASH (AUDIT TRAIL) =================
  const saveStatement = async () => {

    const payload = {
      member_no: member.member_no,
      ledger,
      generated_at: new Date().toISOString(),
    };

    const generatedHash = createHash(payload);

    await supabase.from("statements").insert([
      {
        member_no: member.member_no,
        statement_hash: generatedHash,
      },
    ]);

    setHash(generatedHash);
    return generatedHash;
  };

  // ================= UI =================
  return (
    <div className="min-h-screen bg-gray-100 p-6">

      {/* HEADER */}
      <div className="bg-white rounded-2xl shadow p-5 flex justify-between border-l-8 border-green-700">

        <div>
          <h1 className="text-2xl font-bold text-green-800">
            SACCO Member Statement
          </h1>
          <p className="text-sm text-gray-500">
            Core Banking ERP System
          </p>
        </div>

        {hash && (
          <div className="text-center">
            <QRCode value={hash} size={65} />
            <p className="text-xs text-gray-500">Verified</p>
          </div>
        )}
      </div>

      {/* FILTER */}
      <div className="bg-white mt-4 p-4 rounded-2xl shadow flex flex-wrap gap-3">

        <input
          placeholder="Member No"
          value={memberNo}
          onChange={(e) => setMemberNo(e.target.value)}
          className="border p-2 rounded flex-1"
        />

        <input type="date" onChange={(e) => setFromDate(e.target.value)} className="border p-2 rounded"/>
        <input type="date" onChange={(e) => setToDate(e.target.value)} className="border p-2 rounded"/>

        <button
          onClick={fetchData}
          className="bg-blue-600 text-white px-5 py-2 rounded"
        >
          {loading ? "Loading..." : "Generate"}
        </button>

        {member && (
          <button
            onClick={async () => {
              const h = await saveStatement();
              generateStatementPDF(member, ledger, { hash: h });
            }}
            className="bg-green-700 text-white px-5 py-2 rounded"
          >
            Download PDF
          </button>
        )}
      </div>

      {/* MEMBER INFO */}
      {member && (
        <div className="bg-white mt-5 p-5 rounded-2xl shadow flex justify-between">

          <div>
            <h2 className="font-bold text-lg">{member.name}</h2>
            <p className="text-gray-500 text-sm">{member.member_no}</p>
          </div>

          <div className="text-right">
            <p>Savings</p>
            <p className="text-green-700 font-bold">{format(summary.savings)}</p>

            <p className="mt-2">Loans</p>
            <p className="text-red-600 font-bold">{format(summary.loans)}</p>

            <p className="mt-2">Share Capital</p>
            <p className="text-blue-600 font-bold">{format(summary.shares)}</p>
          </div>

        </div>
      )}

      {/* LEDGER TABLE */}
      <div className="bg-white mt-6 p-4 rounded-2xl shadow overflow-x-auto">

        <h3 className="font-bold mb-3">Transaction History</h3>

        <table className="w-full text-sm">

          <thead>
            <tr className="border-b">
              <th>Date</th>
              <th>Reference</th>
              <th>Description</th>
              <th>Debit</th>
              <th>Credit</th>
              <th>Amount</th>
            </tr>
          </thead>

          <tbody>
            {ledger.map((t, i) => (
              <tr key={i} className="border-b">
                <td>{t.date}</td>
                <td>{t.reference}</td>
                <td>{t.description}</td>
                <td>{format(t.debit)}</td>
                <td>{format(t.credit)}</td>
                <td>{format(t.amount)}</td>
              </tr>
            ))}
          </tbody>

        </table>

      </div>

      {/* FOOTER */}
      {ledger.length > 0 && (
        <div className="bg-white mt-6 p-4 rounded-2xl shadow flex justify-between text-sm text-gray-600">
          <p>Total Transactions: <b>{ledger.length}</b></p>
          <p>ERP Verified Statement</p>
        </div>
      )}

    </div>
  );
}