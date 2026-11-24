// ============================================================================
// FILE: src/Pages/Admin/ElimuAdminDashboard.jsx   Route: /admin/elimu
// The Elimu owner's landing page. Same visual language as the school side of Elimu: warm paper, forest green, gold, and a different card
// shape for each kind of information (hero, ledger, sticky note, ticket, folder tab). Phone first.
// ============================================================================
import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { School, CreditCard, LifeBuoy, Users, RefreshCw, MessageSquare, Phone, Mail, MessageCircle, ChevronRight, ArrowUpRight, AlertTriangle } from "lucide-react";
import { elimuAdmin, money, dateText, STATE } from "./elimuAdminApi";
import ElimuOwnerGate from "./ElimuOwnerGate";
import { P, SHAPE, lift, num, Card, Eyebrow, StatusPill, Avatar, Page, Notice, Loading, btn, btnGhost } from "./elimuOwnerUi";

const ORDER = ["active", "grace", "ended", "suspended", "none"];
const CH = { message: ["wrote a message", MessageSquare], whatsapp: ["opened WhatsApp", MessageCircle], call: ["tapped Call", Phone], email: ["opened Email", Mail] };

function Hero({ o }) {
  const s = o.by_state || {}; const total = Math.max(1, o.schools);
  return (
    <Card tone="dark" shape="hero" className="relative overflow-hidden p-5 md:p-6 h-full flex flex-col">
      <svg aria-hidden="true" viewBox="0 0 200 200" className="absolute -right-10 -top-12 w-56 h-56 opacity-[.16]" fill="none" stroke={P.accent} strokeWidth="1.5"><circle cx="100" cy="100" r="40" /><circle cx="100" cy="100" r="62" /><circle cx="100" cy="100" r="84" /></svg>
      <Eyebrow color={P.accent}>Schools using Elimu</Eyebrow>
      <div className="mt-1 flex items-end gap-4 flex-wrap">
        <span className="text-[56px] md:text-[64px] leading-none font-black tracking-tight tabular-nums">{num(o.schools)}</span>
        <span className="pb-2 text-sm opacity-80">{o.new_schools_30d > 0 ? `${o.new_schools_30d} joined in the last 30 days` : "clients"}</span>
      </div>
      <p className="mt-1 text-sm opacity-85"><b className="font-extrabold">{num(o.students)}</b> active students across all schools.</p>
      <div className="mt-auto pt-6">
        <div className="flex h-2.5 rounded-full overflow-hidden bg-white/10 gap-[3px]" role="img" aria-label="Schools by status">
          {ORDER.filter((k) => s[k] > 0).map((k) => <span key={k} style={{ width: `${(s[k] / total) * 100}%`, background: k === "none" ? "#8E8A7B" : STATE[k].fg === "#94650F" ? P.accent : STATE[k].fg === "#0B7A5A" ? "#3FBF92" : k === "ended" ? "#E5836B" : "#B58CD0" }} />)}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">{ORDER.map((k) => (
          <Link key={k} to={`/admin/elimu/schools?filter=${k}`} className="rounded-full px-3 py-1.5 text-[12px] font-bold" style={{ background: "rgba(255,255,255,.10)", color: "#fff" }}>{STATE[k].label} <b className="ml-1">{s[k] || 0}</b></Link>))}</div>
      </div>
    </Card>
  );
}

function BarsSvg({ data }) {
  const max = Math.max(1, ...data.map((d) => Number(d.amount)));
  return (
    <svg viewBox="0 0 300 100" className="w-full h-28" role="img" aria-label="Collected in the last six months">
      {data.map((d, i) => { const h = Math.max(3, (Number(d.amount) / max) * 58); const x = i * 50 + 8; const last = i === data.length - 1;
        return (<g key={d.month}><rect x={x} y={82 - h} width="34" height={h} rx="7" fill={last ? P.jade : "#9AD4BE"} />
          <text x={x + 17} y="97" textAnchor="middle" fontSize="9.5" fill={P.muted}>{d.month.slice(5)}/{d.month.slice(2, 4)}</text>
          {Number(d.amount) > 0 && <text x={x + 17} y={78 - h} textAnchor="middle" fontSize="8.5" fontWeight="700" fill={P.ink}>{Number(d.amount) >= 1000 ? `${Math.round(Number(d.amount) / 100) / 10}k` : d.amount}</text>}</g>); })}
    </svg>
  );
}

function Money({ o }) {
  const owing = Number(o.outstanding) > 0;
  return (
    <div className="grid gap-4 h-full" style={{ gridTemplateRows: "auto auto" }}>
      <Card shape="ledger" className="relative p-5 pl-7 overflow-hidden" style={{ background: P.paper }}>
        <span aria-hidden="true" className="absolute left-3 top-0 bottom-0 w-px" style={{ background: P.margin, opacity: .55 }} />
        <div className="flex items-start justify-between gap-3">
          <div><Eyebrow>Collected this month</Eyebrow><div className="text-[30px] font-black tracking-tight tabular-nums" style={{ color: P.jade }}>{money(o.collected_this_month)}</div>
            <div className="text-[12px]" style={{ color: P.muted }}>All time {money(o.collected_total)}</div></div>
          <Link to="/admin/elimu/payments" className="text-[12px] font-bold inline-flex items-center gap-0.5" style={{ color: P.primary }}>Payments <ArrowUpRight size={14} /></Link>
        </div>
        <div className="mt-2"><BarsSvg data={o.monthly_collected || []} /></div>
      </Card>
      <div className="grid grid-cols-2 gap-4">
        <Card shape="paper" className="p-4"><Eyebrow>Billed per month</Eyebrow><div className="text-[20px] font-black tabular-nums mt-1" style={{ color: P.ink }}>{money(o.billed_monthly)}</div><div className="text-[11.5px]" style={{ color: P.muted }}>active students × price</div></Card>
        <Card shape="gauge" className="p-4" style={{ background: owing ? P.owedBg : P.jadeBg, border: "none" }}><Eyebrow color={owing ? P.owed : "#075B43"}>Outstanding</Eyebrow>
          <div className="text-[20px] font-black tabular-nums mt-1" style={{ color: owing ? P.owed : "#075B43" }}>{money(o.outstanding)}</div><div className="text-[11.5px]" style={{ color: owing ? P.owed : "#075B43" }}>{owing ? "owed by overdue schools" : "nobody owes anything"}</div></Card>
      </div>
    </div>
  );
}

function Attention({ list }) {
  return (
    <section aria-label="Needs attention">
      <div className="flex items-end justify-between mb-2"><div><h2 className="text-[17px] font-black" style={{ color: P.ink }}>Needs attention</h2><p className="text-[12.5px]" style={{ color: P.muted }}>Overdue, stopped or suspended. Biggest balance first.</p></div>
        <Link to="/admin/elimu/schools" className="text-[13px] font-bold" style={{ color: P.primary }}>All schools</Link></div>
      {list.length === 0 ? <Card className="p-5 text-sm flex items-center gap-3" style={{ background: P.jadeBg, border: "none", color: "#075B43" }}><span className="text-xl">✓</span> Every school is in good standing.</Card> : (
        <div className="grid gap-3">{list.slice(0, 8).map((x) => { const st = STATE[x.licence.state];
          return (
            <Link key={x.tenant_id} to={`/admin/elimu/schools?open=${x.tenant_id}`} className="block relative pl-5 pr-4 py-3.5 transition active:scale-[.985] hover:-translate-y-0.5" style={{ background: P.paper, borderRadius: "6px 20px 20px 6px", boxShadow: lift, border: `1px solid ${P.border}` }}>
              <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: st.fg, borderRadius: "6px 0 0 6px" }} />
              <div className="flex items-center gap-3"><Avatar name={x.name} size={40} />
                <div className="min-w-0 flex-1"><div className="font-extrabold truncate" style={{ color: P.ink }}>{x.name}</div><div className="text-[12px]" style={{ color: P.muted }}>{num(x.students)} students · paid until {dateText(x.licence.paid_until)}</div></div>
                <div className="text-right shrink-0"><StatusPill state={x.licence.state} />{Number(x.amount_due) > 0 && <div className="text-[12px] font-extrabold mt-1" style={{ color: P.owed }}>{money(x.amount_due)}</div>}</div></div>
            </Link>); })}</div>)}
    </section>
  );
}

function Renewals({ list }) {
  if (!list.length) return null;
  return (
    <section aria-label="Renewals due soon" className="mt-1">
      <h3 className="text-[13px] font-extrabold mb-2" style={{ color: P.ink }}>Renewals due within 7 days</h3>
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">{list.map((x) => (
        <Link key={x.tenant_id} to={`/admin/elimu/schools?open=${x.tenant_id}`} className="shrink-0 w-56 p-3.5" style={{ background: P.accentTint, borderRadius: SHAPE.tab, boxShadow: lift }}>
          <div className="font-extrabold truncate" style={{ color: P.ink }}>{x.name}</div><div className="text-[12px]" style={{ color: P.accentDeep }}>in {x.licence.days_left} day{x.licence.days_left === 1 ? "" : "s"}</div>
          <div className="text-[15px] font-black mt-1 tabular-nums" style={{ color: P.ink }}>{money(x.monthly_amount)}</div></Link>))}</div>
    </section>
  );
}

function Messages({ msgs, total }) {
  return (
    <section aria-label="New messages">
      <div className="flex items-end justify-between mb-2"><div><h2 className="text-[17px] font-black" style={{ color: P.ink }}>New messages {total > 0 && <span className="ml-1 align-middle inline-flex min-w-[22px] h-[22px] px-1.5 items-center justify-center rounded-full text-[12px] text-white" style={{ background: P.owed }}>{total}</span>}</h2>
        <p className="text-[12.5px]" style={{ color: P.muted }}>From schools and parents using the Help centre.</p></div><Link to="/admin/elimu/support" className="text-[13px] font-bold" style={{ color: P.primary }}>Open inbox</Link></div>
      {msgs.length === 0 ? <Card className="p-5 text-sm" style={{ color: P.muted }}>No new messages. When someone asks for help it appears here.</Card> : (
        <div className="grid gap-3">{msgs.map((m) => { const [label, Icon] = CH[m.channel];
          return (
            <Link key={m.id} to="/admin/elimu/support" className="flex gap-3 p-4 transition active:scale-[.985]" style={{ background: P.paper, borderRadius: SHAPE.ticket, boxShadow: lift, border: `1px solid ${P.border}` }}>
              <span className="shrink-0 w-10 h-10 rounded-2xl inline-flex items-center justify-center" style={{ background: P.tint, color: P.primary }}><Icon size={18} /></span>
              <div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><b className="truncate" style={{ color: P.ink }}>{m.school || m.school_code || "Unknown school"}</b><span className="text-[11.5px] shrink-0" style={{ color: P.muted }}>{new Date(m.created_at).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div>
                <div className="text-[12px]" style={{ color: P.muted }}>{m.from_name || "Someone"} ({m.from_kind}) {label}</div>{m.message && <p className="text-[13.5px] mt-1 line-clamp-2">{m.message}</p>}</div></Link>); })}</div>)}
    </section>
  );
}

const TILES = [
  ["/admin/elimu/schools", School, "Schools", "Every client, students and licence", "tab"],
  ["/admin/elimu/payments", CreditCard, "Payments", "Record and review money", "ledger"],
  ["/admin/elimu/support", LifeBuoy, "Support inbox", "Help requests", "ticket"],
  ["/admin/elimu/team", Users, "Elimu team", "Who can manage Elimu", "gauge"],
];
function Tiles({ unread }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{TILES.map(([to, Icon, title, sub, shape]) => (
      <Link key={to} to={to} className="relative p-4 transition active:scale-[.985] hover:-translate-y-0.5" style={{ background: P.paper, borderRadius: SHAPE[shape], boxShadow: lift, border: `1px solid ${P.border}` }}>
        <span className="w-10 h-10 rounded-2xl inline-flex items-center justify-center" style={{ background: P.tint, color: P.primary }}><Icon size={20} /></span>
        {to.endsWith("support") && unread > 0 && <span className="absolute top-3 right-3 min-w-[22px] h-[22px] px-1.5 inline-flex items-center justify-center rounded-full text-[12px] font-bold text-white" style={{ background: P.owed }}>{unread}</span>}
        <div className="mt-3 font-extrabold" style={{ color: P.ink }}>{title}</div><div className="text-[12px] pr-5" style={{ color: P.muted }}>{sub}</div>
        <ChevronRight size={16} className="absolute bottom-4 right-3" style={{ color: P.muted }} /></Link>))}</div>
  );
}

function Dashboard() {
  const [o, setO] = useState(null); const [msgs, setMsgs] = useState([]); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const [ov, inbox] = await Promise.all([elimuAdmin.overview(), elimuAdmin.inbox("NEW")]); setO(ov); setMsgs(inbox.slice(0, 4)); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); const id = setInterval(load, 120000); return () => clearInterval(id); }, [load]);
  return (
    <Page wide title="Elimu management" subtitle="Your schools, their licences, the money and the help requests."
      actions={<button type="button" onClick={load} className={btn} style={btnGhost}><RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh</button>}>
      {error && <Notice>{error}</Notice>}
      {!o && loading && <Loading />}
      {o && (
        <div className="space-y-5">
          {Number(o.outstanding) > 0 && o.attention.length > 0 && (
            <div className="flex items-center gap-3 rounded-2xl px-4 py-3 text-[13.5px]" style={{ background: P.owedBg, color: P.owed }}><AlertTriangle size={18} className="shrink-0" /><span><b>{o.attention.length} school{o.attention.length === 1 ? "" : "s"}</b> need{o.attention.length === 1 ? "s" : ""} attention. {money(o.outstanding)} is overdue.</span></div>)}
          <div className="grid gap-5 lg:grid-cols-12">
            <div className="lg:col-span-7"><Hero o={o} /></div>
            <div className="lg:col-span-5"><Money o={o} /></div>
          </div>
          <Tiles unread={o.new_messages} />
          <div className="grid gap-5 lg:grid-cols-2 items-start">
            <div className="space-y-4"><Attention list={o.attention} /><Renewals list={o.due_soon} /></div>
            <Messages msgs={msgs} total={o.new_messages} />
          </div>
        </div>)}
    </Page>
  );
}
export default function ElimuAdminDashboard() { return <ElimuOwnerGate><Dashboard /></ElimuOwnerGate>; }
