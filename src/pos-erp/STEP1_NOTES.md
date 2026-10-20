# Step 1 — My Business naming + business branding

## Changed
| File | Change |
|---|---|
| `auth/POSLogin.jsx`, `POSTenantSignup.jsx`, `POSAccountStatus.jsx`, `pages/CustomersPage.jsx` | User-facing "POS" / "Umova POS" → "My Business" (text only; routes, files and DB untouched). Umova emblem on login kept: that is the software brand. |
| `utils/branding.js` (new) | `safeLogoUrl()` (only our own `business-logos` bucket, optionally only THIS business's folder), `businessInitials()`. |
| `utils/logoImage.js` (new) | Byte-sniffing validation (PNG/JPEG only, SVG rejected), 2 MB / 64–4096 px limits, re-encode to clean PNG (strips metadata), fit or square-crop. |
| `services/settingsService.js` | `uploadLogo` now validates, uploads to `<businessId>/logo.png` AND saves `lb_businesses.logo_url`; new `removeLogo`. |
| `components/BusinessBrandingCard.jsx` (new) | Choose → preview → fit/crop → Save / Cancel; replace; remove; receipt preview; default initials badge. |
| `pages/SettingsPage.jsx` | Uses the card; business details read-only for non-owners; old logo block removed. |
| `POSLayout.jsx` | Sidebar logo via `safeLogoUrl`, initials badge as default, refreshes instantly after a change. |
| `receiptService.js`, `ReceiptModal.jsx`, `invoiceService.js`, `utils/folioDocument.js` | Logo rendered only if `safeLogoUrl` passes. |
| `schema/phase27_branding.sql` (new) | DB enforcement, see below. |

## Bug fixed
Old `uploadLogo` returned a URL but never saved it to `lb_businesses`, and `SettingsPage` then put that string into the profile form state. Uploads were lost on reload.

## Database enforcement (phase27, NOT yet run on any real database)
- Owner-only logo upload/replace/delete; same tenant-folder rule as phase15.
- Owner-only changes to name/phone/email/address/currency/time zone/logo on `lb_businesses` (trigger). Applies only to POS sessions; main-app and service-role sessions behave as before.
- Bucket refuses anything but PNG/JPEG and > 2 MB.
- Behaviour change: managers can no longer edit these fields until Step 2 adds a permission for it.

## Verified
- `node --test tests/branding.test.mjs`: 9/9 pass.
- esbuild parses all 12 changed JS/JSX files.
- `schema/tests/phase27_scenarios.sql` on scratch PostgreSQL 16: 20/20 pass, migration re-runs cleanly; negative control (without phase27) fails as expected.
- `schema/tests/phase20_js_checks.mjs`: 62/62, same as the original. It first broke because `folioDocument.js` now imports `utils/branding.js`; the harness copy-list was updated.

## NOT verified
- No real Supabase: storage policies and bucket limits were tested against stand-ins for `storage.*` and `auth.jwt()`.
- No browser run of the new UI (canvas re-encode, preview, fit/crop) and no build (the ZIP has no package.json).
- Offline sync branding isolation: not touched or tested.
- Staff-list, quotations, customer statements, reports/exports: not changed yet (no branding hook found for them in this source).
- "Powered by Umova" label: not added. Your call.
