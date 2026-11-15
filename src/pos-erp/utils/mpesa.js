// src/pos-erp/utils/mpesa.js
//
// Small, pure helpers for the M-Pesa payment mode at the till.

/** M-Pesa confirmation codes look like "SHK7X9ABCD": 10 letters/digits, uppercase. Accept 8-12 to be forgiving of format changes. */
export function normalizeMpesaCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidMpesaCode(raw) {
  return /^[A-Z0-9]{8,12}$/.test(normalizeMpesaCode(raw));
}

/** 0712345678 -> "0712 *** 678" -- enough for a cashier to confirm the right number without printing all of it on screen. */
export function maskPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  const local = d.startsWith('254') ? `0${d.slice(3)}` : d;
  if (local.length < 9) return raw || '';
  return `${local.slice(0, 4)} *** ${local.slice(-3)}`;
}

/** STK Push charges whole shillings only (the Edge Function rounds). A cart total with cents would charge a different amount than the sale records. */
export function isWholeShillings(amount) {
  return Math.abs(Number(amount) - Math.round(Number(amount))) < 0.005;
}

/**
 * Which M-Pesa ways are open RIGHT NOW. "Already paid" (the cashier types the SMS code) needs NO setup, NO internet and
 * NO Daraja account: it is always available. "Send prompt" (STK push) needs internet AND M-Pesa set up for the business.
 * When a prompt is not possible the till quietly uses "Already paid".
 * @param {{isOnline: boolean, config: object|null|undefined, chosenMode?: 'PROMPT'|'MANUAL'}} a  config: undefined = still checking, null = none saved
 */
export function resolveMpesa({ isOnline, config, chosenMode = 'PROMPT' }) {
  const stkConfigured = !!(config?.is_active && config.has_consumer_key && config.has_consumer_secret && config.has_passkey);
  const stkStatus = !isOnline ? 'offline' : config === undefined ? 'checking' : stkConfigured ? 'ready' : 'not_setup';
  return { stkStatus, effectiveMode: stkStatus === 'ready' ? chosenMode : 'MANUAL' };
}

/**
 * What the single M-Pesa section on the till shows. M-Pesa itself is ALWAYS selectable and the code field ALWAYS works
 * (manual recording needs no Daraja, no internet). Only the Prompt button depends on Daraja, and this says why it is
 * unavailable in one short line. `promptDisabledReason` is null exactly when a prompt can be sent.
 *
 * @param {{isOnline: boolean, config: object|null|undefined, phase?: string, whole?: boolean, hasPhone?: boolean}} a
 *   phase: the useMpesaPayment() phase ('idle'|'sending'|'pending'|'paid'|'failed')
 */
export function mpesaPanelState({ isOnline, config, phase = 'idle', whole = true, hasPhone = true, txStatus = null }) {
  const { stkStatus } = resolveMpesa({ isOnline, config });
  let promptDisabledReason = null;
  if (phase === 'sending' || phase === 'pending') promptDisabledReason = 'busy';
  else if (phase === 'paid') promptDisabledReason = 'paid';
  // No answer from the buyer is NOT the same as "did not pay": a late confirmation can still arrive. Sending a
  // second prompt now could charge the buyer twice, so it stays off until the first one is settled or set aside.
  else if (phase === 'failed' && (txStatus === 'TIMED_OUT' || txStatus === 'NEEDS_ATTENTION')) promptDisabledReason = 'uncertain';
  else if (stkStatus === 'offline') promptDisabledReason = 'offline';
  else if (stkStatus === 'checking') promptDisabledReason = 'checking';
  else if (stkStatus === 'not_setup') promptDisabledReason = 'not_setup';
  else if (!whole) promptDisabledReason = 'cents';
  else if (!hasPhone) promptDisabledReason = 'no_phone';

  const message = {
    sending: 'Sending prompt…',
    pending: 'Waiting for the buyer to approve on their phone…',
    paid: 'Payment confirmed by M-Pesa.',
    failed: 'Payment failed. You can enter a manual M-Pesa code.',
    cancelled: 'The buyer cancelled. Send the prompt again, or enter a manual M-Pesa code.',
    uncertain: 'No answer yet. If the buyer says they paid, enter the code from their SMS. A late confirmation will still be recorded.',
    offline: 'Prompts need internet. You can still record a manual M-Pesa payment.',
    not_setup: 'M-Pesa prompts are unavailable. You can still record a manual M-Pesa payment.',
    checking: 'Checking M-Pesa prompts…',
    cents: 'Prompts work in whole shillings. Adjust the total, or enter the code.',
    no_phone: 'Enter the buyer\'s phone number to send a prompt.',
    idle: 'Enter the M-Pesa transaction code, or send a prompt.',
  };
  const key = promptDisabledReason === 'uncertain' ? 'uncertain'
    : phase === 'failed' && txStatus === 'CANCELLED' ? 'cancelled'
    : phase === 'sending' || phase === 'pending' || phase === 'paid' || phase === 'failed' ? phase
    : promptDisabledReason && promptDisabledReason !== 'checking' ? promptDisabledReason : 'idle';
  return { stkStatus, promptDisabledReason, message: message[key] };
}

/** Receipt wording for a payment line: "M-Pesa SHK7X9ABCD", "Cash", "Card". */
export function paymentLabel(p) {
  const m = String(p?.payment_method || '');
  if (m === 'MOBILE_MONEY') return p.reference_no ? `M-Pesa ${normalizeMpesaCode(p.reference_no)}` : 'M-Pesa';
  return m.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}
