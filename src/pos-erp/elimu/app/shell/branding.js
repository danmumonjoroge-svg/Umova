// elimu/app/shell/branding.js -- school identity helpers for the header. Pure.
/** 'Sunrise Academy' -> 'SA'; 'st. mary's' -> 'SM'; empty -> 'E'. */
export function schoolInitials(name) {
  const words = String(name || '').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter((w) => w && !/^(the|of|and|&)$/i.test(w));
  if (!words.length) return 'E';
  const pick = (words.length === 1 ? [words[0]] : [words[0], words[1]]);
  return pick.map((w) => w.charAt(0)).join('').toUpperCase();
}
/** Only an http(s) image URL is ever used as a logo. */
export const safeLogoUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);
