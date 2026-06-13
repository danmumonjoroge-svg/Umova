import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";

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
  const [view, setView] = useState("home");
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
  const Field = ({ item }) => {
    const value = settings[item.key] ?? "";

    const common = {
      className: "border p-2 w-full rounded",
      onChange: (e) => updateSetting(item.key, e.target.value),
    };

    return (
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">
          {item.label}
        </label>

        {item.type === "boolean" ? (
          <select
            {...common}
            value={value}
          >
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        ) : item.type === "number" ? (
          <input
            type="number"
            {...common}
            value={value}
          />
        ) : (
          <input
            type="text"
            {...common}
            value={value}
          />
        )}
      </div>
    );
  };

  // ================= FILTERED SECTIONS =================
  const filteredSections = Object.entries(SECTIONS).filter(([k, v]) =>
    v.toLowerCase().includes(search.toLowerCase())
  );

  // ================= HOME =================
  if (view === "home") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 to-blue-50 p-6">

        {/* HEADER */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold">⚙️ Settings Engine</h1>
          <p className="text-slate-500">
            Real-time system configuration center
          </p>
        </div>

        {/* SEARCH */}
        <input
          placeholder="Search settings section..."
          className="border p-2 w-full rounded mb-4"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {/* STATUS */}
        <div className="mb-4 text-sm">
          {saving && (
            <span className="text-green-600">● Saving changes...</span>
          )}
          {!saving && Object.keys(dirty).length === 0 && (
            <span className="text-gray-500">All changes saved</span>
          )}
        </div>

        {/* GRID */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {filteredSections.map(([key, label]) => (
            <div
              key={key}
              onClick={() => setView(key)}
              className="bg-white p-5 rounded-xl shadow hover:shadow-lg cursor-pointer"
            >
              <h2 className="font-semibold">{label}</h2>
              <p className="text-sm text-gray-500 mt-1">
                Click to configure
              </p>
            </div>
          ))}

        </div>

        <button
          onClick={loadSettings}
          className="mt-6 bg-blue-600 text-white px-4 py-2 rounded"
        >
          🔄 Refresh Settings
        </button>
      </div>
    );
  }

  // ================= SECTION =================
  const Section = ({ title, children }) => (
    <div className="min-h-screen bg-slate-100 p-6">

      <div className="flex justify-between items-center bg-white p-4 rounded mb-4">
        <button
          onClick={() => setView("home")}
          className="text-blue-600"
        >
          ← Back
        </button>

        <h2 className="font-bold">{title}</h2>

        <button
          onClick={loadSettings}
          className="text-sm bg-gray-200 px-3 py-1 rounded"
        >
          Refresh
        </button>
      </div>

      <div className="bg-white p-6 rounded shadow">
        {children}
      </div>
    </div>
  );

  // ================= MODULE VIEW =================
  const items = SCHEMA[view] || [];

  return (
    <Section title={SECTIONS[view]}>
      {items.map((item) => (
        <Field key={item.key} item={item} />
      ))}
    </Section>
  );
}