// src/pos-erp/components/network/PublishSheet.jsx
// Publish ONE existing item to the network (or change its offer). Shared by My Offers and the My Items screen.
// Only what the owner chooses here becomes visible to other businesses; the item's own selling price, cost and SKU stay private.
import React, { useState } from 'react';
import { ChevronDown, Loader2, Send } from 'lucide-react';
import Sheet, { fieldClass } from '../workspace/Sheet';
import { Notice } from '../CardKit';
import { Field, primaryBtn } from './networkKit';
import { networkService } from '../../services/networkService';
import { singleFlight } from '../../utils/singleFlight';
import { mapNetworkError } from '../../utils/networkHelpers';

const Toggle = ({ on, onChange, title, hint }) => (
  <button type="button" onClick={() => onChange(!on)} className="w-full flex items-center justify-between gap-3 text-left min-h-[52px] py-2 border-b border-[#F0EACF]">
    <span className="min-w-0"><span className="block text-[13px] font-semibold text-[#23382B]">{title}</span>{hint && <span className="block text-[11px] text-[#8B8766]">{hint}</span>}</span>
    <span className={`shrink-0 w-11 h-6 rounded-full p-0.5 transition-colors ${on ? 'bg-[#1F6B45]' : 'bg-[#D8D3B8]'}`}><span className={`block w-5 h-5 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : ''}`} /></span>
  </button>
);

/** product: { id, name, selling_price?, wholesale_price? }   offer: an existing network offer (to edit) or null */
export default function PublishSheet({ product, offer, onClose, onSaved }) {
  const suggested = offer?.network_price ?? product.wholesale_price ?? product.selling_price ?? '';
  const [priceMode, setPriceMode] = useState(offer?.price_mode || 'SHOW');
  const [price, setPrice] = useState(suggested === '' ? '' : String(suggested));
  const [minQty, setMinQty] = useState(String(offer?.min_order_qty ?? 1));
  const [showStock, setShowStock] = useState(offer?.show_stock ?? true);
  const [newBuyers, setNewBuyers] = useState(offer?.accept_new_buyers ?? true);
  const [more, setMore] = useState(false);
  const [days, setDays] = useState(offer?.delivery_days == null ? '' : String(offer.delivery_days));
  const [fee, setFee] = useState(String(offer?.delivery_fee ?? 0));
  const [areas, setAreas] = useState((offer?.delivery_areas || []).join(', '));
  const [notes, setNotes] = useState(offer?.notes || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const save = singleFlight(`publish-${product.id}`, async () => {
    setErr(null);
    if (priceMode === 'SHOW' && !(Number(price) > 0)) return setErr('Enter a price, or choose "Let buyers ask".');
    if (!(Number(minQty) > 0)) return setErr('The smallest order must be more than zero.');
    setBusy(true);
    try {
      await networkService.publishOffer({
        productId: product.id, priceMode, price, minQty, showStock, acceptNewBuyers: newBuyers, days, fee,
        areas: areas.split(',').map((a) => a.trim()).filter(Boolean), notes: notes.trim(),
      });
      onSaved?.();
      onClose();
    } catch (e) { setErr(mapNetworkError(e).message); } finally { setBusy(false); }
  });

  return (
    <Sheet title={offer ? 'Change offer' : 'Publish to Network'} onClose={onClose}>
      <p className="text-[15px] font-bold text-[#23382B] break-words">{product.name}</p>
      <p className="text-[12px] text-[#6F7461] mb-3">Other businesses will see only what you choose below.</p>
      {err && <Notice tone="bad">{err}</Notice>}

      <div className="grid grid-cols-2 gap-2 mb-3">
        {[['SHOW', 'Show my price'], ['REQUEST', 'Let buyers ask']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setPriceMode(k)} className={`min-h-[48px] rounded-xl border text-[13px] font-semibold ${priceMode === k ? 'bg-[#E3F1E7] border-[#1F6B45] text-[#1B5138]' : 'bg-white border-[#E3DBB8] text-[#5E6350]'}`}>{l}</button>
        ))}
      </div>
      {priceMode === 'SHOW' && (
        <Field label="Price for other businesses (KES)" hint="This is separate from your shop price. Only this one is shown."><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} className={fieldClass} /></Field>
      )}
      <Field label="Smallest order"><input inputMode="decimal" value={minQty} onChange={(e) => setMinQty(e.target.value.replace(/[^0-9.]/g, ''))} className={fieldClass} /></Field>
      <Toggle on={showStock} onChange={setShowStock} title="Show if it is in stock" hint="Buyers see In stock / Low / Out. Never your exact count." />
      <Toggle on={newBuyers} onChange={setNewBuyers} title="Take orders from new businesses" hint="Turn off to sell only to businesses you have connected with." />

      <button type="button" onClick={() => setMore((m) => !m)} className="mt-3 mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#1F6B45] min-h-[32px]">More options <ChevronDown size={14} className={more ? 'rotate-180' : ''} /></button>
      {more && (
        <div>
          <Field label="Delivery time (days)"><input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, ''))} placeholder="Leave empty if it varies" className={fieldClass} /></Field>
          <Field label="Delivery fee (KES)"><input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value.replace(/[^0-9.]/g, ''))} className={fieldClass} /></Field>
          <Field label="Areas you deliver to" hint="Separate with commas"><input value={areas} onChange={(e) => setAreas(e.target.value)} placeholder="Kikuyu, Kabete, Limuru" className={fieldClass} /></Field>
          <Field label="Note for buyers"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={fieldClass} /></Field>
        </div>
      )}
      <button type="button" className={`${primaryBtn} mt-2`} disabled={busy} onClick={save}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} {offer ? 'Save changes' : 'Publish'}</button>
    </Sheet>
  );
}
