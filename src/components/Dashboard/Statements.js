import { useEffect, useState, useMemo } from "react";
import { supabase } from "../../supabaseClient";
import { generateStatementPDF } from "../../utils/generateStatementPDF";
import logo from "../../asset/logo/umovalogo.png";

const ACC = {
  SAVINGS: 1018,
  LOANS: 1011,
  SHARES: 1012,
  INTEREST: 1020, // Added explicit interest account
};

export default function MemberStatement() {
  const [member, setMember] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    loadStatement();
  }, []);

  const loadStatement = async () => {
    setLoading(true);
    try {
      const stored = localStorage.getItem("member");
      const mem = stored ? JSON.parse(stored) : null;

      if (!mem?.member_no) return;
      setMember(mem);

      const { data, error } = await supabase
        .from("general_ledger")
        .select("*")
        .eq("member_no", mem.member_no)
        .order("date", { ascending: true });

      if (error) throw error;
      setLedger(data || []);
    } catch (err) {
      console.error("Statement error:", err);
    } finally {
      setLoading(false);
    }
  };

  // ================= ADVANCED DATA PROCESSING ENGINE =================
  // useMemo prevents zero-value flashes and unnecessary recalculations
  const processedData = useMemo(() => {
    const results = {
      savings: { tx: [], balance: 0 },
      loans: { tx: [], balance: 0 },
      shares: { tx: [], balance: 0 },
    };

    let sBal = 0, lBal = 0, shBal = 0;

    ledger.forEach((tx) => {
      const amt = Number(tx.amount || 0);
      const isSearchMatch = tx.description?.toLowerCase().includes(searchTerm.toLowerCase()) || tx.reference?.toLowerCase().includes(searchTerm.toLowerCase());

      // 1. Savings Logic
      if (tx.credit_account_id === ACC.SAVINGS || tx.debit_account_id === ACC.SAVINGS) {
        if (tx.credit_account_id === ACC.SAVINGS) sBal += amt;
        if (tx.debit_account_id === ACC.SAVINGS) sBal -= amt;
        if (!searchTerm || isSearchMatch) results.savings.tx.push({ ...tx, balance: sBal });
      }

      // 2. Loans Logic (Advanced Interest Treatment)
      if (tx.credit_account_id === ACC.LOANS || tx.debit_account_id === ACC.LOANS || tx.debit_account_id === ACC.INTEREST) {
        if (tx.debit_account_id === ACC.LOANS) lBal += amt;
        if (tx.credit_account_id === ACC.LOANS) lBal -= amt;
        if (tx.debit_account_id === ACC.INTEREST) lBal += amt;
        if (!searchTerm || isSearchMatch) results.loans.tx.push({ ...tx, balance: lBal });
      }

      // 3. Shares Logic
      if (tx.credit_account_id === ACC.SHARES || tx.debit_account_id === ACC.SHARES) {
        if (tx.credit_account_id === ACC.SHARES) shBal += amt;
        if (tx.debit_account_id === ACC.SHARES) shBal -= amt;
        if (!searchTerm || isSearchMatch) results.shares.tx.push({ ...tx, balance: shBal });
      }
    });

    return { 
        ...results, 
        summary: { savings: sBal, loans: lBal, shares: shBal } 
    };
  }, [ledger, searchTerm]);

  const format = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (loading) return <div className="flex justify-center p-20 text-green-700 animate-pulse">Syncing Ledger Records...</div>;

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8 bg-white shadow-lg my-6 rounded-xl border border-gray-100">
      
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b-2 border-green-50 pb-6 mb-8 gap-4">
        <div className="flex items-center gap-4">
          <img src={logo} className="w-20 h-20 object-contain" alt="UMOVA Logo" />
          <div>
            <h1 className="text-2xl font-black text-gray-800 tracking-tight">UMOVA INVESTMENTS LTD</h1>
            <p className="text-green-600 font-medium flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-ping"></span>
              Secure Member Audit Portal
            </p>
          </div>
        </div>
        
        <div className="bg-green-50 p-4 rounded-lg border border-green-100 text-right">
          <p className="text-xs text-green-700 font-bold uppercase tracking-wider">Report Generation Date</p>
          <p className="text-sm font-mono text-gray-700">{new Date().toLocaleString('en-GB')}</p>
        </div>
      </div>

      {/* FILTER & ACTIONS */}
      <div className="flex flex-wrap justify-between items-center mb-6 gap-4">
        <input 
          type="text" 
          placeholder="Search transactions..." 
          className="border border-gray-200 rounded-lg px-4 py-2 w-full md:w-64 focus:ring-2 focus:ring-green-500 outline-none"
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <button
          onClick={() => generateStatementPDF(member, ledger, processedData)}
          className="bg-green-700 hover:bg-green-800 text-white font-bold px-6 py-2.5 rounded-lg shadow-md transition-all flex items-center gap-2"
        >
          <span>📥</span> Export Official PDF
        </button>
      </div>

      {/* SUMMARY CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <div className="bg-white border-l-4 border-green-500 p-5 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <p className="text-gray-500 text-sm font-bold uppercase">Net Savings</p>
          <p className="text-2xl font-black text-gray-800">KES {format(processedData.summary.savings)}</p>
        </div>
        <div className="bg-white border-l-4 border-red-500 p-5 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <p className="text-gray-500 text-sm font-bold uppercase">Loan Liability</p>
          <p className="text-2xl font-black text-gray-800">KES {format(processedData.summary.loans)}</p>
        </div>
        <div className="bg-white border-l-4 border-blue-500 p-5 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <p className="text-gray-500 text-sm font-bold uppercase">Share Capital</p>
          <p className="text-2xl font-black text-gray-800">KES {format(processedData.summary.shares)}</p>
        </div>
      </div>

      {/* ACCOUNT TABLES SECTION */}
      <div className="space-y-12">
        {/* SAVINGS TABLE */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-3 h-8 bg-green-600 rounded-full"></div>
            <h3 className="text-xl font-bold text-gray-800">Savings Account Statement (1018)</h3>
          </div>
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                <tr>
                  <th className="px-6 py-4 text-left">Date</th>
                  <th className="px-6 py-4 text-left">Description</th>
                  <th className="px-6 py-4 text-right">Debit</th>
                  <th className="px-6 py-4 text-right">Credit</th>
                  <th className="px-6 py-4 text-right">Running Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {processedData.savings.tx.map((s, i) => (
                  <tr key={i} className="hover:bg-green-50/30 transition-colors">
                    <td className="px-6 py-4">{new Date(s.date).toLocaleDateString()}</td>
                    <td className="px-6 py-4 text-gray-500">{s.description || 'Deposit'}</td>
                    <td className="px-6 py-4 text-right text-red-500">{s.debit_account_id === ACC.SAVINGS ? format(s.amount) : "-"}</td>
                    <td className="px-6 py-4 text-right text-green-600">{s.credit_account_id === ACC.SAVINGS ? format(s.amount) : "-"}</td>
                    <td className="px-6 py-4 text-right font-bold text-gray-800">KES {format(s.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* LOANS TABLE */}
        <section>
           <div className="flex items-center gap-2 mb-4">
            <div className="w-3 h-8 bg-red-600 rounded-full"></div>
            <h3 className="text-xl font-bold text-gray-800">Loan & Interest Ledger (1011)</h3>
          </div>
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                <tr>
                  <th className="px-6 py-4 text-left">Date</th>
                  <th className="px-6 py-4 text-left">Operation Type</th>
                  <th className="px-6 py-4 text-right">Transaction Amt</th>
                  <th className="px-6 py-4 text-right">Outstanding Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {processedData.loans.tx.map((l, i) => (
                  <tr key={i} className="hover:bg-red-50/30 transition-colors">
                    <td className="px-6 py-4">{new Date(l.date).toLocaleDateString()}</td>
                    <td className="px-6 py-4 uppercase font-medium text-xs">
                        {l.debit_account_id === ACC.INTEREST ? 'Interest Accrued' : 
                         l.debit_account_id === ACC.LOANS ? 'Disbursement' : 'Repayment'}
                    </td>
                    <td className="px-6 py-4 text-right">{format(l.amount)}</td>
                    <td className="px-6 py-4 text-right font-bold text-red-700">KES {format(l.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}