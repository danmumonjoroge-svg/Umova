// src/pos-erp/pages/SuppliersPage.jsx
//
// Suppliers CRUD + the "link to GRN" view: clicking a supplier opens a
// detail drawer showing their Purchase Orders, GRNs, Payments and
// Returns side by side with outstanding_balance, plus a quick way to
// record a payment. Built against the confirmed lb_suppliers /
// lb_goods_received_notes / lb_purchase_orders / lb_supplier_payments /
// lb_supplier_returns schema.

import React, { useState } from "react";
import {
  Truck, Search, Plus, X, Phone, Mail, MapPin, CreditCard,
  FileText, Receipt, Undo2, Wallet, ChevronRight, Loader2, Printer,
} from "lucide-react";
import { useSuppliers, useSupplierDetail } from "../hooks/useSuppliers";
import { usePosErpAuth } from "../auth/usePosErpAuth";
import { supplierService } from "../services/supplierService";
// Phase 16: a proper, printable statement for suppliers too — same
// shared print utility the sale receipt and customer statement use.
import { printDocument, escapeHtml } from "../utils/printDocument";

export default function SuppliersPage() {
  const { suppliers, loading, error, create, update, deactivate, reactivate, fetch } = useSuppliers();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [selectedSupplier, setSelectedSupplier] = useState(null);

  const filtered = suppliers.filter((s) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleSave = async (formData) => {
    if (editingSupplier) {
      await update(editingSupplier.id, formData);
    } else {
      await create(formData);
    }
    setShowForm(false);
    setEditingSupplier(null);
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Truck size={22} className="text-emerald-600" /> Suppliers
          </h1>
          <p className="text-slate-500 text-sm">Manage suppliers and their purchase history.</p>
        </div>
        <button
          onClick={() => { setEditingSupplier(null); setShowForm(true); }}
          className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition"
        >
          <Plus size={16} /> Add Supplier
        </button>
      </div>

      <div className="relative mb-5">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search suppliers…"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
        />
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{error}</div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-5 py-3">Supplier</th>
              <th className="text-left px-5 py-3">Contact</th>
              <th className="text-left px-5 py-3">Terms</th>
              <th className="text-right px-5 py-3">Outstanding</th>
              <th className="text-center px-5 py-3">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={6} className="text-center py-10 text-slate-400">
                <Loader2 size={18} className="animate-spin inline mr-2" /> Loading suppliers…
              </td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center py-10 text-slate-400">No suppliers found.</td></tr>
            )}
            {filtered.map((s) => (
              <tr
                key={s.id}
                onClick={() => setSelectedSupplier(s)}
                className="hover:bg-slate-50 cursor-pointer transition"
              >
                <td className="px-5 py-3.5">
                  <div className="font-semibold text-slate-800">{s.name}</div>
                  {s.registration_no && <div className="text-xs text-slate-400">{s.registration_no}</div>}
                </td>
                <td className="px-5 py-3.5 text-slate-600">
                  <div>{s.contact_person || "—"}</div>
                  <div className="text-xs text-slate-400">{s.phone || s.email || ""}</div>
                </td>
                <td className="px-5 py-3.5 text-slate-600">{s.payment_terms || "—"}</td>
                <td className={`px-5 py-3.5 text-right font-semibold ${s.outstanding_balance > 0 ? "text-red-600" : "text-slate-400"}`}>
                  {Number(s.outstanding_balance || 0).toLocaleString()}
                </td>
                <td className="px-5 py-3.5 text-center">
                  <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${s.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                    {s.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => { setEditingSupplier(s); setShowForm(true); }}
                      className="text-xs font-semibold text-slate-500 hover:text-emerald-700"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => (s.is_active ? deactivate(s.id) : reactivate(s.id))}
                      className="text-xs font-semibold text-slate-500 hover:text-red-600"
                    >
                      {s.is_active ? "Deactivate" : "Reactivate"}
                    </button>
                    <ChevronRight size={15} className="text-slate-300" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <SupplierFormModal
          initial={editingSupplier}
          onClose={() => { setShowForm(false); setEditingSupplier(null); }}
          onSave={handleSave}
        />
      )}

      {selectedSupplier && (
        <SupplierDetailDrawer
          supplier={selectedSupplier}
          onClose={() => setSelectedSupplier(null)}
          onPaymentRecorded={fetch}
        />
      )}
    </div>
  );
}

function SupplierFormModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState({
    name: initial?.name || "",
    registration_no: initial?.registration_no || "",
    phone: initial?.phone || "",
    email: initial?.email || "",
    address: initial?.address || "",
    contact_person: initial?.contact_person || "",
    payment_terms: initial?.payment_terms || "",
    credit_limit: initial?.credit_limit ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError("Supplier name is required.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await onSave({ ...form, credit_limit: Number(form.credit_limit) || 0 });
    } catch (err) {
      setFormError(err.message || "Failed to save supplier.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="font-bold text-slate-800">{initial ? "Edit Supplier" : "Add Supplier"}</h2>
          <button onClick={onClose}><X size={18} className="text-slate-400" /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {formError && <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-2.5">{formError}</div>}

          <Field label="Name *"><input value={form.name} onChange={set("name")} className="input" required /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact person"><input value={form.contact_person} onChange={set("contact_person")} className="input" /></Field>
            <Field label="Registration no."><input value={form.registration_no} onChange={set("registration_no")} className="input" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone"><input value={form.phone} onChange={set("phone")} className="input" /></Field>
            <Field label="Email"><input type="email" value={form.email} onChange={set("email")} className="input" /></Field>
          </div>
          <Field label="Address"><textarea value={form.address} onChange={set("address")} className="input" rows={2} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Payment terms"><input value={form.payment_terms} onChange={set("payment_terms")} placeholder="e.g. Net 30" className="input" /></Field>
            <Field label="Credit limit"><input type="number" min="0" value={form.credit_limit} onChange={set("credit_limit")} className="input" /></Field>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl transition"
          >
            {saving ? "Saving…" : initial ? "Save changes" : "Add supplier"}
          </button>
        </form>
      </div>
      <style>{`.input { width: 100%; border: 1px solid #e2e8f0; border-radius: 0.75rem; padding: 0.6rem 0.75rem; font-size: 0.875rem; }`}</style>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-slate-500 mb-1">{label}</div>
      {children}
    </label>
  );
}

// Exported (not just used internally) so PayablesPage.jsx can reuse the
// exact same drawer — same POs/GRNs/payments/returns/record-payment UI —
// instead of duplicating it for a second entry point into the same data.
export function SupplierDetailDrawer({ supplier, onClose, onPaymentRecorded }) {
  const { purchaseOrders, grns, payments, returns, loading, refetch } = useSupplierDetail(supplier.id);
  const [tab, setTab] = useState("grns");
  const [showPayment, setShowPayment] = useState(false);

  // Phase 16: purchased/paid totals for a proper statement — GRNs
  // (goods actually received) rather than POs (which may still be
  // pending/unfulfilled) is what "purchased" means here, matching how
  // the brief's own §8 example frames it ("Bought: X, Paid: Y").
  const totalPurchased = grns.reduce((s, g) => s + Number(g.total_amount || 0), 0);
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);

  const printStatement = () => {
    const fmt = (n) => Number(n || 0).toLocaleString();
    // One consolidated, date-sorted ledger across all four transaction
    // types — the tabbed view above is better for browsing on screen,
    // but a printed statement should read as one running account, not
    // four separate lists the recipient has to reassemble themselves.
    const rows = [
      ...purchaseOrders.map(po => ({ date: po.order_date, label: `PO ${po.po_number}`, amount: Number(po.total_amount) })),
      ...grns.map(g => ({ date: g.received_date, label: `Goods received ${g.grn_number}`, amount: Number(g.total_amount) })),
      ...payments.map(p => ({ date: p.payment_date, label: `Payment ${p.payment_number} (${String(p.payment_method || '').replace('_', ' ')})`, amount: -Number(p.amount) })),
      ...returns.map(r => ({ date: r.created_at, label: `Return ${r.return_number}${r.reason ? ` — ${r.reason}` : ''}`, amount: -Number(r.total_amount) })),
    ].filter(r => r.date).sort((a, b) => new Date(a.date) - new Date(b.date));

    const rowsHtml = rows.map(r => `
      <tr><td>${new Date(r.date).toLocaleDateString()}</td><td>${escapeHtml(r.label)}</td><td class="right">${fmt(r.amount)}</td></tr>
    `).join('');

    printDocument(`Statement — ${supplier.name}`, `
      <div class="center bold" style="font-size:16px;">${escapeHtml(supplier.name)}</div>
      <div class="center muted">
        ${supplier.phone ? escapeHtml(supplier.phone) : ''}${supplier.phone && supplier.email ? ' · ' : ''}${supplier.email ? escapeHtml(supplier.email) : ''}
      </div>
      ${supplier.address ? `<div class="center muted">${escapeHtml(supplier.address)}</div>` : ''}
      <div class="divider"></div>
      <div class="center bold" style="font-size:14px;">Supplier Statement</div>
      <div class="center muted">${new Date().toLocaleDateString()}</div>
      <div class="divider"></div>
      <table>
        <tr><td>Total Purchased</td><td class="right">${fmt(totalPurchased)}</td></tr>
        <tr><td>Total Paid</td><td class="right">${fmt(totalPaid)}</td></tr>
        <tr class="bold"><td>Balance Owed</td><td class="right">${fmt(supplier.outstanding_balance)}</td></tr>
      </table>
      <div class="divider"></div>
      <table>
        <thead><tr><th>Date</th><th>Detail</th><th class="right">Amount</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="3" class="center muted">No transactions yet</td></tr>'}</tbody>
      </table>
    `, `table { font-size: 12px; } th { text-align: left; border-bottom: 1px solid #ccc; }`);
  };

  const tabs = [
    { key: "pos", label: "Purchase Orders", icon: FileText, rows: purchaseOrders },
    { key: "grns", label: "GRNs", icon: Truck, rows: grns },
    { key: "payments", label: "Payments", icon: Receipt, rows: payments },
    { key: "returns", label: "Returns", icon: Undo2, rows: returns },
  ];
  const active = tabs.find((t) => t.key === tab);

  return (
    <div className="fixed inset-0 bg-black/30 flex justify-end z-50">
      <div className="bg-white w-full max-w-xl h-full overflow-y-auto shadow-2xl">
        <div className="p-5 border-b border-slate-100 flex items-start justify-between">
          <div>
            <h2 className="font-bold text-slate-800 text-lg">{supplier.name}</h2>
            <div className="text-xs text-slate-500 space-y-0.5 mt-1">
              {supplier.contact_person && <div>{supplier.contact_person}</div>}
              {supplier.phone && <div className="flex items-center gap-1"><Phone size={11} /> {supplier.phone}</div>}
              {supplier.email && <div className="flex items-center gap-1"><Mail size={11} /> {supplier.email}</div>}
              {supplier.address && <div className="flex items-center gap-1"><MapPin size={11} /> {supplier.address}</div>}
            </div>
          </div>
          <button onClick={onClose}><X size={18} className="text-slate-400" /></button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-5">
          <div className="rounded-xl bg-red-50 border border-red-200 p-4">
            <div className="text-[11px] font-bold text-red-700 uppercase flex items-center gap-1"><Wallet size={13} /> Outstanding</div>
            <div className="text-xl font-black text-red-700 mt-1">{Number(supplier.outstanding_balance || 0).toLocaleString()}</div>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
            <div className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1"><CreditCard size={13} /> Credit limit</div>
            <div className="text-xl font-black text-slate-700 mt-1">{Number(supplier.credit_limit || 0).toLocaleString()}</div>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
            <div className="text-[11px] font-bold text-slate-500 uppercase">Purchased</div>
            <div className="text-xl font-black text-slate-700 mt-1">{totalPurchased.toLocaleString()}</div>
          </div>
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
            <div className="text-[11px] font-bold text-emerald-600 uppercase">Paid</div>
            <div className="text-xl font-black text-emerald-700 mt-1">{totalPaid.toLocaleString()}</div>
          </div>
        </div>

        <div className="px-5 flex gap-2">
          <button
            onClick={() => setShowPayment(true)}
            className="flex-1 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold py-2.5 rounded-xl transition mb-5"
          >
            Record Payment
          </button>
          <button
            onClick={printStatement}
            className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold px-4 py-2.5 rounded-xl transition mb-5"
          >
            <Printer size={15} /> Print Statement
          </button>
        </div>

        <div className="flex border-b border-slate-100 px-5 gap-4">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 text-xs font-semibold pb-2.5 border-b-2 transition ${
                tab === t.key ? "border-emerald-700 text-emerald-700" : "border-transparent text-slate-400"
              }`}
            >
              <t.icon size={13} /> {t.label} <span className="text-slate-300">({t.rows.length})</span>
            </button>
          ))}
        </div>

        <div className="p-5">
          {loading && <div className="text-center text-slate-400 text-sm py-8"><Loader2 size={16} className="animate-spin inline mr-2" /> Loading…</div>}
          {!loading && active.rows.length === 0 && (
            <div className="text-center text-slate-400 text-sm py-8">No {active.label.toLowerCase()} yet.</div>
          )}
          {!loading && tab === "pos" && purchaseOrders.map((po) => (
            <RowCard key={po.id} title={po.po_number} status={po.status} right={Number(po.total_amount).toLocaleString()} sub={po.order_date} />
          ))}
          {!loading && tab === "grns" && grns.map((g) => (
            <RowCard key={g.id} title={g.grn_number} status={g.status} right={Number(g.total_amount).toLocaleString()} sub={g.received_date} />
          ))}
          {!loading && tab === "payments" && payments.map((p) => (
            <RowCard key={p.id} title={p.payment_number} status={p.payment_method} right={Number(p.amount).toLocaleString()} sub={p.payment_date} />
          ))}
          {!loading && tab === "returns" && returns.map((r) => (
            <RowCard key={r.id} title={r.return_number} status={r.status} right={Number(r.total_amount).toLocaleString()} sub={r.reason} />
          ))}
        </div>
      </div>

      {showPayment && (
        <RecordPaymentModal
          supplier={supplier}
          onClose={() => setShowPayment(false)}
          onRecorded={() => { setShowPayment(false); refetch(); onPaymentRecorded?.(); }}
        />
      )}
    </div>
  );
}

function RowCard({ title, status, right, sub }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-50 last:border-0">
      <div>
        <div className="text-sm font-semibold text-slate-700">{title}</div>
        {sub && <div className="text-xs text-slate-400">{sub}</div>}
      </div>
      <div className="text-right">
        <div className="text-sm font-bold text-slate-800">{right}</div>
        {status && <div className="text-[10px] uppercase font-bold text-slate-400">{status}</div>}
      </div>
    </div>
  );
}

function RecordPaymentModal({ supplier, onClose, onRecorded }) {
  const { staffId, tenant } = usePosErpAuth();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) {
      setErr("Enter a valid amount.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await supplierService.recordPayment({
        businessId: tenant?.business_id,
        supplierId: supplier.id,
        // payment_number is no longer supplied here — record_supplier_payment()
        // now generates it server-side (see supplierService.js fix).
        amount: Number(amount),
        paymentMethod: method,
        referenceNo: reference || null,
        createdBy: staffId,
      });
      onRecorded();
    } catch (e2) {
      setErr(e2.message || "Failed to record payment.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">Record Payment</h3>
          <button onClick={onClose}><X size={18} className="text-slate-400" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {err && <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-2.5">{err}</div>}
          <Field label="Amount *">
            <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" required />
          </Field>
          <Field label="Method">
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="input">
              <option value="CASH">Cash</option>
              <option value="MOBILE_MONEY">Mobile Money</option>
              <option value="BANK">Bank</option>
              <option value="CARD">Card</option>
              {/* CREDIT removed — it's a sale/purchase payment method, not
                  something you'd record as how a payment reducing an
                  existing balance was itself paid (same fix as the
                  customer-payment modal in Phase 2). */}
              <option value="VOUCHER">Voucher</option>
              <option value="OTHER">Other</option>
            </select>
          </Field>
          <Field label="Reference no.">
            <input value={reference} onChange={(e) => setReference(e.target.value)} className="input" />
          </Field>
          <button type="submit" disabled={saving} className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl transition">
            {saving ? "Recording…" : "Record payment"}
          </button>
        </form>
        <style>{`.input { width: 100%; border: 1px solid #e2e8f0; border-radius: 0.75rem; padding: 0.6rem 0.75rem; font-size: 0.875rem; }`}</style>
      </div>
    </div>
  );
}
