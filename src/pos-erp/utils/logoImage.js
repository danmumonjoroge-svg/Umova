// src/pos-erp/utils/logoImage.js
//
// Business logo intake. A logo is an uploaded file, so it is NOT trusted: the browser's
// claimed type is ignored, the real type is read from the file's first bytes, the size and
// dimensions are checked, and the image is then RE-DRAWN onto a canvas and re-encoded. The
// file that is uploaded is the new, clean PNG/JPEG -- never the original bytes -- so hidden
// data (metadata, scripts in a polyglot file) does not travel with it.
//
// Allowed: PNG, JPEG, WebP.  Refused: SVG (can carry script; needs a sanitiser we do not ship),
// GIF, PDF, everything else.
//
// The pure helpers (sniffImageType, checkLogoLimits, fitSize, cropRect) have no browser
// dependency and are covered by schema/tests/branding_js_checks.mjs. processLogo() uses canvas.

export const LOGO_RULES = {
  maxFileBytes: 3 * 1024 * 1024, // what the owner may pick
  minSide: 64,                   // smaller than this is unreadable on a receipt
  maxSide: 6000,                 // larger than this is a camera photo, not a logo
  outputMaxSide: 512,            // what is stored
};

/** Real image type from the first bytes ('png' | 'jpeg' | 'webp'), or null. */
export function sniffImageType(bytes) {
  const b = bytes;
  if (!b || b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return null;
}

/** Friendly reason a file is refused before decoding, or null when it may proceed. */
export function checkLogoFile({ size, type }) {
  if (!size) return 'That file is empty.';
  if (size > LOGO_RULES.maxFileBytes) return `That picture is too big (${(size / 1048576).toFixed(1)} MB). Please choose one under ${LOGO_RULES.maxFileBytes / 1048576} MB.`;
  if (type === 'image/svg+xml') return 'SVG logos are not accepted. Please use a PNG or JPG picture of your logo.';
  return null;
}

export function checkLogoLimits(width, height) {
  if (!(width > 0 && height > 0)) return 'We could not read that picture.';
  if (Math.min(width, height) < LOGO_RULES.minSide) return `That picture is too small (${width}x${height}). Use one at least ${LOGO_RULES.minSide} pixels on its shortest side.`;
  if (Math.max(width, height) > LOGO_RULES.maxSide) return `That picture is too large (${width}x${height}). Use one no bigger than ${LOGO_RULES.maxSide} pixels.`;
  return null;
}

/** Keep the whole picture, scaled down to fit inside max x max (never enlarged). */
export function fitSize(width, height, max = LOGO_RULES.outputMaxSide) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Centre square cut of the source, for a logo that should fill a square. */
export function cropRect(width, height) {
  const side = Math.min(width, height);
  return { sx: Math.round((width - side) / 2), sy: Math.round((height - side) / 2), side };
}

const loadImage = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('We could not read that picture. Please choose a PNG or JPG file.')); i.src = url; });

/**
 * file -> { blob, previewUrl, width, height, ext, contentType }. Throws an Error with a plain message.
 * mode 'fit' keeps the whole picture; 'square' crops the middle to a square.
 */
export async function processLogo(file, { mode = 'fit' } = {}) {
  const early = checkLogoFile(file);
  if (early) throw new Error(early);
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const kind = sniffImageType(head);
  if (!kind) throw new Error('That is not a PNG, JPG or WebP picture.');

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const limit = checkLogoLimits(img.naturalWidth, img.naturalHeight);
    if (limit) throw new Error(limit);
    const crop = mode === 'square' ? cropRect(img.naturalWidth, img.naturalHeight) : null;
    const out = crop ? fitSize(crop.side, crop.side) : fitSize(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = out.width; canvas.height = out.height;
    const ctx = canvas.getContext('2d');
    const keepAlpha = kind !== 'jpeg';
    if (!keepAlpha) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height); }
    if (crop) ctx.drawImage(img, crop.sx, crop.sy, crop.side, crop.side, 0, 0, out.width, out.height);
    else ctx.drawImage(img, 0, 0, out.width, out.height);
    const contentType = keepAlpha ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('We could not prepare that picture.'))), contentType, 0.9));
    return { blob, previewUrl: URL.createObjectURL(blob), width: out.width, height: out.height, ext: keepAlpha ? 'png' : 'jpg', contentType };
  } finally { URL.revokeObjectURL(url); }
}
