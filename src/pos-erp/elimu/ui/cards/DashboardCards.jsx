// elimu/ui/cards/DashboardCards.jsx -- the dashboard's cards. Each one has the shape and the feel of the thing it shows:
//   HeroStudents  dark and big: the school's people            AttendanceGauge  a dial, plus one dot per class register
//   FeesLedger    exercise-book page with a red margin         GateTicket       a ticket with a tear-off stub
//   AttentionNote a sticky note with a folded corner           BookSpine        a book standing on a shelf
//   ClassMosaic   tiles as wide as the class is big            StatPill         a small fact that does not need a card
import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, ArrowUpRight } from 'lucide-react';
import { V, MONEY as M, SHAPE, lift, num, kes } from './tokens.js';

const Wrap = ({ to, className = '', style, children, label }) => (to
  ? <Link to={to} aria-label={label} className={`block transition-transform duration-150 active:scale-[.985] hover:-translate-y-0.5 ${className}`} style={style}>{children}</Link>
  : <div className={className} style={style}>{children}</div>);
const Eyebrow = ({ children, color = V.muted }) => <div className="text-[11px] font-bold uppercase tracking-[.09em]" style={{ color }}>{children}</div>;

/** Big dark card. The boys/girls split is one bar, not a second chart. */
export function HeroStudents({ active, boys, girls, left30, pending, to }) {
  const b = Number(boys) || 0; const g = Number(girls) || 0; const total = b + g; const bp = total > 0 ? (b / total) * 100 : 50;
  return (
    <Wrap to={to} label="Open students" className="relative overflow-hidden p-5 md:p-6 h-full flex flex-col" style={{ background: `linear-gradient(150deg,${V.dark},${V.dark2})`, color: V.onDark, borderRadius: SHAPE.hero, boxShadow: lift }}>
      <svg aria-hidden="true" viewBox="0 0 200 200" className="absolute -right-10 -top-12 w-56 h-56 opacity-[.16]" fill="none" stroke={V.accent} strokeWidth="1.5"><circle cx="100" cy="100" r="96" /><circle cx="100" cy="100" r="68" /><circle cx="100" cy="100" r="40" /></svg>
      <Eyebrow color={V.accent}>Learners in school</Eyebrow>
      <div className="mt-1 flex items-end gap-3"><span className="text-[56px] md:text-[64px] leading-none font-black tracking-tight tabular-nums">{num(active)}</span>{to && <ArrowUpRight size={20} className="mb-3 opacity-60" />}</div>
      <p className="mt-1 text-sm opacity-80">{num(b)} boys and {num(g)} girls on the roll today.</p>
      <div className="mt-auto pt-6">
        <div className="flex h-2.5 rounded-full overflow-hidden bg-white/10" role="img" aria-label={`${num(b)} boys, ${num(g)} girls`}>
          <span style={{ width: `${bp}%`, background: V.primary2 === V.primary ? V.accent : V.primary2 }} /><span className="ml-[3px] flex-1" style={{ background: V.accent, opacity: .55 }} />
        </div>
        <div className="mt-1.5 flex justify-between text-[11.5px] opacity-70"><span>Boys {Math.round(bp)}%</span><span>Girls {Math.round(100 - bp)}%</span></div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
          <span><b className="font-extrabold">{num(left30)}</b> <span className="opacity-70">left in 30 days</span></span>
          <span><b className="font-extrabold" style={{ color: Number(pending) > 0 ? V.accent : undefined }}>{num(pending)}</b> <span className="opacity-70">open applications</span></span>
        </div>
      </div>
    </Wrap>);
}

/** A dial for the day's attendance rate; underneath, one dot per class register (filled = submitted). */
export function AttendanceGauge({ rate, present, excused, absent, submitted, expected, to }) {
  const r = rate == null ? 0 : Math.max(0, Math.min(100, rate)); const low = rate != null && rate < 85; const col = low ? V.bad : V.primary;
  const exp = Math.max(0, Number(expected) || 0); const sub = Math.max(0, Number(submitted) || 0); const dots = Math.min(exp, 24);
  return (
    <Wrap to={to} label="Open attendance" className="p-4 pt-5 h-full flex flex-col" style={{ background: '#fff', border: `1px solid ${V.border}`, borderRadius: SHAPE.gauge, boxShadow: lift }}>
      <Eyebrow>Attendance today</Eyebrow>
      <div className="relative mx-auto mt-2 w-full max-w-[210px]">
        <svg viewBox="0 0 200 112" className="w-full h-auto" role="img" aria-label={rate == null ? 'No attendance yet' : `${r} percent present`}>
          <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke={V.soft} strokeWidth="16" strokeLinecap="round" />
          {rate != null && r > 0 && <path d="M20 100 A80 80 0 0 1 180 100" pathLength="100" fill="none" stroke={col} strokeWidth="16" strokeLinecap="round" strokeDasharray={`${r} 100`} />}
        </svg>
        <div className="absolute inset-x-0 bottom-1 text-center leading-none"><div className="text-[34px] font-black tabular-nums" style={{ color: low ? V.bad : V.dark }}>{rate == null ? '—' : `${r}%`}</div><div className="text-[11px] mt-1" style={{ color: V.muted }}>present</div></div>
      </div>
      <div className="mt-3 grid grid-cols-3 text-center text-[11.5px]" style={{ color: V.muted }}>
        {[['Present', present, V.primary], ['Excused', excused, V.accent], ['Absent', absent, V.bad]].map(([l, v, c]) => (
          <div key={l}><b className="block text-base text-[#12261F] tabular-nums" style={{ color: V.dark }}>{num(v)}</b><span className="inline-block pb-0.5" style={{ borderBottom: `2px solid ${c}` }}>{l}</span></div>))}
      </div>
      <div className="mt-auto pt-4">
        <div className="flex flex-wrap gap-1" aria-hidden="true">{Array.from({ length: dots }).map((_, i) => <span key={i} className="h-2.5 w-2.5 rounded-full" style={{ background: i < sub ? V.primary : 'transparent', border: `1.5px solid ${i < sub ? V.primary : V.mutedSoft}` }} />)}</div>
        <p className="mt-1.5 text-xs" style={{ color: V.muted }}><b style={{ color: V.text }}>{sub} of {exp}</b> class registers are in{exp - sub > 0 ? ` — ${exp - sub} to go` : '. All done.'}</p>
      </div>
    </Wrap>);
}

/** Exercise-book page: ruled lines, a red margin, the total underlined twice like a bursar would. Fixed money colours (not themed). */
export function FeesLedger({ today, week, month, outstanding, owing, days = [], methods = [], to }) {
  const owe = Number(outstanding) > 0; const vals = days.map((d) => Number(d.amount || 0)); const max = Math.max(1, ...vals);
  const W = 100, H = 36; const xy = vals.map((v, i) => [(i / Math.max(1, vals.length - 1)) * W, H - 3 - (v / max) * (H - 8)]);
  const line = xy.map(([x, y]) => `${x},${y}`).join(' '); const last = xy[xy.length - 1];
  const METHOD = { MPESA: 'M-Pesa', CASH: 'Cash', BANK: 'Bank', CHEQUE: 'Cheque', OTHER: 'Other' }; const mTotal = methods.reduce((s, m) => s + Number(m.amount || 0), 0);
  const tone = owe ? M.owedFg : M.inFg;
  return (
    <Wrap to={to} className="relative h-full pl-12 pr-4 py-4 md:pr-5 overflow-hidden" style={{ background: `repeating-linear-gradient(to bottom,transparent 0 27px,${M.rule} 27px 28px),${M.paper}`, backgroundPosition: '0 6px', border: `1px solid ${M.rule}`, borderRadius: SHAPE.ledger, boxShadow: lift, color: M.ink }}>
      <span aria-hidden="true" className="absolute top-0 bottom-0 left-9 w-px" style={{ background: M.margin, opacity: .55 }} />
      <span aria-hidden="true" className="absolute top-0 left-0 bottom-0 w-1.5" style={{ background: M.inFg }} />
      <div className="flex items-baseline justify-between gap-2"><div className="text-[11px] font-bold uppercase tracking-[.09em]" style={{ color: M.muted }}>Fees</div><span className="text-[11.5px]" style={{ color: M.muted }}>last 14 days</span></div>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <div><div className="text-[30px] leading-[1.1] font-black tabular-nums" style={{ color: M.inDeep }}>{kes(today)}</div><div className="text-xs" style={{ color: M.muted }}>came in today</div></div>
        {xy.length >= 2 && <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-10 w-28 sm:w-36 overflow-visible" role="img" aria-label="Fees collected over 14 days">
          <polygon points={`0,${H} ${line} ${W},${H}`} fill={M.inFg} opacity=".12" /><polyline points={line} fill="none" stroke={M.inFg} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <circle cx={last[0]} cy={last[1]} r="2.6" fill={M.inFg} vectorEffect="non-scaling-stroke" /></svg>}
      </div>
      <dl className="mt-3 text-sm">
        {[['This week', week], ['Last 30 days', month]].map(([l, v]) => (
          <div key={l} className="flex items-baseline gap-2 leading-[28px]"><dt style={{ color: M.muted }}>{l}</dt><span className="flex-1 border-b border-dotted translate-y-[-3px]" style={{ borderColor: '#B9B39C' }} /><dd className="font-bold tabular-nums">{kes(v)}</dd></div>))}
        <div className="flex items-baseline gap-2 leading-[28px]"><dt className="font-bold" style={{ color: tone }}>Still owed</dt><span className="flex-1" /><dd className="font-black tabular-nums pb-px" style={{ color: tone, borderBottom: `4px double ${tone}` }}>{kes(outstanding)}</dd></div>
      </dl>
      <p className="text-xs mt-0.5" style={{ color: M.muted }}>{owe ? <><b style={{ color: M.owedFg }}>{num(owing)}</b> {Number(owing) === 1 ? 'student owes' : 'students owe'} this.</> : 'Every account is clear.'}</p>
      {mTotal > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{methods.map((m, i) => <span key={m.method} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-bold" style={{ background: M.chip[i % 4], color: M.chipFg[i % 4] }}>{METHOD[m.method] || m.method}<span style={{ opacity: .75 }}>{Math.round((Number(m.amount) / mTotal) * 100)}%</span></span>)}</div>}
    </Wrap>);
}

/** Ticket: what is waiting at the gate on the left, the tear-off stub on the right (or below on a phone). */
export function GateTicket({ waiting, cleared, exited, to }) {
  const bars = [3, 1, 2, 1, 4, 1, 2, 3, 1, 2, 1, 3, 2, 1, 4, 1, 2];
  const notch = (side) => <span aria-hidden="true" className="absolute top-[-9px] h-[18px] w-[18px] rounded-full" style={{ [side]: -10, background: V.bg, border: `1px solid ${V.border}` }} />;
  return (
    <Wrap to={to} label="Open gate passes" className="h-full flex flex-col" style={{ background: V.accentTint, border: `1px solid ${V.border}`, borderRadius: SHAPE.ticket, boxShadow: lift, color: V.dark }}>
      <div className="p-4 pb-5 flex-1"><Eyebrow color={V.accentDeep}>Gate passes</Eyebrow>
        <div className="mt-1 text-[40px] leading-none font-black tabular-nums">{num(Number(waiting) + Number(cleared))}</div>
        <p className="mt-1 text-[12.5px]" style={{ color: V.accentDeep }}>waiting to leave</p>
        <p className="mt-2 text-xs" style={{ color: V.text }}>{num(waiting)} need a parent’s reply · {num(cleared)} cleared at the gate</p></div>
      <div className="relative h-0">{notch('left')}{notch('right')}<div className="mx-3 border-t-2 border-dashed" style={{ borderColor: V.accent }} /></div>
      <div className="p-4 pt-3 flex items-end justify-between gap-3"><div><div className="text-xl font-extrabold tabular-nums leading-none">{num(exited)}</div><div className="text-[11.5px] mt-1" style={{ color: V.accentDeep }}>left today</div></div>
        <svg aria-hidden="true" viewBox="0 0 51 20" className="h-6 w-14 opacity-60" fill={V.dark}>{bars.reduce((a, w, i) => { const x = a.x; a.els.push(<rect key={i} x={x} y="0" width={w} height="20" />); a.x += w + 1.2; return a; }, { x: 0, els: [] }).els}</svg></div>
    </Wrap>);
}

/** A book standing up: coloured spine on the left with two gold bands. */
export function BookSpine({ title, count, hint, tone = 'ok', to }) {
  const c = tone === 'bad' ? V.bad : V.primary;
  return (
    <Wrap to={to} className="flex overflow-hidden" style={{ background: '#fff', border: `1px solid ${V.border}`, borderRadius: SHAPE.spine, boxShadow: lift }}>
      <span aria-hidden="true" className="relative w-4 shrink-0" style={{ background: c }}><i className="absolute inset-x-0 top-3 h-[3px]" style={{ background: V.accent }} /><i className="absolute inset-x-0 top-5 h-px" style={{ background: V.accent }} /><i className="absolute inset-x-0 bottom-3 h-[3px]" style={{ background: V.accent }} /></span>
      <div className="px-3 py-2.5 min-w-0"><div className="text-[22px] leading-none font-black tabular-nums" style={{ color: tone === 'bad' ? V.bad : V.dark }}>{num(count)}</div><div className="text-[12.5px] font-semibold mt-1" style={{ color: V.text }}>{title}</div>{hint && <div className="text-[11.5px]" style={{ color: V.muted }}>{hint}</div>}</div>
    </Wrap>);
}

/** Sticky note with a folded corner. items: [{id, title, detail?, to?}] */
export function AttentionNote({ items = [], title = 'Worth a look today' }) {
  const Row = ({ i }) => { const inner = (<><span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 rounded-full shrink-0" style={{ background: V.accentDeep }} /><span className="flex-1 min-w-0"><span className="block">{i.title}</span>{i.detail && <span className="block text-xs" style={{ color: V.muted }}>{i.detail}</span>}</span>{i.to && <ChevronRight size={16} className="mt-0.5 shrink-0" style={{ color: V.accentDeep }} />}</>);
    const cls = 'flex items-start gap-2.5 py-2 text-[14px] leading-snug'; return i.to ? <Link to={i.to} className={`${cls} hover:underline decoration-dotted underline-offset-4`}>{inner}</Link> : <div className={cls}>{inner}</div>; };
  return (
    <section className="relative h-full p-5 pt-4" style={{ background: V.accentTint, color: V.dark, borderRadius: SHAPE.note, boxShadow: lift, clipPath: 'polygon(0 0,calc(100% - 30px) 0,100% 30px,100% 100%,0 100%)' }}>
      <span aria-hidden="true" className="absolute top-0 right-0 h-[30px] w-[30px]" style={{ background: `linear-gradient(225deg,transparent 50%,${V.accent} 50%)`, opacity: .45 }} />
      <h2 className="text-[15px] font-extrabold pr-8">{title}</h2>
      {items.length === 0 ? <p className="mt-2 text-sm" style={{ color: V.text }}>All quiet. Nothing needs you right now.</p>
        : <ul className="mt-1 divide-y divide-dashed" style={{ borderColor: V.accent }}>{items.map((i) => <li key={i.id} style={{ borderColor: V.accent }}><Row i={i} /></li>)}</ul>}
    </section>);
}

/** One tile per class, each as wide as the class is big, so the shape of the school shows at a glance. rows: [{label, value}] */
export function ClassMosaic({ rows = [], to, empty = 'No one is enrolled in the current year yet.' }) {
  if (rows.length === 0) return <p className="text-sm" style={{ color: V.muted }}>{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => Number(r.value || 0)));
  return (
    <ul className="flex flex-wrap gap-2">
      {rows.map((r) => { const f = Number(r.value || 0) / max; const big = f >= 0.9; const inner = (<>
        <span className="block text-[11.5px] font-semibold truncate" style={{ opacity: big ? .85 : 1, color: big ? V.onDark : V.text }}>{r.label}</span>
        <span className="block text-[22px] leading-tight font-black tabular-nums" style={{ color: big ? V.onDark : V.dark }}>{num(r.value)}</span></>);
        const flex = `${Math.max(1, Math.round(f * 10))} 1 ${Math.round(78 + f * 70)}px`; const st = { background: big ? V.primary : `color-mix(in srgb, ${V.primary} ${Math.round(8 + f * 22)}%, #fff)`, borderRadius: big ? 20 : 14, padding: '9px 12px' };
        return <li key={r.label} className="min-w-0" style={{ display: 'flex', flex }}>{to ? <Link to={to} className="w-full" style={st}>{inner}</Link> : <div className="w-full" style={st}>{inner}</div>}</li>; })}
    </ul>);
}

/** A small fact with no card around it. */
export const StatPill = ({ label, value, tone, to }) => { const body = (<span className="inline-flex items-center gap-2 rounded-full pl-1 pr-3.5 py-1 text-[12.5px]" style={{ background: V.soft, color: V.text }}>
  <span className="min-w-[1.6rem] h-6 px-1.5 inline-flex items-center justify-center rounded-full text-[12px] font-extrabold tabular-nums" style={{ background: tone === 'bad' ? V.bad : V.primary, color: '#fff' }}>{num(value)}</span>{label}</span>); return to ? <Link to={to}>{body}</Link> : body; };

/** Panel for charts: no border, a soft wash, a heading with room to breathe. */
export const Wash = ({ title, aside, children, className = '', tone = 'tint' }) => (
  <section className={`h-full p-4 md:p-5 ${className}`} style={{ background: tone === 'white' ? '#fff' : V.soft, border: tone === 'white' ? `1px solid ${V.border}` : 'none', borderRadius: SHAPE.paper }}>
    {(title || aside) && <div className="flex items-baseline justify-between gap-2 mb-3"><h2 className="text-[14px] font-extrabold" style={{ color: V.dark }}>{title}</h2>{aside}</div>}{children}</section>);

/** The action dock: one clear main button, the rest as quieter links. links: [{to,label,primary?}] */
export function ActionDock({ links = [] }) {
  if (links.length === 0) return null; const main = links.filter((l) => l.primary); const rest = links.filter((l) => !l.primary);
  return (<div className="flex flex-wrap items-center gap-2">
    {main.map((l) => <Link key={l.to} to={l.to} className="inline-flex items-center gap-1.5 min-h-[44px] px-5 rounded-full text-sm font-bold bg-[#1F6B45] text-white shadow-sm active:scale-[.98]">{l.label}</Link>)}
    {rest.map((l) => <Link key={l.to} to={l.to} className="inline-flex items-center gap-1 min-h-[44px] px-3.5 rounded-full text-sm font-semibold hover:bg-[#F4EFD3]" style={{ color: V.text, border: `1px dashed ${V.mutedSoft}` }}>{l.label}<ChevronRight size={14} /></Link>)}</div>);
}
