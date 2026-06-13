import React, { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "./ChamaContext";
import ChamaDashboardLayout from "./ChamaDashboardLayout";

export default function ChamaTreasurerDashboard() {
  const { chama } = useChama();

  const [pending, setPending] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  // ─────────────────────────────
  // LOAD DATA
  // ─────────────────────────────
  const load = async () => {
    setLoading(true);

    // Pending contributions
    const { data: contribs } = await supabase
      .from("chama_contributions")
      .select("*")
      .eq("chama_id", chama.id)
      .eq("status", "pending");

    // Treasury accounts
    const { data: accs } = await supabase
      .from("chama_treasury_accounts")
      .select("*")
      .eq("chama_id", chama.id);

    setPending(contribs || []);
    setAccounts(accs || []);
    setLoading(false);
  };

  useEffect(() => {
    if (chama?.id) load();
  }, [chama?.id]);

  // ─────────────────────────────
  // APPROVE CONTRIBUTION
  // ─────────────────────────────
  const approve = async (item) => {
    await supabase
      .from("chama_contributions")
      .update({ status: "approved" })
      .eq("id", item.id);

    // post to ledger automatically
    await supabase.from("chama_transactions").insert([
      {
        chama_id: chama.id,
        amount: item.amount,
        account_type: "savings",
        description: `Approved contribution (${item.method})`,
      },
    ]);

    load();
  };

  // ─────────────────────────────
  // REJECT CONTRIBUTION
  // ─────────────────────────────
  const reject = async (id) => {
    await supabase
      .from("chama_contributions")
      .update({ status: "rejected" })
      .eq("id", id);

    load();
  };

  return (
    <ChamaDashboardLayout activeTab="approvals">

      <h2>💰 Treasurer Control Panel</h2>

      {/* ───────── PENDING APPROVALS ───────── */}
      <div style={{ marginTop: 20 }}>
        <h3>Pending Contributions</h3>

        {pending.length === 0 ? (
          <p>No pending contributions</p>
        ) : (
          pending.map((p) => (
            <div key={p.id} style={{
              background: "#fff",
              padding: 12,
              marginBottom: 10,
              borderRadius: 8,
              display: "flex",
              justifyContent: "space-between"
            }}>
              <div>
                <b>{p.member_id}</b>
                <div>KES {p.amount} ({p.method})</div>
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => approve(p)} style={{
                  background: "green",
                  color: "#fff",
                  border: "none",
                  padding: "6px 10px",
                  borderRadius: 6
                }}>
                  Approve
                </button>

                <button onClick={() => reject(p.id)} style={{
                  background: "red",
                  color: "#fff",
                  border: "none",
                  padding: "6px 10px",
                  borderRadius: 6
                }}>
                  Reject
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ───────── TREASURY ACCOUNTS ───────── */}
      <div style={{ marginTop: 30 }}>
        <h3>🏦 Treasury Accounts</h3>

        {accounts.map((a) => (
          <div key={a.id} style={{
            background: "#f8fafc",
            padding: 12,
            marginBottom: 10,
            borderRadius: 8
          }}>
            <b>{a.name}</b>
            <div>Balance: KES {Number(a.balance).toLocaleString()}</div>
          </div>
        ))}
      </div>

    </ChamaDashboardLayout>
  );
}