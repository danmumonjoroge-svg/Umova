import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { postJournal } from "../../services/journalAPI";

// ================= CONSTANTS =================
const ACC = {
  CASH: 1007,
  LOAN: 1011,
  INTEREST: 1020,
};

// ================= FORMAT =================
const format = (v) =>
  Number(v || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function LoanRepayments() {

  const [members, setMembers] = useState([]);
  const [search, setSearch] = useState("");

  const [memberId, setMemberId] = useState("");
  const [member, setMember] = useState(null);
  const [loanBalance, setLoanBalance] = useState(0);

  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);

  // ================= LOAD MEMBERS =================
  useEffect(() => {
    loadMembers();
  }, []);

  const loadMembers = async () => {
    const { data } = await supabase
      .from("members")
      .select("member_no, name")
      .order("name");

    setMembers(data || []);
  };

  // ================= FETCH MEMBER =================
  const fetchMember = async (id) => {

    const { data: m } = await supabase
      .from("members")
      .select("*")
      .eq("member_no", id)
      .single();

    if (!m) {
      setMember(null);
      setLoanBalance(0);
      return;
    }

    const { data: ledger } = await supabase
      .from("general_ledger")
      .select("*")
      .eq("member_no", id);

    let loan = 0;

    ledger?.forEach((t) => {
      const amt = Number(t.amount || 0);

      if (Number(t.debit_account_id) === ACC.LOAN) loan += amt;
      if (Number(t.credit_account_id) === ACC.LOAN) loan -= amt;
    });

    setMember(m);
    setLoanBalance(Math.abs(loan));
  };

  // ================= SELECT MEMBER =================
  const handleSelect = (m) => {
    setMemberId(m.member_no);
    setSearch(`${m.name} (${m.member_no})`);
    fetchMember(m.member_no);
  };

  // ================= CALCULATIONS =================
  const amt = Number(amount || 0);
  const principal = amt * 0.9;
  const interest = amt * 0.1;
  const newBalance = Math.max(loanBalance - principal, 0);

  // ================= POST =================
  const handleRepayment = async () => {

    if (!member) return alert("Select a member");
    if (amt <= 0) return alert("Enter valid amount");
    if (loanBalance <= 0) return alert("No active loan");
    if (principal > loanBalance)
      return alert("Amount exceeds loan balance");

    try {
      setLoading(true);

      await postJournal({
        member_id: member.member_no,
        reference: `RPY-${Date.now()}`,
        description: "Loan repayment",

        lines: [
          { account_id: ACC.CASH, debit: amt, credit: 0 },
          { account_id: ACC.LOAN, debit: 0, credit: principal },
          { account_id: ACC.INTEREST, debit: 0, credit: interest },
        ]
      });

      alert("✅ Repayment posted");

      setAmount("");
      fetchMember(member.member_no);

    } catch (err) {
      alert(err.message || "Error");
    } finally {
      setLoading(false);
    }
  };

  // ================= FILTERED MEMBERS =================
  const filtered = members.filter((m) =>
    `${m.name} ${m.member_no}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  // ================= UI =================
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-100 to-green-50 p-6 flex justify-center">

      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-6">

        {/* HEADER */}
        <h2 className="text-xl font-bold text-green-800 mb-3">
          🏦 Loan Repayment Engine
        </h2>

        {/* SEARCH INPUT */}
        <div className="relative mb-4">

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search member by name or number..."
            className="border p-3 rounded-lg w-full"
          />

          {search && (
            <div className="absolute bg-white border w-full mt-1 rounded shadow max-h-60 overflow-auto z-10">

              {filtered.map((m, i) => (
                <div
                  key={i}
                  onClick={() => handleSelect(m)}
                  className="p-2 hover:bg-gray-100 cursor-pointer"
                >
                  {m.name} ({m.member_no})
                </div>
              ))}

              {filtered.length === 0 && (
                <div className="p-2 text-gray-400">
                  No members found
                </div>
              )}

            </div>
          )}

        </div>

        {/* MEMBER INFO */}
        {member && (
          <div className="bg-gray-50 border p-4 rounded mb-4">

            <h3 className="font-bold">{member.name}</h3>
            <p className="text-sm text-gray-500">{member.member_no}</p>

            <p className="mt-2 text-red-600 font-bold">
              Loan Balance: KES {format(loanBalance)}
            </p>

          </div>
        )}

        {/* AMOUNT */}
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Enter amount"
          className="border p-3 rounded-lg w-full mb-3"
        />

        {/* BREAKDOWN */}
        {amt > 0 && (
          <div className="bg-gray-50 border p-3 rounded mb-4 text-sm">

            <div className="flex justify-between">
              <span>Principal</span>
              <span>KES {format(principal)}</span>
            </div>

            <div className="flex justify-between">
              <span>Interest</span>
              <span>KES {format(interest)}</span>
            </div>

            <div className="flex justify-between font-bold mt-2">
              <span>Remaining Loan</span>
              <span>KES {format(newBalance)}</span>
            </div>

          </div>
        )}

        {/* BUTTON */}
        <button
          onClick={handleRepayment}
          disabled={loading}
          className="w-full bg-green-700 text-white py-3 rounded-lg"
        >
          {loading ? "Processing..." : "Post Repayment"}
        </button>

      </div>
    </div>
  );
}