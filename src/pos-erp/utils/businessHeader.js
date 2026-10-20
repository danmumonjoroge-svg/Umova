// src/pos-erp/utils/businessHeader.js
//
// The "who is this from" block at the top of a business document (statements, and any new
// document): the ACTIVE business's own logo, name, address and contact details. It takes the
// business row it is given and nothing else, so one business's identity can never leak into
// another's document. Every value is escaped; a logo address is only used when it is https.

import { escapeHtml } from './printDocument';

export function safeLogoUrl(url) {
  return typeof url === 'string' && /^https:\/\//i.test(url.trim()) ? url.trim() : null;
}

export function businessHeaderHtml(business) {
  const b = business || {};
  const logo = safeLogoUrl(b.logo_url);
  const contact = [b.phone, b.email].filter(Boolean).map(escapeHtml).join(' · ');
  if (!b.name && !logo) return '';
  return `
    <div class="center">
      ${logo ? `<img class="logo" src="${escapeHtml(logo)}" alt="" />` : ''}
      ${b.name ? `<div class="bold" style="font-size:16px;">${escapeHtml(b.name)}</div>` : ''}
      ${b.address ? `<div class="muted">${escapeHtml(b.address)}</div>` : ''}
      ${contact ? `<div class="muted">${contact}</div>` : ''}
    </div>`;
}
