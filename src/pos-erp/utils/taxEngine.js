// src/pos-erp/utils/taxEngine.js
//
// KRA eTIMS (Phase 2): the ONE place that works out tax for a sale line.
//
// What it does NOT contain, on purpose: any tax rate, any tax code, any KRA category. Those come from KRA's own code lists
// (lb_etims_code_lists, synced in Phase 3) and the product's mapping (lb_etims_item_map). This file only does arithmetic on
// whatever rate it is handed, so it cannot drift from KRA's tables.
//
// Pricing model (the default, owner-confirmed per business): prices INCLUDE tax. The customer pays exactly what the till
// showed; tax is taken OUT of the line total, never added on top. VAT-exclusive pricing is supported here for later but is
// not used by anything yet.
//
// ROUNDING IS PROVISIONAL: half-up to 2 decimals per line. KRA's rounding rule has not been read from the spec yet and the
// sandbox will confirm it (ETIMS_PHASE1_AUDIT.md section J). Change ROUNDING in this one file if the spec says otherwise.
//
// Offline-safe: pure functions, no network, no storage.

export const ROUNDING = 'HALF_UP_2DP';

/** Round half away from zero to 2 decimals, without the 1.005 floating-point trap. */
export function round2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) throw new Error('taxEngine: not a number');
  const sign = x < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(x) * 100 + 1e-9)) / 100;
}

/** Amount the customer pays for a line: quantity x price, less the line discount. */
export function lineGross({ quantity, unit_price, discount_amount = 0 }) {
  const gross = round2(Number(quantity) * Number(unit_price) - Number(discount_amount || 0));
  if (gross < 0) throw new Error('taxEngine: a discount cannot be bigger than the line');
  return gross;
}

function assertRate(rate) {
  if (!Number.isFinite(rate) || rate < 0) throw new Error('taxEngine: a taxed line needs a rate of 0 or more (from the KRA list), got ' + rate);
}

/**
 * One line.
 * @param {{quantity:number, unit_price:number, discount_amount?:number}} line
 * @param {{rate:(number|null), inclusive?:boolean}} how  rate = percentage from KRA's list (e.g. a number), or null when the
 *        item's KRA treatment carries no percentage (the line is then reported with tax 0 and taxable = gross).
 * @returns {{gross:number, taxable:number, tax:number, total:number}}  gross = what the line is worth before any tax added;
 *          total = what the customer pays for it.
 */
export function splitLine(line, { rate, inclusive = true } = {}) {
  const gross = lineGross(line);
  if (rate === null || rate === undefined) return { gross, taxable: gross, tax: 0, total: gross };
  assertRate(Number(rate));
  const r = Number(rate);
  if (inclusive) {
    const tax = round2((gross * r) / (100 + r));
    return { gross, taxable: round2(gross - tax), tax, total: gross };
  }
  const tax = round2((gross * r) / 100);
  return { gross, taxable: gross, tax, total: round2(gross + tax) };
}

/**
 * A whole basket. Each entry: { line, code, rate }, where `code` is the KRA tax code string the product maps to (opaque here)
 * and `rate` its percentage or null. Tax is rounded per line and then summed, so the invoice and its lines always agree.
 */
export function summarise(entries, { inclusive = true } = {}) {
  const lines = entries.map(({ line, code, rate }) => ({ code: code ?? null, rate: rate ?? null, ...splitLine(line, { rate, inclusive }) }));
  const byCode = {};
  for (const l of lines) {
    const k = l.code ?? '';
    const b = (byCode[k] ||= { code: l.code, rate: l.rate, taxable: 0, tax: 0, total: 0 });
    b.taxable = round2(b.taxable + l.taxable); b.tax = round2(b.tax + l.tax); b.total = round2(b.total + l.total);
  }
  const sum = (key) => round2(lines.reduce((s, l) => s + l[key], 0));
  return { lines, byCode, totals: { taxable: sum('taxable'), tax: sum('tax'), total: sum('total') }, inclusive, rounding: ROUNDING };
}
