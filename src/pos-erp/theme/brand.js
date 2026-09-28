// src/pos-erp/theme/brand.js
//
// "My Business" colour system -- Forest Green + Emerald + Savanna Gold.
//
// Tailwind classes throughout the app use arbitrary values built from
// these hex codes (e.g. bg-[#123C2A]) so no tailwind.config.js change is
// needed. Tailwind's JIT only sees COMPLETE class strings written out in
// source, so the strings below are literal on purpose -- never build one
// by concatenating a hex at runtime.
//
// Rules of use (from the redesign brief):
//   - Green is for identity + actions (sidebar, buttons, active states).
//   - The working area stays light (Warm Ivory page, White cards).
//   - Gold is an accent (active-nav indicator, small highlights) -- never
//     a large fill.
//   - No gradients, glass, glow, or heavy shadows.

export const BRAND = {
  forestDeep: '#123C2A',
  forest: '#1B5138',
  emerald: '#237A52',
  gold: '#C6A15B',
  ivory: '#F7F6F0',
  white: '#FFFFFF',
  text: '#26352D',
  textMuted: '#68756D',
  border: '#DDE3DD',
};

// Shared literal class strings (kept here so pages stay consistent).
export const CLS = {
  page: 'bg-[#F7F6F0] text-[#26352D]',
  card: 'bg-white border border-[#DDE3DD] rounded-xl',
  btnPrimary: 'bg-[#237A52] hover:bg-[#1B5138] text-white font-semibold rounded-xl transition-colors',
  btnGhost: 'bg-white border border-[#DDE3DD] text-[#26352D] hover:bg-[#F7F6F0] font-semibold rounded-xl transition-colors',
  muted: 'text-[#68756D]',
};
