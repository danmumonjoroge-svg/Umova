// src/pos-erp/components/MpesaPromptModal.jsx
//
// The "waiting for the buyer" screen after a prompt is sent. Never says
// Paid until the status the hook reports is 'paid' (which only happens on
// a real callback -- see useMpesaPayment.js).
//
// Decisions worth knowing:
//  - While a request is pending there is NO "customer paid another way"
//    shortcut: switching to a manual sale while the prompt is still live
//    could take the same money twice. The cashier can Hide this screen
//    (the request stays alive, a banner remains on the till) or check
//    status. If the request fails / times out / is cancelled, THEN Try
//    again or Use a code are offered.
//  - A small elapsed timer, and a status re-check every few seconds as a
//    safety net in case realtime doesn't deliver on a poor connection.

import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { maskPhone } from '../utils/mpesa';

export default function MpesaPromptModal({ mpesa, total, phone, onDone, onHide, onRetry, onUseCode }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (mpesa.phase !== 'pending') { setElapsed(0); return undefined; }
    const tick = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, [mpesa.phase]);

  // Safety-net poll (realtime is the primary path).
  useEffect(() => {
    if (mpesa.phase !== 'pending') return undefined;
    const poll = setInterval(() => { mpesa.refresh().catch(() => {}); }, 6000);
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mpesa.phase, mpesa.transaction?.id]);

  const status = mpesa.transaction?.status;
  const failedTitle = status === 'CANCELLED' ? 'Buyer cancelled the payment'
    : status === 'TIMED_OUT' ? 'No response from the buyer'
    : 'The payment did not go through';

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center sm:p-4">
      <div
        className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-xl shadow-xl p-5 text-center max-h-[92vh] overflow-y-auto"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
      >
        <h3 className="font-bold text-lg text-[#26352D]">M-Pesa payment</h3>
        <p className="text-sm text-[#68756D] mb-1">Amount <span className="font-bold text-[#26352D]">KES {Number(total || 0).toLocaleString()}</span></p>
        {phone && <p className="text-xs text-[#68756D] mb-3">to {maskPhone(phone)}</p>}

        {mpesa.phase === 'sending' && (
          <div className="py-6 text-sm text-[#68756D] flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Sending the prompt…</div>
        )}

        {mpesa.phase === 'pending' && (
          <div className="py-4">
            <Loader2 size={30} className="animate-spin text-[#C6A15B] mx-auto mb-2" />
            <div className="font-semibold text-[#26352D]">Waiting for the buyer…</div>
            <p className="text-sm text-[#68756D] mt-1">Ask them to check their phone and enter their M-Pesa PIN.</p>
            <p className="text-xs text-[#68756D] mt-2 tabular-nums">Waiting {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</p>
            {elapsed >= 60 && (
              <p className="text-xs text-[#7a5f1f] mt-2 leading-snug">Taking long? The buyer may have missed the pop-up. If it times out you can send it again.</p>
            )}
            <button onClick={() => mpesa.refresh()} className="mt-3 text-sm font-semibold text-[#237A52] underline min-h-[44px]">Check status now</button>
          </div>
        )}

        {mpesa.phase === 'paid' && (
          <div className="py-4">
            <CheckCircle2 size={40} className="text-[#237A52] mx-auto mb-1" />
            <p className="font-bold text-[#237A52] text-lg">Payment received</p>
            {mpesa.transaction?.mpesa_receipt_number && (
              <p className="text-xs text-[#68756D] mt-1 font-mono">M-Pesa code {mpesa.transaction.mpesa_receipt_number}</p>
            )}
          </div>
        )}

        {mpesa.phase === 'failed' && (
          <div className="py-4">
            <XCircle size={36} className="text-red-500 mx-auto mb-1" />
            <p className="font-semibold text-red-600">{failedTitle}</p>
            {mpesa.transaction?.result_desc && <p className="text-xs text-[#68756D] mt-1">{mpesa.transaction.result_desc}</p>}
            <p className="text-xs text-[#68756D] mt-2">Nothing was charged and the sale is still open.</p>
          </div>
        )}

        {mpesa.error && <p className="text-sm text-red-600 py-2">{mpesa.error}</p>}

        <div className="mt-2 space-y-2">
          {mpesa.phase === 'paid' && (
            <button onClick={onDone} className="w-full min-h-[48px] bg-[#237A52] hover:bg-[#1B5138] text-white font-semibold rounded-xl">Done</button>
          )}
          {mpesa.phase === 'failed' && (
            <>
              <button onClick={onRetry} className="w-full min-h-[48px] bg-[#237A52] hover:bg-[#1B5138] text-white font-semibold rounded-xl">Send the prompt again</button>
              <button onClick={onUseCode} className="w-full min-h-[48px] bg-white border border-[#DDE3DD] text-[#26352D] font-semibold rounded-xl">Buyer paid another way: enter code</button>
              <button onClick={onDone} className="w-full min-h-[44px] text-sm text-[#68756D]">Close</button>
            </>
          )}
          {mpesa.phase === 'pending' && (
            <button onClick={onHide} className="w-full min-h-[48px] bg-white border border-[#DDE3DD] text-[#26352D] font-semibold rounded-xl">Hide (keep waiting)</button>
          )}
          {mpesa.phase === 'sending' && (
            <button disabled className="w-full min-h-[48px] bg-[#F7F6F0] text-[#68756D] rounded-xl opacity-60">Please wait…</button>
          )}
        </div>
      </div>
    </div>
  );
}
