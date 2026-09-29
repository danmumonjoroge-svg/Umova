import React, { useState } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import { Megaphone, CalendarDays, Clock, HeartHandshake, Pin, Trash2, Loader2, AlertCircle, CheckCircle2, Plus } from "lucide-react";
import useCachedQuery from "../shell/useCachedQuery";
import { formatDate, todayISO } from "../shell/format";
import { Spinner, StaleNote, Notice, EmptyState } from "../shell/ui";

// Chama Updates — meeting notices, reminders, welfare events, notices.
// Deliberately separate from technical/system notifications. Backed by
// chama_announcements (sql/007). If that table isn't installed yet this
// screen says so plainly instead of pretending there are no updates.
const KINDS = [
  { value: "meeting", label: "Meeting", icon: CalendarDays },
  { value: "reminder", label: "Reminder", icon: Clock },
  { value: "notice", label: "Notice", icon: Megaphone },
];
const ICON = { meeting: CalendarDays, reminder: Clock, notice: Megaphone, welfare: HeartHandshake };

export default function UpdatesWorkspace() {
  const { chama, member, hasRole } = useChama();
  const canPost = hasRole(["secretary", "chairperson"]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", kind: "notice", event_date: "", pinned: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // {tone, text}

  const { data, loading, fromCache, cachedAt, online, reload } = useCachedQuery(
    chama?.id ? `updates:${chama.id}` : null,
    async () => {
      const today = todayISO();
      const [a, w] = await Promise.all([
        supabase.from("chama_announcements").select("id,title,body,kind,event_date,pinned,created_at,expires_on").eq("chama_id", chama.id).order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(50),
        supabase.from("welfare_events").select("id,title,event_date,location,status").eq("chama_id", chama.id).gte("event_date", today).in("status", ["planned", "ongoing"]).order("event_date", { ascending: true }).limit(10),
      ]);
      if (w.error) throw new Error(w.error.message);
      // A missing table (migration 007 not run) is reported, not hidden.
      const missing = !!a.error && /does not exist|schema cache|relation/i.test(a.error.message);
      if (a.error && !missing) throw new Error(a.error.message);
      return { posts: missing ? [] : (a.data || []).filter((p) => !p.expires_on || p.expires_on >= today), events: w.data || [], missing };
    },
    !!chama?.id
  );

  const post = async (e) => {
    e.preventDefault();
    setMsg(null);
    if (!form.title.trim()) return setMsg({ tone: "error", text: "Give the update a title." });
    setBusy(true);
    const { error } = await supabase.from("chama_announcements").insert([{
      chama_id: chama.id, title: form.title.trim(), body: form.body.trim() || null, kind: form.kind,
      event_date: form.event_date || null, pinned: form.pinned, created_by: member.id,
    }]);
    setBusy(false);
    if (error) return setMsg({ tone: "error", text: error.message });
    setMsg({ tone: "ok", text: "Posted — members can see it now." });
    setForm({ title: "", body: "", kind: "notice", event_date: "", pinned: false });
    setOpen(false);
    reload();
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this update for everyone?")) return;
    const { error } = await supabase.from("chama_announcements").delete().eq("id", id);
    if (error) return setMsg({ tone: "error", text: error.message });
    reload();
  };

  if (loading && !data) return <Spinner />;

  const feed = [
    ...(data?.posts || []).map((p) => ({ ...p, _k: `p${p.id}`, _post: true, _sort: p.created_at })),
    ...(data?.events || []).map((ev) => ({ _k: `w${ev.id}`, id: ev.id, title: ev.title, kind: "welfare", event_date: ev.event_date, body: ev.location ? `Where: ${ev.location}` : null, _sort: ev.event_date })),
  ];

  return (
    <div>
      <StaleNote fromCache={fromCache} cachedAt={cachedAt} online={online} />
      {data?.missing && <Notice tone="warn" icon={AlertCircle}>Announcements are not switched on for this Chama yet. Ask your administrator to run <code>007_announcements.sql</code>. Welfare events are still shown below.</Notice>}
      {msg && <Notice tone={msg.tone === "ok" ? "ok" : "error"} icon={msg.tone === "ok" ? CheckCircle2 : AlertCircle}>{msg.text}</Notice>}

      {canPost && !data?.missing && (
        <>
          <button className="cm-btn primary" disabled={!online} onClick={() => setOpen((v) => !v)}><Plus size={15} /> Post an update</button>
          {!online && <p className="cm-hint">You need a connection to post.</p>}
          {open && (
            <form className="cm-form" onSubmit={post}>
              <label>Title<input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Monthly meeting this Saturday" required /></label>
              <label>Details (optional)<textarea rows={3} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} /></label>
              <div className="cm-form-row">
                <label>Type<select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
                <label>Date (if it is an event)<input type="date" value={form.event_date} onChange={(e) => setForm((f) => ({ ...f, event_date: e.target.value }))} /></label>
              </div>
              <label className="cm-check"><input type="checkbox" checked={form.pinned} onChange={(e) => setForm((f) => ({ ...f, pinned: e.target.checked }))} /> Pin to the top</label>
              <button className="cm-btn primary" type="submit" disabled={busy}>{busy ? <Loader2 size={15} className="spin" /> : "Post"}</button>
            </form>
          )}
        </>
      )}

      {feed.length === 0 ? <EmptyState icon={Megaphone}>No updates yet.</EmptyState> : (
        <ul className="cm-feed">
          {feed.map((p) => {
            const I = ICON[p.kind] || Megaphone;
            return (
              <li key={p._k}>
                <span className="cm-list-icon"><I size={16} /></span>
                <div>
                  <strong>{p.pinned && <Pin size={12} />} {p.title}</strong>
                  {p.body && <p>{p.body}</p>}
                  <small>{p.event_date ? `${formatDate(p.event_date, { weekday: "short", day: "numeric", month: "short" })}` : formatDate(p.created_at)}</small>
                </div>
                {p._post && canPost && <button className="cm-icon-btn" onClick={() => remove(p.id)} aria-label="Delete update"><Trash2 size={15} /></button>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
