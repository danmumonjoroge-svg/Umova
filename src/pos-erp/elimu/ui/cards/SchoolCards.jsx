// elimu/ui/cards/SchoolCards.jsx -- cards for the school's own things, each shaped like the object it stands for.
//   ClassPlate      the plate on a classroom door: name on a dark board, streams as little tabs below
//   StaffBadge      an ID badge hanging on a lanyard: slot at the top, initials, name, role chips, on/off dot
//   ApplicationCard an admission form on a clipboard: a clip at the top and a row of steps showing how far it has got
//   PassTicket      a gate pass as a boarding pass: coloured edge for its state, a stub with the valid-until time
//   ExamPaper       an exam as a sheet of paper: date block on the left, ruled lines for subject, time and place
import React from 'react';
import { V, SHAPE, lift, initials, avatarFor } from './tokens.js';
import { Chip } from './ListCards.jsx';

const Tap = ({ onClick, className = '', style, children, label }) => (onClick
  ? <button type="button" onClick={onClick} aria-label={label} className={`block w-full text-left transition-transform duration-150 active:scale-[.985] hover:-translate-y-0.5 ${className}`} style={style}>{children}</button>
  : <div className={className} style={style}>{children}</div>);
const Screw = ({ className }) => <i aria-hidden className={`absolute h-1.5 w-1.5 rounded-full ${className}`} style={{ background: 'rgba(255,255,255,.35)' }} />;

/** streams: [name]. wide spans two columns of a grid. */
export function ClassPlate({ name, streams = [], off, footer, wide }) {
  return (
    <section className={`relative overflow-hidden ${wide ? 'col-span-2' : ''}`} style={{ background: '#fff', border: `1px solid ${V.border}`, borderRadius: SHAPE.paper, boxShadow: lift, opacity: off ? .6 : 1 }}>
      <div className="relative px-4 py-4" style={{ background: V.dark, color: '#fff' }}><Screw className="left-2 top-2" /><Screw className="right-2 top-2" /><Screw className="left-2 bottom-2" /><Screw className="right-2 bottom-2" />
        <div className="text-center text-[22px] leading-none font-black tracking-wide">{name}</div>{off && <div className="mt-1 text-center text-[10px] font-bold uppercase tracking-widest" style={{ color: V.accent }}>not in use</div>}</div>
      <div className="p-3"><div className="flex flex-wrap gap-1.5 min-h-[28px]">{streams.length === 0 ? <span className="text-xs" style={{ color: V.muted }}>No streams</span>
        : streams.map((s) => <span key={s} className="px-2.5 py-0.5 text-[12px] font-bold" style={{ background: V.tint, color: V.deep, borderRadius: '4px 12px 4px 12px' }}>{s}</span>)}</div>
        {footer && <div className="mt-2.5 pt-2 border-t border-dashed flex gap-3 text-sm font-semibold" style={{ borderColor: V.border, color: V.primary }}>{footer}</div>}</div>
    </section>);
}

/** roles: [label]. */
export function StaffBadge({ name, you, roles = [], active = true, owner, onClick }) {
  const [bg, fg] = avatarFor(name);
  return (
    <Tap onClick={onClick} label={name} className="relative mt-3 pt-6 pb-3.5 px-3.5 text-center" style={{ background: '#fff', border: `1px solid ${V.border}`, borderRadius: '10px 10px 22px 22px', boxShadow: lift, opacity: active ? 1 : .65 }}>
      <span aria-hidden className="absolute -top-3 left-1/2 -translate-x-1/2 h-3 w-14 rounded-full" style={{ background: V.border }}><i className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-1.5 w-8 rounded-full" style={{ background: V.bg }} /></span>
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full text-[18px] font-black" style={{ background: bg, color: fg }}>{initials(name)}</span>
      <span className="mt-2 block font-extrabold text-[14.5px] leading-tight truncate" style={{ color: V.dark }}>{name}{you ? ' (you)' : ''}</span>
      <span className="mt-1.5 flex flex-wrap justify-center gap-1">{owner ? <Chip tone="warn">Owner</Chip> : roles.length ? roles.slice(0, 3).map((r) => <Chip key={r} tone="ok">{r}</Chip>) : <Chip tone="quiet">No role yet</Chip>}</span>
      <span className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: active ? V.primary : V.bad }}><i className="h-2 w-2 rounded-full" style={{ background: active ? V.primary : V.bad }} />{active ? 'Active' : 'Switched off'}</span>
    </Tap>);
}

const STEPS = ['Applied', 'Reviewed', 'Offered', 'Admitted'];
const STAGE = { APPLIED: 0, SUBMITTED: 0, IN_REVIEW: 1, ACCEPTED: 2, ADMITTED: 3, WAITLISTED: 1, REJECTED: -1, WITHDRAWN: -1 };
/** category = the admission status category; status = {label, tone}. */
export function ApplicationCard({ name, meta, category, status, onClick }) {
  const at = STAGE[category] ?? 0; const dead = at < 0;
  return (
    <Tap onClick={onClick} label={`${name}, ${status?.label || ''}`} className="relative pt-5 pb-3.5 px-4" style={{ background: V.bg, border: `1px solid ${V.border}`, borderRadius: '8px 8px 20px 20px', boxShadow: lift }}>
      <span aria-hidden className="absolute -top-2 left-1/2 -translate-x-1/2 h-4 w-16 rounded-md" style={{ background: V.dark }} />
      <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="font-extrabold text-[15px] truncate" style={{ color: V.dark }}>{name}</div><div className="text-xs" style={{ color: V.muted }}>{meta}</div></div>{status && <Chip tone={status.tone}>{status.label}</Chip>}</div>
      <ol className="mt-3 flex items-center" aria-label="Progress">{STEPS.map((s, i) => (
        <li key={s} className="flex-1 flex items-center last:flex-none"><span className="flex flex-col items-center"><i className="h-3 w-3 rounded-full" style={{ background: dead ? V.border : i <= at ? V.primary : V.border, outline: i === at && !dead ? `3px solid ${V.tint}` : 'none' }} /><span className="mt-1 text-[10px] font-semibold" style={{ color: i <= at && !dead ? V.deep : V.mutedSoft }}>{s}</span></span>
          {i < STEPS.length - 1 && <i className="mb-3.5 h-0.5 flex-1 mx-1" style={{ background: !dead && i < at ? V.primary : V.border }} />}</li>))}</ol>
    </Tap>);
}

/** state: {label, tone: 'ok'|'warn'|'bad'|'quiet'}. */
export function PassTicket({ student, meta, state, lines = [], stubTop, stubBottom, children }) {
  const col = { ok: V.primary, warn: V.accent, bad: V.bad, quiet: V.mutedSoft }[state?.tone || 'quiet'];
  return (
    <section className="flex overflow-hidden" style={{ background: '#fff', border: `1px solid ${V.border}`, borderRadius: SHAPE.ticket, boxShadow: lift }}>
      <i aria-hidden className="w-2 shrink-0" style={{ background: col }} />
      <div className="min-w-0 flex-1 p-3.5"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="font-extrabold text-[15px]" style={{ color: V.dark }}>{student}</div><div className="text-xs" style={{ color: V.muted }}>{meta}</div></div>{state && <Chip tone={state.tone}>{state.label}</Chip>}</div>
        <div className="mt-1.5 space-y-0.5 text-xs" style={{ color: V.text }}>{lines.filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}</div>{children && <div className="mt-2">{children}</div>}</div>
      {(stubTop || stubBottom) && <div className="w-[84px] shrink-0 border-l-2 border-dashed flex flex-col items-center justify-center text-center px-1.5" style={{ borderColor: V.border, background: V.soft }}>
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: V.muted }}>{stubTop}</span><span className="text-[12px] font-extrabold leading-tight" style={{ color: V.dark }}>{stubBottom}</span></div>}
    </section>);
}

/** day/month/weekday: the date block. lines: strings. */
export function ExamPaper({ title, sub, day, month, weekday, lines = [], status, children }) {
  return (
    <section className="flex overflow-hidden" style={{ background: V.bg, border: `1px solid ${V.border}`, borderRadius: '4px 20px 20px 4px', boxShadow: lift }}>
      <div className="w-[68px] shrink-0 flex flex-col items-center justify-center py-3 text-center" style={{ background: day ? V.dark : V.soft, color: day ? '#fff' : V.muted }}>
        {day ? <><span className="text-[10px] font-bold uppercase tracking-wider opacity-75">{weekday}</span><span className="text-[26px] leading-none font-black tabular-nums">{day}</span><span className="text-[11px] font-bold uppercase">{month}</span></> : <span className="text-[11px] font-bold px-1">No date yet</span>}</div>
      <div className="min-w-0 flex-1 p-3.5" style={{ backgroundImage: `repeating-linear-gradient(to bottom,transparent 0 23px,${V.border2} 23px 24px)`, backgroundPosition: '0 30px' }}>
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="font-extrabold text-[15px] leading-snug" style={{ color: V.dark }}>{title}</div><div className="text-xs" style={{ color: V.muted }}>{sub}</div></div>{status && <Chip tone={status.tone}>{status.label}</Chip>}</div>
        <div className="mt-1.5 space-y-0.5 text-[13px]" style={{ color: V.text }}>{lines.filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}</div>{children && <div className="mt-2 flex gap-2 flex-wrap">{children}</div>}</div>
    </section>);
}

/** TallyStrip: a register's running count. A segmented bar over big numbers; the first item is the lead figure.
 *  items: [{label, value, tone?: 'ok'|'bad'|'warn'|'quiet'}]. showBar draws the proportion bar (use for parts of a whole). */
export function TallyStrip({ items = [], showBar = true }) {
  const COL = { ok: V.primary, bad: V.bad, warn: V.accent, quiet: V.mutedSoft };
  const tones = items.map((it, i) => it.tone || ['ok', 'bad', 'warn', 'quiet'][i % 4]);
  const sum = items.reduce((s, it) => s + Math.max(0, Number(it.value) || 0), 0);
  return (
    <div className="mb-3 px-4 py-3" style={{ background: V.soft, border: `1px solid ${V.border}`, borderRadius: '24px 8px 24px 8px', boxShadow: lift }}>
      {showBar && sum > 0 && <div className="flex h-2 mb-3 overflow-hidden rounded-full" style={{ background: V.border }} aria-hidden>
        {items.map((it, i) => (Number(it.value) > 0 ? <i key={it.label} className="block h-full" style={{ width: `${(Number(it.value) / sum) * 100}%`, background: COL[tones[i]] }} /> : null))}</div>}
      <ul className="flex flex-wrap gap-x-5 gap-y-2">{items.map((it, i) => (
        <li key={it.label} className={i === 0 ? 'mr-2' : ''}><span className={`block font-black tabular-nums leading-none ${i === 0 ? 'text-3xl' : 'text-xl'}`} style={{ color: COL[tones[i]] === V.mutedSoft ? V.text : COL[tones[i]] }}>{it.value}</span>
          <span className="mt-1 flex items-center gap-1 text-[11px]" style={{ color: V.muted }}><i aria-hidden className="h-2 w-2 rounded-full" style={{ background: COL[tones[i]] }} />{it.label}</span></li>))}</ul>
    </div>);
}
