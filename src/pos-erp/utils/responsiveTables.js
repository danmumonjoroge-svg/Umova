// src/pos-erp/utils/responsiveTables.js
//
// Wide tables do not fit a phone: columns scroll off the side and half the information is hidden. Instead of rewriting every
// page, this labels each table cell with its column heading (data-label). theme/posSkin.css then draws every row of a table
// as a small CARD on phones (heading on the left, value on the right) and leaves the normal table on tablets and desktop.
//
//   - Tables with fewer than 3 columns (e.g. "Item ... Amount" statements) are left alone: they already fit.
//   - A table can opt out with the attribute data-keep-table.
//   - Safe to run repeatedly: it only sets attributes and never changes the content or the page's own logic.
//
// installResponsiveTables(rootElement) watches the root for new tables (pages load their data after they open) and returns a
// function that stops watching.

const MIN_COLUMNS = 3;

function headerLabels(table) {
  const head = table.tHead?.rows?.[table.tHead.rows.length - 1] || null;
  const row = head || (table.rows[0] && [...table.rows[0].cells].every((c) => c.tagName === 'TH') ? table.rows[0] : null);
  if (!row) return null;
  const labels = [];
  [...row.cells].forEach((c) => {
    const text = (c.textContent || '').replace(/\s+/g, ' ').trim();
    for (let i = 0; i < (c.colSpan || 1); i += 1) labels.push(i === 0 ? text : '');
  });
  return { labels, headRow: row };
}

export function labelTable(table) {
  if (table.hasAttribute('data-keep-table')) return;
  const info = headerLabels(table);
  if (!info || info.labels.length < MIN_COLUMNS) { table.removeAttribute('data-cards'); return; }
  const { labels, headRow } = info;
  table.setAttribute('data-cards', '');
  [...table.rows].forEach((tr) => {
    if (tr === headRow) return;
    let col = 0;
    [...tr.cells].forEach((cell, i) => {
      const span = cell.colSpan || 1;
      const label = span === 1 ? (labels[col] || '') : '';
      if (cell.getAttribute('data-label') !== label) cell.setAttribute('data-label', label);
      // first cell is the card's title; a cell with no heading and a button/link in it is the actions row
      if (i === 0 && span === 1 && !cell.hasAttribute('data-primary')) cell.setAttribute('data-primary', '');
      if (!label && span === 1 && i > 0 && cell.querySelector('button, a') && !cell.hasAttribute('data-actions')) cell.setAttribute('data-actions', '');
      col += span;
    });
  });
}

export function labelAllTables(root) {
  root.querySelectorAll('table').forEach(labelTable);
}

export function installResponsiveTables(root) {
  if (!root || typeof MutationObserver === 'undefined') return () => {};
  let queued = false;
  const run = () => { queued = false; try { labelAllTables(root); } catch { /* a odd table must never break the page */ } };
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(run); } };
  const mo = new MutationObserver(schedule);
  mo.observe(root, { childList: true, subtree: true, characterData: true });
  schedule();
  return () => mo.disconnect();
}
