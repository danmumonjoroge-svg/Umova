// src/pos-erp/utils/printDocument.js
//
// One small utility, reused by the sale receipt (Phase 14) and the
// customer/supplier statement print buttons — so there is a single
// place that knows how to turn an HTML string into an actual browser
// print dialog, not three separate copies of the same window.open()
// dance (brief §2: one authoritative implementation per mechanism).
//
// Uses the browser's native print dialog rather than a PDF library:
// no new dependency, and it's what actually lets a cashier print to a
// real receipt/thermal printer if the OS has one configured — a
// generated PDF alone wouldn't do that. "Save as PDF" is also just
// another option inside that same native dialog, so nothing is lost
// for the person who wants a file instead of paper.

/**
 * Opens a new window/tab containing `bodyHtml` (already a full <body>
 * fragment — this function supplies the surrounding <html>/<head> and a
 * baseline print stylesheet) and triggers the print dialog once it has
 * rendered.
 *
 * @param {string} title - shown as the print window's document title (some browsers use this as the default PDF filename)
 * @param {string} bodyHtml - HTML to render inside <body>
 * @param {string} [extraStyle] - additional CSS rules appended after the baseline styles
 */
export function printDocument(title, bodyHtml, extraStyle = '') {
  const win = window.open('', '_blank', 'width=420,height=600');
  if (!win) {
    // Pop-up blocked — thrown rather than silently doing nothing, so
    // the calling UI can show the cashier an actual reason instead of
    // a dead button.
    throw new Error('Your browser blocked the print window. Allow pop-ups for this site and try again.');
  }

  win.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Courier New', monospace; font-size: 13px; color: #111; margin: 0; padding: 16px; }
  .center { text-align: center; }
  .right { text-align: right; }
  .bold { font-weight: 700; }
  .muted { color: #666; }
  .divider { border-top: 1px dashed #999; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 2px 0; vertical-align: top; }
  .logo { max-width: 120px; max-height: 60px; margin: 0 auto 8px; display: block; }
  @media print {
    body { padding: 0; }
    @page { margin: 8mm; }
  }
  ${extraStyle}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`);
  win.document.close();

  // Wait for images (the logo, specifically) to load before printing —
  // otherwise a slow-loading logo image can print as a blank box, or
  // the print dialog can fire before the layout has settled.
  win.onload = () => {
    win.focus();
    win.print();
  };
  // Fallback for browsers that don't fire onload reliably on a
  // document.write()'d window.
  setTimeout(() => { try { win.focus(); win.print(); } catch { /* window may already be closed by the user */ } }, 700);
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export { escapeHtml };
