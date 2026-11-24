// ============================================================================
// FILE: src/Pages/Admin/ElimuPayments.jsx   Route: /admin/elimu/payments
// Money received from schools, laid out like pages of a ledger. A payment extends that school's "paid until" date by the months it
// covers, and reopens the school if it was stopped.
// ============================================================================
import React, { useEffect, useState, useCallback } from "react";
import { Download } from "lucide-react";
import { elimuAdmin, money, dateText, downloadCsv } from "./elimuAdminApi";
import ElimuOwnerGate from "./ElimuOwnerGate";
import { P, SHAPE, lift, Card, Eyebrow, Avatar, Page, Notice, Loading, Empty, btn, btnPrimary, btnGhost, inputCls, inputStyle } from "./elimuOwnerUi";

function Payments() {
  const [rows, setRows] = useState(null); const [schools, setSchools] = useState([]); const [error, setError] = useState(""); const [ok, setOk] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ tenant: "", amount: "", months: "1", reference: "", method: "M-Pesa" });
  const load = useCallback(async () => { try { setRows(await elimuAdmin.paymentsAll(from, to)); setError(""); } catch (e) { setError(e.message); } }, [from, to]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { elimuAdmin.schools().then(setSchools).catch(() => {}); }, []);
  const pickSchool = (id) => { const s = schools.find((x) => x.tenant_id === id); setF((p) => ({ ...p, tenant: id, amount: s ? String(s.monthly_amount || "") : p.amount })); };
  const save = async (e) => {
    e.preventDefault(); setError(""); setOk("");
    if (!f.tenant) return setError("Choose the school that paid."); if (!f.amount) return setError("Enter the amount received.");
    setBusy(true); try { await elimuAdmin.pay(f.tenant, f); setOk("Payment saved. The school is open until the new date."); setF((p) => ({ ...p, reference: "" })); await load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const total = (rows || []).reduce((a, r) => a + Number(r.amount), 0);
  return (
    <Page title="Elimu payments" subtitle="Money received from schools."
      actions={<button type="button" disabled={!rows?.length} onClick={() => downloadCsv("elimu-payments.csv", rows.map((r) => ({ Date: r.paid_on, School: r.school, Amount: r.amount, Months: r.months, Reference: r.reference || "", Method: r.method || "" })))} className={btn} style={btnGhost}><Download size={15} /> Export CSV</button>}>
      {error && <Notice>{error}</Notice>}{ok && <Notice kind="ok">{ok}</Notice>}
      <Card tone="dark" shape="hero" className="p-5 mb-5">
        <Eyebrow color={P.accent}>{from || to ? "Received in this period" : "Received, all time"}</Eyebrow>
        <div className="text-[40px] leading-none font-black tracking-tight tabular-nums mt-1">{money(total)}</div>
        <div className="text-[12.5px] opacity-75 mt-1">{rows ? `${rows.length} payment${rows.length === 1 ? "" : "s"}` : ""}</div>
      </Card>
      <form onSubmit={save} className="p-5 mb-5" style={{ background: P.paper, borderRadius: SHAPE.tab, boxShadow: lift, border: `1px solid ${P.border}` }}>
        <h2 className="font-black mb-3" style={{ color: P.ink }}>Record a payment</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select aria-label="School" value={f.tenant} onChange={(e) => pickSchool(e.target.value)} className={`${inputCls} sm:col-span-2`} style={inputStyle}><option value="">Choose school…</option>{schools.map((s) => <option key={s.tenant_id} value={s.tenant_id}>{s.name} ({s.school_code})</option>)}</select>
          <input className={inputCls} style={inputStyle} inputMode="decimal" placeholder="Amount (KES)" aria-label="Amount" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          <input className={inputCls} style={inputStyle} inputMode="numeric" placeholder="Months covered" aria-label="Months covered" value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} />
          <input className={inputCls} style={inputStyle} placeholder="Reference (e.g. M-Pesa code)" aria-label="Reference" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
          <input className={inputCls} style={inputStyle} placeholder="Method" aria-label="Method" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} />
        </div>
        <button type="submit" disabled={busy} className={`${btn} mt-4 w-full sm:w-auto`} style={btnPrimary}>{busy ? "Saving…" : "Save payment"}</button>
      </form>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <label className="text-[12px] font-bold" style={{ color: P.muted }}>From<input type="date" className={`${inputCls} mt-1`} style={inputStyle} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-[12px] font-bold" style={{ color: P.muted }}>To<input type="date" className={`${inputCls} mt-1`} style={inputStyle} value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {rows === null ? <Loading /> : rows.length === 0 ? <Empty>No payments in this period.</Empty> : (
        <div className="relative pl-6" style={{ background: P.paper, borderRadius: SHAPE.ledger, boxShadow: lift, border: `1px solid ${P.border}` }}>
          <span aria-hidden="true" className="absolute left-3 top-0 bottom-0 w-px" style={{ background: P.margin, opacity: .55 }} />
          {rows.map((r, i) => (
            <div key={r.id} className="flex items-center gap-3 pr-4 py-3.5" style={{ borderTop: i ? `1px solid ${P.rule}` : "none" }}>
              <Avatar name={r.school} size={38} />
              <div className="min-w-0 flex-1"><div className="font-extrabold truncate" style={{ color: P.ink }}>{r.school}</div><div className="text-[12px]" style={{ color: P.muted }}>{dateText(r.paid_on)} · {r.months} month{r.months === 1 ? "" : "s"}{r.reference ? ` · ${r.reference}` : ""}{r.method ? ` (${r.method})` : ""}</div></div>
              <b className="tabular-nums" style={{ color: P.jade }}>{money(r.amount)}</b>
            </div>))}
        </div>)}
    </Page>
  );
}
export default function ElimuPayments() { return <ElimuOwnerGate><Payments /></ElimuOwnerGate>; }
