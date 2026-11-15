// src/pos-erp/pages/SuppliersPage.jsx
//
// Suppliers CRUD + the "link to GRN" view: clicking a supplier opens a
// detail drawer showing their Purchase Orders, GRNs, Payments and
// Returns side by side with outstanding_balance, plus a quick way to
// record a payment. Built against the confirmed lb_suppliers /
// lb_goods_received_notes / lb_purchase_orders / lb_supplier_payments /
// lb_supplier_returns schema.

import React, { useState, useEffect } from "react";
import ContactActions from "../components/ContactActions";
import DocumentActions from "../components/DocumentActions";
import TriangulationSheet from "../components/TriangulationSheet";
import { documentsService } from "../services/documentsService";
import {
  Truck, Search, Plus, X, Phone, Mail, MapPin, CreditCard,
  FileText, Receipt, Undo2, Wallet, ChevronRight, Loader2, Printer,
} from "lucide-react";
import { useSuppliers, useSupplierDetail } from "../hooks/useSuppliers";
import { usePosErpAuth } from "../auth/usePosErpAuth";
import { supplierService } from "../services/supplierService";
// Statement with running balance / date range / print lives in its own
// file (replaces the old flat "print statement" that mixed POs into the
// amounts).
import SupplierStatementModal from "./SupplierStatementModal";
import { FitPage, AddButton, SearchBox, FilterChips, MiniStats, CardGrid, DataCard, IconTile, TextBtn, Notice, LoadingBlock, EmptyBlock } from "../components/CardKit";
import { singleFlight } from '../utils/singleFlight';

export default function SuppliersPage() {
  const { suppliers, loading, error, create, update, deactivate, reactivate, fetch } = useSuppliers();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [selectedSupplier, setSelectedSupplier] = useState(null);

  const owing = suppliers.filter((s) => Number(s.outstanding_balance) > 0);
  const totalOwed = owing.reduce((n, s) => n + Number(s.outstanding_balance || 0), 0);
  const filtered = suppliers.filter((s) => {
    const okSearch = !search || s.name.toLowerCase().includes(search.toLowerCase());
    const okFilter = filter === "all" || (filter === "owing" && Number(s.outstanding_balance) > 0) || (filter === "inactive" && !s.is_active);
    return okSearch && okFilter;
  });

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
    <FitPage
      title="Suppliers"
      icon={Truck}
      subtitle="Your suppliers and their purchase history."
      action={<AddButton onClick={() => { setEditingSupplier(null); setShowForm(true); }} label="Supplier" icon={Plus} />}
      summary={!loading && (
        <MiniStats items={[
          { label: "Suppliers", value: suppliers.length },
          { label: "Owed to", value: owing.length, tone: owing.length ? "gold" : undefined },
          { label: "Total owed", value: totalOwed.toLocaleString(), tone: totalOwed ? "bad" : undefined },
        ]} />
      )}
      toolbar={(
        <div className="space-y-2">
          <SearchBox value={search} onChange={setSearch} placeholder="Search suppliers…" />
          <FilterChips value={filter} onChange={setFilter} options={[
            { key: "all", label: "All" }, { key: "owing", label: "I owe them", count: owing.length }, { key: "inactive", label: "Inactive" },
          ]} />
        </div>
      )}
    >
      {error && <Notice>{error}</Notice>}
      {loading && <LoadingBlock text="Loading suppliers…" />}
      {!loading && filtered.length === 0 && <EmptyBlock>No suppliers found.</EmptyBlock>}

      <CardGrid>
        {filtered.map((s) => {
          const bal = Number(s.outstanding_balance || 0);
          return (
            <DataCard
              key={s.id}
              dim={!s.is_active}
              alert={bal > 0}
              onClick={() => setSelectedSupplier(s)}
              thumb={<IconTile icon={Truck} />}
              title={s.name}
              subtitle={s.contact_person || s.phone || s.email || "No contact"}
              pill={s.is_active ? undefined : { tone: "neutral", label: "Off" }}
              big={{ value: bal.toLocaleString(), tone: bal > 0 ? "bad" : "muted", label: bal > 0 ? "owed" : "all paid" }}
              metrics={[
                { label: "Terms", value: s.payment_terms || "—" },
                { label: "Phone", value: s.phone || "—" },
              ]}
              actions={(
                <>
                  <ContactActions size="sm" recipient={{ kind: 'SUPPLIER', id: s.id, name: s.name, phone: s.phone, email: s.email }} purpose="SUPPLIER_STATEMENT" />
                  <TextBtn onClick={() => { setEditingSupplier(s); setShowForm(true); }}>Edit</TextBtn>
                  <TextBtn tone={s.is_active ? "danger" : undefined} onClick={() => (s.is_active ? deactivate(s.id) : reactivate(s.id))}>
                    {s.is_active ? "Deactivate" : "Reactivate"}
                  </TextBtn>
                </>
              )}
            />
          );
        })}
      </CardGrid>

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
    </FitPage>
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

  const submit = singleFlight('SuppliersPage.submit', async (e) => {
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
  });

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
  const [matchFor, setMatchFor] = useState(null);
  const [showPayment, setShowPayment] = useState(false);
  const [showStatement, setShowStatement] = useState(false);

  // Phase 16: purchased/paid totals for a proper statement — GRNs
  // (goods actually received) rather than POs (which may still be
  // pending/unfulfilled) is what "purchased" means here, matching how
  // the brief's own §8 example frames it ("Bought: X, Paid: Y").
  const totalPurchased = grns.reduce((s, g) => s + Number(g.total_amount || 0), 0);
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);

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
            onClick={() => setShowStatement(true)}
            className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold px-4 py-2.5 rounded-xl transition mb-5"
          >
            <Printer size={15} /> Statement
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
            <RowCard key={po.id} title={po.po_number} status={po.status} right={Number(po.total_amount).toLocaleString()} sub={po.order_date}
              actions={<><DocumentActions items={[['PURCHASE_ORDER', 'Print PO', po.id]]} /><button type="button" onClick={() => setMatchFor(po.id)} className="text-xs font-semibold text-[#1F6B45] hover:underline">Check documents</button></>} />
          ))}
          {!loading && tab === "grns" && grns.map((g) => (
            <RowCard key={g.id} title={g.grn_number} status={g.status} right={Number(g.total_amount).toLocaleString()} sub={`${g.received_date || ''}${g.invoice_no ? ` · invoice ${g.invoice_no}` : ''}`}
              actions={<DocumentActions items={[['GOODS_RECEIVED', 'Print delivery note', g.id]]} />} />
          ))}
          {!loading && tab === "payments" && payments.map((p) => (
            <RowCard key={p.id} title={p.payment_number} status={p.payment_method} right={Number(p.amount).toLocaleString()} sub={p.payment_date} />
          ))}
          {!loading && tab === "returns" && returns.map((r) => (
            <RowCard key={r.id} title={r.return_number} status={r.status} right={Number(r.total_amount).toLocaleString()} sub={r.reason} />
          ))}
        </div>
      </div>

      {matchFor && <TriangulationSheet poId={matchFor} onClose={() => setMatchFor(null)} />}

      {showStatement && (
        <SupplierStatementModal supplier={supplier} onClose={() => setShowStatement(false)} />
      )}

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

function RowCard({ title, status, right, sub, actions }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-50 last:border-0">
      <div>
        <div className="text-sm font-semibold text-slate-700">{title}</div>
        {sub && <div className="text-xs text-slate-400">{sub}</div>}
        {actions && <div className="mt-1 flex flex-wrap gap-x-3">{actions}</div>}
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
  const [mismatches, setMismatches] = useState([]);
  const [reason, setReason] = useState("");
  // Before paying: do this supplier's orders, deliveries and invoices agree? A warning only; paying is still allowed with a reason.
  useEffect(() => { documentsService.supplierMismatches({ supplierId: supplier.id }).then(setMismatches).catch(() => setMismatches([])); }, [supplier.id]);

  const submit = singleFlight('SuppliersPage.submit', async (e) => {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) {
      setErr("Enter a valid amount.");
      return;
    }
    if (mismatches.length && !reason.trim()) {
      setErr("Some documents do not agree. Please give a reason for paying anyway.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await supplierService.recordPayment({
        notes: mismatches.length ? `Paid despite document differences (${mismatches.map((m) => m.po.po_number).join(", ")}): ${reason.trim()}` : null,
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
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">Record Payment</h3>
          <button onClick={onClose}><X size={18} className="text-slate-400" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {err && <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-2.5">{err}</div>}
          {mismatches.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-lg p-2.5 space-y-1">
              <div className="font-bold">Check before paying: these documents do not agree</div>
              {mismatches.slice(0, 4).map((m) => (
                <div key={m.po.id}><b>{m.po.po_number}</b>: {m.match.issues[0]}{m.match.issues.length > 1 ? ` (+${m.match.issues.length - 1} more)` : ""}</div>
              ))}
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for paying anyway (required)" className="input mt-1" />
            </div>
          )}
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
