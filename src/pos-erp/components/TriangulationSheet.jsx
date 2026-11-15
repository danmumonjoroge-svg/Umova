// components/TriangulationSheet.jsx
// "Do the three documents agree?" for one purchase order: ordered (PO) vs received (delivery note / GRN) vs billed
// (supplier invoice). Plain-language findings; prints each document from here. Informational: it never blocks anything.
import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Clock, Loader2 } from 'lucide-react';
import Sheet from './workspace/Sheet';
import DocumentActions from './DocumentActions';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { documentsService } from '../services/documentsService';
import { MATCH_LABEL } from '../utils/triangulation';

const TONE = { MATCHED: ['bg-emerald-50 text-emerald-800 border-emerald-200', CheckCircle2], NEEDS_REVIEW: ['bg-amber-50 text-amber-800 border-amber-200', AlertTriangle], NO_INVOICE: ['bg-sky-50 text-sky-800 border-sky-200', Clock], NO_DELIVERY: ['bg-slate-50 text-slate-700 border-slate-200', Clock] };
const k = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const q = (n) => Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 3 });

export default function TriangulationSheet({ poId, onClose }) {
  const { tenant } = usePosErpAuth();
  const [t, setT] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { documentsService.purchaseTrail({ tenantId: tenant?.id, businessId: tenant?.business_id, poId }).then(setT).catch((e) => { console.error(e); setErr('Could not load the documents for this order.'); }); }, [poId, tenant]);
  const m = t?.match; const [cls, Icon] = TONE[m?.status] || TONE.NO_DELIVERY;
  return (
    <Sheet title={t ? `Document check · ${t.po.po_number}` : 'Document check'} onClose={onClose}>
      {err && <div className="text-sm text-red-600">{err}</div>}
      {!t && !err && <div className="py-8 text-center text-slate-400"><Loader2 size={16} className="animate-spin inline mr-2" />Loading…</div>}
      {t && (
        <div className="space-y-3 text-sm">
          <div className={`border rounded-xl px-3 py-2 font-semibold flex items-center gap-2 ${cls}`}><Icon size={16} />{MATCH_LABEL[m.status]}</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="border border-[#E3DBB8] rounded-xl p-2"><div className="text-[10px] font-bold uppercase text-[#6F7461]">Ordered</div><div className="font-bold">{k(m.totals.poTotal)}</div><div className="text-[11px] text-[#8A8A70]">{t.po.po_number}</div></div>
            <div className="border border-[#E3DBB8] rounded-xl p-2"><div className="text-[10px] font-bold uppercase text-[#6F7461]">Received</div><div className="font-bold">{k(m.totals.receivedValue)}</div><div className="text-[11px] text-[#8A8A70]">{m.totals.deliveries} deliver{m.totals.deliveries === 1 ? 'y' : 'ies'}</div></div>
            <div className="border border-[#E3DBB8] rounded-xl p-2"><div className="text-[10px] font-bold uppercase text-[#6F7461]">Invoiced</div><div className="font-bold">{m.totals.invoiceTotal ? k(m.totals.invoiceTotal) : '—'}</div><div className="text-[11px] text-[#8A8A70]">{m.totals.invoiceNos.join(', ') || 'no invoice yet'}</div></div>
          </div>
          {m.issues.length > 0 && <ul className="space-y-1">{m.issues.map((i, n) => <li key={n} className="text-[13px] text-[#4A5240]">• {i}</li>)}</ul>}
          <table className="w-full text-xs"><thead><tr className="text-left text-[#6F7461]"><th className="py-1">Item</th><th className="text-right">Ordered</th><th className="text-right">Received</th></tr></thead>
            <tbody>{m.lines.map((l) => <tr key={l.id} className="border-t border-[#EFE8C8]"><td className="py-1.5">{l.name}</td><td className="text-right">{q(l.ordered)}</td><td className={`text-right ${l.flags.length ? 'text-amber-700 font-semibold' : ''}`}>{q(l.received)}</td></tr>)}</tbody></table>
          <div className="pt-2 border-t border-[#EFE8C8]"><div className="text-[11px] font-bold uppercase text-[#6F7461] mb-1">Print</div>
            <DocumentActions items={[['PURCHASE_ORDER', 'Purchase order', poId], ...t.grns.map((g) => ['GOODS_RECEIVED', `Delivery note ${g.grn_number}`, g.id])]} /></div>
        </div>
      )}
    </Sheet>
  );
}
