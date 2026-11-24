// ============================================================================
// FILE: src/Pages/Admin/ElimuSupportInbox.jsx   Route: /admin/elimu/support
// Notifications from users: typed messages from the in-app Help centre, and taps on Call / WhatsApp / Email. The WhatsApp chat, call or
// email itself happens in that app; here you see WHO reached out, from WHICH school, WHEN and HOW, then mark it Seen or Done.
// ============================================================================
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { MessageSquare, Phone, Mail, MessageCircle, Search } from "lucide-react";
import { elimuAdmin } from "./elimuAdminApi";
import ElimuOwnerGate from "./ElimuOwnerGate";
import { P, SHAPE, lift, Page, Notice, Loading, Empty, Chips, btn, btnPrimary, btnGhost, inputCls, inputStyle } from "./elimuOwnerUi";

const CH = { message: ["Wrote a message", MessageSquare], whatsapp: ["Opened WhatsApp", MessageCircle], call: ["Tapped Call", Phone], email: ["Opened Email", Mail] };
const WHO = { staff: "School staff", parent: "Parent", visitor: "Visitor" };
function Inbox() {
  const [rows, setRows] = useState(null); const [error, setError] = useState(""); const [status, setStatus] = useState("NEW"); const [q, setQ] = useState(""); const [chan, setChan] = useState("all"); const [notes, setNotes] = useState({});
  const load = useCallback(async () => { try { setRows(await elimuAdmin.inbox(status === "ALL" ? null : status)); setError(""); } catch (e) { setError(e.message); } }, [status]);
  useEffect(() => { load(); const id = setInterval(load, 60000); return () => clearInterval(id); }, [load]);
  const mark = async (id, st) => { try { await elimuAdmin.inboxSet(id, st, notes[id]); await load(); } catch (e) { setError(e.message); } };
  const list = useMemo(() => (rows || []).filter((r) => (chan === "all" || r.channel === chan) && (!q.trim() || `${r.school || ""} ${r.school_code || ""} ${r.from_name || ""} ${r.message || ""}`.toLowerCase().includes(q.trim().toLowerCase()))), [rows, chan, q]);
  return (
    <Page title="Elimu support inbox" subtitle="Help requests from schools and parents. Refreshes every minute.">
      <Chips items={[["NEW", "New"], ["SEEN", "Seen"], ["DONE", "Done"], ["ALL", "All"]]} value={status} onChange={setStatus} />
      <div className="flex gap-2 my-3 flex-wrap"><div className="relative flex-1 min-w-[220px]"><Search size={16} className="absolute left-3.5 top-3.5" style={{ color: P.muted }} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search school, person or message" aria-label="Search" className={`${inputCls} pl-10`} style={inputStyle} /></div>
        <select value={chan} onChange={(e) => setChan(e.target.value)} aria-label="How they reached out" className="min-h-[46px] px-3 rounded-xl text-sm bg-white" style={inputStyle}><option value="all">Any way</option><option value="message">Messages</option><option value="whatsapp">WhatsApp</option><option value="call">Calls</option><option value="email">Email</option></select></div>
      <p className="text-[12.5px] mb-3" style={{ color: P.muted }}>A tap on WhatsApp, Call or Email tells you the person reached out; what they say stays in that app. Typed messages show in full.</p>
      {error && <Notice>{error}</Notice>}
      {rows === null && !error ? <Loading /> : list.length === 0 ? <Empty>Nothing here.</Empty> : (
        <div className="space-y-3">{list.map((r) => { const [label, Icon] = CH[r.channel]; const isNew = r.status === "NEW"; return (
          <div key={r.id} className="p-4 relative" style={{ background: P.paper, borderRadius: SHAPE.ticket, boxShadow: lift, border: `1px solid ${isNew ? P.primary : P.border}` }}>
            <div className="flex items-start gap-3"><span className="shrink-0 w-11 h-11 rounded-2xl inline-flex items-center justify-center" style={{ background: P.tint, color: P.primary }}><Icon size={19} /></span>
              <div className="min-w-0 flex-1"><div className="font-extrabold truncate" style={{ color: P.ink }}>{r.tenant_id ? <Link to={`/admin/elimu/schools?open=${r.tenant_id}`}>{r.school || r.school_code}</Link> : (r.school_code || "Unknown school")}</div>
                <div className="text-[12px]" style={{ color: P.muted }}>{r.from_name || "Someone"} · {WHO[r.from_kind]} · {label}</div></div>
              <div className="text-right shrink-0"><div className="text-[11.5px]" style={{ color: P.muted }}>{new Date(r.created_at).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                <span className="inline-block mt-1 rounded-full px-2 py-0.5 text-[10.5px] font-extrabold uppercase tracking-wide" style={{ background: isNew ? P.primary : P.soft, color: isNew ? "#fff" : P.muted }}>{r.status}</span></div></div>
            {r.message && <p className="mt-3 text-[14px] whitespace-pre-wrap rounded-2xl p-3" style={{ background: P.soft }}>{r.message}</p>}
            {r.owner_note && <p className="mt-2 text-[12px] italic" style={{ color: P.muted }}>Your note: {r.owner_note}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2"><input value={notes[r.id] || ""} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} placeholder="Add a note (optional)" aria-label="Note" className="flex-1 min-w-[150px] min-h-[44px] px-3 rounded-xl text-sm bg-white" style={inputStyle} />
              {r.status === "NEW" && <button type="button" className={btn} style={btnGhost} onClick={() => mark(r.id, "SEEN")}>Mark seen</button>}
              {r.status !== "DONE" && <button type="button" className={btn} style={btnPrimary} onClick={() => mark(r.id, "DONE")}>Done</button>}
              {r.status === "DONE" && <button type="button" className={btn} style={btnGhost} onClick={() => mark(r.id, "NEW")}>Reopen</button>}</div>
          </div>); })}</div>)}
    </Page>
  );
}
export default function ElimuSupportInbox() { return <ElimuOwnerGate><Inbox /></ElimuOwnerGate>; }
