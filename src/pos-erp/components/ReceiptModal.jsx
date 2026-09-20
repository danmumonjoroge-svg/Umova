// src/pos-erp/components/ReceiptModal.jsx
//
// Shown immediately after a sale completes (POSPage) — the "remaining
// part" of brief section 3's chain (Sale → ... → Receipt). Renders the
// receipt on screen, then hands off to whichever of Print / WhatsApp /
// Email the cashier picks. See services/receiptService.js's header for
// why WhatsApp and Email are both "open the customer's own app" rather
// than a server-side send, and why a walk-in (no saved customer) isn't
// logged the same way a saved customer's send is.
//
// `receipt` accepts either a REAL lb_receipts row (online sale — has a
// server-issued receipt_number) or a SYNTHETIC one shaped the same way
// (offline sale — receipt_number is the LOCAL-SALE-* id, because no
// real receipt row exists until this sale syncs). Nothing in this
// component or receiptService.js needs to know which kind it has; both
// just read `.receipt_number` and `.receipt_data`.
//
// Deliberately NOT using the same "did you press Send?" confirm step
// Messages/Remind buttons use elsewhere in this app: those are for
// periodic, higher-stakes debt-chasing messages where an audit trail of
// "did the owner actually follow through" matters. A receipt fires
// after every single sale — forcing a confirmation click each time
// would add friction to the core till loop many times a day for little
// benefit. A saved customer's receipt WhatsApp send is still logged
// (Prepared → Opened in WhatsApp) and visible in Messages if anyone
// wants to check; it just doesn't block this screen on a confirm click.

import React, { useState } from 'react';
import { Printer, MessageCircle, Mail, X, CheckCircle2, Loader2 } from 'lucide-react';
import { receiptService } from '../services/receiptService';

function fmt(n) { return Number(n || 0).toLocaleString(); }

export default function ReceiptModal({ receipt, business, posSettings, customer, tenantId, businessId, staffId, isOnline, isOffline: isOfflineSale, onClose }) {
  const d = receipt.receipt_data || {};
  const [waPhone, setWaPhone] = useState(customer?.phone || '');
  const [email, setEmail] = useState(customer?.email || '');
  const [busy, setBusy] = useState(null); // 'print' | 'wa' | 'email' | null
  const [waSent, setWaSent] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [err, setErr] = useState('');

  const handlePrint = () => {
    setErr('');
    try {
      receiptService.print(receipt, business, posSettings);
    } catch (e) {
      setErr(e.message);
    }
  };

  const handleWhatsApp = async () => {
    setErr(''); setBusy('wa');
    try {
      const { url } = await receiptService.sendWhatsApp({
        receipt, business, customer, phoneOverride: waPhone, tenantId, businessId, createdBy: staffId,
      });
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      if (!win) throw new Error('Your browser blocked the WhatsApp window. Allow pop-ups for this site.');
      setWaSent(true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  const handleEmail = () => {
    setErr(''); setBusy('email');
    try {
      const link = receiptService.buildEmailLink({ receipt, business, emailOverride: email, customer });
      // An <a> click is more reliable across browsers than setting
      // window.location.href directly for a mailto: link.
      const a = document.createElement('a');
      a.href = link;
      a.click();
      setEmailSent(true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-sm shadow-xl max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="p-5 pb-3 flex items-start justify-between border-b border-slate-100">
          <div>
            <h3 className="font-bold text-lg text-slate-800">Sale Complete</h3>
            <p className="text-xs text-slate-400">Receipt {receipt.receipt_number}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        {isOfflineSale && (
          <div className="mx-5 mt-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2">
            Saved on this device — it'll sync once you're back online. This receipt is still yours to print or share now.
          </div>
        )}

        {/* On-screen preview — a native rendition of receipt_data, not
            the print/HTML builder (that one's for the print window and
            message bodies only). */}
        <div className="px-5 py-3 font-mono text-xs text-slate-700">
          {business?.logo_url && <img src={business.logo_url} alt="" className="max-h-10 mx-auto mb-1" />}
          <div className="text-center font-bold text-sm">{business?.name}</div>
          {business?.phone && <div className="text-center text-slate-400">{business.phone}</div>}
          <div className="border-t border-dashed border-slate-300 my-2" />
          {(d.items || []).map((item, i) => (
            <div key={i} className="flex justify-between py-0.5">
              <span className="truncate pr-2">{item.quantity} x {item.name || 'Item'}</span>
              <span className="shrink-0">{fmt(item.total_price ?? item.quantity * item.unit_price)}</span>
            </div>
          ))}
          <div className="border-t border-dashed border-slate-300 my-2" />
          <div className="flex justify-between"><span>Subtotal</span><span>{fmt(d.subtotal)}</span></div>
          {Number(d.discount_total) > 0 && <div className="flex justify-between text-emerald-700"><span>Discount</span><span>-{fmt(d.discount_total)}</span></div>}
          <div className="flex justify-between font-bold text-sm mt-1"><span>TOTAL</span><span>{fmt(d.total_amount)}</span></div>
        </div>

        {err && <div className="mx-5 mb-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">{err}</div>}

        <div className="p-5 pt-2 space-y-3 border-t border-slate-100">
          <button onClick={handlePrint} className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold py-2.5 rounded-xl">
            <Printer size={15} /> Print
          </button>

          <div className="flex gap-2">
            <input
              type="tel" placeholder="07XX XXX XXX" value={waPhone} onChange={e => setWaPhone(e.target.value)}
              disabled={!isOnline}
              className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2.5 py-2 text-xs disabled:bg-slate-50 disabled:text-slate-400"
            />
            <button
              onClick={handleWhatsApp} disabled={!isOnline || busy === 'wa'}
              title={!isOnline ? 'WhatsApp needs an internet connection' : undefined}
              className="shrink-0 flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-40"
            >
              {busy === 'wa' ? <Loader2 size={13} className="animate-spin" /> : waSent ? <CheckCircle2 size={13} /> : <MessageCircle size={13} />}
              {waSent ? 'Opened' : 'WhatsApp'}
            </button>
          </div>

          <div className="flex gap-2">
            <input
              type="email" placeholder="customer@email.com" value={email} onChange={e => setEmail(e.target.value)}
              className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2.5 py-2 text-xs"
            />
            <button
              onClick={handleEmail} disabled={busy === 'email'}
              className="shrink-0 flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-40"
            >
              {emailSent ? <CheckCircle2 size={13} /> : <Mail size={13} />}
              {emailSent ? 'Opened' : 'Email'}
            </button>
          </div>
          <p className="text-[10px] text-slate-400 -mt-1">
            WhatsApp and Email open your customer's own app with the receipt ready — you'll still need to press Send there.
          </p>

          <button onClick={onClose} className="w-full text-center text-sm text-slate-500 py-1.5">Done</button>
        </div>
      </div>
    </div>
  );
}
