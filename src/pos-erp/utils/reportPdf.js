// src/pos-erp/utils/reportPdf.js
//
// One small PDF engine for every printable report. A report is plain DATA (see reportCentreService.js):
//
//   { title, subtitle, period, summary:[{label,value}], sections:[ { heading, note, columns:[{key,label,align,w}],
//     rows:[{...cells, _kind:'group'|'total'|'sub'}], pageBreakBefore } ], footnote }
//
// The same spec is drawn on screen (ReportPreview) and here as a real A4 PDF (text and lines, not a screenshot),
// so the paper can never disagree with the screen. Needs `jspdf` (already used by invoicePdfService).
// Money cells are formatted by the caller; a column with align:'right' is right-aligned and kept on one line.

import { jsPDF } from 'jspdf';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const GREEN = [18, 60, 42], GOLD = [198, 161, 91], GREY = [104, 117, 109], INK = [38, 53, 45], TINT = [243, 238, 214], LINE = [214, 208, 178];

export const kes = (n) => Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const num = (n) => Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 3 });
export const pct = (n) => (n == null ? '-' : `${Number(n).toLocaleString('en-KE', { maximumFractionDigits: 1 })}%`);
export const niceDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** "report-name_2026-11-01_to_2026-11-30.pdf" -- safe for every phone/OS. */
export function reportFileName(report) {
  const base = String(report.fileBase || report.title || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const per = report.periodKey ? `_${report.periodKey}` : '';
  return `${base}${per}.pdf`;
}

/** Column widths: each column has a weight `w` (default 1); the table fills the page width. */
function columnWidths(columns, total) {
  const weights = columns.map((c) => c.w || 1);
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (w / sum) * total);
}

export function buildReportPdf(report, { business, logo, generatedBy, now = new Date() } = {}) {
  const wide = (report.orientation === 'landscape') || (report.sections || []).some((s) => (s.columns || []).length > 7);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: wide ? 'landscape' : 'portrait' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 12;
  const usable = W - M * 2, bottom = H - 14;
  let y = M;

  const font = (bold, size, color = INK) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color); };
  const text = (t, x, yy, o = {}) => { font(o.bold, o.size || 9, o.color); doc.text(String(t ?? ''), x, yy, { align: o.align || 'left', maxWidth: o.maxWidth }); };

  const pageHeader = (first) => {
    y = M;
    if (first) {
      let tx = M;
      if (logo?.dataUrl) {
        const h = 14, w = Math.min(36, h * (logo.width / logo.height));
        try { doc.addImage(logo.dataUrl, 'PNG', M, y - 2, w, h); tx = M + w + 4; } catch { /* no logo */ }
      }
      text(business?.name || 'My Business', tx, y + 4, { bold: true, size: 15, color: GREEN });
      const sub = [business?.address, [business?.phone, business?.email].filter(Boolean).join('  ·  ')].filter(Boolean).join('   |   ');
      if (sub) text(sub, tx, y + 9, { size: 8, color: GREY, maxWidth: usable - (tx - M) });
      y += 16;
      doc.setDrawColor(...GOLD); doc.setLineWidth(0.8); doc.line(M, y, W - M, y); y += 6;
      text(report.title, M, y + 2, { bold: true, size: 14 });
      y += 7;
      if (report.subtitle) { text(report.subtitle, M, y, { size: 9, color: GREY, maxWidth: usable }); y += 5; }
      if (report.period) { text(report.period, M, y, { size: 9, bold: true }); y += 5; }
      y += 1;
    } else {
      text(`${business?.name || 'My Business'}  ·  ${report.title}`, M, y + 3, { size: 8, color: GREY });
      doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.line(M, y + 5, W - M, y + 5);
      y += 9;
    }
  };

  const ensure = (need) => { if (y + need > bottom) { doc.addPage(); pageHeader(false); return true; } return false; };

  pageHeader(true);

  // summary tiles
  if (report.summary?.length) {
    const n = report.summary.length, gap = 3, tw = (usable - gap * (n - 1)) / n;
    ensure(16);
    report.summary.forEach((s, i) => {
      const x = M + i * (tw + gap);
      doc.setFillColor(...TINT); doc.roundedRect(x, y, tw, 13, 1.5, 1.5, 'F');
      text(s.label, x + 3, y + 4.5, { size: 7.5, color: GREY, maxWidth: tw - 6 });
      text(s.value, x + 3, y + 10.2, { bold: true, size: 11, color: s.bad ? [178, 58, 46] : GREEN, maxWidth: tw - 6 });
    });
    y += 18;
  }

  const drawSection = (sec) => {
    if (sec.pageBreakBefore && y > M + 30) { doc.addPage(); pageHeader(false); }
    if (sec.heading) {
      ensure(14);
      text(sec.heading, M, y + 3, { bold: true, size: 11, color: GREEN });
      if (sec.headingRight) text(sec.headingRight, W - M, y + 3, { bold: true, size: 10, align: 'right' });
      y += 6;
    }
    if (sec.note) { text(sec.note, M, y + 2, { size: 8, color: GREY, maxWidth: usable }); y += 5; }
    const cols = sec.columns || [];
    if (!cols.length) return;
    const widths = columnWidths(cols, usable);
    const pad = 1.6, lh = 3.7;

    const drawHead = () => {
      ensure(10);
      doc.setFillColor(...GREEN); doc.rect(M, y, usable, 6.2, 'F');
      let x = M;
      cols.forEach((c, i) => {
        text(c.label, c.align === 'right' ? x + widths[i] - pad : x + pad, y + 4.2, { bold: true, size: 8, color: [255, 255, 255], align: c.align === 'right' ? 'right' : 'left', maxWidth: widths[i] - pad * 2 });
        x += widths[i];
      });
      y += 6.2;
    };
    drawHead();

    if (!sec.rows?.length) { text(sec.emptyText || 'Nothing to show for this period.', M + pad, y + 5, { size: 9, color: GREY }); y += 9; return; }

    sec.rows.forEach((row, ri) => {
      const kind = row._kind || 'row';
      const bold = kind === 'group' || kind === 'total';
      font(bold, kind === 'sub' ? 8 : 8.5);
      // wrap every cell; row height = tallest cell. Right-aligned (number) cells never wrap.
      const lines = cols.map((c, i) => {
        const v = row[c.key] == null ? '' : String(row[c.key]);
        return c.align === 'right' ? [v] : doc.splitTextToSize(v, Math.max(4, widths[i] - pad * 2));
      });
      const h = Math.max(...lines.map((l) => l.length)) * lh + 2;
      if (y + h > bottom) { doc.addPage(); pageHeader(false); drawHead(); }
      if (kind === 'group') { doc.setFillColor(...TINT); doc.rect(M, y, usable, h, 'F'); }
      else if (kind === 'row' && ri % 2 === 1) { doc.setFillColor(251, 249, 238); doc.rect(M, y, usable, h, 'F'); }
      let x = M;
      cols.forEach((c, i) => {
        const color = row._bad && row._bad.includes(c.key) ? [178, 58, 46] : kind === 'sub' ? GREY : INK;
        font(bold, kind === 'sub' ? 8 : 8.5, color);
        const tx = c.align === 'right' ? x + widths[i] - pad : x + pad + (kind === 'sub' && i === 0 ? 3 : 0);
        lines[i].forEach((ln, li) => doc.text(ln, tx, y + 3.3 + li * lh, { align: c.align === 'right' ? 'right' : 'left' }));
        x += widths[i];
      });
      doc.setDrawColor(...(kind === 'total' ? GREEN : LINE)); doc.setLineWidth(kind === 'total' ? 0.4 : 0.1);
      doc.line(M, y + h, W - M, y + h);
      y += h;
    });
    y += 5;
  };

  (report.sections || []).forEach(drawSection);
  if (report.footnote) { ensure(10); text(report.footnote, M, y + 3, { size: 8, color: GREY, maxWidth: usable }); y += 8; }

  // footer on every page: who/when, page x of y
  const total = doc.getNumberOfPages();
  const stamp = `Printed ${now.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}${generatedBy ? ` by ${generatedBy}` : ''}`;
  for (let p = 1; p <= total; p += 1) {
    doc.setPage(p);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.line(M, H - 10, W - M, H - 10);
    text(stamp, M, H - 6, { size: 7.5, color: GREY });
    text(`Page ${p} of ${total}`, W - M, H - 6, { size: 7.5, color: GREY, align: 'right' });
  }
  return doc;
}

const isNative = () => { try { return Capacitor.isNativePlatform(); } catch { return false; } };

/**
 * Phone app (Android WebView): the browser-style download does nothing there, so the PDF is written to the app's cache with
 * the Filesystem plugin and handed to the Android share sheet (Save to Files / Drive, WhatsApp, email, Print...).
 * Returns true when the sheet was shown (or the person closed it), false if it could not be.
 */
async function nativeShare(doc, fileName, title) {
  const base64 = doc.output('datauristring').split(',')[1];
  const written = await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache, recursive: true });
  try {
    await Share.share({ title: title || fileName, text: title || fileName, url: written.uri, dialogTitle: 'Save, print or send this PDF' });
  } catch (e) {
    if (!/cancel/i.test(String(e?.message || e))) throw e; // closing the sheet is not an error
  }
  return true;
}

/**
 * Download a built doc. In a browser the file downloads; in the phone app the share sheet opens (that is where "Save" lives).
 * Resolves to 'downloaded' | 'shared'.
 */
export async function savePdf(doc, fileName, title) {
  if (isNative()) { await nativeShare(doc, fileName, title); return 'shared'; }
  doc.save(fileName);
  return 'downloaded';
}

/** Prints through a hidden in-page frame (a browser). In the phone app printing goes through the share sheet's Print option. */
export function printPdf(doc, { onError, fileName = 'report.pdf', title } = {}) {
  if (isNative()) { nativeShare(doc, fileName, title).catch((e) => onError?.(new Error(e?.message || 'Could not open the print options.'))); return; }
  const url = URL.createObjectURL(doc.output('blob'));
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;pointer-events:none';
  const done = () => { try { frame.remove(); URL.revokeObjectURL(url); } catch { /* gone */ } };
  frame.onload = () => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(done, 60000); }
    catch (e) { done(); onError?.(new Error('Printing did not start. Use Download PDF instead.')); }
  };
  frame.src = url;
  document.body.appendChild(frame);
  setTimeout(done, 180000);
}

/** Hand the file to the share sheet (WhatsApp, email, Drive). Returns false when the device cannot. */
export async function sharePdf(doc, fileName, title) {
  if (isNative()) { try { return await nativeShare(doc, fileName, title); } catch { return false; } }
  try {
    const file = new File([doc.output('blob')], fileName, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title }); return true; }
  } catch (e) { if (e?.name === 'AbortError') return true; }
  return false;
}

/** Public logo URL -> PNG data URL for jsPDF (it cannot take webp/svg or a remote URL). null on any failure: a report without a logo beats no report. */
export async function loadLogoPng(url) {
  if (!url || !/^https:\/\//i.test(url)) return null;
  try {
    const blob = await (await fetch(url)).blob();
    const objUrl = URL.createObjectURL(blob);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = objUrl; });
    const scale = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(objUrl);
    return { dataUrl: c.toDataURL('image/png'), width: c.width, height: c.height };
  } catch { return null; }
}
