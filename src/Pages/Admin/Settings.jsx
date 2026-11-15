import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Settings as SettingsIcon, Users, BookOpen, CreditCard, LayoutDashboard, Plug,
  ShieldCheck, ClipboardList, ChevronRight, ArrowLeft, Search, RefreshCw,
} from "lucide-react";
import { supabase } from "../../supabaseClient";
import PasskeySettings from "../../components/Auth/PasskeySettings";
import FingerprintToggle from "../../security/FingerprintToggle";
import { isNativeApp } from "../../security/nativeBiometric";
import "./umova-theme.css";

// Card metadata (icon + one-line description) for each settings section.
const META = {
  system:       { icon: SettingsIcon,    desc: "Core system options" },
  members:      { icon: Users,           desc: "Member ID format and approval" },
  accounts:     { icon: BookOpen,        desc: "Accounts and ledger options" },
  loans:        { icon: CreditCard,      desc: "Interest, penalties, disbursement" },
  dashboard:    { icon: LayoutDashboard, desc: "What the dashboard shows" },
  integrations: { icon: Plug,            desc: "SMS and WhatsApp" },
  security:     { icon: ShieldCheck,     desc: "Sessions, logins and passkeys" },
  audit:        { icon: ClipboardList,   desc: "Audit trail options" },
};

const SECTIONS = {
  system: "System Configuration",
  members: "Member Management",
  accounts: "Accounts & Ledger",
  loans: "Loan Engine",
  dashboard: "Dashboard Controls",
  integrations: "Integrations",
  security: "Security & Roles",
  audit: "Audit Logs",
};

// ================= FIELD SCHEMA =================
const SCHEMA = {
  members: [
    { key: "member_id_format", label: "Member ID Format", type: "text" },
    { key: "auto_approve_members", label: "Auto Approve Members", type: "boolean" },
  ],
  loans: [
    { key: "loan_interest_rate", label: "Interest Rate (%)", type: "number" },
    { key: "auto_disbursement", label: "Auto Disbursement", type: "boolean" },
    { key: "loan_penalty_rate", label: "Penalty Rate (%)", type: "number" },
  ],
  integrations: [
    { key: "sms_provider", label: "SMS Provider", type: "text" },
    { key: "whatsapp_enabled", label: "WhatsApp Enabled", type: "boolean" },
  ],
  security: [
    { key: "session_timeout", label: "Session Timeout (mins)", type: "number" },
    { key: "max_login_attempts", label: "Max Login Attempts", type: "number" },
  ],
  dashboard: [
    { key: "show_predictions", label: "AI Cashflow Widget", type: "boolean" },
    { key: "enable_live_kpis", label: "Live KPI Updates", type: "boolean" },
  ],
};

// ================= UTILS =================
const debounce = (fn, delay = 500) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
};

export default function Settings() {
  // The open card lives in the URL (?s=loans) so Back returns to the card list.
  const [params, setParams] = useSearchParams();
  const view = params.get("s") || "home";
  const setView = (k) => setParams(k && k !== "home" ? { s: k } : {});
  const [settings, setSettings] = useState({});
  const [dirty, setDirty] = useState({});
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // ================= LOAD =================
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);

    const { data } = await supabase
      .from("system_settings")
      .select("*");

    const map = {};
    (data || []).forEach((s) => {
      map[s.key] = s.value;
    });

    setSettings(map);
    setDirty({});
    setLoading(false);
  };

  // ================= UPDATE =================
  const updateSetting = (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setDirty((prev) => ({ ...prev, [key]: value }));
  };

  // ================= SAVE (DEBOUNCED) =================
  const saveToDB = useMemo(
    () =>
      debounce(async (payload) => {
        setSaving(true);

        const rows = Object.entries(payload).map(([key, value]) => ({
          key,
          value,
        }));

        await supabase.from("system_settings").upsert(rows);

        setDirty({});
        setSaving(false);
      }, 800),
    []
  );

  useEffect(() => {
    if (Object.keys(dirty).length > 0) {
      saveToDB(dirty);
    }
  }, [dirty]);

  // ================= FIELD RENDER =================
  // A plain render function (NOT a component defined inside the component):
  // a component defined here is a new type on every render, so React would
  // remount the input on each keystroke and the cursor would jump out.
  const renderField = (item) => {
    const value = settings[item.key] ?? "";
    const set = (v) => updateSetting(item.key, v);

    return (
      <div className="ua-field" key={item.key}>
        {item.type === "boolean" ? (
          <label className="as-switch-row">
            <span>{item.label}</span>
            <button
              type="button" role="switch" aria-checked={String(value) === "true"}
              className={`as-switch ${String(value) === "true" ? "on" : ""}`}
              onClick={() => set(String(value) === "true" ? "false" : "true")}
            ><i /></button>
          </label>
        ) : (
          <>
            <label htmlFor={`set-${item.key}`}>{item.label}</label>
            <input
              id={`set-${item.key}`}
              type={item.type === "number" ? "number" : "text"}
              value={value}
              onChange={(e) => set(e.target.value)}
            />
          </>
        )}
      </div>
    );
  };

  const statusText = saving ? "Saving…" : Object.keys(dirty).length ? "Unsaved changes" : "All changes saved";
  const statusCls = saving || Object.keys(dirty).length ? "as-status busy" : "as-status";

  const sectionKeys = Object.keys(SECTIONS);
  const filtered = sectionKeys.filter((k) =>
    `${SECTIONS[k]} ${META[k]?.desc || ""}`.toLowerCase().includes(search.toLowerCase())
  );

  // ================= CARD HOME =================
  if (view === "home" || !SECTIONS[view]) {
    return (
      <div className="as-page">
        <style>{CSS}</style>
        <div className="as-top">
          <div className="as-search">
            <Search size={16} />
            <input placeholder="Find a setting…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search settings" />
          </div>
          <span className={statusCls}><i />{statusText}</span>
          <button type="button" className="as-icon" onClick={loadSettings} aria-label="Refresh settings" title="Refresh"><RefreshCw size={16} /></button>
        </div>

        {loading ? (
          <div className="ua-loading"><div className="ua-spinner" />Loading settings…</div>
        ) : (
          <div className="as-grid">
            {filtered.map((k) => {
              const Icon = META[k]?.icon || SettingsIcon;
              const n = (SCHEMA[k] || []).length + (k === "security" ? 1 : 0);
              return (
                <button key={k} type="button" className="as-card" onClick={() => setView(k)}>
                  <span className="as-card-top">
                    <span className="as-ico"><Icon size={18} /></span>
                    <ChevronRight size={16} className="as-chev" />
                  </span>
                  <strong>{SECTIONS[k]}</strong>
                  <em>{n ? `${n} setting${n === 1 ? "" : "s"}` : "Nothing to set yet"}</em>
                  <small>{META[k]?.desc}</small>
                </button>
              );
            })}
            {filtered.length === 0 && <p className="ua-hub-sub">Nothing matches “{search}”.</p>}
          </div>
        )}
      </div>
    );
  }

  // ================= ONE SECTION =================
  const items = SCHEMA[view] || [];
  const Icon = META[view]?.icon || SettingsIcon;

  return (
    <div className="as-page as-narrow">
      <style>{CSS}</style>
      <button type="button" className="as-back" onClick={() => setView("home")}>
        <ArrowLeft size={16} /> Settings
      </button>

      <div className="as-head">
        <span className="as-ico"><Icon size={20} /></span>
        <div>
          <h2>{SECTIONS[view]}</h2>
          <p>{META[view]?.desc}</p>
        </div>
        <span className={statusCls}><i />{statusText}</span>
      </div>

      {items.length > 0 && (
        <section className="ua-card as-form">
          {items.map(renderField)}
        </section>
      )}

      {/* Fingerprint is per-person, not an org-wide field, so it is rendered directly rather than through
          the SCHEMA system. In the phone app it is the on/off switch for THIS phone (FingerprintToggle);
          in a web browser it is passkey enrollment (PasskeySettings). */}
      {view === "security" && (
        <section className="ua-card as-fp" style={{ marginTop: 12 }}>
          {isNativeApp()
            ? <FingerprintToggle service="finance" client={supabase} />
            : <PasskeySettings />}
        </section>
      )}

      {items.length === 0 && view !== "security" && (
        <section className="ua-card">
          <div className="ua-empty"><strong>Nothing to configure here yet</strong>Options for this section will appear here when they are added.</div>
        </section>
      )}
    </div>
  );
}

const CSS = `
.as-page { max-width: 1000px; margin: 0 auto; color: var(--umova-text); }
.as-narrow { max-width: 640px; }
.as-page, .as-page * { box-sizing: border-box; }
.as-top { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.as-search { flex: 1; min-width: 0; height: 44px; padding: 0 12px; display: flex; align-items: center; gap: 8px;
  background: var(--umova-white); border: 1px solid var(--umova-border); border-radius: 12px; color: var(--umova-muted); }
.as-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font-size: 16px; color: var(--umova-text); }
.as-icon { width: 44px; height: 44px; border: 1px solid var(--umova-border); background: var(--umova-white); border-radius: 12px; color: var(--umova-forest); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
.as-status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--umova-emerald); white-space: nowrap; }
.as-status i { width: 8px; height: 8px; border-radius: 50%; background: var(--umova-emerald); }
.as-status.busy { color: #8A6D2B; } .as-status.busy i { background: var(--umova-gold); }
.as-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
@media (min-width: 640px) { .as-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (min-width: 1100px) { .as-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.as-card { display: flex; flex-direction: column; gap: 2px; min-height: 120px; padding: 12px; text-align: left; font: inherit; cursor: pointer;
  background: var(--umova-white); border: 1px solid var(--umova-border); border-radius: 14px; box-shadow: var(--umova-shadow); color: var(--umova-forest);
  -webkit-tap-highlight-color: transparent; transition: border-color .12s ease, transform .12s ease; }
.as-card:hover { border-color: var(--umova-emerald); } .as-card:active { transform: scale(.98); }
.as-card-top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 8px; }
.as-chev { color: #B0BAB3; }
.as-card strong { font-size: 14px; line-height: 1.25; }
.as-card em { font-style: normal; font-size: 12px; font-weight: 700; color: var(--umova-emerald); }
.as-card small { font-size: 11px; line-height: 1.35; color: var(--umova-muted); }
.as-ico { width: 34px; height: 34px; border-radius: 10px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; background: var(--umova-soft-green); color: var(--umova-emerald); }
.as-back { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; border: 0; background: transparent; color: var(--umova-emerald); font-size: 14px; font-weight: 700; cursor: pointer; }
.as-head { display: flex; align-items: center; gap: 12px; margin: 2px 0 14px; }
.as-head > div { flex: 1; min-width: 0; }
.as-head h2 { margin: 0; font-size: 18px; color: var(--umova-forest); }
.as-head p { margin: 2px 0 0; font-size: 12px; color: var(--umova-muted); }
.as-form { display: flex; flex-direction: column; gap: 14px; }
.as-switch-row { display: flex !important; flex-direction: row !important; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; cursor: pointer; }
.as-switch { width: 48px; height: 28px; border-radius: 14px; border: 0; padding: 3px; background: #C9D3CC; cursor: pointer; flex-shrink: 0; transition: background .15s ease; }
.as-switch i { display: block; width: 22px; height: 22px; border-radius: 50%; background: #fff; transition: transform .15s ease; box-shadow: 0 1px 2px rgba(0,0,0,.25); }
.as-switch.on { background: var(--umova-emerald); } .as-switch.on i { transform: translateX(20px); }
/* Phone fingerprint switch (security/FingerprintToggle.js uses .uma-row for its label + switch line). */
.as-fp { padding: 14px 16px; }
.as-fp .uma-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.as-fp .uma-row > div:first-child { flex: 1; min-width: 0; color: var(--umova-forest); }
.as-fp .uma-row button[role="switch"]:disabled { cursor: default; }
.as-fp p { line-height: 1.4; }
`;
