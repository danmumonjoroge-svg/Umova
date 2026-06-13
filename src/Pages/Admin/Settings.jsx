import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";

const SECTIONS = {
  system: "System Configuration",
  members: "Member Management",
  accounts: "Accounts & Ledger",
  loans: "Loan Engine",
  dashboard: "Dashboard Controls",
  integrations: "Integrations",
  security: "Security & Roles",
  audit: "Audit Logs"
};

export default function Settings() {

  const [view, setView] = useState("home");
  const [settings, setSettings] = useState({});

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const { data } = await supabase.from("system_settings").select("*");
    const map = {};
    (data || []).forEach(s => {
      map[s.key] = s.value;
    });
    setSettings(map);
  };

  const updateSetting = async (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    await supabase.from("system_settings").upsert([{ key, value }]);
  };

  // ================= HOME DASHBOARD =================
  if (view === "home") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-blue-50 to-slate-200 p-6">

        {/* HEADER */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-slate-800">
            ⚙️ System Control Center
          </h1>
          <p className="text-slate-500">
            Configure every module of your core banking system
          </p>
        </div>

        {/* GRID */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-5">

          {Object.entries(SECTIONS).map(([key, label]) => (
            <div
              key={key}
              onClick={() => setView(key)}
              className="
                bg-white
                border
                border-slate-200
                rounded-xl
                shadow-sm
                hover:shadow-xl
                hover:border-blue-300
                transition-all
                duration-200
                cursor-pointer
                p-5
              "
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-800">
                  {label}
                </h2>
                <span className="text-blue-500">›</span>
              </div>

              <p className="text-sm text-slate-500 mt-2">
                Click to configure settings
              </p>
            </div>
          ))}

        </div>

        {/* FOOTER */}
        <div className="mt-10 text-center text-xs text-slate-400">
          Core Banking ERP Settings Module v2.0
        </div>

      </div>
    );
  }

  // ================= SECTION WRAPPER =================
  const Section = ({ title, children }) => (
    <div className="min-h-screen bg-slate-100 p-6">

      {/* TOP BAR */}
      <div className="flex items-center justify-between mb-6 bg-white p-4 rounded-xl shadow-sm border">
        <button
          onClick={() => setView("home")}
          className="text-blue-600 font-medium"
        >
          ← Back
        </button>

        <h2 className="text-lg font-bold text-slate-800">
          {title}
        </h2>

        <div className="text-xs text-slate-400">
          LIVE CONFIG MODE
        </div>
      </div>

      {/* CONTENT */}
      <div className="bg-white rounded-xl shadow border p-6">
        {children}
      </div>

    </div>
  );

  // ================= SIMPLE FIELD UI =================
  const Field = ({ label, children }) => (
    <div className="mb-5">
      <label className="block text-sm font-medium text-slate-700 mb-2">
        {label}
      </label>
      {children}
    </div>
  );

  // ================= MODULES =================

  if (view === "members") {
    return (
      <Section title="Member Settings">
        <Field label="Member ID Format">
          <input
            className="border p-2 w-full rounded"
            value={settings.member_id_format || ""}
            onChange={(e) => updateSetting("member_id_format", e.target.value)}
          />
        </Field>

        <Field label="Auto Approve Members">
          <select
            className="border p-2 w-full rounded"
            value={settings.auto_approve_members || "false"}
            onChange={(e) => updateSetting("auto_approve_members", e.target.value)}
          >
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </Field>
      </Section>
    );
  }

  if (view === "loans") {
    return (
      <Section title="Loan Engine Settings">
        <Field label="Interest Rate (%)">
          <input
            type="number"
            className="border p-2 w-full rounded"
            value={settings.loan_interest_rate || ""}
            onChange={(e) => updateSetting("loan_interest_rate", e.target.value)}
          />
        </Field>

        <Field label="Auto Disbursement">
          <select
            className="border p-2 w-full rounded"
            value={settings.auto_disbursement || "false"}
            onChange={(e) => updateSetting("auto_disbursement", e.target.value)}
          >
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </Field>
      </Section>
    );
  }

  if (view === "integrations") {
    return (
      <Section title="Integration Hub">

        <Field label="SMS Provider">
          <input
            className="border p-2 w-full rounded"
            value={settings.sms_provider || ""}
            onChange={(e) => updateSetting("sms_provider", e.target.value)}
          />
        </Field>

        <Field label="WhatsApp Enabled">
          <select
            className="border p-2 w-full rounded"
            value={settings.whatsapp_enabled || "false"}
            onChange={(e) => updateSetting("whatsapp_enabled", e.target.value)}
          >
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </Field>

      </Section>
    );
  }

  if (view === "security") {
    return (
      <Section title="Security & Roles">

        <Field label="Session Timeout (mins)">
          <input
            type="number"
            className="border p-2 w-full rounded"
            value={settings.session_timeout || ""}
            onChange={(e) => updateSetting("session_timeout", e.target.value)}
          />
        </Field>

      </Section>
    );
  }

  if (view === "dashboard") {
    return (
      <Section title="Dashboard Controls">

        <Field label="Show AI Cashflow Widget">
          <select
            className="border p-2 w-full rounded"
            value={settings.show_predictions || "false"}
            onChange={(e) => updateSetting("show_predictions", e.target.value)}
          >
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </Field>

      </Section>
    );
  }

  if (view === "audit") {
    return (
      <Section title="Audit Logs">
        <p className="text-slate-500">
          Connect to system_logs table to view change history
        </p>
      </Section>
    );
  }

  return null;
}