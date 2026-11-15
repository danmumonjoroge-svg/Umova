// src/pos-erp/components/network/OrderDetail.jsx
//
// One order, seen from the caller's own side. Progress bar first, then the people, the goods, and the next step.
// Every button here calls a database function that re-checks permission, ownership and state; hiding a button is only
// politeness. Invoice and payment are shown SEPARATELY from delivery: a sent or confirmed order is never shown as paid.
import React, { useState } from 'react';
import { Loader2, Phone } from 'lucide-react';
import Sheet, { fieldClass } from '../workspace/Sheet';
import { Notice, Pill, LoadingBlock } from '../CardKit';
import { Field, KeyValues, ProgressBar, dangerBtn, ghostBtn, primaryBtn, useIdempotentRef, useLoad } from './networkKit';
import { networkService } from '../../services/networkService';
import { usePermissions } from '../../navigation/PermissionsContext';
import { singleFlight } from '../../utils/singleFlight';
import { mapNetworkError, money, qtyText, statusLabel, statusTone } from '../../utils/networkHelpers';

const INVOICE = { NOT_INVOICED: 'Not invoiced yet', INVOICED: 'Invoiced' };
const PAYMENT = { UNPAID: 'Not paid yet', PARTLY_PAID: 'Partly paid', PAID: 'Paid' };

export default function OrderDetail({ orderId, online, onChanged, onClose }) {
  const { can } = usePermissions();
  const order = useLoad(() => networkService.getOrder(orderId), [orderId]);
  const [panel, setPanel] = useState(null);       // 'confirm' | 'reject' | 'dispatch' | 'cancel' | 'dispute'
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [edit, setEdit] = useState({});            // per-line { qty, price }
  const confirmRef = useIdempotentRef('NETCNF');
  const dispatchRef = useIdempotentRef('NETDSP');

  const o = order.data;
  const side = o?.my_side;                          // 'BUYER' | 'SUPPLIER'
  const lines = o?.lines || [];

  const run = async (fn) => {
    setBusy(true); setErr(null);
    try { await fn(); setPanel(null); setReason(''); setNote(''); setEdit({}); await order.reload(); onChanged?.(); }
    catch (e) { setErr(mapNetworkError(e)); } finally { setBusy(false); }
  };
  const open = (p) => { setErr(null); setPanel(p); };

  const confirmLines = () => lines.map((l) => ({
    line_id: l.line_id, quantity: Number(edit[l.line_id]?.qty ?? l.qty_ordered),
    ...(l.unit_price == null && edit[l.line_id]?.price !== undefined && edit[l.line_id]?.price !== '' ? { unit_price: Number(edit[l.line_id].price) } : {}),
  }));
  const dispatchLines = () => lines.map((l) => ({ line_id: l.line_id, quantity: Number(edit[l.line_id]?.qty ?? Math.max(l.qty_confirmed - l.qty_dispatched, 0)) }));

  const doConfirm = singleFlight(`net-confirm-${orderId}`, () => run(() => {
    const ls = confirmLines();
    return networkService.confirm(orderId, confirmRef(JSON.stringify([ls, note])), ls, note || null);
  }));
  const doDispatch = singleFlight(`net-dispatch-${orderId}`, () => run(() => {
    const ls = dispatchLines();
    return networkService.dispatch(orderId, dispatchRef(JSON.stringify([ls, note])), ls, note || null);
  }));
  const doReject = singleFlight(`net-reject-${orderId}`, () => (reason.trim() ? run(() => networkService.reject(orderId, reason.trim())) : setErr({ message: 'Give the buyer a short reason.' })));
  const doPreparing = singleFlight(`net-prep-${orderId}`, () => run(() => networkService.markPreparing(orderId)));
  const doCancel = singleFlight(`net-cancel-${orderId}`, () => (side === 'SUPPLIER' && !reason.trim() ? setErr({ message: 'Give the buyer a short reason.' }) : run(() => networkService.cancel(orderId, side, reason.trim() || null))));
  const doDispute = singleFlight(`net-dispute-${orderId}`, () => (reason.trim() ? run(() => networkService.dispute(orderId, reason.trim())) : setErr({ message: 'Describe the problem briefly.' })));

  const setLine = (id, k, v) => setEdit((e) => ({ ...e, [id]: { ...e[id], [k]: v } }));
  const supplier = side === 'SUPPLIER' && can('sales.create');
  const buyer = side === 'BUYER' && can('purchases.create');
  const remaining = lines.some((l) => l.qty_confirmed > l.qty_dispatched);

  if (order.loading && !o) return <Sheet title="Order" onClose={onClose}><LoadingBlock /></Sheet>;
  if (!o) return <Sheet title="Order" onClose={onClose}><Notice>{mapNetworkError(order.error).message} <button type="button" className="underline font-semibold" onClick={order.reload}>Try again</button></Notice></Sheet>;

  const panelBody = (
    <>
      {err && <Notice tone={err.kind === 'offline' ? 'gold' : 'bad'}>{err.message}</Notice>}
      {panel === 'confirm' && (
        <div>
          <p className="text-[13px] font-bold text-[#23382B] mb-2">Confirm what you can supply</p>
          {lines.map((l) => (
            <div key={l.line_id} className="mb-2 rounded-xl border border-[#E3DBB8] p-2.5">
              <p className="text-[13px] font-semibold text-[#23382B] break-words">{l.product_name}</p>
              <div className="grid grid-cols-2 gap-2 mt-1.5">
                <Field label={`Quantity (asked ${qtyText(l.qty_ordered)})`}><input inputMode="decimal" className={fieldClass} value={edit[l.line_id]?.qty ?? String(l.qty_ordered)} onChange={(e) => setLine(l.line_id, 'qty', e.target.value.replace(/[^0-9.]/g, ''))} /></Field>
                {l.unit_price == null
                  ? <Field label="Your price each (KES)"><input inputMode="decimal" className={fieldClass} value={edit[l.line_id]?.price ?? ''} onChange={(e) => setLine(l.line_id, 'price', e.target.value.replace(/[^0-9.]/g, ''))} /></Field>
                  : <Field label="Agreed price"><div className="min-h-[48px] flex items-center text-sm font-semibold text-[#23382B]">{money(l.unit_price)}</div></Field>}
              </div>
            </div>
          ))}
          <Field label="Note for the buyer (optional)"><input className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <p className="text-[11px] text-[#8B8766] mb-2">Confirming sets this stock aside for the buyer.</p>
          <button type="button" className={primaryBtn} disabled={busy || !online} onClick={doConfirm}>{busy && <Loader2 size={16} className="animate-spin" />} Confirm order</button>
        </div>
      )}
      {panel === 'dispatch' && (
        <div>
          <p className="text-[13px] font-bold text-[#23382B] mb-2">What are you sending now?</p>
          {lines.filter((l) => l.qty_confirmed > l.qty_dispatched).map((l) => (
            <Field key={l.line_id} label={`${l.product_name} (up to ${qtyText(l.qty_confirmed - l.qty_dispatched)})`}>
              <input inputMode="decimal" className={fieldClass} value={edit[l.line_id]?.qty ?? String(l.qty_confirmed - l.qty_dispatched)} onChange={(e) => setLine(l.line_id, 'qty', e.target.value.replace(/[^0-9.]/g, ''))} />
            </Field>
          ))}
          <Field label="Note (optional)"><input className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <button type="button" className={primaryBtn} disabled={busy || !online} onClick={doDispatch}>{busy && <Loader2 size={16} className="animate-spin" />} Mark as sent</button>
        </div>
      )}
      {['reject', 'cancel', 'dispute'].includes(panel) && (
        <div>
          <Field label={panel === 'dispute' ? 'What is the problem?' : panel === 'cancel' && side === 'BUYER' ? 'Reason (optional)' : 'Reason for the other business'}>
            <input className={fieldClass} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <button type="button" className={dangerBtn} disabled={busy || !online} onClick={panel === 'reject' ? doReject : panel === 'cancel' ? doCancel : doDispute}>
            {busy && <Loader2 size={16} className="animate-spin" />} {panel === 'reject' ? 'Reject order' : panel === 'cancel' ? 'Cancel order' : 'Report problem'}
          </button>
        </div>
      )}
      <button type="button" className={`${ghostBtn} mt-2`} onClick={() => setPanel(null)}>Back</button>
    </>
  );

  return (
    <Sheet title={o.order_ref} onClose={onClose}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[13px] text-[#4B5646] min-w-0 truncate">{side === 'BUYER' ? 'From' : 'For'} <b className="text-[#23382B]">{o.other_name}</b></p>
        <Pill tone={statusTone(o.status)}>{statusLabel(o.status, side)}</Pill>
      </div>
      <ProgressBar status={o.status} />

      {o.status === 'CANCELLED' && (o.cancel_reason || o.cancelled_by) && <Notice tone="gold">Cancelled by {o.cancelled_by === 'SUPPLIER' ? 'the supplier' : 'the buyer'}{o.cancel_reason ? `: ${o.cancel_reason}` : '.'}</Notice>}
      {o.price_pending && <Notice tone="gold">{side === 'BUYER' ? 'The supplier will confirm the price.' : 'Add your price when you confirm.'}</Notice>}

      <div className="mb-3 space-y-2">
        {lines.map((l) => (
          <div key={l.line_id} className="rounded-xl border border-[#E3DBB8] bg-white p-2.5">
            <p className="text-[13px] font-bold text-[#23382B] break-words">{l.product_name}</p>
            <p className="text-[11.5px] text-[#6F7461]">{l.unit_price == null ? 'Price to be agreed' : `${money(l.unit_price)}${l.unit ? ` per ${l.unit}` : ''}`}</p>
            <div className="mt-1.5 grid grid-cols-4 gap-1 text-center">
              {[['Asked', l.qty_ordered], ['Confirmed', l.qty_confirmed], ['Sent', l.qty_dispatched], ['Received', l.qty_received]].map(([k, v]) => (
                <div key={k}><div className="text-[9px] font-bold uppercase text-[#A29E80]">{k}</div><div className="text-[13px] font-semibold text-[#23382B]">{qtyText(v)}</div></div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <KeyValues rows={[
        { label: 'Total', value: o.total == null ? 'To be agreed' : money(o.total) },
        Number(o.delivery_fee) > 0 ? { label: 'Delivery fee included', value: money(o.delivery_fee) } : null,
        { label: o.delivery_method === 'COLLECTION' ? 'Collection' : 'Deliver to', value: o.delivery_method === 'COLLECTION' ? 'Buyer collects' : o.delivery_address },
        { label: 'Ordered', value: new Date(o.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) },
        { label: 'Buyer note', value: o.buyer_note }, { label: 'Supplier note', value: o.supplier_note },
        { label: 'Invoice', value: INVOICE[o.invoice_status] || o.invoice_status }, { label: 'Payment', value: PAYMENT[o.payment_status] || o.payment_status },
      ]} />
      {o.other_phone && <a href={`tel:${o.other_phone}`} className={`${ghostBtn} mb-3`}><Phone size={15} /> Call {o.other_name}</a>}

      {!online && <Notice tone="gold">Connect to the internet to act on this order.</Notice>}
      {panel ? panelBody : (
        <div className="space-y-2">
          {supplier && o.status === 'AWAITING_CONFIRMATION' && (<>
            <button type="button" className={primaryBtn} disabled={!online} onClick={() => open('confirm')}>Confirm order</button>
            <button type="button" className={dangerBtn} disabled={!online} onClick={() => open('reject')}>Reject</button>
          </>)}
          {supplier && o.status === 'CONFIRMED' && <button type="button" className={primaryBtn} disabled={busy || !online} onClick={doPreparing}>{busy && <Loader2 size={16} className="animate-spin" />} Start preparing</button>}
          {supplier && ['CONFIRMED', 'PREPARING', 'DISPATCHED'].includes(o.status) && remaining && <button type="button" className={o.status === 'CONFIRMED' ? ghostBtn : primaryBtn} disabled={!online} onClick={() => open('dispatch')}>{o.status === 'DISPATCHED' ? 'Send more' : 'Mark as sent'}</button>}
          {supplier && ['CONFIRMED', 'PREPARING'].includes(o.status) && <button type="button" className={dangerBtn} disabled={!online} onClick={() => open('cancel')}>Cancel order</button>}
          {buyer && ['AWAITING_CONFIRMATION', 'CONFIRMED', 'PREPARING'].includes(o.status) && <button type="button" className={dangerBtn} disabled={!online} onClick={() => open('cancel')}>Cancel order</button>}
          {buyer && ['DISPATCHED', 'PARTIALLY_RECEIVED'].includes(o.status) && <button type="button" className={dangerBtn} disabled={!online} onClick={() => open('dispute')}>Report a problem</button>}
          {buyer && ['DISPATCHED', 'PARTIALLY_RECEIVED'].includes(o.status) && <p className="text-[11.5px] text-[#8B8766] text-center">Recording what you received through the network is coming in the next update. Your stock is not changed by this screen.</p>}
          <button type="button" className={ghostBtn} onClick={onClose}>Close</button>
        </div>
      )}
    </Sheet>
  );
}
