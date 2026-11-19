// elimu/ui/cards/tokens.js -- the colours every card uses. They are the school's theme variables (set by ThemeSwitcher) with the
// original green/gold as fallback, so a card looks right in every theme and also before a theme is applied.
export const V = {
  primary: 'var(--e-primary,#1F6B45)', primary2: 'var(--e-primary2,var(--e-primary,#1F6B45))', deep: 'var(--e-primary-deep,#1B5138)',
  tint: 'var(--e-tint,#E4F0E8)', dark: 'var(--e-dark,#12261F)', dark2: 'var(--e-dark2,#12261F)', onDark: 'var(--e-on-dark,#FFFFFF)',
  accent: 'var(--e-accent,#C9A227)', accentDeep: 'var(--e-accent-deep,#8A6D0B)', accentTint: 'var(--e-accent-tint,#F6EBC4)',
  bg: 'var(--e-bg,#FBF8EA)', soft: 'var(--e-soft,#F4EFD3)', border: 'var(--e-border,#E3DBB8)', border2: 'var(--e-border2,#F0ECD9)',
  text: 'var(--e-text,#23382B)', muted: 'var(--e-muted,#6F7461)', mutedSoft: 'var(--e-muted-soft,#A5A88F)',
  bad: '#B3402A', badTint: '#F8E4DE',
};
// A few shapes. Each kind of card gets ONE of them, so a card's outline tells you what it is before you read it.
export const SHAPE = {
  hero: '34px 34px 34px 10px',      // the big "who is in school" card
  gauge: '10px 30px 30px 30px',     // today's attendance
  paper: '18px',                    // plain information
  ticket: '22px',                   // gate pass
  note: '8px 8px 8px 8px',          // sticky note (the folded corner is drawn separately)
  ledger: '6px 22px 22px 6px',      // exercise-book page: square on the binding side
  spine: '6px 18px 18px 6px',       // book
  tab: '4px 20px 20px 20px',        // folder
};
export const lift = '0 1px 2px rgba(18,38,31,.05), 0 6px 18px -8px rgba(18,38,31,.14)';
export const num = (n) => Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 });
export const kes = (n) => `KES ${num(n)}`;
export const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
// Avatar colours: stable per person, chosen from the theme (so a school's colours still show) plus a few warm neutrals.
const AVATARS = [['var(--e-primary,#1F6B45)', '#fff'], ['var(--e-accent,#C9A227)', 'var(--e-dark,#12261F)'], ['var(--e-dark,#12261F)', '#fff'], ['var(--e-tint,#E4F0E8)', 'var(--e-primary-deep,#1B5138)'], ['var(--e-accent-tint,#F6EBC4)', 'var(--e-accent-deep,#8A6D0B)']];
export function avatarFor(name) { let h = 0; for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return AVATARS[h % AVATARS.length]; }

// Money has its own fixed palette: it does NOT follow the theme switcher, so fees look the same (and stay readable) in every school colour.
// jade = money in, terracotta = money owed, gold = waiting/pending, ink = figures on warm paper.
export const MONEY = {
  paper: '#FFFDF7', rule: '#EAE5D3', margin: '#D9776A', ink: '#10261E', muted: '#6B7568',
  inFg: '#0B7A5A', inBg: '#E2F4EC', inDeep: '#075B43',
  owedFg: '#B5452B', owedBg: '#FBE9E2',
  waitFg: '#94650F', waitBg: '#FBF0D2',
  chip: ['#E2F4EC', '#E8EEF9', '#FBF0D2', '#F1ECE3'], chipFg: ['#075B43', '#2F4A8C', '#7A5509', '#5C5648'],
};
