// Bank/M-Pesa statement CSV -> suggested matches against unreconciled payments. Pure functions, integer cents only.
// Matching is a SUGGESTION: the bursar still reviews the ticks before saving. Only credits (money in) are considered.
import { toCents } from './money.js';

export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false; const s = String(text || '').replace(/^﻿/, '');
  const delim = (s.split('\n')[0].match(/;/g) || []).length > (s.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const amt = (v) => { const t = String(v ?? '').trim(); if (!t) return null; try { return toCents(t.replace(/^\((.*)\)$/, '-$1'), { allowNegative: true }); } catch { return null; } };
const isoDate = (v) => {
  const t = String(v || '').trim(); let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (!m) { const d = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(t); if (d) m = [0, d[3].length === 2 ? `20${d[3]}` : d[3], d[2], d[1]]; }
  return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}` : null;
};

/** Finds the header row and the date / description / credit columns. Returns { lines:[{date,text,cents}], problems:[] }. */
export function readStatement(text) {
  const rows = parseCsv(text); const problems = [];
  const hi = rows.findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /credit|deposit|paid in|money in|amount/i.test(c)));
  if (hi < 0) return { lines: [], problems: ['Could not find a header row with a Date column and a Credit/Amount column.'] };
  const h = rows[hi].map((c) => c.trim().toLowerCase());
  const ix = (re) => h.findIndex((c) => re.test(c));
  const di = ix(/date/); const ci = ix(/credit|deposit|paid in|money in/); const ai = ix(/amount/); const dbi = ix(/debit|withdraw|paid out|money out/);
  const ti = h.map((c, i) => (/desc|narrat|detail|reference|ref|particular|transaction/.test(c) ? i : -1)).filter((i) => i >= 0);
  const lines = [];
  for (const r of rows.slice(hi + 1)) {
    const date = isoDate(r[di]); if (!date) continue;
    let cents = ci >= 0 ? amt(r[ci]) : amt(r[ai]);
    if (ci < 0 && dbi < 0 && cents !== null && cents < 0) cents = null; // single signed Amount column: negatives are money out
    if (!cents || cents <= 0) continue;
    lines.push({ date, text: ti.map((i) => r[i] || '').join(' ').trim(), cents });
  }
  if (!lines.length) problems.push('No credit lines were found in the file.');
  return { lines, problems };
}

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;

/** payments: [{payment_id, amount (cents), transaction_ref, receipt_no, payment_date}] -> {matches:{paymentId:lineIdx}, unmatchedLines:[idx], total} */
export function matchStatement(lines, payments) {
  const taken = new Set(); const matches = {}; const lineUsed = new Set();
  const order = lines.map((l, i) => i);
  const pick = (li, pred) => {
    const l = lines[li];
    const c = payments.filter((p) => !taken.has(p.payment_id) && p.amount === l.cents && pred(p, l))
      .sort((a, b) => days(a.payment_date, l.date) - days(b.payment_date, l.date));
    return c[0];
  };
  const hit = (li, p) => { taken.add(p.payment_id); matches[p.payment_id] = li; lineUsed.add(li); };
  // pass 1: reference found in the statement text; pass 2: same amount within 5 days; pass 3: same amount (any date in the period)
  for (const li of order) { const t = norm(lines[li].text); const p = pick(li, (p) => { const r = norm(p.transaction_ref); return r.length >= 4 && t.includes(r); }); if (p) hit(li, p); }
  for (const li of order) if (!lineUsed.has(li)) { const p = pick(li, (p, l) => days(p.payment_date, l.date) <= 5); if (p) hit(li, p); }
  const total = lines.reduce((s, l) => s + l.cents, 0);
  return { matches, unmatchedLines: order.filter((i) => !lineUsed.has(i)), total };
}
