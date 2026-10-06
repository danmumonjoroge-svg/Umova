import React, { useState } from "react";
import { useChama } from "../ChamaContext";
import { Sparkles, Loader2, Wallet, Crown, ClipboardList, HeartHandshake, User } from "lucide-react";
import "./DemoLogin.css";

// -----------------------------------------------------------------------------
// DemoLogin — "Get the demo" on the login screen.
//
// One tap on a role signs straight into the demo chama (Mwangaza Self-Help
// Group, created by sql/008_demo_chama.sql). It goes through the normal
// loginWithPhone() path, so licensing, session handling and role checks behave
// exactly as for a real user — the demo chama is simply on the Free plan.
//
// Drop it into ANY login screen (LoginPhone, UnifiedLogin, ...):
//     import DemoLogin from "./DemoLogin";
//     <DemoLogin />
//
// Turn it off for a production build with REACT_APP_DEMO_ENABLED=false.
// The demo credentials are deliberately public: they only open the demo chama.
// -----------------------------------------------------------------------------

const DEMO_PASSWORD = process.env.REACT_APP_DEMO_PASSWORD || "Demo1234";

export const DEMO_ROLES = [
  { key: "treasurer",   label: "Treasurer",       who: "Mary",   phone: "0711000003", hint: "Verify money, pay out loans", Icon: Wallet },
  { key: "chair",       label: "Chairperson",     who: "Grace",  phone: "0711000001", hint: "Final loan approvals",        Icon: Crown },
  { key: "secretary",   label: "Secretary",       who: "Peter",  phone: "0711000002", hint: "Members & announcements",     Icon: ClipboardList },
  { key: "welfare",     label: "Welfare officer", who: "John",   phone: "0711000004", hint: "Funerals & emergencies",      Icon: HeartHandshake },
  { key: "member",      label: "Member",          who: "Esther", phone: "0711000005", hint: "Statement, savings, my loan", Icon: User },
];

export default function DemoLogin() {
  const { loginWithPhone, authBusy, authError } = useChama();
  const [pending, setPending] = useState(null); // which role was tapped
  const [tried, setTried] = useState(false);

  if (process.env.REACT_APP_DEMO_ENABLED === "false") return null;

  const enter = async (role) => {
    if (authBusy) return;
    setPending(role.key);
    setTried(true);
    await loginWithPhone(role.phone, DEMO_PASSWORD);
    setPending(null); // only reached if login did not navigate away
  };

  return (
    <section className="dml-box" aria-label="Try the demo">
      <div className="dml-head">
        <span className="dml-spark"><Sparkles size={14} /></span>
        <div>
          <strong>Get the demo</strong>
          <small>No sign-up. Tap a role to log straight in.</small>
        </div>
      </div>

      <div className="dml-grid">
        {DEMO_ROLES.map((r) => (
          <button
            key={r.key}
            type="button"
            className="dml-role"
            onClick={() => enter(r)}
            disabled={authBusy}
          >
            <span className="dml-ico">
              {pending === r.key ? <Loader2 size={16} className="dml-spin" /> : <r.Icon size={16} />}
            </span>
            <span className="dml-txt">
              <b>{r.label}</b>
              <small>{r.hint}</small>
            </span>
          </button>
        ))}
      </div>

      {tried && authError && !authBusy && (
        <p className="dml-err">
          The demo isn't set up on this server yet. An admin needs to run <code>sql/008_demo_chama.sql</code>.
        </p>
      )}
    </section>
  );
}
