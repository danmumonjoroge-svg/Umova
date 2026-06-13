import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";

export default function PaymentsApproval() {

  const [pending, setPending] = useState([]);

  useEffect(() => {
    fetchPending();
  }, []);

  const fetchPending = async () => {
    const { data } = await supabase
      .from("general_ledger")
      .select("*")
      .eq("status", "PENDING")
      .order("date", { ascending: false });

    setPending(data || []);
  };

  // ================= APPROVE =================
  const approve = async (id) => {
    await supabase
      .from("general_ledger")
      .update({ status: "APPROVED" })
      .eq("id", id);

    alert("Transaction Approved ✅");
    fetchPending();
  };

  // ================= REJECT =================
  const reject = async (id) => {
    await supabase
      .from("general_ledger")
      .update({ status: "REJECTED" })
      .eq("id", id);

    alert("Transaction Rejected ❌");
    fetchPending();
  };

  return (
    <div className="p-6 bg-slate-100 min-h-screen">

      <h1 className="text-2xl font-bold mb-4">
        🔐 Transaction Approval Desk
      </h1>

      <div className="bg-white rounded-xl shadow overflow-hidden">

        <table className="w-full text-sm">

          <thead className="bg-gray-100">
            <tr>
              <th>Date</th>
              <th>Member</th>
              <th>Amount</th>
              <th>Type</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>

            {pending.map(p => (
              <tr key={p.id} className="text-center border-t">

                <td>{p.date}</td>
                <td>{p.member_no}</td>
                <td className="font-semibold">KES {p.amount}</td>
                <td>{p.transaction_type}</td>

                <td>
                  <span className="px-2 py-1 text-xs bg-yellow-200 rounded">
                    {p.status}
                  </span>
                </td>

                <td className="space-x-2">

                  <button
                    onClick={() => approve(p.id)}
                    className="bg-green-600 text-white px-2 py-1 text-xs rounded"
                  >
                    Approve
                  </button>

                  <button
                    onClick={() => reject(p.id)}
                    className="bg-red-600 text-white px-2 py-1 text-xs rounded"
                  >
                    Reject
                  </button>

                </td>

              </tr>
            ))}

          </tbody>

        </table>

      </div>

    </div>
  );
}