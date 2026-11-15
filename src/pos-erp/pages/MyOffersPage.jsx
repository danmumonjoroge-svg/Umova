// src/pos-erp/pages/MyOffersPage.jsx
// My Offers: the products this business has chosen to publish. Pausing or removing an offer never touches the item,
// its stock or any past order. Reuses the existing items (productService); no second product list.
import React, { useEffect, useState } from 'react';
import { ImageIcon, Plus, Store } from 'lucide-react';
import { FitPage, AddButton, SearchBox, MiniStats, CardGrid, DataCard, IconTile, TextBtn, Notice, LoadingBlock, EmptyBlock } from '../components/CardKit';
import Sheet from '../components/workspace/Sheet';
import PublishSheet from '../components/network/PublishSheet';
import { OfflineBanner, useLoad, useOnline } from '../components/network/networkKit';
import { networkService } from '../services/networkService';
import { productService } from '../services/productService';
import { usePermissions } from '../navigation/PermissionsContext';
import { deliveryText, mapNetworkError, money, qtyText } from '../utils/networkHelpers';

function PickProduct({ publishedIds, onPick, onClose }) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const list = useLoad(() => productService.getAll({ activeOnly: true, search: q || undefined, limit: 30 }), [q]);
  const rows = list.data?.data || [];
  return (
    <Sheet title="Choose an item to publish" onClose={onClose}>
      <SearchBox value={text} onChange={setText} placeholder="Search your items…" />
      <div className="mt-3 space-y-2">
        {list.loading && !list.data ? <LoadingBlock /> : list.error ? <Notice>Could not load your items. <button type="button" className="underline font-semibold" onClick={list.reload}>Try again</button></Notice>
          : rows.length === 0 ? <EmptyBlock>No items found.</EmptyBlock>
          : rows.map((p) => (
            <button key={p.id} type="button" onClick={() => onPick(p)} className="w-full flex items-center gap-3 text-left min-h-[56px] rounded-xl border border-[#E3DBB8] bg-white px-3 py-2 hover:border-[#C9A227]">
              <IconTile icon={ImageIcon} src={p.image_url} tone="gold" />
              <span className="min-w-0 flex-1"><span className="block text-[13px] font-bold text-[#23382B] truncate">{p.name}</span><span className="block text-[11px] text-[#8B8766] truncate">{publishedIds.has(p.id) ? 'Already published. Tap to change.' : 'Not published'}</span></span>
            </button>
          ))}
      </div>
    </Sheet>
  );
}

export default function MyOffersPage() {
  const online = useOnline();
  const { can } = usePermissions();
  const canPublish = can('products.manage');
  const offers = useLoad(() => networkService.myOffers(), []);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(null);     // { product, offer }
  const [busyId, setBusyId] = useState(null);
  const [actionErr, setActionErr] = useState(null);

  const rows = offers.data || [];
  const active = rows.filter((o) => o.status === 'ACTIVE').length;
  const publishedIds = new Set(rows.map((o) => o.product_id));

  const setStatus = async (o, status) => {
    if (busyId) return;
    setBusyId(o.offer_id); setActionErr(null);
    try { await networkService.setOfferStatus(o.offer_id, status); await offers.reload(); }
    catch (e) { setActionErr(mapNetworkError(e).message); } finally { setBusyId(null); }
  };
  const pick = (p) => { setPicking(false); setEditing({ product: p, offer: rows.find((o) => o.product_id === p.id) || null }); };

  return (
    <FitPage
      title="My Offers"
      icon={Store}
      subtitle="Products you offer to other businesses."
      action={canPublish && <AddButton onClick={() => setPicking(true)} label="Publish" icon={Plus} />}
      summary={!offers.loading && !offers.error && <MiniStats items={[{ label: 'On the network', value: active, tone: active ? 'good' : undefined }, { label: 'Paused', value: rows.length - active, tone: rows.length - active ? 'gold' : undefined }]} />}
    >
      {!online && <OfflineBanner />}
      {actionErr && <Notice tone="bad">{actionErr}</Notice>}
      {offers.loading && !offers.data ? <LoadingBlock />
        : offers.error && !offers.data ? <Notice>{mapNetworkError(offers.error).message} <button type="button" className="underline font-semibold ml-1" onClick={offers.reload}>Try again</button></Notice>
        : rows.length === 0 ? <EmptyBlock>You have not published anything yet.{canPublish ? ' Tap Publish to share your first item.' : ''}</EmptyBlock>
        : (
          <CardGrid>
            {rows.map((o) => {
              const live = o.status === 'ACTIVE';
              return (
                <DataCard
                  key={o.offer_id}
                  dim={!live}
                  thumb={<IconTile icon={ImageIcon} src={o.image_url} tone="gold" />}
                  title={o.product_name}
                  subtitle={o.accept_new_buyers ? 'Open to new businesses' : 'Connected businesses only'}
                  pill={{ tone: live ? 'good' : 'warn', label: live ? 'Live' : 'Paused' }}
                  big={o.price_mode === 'SHOW' ? { value: money(o.network_price), label: 'network price' } : { value: 'Buyers ask', tone: 'gold' }}
                  metrics={[{ label: 'Min order', value: qtyText(o.min_order_qty) }, { label: 'Delivery', value: deliveryText(o.delivery_days) }]}
                  actions={canPublish && (
                    <>
                      <TextBtn onClick={() => setEditing({ product: { id: o.product_id, name: o.product_name }, offer: o })}>Edit</TextBtn>
                      <TextBtn tone="gold" disabled={busyId === o.offer_id || !online} onClick={() => setStatus(o, live ? 'PAUSED' : 'ACTIVE')}>{live ? 'Pause' : 'Resume'}</TextBtn>
                      <TextBtn tone="danger" disabled={busyId === o.offer_id || !online} onClick={() => setStatus(o, 'REMOVED')}>Remove</TextBtn>
                    </>
                  )}
                />
              );
            })}
          </CardGrid>
        )}
      {picking && <PickProduct publishedIds={publishedIds} onPick={pick} onClose={() => setPicking(false)} />}
      {editing && <PublishSheet product={editing.product} offer={editing.offer} onClose={() => setEditing(null)} onSaved={offers.reload} />}
    </FitPage>
  );
}
