// ============================================================================
// FILE: src/Pages/Admin/ElimuTeam.jsx   Route: /admin/elimu/team
// Who may use Elimu management. Only the people listed here (not every Finance "admin") see the Elimu menu and can read school data.
// An existing owner adds a staff member by the email they sign in with, and can remove them again.
// ============================================================================
import React, { useEffect, useState, useCallback } from "react";
import { Trash2, UserPlus } from "lucide-react";
import { elimuAdmin } from "./elimuAdminApi";
import ElimuOwnerGate from "./ElimuOwnerGate";
import { P, SHAPE, lift, Avatar, Page, Notice, Loading, btn, btnPrimary, btnDanger, inputCls, inputStyle } from "./elimuOwnerUi";

function Team() {
  const [rows, setRows] = useState(null); const [error, setError] = useState(""); const [ok, setOk] = useState(""); const [email, setEmail] = useState(""); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setRows(await elimuAdmin.owners()); setError(""); } catch (e) { setError(e.message); } }, []);
  useEffect(() => { load(); }, [load]);
  const add = async (e) => {
    e.preventDefault(); setError(""); setOk(""); setBusy(true);
    try { await elimuAdmin.addOwner(email, note); setOk("Added. They will see the Elimu menu the next time they open the app."); setEmail(""); setNote(""); await load(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const remove = async (r) => {
    if (!window.confirm(`Remove ${r.email || "this person"} from Elimu management? They will no longer see schools or messages.`)) return;
    setError(""); setOk(""); try { await elimuAdmin.removeOwner(r.user_id); setOk("Removed."); await load(); } catch (err) { setError(err.message); }
  };
  return (
    <Page title="Elimu team" subtitle="The people who can manage Elimu: see every school, record payments, suspend and read support messages. A Finance admin who is not on this list cannot see any of it.">
      {error && <Notice>{error}</Notice>}{ok && <Notice kind="ok">{ok}</Notice>}
      <form onSubmit={add} className="p-5 mb-5" style={{ background: P.paper, borderRadius: SHAPE.tab, boxShadow: lift, border: `1px solid ${P.border}` }}>
        <h2 className="font-black mb-3 flex items-center gap-2" style={{ color: P.ink }}><UserPlus size={18} /> Add a team member</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input className={inputCls} style={inputStyle} type="email" placeholder="Email they sign in with" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={inputCls} style={inputStyle} placeholder="Role note (e.g. Support)" aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button type="submit" disabled={busy || !email.trim()} className={`${btn} mt-4`} style={btnPrimary}>{busy ? "Adding…" : "Add"}</button>
        <p className="text-[12px] mt-2" style={{ color: P.muted }}>The person must already have an account on the system.</p>
      </form>
      {rows === null ? <Loading /> : (
        <div className="space-y-3">{rows.map((r) => (
          <div key={r.user_id} className="p-4 flex items-center gap-3" style={{ background: P.paper, borderRadius: "6px 20px 20px 6px", boxShadow: lift, border: `1px solid ${P.border}` }}>
            <Avatar name={r.email || "?"} size={42} />
            <div className="min-w-0 flex-1"><div className="font-extrabold truncate" style={{ color: P.ink }}>{r.email || "Unknown email"}{r.is_me && <span className="ml-2 text-[11px] rounded-full px-2 py-0.5" style={{ background: P.tint, color: P.deep }}>You</span>}</div><div className="text-[12px]" style={{ color: P.muted }}>{r.note || "Owner"} · added {new Date(r.added).toLocaleDateString("en-KE")}</div></div>
            {!r.is_me && <button type="button" onClick={() => remove(r)} aria-label={`Remove ${r.email}`} className="w-11 h-11 rounded-xl inline-flex items-center justify-center" style={btnDanger}><Trash2 size={16} /></button>}
          </div>))}</div>)}
    </Page>
  );
}
export default function ElimuTeam() { return <ElimuOwnerGate><Team /></ElimuOwnerGate>; }
