// elimu/theme/themes.js -- colour themes for Elimu. Pure logic (no React) so it can be tested in plain Node.
// Every screen in Elimu was written with a fixed green/gold palette. Instead of editing hundreds of files, a theme sets a handful of CSS
// variables on <html>, and elimuThemeCss.js (generated) maps each old colour to one of these variables while Elimu is open.
export const STORAGE_PREFIX = 'elimu_theme_v1';

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
const parse = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim()); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hex = (r, g, b) => `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
/** mix(a, b, t): t=0 gives a, t=1 gives b. */
export function mix(a, b, t) { const x = parse(a), y = parse(b); if (!x || !y) return a; return hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t); }
export const isHex = (v) => !!parse(v);
/** Relative luminance, used to pick readable text on top of a colour. */
export function luminance(h) { const c = parse(h); if (!c) return 0; const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); }
export const readableOn = (bg) => (luminance(bg) > 0.45 ? '#12261F' : '#FFFFFF');

/** Build the full variable set from four seed colours. */
export function derive({ primary, dark, accent, paper, primary2, dark2 }) {
  return {
    primary, primary2: primary2 || primary, dark2: dark2 || (primary2 ? mix(dark, primary2, 0.4) : dark), primaryDeep: mix(primary, '#000000', 0.22), tint: mix(primary, '#FFFFFF', 0.88),
    dark, text: mix(dark, '#FFFFFF', 0.12), muted: mix(dark, '#FFFFFF', 0.42), mutedSoft: mix(dark, '#FFFFFF', 0.62),
    accent, accentDeep: mix(accent, '#000000', 0.38), accentTint: mix(accent, '#FFFFFF', 0.85),
    bg: paper, soft: mix(paper, '#000000', 0.045), border: mix(paper, '#000000', 0.1), border2: mix(paper, '#000000', 0.06),
    onPrimary: readableOn(primary), onDark: readableOn(dark), onAccent: readableOn(accent),
  };
}

// The first theme reproduces the original look exactly.
const FOREST = { primary: '#1F6B45', primary2: '#1F6B45', dark2: '#12261F', primaryDeep: '#1B5138', tint: '#E4F0E8', dark: '#12261F', text: '#23382B', muted: '#6F7461', mutedSoft: '#A5A88F',
  accent: '#C9A227', accentDeep: '#8A6D0B', accentTint: '#F6EBC4', bg: '#FBF8EA', soft: '#F4EFD3', border: '#E3DBB8', border2: '#F0ECD9',
  onPrimary: '#FFFFFF', onDark: '#FFFFFF', onAccent: '#12261F' };

// "Mixes" blend two colours (buttons, bars and the top bar fade from one into the other); the others are one main colour.
export const MIXES = [
  { id: 'gold-green', name: 'Gold & Green', vars: derive({ primary: '#1F6B45', primary2: '#B8921F', dark: '#12261F', accent: '#E0B63A', paper: '#FAF7E6' }) },
  { id: 'ocean-gold', name: 'Blue & Gold', vars: derive({ primary: '#0B6FA4', primary2: '#D9962B', dark: '#0B2A3C', accent: '#F2B94B', paper: '#F5F8FA' }) },
  { id: 'royal-orange', name: 'Purple & Orange', vars: derive({ primary: '#5B3FA6', primary2: '#E2742B', dark: '#22163F', accent: '#F0A04B', paper: '#F8F5FB' }) },
  { id: 'maroon-gold', name: 'Maroon & Gold', vars: derive({ primary: '#8C2234', primary2: '#C79A2B', dark: '#2E0F15', accent: '#E3B04B', paper: '#FBF5F1' }) },
  { id: 'teal-lime', name: 'Teal & Lime', vars: derive({ primary: '#0F7C7C', primary2: '#6AA84F', dark: '#0A2E2E', accent: '#C7D43A', paper: '#F2F9F5' }) },
  { id: 'rose-plum', name: 'Rose & Plum', vars: derive({ primary: '#C2255C', primary2: '#6B2F8F', dark: '#2E1038', accent: '#F0A33A', paper: '#FCF4F8' }) },
  { id: 'navy-red', name: 'Navy & Red', vars: derive({ primary: '#1E3A8A', primary2: '#C0392B', dark: '#0F1B45', accent: '#F2C14E', paper: '#F5F6FB' }) },
  { id: 'sunset-sea', name: 'Orange & Sea', vars: derive({ primary: '#D2571C', primary2: '#0F8A8A', dark: '#3A1A0C', accent: '#F0B24B', paper: '#FFF8F1' }) },
];
export const THEMES = [
  { id: 'forest', name: 'Forest', vars: FOREST },
  { id: 'ocean', name: 'Ocean', vars: derive({ primary: '#0B6FA4', dark: '#0B2A3C', accent: '#F2A93B', paper: '#F3F8FB' }) },
  { id: 'royal', name: 'Royal', vars: derive({ primary: '#5B3FA6', dark: '#22163F', accent: '#E0A93B', paper: '#F7F5FC' }) },
  { id: 'maroon', name: 'Maroon', vars: derive({ primary: '#8C2234', dark: '#2E0F15', accent: '#D9A441', paper: '#FBF5F3' }) },
  { id: 'sunset', name: 'Sunset', vars: derive({ primary: '#D2571C', dark: '#3A1A0C', accent: '#2F8F83', paper: '#FFF7F0' }) },
  { id: 'teal', name: 'Teal', vars: derive({ primary: '#0F7C7C', dark: '#0A2E2E', accent: '#E8A33D', paper: '#F1F9F8' }) },
  { id: 'indigo', name: 'Indigo', vars: derive({ primary: '#3347B0', dark: '#131A45', accent: '#F0B429', paper: '#F4F6FD' }) },
  { id: 'rose', name: 'Rose', vars: derive({ primary: '#C2255C', dark: '#3B0F20', accent: '#3AA17E', paper: '#FDF4F7' }) },
  { id: 'savanna', name: 'Savanna', vars: derive({ primary: '#9A6B12', dark: '#2D2208', accent: '#2E7D5B', paper: '#FBF6E8' }) },
  { id: 'graphite', name: 'Graphite', vars: derive({ primary: '#374151', dark: '#111827', accent: '#D97706', paper: '#F6F7F9' }) },
];
export const DEFAULT_THEME_ID = 'forest';
export const themeById = (id) => MIXES.find((t) => t.id === id) || THEMES.find((t) => t.id === id) || THEMES[0];

/** A school's own colours: pick a main colour and an accent; the rest is worked out. */
export function customTheme(primary, accent, second) {
  const p = isHex(primary) ? primary : '#1F6B45'; const a = isHex(accent) ? accent : '#C9A227'; const s2 = isHex(second) ? second : null;   // second = optional colour to blend into
  return { id: 'custom', name: 'Our colours', vars: derive({ primary: p, primary2: s2 || undefined, dark: mix(p, '#000000', 0.74), accent: a, paper: mix(a, '#FFFFFF', 0.9) }) };
}

/** What we keep: { id } for a built-in theme, or { id: 'custom', primary, accent }. */
export function resolve(saved) {
  if (saved && saved.id === 'custom') return customTheme(saved.primary, saved.accent, saved.second);
  return themeById(saved && saved.id);
}

export const VAR_NAMES = { primary: '--e-primary', primary2: '--e-primary2', dark2: '--e-dark2', primaryDeep: '--e-primary-deep', tint: '--e-tint', dark: '--e-dark', text: '--e-text', muted: '--e-muted', mutedSoft: '--e-muted-soft',
  accent: '--e-accent', accentDeep: '--e-accent-deep', accentTint: '--e-accent-tint', bg: '--e-bg', soft: '--e-soft', border: '--e-border', border2: '--e-border2',
  onPrimary: '--e-on-primary', onDark: '--e-on-dark', onAccent: '--e-on-accent' };

export const storageKey = (tenantId) => `${STORAGE_PREFIX}:${tenantId || 'device'}`;
export function loadSaved(tenantId, storage) {
  try { const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null); if (!s) return null;
    const raw = s.getItem(storageKey(tenantId)) || s.getItem(storageKey(null)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function save(tenantId, value, storage) {
  try { const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null); if (!s) return false;
    const raw = JSON.stringify(value); s.setItem(storageKey(tenantId), raw); s.setItem(storageKey(null), raw); return true; } catch { return false; }
}
