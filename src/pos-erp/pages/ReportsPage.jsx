// src/pos-erp/pages/ReportsPage.jsx
//
// Daily Closing. The day's numbers, grouped so you can read them top-down:
//
//   Sales                      (card)
//     Received now             (subcard)  ->  Cash / Mobile Money / Card / Other   (lines)
//     On credit                (subcard)
//   Items sold                 (card)
//     Phones                   (subcard = product category)
//       Samsung Galaxy A10     (line, 24 units)  ->  tap for each selling price     (sub-lines)
//   Money out                  (card)
//     Rent                     (subcard = expense category)  ->  each entry         (lines)
//     Refunds
//   Cash drawer                (card)  Cash in / Cash out
//
// "Live" days are computed on the fly; "Closed" days read back the saved lb_daily_closings row.
// The Items sold and spending detail are always read from the sales/expenses themselves (they are not
// stored in the closing row), so they also work for days that were closed before this page existed.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { BarChart3, Lock, CheckCircle2, ChevronDown, ChevronRight, Package, Wallet, Banknote, Receipt } from 'lucide-react';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { reportsService } from '../services/reportsService';
import { singleFlight } from '../utils/singleFlight';
import { FitPage, MiniStats, Pill, LoadingBlock, EmptyBlock, Notice, SearchBox, saveBtnCls } from '../components/CardKit';

// Local calendar date (NOT toISOString, which is the UTC date and shows "yesterday" in Nairobi after midnight).
function todayISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const money = (v) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const qtyFmt = (v) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

const TONE = { good: 'text-[#1B6B45]', bad: 'text-[#B23A2E]', gold: 'text-[#8A6A12]', muted: 'text-[#9A987F]', plain: 'text-[#23382B]' };

// ── the three levels of card ────────────────────────────────────────────
// level 0 = section card, level 1 = subcard, level 2 = line. Any level can hold the next one.
function Fold({ level = 0, icon: Icon, title, hint, value, tone = 'plain', badge, defaultOpen = false, open: forced, children }) {
  const [openState, setOpen] = useState(defaultOpen);
  const open = forced != null ? forced : openState;      // a search forces matching groups open
  const expandable = React.Children.toArray(children).length > 0;

  const shell =
    level === 0 ? 'bg-white border border-[#E3DBB8] border-t-[3px] border-t-[#C9A227] rounded-xl mb-3'
    : level === 1 ? 'bg-[#FBF9EE] border border-[#EFE8C8] rounded-lg mt-2'
    : 'border-t border-[#EFE8C8]';
  const pad = level === 0 ? 'px-3 py-2.5' : level === 1 ? 'px-2.5 py-2' : 'px-2 py-1.5';
  const titleCls = level === 0 ? 'text-[14px] font-bold' : level === 1 ? 'text-[13px] font-semibold' : 'text-[12.5px]';
  const valueCls = level === 0 ? 'text-[15px] font-bold' : level === 1 ? 'text-[13.5px] font-bold' : 'text-[12.5px] font-semibold';

  const head = (
    <>
      {expandable
        ? (open ? <ChevronDown size={15} className="shrink-0 text-[#8B8766]" /> : <ChevronRight size={15} className="shrink-0 text-[#8B8766]" />)
        : <span className="w-[15px] shrink-0" />}
      {Icon && <Icon size={16} className="shrink-0 text-[#2E7D52]" />}
      <div className="min-w-0 flex-1 text-left">
        <div className={`${titleCls} text-[#23382B] truncate`}>{title}</div>
        {hint && <div className="text-[11px] text-[#8B8766] truncate">{hint}</div>}
      </div>
      {badge && <Pill tone="info">{badge}</Pill>}
      {value != null && <div className={`${valueCls} ${TONE[tone] || TONE.plain} shrink-0 tabular-nums`}>{value}</div>}
    </>
  );

  return (
    <div className={shell}>
      {expandable ? (
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
          className={`w-full flex items-center gap-2 ${pad} min-h-[40px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]/50 rounded-lg`}>
          {head}
        </button>
      ) : (
        <div className={`flex items-center gap-2 ${pad} min-h-[36px]`}>{head}</div>
      )}
      {expandable && open && (
        <div className={level === 0 ? 'px-3 pb-3' : level === 1 ? 'px-2.5 pb-2' : 'pl-6 pr-2 pb-1.5'}>{children}</div>
      )}
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const { staffId, tenant } = usePosErpAuth();
  const [date, setDate] = useState(todayISO());
  const [summary, setSummary] = useState(null);
  const [items, setItems] = useState(null);
  const [spend, setSpend] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [closing, setClosing] = useState(false);
  const [q, setQ] = useState('');

  const businessId = tenant?.business_id ?? null;

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    setError(null);
    setDetailError(null);
    setItems(null);
    setSpend(null);
    try {
      setSummary(await reportsService.getDailySummary({ tenantId: tenant.id, date }));
    } catch (err) {
      setError(err.message || 'Failed to load report.');
      setSummary(null);
      setLoading(false);
      return;
    }
    setLoading(false);
    // The detail is loaded after the totals, and a failure here never hides the totals.
    try {
      const [i, s] = await Promise.all([
        reportsService.getItemsSold({ tenantId: tenant.id, businessId, date }),
        reportsService.getExpenseBreakdown({ tenantId: tenant.id, businessId, date }),
      ]);
      setItems(i);
      setSpend(s);
    } catch (err) {
      setDetailError(err.message || 'Could not load the item detail.');
    }
  }, [tenant, businessId, date]);

  useEffect(() => { load(); }, [load]);

  const handleCloseDay = singleFlight('ReportsPage.handleCloseDay', async () => {
    if (!window.confirm(`Close ${date}? This locks the day's summary and can't be undone from here.`)) return;
    setClosing(true);
    setError(null);
    try {
      const result = await reportsService.closeDay({ tenantId: tenant?.id, businessId, date, closedBy: staffId });
      setSummary({ ...result, source: 'closed' });
    } catch (err) {
      setError(err.message || 'Failed to close day.');
    } finally {
      setClosing(false);
    }
  });

  // search: keep only products whose name/SKU match, and force their category open
  const needle = q.trim().toLowerCase();
  const shownCategories = useMemo(() => {
    if (!items) return [];
    if (!needle) return items.categories;
    return items.categories
      .map((c) => {
        const products = c.products.filter((p) => p.name.toLowerCase().includes(needle) || (p.sku || '').toLowerCase().includes(needle));
        return {
          ...c, products,
          units: products.reduce((n, p) => n + p.units, 0),
          revenue: products.reduce((n, p) => n + p.revenue, 0),
        };
      })
      .filter((c) => c.products.length);
  }, [items, needle]);

  const s = summary;
  const receivedNow = s
    ? Number(s.total_cash_payments || 0) + Number(s.total_mobile_payments || 0) + Number(s.total_card_payments || 0) + Number(s.total_other_payments || 0)
    : 0;

  return (
    <FitPage
      title="Daily Closing"
      subtitle="Sales, items sold, spending and cash for one day · amounts in KES"
      icon={BarChart3}
      action={
        <input
          type="date"
          value={date}
          max={todayISO()}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="border border-[#E3DBB8] rounded-lg px-2.5 min-h-[38px] text-sm bg-white text-[#23382B] focus:outline-none focus:border-[#C9A227]"
        />
      }
      summary={s && (
        <MiniStats items={[
          { label: 'Total sales', value: money(s.total_sales), tone: 'good' },
          { label: 'Units sold', value: items ? qtyFmt(items.totalUnits) : '…' },
          { label: 'Expenses', value: money(s.total_expenses), tone: 'bad' },
        ]} />
      )}
    >
      {error && <Notice>{error}</Notice>}
      {loading && <LoadingBlock />}

      {!loading && s && (
        <>
          <div className="flex items-center gap-2 mb-2.5">
            {s.source === 'closed'
              ? <span className="inline-flex items-center gap-1.5 text-[11px] font-bold bg-[#E3F1E7] text-[#1B5138] px-2.5 py-1 rounded-full"><Lock size={11} /> Closed</span>
              : <span className="inline-flex items-center gap-1.5 text-[11px] font-bold bg-[#FBF0CC] text-[#7A5A0E] px-2.5 py-1 rounded-full">Live — not yet closed</span>}
          </div>

          {/* ───────── 1. Sales ───────── */}
          <Fold level={0} icon={Receipt} title="Sales" hint={items ? `${items.salesCount} sale${items.salesCount === 1 ? '' : 's'}` : undefined}
            value={money(s.total_sales)} tone="good" defaultOpen>
            <Fold level={1} title="Received now" hint="Money that came in with the sale" value={money(receivedNow)} defaultOpen>
              <Fold level={2} title="Cash" value={money(s.total_cash_payments)} />
              <Fold level={2} title="Mobile Money" value={money(s.total_mobile_payments)} />
              <Fold level={2} title="Card" value={money(s.total_card_payments)} />
              <Fold level={2} title="Other (bank, voucher…)" value={money(s.total_other_payments)} />
            </Fold>
            <Fold level={1} title="On credit" hint="Sold now, to be paid later" value={money(s.total_credit_sales)} tone={Number(s.total_credit_sales) > 0 ? 'gold' : 'muted'} />
          </Fold>

          {/* ───────── 2. Items sold ───────── */}
          <Fold level={0} icon={Package} title="Items sold" hint={items ? `${items.categories.reduce((n, c) => n + c.products.length, 0)} different items` : 'Loading…'}
            value={items ? `${qtyFmt(items.totalUnits)} units` : '…'} defaultOpen>
            {detailError && <Notice>{detailError}</Notice>}
            {!items && !detailError && <LoadingBlock text="Loading items…" />}
            {items && items.categories.length === 0 && <EmptyBlock>Nothing was sold on this day.</EmptyBlock>}
            {items && items.categories.length > 0 && (
              <>
                <div className="mt-1 mb-1"><SearchBox value={q} onChange={setQ} placeholder="Find an item…" /></div>
                {shownCategories.length === 0 && <EmptyBlock>No item matches “{q}”.</EmptyBlock>}
                {shownCategories.map((c) => (
                  <Fold key={c.id} level={1} title={c.name} hint={`${c.products.length} item${c.products.length === 1 ? '' : 's'} · ${money(c.revenue)}`}
                    value={`${qtyFmt(c.units)} units`} defaultOpen open={needle ? true : undefined}>
                    {c.products.map((p) => (
                      <Fold key={p.id} level={2} title={p.name} hint={p.sku || undefined}
                        value={`${qtyFmt(p.units)}${p.unitLabel ? ` ${p.unitLabel}` : ''}`} tone="good"
                        badge={p.prices.length > 1 ? `${p.prices.length} prices` : undefined}>
                        {p.prices.length > 0 && p.prices.map((pl) => (
                          <div key={pl.unit_price} className="flex items-center justify-between gap-2 py-1 text-[12px] text-[#6F7461]">
                            <span>{qtyFmt(pl.units)} × {money(pl.unit_price)}</span>
                            <span className="tabular-nums text-[#23382B]">{money(pl.revenue)}</span>
                          </div>
                        ))}
                      </Fold>
                    ))}
                  </Fold>
                ))}
              </>
            )}
          </Fold>

          {/* ───────── 3. Money out ───────── */}
          <Fold level={0} icon={Wallet} title="Money out" hint="Spending and refunds"
            value={money(Number(s.total_expenses || 0) + Number(s.total_refunds || 0))} tone="bad" defaultOpen>
            <Fold level={1} title="Expenses" value={money(s.total_expenses)} tone="bad" defaultOpen={false}>
              {spend && spend.categories.map((c) => (
                <Fold key={c.name} level={2} title={c.name} value={money(c.total)} tone="bad">
                  {c.entries.map((e) => (
                    <div key={e.id} className="flex items-center justify-between gap-2 py-1 text-[12px] text-[#6F7461]">
                      <span className="truncate">{e.description}</span>
                      <span className="tabular-nums text-[#23382B] shrink-0">{money(e.amount)}</span>
                    </div>
                  ))}
                </Fold>
              ))}
            </Fold>
            <Fold level={1} title="Refunds" hint="Not yet netted into Total sales" value={money(s.total_refunds)} tone="bad" />
          </Fold>

          {/* ───────── 4. Cash drawer ───────── */}
          <Fold level={0} icon={Banknote} title="Cash drawer" hint="Cash put in and taken out by hand" defaultOpen>
            <Fold level={1} title="Cash in" value={money(s.total_cash_in)} tone="good" />
            <Fold level={1} title="Cash out" value={money(s.total_cash_out)} tone="bad" />
          </Fold>

          <p className="text-[11.5px] text-[#8B8766] mb-3 px-1">
            Stock movements today: <b className="text-[#23382B]">{Number(s.stock_movement_count || 0)}</b>
          </p>

          {s.source === 'live' && (
            <button onClick={handleCloseDay} disabled={closing} className={`${saveBtnCls} w-full sm:w-auto px-5 mb-4 inline-flex items-center justify-center gap-2`}>
              <CheckCircle2 size={16} /> {closing ? 'Closing…' : `Close ${date}`}
            </button>
          )}
        </>
      )}
    </FitPage>
  );
}
