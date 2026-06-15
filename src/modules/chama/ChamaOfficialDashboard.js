import React, { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import {
  Users,
  Wallet,
  Landmark,
  FileText,
  Shield,
  CheckCircle,
  Banknote,
} from "lucide-react";

export default function ChamaOfficialDashboard() {
  /* ================= STATE ================= */
  const [user, setUser] = useState(null);
  const [chamaId, setChamaId] = useState(null);
  const [role, setRole] = useState(null);

  const [active, setActive] = useState("overview");
  const [loading, setLoading] = useState(true);

  const [members, setMembers] = useState([]);
  const [contributions, setContributions] = useState([]);
  const [funds, setFunds] = useState([]);

  /* ================= LOAD SESSION ================= */
  useEffect(() => {
    const init = async () => {
      setLoading(true);

      // 1. Get auth user
      const { data: auth } = await supabase.auth.getUser();

      if (!auth?.user) {
        setLoading(false);
        return;
      }

      const currentUser = {
        id: auth.user.id,
        email: auth.user.email,
      };

      setUser(currentUser);

      // 2. Get member record (IMPORTANT FIX)
      const { data: member } = await supabase
        .from("chama_members")
        .select("*")
        .eq("user_id", currentUser.id)
        .maybeSingle();

      if (!member) {
        setLoading(false);
        return;
      }

      setChamaId(member.chama_no);
      setRole(member.role);

      // 3. Load chama data safely
      const chamaNo = member.chama_no;

      const [m, c, f] = await Promise.all([
        supabase.from("chama_members").select("*").eq("chama_no", chamaNo),
        supabase.from("chama_contributions").select("*").eq("chama_id", chamaNo),
        supabase.from("chama_fund_movements").select("*").eq("chama_id", chamaNo),
      ]);

      setMembers(m.data || []);
      setContributions(c.data || []);
      setFunds(f.data || []);

      setLoading(false);
    };

    init();
  }, []);

  /* ================= LOADING ================= */
  if (loading) {
    return (
      <div className="p-6 text-slate-500">
        Loading Official Dashboard...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-6 text-red-500">
        User session not found. Please login again.
      </div>
    );
  }

  if (!chamaId) {
    return (
      <div className="p-6 text-red-500">
        You are not assigned to any chama.
      </div>
    );
  }

  /* ================= KPIs ================= */
  const totalSavings = contributions.reduce(
    (a, b) => a + Number(b.savings || 0),
    0
  );

  const totalFunds = funds.reduce(
    (a, b) => a + Number(b.amount || 0),
    0
  );

  /* ================= ROLE MENU ================= */
  const menu = [
    { key: "overview", label: "Overview", icon: Shield },
    { key: "members", label: "Members", icon: Users },
    { key: "loans", label: "Loans", icon: Banknote },
    { key: "funds", label: "Funds", icon: Wallet },
    { key: "approvals", label: "Approvals", icon: CheckCircle },
    { key: "statements", label: "Statements", icon: FileText },
  ];

  /* ================= UI ================= */
  return (
    <div className="flex h-screen bg-slate-100">

      {/* SIDEBAR */}
      <div className="w-64 bg-slate-900 text-white flex flex-col">

        <div className="p-4 border-b border-slate-700">
          <h1 className="text-emerald-400 font-bold">
            CHAMA OFFICIAL
          </h1>
          <p className="text-xs text-slate-400">
            Role: {role}
          </p>
        </div>

        <div className="flex-1 p-2 space-y-1">
          {menu.map((item) => {
            const Icon = item.icon;

            return (
              <button
                key={item.key}
                onClick={() => setActive(item.key)}
                className={`flex items-center gap-3 w-full p-2 rounded ${
                  active === item.key
                    ? "bg-emerald-700"
                    : "hover:bg-slate-800"
                }`}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* MAIN */}
      <div className="flex-1 p-6 overflow-auto">

        {/* OVERVIEW */}
        {active === "overview" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

            <div className="bg-white p-4 rounded border">
              <h3>Members</h3>
              <b>{members.length}</b>
            </div>

            <div className="bg-white p-4 rounded border">
              <h3>Total Savings</h3>
              <b>KES {totalSavings}</b>
            </div>

            <div className="bg-white p-4 rounded border">
              <h3>Total Funds</h3>
              <b>KES {totalFunds}</b>
            </div>

          </div>
        )}

        {/* MEMBERS */}
        {active === "members" && (
          <div className="bg-white p-4 rounded border">
            <h2>Members</h2>

            {members.map((m) => (
              <div key={m.id} className="border-b p-2">
                {m.name} — {m.phone} — {m.role}
              </div>
            ))}

          </div>
        )}

        {/* FUNDS */}
        {active === "funds" && (
          <div className="bg-white p-4 rounded border">
            <h2>Funds Movement</h2>

            {funds.map((f) => (
              <div key={f.id} className="border-b p-2">
                {f.type} — KES {f.amount}
                <br />
                {f.from_source} → {f.to_destination}
              </div>
            ))}

          </div>
        )}

        {/* APPROVALS */}
        {active === "approvals" && (
          <div className="bg-white p-4 rounded border">
            <h2>Approvals</h2>
            <p>No pending approvals yet.</p>
          </div>
        )}

      </div>
    </div>
  );
}