// src/pos-erp/auth/POSAccountStatus.jsx
//
// One component for pending/rejected/suspended — they're the same
// shape (business identity + status message + optional reason +
// sign-out), just different copy and color.

import React from "react";
import { Clock, XCircle, Ban, LogOut } from "lucide-react";
import { usePOSAuth } from "../context/POSAuthContext";

const CONFIG = {
  pending: {
    icon: Clock,
    color: "text-amber-600",
    bg: "bg-amber-50",
    ring: "border-amber-200",
    title: "Application Pending",
    body: "Your business registration is awaiting approval from Umova. You'll be able to sign in as soon as it's reviewed.",
  },
  rejected: {
    icon: XCircle,
    color: "text-red-600",
    bg: "bg-red-50",
    ring: "border-red-200",
    title: "Application Rejected",
    body: "Your business application was not approved.",
  },
  suspended: {
    icon: Ban,
    color: "text-red-600",
    bg: "bg-red-50",
    ring: "border-red-200",
    title: "POS Account Suspended",
    body: "This POS account has been suspended. Contact Umova support for help resolving this.",
  },
};

export default function POSAccountStatus({ stage }) {
  const { tenant, statusDetail, logout } = usePOSAuth();
  const cfg = CONFIG[stage] || CONFIG.pending;
  const Icon = cfg.icon;

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-200 p-8 text-center">
        <div className={`w-14 h-14 rounded-2xl ${cfg.bg} border ${cfg.ring} flex items-center justify-center mx-auto mb-5`}>
          <Icon size={26} className={cfg.color} />
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-1">{cfg.title}</h1>
        {tenant?.business_name && (
          <p className="text-sm text-slate-500 mb-4">
            {tenant.business_name}{tenant.business_code ? ` · ${tenant.business_code}` : ""}
          </p>
        )}
        <p className="text-sm text-slate-600 leading-relaxed mb-2">{cfg.body}</p>
        {statusDetail && (
          <p className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 mt-3 text-left">
            <span className="font-medium">Reason: </span>{statusDetail}
          </p>
        )}

        <button onClick={logout}
          className="mt-6 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700">
          <LogOut size={15} /> Sign out
        </button>
      </div>
    </div>
  );
}
