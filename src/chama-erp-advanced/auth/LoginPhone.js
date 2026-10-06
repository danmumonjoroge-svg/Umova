import React, { useState } from "react";
import { useChama } from "../ChamaContext";
import { Phone, Lock, LogIn, Loader2, AlertCircle, Coins, Fingerprint } from "lucide-react";
import { chamaPasskeys } from "./chamaPasskeys";
import DemoLogin from "./DemoLogin";
import "./LoginPhone.css";

// -----------------------------------------------------------------------------
// LoginPhone
// Step 1 of the recommended flow: phone number + password. On submit,
// ChamaContext resolves how many chamas this phone belongs to and either
// goes straight to the dashboard (1 chama) or hands off to ChamaSelector
// (2+ chamas) — this component doesn't need to know which happens.
// -----------------------------------------------------------------------------

export default function LoginPhone({ onRegisterClick, onNewChamaClick }) {
  const { loginWithPhone, loginWithPasskey, authBusy, authError } = useChama();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  const submit = (e) => {
    e.preventDefault();
    if (!phone.trim() || !password) return;
    loginWithPhone(phone, password);
  };

  return (
    <div className="lgp-wrapper">
      <div className="lgp-card">
        <div className="lgp-brand">
          <span className="lgp-logo"><Coins size={20} /></span>
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

        {chamaPasskeys.supported() && (
          <button type="button" className="lgp-passkey" onClick={loginWithPasskey} disabled={authBusy}>
            <Fingerprint size={16} /> Log in with fingerprint
          </button>
        )}

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
        </div>

        <DemoLogin />
      </div>
    </div>
  );
}
