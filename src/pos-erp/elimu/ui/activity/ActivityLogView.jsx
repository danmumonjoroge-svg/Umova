// elimu/ui/activity/ActivityLogView.jsx -- the activity log as an ERP screen, not a list.
//   top      three summary tiles of different sizes (today, who was active, busiest area)
//   filters  one sticky bar: search, what-kind chips, how far back, which area
//   feed     a timeline grouped by day. Sign-ins are slim one-liners; changes are cards; removals and money get more weight
//   detail   laptop: a panel on the right showing what changed (before -> after). Phone: the same panel opens under the row.
// It only needs `entries` (any usual field names, see normalizeEntry), so it can sit on top of the existing audit service unchanged.
import React, { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, LogIn, Wallet, Activity, Search, X, RefreshCw, Globe, Clock, ChevronDown, ArrowRight } from 'lucide-react';
import { V, MONEY as M, lift, num, initials, avatarFor, EmptyNote, ListSkeleton } from '../cards/index.js';

export const KINDS = {
  create: { label: 'Added', fg: '#0B7A5A', bg: '#E2F4EC', Icon: Plus },
  update: { label: 'Changed', fg: '#3B5BA9', bg: '#E8EEF9', Icon: Pencil },
  delete: { label: 'Removed', fg: '#B5452B', bg: '#FBE9E2', Icon: Trash2 },
  money: { label: 'Money', fg: '#94650F', bg: '#FBF0D2', Icon: Wallet },
  auth: { label: 'Sign-ins', fg: '#5B6B7A', bg: '#EEF1F4', Icon: LogIn },
  other: { label: 'Other', fg: '#5C5648', bg: '#F1ECE3', Icon: Activity },
};
const FILTERS = ['all', 'create', 'update', 'delete', 'money', 'auth'];

export function classify(text) {
  const t = String(text || '').toLowerCase();
  if (/(sign[_ .-]?in|log[_ .-]?in|log[_ .-]?out|sign[_ .-]?out|auth|password|otp|session)/.test(t)) return 'auth';
  if (/(delet|remov|void|cancel|revok|reject|reverse)/.test(t)) return 'delete';
  if (/(pay|receipt|refund|invoice|fee|bill|balance|mpesa|m-pesa|bank)/.test(t)) return 'money';
  if (/(creat|add|insert|new|regist|enrol|admit|import|upload)/.test(t)) return 'create';
  if (/(updat|edit|chang|modif|set|assign|promot|mark|submit|approve)/.test(t)) return 'update';
  return 'other';
}
const pick = (r, keys) => { for (const k of keys) { const v = r?.[k]; if (v !== undefined && v !== null && v !== '') return v; } return undefined; };
const human = (s) => { const t = String(s || '').replace(/[_.\-]+/g, ' ').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; };
const show = (v) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Pulls the list of {field, from, to} out of whichever shape the audit table uses. */
export function extractChanges(r) {
  const ch = pick(r, ['changes', 'diff', 'delta']); const out = [];
  if (Array.isArray(ch)) ch.forEach((c) => out.push({ field: human(pick(c, ['field', 'name', 'key', 'column'])), from: pick(c, ['from', 'old', 'before', 'old_value']), to: pick(c, ['to', 'new', 'after', 'new_value']) }));
  else if (ch && typeof ch === 'object') Object.entries(ch).forEach(([k, v]) => out.push(v && typeof v === 'object' && !Array.isArray(v) ? { field: human(k), from: pick(v, ['from', 'old', 'before']), to: pick(v, ['to', 'new', 'after']) } : { field: human(k), from: undefined, to: v }));
  else { const o = pick(r, ['old_values', 'old_data', 'before', 'old']); const n = pick(r, ['new_values', 'new_data', 'after', 'new']);
    if (o && typeof o === 'object' || n && typeof n === 'object') { const keys = new Set([...Object.keys(o || {}), ...Object.keys(n || {})]); keys.forEach((k) => { const a = o?.[k], b = n?.[k]; if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ field: human(k), from: a, to: b }); }); } }
  return out.filter((c) => c.field);
}

export function normalizeEntry(r, i = 0) {
  const at = pick(r, ['created_at', 'occurred_at', 'at', 'timestamp', 'logged_at', 'time', 'date']); const d = at ? new Date(at) : null;
  const action = String(pick(r, ['action', 'event', 'event_type', 'verb', 'operation', 'type']) || '');
  const area = String(pick(r, ['module', 'entity', 'entity_type', 'table_name', 'table', 'resource', 'area', 'object_type']) || '');
  const actor = String(pick(r, ['actor_name', 'user_name', 'staff_name', 'performed_by_name', 'performed_by', 'actor', 'user', 'full_name', 'email']) || 'System');
  const summary = String(pick(r, ['summary', 'description', 'message', 'details', 'detail', 'note']) || '') || `${human(action)}${area ? ` · ${human(area)}` : ''}`.trim() || 'Activity';
  const kind = classify(action) !== 'other' ? classify(action) : classify(`${area} ${summary}`);
  return { id: String(pick(r, ['id', 'log_id', 'uuid']) ?? `row-${i}`), date: d && !Number.isNaN(d.getTime()) ? d : null, kind, action: human(action), area: human(area) || 'General', actor, summary,
    target: pick(r, ['target_name', 'record_label', 'entity_name', 'subject']), ip: pick(r, ['ip', 'ip_address']), device: pick(r, ['device', 'user_agent', 'client']), changes: extractChanges(r), raw: r };
}

const dayKey = (d) => (d ? d.toLocaleDateString('en-CA') : 'unknown');
const dayName = (d) => { if (!d) return 'Earlier'; const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1); const k = dayKey(d); if (k === dayKey(t)) return 'Today'; if (k === dayKey(y)) return 'Yesterday'; return d.toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' }); };
const hm = (d) => (d ? d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '');

const Avatar = ({ name, size = 28 }) => { const [bg, fg] = avatarFor(name); return <span className="inline-flex items-center justify-center rounded-full font-extrabold shrink-0" style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.38, boxShadow: `0 0 0 2px ${V.bg}` }}>{initials(name)}</span>; };
const KindTile = ({ kind, size = 36 }) => { const k = KINDS[kind] || KINDS.other; const I = k.Icon; return <span className="inline-flex items-center justify-center shrink-0" style={{ width: size, height: size, background: k.bg, color: k.fg, borderRadius: kind === 'delete' ? '10px 16px 10px 16px' : kind === 'money' ? 999 : 12 }}><I size={size * 0.5} strokeWidth={2.3} /></span>; };

function Summary({ entries }) {
  const s = useMemo(() => {
    const now = new Date(); const today = dayKey(now); const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(now.getDate() - (6 - i)); return { key: dayKey(d), label: d.toLocaleDateString('en-KE', { weekday: 'narrow' }), n: 0 }; });
    const people = new Map(); const areas = new Map(); let todayN = 0;
    entries.forEach((e) => { const k = dayKey(e.date); const slot = days.find((x) => x.key === k); if (slot) slot.n += 1; if (k === today) { todayN += 1; people.set(e.actor, (people.get(e.actor) || 0) + 1); } areas.set(e.area, (areas.get(e.area) || 0) + 1); });
    const top = [...areas.entries()].sort((a, b) => b[1] - a[1])[0]; return { days, todayN, people: [...people.keys()], top, total: entries.length };
  }, [entries]); const max = Math.max(1, ...s.days.map((d) => d.n));
  return (
    <div className="grid grid-cols-6 lg:grid-cols-12 gap-3 md:gap-4 mb-4">
      <div className="col-span-6 lg:col-span-5 p-4 md:p-5 flex items-end justify-between gap-4" style={{ background: `linear-gradient(150deg,${V.dark},${V.dark2})`, color: V.onDark, borderRadius: '28px 28px 28px 8px', boxShadow: lift }}>
        <div><div className="text-[11px] font-bold uppercase tracking-[.09em]" style={{ color: V.accent }}>Today</div><div className="text-[48px] leading-none font-black tabular-nums mt-1">{num(s.todayN)}</div><div className="text-sm opacity-75 mt-1">{s.todayN === 1 ? 'thing happened' : 'things happened'}</div></div>
        <div className="flex items-end gap-1.5 h-16" role="img" aria-label="Activity over the last 7 days">{s.days.map((d, i) => <div key={d.key} className="flex flex-col items-center gap-1"><span className="w-3.5 rounded-t-md" style={{ height: Math.max(4, (d.n / max) * 44), background: i === 6 ? V.accent : 'rgba(255,255,255,.35)' }} /><span className="text-[10px] opacity-60">{d.label}</span></div>)}</div>
      </div>
      <div className="col-span-3 lg:col-span-4 p-4 flex flex-col justify-between" style={{ background: V.soft, borderRadius: 18 }}>
        <div className="text-[11px] font-bold uppercase tracking-[.09em]" style={{ color: V.muted }}>People active today</div>
        <div className="mt-2 flex items-center"><span className="text-3xl font-black tabular-nums mr-3" style={{ color: V.dark }}>{num(s.people.length)}</span><span className="flex -space-x-2">{s.people.slice(0, 5).map((p) => <Avatar key={p} name={p} size={30} />)}</span>{s.people.length > 5 && <span className="ml-2 text-xs" style={{ color: V.muted }}>+{s.people.length - 5}</span>}</div>
      </div>
      <div className="col-span-3 lg:col-span-3 p-4 flex flex-col justify-between" style={{ background: '#fff', border: `1px solid ${V.border}`, borderRadius: '8px 22px 8px 22px' }}>
        <div className="text-[11px] font-bold uppercase tracking-[.09em]" style={{ color: V.muted }}>Busiest area</div>
        {s.top ? <><div className="mt-1 font-black text-lg leading-tight truncate" style={{ color: V.dark }}>{s.top[0]}</div><div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: V.soft }}><div className="h-full rounded-full" style={{ width: `${(s.top[1] / Math.max(1, s.total)) * 100}%`, background: V.primary }} /></div><div className="text-xs mt-1" style={{ color: V.muted }}>{Math.round((s.top[1] / Math.max(1, s.total)) * 100)}% of what is loaded</div></> : <div className="text-sm mt-2" style={{ color: V.muted }}>Nothing yet</div>}
      </div>
    </div>);
}

function Detail({ e, onClose, inline }) {
  const k = KINDS[e.kind] || KINDS.other;
  return (
    <div className={inline ? 'mt-2 mb-1' : ''} style={{ background: '#fff', border: `1px solid ${V.border}`, borderRadius: 18, boxShadow: lift, overflow: 'hidden' }}>
      <div className="px-4 py-3 flex items-start gap-3" style={{ background: k.bg }}>
        <KindTile kind={e.kind} size={40} />
        <div className="min-w-0 flex-1"><div className="text-[11px] font-bold uppercase tracking-[.09em]" style={{ color: k.fg }}>{k.label}{e.action ? ` · ${e.action}` : ''}</div><div className="font-extrabold text-[15px] leading-snug" style={{ color: V.dark }}>{e.summary}</div></div>
        {onClose && <button type="button" onClick={onClose} aria-label="Close details" className="h-9 w-9 -m-1 rounded-full flex items-center justify-center hover:bg-black/5"><X size={16} /></button>}
      </div>
      <dl className="px-4 py-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
        <dt style={{ color: V.muted }}>Who</dt><dd className="font-semibold flex items-center gap-2"><Avatar name={e.actor} size={22} />{e.actor}</dd>
        <dt style={{ color: V.muted }}>When</dt><dd className="font-semibold">{e.date ? e.date.toLocaleString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</dd>
        <dt style={{ color: V.muted }}>Where</dt><dd className="font-semibold">{e.area}</dd>
        {e.target && <><dt style={{ color: V.muted }}>Record</dt><dd className="font-semibold break-words">{show(e.target)}</dd></>}
        {e.ip && <><dt style={{ color: V.muted }}>From</dt><dd className="font-semibold inline-flex items-center gap-1.5"><Globe size={13} />{show(e.ip)}</dd></>}
      </dl>
      {e.changes.length > 0 && (
        <div className="px-4 pb-4"><div className="text-[11px] font-bold uppercase tracking-[.09em] mb-1.5" style={{ color: V.muted }}>What changed</div>
          <ul className="space-y-1.5">{e.changes.map((c, i) => (
            <li key={i} className="rounded-xl px-3 py-2 text-[13px]" style={{ background: V.soft }}><div className="text-xs font-bold" style={{ color: V.muted }}>{c.field}</div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">{c.from !== undefined && <span className="line-through break-all" style={{ color: M.owedFg }}>{show(c.from)}</span>}{c.from !== undefined && <ArrowRight size={13} style={{ color: V.muted }} />}<b className="break-all" style={{ color: M.inDeep }}>{show(c.to)}</b></div></li>))}</ul></div>)}
    </div>);
}

function Row({ e, open, onToggle }) {
  const k = KINDS[e.kind] || KINDS.other;
  if (e.kind === 'auth') return (   // low-importance: slim, no card
    <button type="button" onClick={onToggle} className="w-full text-left flex items-center gap-2.5 py-1.5 pl-1 pr-2 rounded-lg hover:bg-black/[.03]"><Avatar name={e.actor} size={22} />
      <span className="text-[13px] flex-1 min-w-0 truncate" style={{ color: V.text }}><b>{e.actor}</b> <span style={{ color: V.muted }}>{e.summary.toLowerCase().startsWith(e.actor.toLowerCase()) ? '' : e.summary}</span></span><span className="text-xs tabular-nums" style={{ color: V.muted }}>{hm(e.date)}</span></button>);
  const heavy = e.kind === 'delete' || e.kind === 'money';
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className="w-full text-left flex items-start gap-3 p-3 transition-shadow hover:shadow-md"
      style={{ background: e.kind === 'money' ? M.paper : '#fff', border: `1px solid ${open ? k.fg : V.border}`, borderLeft: heavy ? `5px solid ${k.fg}` : undefined, borderRadius: e.kind === 'delete' ? '6px 18px 18px 6px' : e.kind === 'money' ? '22px 8px 22px 8px' : 16, boxShadow: lift }}>
      <KindTile kind={e.kind} />
      <span className="min-w-0 flex-1"><span className={`block leading-snug ${heavy ? 'font-extrabold text-[15px]' : 'font-semibold text-[14px]'}`} style={{ color: V.dark }}>{e.summary}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ color: V.muted }}><Avatar name={e.actor} size={18} /><span className="font-semibold" style={{ color: V.text }}>{e.actor}</span>
          <span className="rounded-full px-2 py-0.5 font-bold" style={{ background: k.bg, color: k.fg }}>{e.area}</span>{e.changes.length > 0 && <span>{e.changes.length} {e.changes.length === 1 ? 'change' : 'changes'}</span>}</span></span>
      <span className="text-xs tabular-nums shrink-0 pt-0.5" style={{ color: V.muted }}>{hm(e.date)}</span>
    </button>);
}

export default function ActivityLogView({ entries: raw = [], loading = false, error = null, onRefresh, onLoadMore, hasMore = false, heading = 'Activity log', subheading = 'Who did what, and when.' }) {
  const all = useMemo(() => raw.map(normalizeEntry).sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0)), [raw]);
  const [q, setQ] = useState(''); const [kind, setKind] = useState('all'); const [range, setRange] = useState('all'); const [area, setArea] = useState('all'); const [openId, setOpenId] = useState(null);
  const areas = useMemo(() => [...new Set(all.map((e) => e.area))].sort(), [all]);
  const rows = useMemo(() => { const now = new Date(); const from = range === 'today' ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : range === '7' ? new Date(now.getTime() - 7 * 864e5) : range === '30' ? new Date(now.getTime() - 30 * 864e5) : null; const needle = q.trim().toLowerCase();
    return all.filter((e) => (kind === 'all' || e.kind === kind) && (area === 'all' || e.area === area) && (!from || (e.date && e.date >= from)) && (!needle || `${e.summary} ${e.actor} ${e.area} ${e.action} ${e.target || ''}`.toLowerCase().includes(needle))); }, [all, q, kind, range, area]);
  const groups = useMemo(() => { const m = new Map(); rows.forEach((e) => { const k = dayKey(e.date); if (!m.has(k)) m.set(k, { key: k, label: dayName(e.date), items: [] }); m.get(k).items.push(e); }); return [...m.values()]; }, [rows]);
  const selected = all.find((e) => e.id === openId) || null; const filtered = kind !== 'all' || range !== 'all' || area !== 'all' || q;
  const counts = useMemo(() => { const c = {}; all.forEach((e) => { c[e.kind] = (c[e.kind] || 0) + 1; }); return c; }, [all]);
  const chip = (on, c) => ({ background: on ? (c || V.dark) : '#fff', color: on ? '#fff' : V.text, border: `1px solid ${on ? (c || V.dark) : V.border}` });
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4"><div className="min-w-0"><h1 className="text-[22px] md:text-[28px] leading-tight font-black" style={{ color: V.dark }}>{heading}</h1><p className="text-sm" style={{ color: V.muted }}>{subheading}</p></div>
        {onRefresh && <button type="button" onClick={onRefresh} className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-full text-xs font-semibold" style={{ border: `1px dashed ${V.mutedSoft}`, color: V.text }}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh</button>}</div>
      {all.length > 0 && <Summary entries={all} />}

      <div className="sticky top-0 z-20 -mx-3 px-3 md:-mx-5 md:px-5 lg:-mx-6 lg:px-6 py-2.5 mb-3" style={{ background: 'color-mix(in srgb, var(--e-bg,#FBF8EA) 94%, transparent)', backdropFilter: 'blur(6px)', borderBottom: `1px solid ${V.border2}` }}>
        <div className="flex flex-wrap gap-2 items-center">
          <label className="relative flex-1 min-w-[180px]"><Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: V.muted }} /><span className="sr-only">Search the log</span>
            <input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Search people, records, actions" className="w-full min-h-[42px] pl-10 pr-9 rounded-full text-sm outline-none" style={{ background: '#fff', border: `1px solid ${V.border}`, color: V.text }} />
            {q && <button type="button" aria-label="Clear search" onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full flex items-center justify-center" style={{ color: V.muted }}><X size={14} /></button>}</label>
          <div className="relative"><select aria-label="Area" value={area} onChange={(ev) => setArea(ev.target.value)} className="appearance-none min-h-[42px] pl-3.5 pr-8 rounded-full text-sm font-semibold" style={{ background: '#fff', border: `1px solid ${V.border}`, color: V.text }}><option value="all">All areas</option>{areas.map((a) => <option key={a} value={a}>{a}</option>)}</select><ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: V.muted }} /></div>
          <div className="inline-flex rounded-full p-0.5" style={{ background: V.soft }} role="group" aria-label="How far back">{[['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['all', 'All']].map(([v, l]) => <button key={v} type="button" onClick={() => setRange(v)} aria-pressed={range === v} className="min-h-[38px] px-3 rounded-full text-xs font-bold" style={{ background: range === v ? '#fff' : 'transparent', color: range === v ? V.dark : V.muted, boxShadow: range === v ? '0 1px 2px rgba(0,0,0,.1)' : 'none' }}>{l}</button>)}</div>
        </div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label="Kind of activity">{FILTERS.map((f) => { const k = KINDS[f]; const on = kind === f; return <button key={f} type="button" onClick={() => setKind(f)} aria-pressed={on} className="shrink-0 inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-full text-xs font-bold" style={chip(on, k?.fg)}>{f === 'all' ? 'Everything' : k.label}<span style={{ opacity: .7 }}>{f === 'all' ? all.length : counts[f] || 0}</span></button>; })}</div>
      </div>

      {error && !all.length ? <div className="rounded-2xl p-4 text-sm" style={{ background: M.owedBg, color: M.owedFg }}>{String(error.message || error)}</div>
        : loading && !all.length ? <ListSkeleton rows={7} />
        : all.length === 0 ? <EmptyNote title="No activity recorded yet">Actions people take in Elimu will appear here as they happen.</EmptyNote>
        : (
          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-5 items-start">
            <div>
              {groups.length === 0 ? <EmptyNote title="Nothing matches">Try a wider date range or clear the search.</EmptyNote> : groups.map((g) => (
                <section key={g.key} className="mb-5" aria-label={g.label}>
                  <div className="flex items-baseline gap-2 mb-2"><h2 className="text-[13px] font-black uppercase tracking-[.08em]" style={{ color: V.dark }}>{g.label}</h2><span className="text-xs" style={{ color: V.muted }}>{g.items.length} {g.items.length === 1 ? 'event' : 'events'}</span><span className="flex-1 border-t border-dashed translate-y-[-3px]" style={{ borderColor: V.border }} /></div>
                  <ol className="relative pl-6 space-y-2">
                    <span aria-hidden="true" className="absolute left-[7px] top-2 bottom-2 w-px" style={{ background: V.border }} />
                    {g.items.map((e) => { const k = KINDS[e.kind] || KINDS.other; const open = openId === e.id; return (
                      <li key={e.id} className="relative"><span aria-hidden="true" className="absolute -left-[22px] top-[18px] h-3.5 w-3.5 rounded-full" style={{ background: e.kind === 'auth' ? V.bg : k.fg, border: `3px solid ${V.bg}`, boxShadow: `0 0 0 1.5px ${k.fg}` }} />
                        <Row e={e} open={open} onToggle={() => setOpenId(open ? null : e.id)} />{open && <div className="lg:hidden"><Detail e={e} inline onClose={() => setOpenId(null)} /></div>}</li>); })}
                  </ol>
                </section>))}
              {hasMore && onLoadMore && <div className="text-center"><button type="button" onClick={onLoadMore} className="min-h-[44px] px-6 rounded-full text-sm font-bold bg-[#1F6B45] text-white">{loading ? 'Loading…' : 'Show older activity'}</button></div>}
              {filtered && groups.length > 0 && <p className="text-xs mt-1" style={{ color: V.muted }}>Showing {num(rows.length)} of {num(all.length)} loaded events.</p>}
            </div>
            <aside className="hidden lg:block sticky top-[132px]" aria-label="Event details">{selected ? <Detail e={selected} onClose={() => setOpenId(null)} /> : (
              <div className="rounded-[22px_8px_22px_8px] border-2 border-dashed px-5 py-10 text-center" style={{ borderColor: V.border, color: V.muted }}><Clock size={22} className="mx-auto mb-2" /><div className="font-bold text-sm" style={{ color: V.text }}>Pick an event</div><p className="text-xs mt-1">See who did it, when, and what changed.</p></div>)}</aside>
          </div>)}
    </div>);
}
