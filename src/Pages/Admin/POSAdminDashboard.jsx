// ============================================================================
// FILE: src/Pages/Admin/POSAdminDashboard.jsx
//
// Single landing page for everything POS-related on the admin side —
// replaces the lone "POS Businesses" button buried in the SACCO
// Dashboard.jsx with an actual hub: pending counts for both approval
// queues at a glance, plus links into POSTenants.js and
// POSRegistrationRequests.js.
//
// Deliberately surfaces BOTH pending-tenant approvals (pos_tenants,
// via list_pos_tenants RPC) and pending staff-registration requests
// (pos_registration_requests table) — see the note at the bottom of
// POSTenants.js flagging these as two different, currently-coexisting
// mechanisms. This page doesn't decide which one to retire; it just
// makes both visible and reachable in one place instead of one being
// an orphaned route nobody finds. That retirement decision is still
// yours to make explicitly.
//
// Route this behind the same AdminLevelGuard as POSTenants/
// POSRegistrationRequests (admin/superadmin/manager only) — see App.js.
// ============================================================================

import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Store, ClipboardList, Loader2, ArrowRight, Building2 } from "lucide-react";
import { supabase } from "../../supabaseClient";

export default function POSAdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [pendingTenants, setPendingTenants] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [tenantsRes, requestsRes] = await Promise.all([
        supabase.rpc("list_pos_tenants", { p_status: "pending" }),
        supabase
          .from("pos_registration_requests")
          .select("id, full_name, requested_role, created_at")
          .eq("status", "pending")
          .order("created_at", { ascending: true }),
      ]);

      if (tenantsRes.error) throw tenantsRes.error;
      if (requestsRes.error) throw requestsRes.error;

      setPendingTenants(tenantsRes.data || []);
      setPendingRequests(requestsRes.data || []);
    } catch (err) {
      console.error("[POS ADMIN DASHBOARD]", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-black text-slate-800 mb-1">POS Administration</h1>
      <p className="text-slate-500 text-sm mb-6">
        Everything related to POS businesses and staff access, in one place.
      </p>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-2xl p-4 text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-10 flex justify-center"><Loader2 className="animate-spin" size={28} /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <HubCard
            to="/admin/pos-tenants"
            icon={Store}
            title="POS Businesses"
            subtitle="Approve, reject, or suspend tenant businesses"
            pendingCount={pendingTenants.length}
            pendingLabel="pending approval"
          >
            {pendingTenants.length > 0 && (
              <ul className="mt-4 space-y-1.5 text-sm text-slate-500">
                {pendingTenants.slice(0, 3).map((t) => (
                  <li key={t.id} className="flex items-center gap-2 truncate">
                    <Building2 size={13} className="shrink-0 text-slate-400" />
                    <span className="truncate">{t.business_name} <span className="text-slate-400 font-mono">· {t.business_code}</span></span>
                  </li>
                ))}
                {pendingTenants.length > 3 && (
                  <li className="text-slate-400">+ {pendingTenants.length - 3} more</li>
                )}
              </ul>
            )}
          </HubCard>

          <HubCard
            to="/admin/pos-requests"
            icon={ClipboardList}
            title="Staff Access Requests"
            subtitle="Approve or reject individual staff registration requests"
            pendingCount={pendingRequests.length}
            pendingLabel="pending request"
          >
            {pendingRequests.length > 0 && (
              <ul className="mt-4 space-y-1.5 text-sm text-slate-500">
                {pendingRequests.slice(0, 3).map((r) => (
                  <li key={r.id} className="flex items-center gap-2 truncate">
                    <ClipboardList size={13} className="shrink-0 text-slate-400" />
                    <span className="truncate">{r.full_name} <span className="text-slate-400">— {r.requested_role}</span></span>
                  </li>
                ))}
                {pendingRequests.length > 3 && (
                  <li className="text-slate-400">+ {pendingRequests.length - 3} more</li>
                )}
              </ul>
            )}
          </HubCard>
        </div>
      )}
    </div>
  );
}

function HubCard({ to, icon: Icon, title, subtitle, pendingCount, pendingLabel, children }) {
  return (
    <Link
      to={to}
      className="block bg-white rounded-3xl border border-slate-100 p-6 hover:border-emerald-200 hover:shadow-md transition group"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-emerald-50 text-emerald-700">
            <Icon size={20} />
          </div>
          <div>
            <div className="font-bold text-slate-800">{title}</div>
            <div className="text-sm text-slate-500">{subtitle}</div>
          </div>
        </div>
        <ArrowRight size={18} className="text-slate-300 group-hover:text-emerald-600 transition shrink-0" />
      </div>

      <div className="mt-4 flex items-center gap-2">
        {pendingCount > 0 ? (
          <span className="inline-flex items-center gap-1.5 bg-red-50 text-red-700 text-xs font-bold px-2.5 py-1 rounded-full">
            {pendingCount} {pendingLabel}{pendingCount === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="text-xs text-slate-400">Nothing pending</span>
        )}
      </div>

      {children}
    </Link>
  );
}
