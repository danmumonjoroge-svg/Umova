// One line on the on-screen receipt: provisional (offline) or the tax invoice state. Shows nothing unless tax invoices are ON.
// Display only: the printed copy is unchanged for now.
import React, { useEffect, useState } from 'react';
import { useEtims } from '../hooks/useEtims';
import { etimsService, ETIMS_STATUS_LABEL } from '../services/etimsService';

export default function EtimsReceiptNote({ saleId, isOffline }) {
  const { status } = useEtims();
  const [row, setRow] = useState(null);
  const on = !!status?.enabled;

  useEffect(() => {
    if (!on || isOffline || !saleId) return undefined;
    let alive = true, tries = 0, timer;
    const look = async () => {
      try { const m = await etimsService.statusForSales([saleId]); if (alive) setRow(m[saleId] || null); if (m[saleId]?.status === 'ACCEPTED') return; } catch { /* leave as is */ }
      if (alive && ++tries < 8) timer = setTimeout(look, 5000);
    };
    look();
    return () => { alive = false; clearTimeout(timer); };
  }, [on, isOffline, saleId]);

  if (!on) return null;
  if (isOffline) return <div className="mx-5 mt-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2">Provisional receipt. The KRA tax invoice will follow once this sale syncs.</div>;
  if (!row) return <div className="mx-5 mt-2 text-xs text-[#68756D]">Tax invoice: waiting to send</div>;
  const ok = row.status === 'ACCEPTED';
  return (
    <div className={`mx-5 mt-2 text-xs rounded-lg px-3 py-2 border ${ok ? 'bg-[#E3F1E9] border-[#b9dcc8] text-[#17583a]' : 'bg-[#FBF6E4] border-[#E8D9A0] text-[#6b5516]'}`}>
      Tax invoice: {ETIMS_STATUS_LABEL[row.status] || row.status}{ok && row.kra_data?.rcptSign ? ` · Signature ${row.kra_data.rcptSign}` : ''}
    </div>
  );
}
