// src/pos-erp/utils/branding.js
//
// Business-branding helpers shared by the sidebar, receipts, invoices and
// folio documents. Umova / My Business is the SOFTWARE brand; everything
// here concerns the CUSTOMER business's own identity.

export const LOGO_BUCKET = 'business-logos';

/**
 * Returns `url` only if it is a logo this app could have produced:
 * an https (or localhost http, for dev) URL pointing into the public
 * `business-logos` bucket. Anything else (external image hosts, tracking
 * pixels, data:/javascript: URLs, another bucket) returns null so the
 * caller falls back to the default presentation.
 *
 * When `businessId` is given, the object must also live in THAT business's
 * folder (`<businessId>/...`), so a document can never render another
 * business's logo even if a wrong `logo_url` ended up on the record.
 */
export function safeLogoUrl(url, businessId) {
  if (!url || typeof url !== 'string') return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(isLocal && u.protocol === 'http:')) return null;
  const marker = `/storage/v1/object/public/${LOGO_BUCKET}/`;
  const i = u.pathname.indexOf(marker);
  if (i < 0) return null;
  if (businessId) {
    const rest = u.pathname.slice(i + marker.length);
    if (!rest.startsWith(`${businessId}/`)) return null;
  }
  return u.toString();
}

/** "Mama Njeri Hardware" -> "MN". Used for the default (no-logo) badge. */
export function businessInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'MB';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
