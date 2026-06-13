import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";

export default function MemberDetails() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [member, setMember] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loans, setLoans] = useState([]);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    const { data: memberData } = await supabase.from("members").select("*").eq("id", id).single();
    const { data: tx } = await supabase.from("transactions").select("*").eq("member_id", id);
    const { data: loanData } = await supabase.from("loans").select("*").eq("member_id", id);

    setMember(memberData);
    setTransactions(tx || []);
    setLoans(loanData || []);
  }

  if (!member) return <p>Loading...</p>;

  const totalSavings = transactions.filter(t => t.type === "deposit").reduce((a, b) => a + b.amount, 0);
  const totalLoans = loans.reduce((a, b) => a + b.amount, 0);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">{member.name}</h1>

      <div className="grid grid-cols-3 gap-6 mb-6">
        <Card title="Savings" value={totalSavings} />
        <Card title="Loans" value={totalLoans} />
        <Card title="Transactions" value={transactions.length} />
      </div>

      <button
        className="bg-blue-600 text-white px-4 py-2 rounded mb-4"
        onClick={() => navigate(`/members/${id}/statement`)}
      >
        View Statement
      </button>

      <h2 className="text-xl font-bold mb-2">Loans</h2>
      <table className="min-w-full table-auto bg-white rounded-xl shadow mb-6">
        <thead className="bg-gray-200">
          <tr>
            <th className="p-3 text-left">Amount</th>
            <th className="p-3 text-left">Balance</th>
            <th className="p-3 text-left">Status</th>
            <th className="p-3 text-left">Amortization</th>
          </tr>
        </thead>
        <tbody>
          {loans.map(loan => (
            <tr key={loan.id} className="border-b hover:bg-gray-100">
              <td className="p-3">{loan.amount}</td>
              <td className="p-3">{loan.balance}</td>
              <td className="p-3">{loan.status}</td>
              <td className="p-3">
                <button
                  className="bg-green-500 text-white px-3 py-1 rounded"
                  onClick={() => navigate(`/loans/${loan.id}/amortization`)}
                >
                  View
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Card({ title, value }) {
  return (
    <div className="bg-white p-6 rounded-xl shadow flex flex-col items-center">
      <p className="text-gray-500">{title}</p>
      <p className="text-xl font-bold">{value.toLocaleString()}</p>
    </div>
  );
}