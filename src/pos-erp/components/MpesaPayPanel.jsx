// src/pos-erp/components/MpesaPayPanel.jsx
//
// What the cashier sees once "M-Pesa" is picked at the till: ONE compact section.
//
//   [ M-Pesa transaction code ........ ] [ Prompt ]
//   one short status line
//
//  - The code field always works. Typing the SMS code is the "already paid" path: it needs no Daraja setup and
//    no internet (an offline sale is queued and checked against the server when it syncs).
//  - Prompt sends an STK Push through the existing secure backend. It is the only thing that depends on Daraja,
//    so when Daraja is missing / switched off / offline, only Prompt is unavailable (with one line saying why).
//  - After Safaricom's trusted confirmation the code field fills itself with the REAL M-Pesa receipt code and
//    locks. Nothing here ever decides that a payment succeeded: it only shows what the callback wrote.
//
// Setup and records live under My Money -> M-Pesa; this panel only links there when setup is missing.

import React from 'react';
import { Link } from 'react-router-dom';
import { Send, Loader2, CheckCircle2, WifiOff, Info } from 'lucide-react';
import { normalizeMpesaCode, isValidMpesaCode, mpesaPanelState } from '../utils/mpesa';
import { mpesaService } from '../services/mpesaService';
import { usePermissions } from '../navigation/PermissionsContext';

export default function MpesaPayPanel({
  code, onCodeChange,
  phone, onPhoneChange, phoneFromCustomer,
  total, isOnline, config, phase, txStatus, onPrompt, error, businessId, connectionIssue, onCheck,
}) {
  // Payments customers already sent to the till (phase43), so the cashier taps "Joy 3,000 SHK7X9ABCD" instead of typing the code.
  // Best effort: offline, switched off, or no permission just means no list; typing the code always works.
  const { can } = usePermissions();
  const mayReceive = can('payments.record');
  const [received, setReceived] = React.useState([]);
  React.useEffect(() => {
    if (!businessId || !isOnline || !mayReceive || !config?.c2b_enabled) { setReceived([]); return undefined; }
    let live = true;
    mpesaService.c2bList(businessId, { status: 'OPEN', limit: 12 }).then((r) => { if (live) setReceived(r); }).catch(() => { if (live) setReceived([]); });
    return () => { live = false; };
  }, [businessId, isOnline, config?.c2b_enabled, mayReceive]);

  const hasPhone = !!String(phone || '').trim();
  const whole = Math.abs(Number(total) - Math.round(Number(total))) < 0.005;
  const { stkStatus, promptDisabledReason, message } = mpesaPanelState({ isOnline, config, phase, whole, hasPhone, txStatus });

  const paid = phase === 'paid';
  const busy = phase === 'sending' || phase === 'pending';
  const codeTouched = code.length > 0;
  const codeOk = isValidMpesaCode(code);
  // Phone is asked for only when a prompt is possible and the customer record does not already supply one.
  const askPhone = stkStatus === 'ready' && !phoneFromCustomer && !paid;
  // Prompt stays tappable when the only thing missing is the phone number, so the click can say so.
  const promptBlocked = promptDisabledReason && promptDisabledReason !== 'no_phone';

  const uncertain = phase === 'failed' && (txStatus === 'TIMED_OUT' || txStatus === 'NEEDS_ATTENTION');
  const tone = paid ? 'text-[#1B5138]' : uncertain ? 'text-[#7a5f1f]' : phase === 'failed' ? 'text-red-600'
    : stkStatus === 'offline' ? 'text-[#7a5f1f]' : 'text-[#68756D]';

  return (
    <div className="mb-3 rounded-xl border border-[#DDE3DD] bg-[#F7F6F0] p-3 space-y-2" data-testid="mpesa-panel">
      <label htmlFor="mpesa-code" className="text-xs font-semibold text-[#68756D] block">M-Pesa transaction code</label>

      <div className="flex gap-2">
        <div className="relative flex-1 min-w-0">
          <input
            id="mpesa-code"
            type="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={12}
            placeholder="e.g. SHK7X9ABCD"
            value={code} readOnly={paid || busy} disabled={busy}
            onChange={(e) => onCodeChange(normalizeMpesaCode(e.target.value))}
            aria-invalid={codeTouched && !codeOk && !paid}
            className={`w-full min-w-0 border bg-white rounded-lg px-3 py-3 text-base font-mono tracking-wider ${
              paid ? 'border-[#237A52] bg-[#237A52]/5 pr-9' : codeTouched && !codeOk ? 'border-red-400' : 'border-[#DDE3DD]'
            } disabled:opacity-60`}
          />
          {paid && <CheckCircle2 size={18} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#237A52]" aria-label="Confirmed" />}
        </div>
        <button
          type="button" onClick={onPrompt} disabled={!!promptBlocked}
          className="shrink-0 min-h-[48px] px-4 rounded-lg bg-[#237A52] hover:bg-[#1B5138] text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Prompt
        </button>
      </div>

      {received.length > 0 && !paid && !busy && (
        <div className="-mx-1 px-1 overflow-x-auto flex gap-1.5 pb-0.5" aria-label="Payments already received">
          {received.map((r) => {
            const match = Math.abs(Number(r.amount) - Number(r.amount_used) - Number(total)) < 0.005;
            return (
              <button key={r.id} type="button" onClick={() => onCodeChange(r.trans_id)}
                className={`shrink-0 text-left rounded-lg border px-2.5 py-1.5 ${code === r.trans_id ? 'border-[#237A52] bg-[#237A52]/10' : match ? 'border-[#C9A227] bg-[#FBF3D5]' : 'border-[#DDE3DD] bg-white'}`}>
                <span className="block text-[12px] font-bold text-[#23382B] whitespace-nowrap">{(r.payer_name || 'Received').split(' ')[0]} · {Number(r.amount - r.amount_used).toLocaleString()}</span>
                <span className="block text-[10.5px] font-mono text-[#68756D]">{r.trans_id}</span>
              </button>
            );
          })}
        </div>
      )}

      {askPhone && (
        <input
          type="tel" inputMode="tel" autoComplete="off" placeholder="Buyer's M-Pesa number, 07XX XXX XXX"
          aria-label="Buyer's M-Pesa number"
          value={phone} onChange={(e) => onPhoneChange(e.target.value)} disabled={busy}
          className="w-full min-w-0 border border-[#DDE3DD] bg-white rounded-lg px-3 py-3 text-base"
        />
      )}

      <p className={`text-[11px] leading-snug flex gap-1.5 ${tone}`} role="status" aria-live="polite">
        {stkStatus === 'offline' ? <WifiOff size={12} className="shrink-0 mt-0.5" /> : <Info size={12} className="shrink-0 mt-0.5" />}
        <span>
          {error ? error
            : codeTouched && !codeOk && !paid ? 'A code is 8 to 12 letters and numbers, like SHK7X9ABCD.'
            : message}
          {!paid && !busy && !error && codeOk && ` Check the SMS shows KES ${Number(total || 0).toLocaleString()}.`}
        </span>
      </p>

      {busy && phase === 'pending' && (
        <p className="text-[11px] text-[#68756D] leading-snug">
          {connectionIssue ? 'Having trouble reaching the server. The payment is not lost. ' : 'Buyer has approved but nothing changed? '}
          <button type="button" onClick={() => onCheck && onCheck()} className="text-[#237A52] font-semibold underline">Check now</button>
        </p>
      )}

      {stkStatus === 'not_setup' && (
        <p className="text-[11px] text-[#68756D] leading-snug">
          <Link to="/pos/mpesa" className="text-[#237A52] font-semibold underline">Set up M-Pesa prompts</Link> under My Money.
        </p>
      )}
    </div>
  );
}
