import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useChama } from "../ChamaContext";
import { Phone, Lock, LogIn, Loader2, AlertCircle, Fingerprint } from "lucide-react";
import { chamaPasskeys } from "./chamaPasskeys";
import { supabase } from "../../supabaseClient";
import { isNativeApp } from "../../security/nativeBiometric";
import { signInWithChamaFingerprint } from "../../security/chamaDevice";
import FingerprintLogin from "../../security/FingerprintLogin";
import DemoLogin from "./DemoLogin";
import umovaEmblem from "../../assets/brand/umova-emblem-small.png";
import "./LoginPhone.css";

// -----------------------------------------------------------------------------
// LoginPhone
// Step 1 of the recommended flow: phone number + password. On submit,
// ChamaContext resolves how many chamas this phone belongs to and either
// goes straight to the dashboard (1 chama) or hands off to ChamaSelector
// (2+ chamas) — this component doesn't need to know which happens.
// -----------------------------------------------------------------------------

export default function LoginPhone({ onRegisterClick, onNewChamaClick }) {
  const { loginWithPhone, loginWithPasskey, loginWithDevice, authBusy, authError } = useChama();
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  const submit = (e) => {
    e.preventDefault();
    if (!phone.trim() || !password) return;
    loginWithPhone(phone, password);
  };

  // Phone app: the fingerprint + server check (chamaDevice.js) return the verified Chama user, and ChamaContext
  // continues exactly like a password login (memberships, licence, role). If that fails, ChamaContext sets
  // authError, which is shown above the form; the password form below always still works.
  const chamaFingerprintSignIn = async () => {
    const r = await signInWithChamaFingerprint({ client: supabase });
    if (!r.ok) return r;
    await loginWithDevice(r.user);
    return { ok: true };
  };

  return (
    <div className="lgp-wrapper">
      <div className="lgp-card">
        <div className="lgp-brand">
          <span className="lgp-logo" style={{ background: "#fff", width: 48, height: 48, padding: 4, borderRadius: 14, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <img src={umovaEmblem} alt="Umova" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          </span>
          <h1>Chama ERP</h1>
        </div>

        <p className="lgp-subtitle">Sign in with your phone number</p>

        {authError && <div className="lgp-error"><AlertCircle size={14} /> {authError}</div>}

        <form onSubmit={submit}>
          <label>
            <span>Phone number</span>
            <div className="lgp-input-group">
              <Phone size={15} />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="07XX XXX XXX"
                autoComplete="tel"
                required
              />
            </div>
          </label>

          <label>
            <span>Password</span>
            <div className="lgp-input-group">
              <Lock size={15} />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </div>
          </label>

          <button type="submit" className="lgp-submit" disabled={authBusy}>
            {authBusy ? <Loader2 size={16} className="spin" /> : <LogIn size={16} />}
            {authBusy ? "Signing in..." : "Log in"}
          </button>
        </form>

        {/* Web only. Inside the phone app the web passkey button would open Android's own passkey chooser;
            the app uses the native fingerprint button below instead. */}
        {!isNativeApp() && chamaPasskeys.supported() && (
          <button type="button" className="lgp-passkey" onClick={loginWithPasskey} disabled={authBusy}>
            <Fingerprint size={16} /> Log in with fingerprint
          </button>
        )}

        {/* Phone app only, and only after fingerprint was turned on for Chama on this phone; renders nothing otherwise. */}
        <FingerprintLogin service="chama" client={supabase} signIn={chamaFingerprintSignIn} />

        <div className="lgp-links">
          {onRegisterClick && (
            <button className="lgp-register-link" onClick={onRegisterClick}>
              New here? Create an account
            </button>
          )}
          {onNewChamaClick && (
            <button className="lgp-register-link" onClick={onNewChamaClick}>
              Forming a new chama? Register it here
            </button>
          )}
          <button type="button" className="lgp-register-link" onClick={() => navigate("/login")}>
            SACCO member? Sign in to Umova Finance
          </button>
        </div>

        <DemoLogin />
      </div>
    </div>
  );
}
