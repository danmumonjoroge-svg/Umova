// src/pos-erp/pages/CustomersPage.jsx
//
// Phase 2 — customers, standalone payments, receivables, statements
// (brief §21-26). Sales/payments-at-sale-time/receipts already existed
// (saleService.js); this page is what was actually missing: customer
// records, and a way to record a payment against an existing balance
// outside of a new sale.
//
// customer_type options and payment_method options are the REAL enum
// values (confirmed against the live DB), not the brief's wording.
// CREDIT is deliberately excluded from the payment-method choices here —
// it's a sale payment method, not something you'd record as how a
// standalone payment was paid.
//
// Phase 8 adds §7's "Remind John" — a one-press WhatsApp payment
// reminder for anyone with a balance. It reuses the WhatsApp machinery
// in communicationService.js rather than building a second message path,
// and it inherits that machinery's honesty rules: the reminder is
// logged Prepared → Opened in WhatsApp → Sent by you, never "Delivered",
// because the owner is the one who presses Send inside WhatsApp.

import React, { useState } from 'react';
import { useCustomers } from '../hooks/useCustomers';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { paymentService } from '../services/paymentService';
import { receivablesService } from '../services/receivablesService';
import { useTemplates, useCommunicationLog } from '../hooks/useCommunication';
import { normalizePhoneForWhatsApp } from '../services/communicationService';

const CUSTOMER_TYPES = ['WALK_IN', 'REGISTERED', 'BUSINESS', 'CREDIT'];
const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'CARD', 'BANK', 'VOUCHER', 'OTHER'];

const EMPTY_FORM = { name: '', phone: '', email: '', address: '', customer_type: 'WALK_IN', credit_limit: '0' };
const EMPTY_PAYMENT = { amount: '', payment_method: 'CASH', reference_no: '', notes: '' };

function fmt(n) {
  return (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function CustomersPage() {
  const { staffId, tenant } = usePosErpAuth();
  const { customers, loading, error, create, update, deactivate, reactivate, fetch } = useCustomers();

  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [receivablesOnly, setReceivablesOnly] = useState(false);

  const [payingCustomer, setPayingCustomer] = useState(null);
  const [paymentForm, setPaymentForm] = useState(EMPTY_PAYMENT);
  const [paymentError, setPaymentError] = useState('');
  const [payingBusy, setPayingBusy] = useState(false);

  // §7 — "Remind John". Reuses the shared WhatsApp path; no second
  // message-sending implementation lives on this page.
  const { templates } = useTemplates();
  const { prepareWhatsApp, markOpened, markSent, markNotSent } = useCommunicationLog();
  const [remindError, setRemindError] = useState('');
  const [remindingId, setRemindingId] = useState(null);
  const [awaitingConfirm, setAwaitingConfirm] = useState(null); // { logId, customerName }

  const reminderTemplate = templates.find(t => t.channel === 'WHATSAPP' && t.message_type === 'PAYMENT_DUE');

  const handleRemind = async (customer) => {
    setRemindError('');
    if (!reminderTemplate) {
      setRemindError('The WhatsApp reminder wording has not loaded yet. Give it a moment, or check Messages if it keeps failing.');
      return;
    }
    setRemindingId(customer.id);
    try {
      const { log, url } = await prepareWhatsApp({
        customer,
        template: reminderTemplate,
        variables: { balance: fmt(customer.outstanding_balance), amount: fmt(customer.outstanding_balance) },
      });
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      if (win) {
        await markOpened(log.id);
        setAwaitingConfirm({ logId: log.id, customerName: customer.name });
      } else {
        setRemindError('Your browser blocked the WhatsApp window. The reminder is saved under Messages — open it from there.');
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

  const [statementCustomer, setStatementCustomer] = useState(null);
  const [statementRows, setStatementRows] = useState([]);
  const [statementLoading, setStatementLoading] = useState(false);

  const openCreateForm = () => {
    setEditingCustomer(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setShowForm(true);
  };

  const openEditForm = (customer) => {
    setEditingCustomer(customer);
    setForm({
      name: customer.name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || '',
      customer_type: customer.customer_type || 'WALK_IN',
      credit_limit: String(customer.credit_limit ?? 0),
    });
    setFormError('');
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      const payload = { ...form, credit_limit: parseFloat(form.credit_limit) || 0 };
      if (editingCustomer) {
        await update(editingCustomer.id, payload);
      } else {
        await create(payload);
      }
      setShowForm(false);
      setEditingCustomer(null);
      setForm(EMPTY_FORM);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openPaymentModal = (customer) => {
    setPayingCustomer(customer);
    setPaymentForm(EMPTY_PAYMENT);
    setPaymentError('');
  };

  const submitPayment = async (e) => {
    e.preventDefault();
    setPaymentError('');
    if (!tenant?.business_id) {
      setPaymentError('No business is linked to this POS tenant yet — cannot record a payment.');
      return;
    }
    setPayingBusy(true);
    try {
      await paymentService.recordCustomerPayment({
        businessId: tenant.business_id,
        customerId: payingCustomer.id,
        amount: parseFloat(paymentForm.amount),
        paymentMethod: paymentForm.payment_method,
        referenceNo: paymentForm.reference_no,
        notes: paymentForm.notes,
        createdBy: staffId,
      });
      setPayingCustomer(null);
      fetch(); // refresh outstanding_balance from the DB rather than guessing the new value client-side
    } catch (err) {
      setPaymentError(err.message);
    } finally {
      setPayingBusy(false);
    }
  };

  const openStatement = async (customer) => {
    setStatementCustomer(customer);
    setStatementLoading(true);
    try {
      const rows = await receivablesService.getStatement(customer.id);
      setStatementRows(rows);
    } catch (err) {
      setStatementRows([]);
    } finally {
      setStatementLoading(false);
    }
  };

  const visibleCustomers = receivablesOnly ? customers.filter(c => Number(c.outstanding_balance) > 0) : customers;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Customers</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={receivablesOnly} onChange={e => setReceivablesOnly(e.target.checked)} />
            With outstanding balance only
          </label>
          <button
            onClick={() => (showForm ? setShowForm(false) : openCreateForm())}
            className="bg-emerald-800 hover:bg-emerald-900 text-white px-4 py-2 rounded-xl font-semibold shadow-[0_2px_0_0_rgba(251,191,36,0.6)]"
          >
            {showForm ? 'Cancel' : '+ Customer'}
          </button>
        </div>
      </div>

      {remindError && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{remindError}</div>
      )}

      {/* We know WhatsApp opened. We do not know the owner pressed Send. */}
      {awaitingConfirm && (
        <div className="mb-4 flex flex-wrap items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <span className="text-sm text-amber-900 font-semibold">
            Did you press Send in WhatsApp for {awaitingConfirm.customerName}?
          </span>
          <button type="button" onClick={() => confirmReminderSent(true)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-800 text-white hover:bg-emerald-900">Yes, I sent it</button>
          <button type="button" onClick={() => confirmReminderSent(false)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50">Not yet</button>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white p-4 rounded-2xl shadow mb-6 grid grid-cols-1 md:grid-cols-3 gap-3 border border-slate-100">
          {formError && <div className="md:col-span-3 bg-red-50 text-red-700 text-sm rounded px-3 py-2">{formError}</div>}
          <input required placeholder="Customer Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2 focus:border-emerald-700 focus:ring-4 focus:ring-amber-100 outline-none" />
          <input placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2 focus:border-emerald-700 focus:ring-4 focus:ring-amber-100 outline-none" />
          <input placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2 focus:border-emerald-700 focus:ring-4 focus:ring-amber-100 outline-none" />
          <input placeholder="Address" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2 focus:border-emerald-700 focus:ring-4 focus:ring-amber-100 outline-none md:col-span-2" />
          <select value={form.customer_type} onChange={e => setForm({ ...form, customer_type: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2">
            {CUSTOMER_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Credit limit</label>
            <input type="number" min="0" value={form.credit_limit} onChange={e => setForm({ ...form, credit_limit: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2" />
          </div>
          <button type="submit" disabled={saving} className="bg-emerald-800 hover:bg-emerald-900 text-white px-6 py-2 rounded-xl md:col-span-3 disabled:opacity-60 font-semibold shadow-[0_2px_0_0_rgba(251,191,36,0.6)]">
            {saving ? 'Saving…' : editingCustomer ? 'Save changes' : 'Save'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="text-center py-10 text-slate-500">Loading...</div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-4 py-3">
          Couldn't load customers: {error}
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow overflow-x-auto border border-slate-100">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-2">Name</th><th>Phone</th><th>Type</th>
                <th>Credit limit</th><th>Balance</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleCustomers.map(c => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-medium text-slate-800">{c.name}</td>
                  <td>{c.phone || '-'}</td>
                  <td className="text-slate-500">{c.customer_type}</td>
                  <td>{fmt(c.credit_limit)}</td>
                  <td className={Number(c.outstanding_balance) > 0 ? 'font-bold text-amber-700' : 'text-slate-500'}>
                    {fmt(c.outstanding_balance)}
                  </td>
                  <td>
                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${c.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {c.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="flex flex-wrap gap-3 py-2 pr-4">
                    <button onClick={() => openEditForm(c)} className="text-emerald-700 text-sm hover:underline">Edit</button>
                    <button onClick={() => openPaymentModal(c)} className="text-amber-700 text-sm hover:underline">Record Payment</button>
                    <button onClick={() => openStatement(c)} className="text-slate-600 text-sm hover:underline">Statement</button>
                    {/* Only offered when there is actually something to
                        chase, and only when the number can be turned
                        into a real wa.me link — a reminder sent to an
                        unparseable number opens a chat with a stranger. */}
                    {Number(c.outstanding_balance) > 0 && (
                      <button
                        onClick={() => handleRemind(c)}
                        disabled={remindingId === c.id || !normalizePhoneForWhatsApp(c.phone)}
                        title={normalizePhoneForWhatsApp(c.phone) ? 'Send a WhatsApp reminder' : 'No usable WhatsApp number on this customer'}
                        className="text-emerald-700 text-sm hover:underline disabled:text-slate-300 disabled:no-underline disabled:cursor-not-allowed"
                      >
                        {remindingId === c.id ? 'Opening…' : 'Remind'}
                      </button>
                    )}
                    <button
                      onClick={() => (c.is_active ? deactivate(c.id) : reactivate(c.id))}
                      className="text-sm text-slate-500 hover:text-red-600"
                    >
                      {c.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
              {visibleCustomers.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">No customers</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Record standalone payment */}
      {payingCustomer && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form onSubmit={submitPayment} className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-5 space-y-3">
            <h3 className="font-bold text-lg text-slate-800">Record Payment</h3>
            <p className="text-sm text-slate-500">
              {payingCustomer.name} — owes <span className="font-bold text-amber-700">{fmt(payingCustomer.outstanding_balance)}</span>
            </p>
            {paymentError && <div className="bg-red-50 text-red-700 text-sm rounded px-3 py-2">{paymentError}</div>}
            <input
              required autoFocus type="number" step="0.01" min="0.01" placeholder="Amount"
              value={paymentForm.amount} onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 focus:border-emerald-700 focus:ring-4 focus:ring-amber-100 outline-none"
            />
            <select
              value={paymentForm.payment_method}
              onChange={e => setPaymentForm({ ...paymentForm, payment_method: e.target.value })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2"
            >
              {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
            </select>
            <input
              placeholder="Reference no. (optional)" value={paymentForm.reference_no}
              onChange={e => setPaymentForm({ ...paymentForm, reference_no: e.target.value })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2"
            />
            <input
              placeholder="Notes (optional)" value={paymentForm.notes}
              onChange={e => setPaymentForm({ ...paymentForm, notes: e.target.value })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2"
            />
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setPayingCustomer(null)} className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-xl">Cancel</button>
              <button type="submit" disabled={payingBusy} className="flex-1 bg-emerald-800 hover:bg-emerald-900 text-white py-2 rounded-xl font-semibold disabled:opacity-60">
                {payingBusy ? 'Saving…' : 'Save Payment'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Statement */}
      {statementCustomer && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl p-5 max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-1">
              <h3 className="font-bold text-lg text-slate-800">{statementCustomer.name} — Statement</h3>
              <button onClick={() => setStatementCustomer(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <p className="text-sm text-slate-500 mb-3">
              Current balance: <span className="font-bold text-amber-700">{fmt(statementCustomer.outstanding_balance)}</span>
            </p>
            <div className="flex-1 overflow-y-auto">
              {statementLoading ? (
                <div className="text-center py-8 text-slate-500">Loading…</div>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500 sticky top-0">
                    <tr><th className="px-2 py-1">Date</th><th>Type</th><th>Amount</th><th>Balance</th></tr>
                  </thead>
                  <tbody>
                    {statementRows.map(r => (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className="px-2 py-1 whitespace-nowrap">{new Date(r.created_at).toLocaleDateString()}</td>
                        <td>{r.transaction_type}{r.notes ? ` — ${r.notes}` : ''}</td>
                        <td className={Number(r.amount) < 0 ? 'text-emerald-700' : 'text-slate-800'}>{fmt(r.amount)}</td>
                        <td className="font-semibold">{fmt(r.balance_after)}</td>
                      </tr>
                    ))}
                    {statementRows.length === 0 && (
                      <tr><td colSpan={4} className="px-2 py-6 text-center text-slate-500">No transactions yet</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
