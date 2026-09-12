// ============================================================================
// FILE: src/Pages/Admin/POSTenants.js
//
// Platform-admin control over pos_tenants — NOT to be confused with
// POSRegistrationRequests.js, which approves a different, older thing
// (pos_registration_requests → creates a row in the main `users` table
// via an Edge Function). This page is about POS *businesses*
// (pos_tenants/pos_staff), the multi-tenant model built for the POS
// ERP redesign. See the note at the bottom of this file.
//
// No Edge Function here and no service-role key on the client: every
// action below is a direct supabase.rpc() call to a SECURITY DEFINER
// Postgres function that checks the caller is admin/superadmin from
// public.users itself (see pos_auth_approach_b.sql §7/§9). That's the
// payoff of doing tenant lifecycle in Postgres instead of the
// users-table + Edge Function pattern the older file uses.
// ============================================================================

import React, { useEffect, useState, useCallback } from "react";
import {
  CheckCircle2, XCircle, Ban, RotateCcw, Loader2, Clock, Plus, X, Building2,
} from "lucide-react";
import { supabase } from "../../supabaseClient"; // main app client — this is a platform-admin action, not a POS session

const TABS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "suspended", label: "Suspended" },
  { key: "rejected", label: "Rejected" },
];

export default function POSTenants() {
  const [tab, setTab] = useState("pending");
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const [reasonPrompt, setReasonPrompt] = useState(null); // { id, action } while collecting a reason
  const [reasonText, setReasonText] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);

  const load = useCallback(async (status) => {
    setLoading(true);
    setError("");
    const { data, error: err } = await supabase.rpc("list_pos_tenants", { p_status: status });
    if (err) setError(err.message);
    setTenants(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(tab); }, [tab, load]);

  const runAction = async (fn, args, id) => {
    setBusyId(id);
    setError("");
    try {
      const { data, error: err } = await supabase.rpc(fn, args);
      if (err) throw err;
      if (data?.ok === false) throw new Error(data.reason || "Action failed");
      await load(tab);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const openReasonPrompt = (id, action) => {
    setReasonText("");
    setReasonPrompt({ id, action });
  };

  const submitReasonPrompt = async () => {
    if (!reasonText.trim()) return setError("A reason is required.");
    const { id, action } = reasonPrompt;
    setReasonPrompt(null);
    if (action === "reject") {
      await runAction("reject_pos_tenant", { p_tenant_id: id, p_reason: reasonText.trim() }, id);
    } else if (action === "suspend") {
      await runAction("suspend_pos_tenant", { p_tenant_id: id, p_reason: reasonText.trim() }, id);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h1 className="text-2xl font-black text-slate-800">POS Businesses</h1>
          <p className="text-slate-500 text-sm">Approve, reject, suspend, or manually add POS tenants.</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="h-11 px-4 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-semibold flex items-center gap-2 shrink-0"
        >
          <Plus size={16} /> Add Business
        </button>
      </div>

      <div className="flex gap-1 mt-6 mb-5 bg-slate-100 rounded-2xl p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 h-9 rounded-xl text-sm font-semibold transition ${
              tab === t.key ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-2xl p-4 text-red-700 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="p-10 flex justify-center"><Loader2 className="animate-spin" size={28} /></div>
      ) : tenants.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-100 p-10 text-center text-slate-400">
          <Clock size={32} className="mx-auto mb-3" />
          No {tab} businesses.
        </div>
      ) : (
        <div className="space-y-3">
          {tenants.map((t) => (
            <div key={t.id} className="bg-white rounded-3xl border border-slate-100 p-6 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="font-bold text-slate-800 truncate">
                  {t.business_name} <span className="text-slate-400 font-normal font-mono text-sm">· {t.business_code}</span>
                </div>
                <div className="text-sm text-slate-500 truncate">
                  {t.owner_name} {t.phone && `· ${t.phone}`} {t.email && `· ${t.email}`}
                </div>
                {t.status === "rejected" && t.rejection_reason && (
                  <div className="text-sm text-red-500 mt-1 italic">Rejected: {t.rejection_reason}</div>
                )}
                {t.status === "suspended" && t.suspension_reason && (
                  <div className="text-sm text-red-500 mt-1 italic">Suspended: {t.suspension_reason}</div>
                )}
              </div>

              <div className="flex gap-2 shrink-0">
                {t.status === "pending" && (
                  <>
                    <ActionButton busy={busyId === t.id} onClick={() => runAction("approve_pos_tenant", { p_tenant_id: t.id }, t.id)}
                      icon={CheckCircle2} label="Approve" tone="green" />
                    <ActionButton busy={busyId === t.id} onClick={() => openReasonPrompt(t.id, "reject")}
                      icon={XCircle} label="Reject" tone="red" />
                  </>
                )}
                {t.status === "approved" && (
                  <ActionButton busy={busyId === t.id} onClick={() => openReasonPrompt(t.id, "suspend")}
                    icon={Ban} label="Suspend" tone="red" />
                )}
                {t.status === "suspended" && (
                  <ActionButton busy={busyId === t.id} onClick={() => runAction("reactivate_pos_tenant", { p_tenant_id: t.id }, t.id)}
                    icon={RotateCcw} label="Reactivate" tone="green" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {reasonPrompt && (
        <Modal onClose={() => setReasonPrompt(null)} title={reasonPrompt.action === "reject" ? "Reject business" : "Suspend business"}>
          <p className="text-sm text-slate-500 mb-3">This reason is shown to the business when they try to sign in.</p>
          <textarea
            autoFocus
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100"
            placeholder="Reason..."
          />
          <button
            onClick={submitReasonPrompt}
            className="w-full h-11 mt-4 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold"
          >
            Confirm {reasonPrompt.action === "reject" ? "Rejection" : "Suspension"}
          </button>
        </Modal>
      )}

      {showAddModal && (
        <AddTenantModal onClose={() => setShowAddModal(false)} onCreated={() => { setShowAddModal(false); setTab("approved"); }} />
      )}
    </div>
  );
}

function ActionButton({ icon: Icon, label, tone, busy, onClick }) {
  const toneClass = tone === "green"
    ? "bg-green-700 hover:bg-green-800 text-white"
    : "bg-red-50 hover:bg-red-100 text-red-700";
  return (
    <button disabled={busy} onClick={onClick}
      className={`h-10 px-4 rounded-xl font-semibold flex items-center gap-2 disabled:opacity-50 ${toneClass}`}>
      {busy ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />} {label}
    </button>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-3xl shadow-xl border border-slate-100 p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const ADD_ERROR_MESSAGES = {
  WEAK_PASSWORD: "Temporary password must be at least 8 characters.",
  BUSINESS_CODE_TAKEN: "That business code is already registered.",
  DUPLICATE: "That business code or username is already taken.",
  NOT_AUTHORIZED: "You don't have permission to do this.",
};

function AddTenantModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    business_name: "", owner_name: "", phone: "", email: "",
    business_code: "", username: "", temp_password: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const required = ["business_name", "owner_name", "phone", "business_code", "username", "temp_password"];
    if (required.some((k) => !form[k].trim())) return setError("Please fill in all required fields.");
    if (form.temp_password.length < 8) return setError(ADD_ERROR_MESSAGES.WEAK_PASSWORD);

    setLoading(true);
    try {
      const { data, error: err } = await supabase.rpc("admin_create_pos_tenant", {
        p_business_name: form.business_name.trim(),
        p_owner_name: form.owner_name.trim(),
        p_phone: form.phone.trim(),
        p_business_code: form.business_code.trim(),
        p_username: form.username.trim(),
        p_temp_password: form.temp_password,
        p_email: form.email.trim() || null,
      });
      if (err) throw err;
      if (!data?.ok) throw new Error(ADD_ERROR_MESSAGES[data.reason] || data.reason || "Could not create business.");
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full h-11 px-3 rounded-xl border border-slate-300 text-sm outline-none focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100";

  return (
    <Modal title="Add POS business" onClose={onClose}>
      <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-3 mb-4">
        <Building2 size={14} className="shrink-0" />
        Creates the business already approved, plus an owner login using the temporary password below — the owner will be required to change it on first sign-in.
      </div>
      <form onSubmit={submit} className="space-y-2">
        {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">{error}</div>}
        <input className={inputClass} placeholder="Business name *" value={form.business_name} onChange={set("business_name")} />
        <input className={inputClass} placeholder="Owner name *" value={form.owner_name} onChange={set("owner_name")} />
        <div className="grid grid-cols-2 gap-2">
          <input className={inputClass} placeholder="Phone *" value={form.phone} onChange={set("phone")} />
          <input className={inputClass} placeholder="Email" value={form.email} onChange={set("email")} />
        </div>
        <input className={inputClass} placeholder="Business code (e.g. UM-2201) *" value={form.business_code} onChange={set("business_code")} />
        <div className="grid grid-cols-2 gap-2">
          <input className={inputClass} placeholder="Owner username *" value={form.username} onChange={set("username")} />
          <input className={inputClass} placeholder="Temp password *" value={form.temp_password} onChange={set("temp_password")} />
        </div>
        <button type="submit" disabled={loading}
          className="w-full h-11 mt-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 disabled:opacity-60 text-white font-semibold flex items-center justify-center gap-2">
          {loading ? <Loader2 size={16} className="animate-spin" /> : null}
          {loading ? "Creating..." : "Create Business"}
        </button>
      </form>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────
// NOTE ON POSRegistrationRequests.js / pos_registration_requests:
// That file/table predate the pos_tenants architecture and solve a
// different problem — approving a request to create a row in the main
// `users` table via an Edge Function. If nothing else in the app still
// relies on pos_registration_requests, it's worth deciding explicitly
// whether to retire /admin/pos-requests + RegisterPOSUser.js + the
// approve-pos-registration Edge Function, rather than leaving two
// differently-named "POS approval" screens in the admin nav. Left
// untouched here since that's a product decision, not a code one.
// ─────────────────────────────────────────────────────────────────────
