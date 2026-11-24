// ============================================================================
// FILE: src/Pages/Admin/ElimuSchools.jsx   Route: /admin/elimu/schools   (also ?filter=ended  or  ?open=<tenant id>)
// Every Elimu client as a card: status, students (bar sized against your biggest school), paid-until and what is owed.
// Tap a school for its sheet: contact, counts, record a payment, change terms, suspend / lift, payment history and messages.
// ============================================================================
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Search, Download, Phone, Mail } from "lucide-react";
import { elimuAdmin, money, dateText, STATE, downloadCsv } from "./elimuAdminApi";
import ElimuOwnerGate from "./ElimuOwnerGate";
import { P, SHAPE, lift, num, Card, Eyebrow, StatusPill, Avatar, Page, Notice, Loading, Empty, Chips, Sheet, btn, btnPrimary, btnGhost, btnDanger, inputCls, inputStyle } from "./elimuOwnerUi";

const FILTERS = [["all", "All"], ["active", "Active"], ["grace", "Overdue"], ["ended", "Stopped"], ["suspended", "Suspended"], ["none", "Not set up"]];
const Stat = ({ label, value }) => <div className="rounded-2xl p-3" style={{ background: P.soft }}><div className="text-[18px] font-black tabular-nums" style={{ color: P.ink }}>{value}</div><div className="text-[11.5px]" style={{ color: P.muted }}>{label}</div></div>;
const Field = ({ label, children }) => <label className="block text-[12px] font-bold" style={{ color: P.muted }}>{label}<div className="mt-1">{children}</div></label>;
const Section = ({ title, children }) => <section className="mt-6"><h3 className="text-[14px] font-black mb-2" style={{ color: P.ink }}>{title}</h3>{children}</section>;

function SchoolSheet({ tenant, onClose, onChanged }) {
  const [d, setD] = useState(null); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [ok, setOk] = useState("");
  const [pay, setPay] = useState({ amount: "", months: "1", reference: "", method: "M-Pesa" });
  const [lic, setLic] = useState({ paid_until: "", grace_days: "30", price: "23" }); const [reason, setReason] = useState("");
  const load = useCallback(async () => {
    try { const x = await elimuAdmin.detail(tenant); setD(x); setLic({ paid_until: x.licence?.paid_until || "", grace_days: String(x.grace_days), price: String(x.price_per_student) }); setPay((p) => ({ ...p, amount: p.amount || String(x.monthly_amount || "") })); }
    catch (e) { setErr(e.message); }
  }, [tenant]);
  useEffect(() => { load(); }, [load]);
  const run = async (fn, done) => { setBusy(true); setErr(""); setOk(""); try { await fn(); setOk(done); await load(); onChanged(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const state = d?.licence?.state || "none";
  return (
    <Sheet title={d?.name || "School"} subtitle={d ? `School code ${d.school_code}` : ""} onClose={onClose}>
      {err && <Notice>{err}</Notice>}{ok && <Notice kind="ok">{ok}</Notice>}
      {!d ? <Loading /> : (<>
        <Card tone="dark" shape="hero" className="p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap"><StatusPill state={state} />{d.licence?.paid_until && <span className="text-[13px] opacity-85">Paid until {dateText(d.licence.paid_until)}{(state === "active" || state === "grace") && d.licence.days_left != null ? ` · ${state === "grace" ? "stops" : "renews"} in ${d.licence.days_left} days` : ""}</span>}</div>
          <div className="mt-3 text-[34px] font-black leading-none tabular-nums">{money(d.monthly_amount, d.currency)}<span className="text-[13px] font-semibold opacity-70"> / month</span></div>
          <div className="text-[12.5px] opacity-80 mt-1">{num(d.students)} students × {d.price_per_student} · paid so far {money(d.paid_total, d.currency)}</div>
          {Number(d.amount_due) > 0 && <div className="mt-3 rounded-xl px-3 py-2 text-[13px] font-bold" style={{ background: "rgba(229,131,107,.2)", color: "#FFD9CF" }}>Overdue {d.overdue_months} month{d.overdue_months === 1 ? "" : "s"}: {money(d.amount_due, d.currency)} due</div>}
          {d.suspended && d.suspended_reason && <div className="mt-2 text-[12.5px] opacity-85">Suspended: {d.suspended_reason}</div>}
        </Card>
        <Section title="Contact">
          <div className="text-sm space-y-1.5" style={{ color: P.text }}>
            {d.phone && <div className="flex items-center gap-2"><Phone size={15} /><a style={{ color: P.primary }} href={`tel:${d.phone}`}>{d.phone}</a></div>}
            {d.email && <div className="flex items-center gap-2"><Mail size={15} /><a style={{ color: P.primary }} href={`mailto:${d.email}`}>{d.email}</a></div>}
            {d.address && <div>{d.address}</div>}{!d.phone && !d.email && !d.address && <div style={{ color: P.muted }}>No contact details on the school profile yet.</div>}</div></Section>
        <Section title="Size"><div className="grid grid-cols-3 gap-2"><Stat label="Active students" value={num(d.students)} /><Stat label="Boys / girls" value={`${d.boys} / ${d.girls}`} /><Stat label="Staff accounts" value={d.staff} /><Stat label="Guardians" value={d.guardians} /><Stat label="Parent logins" value={d.parent_logins} /><Stat label="Parents signed in" value={d.parents_signed_in} /></div>
          <div className="text-[12px] mt-2" style={{ color: P.muted }}>Last activity {d.last_active ? new Date(d.last_active).toLocaleString("en-KE") : "none yet"} · Joined {dateText(d.joined)}</div></Section>
        {state === "none" && <Section title="Start a licence"><p className="text-sm mb-2" style={{ color: P.muted }}>This school has no licence, so it is not billed and not locked. Start one to begin a 30-day period.</p>
          <button type="button" disabled={busy} className={btn} style={btnPrimary} onClick={() => run(() => elimuAdmin.setLicence(tenant, {}), "Licence started. The school is active for 30 days.")}>Start a 30-day licence</button></Section>}
        <Section title="Record a payment received">
          <div className="grid grid-cols-2 gap-3"><Field label={`Amount (${d.currency})`}><input className={inputCls} style={inputStyle} inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
            <Field label="Months covered"><input className={inputCls} style={inputStyle} inputMode="numeric" value={pay.months} onChange={(e) => setPay({ ...pay, months: e.target.value })} /></Field>
            <Field label="Reference (e.g. M-Pesa code)"><input className={inputCls} style={inputStyle} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></Field>
            <Field label="Method"><input className={inputCls} style={inputStyle} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} /></Field></div>
          <button type="button" disabled={busy} className={`${btn} mt-3`} style={btnPrimary} onClick={() => run(() => elimuAdmin.pay(tenant, pay), "Payment saved. The school is open until the new date.")}>Save payment</button></Section>
        <Section title="Licence terms">
          <div className="grid grid-cols-3 gap-3"><div className="col-span-3 sm:col-span-1"><Field label="Paid until"><input type="date" className={inputCls} style={inputStyle} value={lic.paid_until} onChange={(e) => setLic({ ...lic, paid_until: e.target.value })} /></Field></div>
            <Field label="Grace days"><input className={inputCls} style={inputStyle} inputMode="numeric" value={lic.grace_days} onChange={(e) => setLic({ ...lic, grace_days: e.target.value })} /></Field>
            <Field label="Price / student"><input className={inputCls} style={inputStyle} inputMode="decimal" value={lic.price} onChange={(e) => setLic({ ...lic, price: e.target.value })} /></Field></div>
          <button type="button" disabled={busy || state === "none"} className={`${btn} mt-3`} style={btnGhost} onClick={() => run(() => elimuAdmin.setLicence(tenant, { paid_until: lic.paid_until || null, grace_days: lic.grace_days === "" ? null : Number(lic.grace_days), price: lic.price === "" ? null : Number(lic.price) }), "Terms saved.")}>Save terms</button></Section>
        <Section title={d.suspended ? "This school is suspended" : "Suspend this school"}>
          {!d.suspended && <input className={`${inputCls} mb-2`} style={inputStyle} placeholder="Reason (kept for you)" value={reason} onChange={(e) => setReason(e.target.value)} />}
          <button type="button" disabled={busy || state === "none"} className={btn} style={d.suspended ? btnPrimary : btnDanger} onClick={() => run(() => elimuAdmin.setLicence(tenant, { suspended: !d.suspended, reason }), d.suspended ? "Suspension lifted. The school can use Elimu again." : "School suspended. It cannot open Elimu until you lift this.")}>{d.suspended ? "Lift the suspension" : "Suspend now"}</button></Section>
        <Section title="Recent payments">{d.payments.length === 0 ? <p className="text-sm" style={{ color: P.muted }}>No payments recorded yet.</p> : (
          <div className="space-y-2">{d.payments.map((p) => <div key={p.id} className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ background: P.paper, border: `1px solid ${P.border}` }}><div className="text-[13px]"><b style={{ color: P.ink }}>{dateText(p.paid_on)}</b><div style={{ color: P.muted }}>{p.months} month{p.months === 1 ? "" : "s"}{p.reference ? ` · ${p.reference}` : ""}{p.method ? ` (${p.method})` : ""}</div></div><b className="tabular-nums" style={{ color: P.jade }}>{money(p.amount)}</b></div>)}</div>)}</Section>
        <Section title="Recent messages from this school">{d.messages.length === 0 ? <p className="text-sm" style={{ color: P.muted }}>No messages.</p> : (
          <div className="space-y-2">{d.messages.map((m) => <div key={m.id} className="rounded-2xl px-4 py-3 text-[13.5px]" style={{ background: P.paper, border: `1px solid ${P.border}` }}><div className="text-[11.5px]" style={{ color: P.muted }}>{new Date(m.created_at).toLocaleString("en-KE")} · {m.from_name || "Someone"} ({m.from_kind}) · {m.status.toLowerCase()}</div>{m.message || ({ whatsapp: "Opened WhatsApp", call: "Tapped Call", email: "Opened Email" }[m.channel])}</div>)}
            <Link className="text-[13px] font-bold" style={{ color: P.primary }} to="/admin/elimu/support">Open inbox</Link></div>)}</Section>
      </>)}
    </Sheet>
  );
}

function SchoolCard({ s, biggest, onOpen }) {
  const st = STATE[s.licence.state]; const w = Math.max(4, (s.students / Math.max(1, biggest)) * 100); const owing = Number(s.amount_due) > 0;
  return (
    <button type="button" onClick={onOpen} className="text-left relative pl-5 pr-4 py-4 transition active:scale-[.985] hover:-translate-y-0.5 w-full" style={{ background: P.paper, borderRadius: "6px 22px 22px 6px", boxShadow: lift, border: `1px solid ${P.border}` }}>
      <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: st.fg, borderRadius: "6px 0 0 6px" }} />
      <div className="flex items-start gap-3"><Avatar name={s.name} size={44} />
        <div className="min-w-0 flex-1"><div className="font-extrabold truncate" style={{ color: P.ink }}>{s.name}</div><div className="text-[11.5px] font-mono" style={{ color: P.muted }}>{s.school_code}</div></div>
        <div className="flex flex-col items-end gap-1 shrink-0"><StatusPill state={s.licence.state} />{s.new_messages > 0 && <span className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: P.owed }}>{s.new_messages} new</span>}</div></div>
      <div className="mt-3"><div className="flex items-baseline justify-between"><span className="text-[22px] font-black tabular-nums" style={{ color: P.ink }}>{num(s.students)}<span className="text-[12px] font-semibold ml-1" style={{ color: P.muted }}>students</span></span><span className="text-[12px]" style={{ color: P.muted }}>{s.staff} staff · {s.parent_logins} parents</span></div>
        <div className="h-2 rounded-full mt-1.5" style={{ background: P.soft }}><div className="h-2 rounded-full" style={{ width: `${w}%`, background: P.primary }} /></div></div>
      <div className="mt-3 flex items-center justify-between text-[12.5px]"><span style={{ color: P.muted }}>{s.licence.paid_until ? `Paid until ${dateText(s.licence.paid_until)}` : "No licence yet"}</span>
        {owing ? <b style={{ color: P.owed }}>{money(s.amount_due, s.currency)} due</b> : <span className="font-bold tabular-nums" style={{ color: P.text }}>{money(s.monthly_amount, s.currency)}/mo</span>}</div>
    </button>
  );
}

function Schools() {
  const [rows, setRows] = useState(null); const [error, setError] = useState(""); const [q, setQ] = useState(""); const [sort, setSort] = useState("name");
  const [params, setParams] = useSearchParams(); const filter = params.get("filter") || "all"; const open = params.get("open");
  const load = useCallback(async () => { try { setRows(await elimuAdmin.schools()); setError(""); } catch (e) { setError(e.message); } }, []);
  useEffect(() => { load(); }, [load]);
  const counts = useMemo(() => { const c = { all: (rows || []).length }; (rows || []).forEach((s) => { c[s.licence.state] = (c[s.licence.state] || 0) + 1; }); return c; }, [rows]);
  const list = useMemo(() => {
    let r = rows || []; if (filter !== "all") r = r.filter((s) => s.licence.state === filter);
    const t = q.trim().toLowerCase(); if (t) r = r.filter((s) => `${s.name} ${s.school_code} ${s.email || ""} ${s.phone || ""}`.toLowerCase().includes(t));
    const by = { name: (a, b) => a.name.localeCompare(b.name), students: (a, b) => b.students - a.students, due: (a, b) => Number(b.amount_due) - Number(a.amount_due), expiry: (a, b) => String(a.licence.paid_until || "9").localeCompare(String(b.licence.paid_until || "9")) };
    return [...r].sort(by[sort]);
  }, [rows, filter, q, sort]);
  const biggest = Math.max(1, ...(rows || []).map((s) => s.students));
  const setFilter = (k) => { const p = new URLSearchParams(params); if (k === "all") p.delete("filter"); else p.set("filter", k); setParams(p); };
  const openSchool = (id) => { const p = new URLSearchParams(params); p.set("open", id); setParams(p); };
  const closeSheet = () => { const p = new URLSearchParams(params); p.delete("open"); setParams(p); };
  const exportCsv = () => downloadCsv("elimu-schools.csv", list.map((s) => ({ School: s.name, Code: s.school_code, Status: STATE[s.licence.state].label, Students: s.students, Staff: s.staff, "Parent logins": s.parent_logins, "Paid until": s.licence.paid_until || "", "Monthly bill": s.monthly_amount, "Amount due": s.amount_due, Phone: s.phone || "", Email: s.email || "" })));
  const total = list.reduce((a, s) => a + s.students, 0);
  return (
    <Page wide title="Elimu schools" subtitle="Every client, how many students they have and whether they have paid."
      actions={<button type="button" onClick={exportCsv} disabled={!list.length} className={btn} style={btnGhost}><Download size={15} /> Export CSV</button>}>
      <Chips items={FILTERS.map(([k, l]) => [k, l, counts[k] || 0])} value={filter} onChange={setFilter} />
      <div className="flex gap-2 my-3 flex-wrap"><div className="relative flex-1 min-w-[220px]"><Search size={16} className="absolute left-3.5 top-3.5" style={{ color: P.muted }} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, code, phone or email" aria-label="Search schools" className={`${inputCls} pl-10`} style={inputStyle} /></div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort" className="min-h-[46px] px-3 rounded-xl text-sm bg-white" style={inputStyle}><option value="name">Sort: name</option><option value="students">Sort: most students</option><option value="due">Sort: amount due</option><option value="expiry">Sort: renewal date</option></select></div>
      {error && <Notice>{error}</Notice>}
      {rows === null && !error ? <Loading /> : list.length === 0 ? <Empty>No schools match.</Empty> : (<>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{list.map((s) => <SchoolCard key={s.tenant_id} s={s} biggest={biggest} onOpen={() => openSchool(s.tenant_id)} />)}</div>
        <p className="text-[12.5px] mt-3" style={{ color: P.muted }}>{list.length} school{list.length === 1 ? "" : "s"} · {num(total)} students</p></>)}
      {open && <SchoolSheet tenant={open} onClose={closeSheet} onChanged={load} />}
    </Page>
  );
}
export default function ElimuSchools() { return <ElimuOwnerGate><Schools /></ElimuOwnerGate>; }
