// elimu/ui/cards/MoneyCards.jsx -- cards for the Finance screens. Money has its own fixed palette (MONEY in tokens.js), not the theme, so
// figures keep the same meaning in every school colour: jade = in, terracotta = owed, gold = waiting.
// Each kind of money record has its own shape:
//   AgeingBar    one card, one bar: how old is what we are owed          DebtorCard   a ledger line with a rubber stamp for the days overdue
//   BalanceHero  the big "this family owes / has credit" page             InvoiceSlip  a tear-off slip; a PAID stamp when it is settled
//   ExpenseSlip  a narrow till-roll slip with a zig-zag edge              SupplierCard who we owe, with the overdue part picked out
//   BillSlip     a supplier bill: due date as a flag
import React from 'react';
import { ChevronRight } from 'lucide-react';
import { MONEY as M, lift } from './tokens.js';

const paper = { background: M.paper, border: `1px solid ${M.rule}`, boxShadow: lift };
const Tap = ({ onClick, className = '', style, children, label }) => (onClick
  ? <button type="button" onClick={onClick} aria-label={label} className={`block w-full text-left transition-transform duration-150 active:scale-[.985] ${className}`} style={style}>{children}</button>
  : <div className={className} style={style}>{children}</div>);
const Bar = ({ ratio, color = M.inFg, back = M.rule, h = 6 }) => (<span aria-hidden className="block w-full overflow-hidden rounded-full" style={{ height: h, background: back }}><i className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, ratio || 0)) * 100}%`, background: color }} /></span>);
const Stamp = ({ children, color, tilt = -6 }) => (<span className="inline-block px-2 py-0.5 text-[11px] font-black uppercase tracking-[.12em] rounded-[4px]" style={{ color, border: `2px solid ${color}`, transform: `rotate(${tilt}deg)`, opacity: .85 }}>{children}</span>);

/** buckets: [{label, value:number, text}] in order from "not yet due" to "over 90 days". */
export function AgeingBar({ buckets = [], totalText }) {
  const sum = buckets.reduce((s, b) => s + Math.max(0, Number(b.value) || 0), 0);
  const COLORS = ['#7FB8A2', '#E2C46A', '#E0A04B', '#D9776A', '#A8372A'];
  return (
    <section className="p-4" style={{ ...paper, borderRadius: '6px 26px 26px 26px' }} aria-label="How old the unpaid fees are">
      <div className="flex items-baseline justify-between gap-2"><h2 className="text-[11px] font-bold uppercase tracking-[.09em]" style={{ color: M.muted }}>How old is what we are owed</h2><span className="text-lg font-black tabular-nums" style={{ color: M.owedFg }}>{totalText}</span></div>
      <div className="mt-3 flex h-5 overflow-hidden rounded-full" style={{ background: M.rule }} role="img" aria-label="Unpaid fees by age">
        {sum > 0 && buckets.map((b, i) => (Number(b.value) > 0 ? <i key={b.label} className="block h-full" style={{ width: `${(Number(b.value) / sum) * 100}%`, background: COLORS[i % 5] }} /> : null))}</div>
      <ul className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-x-3 gap-y-2">{buckets.map((b, i) => (
        <li key={b.label} className="flex items-start gap-1.5"><i className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLORS[i % 5] }} /><span><span className="block text-[11px]" style={{ color: M.muted }}>{b.label}</span><span className="block text-[13px] font-bold tabular-nums" style={{ color: M.ink }}>{b.text}</span></span></li>))}</ul>
    </section>);
}

/** One family that owes. days = days overdue (0 or null = not overdue). */
export function DebtorCard({ name, meta, guardian, owedText, billed, paid, billedText, paidText, days, lastPayment, onClick, actions }) {
  const late = Number(days) > 0; const tone = !late ? M.waitFg : Number(days) > 60 ? '#A8372A' : M.owedFg;
  return (
    <div className="relative pl-9 pr-4 py-3.5 overflow-hidden" style={{ ...paper, borderRadius: '6px 22px 22px 6px', background: `repeating-linear-gradient(to bottom,transparent 0 27px,${M.rule} 27px 28px),${M.paper}`, backgroundPosition: '0 8px' }}>
      <span aria-hidden className="absolute top-0 bottom-0 left-7 w-px" style={{ background: M.margin, opacity: .5 }} /><span aria-hidden className="absolute top-0 bottom-0 left-0 w-1.5" style={{ background: tone }} />
      <Tap onClick={onClick} label={`${name}, owes ${owedText}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><div className="font-extrabold text-[15px] truncate" style={{ color: M.ink }}>{name}</div><div className="text-xs truncate" style={{ color: M.muted }}>{meta}</div>{guardian && <div className="text-xs truncate" style={{ color: M.muted }}>{guardian}</div>}</div>
          <div className="text-right shrink-0"><div className="text-[21px] leading-none font-black tabular-nums" style={{ color: tone }}>{owedText}</div>{late && <div className="mt-1.5"><Stamp color={tone}>{days} days late</Stamp></div>}</div>
        </div>
        <div className="mt-2.5"><Bar ratio={Number(paid) / Math.max(1, Number(billed))} /><div className="mt-1 flex justify-between text-[11.5px]" style={{ color: M.muted }}><span>Paid {paidText} of {billedText}</span><span>{lastPayment ? `Last payment ${lastPayment}` : 'No payment yet'}</span></div></div>
      </Tap>
      {actions && <div className="mt-2.5 flex gap-2 flex-wrap">{actions}</div>}
    </div>);
}

/** The student's account page header. state: 'owes' | 'credit' | 'clear'. rows: [[label, text]]. */
export function BalanceHero({ state = 'clear', mainText, rows = [], note }) {
  const c = state === 'owes' ? M.owedFg : M.inDeep; const label = state === 'owes' ? 'Balance owed' : state === 'credit' ? 'Credit held for the family' : 'Account is clear';
  return (
    <section className="relative pl-12 pr-4 py-5 overflow-hidden" style={{ ...paper, borderRadius: '8px 34px 34px 8px', background: `repeating-linear-gradient(to bottom,transparent 0 27px,${M.rule} 27px 28px),${M.paper}`, backgroundPosition: '0 6px' }}>
      <span aria-hidden className="absolute top-0 bottom-0 left-9 w-px" style={{ background: M.margin, opacity: .55 }} /><span aria-hidden className="absolute top-0 bottom-0 left-0 w-2" style={{ background: c }} />
      <div className="text-[11px] font-bold uppercase tracking-[.09em]" style={{ color: M.muted }}>{label}</div>
      <div className="text-[34px] leading-[1.1] font-black tabular-nums" style={{ color: c }}>{mainText}</div>
      <dl className="mt-3 text-sm">{rows.map(([l, v]) => (<div key={l} className="flex items-baseline gap-2 leading-[28px]"><dt style={{ color: M.muted }}>{l}</dt><span className="flex-1 border-b border-dotted translate-y-[-3px]" style={{ borderColor: '#B9B39C' }} /><dd className="font-bold tabular-nums" style={{ color: M.ink }}>{v}</dd></div>))}</dl>
      {note && <p className="mt-2 text-xs" style={{ color: M.muted }}>{note}</p>}
    </section>);
}

/** A fee invoice as a slip with a perforated edge. status: {label, tone:'in'|'owed'|'wait'|'quiet'}. */
export function InvoiceSlip({ title, sub, totalText, settledText, owingText, ratio, status, paidInFull, footer }) {
  const col = { in: M.inFg, owed: M.owedFg, wait: M.waitFg, quiet: M.muted }[status?.tone || 'quiet'];
  return (
    <div className="relative flex overflow-hidden" style={{ ...paper, borderRadius: '10px 22px 10px 22px' }}>
      <div className="flex-1 min-w-0 p-3.5">
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="font-extrabold text-[14.5px]" style={{ color: M.ink }}>{title}</div><div className="text-xs" style={{ color: M.muted }}>{sub}</div></div>
          {status && <Stamp color={col} tilt={paidInFull ? -8 : 0}>{status.label}</Stamp>}</div>
        <div className="mt-2"><Bar ratio={ratio} color={col === M.muted ? M.inFg : M.inFg} /></div>
        <div className="mt-1 flex justify-between text-[12px] tabular-nums" style={{ color: M.muted }}><span>Billed {totalText}</span><span>Paid {settledText}</span></div>
        {footer && <div className="mt-2">{footer}</div>}
      </div>
      <div className="w-[88px] shrink-0 flex flex-col items-center justify-center text-center border-l-2 border-dashed px-2" style={{ borderColor: M.rule, background: Number(ratio) >= 1 ? M.inBg : M.owedBg }}>
        <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: M.muted }}>Owing</div><div className="text-[15px] font-black tabular-nums" style={{ color: Number(ratio) >= 1 ? M.inDeep : M.owedFg }}>{owingText}</div></div>
    </div>);
}

/** An expense: narrow till-roll slip with a zig-zag bottom. status: {label, tone}. */
export function ExpenseSlip({ title, sub, amountText, status, children }) {
  const col = { in: M.inFg, owed: M.owedFg, wait: M.waitFg, quiet: M.muted }[status?.tone || 'quiet'];
  return (
    <div className="relative">
      <div className="p-3.5 pb-4" style={{ background: '#fff', border: `1px solid ${M.rule}`, borderBottom: 'none', borderRadius: '12px 12px 0 0', boxShadow: lift }}>
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="font-bold text-[14.5px]" style={{ color: M.ink }}>{title}</div><div className="text-xs" style={{ color: M.muted }}>{sub}</div></div>
          <div className="text-right shrink-0"><div className="text-[18px] font-black tabular-nums" style={{ color: M.ink }}>{amountText}</div>{status && <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: col }}>{status.label}</div>}</div></div>
        {children && <div className="mt-2.5">{children}</div>}
      </div>
      <span aria-hidden className="block h-2" style={{ background: 'linear-gradient(135deg,#fff 50%,transparent 50%) 0 0/10px 10px, linear-gradient(225deg,#fff 50%,transparent 50%) 0 0/10px 10px' }} />
    </div>);
}

/** A supplier: who we owe, with the overdue part picked out in its own strip. */
export function SupplierCard({ name, sub, owedText, billedText, paidText, overdueText, overdue, off }) {
  return (
    <section className="overflow-hidden" style={{ ...paper, borderRadius: '22px 6px 22px 6px', opacity: off ? .65 : 1 }}>
      <div className="p-3.5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="font-extrabold text-[15px] truncate" style={{ color: M.ink }}>{name}</div><div className="text-xs" style={{ color: M.muted }}>{sub}</div></div>
        <div className="text-right"><div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: M.muted }}>We owe</div><div className="text-[19px] leading-none font-black tabular-nums" style={{ color: M.ink }}>{owedText}</div></div></div>
        <div className="mt-2 flex gap-4 text-[12px] tabular-nums" style={{ color: M.muted }}><span>Billed {billedText}</span><span>Paid {paidText}</span></div></div>
      {overdue && <div className="px-3.5 py-1.5 text-[12px] font-bold flex justify-between" style={{ background: M.owedBg, color: M.owedFg }}><span>Overdue</span><span className="tabular-nums">{overdueText}</span></div>}
    </section>);
}

/** A supplier bill: the due date hangs off the corner like a flag. state: {label, tone}. */
export function BillSlip({ title, sub, amountText, state, footer }) {
  const col = { in: M.inFg, owed: M.owedFg, wait: M.waitFg, quiet: M.muted }[state?.tone || 'quiet'];
  return (
    <div className="relative mt-2" style={{ ...paper, borderRadius: '6px 18px 18px 18px' }}>
      <span className="absolute -top-2.5 right-4 px-2.5 py-0.5 text-[11px] font-black rounded-t-md" style={{ background: col, color: '#fff' }}>{state?.label}</span>
      <div className="p-3.5"><div className="flex justify-between gap-3"><div className="min-w-0"><div className="font-bold text-[14.5px]" style={{ color: M.ink }}>{title}</div><div className="text-xs" style={{ color: M.muted }}>{sub}</div></div>
        <div className="text-[17px] font-black tabular-nums shrink-0" style={{ color: M.ink }}>{amountText}</div></div>{footer && <div className="mt-2">{footer}</div>}</div>
    </div>);
}
export const MoreLink = ({ children }) => <span className="inline-flex items-center gap-0.5 text-xs font-semibold" style={{ color: M.inFg }}>{children}<ChevronRight size={13} /></span>;

/** A payment slip: money that has come in but is not yet applied, or a draft waiting on a phone. A punched hole on the left, dashed edge. tone: 'in' | 'wait' | 'owed' | 'quiet'. */
export function PaymentChit({ title, sub, amountText, tag, tone = 'wait', children }) {
  const col = { in: M.inFg, owed: M.owedFg, wait: M.waitFg, quiet: M.muted }[tone] || M.waitFg; const back = { in: M.inBg, owed: M.owedBg, wait: M.waitBg, quiet: '#F1ECE3' }[tone] || M.waitBg;
  return (
    <div className="relative pl-9 pr-3.5 py-3 mb-3" style={{ background: back, border: `1.5px dashed ${col}`, borderRadius: '4px 18px 4px 18px' }}>
      <span aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full" style={{ background: M.paper, border: `1.5px solid ${col}` }} />
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="font-bold text-[14px] truncate" style={{ color: M.ink }}>{title}</div>{sub && <div className="text-xs" style={{ color: M.muted }}>{sub}</div>}</div>
        <div className="text-right shrink-0"><div className="text-[16px] font-black tabular-nums" style={{ color: M.ink }}>{amountText}</div>{tag && <div className="text-[10.5px] font-bold uppercase tracking-wide" style={{ color: col }}>{tag}</div>}</div></div>
      {children && <div className="mt-2">{children}</div>}
    </div>);
}

/** A bursary, scholarship, discount or write-off: a ribbon across the top corner says what kind it is. */
export function AwardCard({ kind, title, sub, amountText, state, tone = 'quiet', children }) {
  const col = { in: M.inFg, owed: M.owedFg, wait: M.waitFg, quiet: M.muted }[tone] || M.muted;
  return (
    <section className="relative overflow-hidden pt-7 pb-3.5 px-3.5" style={{ ...paper, borderRadius: '4px 24px 24px 24px' }}>
      <span className="absolute top-0 left-0 px-3 py-1 text-[10.5px] font-black uppercase tracking-[.1em] rounded-br-xl" style={{ background: M.inFg, color: '#fff' }}>{kind}</span>
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="font-extrabold text-[14.5px]" style={{ color: M.ink }}>{title}</div><div className="text-xs" style={{ color: M.muted }}>{sub}</div></div>
        <div className="text-right shrink-0"><div className="text-[19px] leading-none font-black tabular-nums" style={{ color: M.inDeep }}>{amountText}</div>{state && <div className="mt-1 text-[10.5px] font-bold uppercase tracking-wide" style={{ color: col }}>{state}</div>}</div></div>
      {children && <div className="mt-2.5 flex gap-2 flex-wrap">{children}</div>}
    </section>);
}

/** A staff member's pay: initials badge, the total, and a stacked bar of basic pay against allowances. */
export function PayslipCard({ name, role, totalText, basic, allowances, basicText, allowancesText, off, onClick }) {
  const tot = Math.max(1, Number(basic) + Number(allowances)); const ini = String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <Tap onClick={onClick} label={`${name}, ${totalText}`} className="relative flex gap-3 p-3.5" style={{ ...paper, borderRadius: '30px 10px 10px 30px', opacity: off ? .6 : 1 }}>
      <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[14px] font-black" style={{ background: M.inBg, color: M.inDeep }}>{ini}</span>
      <span className="min-w-0 flex-1"><span className="flex items-baseline justify-between gap-2"><span className="font-extrabold text-[14.5px] truncate" style={{ color: M.ink }}>{name}</span><span className="font-black tabular-nums text-[15px]" style={{ color: M.ink }}>{totalText}</span></span>
        <span className="block text-xs" style={{ color: M.muted }}>{role}</span>
        <span aria-hidden className="mt-2 flex h-2 overflow-hidden rounded-full" style={{ background: M.rule }}><i className="block h-full" style={{ width: `${(Number(basic) / tot) * 100}%`, background: M.inFg }} /><i className="block h-full" style={{ width: `${(Number(allowances) / tot) * 100}%`, background: M.waitFg }} /></span>
        <span className="mt-1 flex justify-between text-[11.5px] tabular-nums" style={{ color: M.muted }}><span>Basic {basicText}</span><span>Allowances {allowancesText}</span></span></span>
    </Tap>);
}

/** A bank or M-Pesa reconciliation: a tick when it balanced, the difference when it did not. */
export function ReconCard({ title, sub, totalText, balanced, differenceText }) {
  const col = balanced ? M.inFg : M.owedFg;
  return (
    <section className="flex items-stretch overflow-hidden" style={{ ...paper, borderRadius: '8px 22px 22px 8px' }}>
      <span aria-hidden className="flex w-12 shrink-0 items-center justify-center text-[22px] font-black" style={{ background: balanced ? M.inBg : M.owedBg, color: col }}>{balanced ? '✓' : '≠'}</span>
      <div className="min-w-0 flex-1 p-3.5"><div className="font-extrabold text-[14.5px] truncate" style={{ color: M.ink }}>{title}</div><div className="text-xs" style={{ color: M.muted }}>{sub}</div>
        <div className="mt-1.5 flex justify-between text-[12.5px] tabular-nums"><span style={{ color: M.muted }}>Statement total <b style={{ color: M.ink }}>{totalText}</b></span><b style={{ color: col }}>{balanced ? 'Balanced' : `Difference ${differenceText}`}</b></div></div>
    </section>);
}

/** Stores: a bin label with a fill gauge. level = qty relative to reorder level (0..1+); low turns the gauge terracotta. */
export function StockCard({ name, sub, qtyText, valueText, low, ratio, children }) {
  const col = low ? M.owedFg : M.inFg;
  return (
    <div className="mb-3 p-3.5" style={{ ...paper, borderRadius: '18px 6px 18px 6px', borderLeft: `5px solid ${col}` }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><div className="font-bold truncate" style={{ color: M.ink }}>{name}</div><div className="text-xs" style={{ color: low ? M.owedFg : M.muted }}>{sub}</div></div>
        <div className="text-right shrink-0"><div className="text-lg font-black tabular-nums" style={{ color: col }}>{qtyText}</div><div className="text-[11px] tabular-nums" style={{ color: M.muted }}>{valueText}</div></div>
      </div>
      <div className="mt-2"><Bar ratio={ratio} color={col} h={5} /></div>
      {children && <div className="mt-2.5">{children}</div>}
    </div>);
}

/** Assets: a riveted asset tag; the tag number is the star, book value sits on the right. */
export function AssetTag({ tag, name, sub, valueText, onClick }) {
  return (
    <div className="mb-3">
      <Tap onClick={onClick} label={`${name}, book value ${valueText}`} className="flex items-stretch overflow-hidden" style={{ ...paper, borderRadius: '8px 24px 8px 24px' }}>
        <span className="flex flex-col items-center justify-center px-3 py-2 gap-1" style={{ background: M.inBg, borderRight: `2px dashed ${M.rule}` }}>
          <i aria-hidden className="h-2 w-2 rounded-full" style={{ background: M.rule }} /><span className="text-[11px] font-black tracking-wider tabular-nums" style={{ color: M.inDeep, writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{tag}</span><i aria-hidden className="h-2 w-2 rounded-full" style={{ background: M.rule }} /></span>
        <span className="flex-1 min-w-0 px-3 py-2.5"><span className="block font-bold truncate" style={{ color: M.ink }}>{name}</span><span className="block text-xs" style={{ color: M.muted }}>{sub}</span></span>
        <span className="px-3 py-2.5 text-right self-center"><span className="block text-[10px] uppercase tracking-wider" style={{ color: M.muted }}>Book value</span><span className="block font-black tabular-nums" style={{ color: M.inFg }}>{valueText}</span></span>
      </Tap>
    </div>);
}

/** Fee structure: a price list, items as dotted-leader lines, total at the foot. */
export function FeeSheet({ title, sub, status, items = [], totalText }) {
  return (
    <div className="mb-3 p-4" style={{ ...paper, borderRadius: '6px 22px 6px 22px' }}>
      <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="font-bold" style={{ color: M.ink }}>{title}</div><div className="text-xs" style={{ color: M.muted }}>{sub}</div></div>
        {status && <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: M.waitBg, color: M.waitFg }}>{status}</span>}</div>
      <ul className="mt-2.5 space-y-1">{items.map((i, k) => (<li key={k} className="flex items-baseline gap-2 text-sm"><span style={{ color: M.ink }}>{i.label}</span><i aria-hidden className="flex-1 border-b border-dotted translate-y-[-3px]" style={{ borderColor: M.muted, opacity: .5 }} /><span className="tabular-nums" style={{ color: M.ink }}>{i.value}</span></li>))}</ul>
      <div className="mt-2.5 pt-2 flex items-baseline justify-between" style={{ borderTop: `2px solid ${M.ink}` }}><span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: M.muted }}>Total per student</span><span className="text-lg font-black tabular-nums" style={{ color: M.inFg }}>{totalText}</span></div>
    </div>);
}
