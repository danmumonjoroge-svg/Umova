// chama-erp-advanced/auth/ChamaPasskeySettings.js — "Fingerprint login" card for Chama → More.
// Every action asks for the password again: Chama has no server session, so the password is the proof of who is asking.
import React, { useState } from "react";
import { Fingerprint, Trash2, Loader2 } from "lucide-react";
import { useChama } from "../ChamaContext";
import { chamaPasskeys } from "./chamaPasskeys";

const fmt = (d) => new Date(d).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
const guessDevice = () => {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone"; if (/iPad/.test(ua)) return "iPad"; if (/Android/.test(ua)) return "Android phone";
  if (/Windows/.test(ua)) return "Windows PC"; if (/Mac/.test(ua)) return "Mac"; return "This device";
};

export default function ChamaPasskeySettings() {
  const { user } = useChama();
  const phone = user?.phone_number || "";
  const [password, setPassword] = useState("");
  const [devices, setDevices] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ kind: "", text: "" });

  if (!chamaPasskeys.supported()) {
    return (
      <div className="cm-card">
        <strong><Fingerprint size={15} /> Fingerprint login</strong>
        <p className="cm-muted">This browser can't do fingerprint login. Use Chrome, Safari or Edge on a phone with a fingerprint reader or face unlock.</p>
      </div>
    );
  }

  const run = async (fn) => {
    if (!password) { setMsg({ kind: "err", text: "Enter your password to continue." }); return; }
    setBusy(true); setMsg({ kind: "", text: "" });
    try { await fn(); } catch (e) { if (!chamaPasskeys.dismissed(e)) setMsg({ kind: "err", text: e.message }); }
    setBusy(false);
  };
  const refresh = async () => setDevices(await chamaPasskeys.listChamaPasskeys({ phone, password }));

  const add = () => run(async () => {
    const suggested = guessDevice();
    const nickname = window.prompt("Name this device so you can recognise it later:", suggested);
    if (nickname === null) return;
    await chamaPasskeys.registerChamaPasskey({ phone, password, nickname: nickname.trim() || suggested });
    setMsg({ kind: "ok", text: "Done. This device can now log you in with your fingerprint." });
    await refresh();
  });
  const remove = (d) => run(async () => {
    if (!window.confirm(`Remove ${d.nickname || "this device"}?`)) return;
    await chamaPasskeys.removeChamaPasskey({ phone, password, credentialId: d.id });
    await refresh();
  });

  return (
    <div className="cm-card" style={{ marginTop: 12 }}>
      <strong><Fingerprint size={15} /> Fingerprint login</strong>
      <p className="cm-muted">Log in with your fingerprint instead of your phone number and password. Enter your password once to set it up on this device.</p>
      <input type="password" autoComplete="current-password" placeholder="Your password" value={password}
        onChange={(e) => setPassword(e.target.value)} style={{ width: "100%", minHeight: 44, margin: "8px 0", padding: "0 12px", borderRadius: 10, border: "1px solid #E4E2D6" }} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="cm-btn" disabled={busy} onClick={add}>{busy ? <Loader2 size={15} className="spin" /> : <Fingerprint size={15} />} Set up on this device</button>
        <button className="cm-btn ghost" disabled={busy} onClick={() => run(refresh)}>Show my devices</button>
      </div>
      {msg.text && <p style={{ color: msg.kind === "ok" ? "#237A52" : "#A23B2B", fontSize: 13, marginTop: 8 }}>{msg.text}</p>}
      {devices && (devices.length === 0 ? <p className="cm-muted">No devices yet.</p> : devices.map((d) => (
        <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "1px solid #E4E2D6" }}>
          <span><b>{d.nickname || "Unnamed device"}</b><br /><small>Added {fmt(d.created_at)}{d.last_used_at ? ` · last used ${fmt(d.last_used_at)}` : " · never used"}</small></span>
          <button aria-label="Remove device" onClick={() => remove(d)} style={{ background: "none", border: 0, cursor: "pointer", color: "#A23B2B" }}><Trash2 size={16} /></button>
        </div>)))}
    </div>
  );
}
