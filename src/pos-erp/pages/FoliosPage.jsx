// src/pos-erp/pages/FoliosPage.jsx
//
// Customer Folios. ONE customer, ONE running bill, settled in one go.
// Not hotel-specific: a folio is any customer's open account (a guest's
// stay, a regular's monthly tab). Charges arrive from the Sell screen
// ("Charge to folio"); this page shows the bill, lets staff add a manual
// charge or a discount, and settles it.
//
// Layout: a list of open folios as cards; tap one for its bill (same
// route, ?folio=<id>). Phone-first: one column, 48px targets, no tables.

import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus, Printer, BookUser, Loader2 } from 'lucide-react';
import { folioService } from '../services/folioService';
import { customerService } from '../services/customerService';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { useNetStatus } from '../offline/useNetStatus';
import { WorkspacePage, SectionTitle, kes } from '../components/workspace/WorkspaceKit';
import Sheet, { fieldClass } from '../components/workspace/Sheet';
import { printDocument } from '../utils/printDocument';
import { buildFolioDocumentHtml } from '../utils/folioDocument';
import { normalizeMpesaCode, isValidMpesaCode } from '../utils/mpesa';

const METHODS = [['CASH', 'Cash'], ['MOBILE_MONEY', 'M-Pesa'], ['CARD', 'Card']];
const CHARGE_TYPES = [['OTHER', 'Other charge'], ['SERVICE', 'Service'], ['ACTIVITY', 'Activity']];
const field = fieldClass;

function FolioBill({ folioId, onBack, openSettle = false }) {
  const { staffId, tenant } = usePosErpAuth();
  const { isOnline } = useNetStatus();
  const [folio, setFolio] = useState(null);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState(null); // 'charge' | 'discount' | 'settle'
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ type: 'OTHER', description: '', quantity: '1', price: '', method: 'CASH', code: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const load = useCallback(async () => {
    try { setFolio(await folioService.getById(folioId)); setError(''); }
    catch (err) { setError(err.message || 'Could not load this folio.'); }
  }, [folioId]);
  useEffect(() => { load(); }, [load]);
  // Arriving from check-out (?settle=1): go straight to the settle sheet once the bill has loaded.
  const settleOpened = React.useRef(false);
  useEffect(() => {
    if (openSettle && folio && folio.status === 'OPEN' && Number(folio.balance_due) > 0 && !settleOpened.current) { settleOpened.current = true; setSheet('settle'); }
  }, [openSettle, folio]);

  const act = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); setSheet(null); setForm((f) => ({ ...f, description: '', quantity: '1', price: '', code: '' })); await load(); }
    catch (err) { setError(err.message || 'That did not work.'); }
    finally { setBusy(false); }
  };

  if (!folio) return <p className="text-sm text-[#68756D]">{error || 'Loading…'}</p>;
  const open = folio.status === 'OPEN';
  const groups = folioService.groupLines(folio.lines);

  const print = (kind) => {
    try { printDocument(`${kind === 'receipt' ? 'Receipt' : 'Invoice'} ${folio.customer?.name || ''}`, buildFolioDocumentHtml(folio, kind)); }
    catch (err) { setError(err.message); }
  };

  const settle = () => act(async () => {
    const balance = Number(folio.balance_due);
    if (form.method === 'MOBILE_MONEY') {
      const code = normalizeMpesaCode(form.code);
      if (!isValidMpesaCode(code)) throw new Error('Enter the M-Pesa code from the SMS (like SHK7X9ABCD).');
      return folioService.settle({ folioId, settledBy: staffId, tenantId: tenant?.id, payments: [{ payment_method: 'MOBILE_MONEY', amount: balance, reference_no: code }] });
    }
    return folioService.settle({ folioId, settledBy: staffId, tenantId: tenant?.id, payments: [{ payment_method: form.method, amount: balance }] });
  });

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-semibold text-[#237A52] min-h-[44px] -ml-1"><ArrowLeft size={16} /> All folios</button>

      <div className="bg-white border border-[#DDE3DD] rounded-xl p-4 mt-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-bold text-lg text-[#26352D] truncate">{folio.customer?.name}</div>
            <div className="text-xs text-[#68756D]">{folio.title ? `${folio.title} · ` : ''}{folio.folio_number}</div>
          </div>
          <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${open ? 'bg-[#C6A15B]/20 text-[#7a5f1f]' : 'bg-[#237A52]/10 text-[#1B5138]'}`}>{open ? 'Open' : folio.status === 'SETTLED' ? 'Settled' : 'Cancelled'}</span>
        </div>

        {groups.length === 0 && <p className="text-sm text-[#68756D] mt-4">Nothing on this bill yet.</p>}
        {groups.map((g) => (
          <div key={g.type} className="mt-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#68756D] mb-1">{g.label}</div>
            <div className="divide-y divide-[#DDE3DD]">
              {g.lines.map((l) => (
                <div key={l.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm text-[#26352D]">{l.description}</div>
                    {Number(l.quantity) !== 1 && <div className="text-xs text-[#68756D]">{Number(l.quantity).toLocaleString()} × {kes(l.unit_price)}</div>}
                    {open && !l.sale_id && !l.stay_id && (
                      <button className="text-xs text-red-600 min-h-[32px]" onClick={() => { const r = window.prompt('Why remove this line?'); if (r) act(() => folioService.voidLine(l.id, r)); }}>Remove</button>
                    )}
                  </div>
                  <div className="text-sm font-semibold tabular-nums shrink-0">{kes(l.amount)}</div>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="border-t border-[#DDE3DD] mt-4 pt-3 flex justify-between text-lg">
          <span className="font-semibold">Total</span><span className="font-bold text-[#1B5138] tabular-nums">{kes(folio.total_charges)}</span>
        </div>
        {folio.payments.map((p) => (
          <div key={p.id} className="flex justify-between text-sm text-[#68756D] mt-1">
            <span>Paid · {(METHODS.find(([k]) => k === p.payment_method) || [, p.payment_method])[1]}{p.reference_no ? ` · ${p.reference_no}` : ''}</span><span className="tabular-nums">{kes(p.amount)}</span>
          </div>
        ))}
        {!open && folio.status === 'SETTLED' && (
          <div className="text-xs text-[#68756D] mt-2">Invoice {folio.invoice_number} · Receipt {folio.receipt_number}</div>
        )}
      </div>

      {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2 mt-3">{error}</div>}

      <div className="grid grid-cols-2 gap-2 mt-3">
        {open ? (<>
          <button onClick={() => setSheet('charge')} disabled={!isOnline} className="min-h-[48px] rounded-xl border border-[#DDE3DD] bg-white text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"><Plus size={16} /> Add charge</button>
          <button onClick={() => setSheet('discount')} disabled={!isOnline} className="min-h-[48px] rounded-xl border border-[#DDE3DD] bg-white text-sm font-semibold disabled:opacity-50">Give discount</button>
          <button onClick={() => print('invoice')} className="min-h-[48px] rounded-xl border border-[#DDE3DD] bg-white text-sm font-semibold flex items-center justify-center gap-1.5"><Printer size={16} /> Print bill</button>
          <button onClick={() => setSheet('settle')} disabled={!isOnline || Number(folio.balance_due) <= 0}
            className="min-h-[48px] rounded-xl bg-[#237A52] hover:bg-[#1B5138] text-white text-sm font-bold disabled:opacity-50">Settle account</button>
        </>) : (<>
          <button onClick={() => print('invoice')} className="min-h-[48px] rounded-xl border border-[#DDE3DD] bg-white text-sm font-semibold flex items-center justify-center gap-1.5"><Printer size={16} /> Invoice</button>
          <button onClick={() => print('receipt')} className="min-h-[48px] rounded-xl bg-[#237A52] text-white text-sm font-bold flex items-center justify-center gap-1.5"><Printer size={16} /> Receipt</button>
        </>)}
      </div>
      {open && !isOnline && <p className="text-xs text-[#68756D] mt-2">Adding charges and settling need a connection. Sales charged at the till are saved on this device and added when you are back online.</p>}

      {sheet === 'charge' && (
        <Sheet title="Add a charge" onClose={() => setSheet(null)}>
          <div className="space-y-2">
            <select className={field} value={form.type} onChange={set('type')}>{CHARGE_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <input className={field} placeholder="What is it for? (e.g. Swimming)" value={form.description} onChange={set('description')} />
            <div className="flex gap-2">
              <input className={field} type="number" inputMode="decimal" placeholder="Qty" value={form.quantity} onChange={set('quantity')} />
              <input className={field} type="number" inputMode="decimal" placeholder="Price each" value={form.price} onChange={set('price')} />
            </div>
            <button disabled={busy || !form.description.trim() || !(Number(form.price) > 0) || !(Number(form.quantity) > 0)} onClick={() => act(() => folioService.addCharge({ folioId, lineType: form.type, description: form.description, quantity: Number(form.quantity), unitPrice: Number(form.price), createdBy: staffId }))}
              className="w-full min-h-[48px] rounded-xl bg-[#237A52] text-white font-bold disabled:opacity-50">{busy ? 'Adding…' : 'Add to bill'}</button>
          </div>
        </Sheet>
      )}
      {sheet === 'discount' && (
        <Sheet title="Give a discount" onClose={() => setSheet(null)}>
          <div className="space-y-2">
            <input className={field} placeholder="Reason (e.g. Goodwill)" value={form.description} onChange={set('description')} />
            <input className={field} type="number" inputMode="decimal" placeholder="Amount off" value={form.price} onChange={set('price')} />
            <button disabled={busy || !form.description.trim() || !(Number(form.price) > 0)} onClick={() => act(() => folioService.addAdjustment({ folioId, description: form.description, amount: Number(form.price), createdBy: staffId }))}
              className="w-full min-h-[48px] rounded-xl bg-[#237A52] text-white font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Take off the bill'}</button>
          </div>
        </Sheet>
      )}
      {sheet === 'settle' && (
        <Sheet title={`Settle · ${kes(folio.balance_due)}`} onClose={() => setSheet(null)}>
          <p className="text-sm text-[#68756D] mb-3">One payment clears the whole account. You get one invoice and one receipt.</p>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {METHODS.map(([k, l]) => (
              <button key={k} onClick={() => setForm((f) => ({ ...f, method: k }))} aria-pressed={form.method === k}
                className={`min-h-[48px] rounded-xl text-sm font-semibold border ${form.method === k ? 'bg-[#237A52] text-white border-[#237A52]' : 'bg-white border-[#DDE3DD]'}`}>{l}</button>
            ))}
          </div>
          {form.method === 'MOBILE_MONEY' && (
            <input className={`${field} font-mono tracking-wider mb-3`} placeholder="M-Pesa code from the SMS" maxLength={12} autoCapitalize="characters" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: normalizeMpesaCode(e.target.value) }))} />
          )}
          <button disabled={busy} onClick={settle} className="w-full min-h-[52px] rounded-xl bg-[#237A52] hover:bg-[#1B5138] text-white font-bold disabled:opacity-50">{busy ? 'Settling…' : `Settle KES ${Number(folio.balance_due).toLocaleString()}`}</button>
        </Sheet>
      )}
    </div>
  );
}

export default function FoliosPage() {
  const { tenant, staffId } = usePosErpAuth();
  const { isOnline } = useNetStatus();
  const [params, setParams] = useSearchParams();
  const selected = params.get('folio');
  const [tab, setTab] = useState('OPEN');
  const [rows, setRows] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [newForm, setNewForm] = useState({ customerId: '', title: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setRows(null);
    try {
      if (tab === 'OPEN') { const r = await folioService.listOpen(); setRows(r.rows); setFromCache(r.fromCache); }
      else { setFromCache(false); setRows((await folioService.listSettled()).map((r) => ({ ...r, customer_name: r.customer?.name || '' }))); }
      setError('');
    } catch (err) { setError(err.message || 'Could not load folios.'); setRows([]); }
  }, [tab]);
  useEffect(() => { if (!selected) load(); }, [load, selected]);

  const openNew = async () => {
    setShowNew(true);
    if (!customers.length) { try { setCustomers((await customerService.getAll({ limit: 200 })).data); } catch { /* picker stays empty; error shows on submit */ } }
  };
  const createFolio = async () => {
    setBusy(true); setError('');
    try {
      const id = await folioService.open({ businessId: tenant?.business_id, customerId: newForm.customerId, title: newForm.title.trim() || null, createdBy: staffId });
      setShowNew(false); setNewForm({ customerId: '', title: '' });
      setParams({ folio: id });
    } catch (err) { setError(err.message || 'Could not open the folio.'); }
    finally { setBusy(false); }
  };

  return (
    <WorkspacePage title="Customer Folios" subtitle="One bill per customer. Charge as they go, settle it all at once.">
      {selected ? (
        <FolioBill folioId={selected} onBack={() => setParams({})} openSettle={params.get('settle') === '1'} />
      ) : (<>
        <div className="flex items-center gap-2 mb-3">
          <div className="grid grid-cols-2 gap-1 bg-[#EEF1EC] rounded-xl p-1 flex-1">
            {[['OPEN', 'Open'], ['SETTLED', 'Settled']].map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k} className={`min-h-[40px] rounded-lg text-sm font-semibold ${tab === k ? 'bg-white shadow-sm text-[#1B5138]' : 'text-[#68756D]'}`}>{l}</button>
            ))}
          </div>
          <button onClick={openNew} disabled={!isOnline} className="shrink-0 min-h-[48px] px-4 rounded-xl bg-[#237A52] text-white text-sm font-bold flex items-center gap-1.5 disabled:opacity-50"><Plus size={16} /> New</button>
        </div>
        {fromCache && <p className="text-xs text-[#68756D] mb-2">Showing folios saved on this device. Balances may be out of date until you are back online.</p>}
        {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2 mb-3">{error}</div>}
        {rows === null && <div className="flex items-center gap-2 text-sm text-[#68756D]"><Loader2 size={16} className="animate-spin" /> Loading…</div>}
        {rows?.length === 0 && !error && (
          <div className="bg-white border border-[#DDE3DD] rounded-xl p-6 text-center text-sm text-[#68756D]">
            <BookUser className="mx-auto mb-2 text-[#237A52]" />
            {tab === 'OPEN' ? 'No open folios. Pick a customer on the Sell screen and choose "Charge to folio", or tap New.' : 'No settled folios yet.'}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(rows || []).map((r) => (
            <button key={r.id} onClick={() => !fromCache && setParams({ folio: r.id })} disabled={fromCache} className="text-left bg-white border border-[#DDE3DD] hover:border-[#237A52] rounded-xl p-4 min-h-[72px] disabled:opacity-70">
              <div className="flex justify-between gap-3">
                <div className="min-w-0"><div className="font-semibold text-[#26352D] truncate">{r.customer_name}</div><div className="text-xs text-[#68756D] truncate">{r.title ? `${r.title} · ` : ''}{r.folio_number}</div></div>
                <div className="text-right shrink-0"><div className="font-bold tabular-nums text-[#1B5138]">{kes(tab === 'OPEN' ? r.balance_due : r.total_charges)}</div><div className="text-[11px] text-[#68756D]">{tab === 'OPEN' ? 'to pay' : 'paid'}</div></div>
              </div>
            </button>
          ))}
        </div>

        {showNew && (
          <Sheet title="Open a folio" onClose={() => setShowNew(false)}>
            <div className="space-y-2">
              <select className={field} value={newForm.customerId} onChange={(e) => setNewForm((f) => ({ ...f, customerId: e.target.value }))}>
                <option value="">Choose a customer</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` — ${c.phone}` : ''}</option>)}
              </select>
              <input className={field} placeholder="Label (optional, e.g. Room 204)" value={newForm.title} onChange={(e) => setNewForm((f) => ({ ...f, title: e.target.value }))} />
              <p className="text-xs text-[#68756D]">A customer has one open folio at a time. If they already have one, it opens instead.</p>
              <button disabled={busy || !newForm.customerId} onClick={createFolio} className="w-full min-h-[48px] rounded-xl bg-[#237A52] text-white font-bold disabled:opacity-50">{busy ? 'Opening…' : 'Open folio'}</button>
            </div>
          </Sheet>
        )}
      </>)}
    </WorkspacePage>
  );
}
