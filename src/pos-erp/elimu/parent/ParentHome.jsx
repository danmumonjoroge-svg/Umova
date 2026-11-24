// The parent home: a hero for the child being shown (colour, initials, three numbers that matter) and four big purpose-shaped tiles.
import React, { useEffect, useState } from 'react';
import { CalendarCheck, GraduationCap, Wallet, Megaphone } from 'lucide-react';
import { parentApi } from './parentClient.js';
import { attendanceRate, initials, feeTone } from './summary.js';

const money = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;

export function Skeleton({ rows = 3 }) {
  return (<div className="p-3 space-y-2" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }).map((_, i) => (
    <div key={i} className="rounded-2xl h-16 elimu-skel" style={{ opacity: 1 - i * 0.18 }} />))}</div>);
}

function useSafe(fn, deps) {
  const [v, setV] = useState({ loading: true, data: null });
  useEffect(() => { let live = true; setV({ loading: true, data: null }); Promise.resolve().then(fn).then((d) => live && setV({ loading: false, data: d })).catch(() => live && setV({ loading: false, data: null }));
    return () => { live = false; }; /* eslint-disable-next-line */ }, deps);
  return v;
}

export function ChildHero({ child, colour, onOpen }) {
  const att = useSafe(() => parentApi.attendance(child.student_id), [child.student_id]);
  const fees = useSafe(() => (child.can_see_fees ? parentApi.fees(child.student_id) : null), [child.student_id, child.can_see_fees]);
  const res = useSafe(() => (child.can_see_results ? parentApi.results(child.student_id) : null), [child.student_id, child.can_see_results]);
  const rate = attendanceRate(att.data); const owed = fees.data?.outstanding_total; const last = res.data?.[0];
  const stat = (label, value, sub, tab) => (
    <button type="button" onClick={() => onOpen(tab)} className="flex-1 min-w-0 rounded-2xl bg-white/15 px-2.5 py-2 text-left active:bg-white/25">
      <div className="text-[10.5px] uppercase tracking-wide opacity-80">{label}</div><div className="text-lg font-bold leading-tight truncate">{value}</div><div className="text-[10.5px] opacity-80 truncate">{sub}</div></button>);
  return (
    <section className="rounded-[26px_26px_26px_8px] text-white p-4 shadow-[0_10px_24px_-14px_rgba(18,38,31,.6)]" style={{ background: `linear-gradient(135deg, ${colour}, ${colour}cc)` }} data-testid="child-hero">
      <div className="flex items-center gap-3">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-xl font-bold" aria-hidden="true">{initials(child.name)}</span>
        <div className="min-w-0"><div className="text-xl font-bold leading-tight truncate">{child.name}</div>
          <div className="text-sm opacity-90 truncate">{child.class_name || 'Not in a class yet'}{child.admission_no ? ` · ${child.admission_no}` : ''}</div></div></div>
      <div className="mt-3 flex gap-2">
        {stat('Attendance', rate == null ? '—' : `${rate}%`, att.loading ? 'loading' : 'last 30 days', 'attendance')}
        {child.can_see_fees && stat('Fees', owed == null ? '—' : feeTone(owed) === 'good' ? 'Paid up' : money(owed), feeTone(owed) === 'good' ? 'nothing owed' : 'balance', 'fees')}
        {child.can_see_results && stat('Latest', last ? (last.grade || `${Number(last.mean_percentage).toFixed(0)}%`) : '—', last ? `${last.term}` : 'no report yet', 'results')}
      </div>
    </section>);
}

const TILES = [
  { tab: 'attendance', label: 'Attendance', hint: 'Arrival and absences', Icon: CalendarCheck, bg: '#E4F0E8', fg: '#1F6B45', shape: '22px 22px 22px 6px' },
  { tab: 'results', label: 'Results', hint: 'Report cards', Icon: GraduationCap, bg: '#FBF0CF', fg: '#7A5E0B', shape: '22px 6px 22px 22px', needs: 'can_see_results' },
  { tab: 'fees', label: 'Fees', hint: 'Balance and payments', Icon: Wallet, bg: '#F4E3DA', fg: '#8A4B2A', shape: '6px 22px 22px 22px', needs: 'can_see_fees' },
  { tab: 'notices', label: 'Notices', hint: 'From the school', Icon: Megaphone, bg: '#E3ECF6', fg: '#2F5D8A', shape: '22px 22px 6px 22px' },
];
export function QuickTiles({ child, onOpen }) {
  return (<div className="grid grid-cols-2 gap-2.5">{TILES.filter((t) => !t.needs || child[t.needs]).map(({ tab, label, hint, Icon, bg, fg, shape }) => (
    <button key={tab} type="button" onClick={() => onOpen(tab)} className="text-left p-3.5 min-h-[92px] active:scale-[.98] transition-transform" style={{ background: bg, borderRadius: shape }}>
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/70" style={{ color: fg }}><Icon size={20} /></span>
      <div className="mt-2 font-bold text-[15px]" style={{ color: fg }}>{label}</div><div className="text-[11.5px] text-slate-600">{hint}</div></button>))}</div>);
}
