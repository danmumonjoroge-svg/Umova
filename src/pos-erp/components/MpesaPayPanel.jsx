// src/pos-erp/components/MpesaPayPanel.jsx
//
// What the cashier sees once "M-Pesa" is picked as the payment method at
// the till. M-Pesa is a PAYMENT MODE first (like Cash or Card), with two
// ways to collect it:
//
//   1. Send prompt   -- STK Push: the buyer gets an M-Pesa pop-up on their
//                       phone and enters their PIN. The sale is created
//                       only after Safaricom confirms (never on "sent").
//                       Needs internet + M-Pesa set up for the business.
//   2. Already paid  -- the buyer paid your till/paybill themselves; the
//                       cashier types the code from the SMS. Works fully
//                       offline (recorded like any other sale and synced
//                       later).
//
// Setup/records are NOT here -- they live under My Money -> M-Pesa. This
// panel only links there when something is missing.

import React from 'react';
import { Link } from 'react-router-dom';
import { Send, ReceiptText, WifiOff, Info } from 'lucide-react';
import { normalizeMpesaCode, isValidMpesaCode } from '../utils/mpesa';

export default function MpesaPayPanel({
  mode, onModeChange, phone, onPhoneChange, code, onCodeChange,
  total, isOnline, stkStatus, // stkStatus: 'ready' | 'offline' | 'not_setup' | 'checking'
}) {
  const promptReady = stkStatus === 'ready';
  const promptHint = {
    offline: 'Needs internet',
    not_setup: 'Not set up yet',
    checking: 'Checking…',
    ready: 'Buyer approves on their phone',
  }[stkStatus];

  const codeTouched = code.length > 0;
  const codeOk = isValidMpesaCode(code);

  const Option = ({ value, icon: Icon, title, hint, disabled }) => {
    const active = mode === value;
    return (
      <button
        type="button" disabled={disabled} onClick={() => onModeChange(value)}
        aria-pressed={active}
        className={`flex-1 min-w-0 text-left rounded-xl border p-3 min-h-[64px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          active ? 'border-[#237A52] bg-[#237A52]/10' : 'border-[#DDE3DD] bg-white hover:bg-[#F7F6F0]'
        }`}
      >
        <div className={`flex items-center gap-1.5 text-sm font-semibold ${active ? 'text-[#1B5138]' : 'text-[#26352D]'}`}>
          <Icon size={15} className="shrink-0" /> <span className="truncate">{title}</span>
        </div>
        <div className="text-[11px] text-[#68756D] mt-0.5 leading-tight">{hint}</div>
      </button>
    );
  };

  return (
    <div className="mb-3 rounded-xl border border-[#DDE3DD] bg-[#F7F6F0] p-3 space-y-3">
      <div className="flex gap-2">
        <Option value="PROMPT" icon={Send} title="Send prompt" hint={promptHint} disabled={!promptReady} />
        <Option value="MANUAL" icon={ReceiptText} title="Already paid" hint="Enter the M-Pesa code" />
      </div>

      {mode === 'PROMPT' && promptReady && (
        <div>
          <label className="text-xs font-semibold text-[#68756D] block mb-1">Buyer's M-Pesa number</label>
          <input
            type="tel" inputMode="tel" autoComplete="off" placeholder="07XX XXX XXX"
            value={phone} onChange={(e) => onPhoneChange(e.target.value)}
            className="w-full min-w-0 border border-[#DDE3DD] bg-white rounded-lg px-3 py-3 text-base"
          />
          <p className="text-[11px] text-[#68756D] mt-1.5 flex gap-1.5 leading-snug">
            <Info size={12} className="shrink-0 mt-0.5" />
            The buyer gets a pop-up for KES {Number(total || 0).toLocaleString()} and enters their PIN. The sale is only completed once M-Pesa confirms it.
          </p>
        </div>
      )}

      {mode === 'MANUAL' && (
        <div>
          <label className="text-xs font-semibold text-[#68756D] block mb-1">M-Pesa code from the SMS</label>
          <input
            type="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={12}
            placeholder="e.g. SHK7X9ABCD"
            value={code} onChange={(e) => onCodeChange(normalizeMpesaCode(e.target.value))}
            className={`w-full min-w-0 border bg-white rounded-lg px-3 py-3 text-base font-mono tracking-wider ${
              codeTouched && !codeOk ? 'border-red-400' : 'border-[#DDE3DD]'
            }`}
          />
          <p className="text-[11px] text-[#68756D] mt-1.5 flex gap-1.5 leading-snug">
            <Info size={12} className="shrink-0 mt-0.5" />
            {codeTouched && !codeOk
              ? 'A code is 8 to 12 letters and numbers, like SHK7X9ABCD.'
              : `Check the SMS shows KES ${Number(total || 0).toLocaleString()} before you complete the sale.`}
          </p>
        </div>
      )}

      {/* Prompt not available -> say why, and point to where it gets fixed. */}
      {stkStatus === 'offline' && (
        <p className="text-[11px] text-[#7a5f1f] flex gap-1.5 leading-snug">
          <WifiOff size={12} className="shrink-0 mt-0.5" />
          No internet, so a prompt can't be sent. Record the M-Pesa code instead; it is saved and sent when you are back online.
        </p>
      )}
      {stkStatus === 'not_setup' && (
        <p className="text-[11px] text-[#68756D] leading-snug">
          Want to send prompts to buyers? <Link to="/pos/mpesa" className="text-[#237A52] font-semibold underline">Set up M-Pesa</Link> under My Money.
        </p>
      )}
    </div>
  );
}
