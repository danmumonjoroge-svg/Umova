// elimu/import/utils/balanceImport.js -- opening fee balances: one row per student (admission number + balance + optional note).
import { toIsoDate } from './studentImport.js';
export const BALANCE_FIELDS = [
  { key: 'admission_no', label: 'Admission number', required: true, aliases: ['admissionno', 'admno', 'admission', 'admissionnumber', 'regno', 'registrationnumber', 'adm', 'studentno', 'studentnumber'] },
  { key: 'balance', label: 'Balance', required: true, aliases: ['balance', 'feebalance', 'feesbalance', 'arrears', 'outstanding', 'amountdue', 'balancebf', 'balancebroughtforward', 'bf', 'amount', 'due', 'totalbalance'] },
  { key: 'note', label: 'Note (optional)', aliases: ['note', 'notes', 'description', 'remarks', 'comment', 'narration'] },
];
const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function autoMapBalances(headers) {
  const hs = headers.map(norm); const used = new Set(); const map = {};
  for (const f of BALANCE_FIELDS) { const i = hs.findIndex((h, ix) => !used.has(ix) && f.aliases.includes(h)); map[f.key] = i; if (i >= 0) used.add(i); }
  return map;
}
export const balanceProblems = (map) => [map.admission_no < 0 && 'Choose the Admission number column.', map.balance < 0 && 'Choose the Balance column.'].filter(Boolean);

/** "KES 1,250.50" -> "1250.5"; "(500)" and "500 CR" -> "-500" (credit); "500 DR" -> "500". Unreadable text is returned unchanged so the check can name it. */
export function cleanAmount(v) {
  let t = String(v ?? '').trim(); if (!t) return '';
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (/\bcr\.?$/i.test(t)) { neg = !neg ? true : neg; t = t.replace(/\s*cr\.?$/i, ''); } else if (/\bdr\.?$/i.test(t)) t = t.replace(/\s*dr\.?$/i, '');
  t = t.replace(/^(kes|ksh|ksh\.|kshs|kshs\.|k\.?sh\.?)\s*/i, '').replace(/[,\s]/g, '');
  if (t.startsWith('-')) { neg = true; t = t.slice(1); } else if (t.startsWith('+')) t = t.slice(1);
  if (!/^\d+(\.\d+)?$/.test(t)) return String(v).trim();
  const n = Math.round(parseFloat(t) * 100) / 100; const out = String(n);
  return neg && n !== 0 ? `-${out}` : out;
}
export function buildBalanceRows(rows, map) {
  const out = [];
  for (const r of rows) {
    if (!r.some((c) => String(c).trim() !== '')) continue;
    const g = (k) => (map[k] >= 0 ? String(r[map[k]] ?? '').trim() : '');
    out.push({ admission_no: g('admission_no').replace(/\.0+$/, ''), balance: cleanAmount(g('balance')), note: g('note') });
  }
  return out;
}
export const BALANCE_TEMPLATE_CSV = 'Admission number,Balance,Note\nADM-0001,15000.50,Term 3 arrears\nADM-0002,-2000,Overpaid last term\nADM-0003,0,\n';
export { toIsoDate };
