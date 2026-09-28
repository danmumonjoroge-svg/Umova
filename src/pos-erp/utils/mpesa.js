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
