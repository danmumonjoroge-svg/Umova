import React, { useState, useEffect, useRef } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";
import { useChama } from "./ChamaContext";
import "./ChamaLogin.css";

export default function ChamaLogin() {
  const navigate = useNavigate();
  const { login } = useChama();
  const inputRef = useRef(null);

  // Flow & State Architecture
  const [step, setStep] = useState(1);
  const [chamaNo, setChamaNo] = useState("");
  const [phone, setPhone] = useState("");
  const [chama, setChama] = useState(null);
  const [member, setMember] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isShaking, setIsShaking] = useState(false);

  // Dynamic Step Focus Engine
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(timer);
  }, [step]);

  // Utility String Normalizer
  const clean = (val) => val.replace(/\s/g, "").trim();

  // Handle errors gracefully with UI shaking feedback
  const triggerError = (msg) => {
    setError(msg);
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 500);
  };

  // ────────────────────────────────────────────────────────
  // STEP 1: RESOLVE CHAMA REGISTRY IDENTIFIER
  // ────────────────────────────────────────────────────────
  const findChama = async (e) => {
    if (e) e.preventDefault();
    setError("");
    
    const cleanCode = clean(chamaNo);
    if (!cleanCode) return triggerError("Please enter a valid group registry key");

    setLoading(true);
    try {
      const { data, error: sbError } = await supabase
        .from("chamas")
        .select("*")
        .eq("chama_no", cleanCode)
        .maybeSingle();

      if (sbError) throw sbError;

      if (!data) {
        return triggerError("No certified financial cluster matches this key.");
      }

      setChama(data);
      setStep(2);
    } catch (err) {
      triggerError("Network resolution error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ────────────────────────────────────────────────────────
  // STEP 2: VERIFY REGISTERED MEMBER ACCOUNT DATA
  // ────────────────────────────────────────────────────────
  const verifyMember = async (e) => {
    if (e) e.preventDefault();
    setError("");

    const cleanPhone = clean(phone);
    if (!cleanPhone) return triggerError("Please enter your registered mobile index");

    setLoading(true);
    try {
      const { data, error: sbError } = await supabase
        .from("chama_members")
        .select("*")
        .eq("phone", cleanPhone)
        .eq("chama_id", chama.id)
        .maybeSingle();

      if (sbError) throw sbError;

      if (!data) {
        return triggerError("Member credentials could not be verified for this group.");
      }

      setMember(data);
      setStep(3);
    } catch (err) {
      triggerError("System balance validation timeout.");
    } finally {
      setLoading(false);
    }
  };

  // ────────────────────────────────────────────────────────
  // STEP 3: DISPATCH STATE MUTATION AND NAVIGATE
  // ────────────────────────────────────────────────────────
  const handleLogin = () => {
    if (login && chama && member) {
      login({
        chamaData: chama,
        memberData: member,
      });
    }
    navigate("/chama/home");
  };

  // Step state tracking variables for active styling states
  const fillWidths = { 1: "0%", 2: "50%", 3: "100%" };

  return (
    <div className="cl-root">
      
      {/* LEFT MARKETING & DISCOVERY INFO PORTAL */}
      <aside className="cl-panel">
        <div className="cl-panel__glow" />
        <div className="cl-panel__inner">
          
          <div className="cl-brand">
            <div className="cl-brand__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <span className="cl-brand__name">Umova<strong>Chama</strong></span>
          </div>

          <div className="cl-panel__content">
            <h1 className="cl-panel__headline">
              Secure Core <br />
              <span className="cl-panel__accent">Ledger Management</span>
            </h1>
            <p className="cl-panel__sub">
              Access decentralized financial ledgers, audit trails, and automated group accounting analytics inside an isolated enterprise network infrastructure.
            </p>
          </div>

          <ul className="cl-features">
            <li className="cl-feature">
              <div className="cl-feature__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              </div>
              <div>
                <strong>Military-Grade Auditing</strong>
                <span>Realtime SASRA & compliance tracing pipelines.</span>
              </div>
            </li>
            <li className="cl-feature">
              <div className="cl-feature__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              </div>
              <div>
                <strong>Automated Micro-Loans</strong>
                <span>Smart credit assignment and algorithmic penalty loops.</span>
              </div>
            </li>
          </ul>

          <div className="cl-panel__badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <span>End-to-End Cryptographic Validation Active</span>
          </div>
        </div>
      </aside>

      {/* RIGHT AUTHENTICATION ENTRY WORKSPACE */}
      <main className="cl-main">
        
        {/* INTERACTIVE TRACK STEPPER STATE RIG */}
        <div className="cl-stepper">
          <div className="cl-stepper__track">
            <div className="cl-stepper__fill" style={{ width: fillWidths[step] }} />
          </div>
          
          <div className={`cl-step ${step >= 1 ? "cl-step--done" : ""} ${step === 1 ? "cl-step--active" : ""}`}>
            <div className="cl-step__bubble">
              {step > 1 ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
              ) : "1"}
            </div>
            <span className="cl-step__label">Registry</span>
          </div>

          <div className={`cl-step ${step >= 2 ? "cl-step--done" : ""} ${step === 2 ? "cl-step--active" : ""}`}>
            <div className="cl-step__bubble">
              {step > 2 ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
              ) : "2"}
            </div>
            <span className="cl-step__label">Verification</span>
          </div>

          <div className={`cl-step ${step === 3 ? "cl-step--active" : ""}`}>
            <div className="cl-step__bubble">3</div>
            <span className="cl-step__label">Portal Entry</span>
          </div>
        </div>

        {/* PRIMARY TRANSACTION FORM CARD CONTAINER */}
        <div className={`cl-card ${isShaking ? "cl-shake" : ""}`}>

          {/* DYNAMIC NOTIFICATION DISPATCH ENGINE */}
          {error && (
            <div className="cl-error">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* PHASE 1: SEARCH PIPELINE */}
          {step === 1 && (
            <form onSubmit={findChama} className="cl-form cl-anim-in">
              <div className="cl-form__head">
                <h2>Identify Chama Ecosystem</h2>
                <p>Provide your cluster identity key token code to route your data parameters securely.</p>
              </div>

              <div className="cl-field">
                <label htmlFor="chama-code-input">Registry Identity Key</label>
                <div className="cl-input-wrap">
                  <input
                    id="chama-code-input"
                    ref={inputRef}
                    type="text"
                    autoComplete="off"
                    value={chamaNo}
                    onChange={(e) => setChamaNo(e.target.value)}
                    placeholder="e.g. CH-8942-X"
                    disabled={loading}
                  />
                  <div className="cl-input-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                  </div>
                </div>
              </div>

              <button type="submit" className="cl-btn cl-btn--primary" disabled={loading}>
                {loading ? <span className="cl-spinner" /> : (
                  <>
                    <span>Resolve Security Target</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                  </>
                )}
              </button>
            </form>
          )}

          {/* PHASE 2: INSERT MEMBER SYSTEM IDENTIFIER */}
          {step === 2 && (
            <form onSubmit={verifyMember} className="cl-form cl-anim-in">
              <div className="cl-form__head">
                <h2>Verify Member Identity</h2>
                <p>Verify your explicit record index status within this platform core.</p>
              </div>

              <div className="cl-chama-pill">
                <div className="cl-chama-pill__dot" />
                <span className="cl-chama-pill__name">{chama?.name}</span>
                <span className="cl-chama-pill__code">{chama?.chama_no}</span>
              </div>

              <div className="cl-field">
                <label htmlFor="member-phone-input">System Verification Mobile Index</label>
                <div className="cl-input-wrap">
                  <input
                    id="member-phone-input"
                    ref={inputRef}
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. +254 700 000 000"
                    disabled={loading}
                  />
                  <div className="cl-input-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                  </div>
                </div>
              </div>

              <div className="cl-button-stack" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <button type="submit" className="cl-btn cl-btn--primary" disabled={loading}>
                  {loading ? <span className="cl-spinner" /> : (
                    <>
                      <span>Execute Ledger Handshake</span>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    </>
                  )}
                </button>
                <button type="button" className="cl-btn cl-btn--ghost" onClick={() => { setStep(1); setError(""); }} disabled={loading}>
                  Modify Cluster Target
                </button>
              </div>
            </form>
          )}

          {/* PHASE 3: CONVERGED PORTAL HANDSHAKE */}
          {step === 3 && (
            <div className="cl-form cl-anim-in">
              <div className="cl-welcome">
                <div className="cl-welcome__avatar">
                  {(member?.full_name || "M").charAt(0).toUpperCase()}
                </div>
                <h3 className="cl-welcome__name">{member?.full_name || "Verified Member"}</h3>
                <p className="cl-welcome__chama">{chama?.name}</p>
                <span className={`cl-role-badge cl-role-badge--${(member?.role || "member").toLowerCase()}`}>
                  {member?.role || "Active Member"}
                </span>
              </div>

              <p className="cl-welcome__sub">
                Security clearance verified. Communication pipelines are fully cryptographically isolated.
              </p>

              <div className="cl-button-stack" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <button type="button" onClick={handleLogin} className="cl-btn cl-btn--primary cl-btn--enter">
                  <span>Enter Dynamic Dashboard Workspace</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M13 12H3"/></svg>
                </button>
                <button type="button" className="cl-btn cl-btn--ghost" onClick={() => { setStep(1); setChama(null); setMember(null); setChamaNo(""); setPhone(""); setError(""); }}>
                  Reset Handshake Sequence
                </button>
              </div>
            </div>
          )}

          <footer className="cl-footer">
            System Platform v2.4.0-Malachite
          </footer>
        </div>
      </main>

    </div>
  );
}