// src/pos-erp/components/network/OfferSheet.jsx  -- "View Offer": every detail of one offer, with the one next step.
import React, { useState } from 'react';
import { Users, Loader2, ShoppingCart } from 'lucide-react';
import Sheet from '../workspace/Sheet';
import { Notice, Pill } from '../CardKit';
import { KeyValues, primaryBtn, ghostBtn } from './networkKit';
import { networkService } from '../../services/networkService';
import { deliveryText, mapNetworkError, money, qtyText, stockBand, timeAgo } from '../../utils/networkHelpers';

export default function OfferSheet({ offer, canOrder, online, onOrder, onClose }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const band = stockBand(offer.stock);

  const connect = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await networkService.requestConnection(offer.supplier_tenant);
      setMsg({ tone: 'good', text: r.status === 'ACCEPTED' ? 'You are already connected.' : 'Request sent. You can order once they accept.' });
    } catch (e) { setMsg({ tone: 'bad', text: mapNetworkError(e).message }); } finally { setBusy(false); }
  };

  return (
    <Sheet title="Offer" onClose={onClose}>
      {offer.image_url && <img src={offer.image_url} alt="" className="w-full h-40 object-cover rounded-xl mb-3 border border-[#E3DBB8]" />}
      <p className="text-[16px] font-bold text-[#23382B] break-words">{offer.product_name}</p>
      <p className="text-[12.5px] text-[#6F7461] mb-2">{offer.supplier_name}{offer.category ? ` · ${offer.category}` : ''}</p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {band && <Pill tone={band.tone}>{band.label}</Pill>}
        {offer.price_is_special && <Pill tone="info">Your special price</Pill>}
        {offer.connected && <Pill tone="good">Connected</Pill>}
      </div>

      <KeyValues rows={[
        { label: 'Price', value: offer.price == null ? 'Ask for a price' : `${money(offer.price)}${offer.unit ? ` per ${offer.unit}` : ''}` },
        { label: 'Smallest order', value: qtyText(offer.min_order_qty) },
        { label: 'Delivery time', value: deliveryText(offer.delivery_days) },
        { label: 'Delivery fee', value: Number(offer.delivery_fee) > 0 ? money(offer.delivery_fee) : 'None' },
        { label: 'Delivers to', value: offer.delivery_areas?.length ? offer.delivery_areas.join(', ') : null },
        { label: 'Stock checked', value: offer.stock_as_of ? timeAgo(offer.stock_as_of) : null },
        { label: 'Supplier note', value: offer.notes },
      ]} />
      <p className="text-[11px] text-[#8B8766] mb-3">Stock can change before the supplier confirms. Nothing is reserved until they do.</p>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {!online && <Notice tone="gold">Connect to the internet to order.</Notice>}

      <div className="space-y-2">
        {offer.can_order ? (
          canOrder
            ? <button type="button" className={primaryBtn} disabled={!online || offer.stock === 'OUT'} onClick={onOrder}><ShoppingCart size={16} />{offer.price == null ? 'Ask for a price and order' : 'Order'}</button>
            : <Notice tone="gold">You need the purchasing permission to order. Ask the owner.</Notice>
        ) : (
          <>
            <Notice tone="gold">This supplier only takes orders from businesses it is connected with.</Notice>
            {canOrder && <button type="button" className={primaryBtn} disabled={busy || !online} onClick={connect}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Users size={16} />} Ask to connect</button>}
          </>
        )}
        {offer.stock === 'OUT' && <p className="text-[12px] text-center text-[#A3352A]">Out of stock right now.</p>}
        <button type="button" className={ghostBtn} onClick={onClose}>Close</button>
      </div>
    </Sheet>
  );
}
