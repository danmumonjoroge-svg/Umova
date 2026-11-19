// elimu/ui/cards/ListCards.jsx -- cards for the people and things that fill the other Elimu pages. Each kind of record has its own shape,
// so a list of students does not look like a list of notices, trips or library books.
//   PersonCard   student or guardian: avatar that overlaps the edge, name, class, one status chip
//   NoticeCard   a pinned notice with a tear-off date                    TripCard   a date block and a dashed fold
//   DocCard      a folder with a tab: study materials, assignments       BookCard   a book with a coloured spine
//   InfoCard     the plain white card, for everything else               EmptyNote  a friendly "nothing here yet"
import React from 'react';
import { Link } from 'react-router-dom';
import { Pin, MapPin, Clock } from 'lucide-react';
import { V, SHAPE, lift, initials, avatarFor } from './tokens.js';

const Wrap = ({ to, onClick, className = '', style, children }) => (to ? <Link to={to} className={`block transition-transform duration-150 active:scale-[.985] hover:-translate-y-0.5 ${className}`} style={style}>{children}</Link>
  : onClick ? <button type="button" onClick={onClick} className={`block w-full text-left transition-transform duration-150 active:scale-[.985] ${className}`} style={style}>{children}</button>
  : <div className={className} style={style}>{children}</div>);
const Chip = ({ children, tone = 'ok' }) => { const m = { ok: [V.tint, V.deep], warn: [V.accentTint, V.accentDeep], bad: [V.badTint, V.bad], quiet: [V.soft, V.muted] }[tone] || [V.soft, V.muted]; return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-bold whitespace-nowrap" style={{ background: m[0], color: m[1] }}>{children}</span>; };
export { Chip };

/** Student / guardian row. The avatar sits half over the card's left edge. status: {label, tone}. */
export function PersonCard({ name, meta, status, aside, photo, to, onClick }) {
  const [bg, fg] = avatarFor(name);
  return (
    <Wrap to={to} onClick={onClick} className="relative ml-6 pl-9 pr-3.5 py-3 min-h-[60px]" style={{ background: '#fff', border: `1px solid ${V.border}`, borderRadius: '10px 22px 22px 10px', boxShadow: lift }}>
      <span aria-hidden={!!photo} className="absolute -left-6 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full flex items-center justify-center text-[15px] font-extrabold overflow-hidden" style={{ background: bg, color: fg, boxShadow: `0 0 0 3px ${V.bg}` }}>
        {photo ? <img src={photo} alt={name} className="h-full w-full object-cover" /> : initials(name)}</span>
      <div className="flex items-center gap-3"><div className="min-w-0 flex-1"><div className="font-bold text-[15px] truncate" style={{ color: V.dark }}>{name}</div>{meta && <div className="text-xs truncate" style={{ color: V.muted }}>{meta}</div>}</div>
        <div className="text-right shrink-0 space-y-1">{status && <Chip tone={status.tone}>{status.label}</Chip>}{aside && <div className="text-xs font-semibold tabular-nums" style={{ color: V.text }}>{aside}</div>}</div></div>
    </Wrap>);
}

/** Notice: a pin, the headline, and the date torn off on the right. */
export function NoticeCard({ title, body, day, month, pinned, audience, to, onClick }) {
  return (
    <Wrap to={to} onClick={onClick} className="relative flex overflow-hidden" style={{ background: pinned ? V.accentTint : '#fff', border: `1px solid ${V.border}`, borderRadius: '8px 22px 8px 22px', boxShadow: lift }}>
      <div className="flex-1 min-w-0 p-4"><div className="flex items-center gap-1.5">{pinned && <Pin size={13} style={{ color: V.accentDeep }} />}{audience && <span className="text-[11px] font-bold uppercase tracking-[.08em]" style={{ color: V.muted }}>{audience}</span>}</div>
        <h3 className="mt-0.5 font-extrabold text-[15px] leading-snug" style={{ color: V.dark }}>{title}</h3>{body && <p className="mt-1 text-[13px] line-clamp-3" style={{ color: V.text }}>{body}</p>}</div>
      {(day || month) && <div className="w-[62px] shrink-0 flex flex-col items-center justify-center border-l-2 border-dashed text-center" style={{ borderColor: pinned ? V.accent : V.border }}><div className="text-xl font-black leading-none tabular-nums" style={{ color: V.dark }}>{day}</div><div className="text-[11px] font-bold uppercase mt-0.5" style={{ color: V.muted }}>{month}</div></div>}
    </Wrap>);
}

/** Trip or event: a bold date block, then where and when. */
export function TripCard({ title, day, month, place, time, status, to, onClick }) {
  return (
    <Wrap to={to} onClick={onClick} className="flex items-stretch gap-0 overflow-hidden" style={{ background: '#fff', border: `1px solid ${V.border}`, borderRadius: '22px 8px 22px 8px', boxShadow: lift }}>
      <div className="w-[70px] shrink-0 flex flex-col items-center justify-center py-3 text-center" style={{ background: `linear-gradient(160deg,${V.primary},${V.primary2})`, color: '#fff' }}><div className="text-[26px] font-black leading-none tabular-nums">{day}</div><div className="text-[11px] font-bold uppercase tracking-wide mt-1 opacity-90">{month}</div></div>
      <div className="p-3.5 min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><h3 className="font-extrabold text-[15px] leading-snug" style={{ color: V.dark }}>{title}</h3>{status && <Chip tone={status.tone}>{status.label}</Chip>}</div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs" style={{ color: V.muted }}>{place && <span className="inline-flex items-center gap-1"><MapPin size={12} />{place}</span>}{time && <span className="inline-flex items-center gap-1"><Clock size={12} />{time}</span>}</div></div>
    </Wrap>);
}

/** Folder with a tab: study materials, assignments, files. */
export function DocCard({ tab, title, meta, footer, status, to, onClick }) {
  return (
    <Wrap to={to} onClick={onClick} className="relative mt-5">
      <span className="absolute -top-[19px] left-0 h-5 px-3 rounded-t-xl text-[11px] font-bold inline-flex items-center max-w-[70%] truncate" style={{ background: V.tint, color: V.deep, border: `1px solid ${V.border}`, borderBottom: 'none' }}>{tab || 'File'}</span>
      <div className="p-4" style={{ background: '#fff', border: `1px solid ${V.border}`, borderRadius: SHAPE.tab, boxShadow: lift }}>
        <div className="flex items-start justify-between gap-2"><h3 className="font-extrabold text-[15px] leading-snug" style={{ color: V.dark }}>{title}</h3>{status && <Chip tone={status.tone}>{status.label}</Chip>}</div>
        {meta && <p className="mt-1 text-[13px]" style={{ color: V.muted }}>{meta}</p>}{footer && <div className="mt-3 pt-2.5 border-t border-dashed text-xs" style={{ borderColor: V.border, color: V.text }}>{footer}</div>}</div>
    </Wrap>);
}

/** Library book: coloured spine, title, author, due date. */
export function BookCard({ title, author, due, overdue, status, to, onClick, spine }) {
  const c = spine || (overdue ? V.bad : V.primary);
  return (
    <Wrap to={to} onClick={onClick} className="flex overflow-hidden" style={{ background: '#fff', border: `1px solid ${V.border}`, borderRadius: SHAPE.spine, boxShadow: lift }}>
      <span aria-hidden="true" className="relative w-5 shrink-0" style={{ background: c }}><i className="absolute inset-x-0 top-3 h-[3px]" style={{ background: V.accent }} /><i className="absolute inset-x-0 top-[22px] h-px" style={{ background: V.accent }} /><i className="absolute inset-x-0 bottom-3 h-[3px]" style={{ background: V.accent }} /></span>
      <div className="p-3.5 min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><h3 className="font-extrabold text-[15px] leading-snug" style={{ color: V.dark }}>{title}</h3>{status && <Chip tone={status.tone}>{status.label}</Chip>}</div>
        {author && <p className="text-[13px] italic" style={{ color: V.muted }}>{author}</p>}{due && <p className="mt-1.5 text-xs font-semibold" style={{ color: overdue ? V.bad : V.text }}>{due}</p>}</div>
    </Wrap>);
}

/** The plain white card, for anything that has no shape of its own. */
export const InfoCard = ({ title, aside, children, className = '', tone = 'paper' }) => (
  <section className={`p-4 ${className}`} style={{ background: tone === 'tint' ? V.tint : tone === 'soft' ? V.soft : '#fff', border: tone === 'paper' ? `1px solid ${V.border}` : 'none', borderRadius: SHAPE.paper, boxShadow: tone === 'paper' ? lift : 'none' }}>
    {(title || aside) && <div className="flex items-baseline justify-between gap-2 mb-2.5"><h2 className="text-[14px] font-extrabold" style={{ color: V.dark }}>{title}</h2>{aside}</div>}{children}</section>);

/** Friendly empty state. */
export const EmptyNote = ({ title = 'Nothing here yet', children }) => (
  <div className="rounded-[22px_8px_22px_8px] border-2 border-dashed px-5 py-8 text-center" style={{ borderColor: V.border, color: V.muted }}><div className="font-bold text-[15px]" style={{ color: V.text }}>{title}</div>{children && <p className="text-sm mt-1">{children}</p>}</div>);
