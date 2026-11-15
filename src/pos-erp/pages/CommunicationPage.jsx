// src/pos-erp/pages/CommunicationPage.jsx
//
// This is INTERNAL notifications (brief §51) — the page POSTopbar's bell
// has always linked to. Groups notifications by category (Shifts,
// Inventory, Suppliers, Customer Credit) rather than one flat list,
// since they call for different actions. Kept deliberately separate from
// customer-facing communication (templates/SMS/email/WhatsApp/history) —
// see pages/CustomerCommunicationPage.jsx for that half, per §51's
// explicit "separate Internal POS Notifications from Customer
// Communication" requirement.

import React from "react";
import { Link } from "react-router-dom";
import { Bell, AlertTriangle, Package, Truck, Users, Clock, Loader2, Coins, CalendarClock, MessageSquare } from "lucide-react";
import { useNotifications } from "../hooks/useNotifications";
import ContactActions from "../components/ContactActions";

const CATEGORY_META = {
  SHIFT: { label: "Shifts", icon: Clock },
  INVENTORY: { label: "Inventory", icon: Package },
  SUPPLIER: { label: "Suppliers", icon: Truck },
  CUSTOMER: { label: "Customer Credit", icon: Users },
  LOAN: { label: "Loan repayments", icon: Coins },
  APPOINTMENT: { label: "Appointments", icon: CalendarClock },
  MESSAGES: { label: "Messages", icon: MessageSquare },
};

export default function CommunicationPage() {
  const { notifications, readKeys, loading, error, markRead } = useNotifications();
  const unreadKeys = notifications.filter((n) => !readKeys.has(n.id)).map((n) => n.id);

  const grouped = notifications.reduce((acc, n) => {
    (acc[n.category] = acc[n.category] || []).push(n);
    return acc;
  }, {});

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-1 flex items-center gap-2">
        <Bell size={22} className="text-emerald-600" /> Notifications
      </h1>
      <div className="flex items-center justify-between mb-6">
        <p className="text-slate-500 text-sm">Things that need attention across the business.</p>
        {unreadKeys.length > 0 && <button onClick={() => markRead(unreadKeys)} className="text-xs font-semibold text-[#1F6B45] underline">Mark all as read</button>}
      </div>

      {loading && (
        <div className="text-center text-slate-400 py-10">
          <Loader2 size={18} className="animate-spin inline mr-2" /> Loading…
        </div>
      )}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3 mb-4">{error}</div>}

      {!loading && notifications.length === 0 && !error && (
        <div className="text-center text-slate-400 py-10">Nothing needs attention right now.</div>
      )}

      {Object.entries(grouped).map(([category, items]) => {
        const meta = CATEGORY_META[category] || { label: category, icon: Bell };
        const Icon = meta.icon;
        return (
          <div key={category} className="mb-6">
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-1.5">
              <Icon size={13} /> {meta.label} ({items.length})
            </h2>
            <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
              {items.map((n) => (
                <NotificationRow key={n.id} notification={n} unread={!readKeys.has(n.id)} onRead={() => markRead([n.id])} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NotificationRow({ notification, unread, onRead }) {
  const n = notification;
  const tone = n.severity === "high" ? "text-red-500" : n.severity === "low" ? "text-slate-400" : "text-amber-500";
  const content = (
    <div className="flex items-start gap-3 px-5 py-3.5" onClick={unread ? onRead : undefined}>
      <AlertTriangle size={16} className={`mt-0.5 shrink-0 ${tone}`} />
      <div className={`text-sm flex-1 ${unread ? "text-slate-800 font-semibold" : "text-slate-500"}`}>
        {n.message}
        {n.severity === "high" && <span className="ml-2 text-[10px] font-bold uppercase text-red-600">Urgent</span>}
      </div>
      {unread && <span className="mt-1.5 w-2 h-2 rounded-full bg-[#C9A227] shrink-0" aria-label="Unread" />}
    </div>
  );
  const row = n.link ? <Link to={n.link} className="block hover:bg-slate-50 transition">{content}</Link> : <div>{content}</div>;
  if (!n.contact?.id) return row;
  return (
    <div>
      {row}
      <div className="px-5 pb-3 pl-12">
        <ContactActions size="sm" recipient={{ kind: n.contact.kind, id: n.contact.id }} purpose={n.contact.purpose} reference={n.contact.reference} />
      </div>
    </div>
  );
}
