// Debtor ageing buckets (same boundaries as elimu_fin_aging in E008).
export const BUCKETS = [
  { key: 'not_yet_due', label: 'Not yet due', test: d => d <= 0 },
  { key: 'days_1_30', label: '1-30 days', test: d => d >= 1 && d <= 30 },
  { key: 'days_31_60', label: '31-60 days', test: d => d >= 31 && d <= 60 },
  { key: 'days_61_90', label: '61-90 days', test: d => d >= 61 && d <= 90 },
  { key: 'over_90', label: 'Over 90 days', test: d => d > 90 },
];
const DAY = 86400000;
export function daysOverdue(dueDate, asOf = new Date()) {
  const d = Date.UTC(...String(dueDate).slice(0, 10).split('-').map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))));
  const a = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  return Math.round((a - d) / DAY);
}
export const bucketFor = (days) => BUCKETS.find(b => b.test(days)).key;
/** invoices: [{due_date, outstanding(cents)}] -> {key:{amount,count}} */
export function ageInvoices(invoices, asOf = new Date()) {
  const out = Object.fromEntries(BUCKETS.map(b => [b.key, { amount: 0, count: 0 }]));
  for (const i of invoices) { if (i.outstanding <= 0) continue; const k = bucketFor(daysOverdue(i.due_date, asOf)); out[k].amount += i.outstanding; out[k].count++; }
  return out;
}
