// src/pos-erp/pages/CustomerCommunicationPage.jsx
//
// Phase 7 — customer-facing communication (brief §51-54). Separate from
// pages/CommunicationPage.jsx (internal notifications, already built).
//
// "Queue Message" is the only action here — there is no "Send" that
// pretends to dispatch an SMS/email/WhatsApp. Per the brief: connect a
// real provider later through communicationLogService.js's send() path;
// this page only ever produces QUEUED rows.

import React, { useState } from 'react';
import { MessageSquare, Send, Loader2, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { useTemplates, useCommunicationLog } from '../hooks/useCommunication';
import { useCustomers } from '../hooks/useCustomers';

const STATUS_META = {
  QUEUED: { icon: Clock, color: 'text-slate-400', bg: 'bg-slate-100 text-slate-600' },
  SENT: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-50 text-emerald-700' },
  DELIVERED: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-50 text-emerald-700' },
  FAILED: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50 text-red-700' },
};

export default function CustomerCommunicationPage() {
  const { templates, loading: templatesLoading } = useTemplates();
  const { history, loading: historyLoading, send } = useCommunicationLog();
  const { customers } = useCustomers();

  const [customerId, setCustomerId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [amount, setAmount] = useState('');
  const [sendError, setSendError] = useState('');
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState('');

  const customer = customers.find(c => c.id === customerId);
  const template = templates.find(t => t.id === templateId);

  const updatePreview = (tId, custId, amt) => {
    const t = templates.find(x => x.id === tId);
    const c = customers.find(x => x.id === custId);
    if (!t) { setPreview(''); return; }
    const vars = { customer_name: c?.name || '{{customer_name}}', amount: amt || '{{amount}}', balance: c?.outstanding_balance ?? '{{balance}}' };
    setPreview(t.body.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)));
  };

  const handleQueue = async (e) => {
    e.preventDefault();
    setSendError('');
    if (!customer || !template) { setSendError('Select a customer and a template.'); return; }
    setSending(true);
    try {
      await send({ customer, template, variables: { amount, balance: customer.outstanding_balance } });
      setAmount('');
      setPreview('');
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <MessageSquare size={22} className="text-amber-600" /> Customer Communication
        </h1>
        <p className="text-slate-500 text-sm">
          Message templates and history — queues messages for sending. No SMS/email/WhatsApp provider is connected yet, so messages stay "Queued" until one is.
        </p>
      </div>

      {/* Queue a message */}
      <section className="bg-white border border-slate-200 rounded-2xl p-6">
        <h2 className="font-bold text-slate-800 mb-3">Queue a Message</h2>
        {sendError && <div className="mb-3 bg-red-50 text-red-700 text-sm rounded-xl px-3 py-2">{sendError}</div>}
        <form onSubmit={handleQueue} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select
            value={customerId}
            onChange={e => { setCustomerId(e.target.value); updatePreview(templateId, e.target.value, amount); }}
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm"
          >
            <option value="">Select customer</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select
            value={templateId}
            onChange={e => { setTemplateId(e.target.value); updatePreview(e.target.value, customerId, amount); }}
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm"
          >
            <option value="">Select template</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.message_type.replace('_', ' ')} ({t.channel})</option>)}
          </select>
          <input
            placeholder="Amount (if relevant)"
            value={amount}
            onChange={e => { setAmount(e.target.value); updatePreview(templateId, customerId, e.target.value); }}
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          {preview && (
            <div className="md:col-span-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-600 italic">"{preview}"</div>
          )}
          <button
            type="submit" disabled={sending || !customer || !template}
            className="md:col-span-3 flex items-center justify-center gap-2 bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50 shadow-[0_2px_0_0_rgba(251,191,36,0.6)]"
          >
            <Send size={15} /> {sending ? 'Queuing…' : 'Queue Message'}
          </button>
        </form>
      </section>

      {/* Templates */}
      <section>
        <h2 className="font-bold text-slate-800 mb-3">Templates</h2>
        {templatesLoading ? (
          <div className="text-slate-400 text-sm py-4"><Loader2 size={16} className="animate-spin inline mr-2" /> Loading…</div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
            {templates.map(t => (
              <div key={t.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-800">{t.message_type.replace('_', ' ')} <span className="text-xs font-normal text-slate-400">— {t.channel}</span></div>
                  <div className="text-xs text-slate-500 mt-0.5">{t.body}</div>
                </div>
                <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${t.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>{t.is_active ? 'Active' : 'Inactive'}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* History */}
      <section>
        <h2 className="font-bold text-slate-800 mb-3">Message History</h2>
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-5 py-3">Date</th><th className="text-left px-5 py-3">Customer</th>
                <th className="text-left px-5 py-3">Type</th><th className="text-left px-5 py-3">Message</th><th className="text-center px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {historyLoading && <tr><td colSpan={5} className="text-center py-8 text-slate-400"><Loader2 size={16} className="animate-spin inline mr-2" /> Loading…</td></tr>}
              {!historyLoading && history.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-slate-400">No messages queued yet.</td></tr>}
              {history.map(h => {
                const meta = STATUS_META[h.status] || STATUS_META.QUEUED;
                return (
                  <tr key={h.id}>
                    <td className="px-5 py-3 whitespace-nowrap text-slate-500">{new Date(h.created_at).toLocaleString()}</td>
                    <td className="px-5 py-3 text-slate-700">{h.customer?.name}</td>
                    <td className="px-5 py-3 text-slate-500">{h.message_type.replace('_', ' ')}</td>
                    <td className="px-5 py-3 text-slate-600 max-w-xs truncate">{h.rendered_message}</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${meta.bg}`}>{h.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
