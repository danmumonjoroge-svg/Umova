// src/pos-erp/components/network/OrderSheet.jsx
// Place an order from one offer: quantity -> delivery/collection -> note -> send. One short sheet, phone first.
//
// Safe-retry rules (the database enforces them too):
//   * the order carries a reference made when the sheet opens; the SAME request retried reuses it (no duplicate order),
//     a CHANGED request gets a new one;
//   * if the internet drops while sending we cannot know whether the supplier received it, so the form locks and we say
//     so plainly ("check My Orders before sending again") -- we never claim success and never silently resend something different;
//   * the price shown is only an estimate. The server re-checks price, minimum and stock when you send.
import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Loader2, Minus, Plus, Send, Truck, Store } from 'lucide-react';
import Sheet, { fieldClass } from '../workspace/Sheet';
import { Notice } from '../CardKit';
import { Field, KeyValues, primaryBtn, ghostBtn } from './networkKit';
import { networkService } from '../../services/networkService';
import { singleFlight } from '../../utils/singleFlight';
import { estTotal, money, mapNetworkError, newClientRef, orderSignature, qtyText } from '../../utils/networkHelpers';

export default function OrderSheet({ offer, onClose }) {
  const moq = Number(offer.min_order_qty) || 1;
  const [qty, setQty] = useState(String(moq));
  const [method, setMethod] = useState('DELIVERY');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [price, setPrice] = useState(offer.price);          // may be corrected by the server if it changed
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [unsure, setUnsure] = useState(false);               // sent, answer unknown (connection dropped)
  const [done, setDone] = useState(null);
  const ref = useRef({ sig: null, id: newClientRef() });

  const q = Number(qty);
  const total = estTotal(price, q, offer.delivery_fee, method);
  const locked = busy || unsure;

  const bump = (d) => setQty(String(Math.max(moq, Math.round(((Number(qty) || moq) + d) * 1000) / 1000)));

  const send = singleFlight(`net-order-${ref.current.id}`, async () => {
    setErr(null);
    if (!(q >= moq)) return setErr({ message: `The minimum order is ${qtyText(moq)}.` });
    if (method === 'DELIVERY' && !address.trim()) return setErr({ message: 'Enter where the goods should be delivered.' });
    const sig = orderSignature({ offerId: offer.offer_id, qty: q, method, address, note });
    if (ref.current.sig !== sig) ref.current = { sig, id: ref.current.sig === null ? ref.current.id : newClientRef() };
    setBusy(true);
    try {
      const res = await networkService.submitOrder({
        clientRef: ref.current.id, lines: [{ offer_id: offer.offer_id, quantity: q }], method, address, note, expectedTotal: total,
      });
      setDone(res);
    } catch (e) {
      const m = mapNetworkError(e);
      if (m.kind === 'price_changed' && m.newTotal != null && q > 0) {
        const fee = method === 'COLLECTION' ? 0 : Number(offer.delivery_fee || 0);
        setPrice(Math.round(((m.newTotal - fee) / q) * 100) / 100);   // show the new price; the buyer must tap Send again
      }
      if (m.unsure) setUnsure(true);
      setErr(m);
    } finally { setBusy(false); }
  });

  if (done) {
    return (
      <Sheet title="Order sent" onClose={onClose}>
        <div className="text-center py-2">
          <CheckCircle2 size={40} className="mx-auto text-[#1F6B45]" />
          <p className="mt-2 text-sm text-[#4B5646]">Your order reference is</p>
          <p className="text-xl font-extrabold text-[#23382B] tracking-wide break-all">{done.order_ref}</p>
        </div>
        <Notice tone="gold">Waiting for {offer.supplier_name} to confirm. Nothing is reserved for you until they do.</Notice>
        <div className="space-y-2">
          <Link to="/pos/network/orders" className={primaryBtn} onClick={onClose}>See my orders</Link>
          <button type="button" className={ghostBtn} onClick={onClose}>Keep looking</button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Order" onClose={onClose}>
      <p className="text-[15px] font-bold text-[#23382B] break-words">{offer.product_name}</p>
      <p className="text-[12px] text-[#6F7461] mb-3">from {offer.supplier_name}</p>

      {err && <Notice tone={err.kind === 'offline' ? 'gold' : 'bad'}>{err.message}</Notice>}
      {unsure && (
        <Notice tone="gold">
          We could not tell if your order was received. <Link to="/pos/network/orders" className="underline font-semibold" onClick={onClose}>Check My Orders</Link> before
          sending again, or tap Send to try the same order once more. It cannot be sent twice.
        </Notice>
      )}

      <Field label={`How many${offer.unit ? ` (${offer.unit})` : ''}?`} hint={moq > 1 ? `Minimum order: ${qtyText(moq)}` : null}>
        <div className="flex items-stretch gap-2">
          <button type="button" aria-label="Less" disabled={locked} onClick={() => bump(-1)} className="w-12 min-h-[48px] rounded-xl border border-[#E3DBB8] bg-white flex items-center justify-center text-[#1F6B45] disabled:opacity-50"><Minus size={18} /></button>
          <input inputMode="decimal" value={qty} disabled={locked} onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ''))} className={`${fieldClass} text-center text-lg font-bold`} />
          <button type="button" aria-label="More" disabled={locked} onClick={() => bump(1)} className="w-12 min-h-[48px] rounded-xl border border-[#E3DBB8] bg-white flex items-center justify-center text-[#1F6B45] disabled:opacity-50"><Plus size={18} /></button>
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-2 mb-3">
        {[['DELIVERY', 'Deliver to me', Truck], ['COLLECTION', 'I will collect', Store]].map(([k, label, Icon]) => (
          <button key={k} type="button" disabled={locked} onClick={() => setMethod(k)}
            className={`min-h-[48px] rounded-xl border text-[13px] font-semibold flex items-center justify-center gap-2 ${method === k ? 'bg-[#E3F1E7] border-[#1F6B45] text-[#1B5138]' : 'bg-white border-[#E3DBB8] text-[#5E6350]'}`}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>
      {method === 'DELIVERY' && (
        <Field label="Delivery address"><input value={address} disabled={locked} onChange={(e) => setAddress(e.target.value)} placeholder="Town, street, landmark" className={fieldClass} /></Field>
      )}
      <Field label="Note for the supplier (optional)"><input value={note} disabled={locked} onChange={(e) => setNote(e.target.value)} className={fieldClass} /></Field>

      <KeyValues rows={[
        { label: 'Price each', value: price == null ? 'Supplier will quote' : money(price) },
        method === 'DELIVERY' && Number(offer.delivery_fee) > 0 ? { label: 'Delivery fee', value: money(offer.delivery_fee) } : null,
        { label: 'Estimated total', value: total == null ? 'Supplier will confirm' : money(total) },
      ]} />
      <p className="text-[11px] text-[#8B8766] mb-3">This is an estimate. The supplier confirms the final price and what is in stock.</p>

      <button type="button" className={primaryBtn} disabled={busy} onClick={send}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} {busy ? 'Sending…' : unsure ? 'Try sending again' : 'Send order'}
      </button>
    </Sheet>
  );
}
