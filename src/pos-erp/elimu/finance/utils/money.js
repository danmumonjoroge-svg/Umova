// Money helpers. Money is handled as INTEGER CENTS in JavaScript and numeric(15,2) in the database - never floating point.
// Amounts arrive from PostgREST as strings ("15000.00") or numbers; parse once here.
export class MoneyError extends Error {}

/** "15,000.50" | 15000.5 | "15000" -> 1500050 (integer cents). Rejects NaN, negatives (unless allowNegative), >2 decimals. */
export function toCents(value, { allowNegative = false } = {}) {
  if (value === null || value === undefined || value === '') throw new MoneyError('Enter an amount.');
  let s = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : String(value).replace(/[,\s]/g, '').replace(/^KES/i, '');
  if (/e/i.test(s)) throw new MoneyError('Enter the amount as a plain number.');
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new MoneyError('That is not a valid amount.');
  const [, neg, whole, frac = ''] = m;
  if (frac.length > 2 && /[1-9]/.test(frac.slice(2))) throw new MoneyError('An amount can have at most two decimal places.');
  const cents = BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new MoneyError('That amount is too large.');
  const n = Number(cents) * (neg ? -1 : 1);
  if (n < 0 && !allowNegative) throw new MoneyError('The amount cannot be negative.');
  return n;
}
/** integer cents -> "15000.50" (what the database RPCs accept). */
export function toDecimalString(cents) {
  const neg = cents < 0; const a = Math.abs(cents);
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}
export const fromDb = (v) => toCents(v ?? 0, { allowNegative: true });
export function formatMoney(cents, currency = 'KES') {
  const neg = cents < 0; const a = Math.abs(cents);
  const whole = Math.floor(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = a % 100 ? '.' + String(a % 100).padStart(2, '0') : '';
  return `${neg ? '-' : ''}${currency} ${whole}${frac}`;
}
export const sumCents = (arr) => arr.reduce((s, x) => s + x, 0);
/** Percentage of an amount, rounded half-up to the cent (matches round(x*p/100, 2) in SQL). */
export function percentOf(cents, percent) {
  const p = Math.round(Number(percent) * 10000); // 4 dp, like the DB
  return Math.floor((cents * p + 500000) / 1000000);
}
