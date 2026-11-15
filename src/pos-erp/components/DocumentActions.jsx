// components/DocumentActions.jsx
// One small row of print buttons for the documents that belong to a record.
//   <DocumentActions items={[['PURCHASE_ORDER','Print PO', poId], ['GOODS_RECEIVED','Delivery note', grnId]]} />
// Printing only reads records; it never changes anything.
import React, { useState } from 'react';
import { Printer, Loader2 } from 'lucide-react';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { documentsService } from '../services/documentsService';

export default function DocumentActions({ items, className = '' }) {
  const { tenant } = usePosErpAuth();
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState('');
  const run = async (kind, id) => {
    setBusy(kind + id); setErr('');
    try { await documentsService.print(kind, { tenantId: tenant?.id, businessId: tenant?.business_id, id }); }
    catch (e) { console.error('[DocumentActions]', e); setErr('Could not prepare that document. Check your connection and try again.'); }
    finally { setBusy(null); }
  };
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`} onClick={(e) => e.stopPropagation()}>
      {items.filter(([, , id]) => id).map(([kind, label, id]) => (
        <button key={kind + id} type="button" onClick={() => run(kind, id)} disabled={!!busy} className="inline-flex items-center gap-1 text-xs font-semibold text-[#1F6B45] hover:underline disabled:opacity-50">
          {busy === kind + id ? <Loader2 size={12} className="animate-spin" /> : <Printer size={12} />}{label}
        </button>
      ))}
      {err && <span className="text-xs text-red-600">{err}</span>}
    </span>
  );
}
