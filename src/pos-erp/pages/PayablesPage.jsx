// src/pos-erp/pages/PayablesPage.jsx
//
// Phase 3 — the one real gap found in an otherwise-already-built
// purchasing/inventory layer: supplierService.getWithOutstandingBalances()
// existed but was only ever called by notificationsService.js for alerts,
// never surfaced as a browsable view (brief §36).
//
// NOT built as a per-invoice/per-GRN aging table with a "due date" column,
// even though that's closer to the brief's literal wording — confirmed
// against the live schema that neither lb_goods_received_notes nor
// lb_purchase_orders has a due_date column, and lb_suppliers.payment_terms
// is a plain per-supplier default (e.g. "Net 30"), not a per-invoice due
// date to compute aging from. Building a fabricated due-date/aging column
// with nothing real behind it would be worse than not having one — it
// would look authoritative and be wrong. This is a supplier-level
// outstanding-balance list instead; drilling into a supplier reuses the
// exact same detail drawer SuppliersPage.jsx already has (GRNs, POs,
// payments, returns) for itemized detail.

import React, { useEffect, useState, useCallback } from 'react';
import { Wallet, Loader2 } from 'lucide-react';
import { supplierService } from '../services/supplierService';
import { SupplierDetailDrawer } from './SuppliersPage';

export default function PayablesPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSupplier, setSelectedSupplier] = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await supplierService.getWithOutstandingBalances();
      setSuppliers(data || []);
    } catch (err) {
      console.error('[PayablesPage] fetch failed:', err);
      setError(err.message || 'Failed to load payables.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const total = suppliers.reduce((s, x) => s + Number(x.outstanding_balance || 0), 0);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Wallet size={22} className="text-amber-600" /> Payables
          </h1>
          <p className="text-slate-500 text-sm">Suppliers you currently owe money to.</p>
        </div>
        <div className="text-right">
          <div className="text-xs font-bold text-slate-400 uppercase">Total outstanding</div>
          <div className="text-2xl font-black text-red-600">{total.toLocaleString()}</div>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{error}</div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-5 py-3">Supplier</th>
              <th className="text-left px-5 py-3">Contact</th>
              <th className="text-right px-5 py-3">Credit limit</th>
              <th className="text-right px-5 py-3">Outstanding</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={5} className="text-center py-10 text-slate-400">
                <Loader2 size={18} className="animate-spin inline mr-2" /> Loading payables…
              </td></tr>
            )}
            {!loading && suppliers.length === 0 && (
              <tr><td colSpan={5} className="text-center py-10 text-slate-400">Nothing outstanding — all suppliers are paid up.</td></tr>
            )}
            {suppliers.map((s) => (
              <tr key={s.id} onClick={() => setSelectedSupplier(s)} className="hover:bg-slate-50 cursor-pointer transition">
                <td className="px-5 py-3.5 font-semibold text-slate-800">{s.name}</td>
                <td className="px-5 py-3.5 text-slate-600">
                  <div>{s.contact_person || '—'}</div>
                  <div className="text-xs text-slate-400">{s.phone || ''}</div>
                </td>
                <td className="px-5 py-3.5 text-right text-slate-600">{Number(s.credit_limit || 0).toLocaleString()}</td>
                <td className="px-5 py-3.5 text-right font-bold text-red-600">{Number(s.outstanding_balance || 0).toLocaleString()}</td>
                <td className="px-5 py-3.5 text-right">
                  <span className="text-xs font-semibold text-amber-700 hover:underline">View &amp; pay</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
