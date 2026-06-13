import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { postJournal } from "../../services/journalAPI";

// ================= ACCOUNTS =================
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

  const [member, setMember] = useState(null);

  const [principalBalance, setPrincipalBalance] = useState(0);
  const [interestBalance, setInterestBalance] = useState(0);

  const [principalPayment, setPrincipalPayment] = useState("");
  const [interestPayment, setInterestPayment] = useState("");

  const [loading, setLoading] = useState(false);

  // ================= LOAD MEMBERS =================
  useEffect(() => {
    loadMembers();
  }, []);

  const loadMembers = async () => {
    const { data } = await supabase
      .from("members")
      .select("member_no,name")
      .order("name");

    setMembers(data || []);
  };

  // ================= MEMBER + BALANCES =================
  const fetchMember = async (memberNo) => {
    const { data: m } = await supabase
      .from("members")
      .select("*")
      .eq("member_no", memberNo)
      .single();

    if (!m) {
      setMember(null);
      setPrincipalBalance(0);
      setInterestBalance(0);
      return;
    }

    const { data: ledger } = await supabase
      .from("general_ledger")
      .select("*")
      .eq("member_no", memberNo);

    let principal = 0;
    let interest = 0;

    ledger?.forEach((t) => {
      const amt = Number(t.amount || 0);

      // LOAN PRINCIPAL
      if (Number(t.debit_account_id) === ACC.LOAN)
        principal += amt;

      if (Number(t.credit_account_id) === ACC.LOAN)
        principal -= amt;

      // INTEREST
      if (Number(t.debit_account_id) === ACC.INTEREST)
        interest += amt;

      if (Number(t.credit_account_id) === ACC.INTEREST)
        interest -= amt;
    });

    setMember(m);
    setPrincipalBalance(Math.max(principal, 0));
    setInterestBalance(Math.max(interest, 0));
  };

  // ================= SELECT MEMBER =================
  const handleSelect = (m) => {
    setSearch(`${m.name} (${m.member_no})`);

    setPrincipalPayment("");
    setInterestPayment("");

    fetchMember(m.member_no);
  };

  // ================= FILTER =================
  const filtered = members.filter((m) =>
    `${m.name} ${m.member_no}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  // ================= CALCULATIONS =================
  const principalAmt = Number(principalPayment || 0);
  const interestAmt = Number(interestPayment || 0);

  const totalPayment =
    principalAmt +
    interestAmt;

  const remainingPrincipal =
    Math.max(principalBalance - principalAmt, 0);

  const remainingInterest =
    Math.max(interestBalance - interestAmt, 0);

  const totalOutstanding =
    principalBalance +
    interestBalance;

  // ================= POST =================
  const handleRepayment = async () => {
    if (!member) {
      alert("Select a member");
      return;
    }

    if (principalAmt < 0 || interestAmt < 0) {
      alert("Amounts cannot be negative");
      return;
    }

    if (totalPayment <= 0) {
      alert("Enter repayment amount");
      return;
    }

    if (principalAmt > principalBalance) {
      alert("Principal payment exceeds outstanding principal");
      return;
    }

    if (interestAmt > interestBalance) {
      alert("Interest payment exceeds outstanding interest");
      return;
    }

    try {
      setLoading(true);

      const lines = [
        {
          account_id: ACC.CASH,
          debit: totalPayment,
          credit: 0,
        },
      ];

      if (principalAmt > 0) {
        lines.push({
          account_id: ACC.LOAN,
          debit: 0,
          credit: principalAmt,
        });
      }

      if (interestAmt > 0) {
        lines.push({
          account_id: ACC.INTEREST,
          debit: 0,
          credit: interestAmt,
        });
      }

      await postJournal({
        member_id: member.member_no,
        reference: `RPY-${Date.now()}`,
        description: "Loan repayment",
        lines,
      });

      alert("✅ Repayment posted successfully");

      setPrincipalPayment("");
      setInterestPayment("");

      await fetchMember(member.member_no);
    } catch (err) {
      alert(err.message || "Posting failed");
    } finally {
      setLoading(false);
    }
  };

  // ================= UI =================
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-emerald-50 p-6">
      <div className="max-w-4xl mx-auto bg-white rounded-3xl shadow-2xl overflow-hidden">

        {/* HEADER */}
        <div className="bg-gradient-to-r from-green-700 to-emerald-600 text-white p-6">
          <h1 className="text-2xl font-bold">
            Loan Repayment Engine
          </h1>

          <p className="text-green-100 mt-1">
            Principal & Interest Allocation
          </p>
        </div>

        <div className="p-6">

          {/* SEARCH */}
          <div className="relative mb-6">

            <label className="block text-sm font-semibold mb-2">
              Search Member
            </label>

            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by member name or member number..."
              className="w-full border rounded-xl p-4"
            />

            {search && (
              <div className="absolute z-20 bg-white border rounded-xl shadow-lg mt-1 w-full max-h-72 overflow-auto">

                {filtered.map((m) => (
                  <div
                    key={m.member_no}
                    onClick={() => handleSelect(m)}
                    className="p-3 hover:bg-gray-50 cursor-pointer border-b"
                  >
                    <div className="font-medium">
                      {m.name}
                    </div>

                    <div className="text-sm text-gray-500">
                      {m.member_no}
                    </div>
                  </div>
                ))}

                {filtered.length === 0 && (
                  <div className="p-3 text-gray-400">
                    No members found
                  </div>
                )}
              </div>
            )}
          </div>

          {/* MEMBER INFO */}
          {member && (
            <>
              <div className="grid md:grid-cols-3 gap-4 mb-6">

                <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
                  <div className="text-sm text-gray-500">
                    Principal Balance
                  </div>

                  <div className="text-xl font-bold text-red-700">
                    KES {format(principalBalance)}
                  </div>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                  <div className="text-sm text-gray-500">
                    Interest Balance
                  </div>

                  <div className="text-xl font-bold text-amber-700">
                    KES {format(interestBalance)}
                  </div>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-2xl p-4">
                  <div className="text-sm text-gray-500">
                    Total Outstanding
                  </div>

                  <div className="text-xl font-bold text-green-700">
                    KES {format(totalOutstanding)}
                  </div>
                </div>

              </div>

              <div className="bg-gray-50 border rounded-2xl p-4 mb-6">

                <h3 className="font-bold text-lg">
                  {member.name}
                </h3>

                <p className="text-gray-500">
                  Member No: {member.member_no}
                </p>

              </div>

              {/* PAYMENT ENTRY */}
              <div className="grid md:grid-cols-2 gap-4 mb-4">

                <div>
                  <label className="block mb-2 font-medium">
                    Principal Payment
                  </label>

                  <input
                    type="number"
                    min="0"
                    value={principalPayment}
                    onChange={(e) =>
                      setPrincipalPayment(e.target.value)
                    }
                    className="w-full border rounded-xl p-4"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="block mb-2 font-medium">
                    Interest Payment
                  </label>

                  <input
                    type="number"
                    min="0"
                    value={interestPayment}
                    onChange={(e) =>
                      setInterestPayment(e.target.value)
                    }
                    className="w-full border rounded-xl p-4"
                    placeholder="0.00"
                  />
                </div>

              </div>

              {/* QUICK BUTTONS */}
              <div className="flex flex-wrap gap-3 mb-6">

                <button
                  type="button"
                  onClick={() =>
                    setInterestPayment(
                      String(interestBalance)
                    )
                  }
                  className="px-4 py-2 bg-amber-100 text-amber-800 rounded-xl"
                >
                  Clear Interest
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setPrincipalPayment(
                      String(principalBalance)
                    )
                  }
                  className="px-4 py-2 bg-red-100 text-red-800 rounded-xl"
                >
                  Clear Principal
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPrincipalPayment(
                      String(principalBalance)
                    );

                    setInterestPayment(
                      String(interestBalance)
                    );
                  }}
                  className="px-4 py-2 bg-green-100 text-green-800 rounded-xl"
                >
                  Clear Entire Loan
                </button>

              </div>

              {/* SUMMARY */}
              <div className="bg-green-50 border border-green-200 rounded-2xl p-5 mb-6">

                <h3 className="font-bold mb-4">
                  Repayment Summary
                </h3>

                <div className="space-y-2">

                  <div className="flex justify-between">
                    <span>Principal Payment</span>
                    <span>
                      KES {format(principalAmt)}
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span>Interest Payment</span>
                    <span>
                      KES {format(interestAmt)}
                    </span>
                  </div>

                  <div className="flex justify-between font-bold text-lg border-t pt-2">
                    <span>Total Received</span>
                    <span>
                      KES {format(totalPayment)}
                    </span>
                  </div>

                  <div className="border-t my-2"></div>

                  <div className="flex justify-between">
                    <span>Remaining Principal</span>
                    <span>
                      KES {format(remainingPrincipal)}
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span>Remaining Interest</span>
                    <span>
                      KES {format(remainingInterest)}
                    </span>
                  </div>

                </div>

              </div>

              {/* POST */}
              <button
                onClick={handleRepayment}
                disabled={loading}
                className="w-full bg-green-700 hover:bg-green-800 text-white py-4 rounded-2xl font-bold text-lg"
              >
                {loading
                  ? "Processing..."
                  : "Post Repayment"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}