// src/pos-erp/utils/printDocument.js
//
// One small utility, reused by the sale receipt (Phase 14), statements, payslips and folio documents — a single place
// that knows how to turn an HTML string into a browser print dialog.
// MVP audit D-02: now prints through a hidden in-page iframe instead of window.open() (see printDocument below).
//
// Uses the browser's native print dialog rather than a PDF library:
// no new dependency, and it's what actually lets a cashier print to a
// real receipt/thermal printer if the OS has one configured — a
// generated PDF alone wouldn't do that. "Save as PDF" is also just
// another option inside that same native dialog, so nothing is lost
// for the person who wants a file instead of paper.

/**
 * Prints `bodyHtml` through a hidden iframe INSIDE the current page (no new window).
 *
 * Why not window.open(): in an installed app / phone WebView a script-opened blank window has no browser chrome and no
 * Back button, so if the print sheet was cancelled or failed there was nothing left to tap (the "Print Receipt dead end").
 * The cashier now never leaves the app: the receipt screen stays exactly where it was, and the hidden frame removes itself.
 *
 * Prints exactly once, waits (briefly) for the logo to load, and cleans up after the print sheet closes (or after 2 minutes).
 *
 * @param {string} title - document title (some browsers use it as the default PDF filename)
 * @param {string} bodyHtml - HTML to render inside <body>
 * @param {string} [extraStyle] - additional CSS appended after the baseline styles
 * @param {{onError?: (e: Error) => void}} [opts] - called if printing fails AFTER this function returned (async failures)
 * @throws {Error} synchronously if the frame cannot even be created
 */
export function printDocument(title, bodyHtml, extraStyle = '', opts = {}) {
  const html = `<!DOCTYPE html>
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
</html>`;

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('title', 'print');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;pointer-events:none';
  document.body.appendChild(frame);

  let removed = false;
  const cleanup = () => { if (removed) return; removed = true; try { frame.remove(); } catch { /* already gone */ } };
  const fail = (e) => { cleanup(); try { opts.onError?.(e); } catch { /* caller's handler must not break us */ } };

  const w = frame.contentWindow;
  if (!w || !w.document) {
    cleanup();
    throw new Error('Printing is not available in this browser. Use WhatsApp or Email to share the receipt instead.');
  }
  try {
    w.document.open();
    w.document.write(html);
    w.document.close();
  } catch (e) {
    cleanup();
    throw new Error('Could not prepare the print page. Use WhatsApp or Email to share the receipt instead.');
  }

  let printed = false;
  const printOnce = () => {
    if (printed || removed) return;
    printed = true;
    try {
      w.addEventListener('afterprint', () => setTimeout(cleanup, 500));
      w.focus();
      w.print();
    } catch (e) {
      fail(new Error('Printing did not start. Use WhatsApp or Email to share the receipt instead.'));
    }
  };

  // Wait for images (the logo) so it does not print as an empty box -- but never longer than 2.5 s.
  const imgs = Array.from(w.document.images || []).filter((i) => !i.complete);
  if (imgs.length === 0) {
    setTimeout(printOnce, 50);
  } else {
    let left = imgs.length;
    const one = () => { if (--left <= 0) printOnce(); };
    imgs.forEach((i) => { i.addEventListener('load', one); i.addEventListener('error', one); });
    setTimeout(printOnce, 2500);
  }
  // Safety net: whatever happens, the hidden frame never stays in the page.
  setTimeout(cleanup, 120000);
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export { escapeHtml };
