// src/pos-erp/pages/FindStockPage.jsx
//
// Find Stock: search what other businesses have chosen to publish, compare, and order.
// Phone first: cards two across, one big action ("View Offer"), advanced options folded away.
// Everything shown comes from network_search_offers, which returns ONLY fields the supplier approved.
// Needs internet in v1 (no offline queue for this feature): offline we say so and keep what is already on screen.
import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ImageIcon, ClipboardCheck, Search, SlidersHorizontal } from 'lucide-react';
import { FitPage, SearchBox, FilterChips, CardGrid, DataCard, IconTile, Notice, LoadingBlock, EmptyBlock, TextBtn, inputCls } from '../components/CardKit';
import OfferSheet from '../components/network/OfferSheet';
import OrderSheet from '../components/network/OrderSheet';
import CompareSheet from '../components/network/CompareSheet';
import { OfflineBanner, smallPrimary, useLoad, useOnline } from '../components/network/networkKit';
import { usePermissions } from '../navigation/PermissionsContext';
import { networkService } from '../services/networkService';
import { deliveryText, mapNetworkError, money, qtyText, stockBand, timeAgo } from '../utils/networkHelpers';

const PAGE = 30;
const SORTS = [['relevance', 'A to Z'], ['price', 'Lowest price'], ['delivery', 'Fastest delivery'], ['moq', 'Smallest order']];

export default function FindStockPage() {
  const online = useOnline();
  const { can } = usePermissions();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('relevance');
  const [advanced, setAdvanced] = useState(false);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [orderableOnly, setOrderableOnly] = useState(false);
  const [extra, setExtra] = useState([]);          // pages after the first
  const [more, setMore] = useState({ busy: false, error: null, done: false });
  const [compare, setCompare] = useState([]);      // offer ids
  const [viewing, setViewing] = useState(null);
  const [ordering, setOrdering] = useState(null);
  const [comparing, setComparing] = useState(false);

  // wait for a pause in typing so we do not ask the server on every key
  useEffect(() => { const t = setTimeout(() => setQuery(text.trim()), 350); return () => clearTimeout(t); }, [text]);

  const cats = useLoad(() => networkService.categories(), []);
  const first = useLoad(() => networkService.search({ query, category, sort, limit: PAGE, offset: 0 }), [query, category, sort]);
  useEffect(() => { setExtra([]); setMore({ busy: false, error: null, done: false }); }, [query, category, sort]);

  const all = useMemo(() => [...(first.data || []), ...extra], [first.data, extra]);
  const shown = all.filter((o) => (!inStockOnly || o.stock !== 'OUT') && (!orderableOnly || o.can_order));
  const canOrder = can('purchases.create');
  const chosen = all.filter((o) => compare.includes(o.offer_id));

  const loadMore = async () => {
    setMore((m) => ({ ...m, busy: true, error: null }));
    try {
      const rows = await networkService.search({ query, category, sort, limit: PAGE, offset: all.length });
      setExtra((e) => [...e, ...rows]);
      setMore({ busy: false, error: null, done: rows.length < PAGE });
    } catch (e) { setMore({ busy: false, error: mapNetworkError(e).message, done: false }); }
  };
  const toggleCompare = (id) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= 3 ? c : [...c, id]));

  const chips = [{ key: '', label: 'All' }, ...((cats.data || []).map((c) => ({ key: c.name, label: c.name, count: c.count })))];
  const err = first.error ? mapNetworkError(first.error) : null;

  return (
    <FitPage
      title="Find Stock"
      icon={Search}
      subtitle="Products other businesses offer you."
      toolbar={(
        <div className="space-y-2">
          <SearchBox value={text} onChange={setText} placeholder="Search a product, brand or supplier…" />
          {chips.length > 1 && <FilterChips options={chips} value={category} onChange={setCategory} />}
          <button type="button" onClick={() => setAdvanced((a) => !a)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#1F6B45] min-h-[32px]">
            <SlidersHorizontal size={14} /> More options <ChevronDown size={14} className={advanced ? 'rotate-180' : ''} />
          </button>
          {advanced && (
            <div className="bg-white border border-[#E3DBB8] rounded-xl p-3 space-y-2">
              <label className="block text-[12px] font-bold text-[#4B5646]">Sort by
                <select value={sort} onChange={(e) => setSort(e.target.value)} className={`${inputCls} mt-1`}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </label>
              <label className="flex items-center gap-2 text-[13px] text-[#23382B] min-h-[36px]"><input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} className="w-5 h-5" /> Hide out of stock</label>
              <label className="flex items-center gap-2 text-[13px] text-[#23382B] min-h-[36px]"><input type="checkbox" checked={orderableOnly} onChange={(e) => setOrderableOnly(e.target.checked)} className="w-5 h-5" /> Only ones I can order now</label>
            </div>
          )}
          {chosen.length >= 2 && (
            <button type="button" onClick={() => setComparing(true)} className="w-full min-h-[40px] rounded-xl bg-[#FBF3D5] border border-[#EBD98A] text-[#6B4F0B] text-[13px] font-bold inline-flex items-center justify-center gap-2">
              <ClipboardCheck size={15} /> Compare {chosen.length} offers
            </button>
          )}
        </div>
      )}
    >
      {!online && <OfflineBanner />}
      {first.loading && !first.data ? <LoadingBlock text="Looking for offers…" />
        : err && !first.data ? (
          <Notice tone="bad">{err.message} <button type="button" className="underline font-semibold ml-1" onClick={first.reload}>Try again</button></Notice>
        ) : shown.length === 0 ? (
          <EmptyBlock>{query || category ? 'No offers match. Try a different word or category.' : 'No offers yet. Suppliers will appear here once they publish products.'}</EmptyBlock>
        ) : (
          <>
            {err && <Notice tone="gold">Could not refresh. Showing what we found earlier. <button type="button" className="underline font-semibold" onClick={first.reload}>Try again</button></Notice>}
            <CardGrid>
              {shown.map((o) => {
                const band = stockBand(o.stock);
                const on = compare.includes(o.offer_id);
                return (
                  <DataCard
                    key={o.offer_id}
                    dim={o.stock === 'OUT'}
                    thumb={<IconTile icon={ImageIcon} src={o.image_url} tone="gold" />}
                    title={o.product_name}
                    subtitle={o.supplier_name}
                    pill={band ? { tone: band.tone, label: band.label } : null}
                    big={o.price == null ? { value: 'Ask for price', tone: 'gold' } : { value: money(o.price), label: o.unit ? `/ ${o.unit}` : '' }}
                    metrics={[
                      { label: 'Min order', value: qtyText(o.min_order_qty) },
                      { label: 'Delivery', value: deliveryText(o.delivery_days) },
                      ...(o.stock_as_of ? [{ label: 'Stock checked', value: timeAgo(o.stock_as_of) }] : []),
                      ...(!o.can_order ? [{ label: 'Orders', value: 'Connect first', tone: 'gold' }] : []),
                    ]}
                    actions={(
                      <>
                        <button type="button" className={smallPrimary} onClick={() => setViewing(o)}>View Offer</button>
                        <TextBtn tone={on ? 'gold' : undefined} onClick={() => toggleCompare(o.offer_id)} disabled={!on && compare.length >= 3} title="Compare">{on ? '✓ Compare' : 'Compare'}</TextBtn>
                      </>
                    )}
                  />
                );
              })}
            </CardGrid>
            {!more.done && all.length >= PAGE && all.length % PAGE === 0 && (
              <div className="mt-3 text-center">
                {more.error && <p className="text-[12px] text-[#A3352A] mb-1">{more.error}</p>}
                <button type="button" onClick={loadMore} disabled={more.busy || !online} className="min-h-[44px] px-6 rounded-xl border border-[#E3DBB8] bg-white text-[#1F6B45] text-[13px] font-semibold disabled:opacity-50">{more.busy ? 'Loading…' : 'Show more'}</button>
              </div>
            )}
          </>
        )}

      {viewing && !ordering && <OfferSheet offer={viewing} canOrder={canOrder} online={online} onOrder={() => setOrdering(viewing)} onClose={() => setViewing(null)} />}
      {ordering && <OrderSheet offer={ordering} onClose={() => { setOrdering(null); setViewing(null); }} />}
      {comparing && <CompareSheet offers={chosen} onPick={(o) => { setComparing(false); setViewing(o); }} onClose={() => setComparing(false)} />}
    </FitPage>
  );
}
