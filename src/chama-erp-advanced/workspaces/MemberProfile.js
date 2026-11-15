import React from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import { Phone, MessageCircle, FileText, AlertCircle, Lock, Wallet, History, IdCard } from "lucide-react";
import useCachedQuery from "../shell/useCachedQuery";
import { formatKES, formatDate, initials, roleLabel } from "../shell/format";
import { Spinner, StaleNote, Notice, ActionCard, Panel, Stat, StatGrid, SubCard, SubCardList, Pill, EmptyState } from "../shell/ui";

// -----------------------------------------------------------------------------
// MemberProfile — what you see depends on who you are:
//   anyone in the Chama : name, role, status, phone, joined date (same as the
//                         directory already shows everyone)
//   the member themself : + their own savings/shares/welfare, loans, history
//   officials           : + the same for any member, and national ID
// Columns are requested explicitly (never select("*")) so a member opening a
// colleague's profile does not download that colleague's balances or ID at
// all. NOTE: with RLS still off, that is a courtesy of this client, not a
// security boundary — see the delivery notes.
// -----------------------------------------------------------------------------
const STATUS_TONE = { active: "ok", pending: "warn", suspended: "error" };
const REQ_TONE = { APPROVED: "ok", PENDING: "warn", VERIFIED: "warn", REJECTED: "error" };
const REQ_LABEL = { APPROVED: "Confirmed", PENDING: "Waiting to be checked", VERIFIED: "Being posted", REJECTED: "Not accepted" };

export default function MemberProfile({ memberId, go }) {
  const { chama, member, hasRole } = useChama();
  const isSelf = memberId === member?.id;
  const isOfficial = hasRole(["secretary", "treasurer", "chairperson", "admin"]);
  const seeMoney = isSelf || isOfficial;

  const { data, loading, error, fromCache, cachedAt, online } = useCachedQuery(
    chama?.id && memberId ? `profile:${chama.id}:${memberId}:${seeMoney ? (isOfficial ? "o" : "s") : "p"}` : null,
    async () => {
      const cols = ["id", "name", "phone", "role", "status", "joined_at"];
      if (seeMoney) cols.push("savings_balance", "shares_balance", "welfare_balance");
      if (isOfficial) cols.push("national_id");
      const base = await supabase.from("chama_members").select(cols.join(",")).eq("id", memberId).eq("chama_id", chama.id).single();
      if (base.error) throw new Error(base.error.message);
      let loans = [], history = [];
      if (seeMoney) {
        const [l, h] = await Promise.all([
          supabase.from("chama_loans").select("id,amount,balance,status,disbursed").eq("chama_id", chama.id).eq("member_id", memberId),
          supabase.from("chama_contribution_requests").select("id,amount,status,contribution_type,contributed_on").eq("chama_id", chama.id).eq("member_id", memberId).order("contributed_on", { ascending: false }).limit(8),
        ]);
        if (l.error || h.error) throw new Error((l.error || h.error).message);
        loans = l.data || []; history = h.data || [];
      }
      return { m: base.data, loans, history };
    },
    !!(chama?.id && memberId)
  );

  if (loading && !data) return <Spinner />;
  if (!data) return <Notice tone="error" icon={AlertCircle}>Could not open this profile{error ? `: ${error}` : ""}.</Notice>;

  const { m, loans, history } = data;
  const owed = loans.filter((l) => l.disbursed && l.status === "active").reduce((s, l) => s + Number(l.balance ?? l.amount ?? 0), 0);
  const digits = (m.phone || "").replace(/[^\d+]/g, "");
  const wa = digits.replace(/^\+/, "").replace(/^0/, "254");

  return (
    <div className="cm-profile">
      <StaleNote fromCache={fromCache} cachedAt={cachedAt} online={online} />
      <div className="cm-profile-head">
        <span className="cm-avatar lg">{initials(m.name)}</span>
        <div>
          <h3>{m.name}{isSelf ? " (you)" : ""}</h3>
          <div className="cm-pills"><Pill tone="gold">{roleLabel(m.role)}</Pill><Pill tone={STATUS_TONE[m.status || "active"] || "neutral"}>{m.status || "active"}</Pill></div>
          <small>Member since {formatDate(m.joined_at)}</small>
        </div>
      </div>

      {m.phone && (
        <div className="cm-actions-row">
          <a className="cm-btn" href={`tel:${digits}`}><Phone size={15} /> Call</a>
          {!isSelf && <a className="cm-btn" href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={15} /> WhatsApp</a>}
        </div>
      )}

      {isOfficial && m.national_id && (
        <Panel icon={IdCard} title="Details" collapsible={false}>
          <StatGrid cols={2}><Stat label="National ID" value={m.national_id} /></StatGrid>
        </Panel>
      )}

      {!seeMoney ? (
        <Notice icon={Lock}>Savings, loans and contributions are private to each member and the Chama officials.</Notice>
      ) : (
        <>
          <Panel icon={Wallet} title="Money" tone="green">
            <StatGrid>
              <Stat label="Savings" value={formatKES(m.savings_balance)} />
              <Stat label="Shares" value={formatKES(m.shares_balance)} />
              <Stat label="Welfare" value={formatKES(m.welfare_balance)} />
              <Stat label="Loan owed" value={owed > 0 ? formatKES(owed) : "None"} tone={owed > 0 ? "gold" : ""} />
            </StatGrid>
            <div style={{ marginTop: 10 }}>
              <ActionCard icon={FileText} title={isSelf ? "My statement" : `${m.name.split(" ")[0]}'s statement`} sub="Everything paid in and out" action="Open statement" onClick={() => go(isSelf ? "money/statement" : `money/statement?member=${m.id}`)} />
            </div>
          </Panel>

          <Panel icon={History} title="Recent contributions" badge={history.length || ""} defaultOpen={history.length > 0}>
            {history.length === 0 ? <EmptyState>No contributions recorded.</EmptyState> : (
              <SubCardList>
                {history.map((h) => (
                  <SubCard key={h.id} title={`${formatKES(h.amount)} · ${h.contribution_type === "loan_repayment" ? "Loan repayment" : h.contribution_type}`} sub={formatDate(h.contributed_on)} right={<Pill tone={REQ_TONE[h.status] || "neutral"}>{REQ_LABEL[h.status] || h.status}</Pill>} />
                ))}
              </SubCardList>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
