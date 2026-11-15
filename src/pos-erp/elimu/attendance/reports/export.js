// elimu/attendance/reports/export.js -- CSV and print for any report. Printing reuses the POS printDocument helper.
export function cellText(row, c) {
  const v = row[c.key]; const out = c.fmt ? c.fmt(v, row) : v;
  return out === null || out === undefined ? '' : String(out);
}
export function toCsv(columns, rows) {
  const esc = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(cellText(r, c))).join(','))].join('\n');
}
export function downloadCsv(filename, columns, rows) {
  const blob = new Blob(['﻿' + toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function reportHtml({ title, subtitle, schoolName, columns, rows }) {
  return `<div class="center bold" style="font-size:16px">${esc(schoolName || '')}</div><div class="center bold">${esc(title)}</div><div class="center">${esc(subtitle || '')}</div><br/>
<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr>${columns.map((c) => `<th style="border:1px solid #999;padding:3px;text-align:left">${esc(c.label)}</th>`).join('')}</tr></thead>
<tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td style="border:1px solid #bbb;padding:3px">${esc(cellText(r, c))}</td>`).join('')}</tr>`).join('')}</tbody></table>
<p style="font-size:10px">Printed ${new Date().toLocaleString('en-GB')} · Not-marked students are not counted as absent.</p>`;
}
export async function printReport(args) {
  const { printDocument } = await import('../../../utils/printDocument');
  printDocument(args.title, reportHtml(args), 'body{font-family:Arial,sans-serif}');
}
