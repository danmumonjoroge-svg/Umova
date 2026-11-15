// src/pos-erp/components/network/CompareSheet.jsx
// Side-by-side offers on practical criteria. Deliberately NO overall winner: price is only one row.
import React from 'react';
import Sheet from '../workspace/Sheet';
import { compareBest, deliveryText, money, qtyText, stockBand } from '../../utils/networkHelpers';

export default function CompareSheet({ offers, onPick, onClose }) {
  const best = compareBest(offers);
  const rows = [
    { label: 'Estimated cost (smallest order)', get: (o) => (o.est_total_at_min == null ? 'Ask for price' : money(o.est_total_at_min)), mark: best.total },
    { label: 'Delivery time', get: (o) => deliveryText(o.delivery_days), mark: best.delivery },
    { label: 'Smallest order', get: (o) => qtyText(o.min_order_qty), mark: best.moq },
    { label: 'Delivery fee', get: (o) => (Number(o.delivery_fee) > 0 ? money(o.delivery_fee) : 'None') },
    { label: 'Stock', get: (o) => stockBand(o.stock)?.label || 'Not shown' },
  ];
  return (
    <Sheet title="Compare offers" onClose={onClose}>
      <p className="text-[11.5px] text-[#8B8766] mb-2">A gold dot marks the best on that line. Choose by what matters to you, not price alone.</p>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${offers.length}, minmax(0, 1fr))` }}>
        {offers.map((o) => (
          <div key={o.offer_id} className="min-w-0 rounded-xl border border-[#E3DBB8] bg-[#FFFDF4] p-2">
            <p className="text-[12px] font-bold text-[#23382B] leading-tight line-clamp-2 break-words">{o.supplier_name}</p>
            <p className="text-[10.5px] text-[#8B8766] line-clamp-1 break-words">{o.product_name}</p>
          </div>
        ))}
      </div>
      {rows.map((r) => (
        <div key={r.label} className="mt-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[#A29E80] mb-0.5">{r.label}</p>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${offers.length}, minmax(0, 1fr))` }}>
            {offers.map((o, i) => (
              <div key={o.offer_id} className="min-w-0 text-[12.5px] font-semibold text-[#23382B] break-words">
                {r.mark?.[i] && <span className="inline-block w-2 h-2 rounded-full bg-[#C9A227] mr-1 align-middle" aria-label="best" />}{r.get(o)}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="grid gap-2 mt-4" style={{ gridTemplateColumns: `repeat(${offers.length}, minmax(0, 1fr))` }}>
        {offers.map((o) => (
          <button key={o.offer_id} type="button" onClick={() => onPick(o)} className="min-h-[44px] rounded-xl bg-[#1F6B45] text-white text-[12.5px] font-bold border-b-2 border-[#C9A227]">View</button>
        ))}
      </div>
    </Sheet>
  );
}
