// src/pos-erp/auth/POSPasskeySettings.jsx — "Fingerprint sign-in" card for My Business → Settings.
// Enrol this phone/laptop, see the devices that can sign in, remove one.
import React, { useCallback, useEffect, useState } from "react";
import { Fingerprint, Trash2, Loader2 } from "lucide-react";
import { posSupabase } from "../services/posSupabaseClient";
import { usePOSAuth } from "../context/POSAuthContext";
import { posPasskeys } from "./posPasskeys";

const fmt = (d) => new Date(d).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
const guessDevice = () => {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone"; if (/iPad/.test(ua)) return "iPad"; if (/Android/.test(ua)) return "Android phone";
  if (/Windows/.test(ua)) return "Windows PC"; if (/Mac/.test(ua)) return "Mac"; return "This device";
};

export default function POSPasskeySettings() {
  const { staff, tenant } = usePOSAuth();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const supported = posPasskeys.supported();

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { session } } = await posSupabase.auth.getSession();
    if (!session) { setDevices([]); setLoading(false); return; }
    const { data, error } = await posSupabase.from("webauthn_credentials")
      .select("id, nickname, created_at, last_used_at").eq("user_id", session.user.id).order("created_at", { ascending: false });
    if (error) setMsg({ kind: "err", text: "Couldn't load your devices." }); else setDevices(data || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    setMsg({ kind: "", text: "" });
    const suggested = guessDevice();
    const nickname = window.prompt("Name this device so you can recognise it later:", suggested);
    if (nickname === null) return;
    setBusy(true);
    try {
      // The label is what the phone shows in its fingerprint picker; the real login email is a synthetic address.
      const label = [staff?.name || staff?.full_name, tenant?.business_name || tenant?.name].filter(Boolean).join(" — ") || undefined;
      await posPasskeys.registerPasskey({ nickname: nickname.trim() || suggested, label });
      setMsg({ kind: "ok", text: "Done. This device can now sign you in with your fingerprint." });
      load();
    } catch (e) {
      if (!posPasskeys.dismissed(e)) setMsg({ kind: "err", text: e.message || "Couldn't set up fingerprint sign-in on this device." });
    }
    setBusy(false);
  };

  const remove = async (d) => {
    if (!window.confirm(`Remove ${d.nickname || "this device"}? It will need your password to sign in.`)) return;
    const { error } = await posSupabase.from("webauthn_credentials").delete().eq("id", d.id);
    if (error) setMsg({ kind: "err", text: "Couldn't remove that device." }); else { setMsg({ kind: "ok", text: "Device removed." }); load(); }
  };

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-800 flex items-center gap-2"><Fingerprint size={18} /> Fingerprint sign-in</h2>
          <p className="text-sm text-slate-500 mt-1 max-w-md">Set it up once on this device, then sign in with just your fingerprint or face — no business code or password.</p>
        </div>
        {supported && (
          <button onClick={add} disabled={busy} className="bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-semibold px-4 py-2.5 rounded-xl disabled:opacity-60 flex items-center gap-2">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Fingerprint size={16} />}{busy ? "Setting up…" : "Set up on this device"}
          </button>)}
      </div>
      {!supported && <p className="mt-4 text-sm text-slate-500">This browser can't do fingerprint sign-in. Use Chrome, Safari or Edge on a device with a fingerprint reader or face unlock.</p>}
      {msg.text && <p className={`mt-4 text-sm rounded-lg px-4 py-3 ${msg.kind === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}
      {supported && (loading ? <p className="mt-4 text-sm text-slate-400">Loading…</p> : devices.length === 0
        ? <p className="mt-4 text-sm text-slate-500 bg-slate-50 rounded-xl px-4 py-4">No devices yet.</p>
        : <ul className="mt-4 divide-y divide-slate-100">{devices.map((d) => (
          <li key={d.id} className="flex items-center justify-between py-3">
            <div><p className="font-semibold text-slate-800 text-sm">{d.nickname || "Unnamed device"}</p>
              <p className="text-xs text-slate-400">Added {fmt(d.created_at)}{d.last_used_at ? ` · last used ${fmt(d.last_used_at)}` : " · never used"}</p></div>
            <button onClick={() => remove(d)} aria-label="Remove device" className="text-slate-400 hover:text-red-600 p-2"><Trash2 size={16} /></button>
          </li>))}</ul>)}
    </section>
  );
}
