// src/pos-erp/pages/ExpensesPage.jsx
//
// My Spending. Phase 4 — expenses (brief §37). Categories come from lb_expense_categories (seeded: Rent, Electricity, Water,
// Transport, Wages, Airtime, Repairs, Packaging, Cleaning, Licences, Marketing, Miscellaneous), not a hardcoded label list.
//
// Layout: summary tiles, "where the money went" bars by category, search + period chips, then the spending grouped by day
// as small cards (no sideways-scrolling table on a phone). "Record expense" is a bottom sheet with category chips.
// Data and saving are unchanged: useExpenses() + create(); the database still decides who may record.

import React, { useMemo, useState } from 'react';
import { Receipt, Plus, X, Banknote, Smartphone, CreditCard, Landmark, Ticket, CircleEllipsis } from 'lucide-react';
import { useExpenses } from '../hooks/useExpenses';
import { usePermissions } from '../navigation/PermissionsContext';
import { singleFlight } from '../utils/singleFlight';
import { nairobiToday } from '../services/reportCentreService';
import { FitPage, AddButton, SearchBox, FilterChips, MiniStats, LoadingBlock, EmptyBlock, Notice, Pill, inputCls, saveBtnCls } from '../components/CardKit';

const METHODS = [
  { key: 'CASH', label: 'Cash', icon: Banknote },
  { key: 'MOBILE_MONEY', label: 'M-Pesa', icon: Smartphone },
  { key: 'BANK', label: 'Bank', icon: Landmark },
  { key: 'CARD', label: 'Card', icon: CreditCard },
  { key: 'VOUCHER', label: 'Voucher', icon: Ticket },
  { key: 'OTHER', label: 'Other', icon: CircleEllipsis },
];
const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.key, m.label]));
const PALETTE = ['#1F6B45', '#B8921C', '#3E8A5A', '#8A6A12', '#5E8F3E', '#2A7357', '#C2A02E', '#17553A'];

const EMPTY_FORM = (date) => ({ category_id: '', amount: '', payment_method: 'CASH', expense_date: date, description: '' });
const money = (n) => (Number(n) || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (n) => `KES ${(Number(n) || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
const dayLabel = (iso, today) => {
  if (iso === today) return 'Today';
  const y = new Date(`${today}T12:00:00Z`); y.setUTCDate(y.getUTCDate() - 1);
  if (iso === y.toISOString().slice(0, 10)) return 'Yesterday';
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const monthKey = (iso) => String(iso || '').slice(0, 7);

export default function ExpensesPage() {
  const { expenses, categories, loading, error, create } = useExpenses();
  const { can } = usePermissions();
  const today = nairobiToday();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM(today));
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState('month');
  const [cat, setCat] = useState('all');

  const thisMonth = monthKey(today);
  const lastMonth = (() => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(1); d.setUTCDate(0); return monthKey(d.toISOString().slice(0, 10)); })();

  const colorOf = useMemo(() => {
    const m = new Map(); categories.forEach((c, i) => m.set(c.id, PALETTE[i % PALETTE.length])); return (id) => m.get(id) || '#8B8766';
  }, [categories]);

  const inPeriod = useMemo(() => expenses.filter((e) => {
    if (period === 'today') return e.expense_date === today;
    if (period === 'month') return monthKey(e.expense_date) === thisMonth;
    if (period === 'last') return monthKey(e.expense_date) === lastMonth;
    return true;
  }), [expenses, period, today, thisMonth, lastMonth]);

  // Rejected expenses are shown but never counted as money spent.
  const counted = (e) => e.status !== 'REJECTED';
  const total = inPeriod.filter(counted).reduce((s, e) => s + Number(e.amount || 0), 0);
  const byCat = useMemo(() => {
    const m = new Map();
    inPeriod.filter(counted).forEach((e) => { const k = e.category_id || 'none'; m.set(k, (m.get(k) || 0) + Number(e.amount || 0)); });
    return [...m.entries()].map(([id, amt]) => ({ id, amt, name: id === 'none' ? 'No category' : (categories.find((c) => c.id === id)?.name || 'Other') })).sort((a, b) => b.amt - a.amt);
  }, [inPeriod, categories]);
  const monthTotal = expenses.filter((e) => counted(e) && monthKey(e.expense_date) === thisMonth).reduce((s, e) => s + Number(e.amount || 0), 0);

  const q = search.trim().toLowerCase();
  const shown = inPeriod.filter((e) => (cat === 'all' || (e.category_id || 'none') === cat)
    && (!q || `${e.description || ''} ${e.category?.name || ''} ${METHOD_LABEL[e.payment_method] || ''}`.toLowerCase().includes(q)));
  const days = useMemo(() => {
    const m = new Map();
    shown.forEach((e) => { const l = m.get(e.expense_date) || []; l.push(e); m.set(e.expense_date, l); });
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [shown]);

  const openForm = () => { setForm(EMPTY_FORM(today)); setFormError(''); setShowForm(true); };
  const submit = singleFlight('ExpensesPage.submit', async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.amount || Number(form.amount) <= 0) { setFormError('Enter a valid amount.'); return; }
    setSaving(true);
    try {
      await create({
        categoryId: form.category_id || null,
        amount: Number(form.amount),
        paymentMethod: form.payment_method,
        expenseDate: form.expense_date,
        description: form.description || null,
      });
      setShowForm(false);
      setForm(EMPTY_FORM(today));
    } catch (err) {
      setFormError(err?.code === '42501' ? 'You do not have permission to record spending.' : err.message);
    } finally {
      setSaving(false);
    }
  });

  const canRecord = can('expenses.record');
  const periodLabel = { today: 'today', month: 'this month', last: 'last month', all: 'in total' }[period];

  return (
    <FitPage
      title="My Spending" icon={Receipt} subtitle="Rent, wages, transport and everything else that leaves the till."
      action={canRecord ? <AddButton onClick={openForm} open={false} label="Spending" icon={Plus} /> : null}
      summary={!loading && !error && (
        <MiniStats items={[
          { label: `Spent ${periodLabel}`, value: short(total), tone: 'bad' },
          { label: 'This month', value: short(monthTotal) },
          { label: 'Entries', value: inPeriod.length },
        ]} />
      )}
      toolbar={(
        <div className="space-y-2">
          <SearchBox value={search} onChange={setSearch} placeholder="Search description, category, method…" />
          <FilterChips value={period} onChange={setPeriod} options={[
            { key: 'month', label: 'This month' }, { key: 'today', label: 'Today' }, { key: 'last', label: 'Last month' }, { key: 'all', label: 'All' },
          ]} />
        </div>
      )}
    >
      {error && <Notice>{error}</Notice>}
      {loading && <LoadingBlock />}

      {!loading && !error && byCat.length > 0 && (
        <div className="bg-white border border-[#E3DBB8] border-t-[3px] border-t-[#C9A227] rounded-2xl p-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] font-bold uppercase tracking-wide text-[#6F7461]">Where the money went</div>
            {cat !== 'all' && <button type="button" onClick={() => setCat('all')} className="text-[11.5px] font-bold text-[#1F6B45] underline">Show all</button>}
          </div>
          <div className="grid gap-1.5">
            {byCat.slice(0, 6).map((c) => {
              const color = c.id === 'none' ? '#8B8766' : colorOf(c.id);
              const w = total > 0 ? Math.max(3, (c.amt / total) * 100) : 0;
              const active = cat === c.id;
              return (
                <button key={c.id} type="button" onClick={() => setCat(active ? 'all' : c.id)} className={`text-left rounded-lg px-1.5 py-1 ${active ? 'bg-[#FAF8EC]' : ''}`} aria-pressed={active}>
                  <div className="flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="font-semibold text-[#23382B] truncate">{c.name}</span>
                    <span className="tabular-nums text-[#23382B] font-bold shrink-0">{short(c.amt)} <span className="font-medium text-[#8B8766]">{total > 0 ? `${Math.round((c.amt / total) * 100)}%` : ''}</span></span>
                  </div>
                  <div className="h-2 rounded-full bg-[#EEEBDD] mt-1 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} /></div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!loading && !error && days.length === 0 && (
        <EmptyBlock>{expenses.length === 0 ? 'No spending recorded yet. Tap "Spending" to add the first.' : 'No spending matches these filters.'}</EmptyBlock>
      )}

      {!loading && days.map(([date, list]) => {
        const sub = list.filter(counted).reduce((s, e) => s + Number(e.amount || 0), 0);
        return (
          <div key={date} className="mb-3">
            <div className="flex items-center justify-between px-1 mb-1.5">
              <div className="text-[11.5px] font-bold uppercase tracking-wide text-[#6F7461]">{dayLabel(date, today)}</div>
              <div className="text-[12px] font-bold text-[#23382B] tabular-nums">{short(sub)}</div>
            </div>
            <div className="bg-white border border-[#E3DBB8] rounded-2xl divide-y divide-[#EFE9CD] overflow-hidden">
              {list.map((e) => {
                const color = colorOf(e.category_id);
                const Icon = (METHODS.find((m) => m.key === e.payment_method) || METHODS[5]).icon;
                const rejected = e.status === 'REJECTED';
                return (
                  <div key={e.id} className={`flex items-center gap-3 px-3 py-2.5 ${rejected ? 'opacity-60' : ''}`}>
                    <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}1F`, color }}><Icon size={18} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-bold text-[#23382B] leading-tight truncate">{e.category?.name || 'No category'}</div>
                      <div className="text-[12px] text-[#6F7461] leading-snug line-clamp-2 break-words">{e.description || METHOD_LABEL[e.payment_method] || ''}</div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <Pill tone={e.status === 'PAID' ? 'good' : rejected ? 'bad' : 'warn'}>{e.status}</Pill>
                        {e.description && <span className="text-[11px] text-[#8B8766]">{METHOD_LABEL[e.payment_method] || ''}</span>}
                      </div>
                    </div>
                    <div className={`text-[14px] font-extrabold tabular-nums shrink-0 ${rejected ? 'line-through text-[#8B8766]' : 'text-[#23382B]'}`}>{money(e.amount)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onMouseDown={(ev) => { if (ev.target === ev.currentTarget) setShowForm(false); }} role="dialog" aria-modal="true" aria-label="Record spending">
          <form onSubmit={submit} className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md shadow-xl p-4 pb-6 space-y-3 max-h-[92vh] overflow-y-auto">
            <div className="w-10 h-1 rounded-full bg-[#E3DBB8] mx-auto sm:hidden" />
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-[17px] text-[#23382B]">Record spending</h3>
              <button type="button" onClick={() => setShowForm(false)} aria-label="Close" className="w-9 h-9 flex items-center justify-center text-[#6F7461]"><X size={19} /></button>
            </div>
            {formError && <Notice>{formError}</Notice>}

            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-wide text-[#6F7461]">Amount (KES)</span>
              <input required autoFocus type="number" inputMode="decimal" step="0.01" min="0.01" placeholder="0.00" value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className={`${inputCls} !min-h-[56px] !text-2xl !font-extrabold tabular-nums mt-1`} />
            </label>

            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-[#6F7461] mb-1.5">What was it for?</div>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setForm({ ...form, category_id: '' })} className={`px-3 min-h-[36px] rounded-full text-[12.5px] font-semibold border ${!form.category_id ? 'bg-[#1F6B45] text-white border-[#1F6B45]' : 'bg-white text-[#23382B] border-[#E3DBB8]'}`}>No category</button>
                {categories.map((c) => (
                  <button key={c.id} type="button" onClick={() => setForm({ ...form, category_id: c.id })}
                    className={`px-3 min-h-[36px] rounded-full text-[12.5px] font-semibold border ${form.category_id === c.id ? 'bg-[#1F6B45] text-white border-[#1F6B45]' : 'bg-white text-[#23382B] border-[#E3DBB8]'}`}>{c.name}</button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-[#6F7461] mb-1.5">Paid with</div>
              <div className="grid grid-cols-3 gap-1.5">
                {METHODS.map((m) => {
                  const on = form.payment_method === m.key;
                  return (
                    <button key={m.key} type="button" onClick={() => setForm({ ...form, payment_method: m.key })} aria-pressed={on}
                      className={`flex items-center justify-center gap-1.5 min-h-[42px] rounded-xl text-[12.5px] font-semibold border ${on ? 'bg-[#1F6B45] text-white border-[#1F6B45]' : 'bg-white text-[#23382B] border-[#E3DBB8]'}`}>
                      <m.icon size={14} />{m.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="text-[11px] font-bold uppercase tracking-wide text-[#6F7461]">Date</span>
                <input type="date" max={today} value={form.expense_date} onChange={(e) => e.target.value && setForm({ ...form, expense_date: e.target.value })} className={`${inputCls} mt-1`} /></label>
              <label className="block"><span className="text-[11px] font-bold uppercase tracking-wide text-[#6F7461]">Note (optional)</span>
                <input placeholder="e.g. KPLC tokens" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={`${inputCls} mt-1`} /></label>
            </div>

            <button type="submit" disabled={saving} className={`${saveBtnCls} w-full`}>{saving ? 'Saving…' : 'Save spending'}</button>
          </form>
        </div>
      )}
    </FitPage>
  );
}
