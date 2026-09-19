// src/pos-erp/pages/CustomerCommunicationPage.jsx
//
// Messages (brief §15) — customer-facing communication. Separate from
// pages/CommunicationPage.jsx (internal notifications, already built).
//
// Two channels behave differently here, and the difference is the point:
//
//   SMS / EMAIL  — no provider is connected. Saving writes a QUEUED row
//                  and stops. Nothing is sent.
//   WHATSAPP     — no provider is NEEDED (§16). Umova renders the
//                  message, opens wa.me, and the owner presses Send
//                  inside WhatsApp themselves.
//
// §16's three WhatsApp states are tracked and shown apart from each
// other, and none of them is ever shown as "Delivered":
//   Prepared → Opened in WhatsApp → Sent by you (owner-attested)
//
// Offline note: preparing a message still writes to Supabase today, so
// it needs internet like everything else. §23's "prepare offline, open
// online" split arrives with the Stage 1B offline work, not here.

import React, { useState } from 'react';
import { MessageSquare, Send, Loader2, Clock, CheckCircle2, XCircle, ExternalLink, AlertTriangle } from 'lucide-react';
import { useTemplates, useCommunicationLog } from '../hooks/useCommunication';
import { useCustomers } from '../hooks/useCustomers';
import { normalizePhoneForWhatsApp } from '../services/communicationService';

// Owner-facing wording, per §1. "Sent by you" rather than "Sent" on
// WhatsApp is deliberate — we know the owner said they pressed Send; we
// do not know WhatsApp delivered it, and §43 forbids implying we do.
function statusMeta(row) {
  const isWhatsApp = row.channel === 'WHATSAPP';
  switch (row.status) {
    case 'OPENED':
      return { label: 'Opened in WhatsApp', bg: 'bg-amber-50 text-amber-700', Icon: ExternalLink };
    case 'SENT':
      return { label: isWhatsApp ? 'Sent by you' : 'Sent', bg: 'bg-emerald-50 text-emerald-700', Icon: CheckCircle2 };
    case 'DELIVERED':
      return { label: 'Delivered', bg: 'bg-emerald-50 text-emerald-700', Icon: CheckCircle2 };
    case 'FAILED':
      return { label: 'Failed', bg: 'bg-red-50 text-red-700', Icon: XCircle };
    default:
      return { label: 'Prepared', bg: 'bg-slate-100 text-slate-600', Icon: Clock };
  }
}

export default function CustomerCommunicationPage() {
  const { templates, loading: templatesLoading } = useTemplates();
  const { history, loading: historyLoading, send, prepareWhatsApp, markOpened, markSent, markNotSent } = useCommunicationLog();
  const { customers } = useCustomers();

  const [customerId, setCustomerId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [amount, setAmount] = useState('');
  const [sendError, setSendError] = useState('');
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState('');
  // The message we just opened WhatsApp for, awaiting the owner's answer.
  const [awaitingConfirm, setAwaitingConfirm] = useState(null);

  const customer = customers.find(c => c.id === customerId);
  const template = templates.find(t => t.id === templateId);
  const isWhatsApp = template?.channel === 'WHATSAPP';
  const waPhone = customer ? normalizePhoneForWhatsApp(customer.phone) : null;

  const updatePreview = (tId, custId, amt) => {
    const t = templates.find(x => x.id === tId);
    const c = customers.find(x => x.id === custId);
    if (!t) { setPreview(''); return; }
    const vars = { customer_name: c?.name || '{{customer_name}}', amount: amt || '{{amount}}', balance: c?.outstanding_balance ?? '{{balance}}' };
    setPreview(t.body.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)));
  };

  const resetForm = () => { setAmount(''); setPreview(''); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSendError('');
    if (!customer || !template) { setSendError('Select a customer and a message.'); return; }
    setSending(true);
    try {
      if (isWhatsApp) {
        const { log, url } = await prepareWhatsApp({ customer, template, variables: { amount, balance: customer.outstanding_balance } });
        // Opened in a new tab, not the same one — losing the POS page
        // mid-shift to a WhatsApp Web redirect would be worse than a
        // pop-up warning. If the browser blocks it, the history row's
        // own "Open WhatsApp" button is the fallback.
        const win = window.open(url, '_blank', 'noopener,noreferrer');
        if (win) {
          await markOpened(log.id);
          setAwaitingConfirm(log.id);
        } else {
          setSendError('Your browser blocked the WhatsApp window. The message is prepared — use "Open WhatsApp" on its row below.');
        }
        resetForm();
      } else {
        await send({ customer, template, variables: { amount, balance: customer.outstanding_balance } });
        resetForm();
      }
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  };

  // Re-open a message that was prepared but never opened (or opened and
  // not sent). Rebuilds the link from what was actually logged, so it
  // can't drift from the message the history shows.
  const reopen = async (row) => {
    setSendError('');
    const phone = normalizePhoneForWhatsApp(row.recipient);
    if (!phone) { setSendError('That message has no usable WhatsApp number on it.'); return; }
    const win = window.open(`https://wa.me/${phone}?text=${encodeURIComponent(row.rendered_message)}`, '_blank', 'noopener,noreferrer');
    if (!win) { setSendError('Your browser blocked the WhatsApp window. Allow pop-ups for this site.'); return; }
    try {
      await markOpened(row.id);
      setAwaitingConfirm(row.id);
    } catch (err) { setSendError(err.message); }
  };

  const confirmSent = async (id, didSend) => {
    try {
      await (didSend ? markSent(id) : markNotSent(id));
    } catch (err) {
      setSendError(err.message);
    } finally {
      setAwaitingConfirm(null);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <MessageSquare size={22} className="text-amber-600" /> Messages
        </h1>
        <p className="text-slate-500 text-sm">
          Send a customer a WhatsApp message — Umova writes it, you press Send in WhatsApp. SMS and email messages are only saved for now; no SMS or email provider is connected yet.
        </p>
      </div>

      {/* Compose */}
      <section className="bg-white border border-slate-200 rounded-2xl p-6">
        <h2 className="font-bold text-slate-800 mb-3">Write a Message</h2>
        {sendError && <div className="mb-3 bg-red-50 text-red-700 text-sm rounded-xl px-3 py-2">{sendError}</div>}
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
            <option value="">Select message</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.message_type.replace(/_/g, ' ')} ({t.channel === 'WHATSAPP' ? 'WhatsApp' : t.channel})</option>)}
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

          {/* Caught before the owner presses the button, not after — a
              wa.me link built from a bad number opens a chat with a
              stranger, and nothing here would be able to tell. */}
          {isWhatsApp && customer && !waPhone && (
            <div className="md:col-span-3 flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl px-4 py-3">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                {customer.name} has no usable WhatsApp number{customer.phone ? ` (${customer.phone})` : ''}. Add a Kenyan mobile number like 0712345678 on the customer first.
              </span>
            </div>
          )}

          <button
            type="submit" disabled={sending || !customer || !template || (isWhatsApp && !waPhone)}
            className="md:col-span-3 flex items-center justify-center gap-2 bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50 shadow-[0_2px_0_0_rgba(251,191,36,0.6)]"
          >
            {isWhatsApp ? <ExternalLink size={15} /> : <Send size={15} />}
            {sending ? 'Working…' : isWhatsApp ? 'Open in WhatsApp' : 'Save Message'}
          </button>

          {isWhatsApp && (
            <p className="md:col-span-3 text-xs text-slate-400 text-center">
              WhatsApp opens with the message ready. You still have to press Send there — Umova cannot send it for you.
            </p>
          )}
        </form>

        {/* §16: we know we opened WhatsApp. We do not know the owner sent
            anything. Ask, rather than assume. */}
        {awaitingConfirm && (
          <div className="mt-4 flex flex-wrap items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <span className="text-sm text-amber-900 font-semibold">Did you press Send in WhatsApp?</span>
            <button type="button" onClick={() => confirmSent(awaitingConfirm, true)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-800 text-white hover:bg-emerald-900">Yes, I sent it</button>
            <button type="button" onClick={() => confirmSent(awaitingConfirm, false)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50">Not yet</button>
          </div>
        )}
      </section>

      {/* Templates */}
      <section>
        <h2 className="font-bold text-slate-800 mb-3">Message Wording</h2>
        {templatesLoading ? (
          <div className="text-slate-400 text-sm py-4"><Loader2 size={16} className="animate-spin inline mr-2" /> Loading…</div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
            {templates.map(t => (
              <div key={t.id} className="px-5 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800">
                    {t.message_type.replace(/_/g, ' ')}{' '}
                    <span className="text-xs font-normal text-slate-400">— {t.channel === 'WHATSAPP' ? 'WhatsApp' : t.channel}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">{t.body}</div>
                </div>
                <span className={`shrink-0 text-[11px] font-bold px-2 py-1 rounded-full ${t.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>{t.is_active ? 'Active' : 'Inactive'}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* History */}
      <section>
        <h2 className="font-bold text-slate-800 mb-3">Messages</h2>
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-5 py-3">Date</th><th className="text-left px-5 py-3">Customer</th>
                <th className="text-left px-5 py-3">Type</th><th className="text-left px-5 py-3">Message</th>
                <th className="text-center px-5 py-3">Status</th><th className="text-right px-5 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {historyLoading && <tr><td colSpan={6} className="text-center py-8 text-slate-400"><Loader2 size={16} className="animate-spin inline mr-2" /> Loading…</td></tr>}
              {!historyLoading && history.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-slate-400">No messages yet.</td></tr>}
              {history.map(h => {
                const meta = statusMeta(h);
                const canReopen = h.channel === 'WHATSAPP' && h.status !== 'SENT';
                return (
                  <tr key={h.id}>
                    <td className="px-5 py-3 whitespace-nowrap text-slate-500">{new Date(h.created_at).toLocaleString()}</td>
                    {/* Phase 10: this history table is shared with supplier
                        reminders sent from Payables (same lb_communication_log),
                        so a row may have a supplier instead of a customer. */}
                    <td className="px-5 py-3 text-slate-700">{h.customer?.name || h.supplier?.name}</td>
                    <td className="px-5 py-3 text-slate-500 whitespace-nowrap">
                      {h.message_type.replace(/_/g, ' ')}
                      <span className="block text-[11px] text-slate-400">{h.channel === 'WHATSAPP' ? 'WhatsApp' : h.channel}</span>
                    </td>
                    <td className="px-5 py-3 text-slate-600 max-w-xs truncate">{h.rendered_message}</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full whitespace-nowrap ${meta.bg}`}>
                        <meta.Icon size={11} /> {meta.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      {canReopen && (
                        <div className="inline-flex gap-2">
                          <button type="button" onClick={() => reopen(h)} className="text-xs font-bold px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-emerald-800 hover:bg-emerald-50">
                            Open WhatsApp
                          </button>
                          {h.status === 'OPENED' && (
                            <button type="button" onClick={() => confirmSent(h.id, true)} className="text-xs font-bold px-2.5 py-1.5 rounded-lg bg-emerald-800 text-white hover:bg-emerald-900">
                              I sent it
                            </button>
                          )}
                        </div>
                      )}
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
