// src/pos-erp/theme/brand.js
//
// "My Business" colour system -- Forest Green + Emerald + Savanna Gold.
// Golden-green theme: deep forest for identity, warm cream working area,
// gold used on every card edge/active state so the app reads gold + green.
//
// Tailwind's JIT only sees COMPLETE class strings written out in source,
// so the strings below are literal on purpose.
//
// For list pages use components/CardKit.jsx (small cards, fits the screen).

export const BRAND = {
  forestDeep: '#0F3B2A',
  forest: '#17553A',
  emerald: '#1F6B45',
  leaf: '#2E7D52',
  gold: '#C9A227',
  goldDeep: '#8A6A12',
  goldSoft: '#FBF3D5',
  ivory: '#FAF7EA',
  white: '#FFFFFF',
  text: '#23382B',
  textMuted: '#6F7461',
  border: '#E3DBB8',
};

export const CLS = {
  page: 'bg-[#FAF7EA] text-[#23382B]',
  card: 'bg-white border border-[#E3DBB8] rounded-xl',
  btnPrimary: 'bg-[#1F6B45] hover:bg-[#17553A] text-white font-semibold rounded-xl border-b-2 border-[#C9A227] transition-colors',
  btnGhost: 'bg-white border border-[#E3DBB8] text-[#23382B] hover:bg-[#FAF7EA] font-semibold rounded-xl transition-colors',
  muted: 'text-[#6F7461]',
};
