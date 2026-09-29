import React from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import { HeartHandshake, CalendarDays, AlertCircle, Info } from "lucide-react";
import useCachedQuery from "../shell/useCachedQuery";
import { formatKES, formatDate, todayISO } from "../shell/format";
import { Spinner, StaleNote, Notice, EmptyState, Pill, ActionCard, SectionTitle } from "../shell/ui";

// Member-facing welfare: your welfare balance, what you have given, what is
// coming up. Case details are NOT shown here — welfare cases are handled by
// welfare staff in WelfareCaseDesk, which has its own per-member visibility
// rules. This screen doesn't try to reimplement them.
const TONE = { Approved: "ok", Pending: "warn", Rejected: "error" };

export default function MemberWelfare({ go }) {
  const { chama, member } = useChama();
  const { data, loading, error, fromCache, cachedAt, online } = useCachedQuery(
    chama?.id && member?.id ? `mywelfare:${chama.id}:${member.id}` : null,
    async () => {
      const [me, given, events] = await Promise.all([
        supabase.from("chama_members").select("welfare_balance").eq("id", member.id).single(),
        supabase.from("welfare_contributions").select("id,amount,status,contributed_on").eq("chama_id", chama.id).eq("member_id", member.id).order("contributed_on", { ascending: false }).limit(20),
        supabase.from("welfare_events").select("id,title,event_date,location,description,status").eq("chama_id", chama.id).gte("event_date", todayISO()).in("status", ["planned", "ongoing"]).order("event_date", { ascending: true }).limit(10),
      ]);
      const failed = me.error || given.error || events.error;
      if (failed) throw new Error(failed.message);
      return { balance: me.data?.welfare_balance || 0, given: given.data || [], events: events.data || [] };
    },
    !!(chama?.id && member?.id)
  );

  if (loading && !data) return <Spinner />;
  if (!data) return <Notice tone="error" icon={AlertCircle}>Could not load welfare{error ? `: ${error}` : ""}.</Notice>;

  return (
    <div>
      <StaleNote fromCache={fromCache} cachedAt={cachedAt} online={online} />
      <ActionCard icon={HeartHandshake} title="My welfare" value={formatKES(data.balance)} sub="Your welfare balance" action="Give to welfare" onClick={() => go("welfare/contribute")} />

      <SectionTitle>Coming up</SectionTitle>
      {data.events.length === 0 ? <EmptyState icon={CalendarDays}>No welfare events planned right now.</EmptyState> : (
        <ul className="cm-txns">
          {data.events.map((e) => (
            <li key={e.id}><div><strong>{e.title}</strong><small>{formatDate(e.event_date, { weekday: "short", day: "numeric", month: "short" })}{e.location ? ` · ${e.location}` : ""}</small></div></li>
          ))}
        </ul>
      )}

      <SectionTitle>What I have given</SectionTitle>
      {data.given.length === 0 ? <EmptyState>Nothing recorded yet.</EmptyState> : (
        <ul className="cm-txns">
          {data.given.map((g) => (
            <li key={g.id}><div><strong>{formatKES(g.amount)}</strong><small>{formatDate(g.contributed_on)}</small></div><Pill tone={TONE[g.status] || "neutral"}>{g.status}</Pill></li>
          ))}
        </ul>
      )}

      <Notice icon={Info}>Welfare is the Chama's shared fund for members in difficult times. Your welfare officer runs cases and events.</Notice>
    </div>
  );
}
