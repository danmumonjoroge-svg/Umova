// elimu/dashboard/components/charts.jsx -- small SVG/HTML charts that follow the school's colour theme (CSS variables, with the original
// green as fallback). No chart library: nothing extra to install, works offline, scales from phone to wide monitors.
import React from 'react';

export const C = {
  primary: 'var(--e-primary,#1F6B45)', accent: 'var(--e-accent,#C9A227)', tint: 'var(--e-tint,#E4F0E8)', dark: 'var(--e-dark,#12261F)',
  muted: 'var(--e-muted,#6F7461)', mix: 'linear-gradient(90deg,var(--e-primary,#1F6B45),var(--e-primary2,var(--e-primary,#1F6B45)))', grid: 'var(--e-border,#E3DBB8)', soft: 'var(--e-soft,#F4EFD3)', bad: '#B3402A', neutral: '#A5A88F',
};
export const num = (n) => Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 });
export const short = (n) => { const v = Number(n || 0); if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`; if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}K`; return String(Math.round(v)); };

/** Doughnut with a number in the middle. segments: [{label, value, color}] */
export function Donut({ segments, center, sub, size = 168, thickness = 22, label }) {
  const total = segments.reduce((s, x) => s + Number(x.value || 0), 0); const r = (size - thickness) / 2; const cx = size / 2; const circ = 2 * Math.PI * r; let off = 0;
  const desc = segments.map((s) => `${s.label}: ${num(s.value)}`).join(', ');
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label || 'Chart'}. ${desc}`} className="w-full h-auto max-w-[220px] mx-auto">
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={C.soft} strokeWidth={thickness} />
      {total > 0 && segments.map((s, i) => { const len = (Number(s.value || 0) / total) * circ; const el = (
        <circle key={i} cx={cx} cy={cx} r={r} fill="none" stroke={s.color} strokeWidth={thickness} strokeDasharray={`${Math.max(0, len - (segments.length > 1 && len > 2 ? 2 : 0))} ${circ}`} strokeDashoffset={-off} transform={`rotate(-90 ${cx} ${cx})`} />); off += len; return el; })}
      <text x={cx} y={cx + (sub ? 2 : 8)} textAnchor="middle" fontSize="28" fontWeight="800" fill={C.dark}>{center}</text>
      {sub && <text x={cx} y={cx + 20} textAnchor="middle" fontSize="11" fill={C.muted}>{sub}</text>}
    </svg>);
}

export const Legend = ({ items }) => (
  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#6F7461] justify-center mt-2">
    {items.map((s) => <li key={s.label} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.label}{s.value != null && <b className="text-[#23382B]">{num(s.value)}</b>}</li>)}
  </ul>);

/** Rate ring (e.g. 94%) */
export function Ring({ value, size = 96, stroke = 10, color = C.primary, children }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0)); const r = (size - stroke) / 2; const circ = 2 * Math.PI * r;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`${Math.round(v)} percent`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.soft} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(v / 100) * circ} ${circ}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-center">{children}</div>
    </div>);
}

/** Horizontal bars, one per row (students per class). rows: [{label, value}] */
export function HBars({ rows, color = C.mix, format = num, empty = 'Nothing to show yet.' }) {
  if (!rows || rows.length === 0) return <p className="text-sm text-[#6F7461]">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => Number(r.value || 0)));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (<li key={r.label} className="grid items-center gap-2 text-sm" style={{ gridTemplateColumns: 'minmax(4.5rem,28%) 1fr auto' }}>
        <span className="truncate text-[#23382B]" title={r.label}>{r.label}</span>
        <span className="h-3 rounded-full overflow-hidden" style={{ background: C.soft }}><span className="block h-full rounded-full" style={{ width: `${(Number(r.value || 0) / max) * 100}%`, background: r.color || color }} /></span>
        <b className="tabular-nums text-[#12261F] min-w-[2.5rem] text-right">{format(r.value)}</b></li>))}
    </ul>);
}

/** Vertical bars. bars: [{label, value, sub?}]; single series. */
export function Bars({ bars, color = C.primary, height = 170, format = short, label }) {
  if (!bars || bars.length === 0) return null;
  const W = 560, H = height, L = 36, R = 6, T = 14, B = 26; const max = Math.max(1, ...bars.map((b) => Number(b.value || 0))); const bw = (W - L - R) / bars.length;
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const ticks = [0, 0.5, 1].map((f) => f * max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label || 'Bar chart'}. ${bars.map((b) => `${b.label}: ${format(b.value)}`).join(', ')}`} className="w-full h-auto">
      {ticks.map((t, i) => (<g key={i}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={C.grid} strokeDasharray={i === 0 ? '' : '3 4'} /><text x={L - 6} y={y(t) + 3.5} fontSize="10" textAnchor="end" fill={C.muted}>{format(t)}</text></g>))}
      {bars.map((b, i) => { const h = Math.max(Number(b.value) > 0 ? 2 : 0, H - B - y(Number(b.value || 0))); const x = L + i * bw + bw * 0.18; const w = bw * 0.64; return (
        <g key={i}><rect x={x} y={H - B - h} width={w} height={h} rx={Math.min(5, w / 2)} fill={b.color || color} />
          {Number(b.value) > 0 && bars.length <= 16 && <text x={x + w / 2} y={H - B - h - 4} fontSize="9.5" textAnchor="middle" fill={C.dark} fontWeight="700">{format(b.value)}</text>}
          <text x={x + w / 2} y={H - 8} fontSize="10" textAnchor="middle" fill={C.muted}>{b.label}</text></g>); })}
    </svg>);
}

/** Stacked bars (attendance per day). days: [{label, parts: [{value,color}]}] */
export function StackedBars({ days, height = 190, label, legend }) {
  if (!days || days.length === 0) return null;
  const W = 560, H = height, L = 30, R = 6, T = 10, B = 26; const max = Math.max(1, ...days.map((d) => d.parts.reduce((s, p) => s + Number(p.value || 0), 0))); const bw = (W - L - R) / days.length;
  const y = (v) => T + (1 - v / max) * (H - T - B);
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label || 'Stacked bar chart'} className="w-full h-auto">
        {[0, 0.5, 1].map((f, i) => (<g key={i}><line x1={L} x2={W - R} y1={y(f * max)} y2={y(f * max)} stroke={C.grid} strokeDasharray={i === 0 ? '' : '3 4'} /><text x={L - 5} y={y(f * max) + 3.5} fontSize="10" textAnchor="end" fill={C.muted}>{short(f * max)}</text></g>))}
        {days.map((d, i) => { let acc = 0; const x = L + i * bw + bw * 0.16; const w = bw * 0.68; return (
          <g key={i}>{d.parts.map((p, k) => { const h = (Number(p.value || 0) / max) * (H - T - B); const top = H - B - acc - h; acc += h; return h > 0 ? <rect key={k} x={x} y={top} width={w} height={h} fill={p.color} rx={k === d.parts.length - 1 ? Math.min(4, w / 2) : 0} /> : null; })}
            <text x={x + w / 2} y={H - 8} fontSize="9.5" textAnchor="middle" fill={C.muted}>{d.label}</text></g>); })}
      </svg>
      {legend && <Legend items={legend} />}
    </>);
}

/** Smooth-ish area line for a short series. points: [{label, value}] */
export function AreaLine({ points, height = 150, color = C.primary, format = short, label }) {
  if (!points || points.length < 2) return null;
  const W = 560, H = height, L = 38, R = 10, T = 12, B = 24; const max = Math.max(1, ...points.map((p) => Number(p.value || 0)));
  const x = (i) => L + (i * (W - L - R)) / (points.length - 1); const y = (v) => T + (1 - v / max) * (H - T - B);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(Number(p.value || 0))}`).join(' '); const area = `${line} L${x(points.length - 1)},${H - B} L${x(0)},${H - B} Z`;
  const step = Math.ceil(points.length / 7);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label || 'Trend'}. ${points.map((p) => `${p.label}: ${format(p.value)}`).join(', ')}`} className="w-full h-auto">
      {[0, 0.5, 1].map((f, i) => (<g key={i}><line x1={L} x2={W - R} y1={y(f * max)} y2={y(f * max)} stroke={C.grid} strokeDasharray={i === 0 ? '' : '3 4'} /><text x={L - 5} y={y(f * max) + 3.5} fontSize="10" textAnchor="end" fill={C.muted}>{format(f * max)}</text></g>))}
      <path d={area} fill={color} opacity="0.14" /><path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (<g key={i}><circle cx={x(i)} cy={y(Number(p.value || 0))} r="3" fill={color} />{i % step === 0 && <text x={x(i)} y={H - 7} fontSize="9.5" textAnchor="middle" fill={C.muted}>{p.label}</text>}</g>))}
    </svg>);
}
