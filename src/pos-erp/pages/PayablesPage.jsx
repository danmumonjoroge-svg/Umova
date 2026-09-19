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
//
// Phase 10 adds a "Remind" action, the supplier mirror of §7's "Remind
// John" on CustomersPage — same WhatsApp machinery, same Prepared →
// Opened in WhatsApp → Sent by you states, same refusal on an
// unparseable phone number. The SUPPLIER_PAYMENT_DUE template
// deliberately has no due-date wording for the same reason this page's
// own header note gives: nothing in this schema has a real per-invoice
// due date to put there.

import React, { useEffect, useState, useCallback } from 'react';
import { Wallet, Loader2 } from 'lucide-react';
import { supplierService } from '../services/supplierService';
import { SupplierDetailDrawer } from './SuppliersPage';
import { useSupplierTemplates, useCommunicationLog } from '../hooks/useCommunication';
import { normalizePhoneForWhatsApp } from '../services/communicationService';

export default function PayablesPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSupplier, setSelectedSupplier] = useState(null);

  // §7's "Remind" mirrored for suppliers — reuses the shared WhatsApp
  // path, no second message-sending implementation on this page.
  const { templates } = useSupplierTemplates();
  const { prepareWhatsAppForSupplier, markOpened, markSent, markNotSent } = useCommunicationLog();
  const [remindError, setRemindError] = useState('');
  const [remindingId, setRemindingId] = useState(null);
  const [awaitingConfirm, setAwaitingConfirm] = useState(null); // { logId, supplierName }

  const reminderTemplate = templates.find(t => t.message_type === 'SUPPLIER_PAYMENT_DUE');

  const handleRemind = async (supplier) => {
    setRemindError('');
    if (!reminderTemplate) {
      setRemindError('The WhatsApp reminder wording has not loaded yet. Give it a moment.');
      return;
    }
    setRemindingId(supplier.id);
    try {
      const { log, url } = await prepareWhatsAppForSupplier({
        supplier,
        template: reminderTemplate,
        variables: { balance: Number(supplier.outstanding_balance || 0).toLocaleString() },
      });
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      if (win) {
        await markOpened(log.id);
        setAwaitingConfirm({ logId: log.id, supplierName: supplier.name });
      } else {
        setRemindError('Your browser blocked the WhatsApp window. The reminder is saved — open it from Messages.');
      }
    } catch (err) {
      setRemindError(err.message);
    } finally {
      setRemindingId(null);
    }
  };

  const confirmReminderSent = async (didSend) => {
    if (!awaitingConfirm) return;
    try {
      await (didSend ? markSent(awaitingConfirm.logId) : markNotSent(awaitingConfirm.logId));
    } catch (err) {
      setRemindError(err.message);
    } finally {
      setAwaitingConfirm(null);
    }
  };

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
            <Wallet size={22} className="text-amber-600" /> People I Owe
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
      {remindError && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{remindError}</div>
      )}
      {awaitingConfirm && (
        <div className="mb-4 flex flex-wrap items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <span className="text-sm text-amber-900 font-semibold">
            Did you press Send in WhatsApp for {awaitingConfirm.supplierName}?
          </span>
          <button type="button" onClick={() => confirmReminderSent(true)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-800 text-white hover:bg-emerald-900">Yes, I sent it</button>
          <button type="button" onClick={() => confirmReminderSent(false)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50">Not yet</button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
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
                <td className="px-5 py-3.5 text-right whitespace-nowrap">
                  <span className="text-xs font-semibold text-amber-700 hover:underline mr-3">View &amp; pay</span>
                  {/* Row's onClick opens the drawer — stop that from
                      also firing when the owner meant to press Remind. */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemind(s); }}
                    disabled={remindingId === s.id || !normalizePhoneForWhatsApp(s.phone)}
                    title={normalizePhoneForWhatsApp(s.phone) ? 'Send a WhatsApp reminder' : 'No usable WhatsApp number on this supplier'}
                    className="text-xs font-semibold text-emerald-700 hover:underline disabled:text-slate-300 disabled:no-underline disabled:cursor-not-allowed"
                  >
                    {remindingId === s.id ? 'Opening…' : 'Remind'}
                  </button>
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
