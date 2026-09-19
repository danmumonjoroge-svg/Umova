// src/pos-erp/pages/InventoryPage.jsx
//
// Real inventory browsing — previously the only inventory-facing UI was
// POSDashboard's low-stock summary card. Reads lb_inventory joined with
// lb_products; quantity/stock_status/average_cost are all kept correct
// by applyStockMovement (purchaseService.js) on every write across the
// app, so this page is read-heavy plus one write path: manual
// adjustments, which go through the exact same function.

import React, { useState } from "react";
import {
  Boxes, Search, Loader2, History, SlidersHorizontal, X,
} from "lucide-react";
import { useInventory, useStockHistory } from "../hooks/useInventory";
import { MANUAL_ADJUSTMENT_TYPES } from "../services/inventoryService";

const STATUS_STYLES = {
  NORMAL: "bg-emerald-50 text-emerald-700",
  LOW_STOCK: "bg-amber-50 text-amber-700",
  OUT_OF_STOCK: "bg-red-50 text-red-700",
};

// Types where direction is fixed by what they mean — no +/- toggle needed.
const FIXED_DIRECTION = {
  DAMAGED: -1,
  EXPIRED: -1,
  OPENING_STOCK: 1,
};

export default function InventoryPage() {
  const { items, loading, error, adjustStock } = useInventory();
  const [search, setSearch] = useState("");
  const [adjustingProduct, setAdjustingProduct] = useState(null);
  const [historyProduct, setHistoryProduct] = useState(null);

  const filtered = items.filter((p) =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <Boxes size={22} className="text-emerald-600" /> My Stock
        </h1>
        <p className="text-slate-500 text-sm">Stock levels across your warehouse.</p>
      </div>

      <div className="relative mb-5">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or SKU…"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
        />
      </div>

      {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{error}</div>}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-5 py-3">Product</th>
              <th className="text-right px-5 py-3">Quantity</th>
              <th className="text-right px-5 py-3">Reorder Level</th>
              <th className="text-right px-5 py-3">Avg. Cost</th>
              <th className="text-center px-5 py-3">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={6} className="text-center py-10 text-slate-400">
                <Loader2 size={18} className="animate-spin inline mr-2" /> Loading inventory…
              </td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center py-10 text-slate-400">No products found.</td></tr>
            )}
            {filtered.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50 transition">
                <td className="px-5 py-3.5">
                  <div className="font-semibold text-slate-800">{p.name}</div>
                  {p.sku && <div className="text-xs text-slate-400">{p.sku}</div>}
                </td>
                <td className="px-5 py-3.5 text-right font-semibold text-slate-700">
                  {p.track_inventory ? (p.inventory?.quantity ?? 0) : <span className="text-slate-300">Not tracked</span>}
                </td>
                <td className="px-5 py-3.5 text-right text-slate-500">{p.track_inventory ? p.reorder_level : "—"}</td>
                <td className="px-5 py-3.5 text-right text-slate-500">
                  {p.track_inventory && p.inventory ? Number(p.inventory.average_cost || 0).toLocaleString() : "—"}
                </td>
                <td className="px-5 py-3.5 text-center">
                  {p.track_inventory ? (
                    <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${STATUS_STYLES[p.inventory?.stock_status || "NORMAL"]}`}>
                      {(p.inventory?.stock_status || "NORMAL").replace("_", " ")}
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-300">—</span>
                  )}
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center justify-end gap-3">
                    <button onClick={() => setHistoryProduct(p)} className="text-slate-400 hover:text-emerald-700" title="Movement history">
                      <History size={16} />
                    </button>
                    {p.track_inventory && (
                      <button onClick={() => setAdjustingProduct(p)} className="text-slate-400 hover:text-emerald-700" title="Adjust stock">
                        <SlidersHorizontal size={16} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adjustingProduct && (
        <AdjustStockModal
          product={adjustingProduct}
          onClose={() => setAdjustingProduct(null)}
          onAdjust={adjustStock}
        />
      )}

      {historyProduct && (
        <StockHistoryDrawer product={historyProduct} onClose={() => setHistoryProduct(null)} />
      )}
    </div>
  );
}

function AdjustStockModal({ product, onClose, onAdjust }) {
  const [type, setType] = useState("STOCK_ADJUSTMENT");
  const [direction, setDirection] = useState(1); // only used for types without a fixed direction
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const hasFixedDirection = type in FIXED_DIRECTION;
  const effectiveDirection = hasFixedDirection ? FIXED_DIRECTION[type] : direction;

  const submit = async (e) => {
    e.preventDefault();
    const qty = Number(amount);
    if (!qty || qty <= 0) { setErr("Enter a quantity greater than zero."); return; }
    if (!reason.trim()) { setErr("A reason is required for the stock movement audit trail."); return; }
    setSaving(true);
    setErr(null);
    try {
      await onAdjust({ productId: product.id, movementType: type, quantity: qty * effectiveDirection, reason });
      onClose();
    } catch (e2) {
      setErr(e2.message || "Failed to adjust stock.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-slate-800">Adjust Stock</h3>
            <p className="text-xs text-slate-500">{product.name} — currently {product.inventory?.quantity ?? 0}</p>
          </div>
          <button onClick={onClose}><X size={18} className="text-slate-400" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {err && <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-2.5">{err}</div>}

          <label className="block">
            <div className="text-xs font-semibold text-slate-500 mb-1">Type</div>
            <select value={type} onChange={(e) => setType(e.target.value)} className="input">
              {MANUAL_ADJUSTMENT_TYPES.map((t) => (
                <option key={t} value={t}>{t.replace("_", " ")}</option>
              ))}
            </select>
          </label>

          {!hasFixedDirection && (
            <div className="flex gap-2">
              <button type="button" onClick={() => setDirection(1)} className={`flex-1 py-2 rounded-xl text-sm font-semibold border ${direction === 1 ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "border-slate-200 text-slate-500"}`}>Add</button>
              <button type="button" onClick={() => setDirection(-1)} className={`flex-1 py-2 rounded-xl text-sm font-semibold border ${direction === -1 ? "bg-red-50 border-red-300 text-red-700" : "border-slate-200 text-slate-500"}`}>Remove</button>
            </div>
          )}

          <label className="block">
            <div className="text-xs font-semibold text-slate-500 mb-1">Quantity</div>
            <input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" required />
          </label>

          <label className="block">
            <div className="text-xs font-semibold text-slate-500 mb-1">Reason</div>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="input" required />
          </label>

          <button type="submit" disabled={saving} className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl transition">
            {saving ? "Saving…" : "Apply adjustment"}
          </button>
        </form>
        <style>{`.input { width: 100%; border: 1px solid #e2e8f0; border-radius: 0.75rem; padding: 0.6rem 0.75rem; font-size: 0.875rem; }`}</style>
      </div>
    </div>
  );
}

function StockHistoryDrawer({ product, onClose }) {
  const { movements, loading } = useStockHistory(product.id);

  return (
    <div className="fixed inset-0 bg-black/30 flex justify-end z-50">
      <div className="bg-white w-full max-w-md h-full overflow-y-auto shadow-2xl">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-bold text-slate-800">{product.name}</h2>
          <button onClick={onClose}><X size={18} className="text-slate-400" /></button>
        </div>
        <div className="p-5">
          {loading && <div className="text-center text-slate-400 text-sm py-8"><Loader2 size={16} className="animate-spin inline mr-2" /> Loading…</div>}
          {!loading && movements.length === 0 && <div className="text-center text-slate-400 text-sm py-8">No stock movements yet.</div>}
          {!loading && movements.map((m) => (
            <div key={m.id} className="flex items-center justify-between py-3 border-b border-slate-50 last:border-0">
              <div>
                <div className="text-sm font-semibold text-slate-700">{m.movement_type.replace("_", " ")}</div>
                <div className="text-xs text-slate-400">{new Date(m.created_at).toLocaleString()}{m.notes ? ` · ${m.notes}` : ""}</div>
              </div>
              <div className={`text-sm font-bold ${m.quantity > 0 ? "text-emerald-600" : "text-red-600"}`}>
                {m.quantity > 0 ? "+" : ""}{m.quantity}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
