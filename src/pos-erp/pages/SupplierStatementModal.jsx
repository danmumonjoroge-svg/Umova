// src/pos-erp/pages/SupplierStatementModal.jsx
//
// A real supplier statement: one date-ordered ledger with a RUNNING
// BALANCE, opening/closing balance, optional date range, and print.
//
//   Debit  (we owe more)  = goods received (GRN total)
//   Credit (we owe less)  = payments made to the supplier
//
// Purchase ORDERS are deliberately not in the ledger — a PO is only an
// intention to buy; the debt starts when goods are actually received.
// Returns are listed as memo lines only: supplierReturnService does not
// currently reduce outstanding_balance, so counting them here would make
// the statement disagree with the balance the rest of the app shows.
//
// "Balance brought forward": lb_suppliers.outstanding_balance is the
// authoritative figure. Any part of it not explained by the GRNs and
// payments below (e.g. deliveries received before purchases started
// hitting the balance) is shown as a single opening line rather than
// hidden, so the statement's closing balance always equals the real one.

import React, { useMemo, useState } from 'react';
import { X, Printer, Loader2 } from 'lucide-react';
import { useSupplierDetail } from '../hooks/useSuppliers';
import { printDocument, escapeHtml } from '../utils/printDocument';

const fmt = (n) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d) => new Date(d).toLocaleDateString();
const ts = (d) => new Date(d).getTime();

export default function SupplierStatementModal({ supplier, onClose }) {
  const { grns, payments, returns, loading, error } = useSupplierDetail(supplier.id);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { broughtForward, entries } = useMemo(() => {
    const all = [
      ...grns.map(g => ({
        date: g.received_date, ref: g.grn_number,
        desc: `Goods received${g.invoice_no ? ` · Inv ${g.invoice_no}` : ''}`,
        debit: Number(g.total_amount) || 0, credit: 0,
      })),
      ...payments.map(p => ({
        date: p.payment_date, ref: p.payment_number,
        desc: `Payment · ${String(p.payment_method || '').replace('_', ' ')}${p.reference_no ? ` · ${p.reference_no}` : ''}`,
        debit: 0, credit: Number(p.amount) || 0,
      })),
      ...returns.map(r => ({
        date: r.created_at, ref: r.return_number,
        desc: `Return${r.reason ? ` — ${r.reason}` : ''} (memo, not applied to balance)`,
        debit: 0, credit: 0, memo: Number(r.total_amount) || 0,
      })),
    ].filter(e => e.date).sort((a, b) => ts(a.date) - ts(b.date));

    const net = all.reduce((sum, e) => sum + e.debit - e.credit, 0);
    return {
      broughtForward: Number(supplier.outstanding_balance || 0) - net,
      entries: all,
    };
  }, [grns, payments, returns, supplier.outstanding_balance]);

  const view = useMemo(() => {
    const fromT = from ? ts(from) : null;
    const toT = to ? ts(to) + 86399999 : null; // include the whole "to" day
    const before = fromT == null ? [] : entries.filter(e => ts(e.date) < fromT);
    const inRange = entries.filter(e => (fromT == null || ts(e.date) >= fromT) && (toT == null || ts(e.date) <= toT));
    const opening = broughtForward + before.reduce((s, e) => s + e.debit - e.credit, 0);

    let running = opening;
    const rows = inRange.map(e => {
      running += e.debit - e.credit;
      return { ...e, balance: running };
    });
    return {
      opening,
      rows,
      closing: running,
      totalDebit: inRange.reduce((s, e) => s + e.debit, 0),
      totalCredit: inRange.reduce((s, e) => s + e.credit, 0),
    };
  }, [entries, broughtForward, from, to]);

  const periodLabel = from || to ? `${from ? day(from) : 'Start'} – ${to ? day(to) : 'Today'}` : 'All activity';
  const showBF = Math.abs(view.opening) > 0.005;

  const print = () => {
    const rowsHtml = view.rows.map(r => `
      <tr>
        <td>${day(r.date)}</td><td>${escapeHtml(r.ref || '')}</td><td>${escapeHtml(r.desc)}</td>
        <td class="right">${r.debit ? fmt(r.debit) : ''}</td>
        <td class="right">${r.credit ? fmt(r.credit) : ''}</td>
        <td class="right">${r.memo != null ? '' : fmt(r.balance)}</td>
      </tr>`).join('');

    try {
      printDocument(`Statement — ${supplier.name}`, `
        <div class="center bold" style="font-size:16px;">${escapeHtml(supplier.name)}</div>
        <div class="center muted">${[supplier.phone, supplier.email].filter(Boolean).map(escapeHtml).join(' · ')}</div>
        ${supplier.address ? `<div class="center muted">${escapeHtml(supplier.address)}</div>` : ''}
        <div class="divider"></div>
        <div class="center bold" style="font-size:14px;">Supplier Statement</div>
        <div class="center muted">${escapeHtml(periodLabel)} · printed ${new Date().toLocaleDateString()}</div>
        <div class="divider"></div>
        <table class="sum">
          <tr><td>Opening balance</td><td class="right">${fmt(view.opening)}</td></tr>
          <tr><td>Purchases (goods received)</td><td class="right">${fmt(view.totalDebit)}</td></tr>
          <tr><td>Payments made</td><td class="right">${fmt(view.totalCredit)}</td></tr>
          <tr class="bold"><td>Closing balance (owed to supplier)</td><td class="right">${fmt(view.closing)}</td></tr>
        </table>
        <div class="divider"></div>
        <table class="ledger">
          <thead><tr><th>Date</th><th>Ref</th><th>Detail</th><th class="right">Purchases</th><th class="right">Payments</th><th class="right">Balance</th></tr></thead>
          <tbody>
            ${showBF ? `<tr><td colspan="5">Balance brought forward</td><td class="right">${fmt(view.opening)}</td></tr>` : ''}
            ${rowsHtml || '<tr><td colspan="6" class="center muted">No transactions in this period</td></tr>'}
          </tbody>
        </table>
      `, `body { font-family: Arial, sans-serif; } table { font-size: 12px; } .ledger th { text-align: left; border-bottom: 1px solid #ccc; padding: 4px 6px; } .ledger td { padding: 4px 6px; border-bottom: 1px solid #eee; } .sum td { padding: 3px 0; }`);
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70] p-2 sm:p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        <div className="flex items-start justify-between p-4 sm:p-5 border-b border-slate-100 gap-3">
          <div className="min-w-0">
            <h2 className="font-bold text-slate-800 text-lg truncate">Statement — {supplier.name}</h2>
            <div className="text-xs text-slate-500">{[supplier.phone, supplier.email].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={print} disabled={loading} className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold px-3 py-2 rounded-xl disabled:opacity-50">
              <Printer size={15} /> Print
            </button>
            <button onClick={onClose}><X size={18} className="text-slate-400" /></button>
          </div>
        </div>

        <div className="overflow-y-auto p-4 sm:p-5">
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <label className="text-xs font-semibold text-slate-500">From
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="block mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
            </label>
            <label className="text-xs font-semibold text-slate-500">To
              <input type="date" value={to} onChange={e => setTo(e.target.value)} className="block mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
            </label>
            {(from || to) && (
              <button onClick={() => { setFrom(''); setTo(''); }} className="text-xs font-semibold text-slate-500 hover:text-slate-800 pb-2">Clear dates</button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <Tile label="Opening" value={fmt(view.opening)} />
            <Tile label="Purchases" value={fmt(view.totalDebit)} />
            <Tile label="Payments" value={fmt(view.totalCredit)} tone="green" />
            <Tile label="Closing (owed)" value={fmt(view.closing)} tone="red" />
          </div>

          {error && <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{error}</div>}

          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-left px-3 py-2">Detail</th>
                  <th className="text-right px-3 py-2">Purchases</th>
                  <th className="text-right px-3 py-2">Payments</th>
                  <th className="text-right px-3 py-2">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && (
                  <tr><td colSpan={5} className="text-center py-8 text-slate-400"><Loader2 size={16} className="animate-spin inline mr-2" /> Loading…</td></tr>
                )}
                {!loading && showBF && (
                  <tr className="bg-slate-50/60">
                    <td className="px-3 py-2" colSpan={4}>Balance brought forward</td>
                    <td className="px-3 py-2 text-right font-semibold">{fmt(view.opening)}</td>
                  </tr>
                )}
                {!loading && view.rows.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-8 text-slate-400">No transactions in this period.</td></tr>
                )}
                {!loading && view.rows.map((r, i) => (
                  <tr key={i} className={r.memo != null ? 'text-slate-400' : ''}>
                    <td className="px-3 py-2 whitespace-nowrap">{day(r.date)}</td>
                    <td className="px-3 py-2">
                      <div>{r.desc}</div>
                      <div className="text-xs text-slate-400 font-mono">{r.ref}</div>
                    </td>
                    <td className="px-3 py-2 text-right">{r.debit ? fmt(r.debit) : ''}</td>
                    <td className="px-3 py-2 text-right text-emerald-700">{r.credit ? fmt(r.credit) : ''}</td>
                    <td className="px-3 py-2 text-right font-semibold">{r.memo != null ? fmt(r.memo) + ' (memo)' : fmt(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, tone }) {
  const cls = tone === 'red' ? 'bg-red-50 border-red-200 text-red-700'
    : tone === 'green' ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
    : 'bg-slate-50 border-slate-200 text-slate-700';
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="text-[11px] font-bold uppercase opacity-80">{label}</div>
      <div className="text-lg font-black mt-0.5 break-all">{value}</div>
    </div>
  );
}
