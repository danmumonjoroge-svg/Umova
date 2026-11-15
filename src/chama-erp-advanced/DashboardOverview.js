import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { useChama } from "./ChamaContext";
import {
  Wallet, PiggyBank, HandCoins, HeartHandshake, Users, Clock, Loader2, TrendingUp,
} from "lucide-react";
import { Panel } from "./shell/ui";
import "./DashboardOverview.css";

// -----------------------------------------------------------------------------
// DashboardOverview
// Chama-wide summary — total savings on the books, active loans and how
// much is outstanding, contributions awaiting the treasurer, open welfare
// cases, member headcount. The landing tab, so anyone opening the
// dashboard sees the shape of their chama before drilling into any one
// module.
// -----------------------------------------------------------------------------

function formatKES(v) {
  return `KES ${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function DashboardOverview({ chamaId: chamaIdProp }) {
  const { chama, member } = useChama();
  const chamaId = chamaIdProp || chama?.id;

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!chamaId) return;
    setLoading(true);

    const [membersRes, loansRes, contribRes, welfareRes] = await Promise.all([
      supabase.from("chama_members").select("savings_balance, shares_balance, welfare_balance, status").eq("chama_id", chamaId),
      supabase.from("chama_loans").select("amount, balance, status").eq("chama_id", chamaId).eq("status", "active"),
      supabase.from("chama_contribution_requests").select("id, status").eq("chama_id", chamaId).in("status", ["PENDING", "VERIFIED"]),
      supabase.from("welfare_cases").select("id, status").eq("chama_id", chamaId).eq("status", "open"),
    ]);

    const members = membersRes.data || [];
    const loans = loansRes.data || [];

    setStats({
      memberCount: members.length,
      activeMemberCount: members.filter((m) => (m.status || "active") === "active").length,
      totalSavings: members.reduce((s, m) => s + Number(m.savings_balance || 0), 0),
      totalShares: members.reduce((s, m) => s + Number(m.shares_balance || 0), 0),
      totalWelfare: members.reduce((s, m) => s + Number(m.welfare_balance || 0), 0),
      activeLoanCount: loans.length,
      outstandingLoans: loans.reduce((s, l) => s + Number(l.balance ?? l.amount ?? 0), 0),
      pendingContributions: (contribRes.data || []).length,
      openWelfareCases: (welfareRes.data || []).length,
    });
    setLoading(false);
  }, [chamaId]);

  useEffect(() => { load(); }, [load]);

  if (loading || !stats) {
    return <div className="dov-loading"><Loader2 size={22} className="spin" /></div>;
  }

  const cards = [
    { label: "Total savings", value: formatKES(stats.totalSavings), icon: PiggyBank, tone: "brand" },
    { label: "Total shares", value: formatKES(stats.totalShares), icon: TrendingUp, tone: "gold" },
    { label: "Welfare fund", value: formatKES(stats.totalWelfare), icon: HeartHandshake, tone: "brand" },
    { label: "Outstanding loans", value: formatKES(stats.outstandingLoans), icon: HandCoins, tone: "gold", sub: `${stats.activeLoanCount} active` },
    { label: "Members", value: stats.activeMemberCount, icon: Users, tone: "brand", sub: `${stats.memberCount} total` },
    { label: "Awaiting treasurer", value: stats.pendingContributions, icon: Clock, tone: stats.pendingContributions > 0 ? "warn" : "brand", sub: "contributions" },
    { label: "Open welfare cases", value: stats.openWelfareCases, icon: HeartHandshake, tone: stats.openWelfareCases > 0 ? "gold" : "brand" },
  ];

  return (
    <div className="dov-page">
      <div className="dov-header">
        <h2>Welcome, {member?.name?.split(" ")[0] || "there"}</h2>
        <p>{chama?.name} · {chama?.chama_no}</p>
      </div>

      {[
        { title: "Money in the Chama", icon: PiggyBank, tone: "green", items: cards.slice(0, 4) },
        { title: "People and work", icon: Users, tone: "", items: cards.slice(4) },
      ].map((g) => (
        <Panel key={g.title} icon={g.icon} title={g.title} tone={g.tone}>
          <div className="dov-grid">
            {g.items.map((c) => (
              <div className={`dov-card ${c.tone}`} key={c.label}>
                <span className="dov-card-icon"><c.icon size={16} /></span>
                <div>
                  <p className="dov-card-label">{c.label}</p>
                  <p className="dov-card-value">{c.value}</p>
                  {c.sub && <p className="dov-card-sub">{c.sub}</p>}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ))}
    </div>
  );
}
