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
  Boxes, Loader2, History, SlidersHorizontal, X,
} from "lucide-react";
import { useInventory, useStockHistory } from "../hooks/useInventory";
import { MANUAL_ADJUSTMENT_TYPES } from "../services/inventoryService";
import { FitPage, MiniStats, SearchBox, FilterChips, CardGrid, DataCard, IconBtn, Notice, LoadingBlock, EmptyBlock } from "../components/CardKit";
import { singleFlight } from '../utils/singleFlight';

const STATUS_TONE = { NORMAL: "good", LOW_STOCK: "warn", OUT_OF_STOCK: "bad" };

// Types where direction is fixed by what they mean — no +/- toggle needed.
const FIXED_DIRECTION = {
  DAMAGED: -1,
  EXPIRED: -1,
  OPENING_STOCK: 1,
};

export default function InventoryPage() {
  const { items, loading, error, adjustStock } = useInventory();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [adjustingProduct, setAdjustingProduct] = useState(null);
  const [historyProduct, setHistoryProduct] = useState(null);

  const statusOf = (p) => (p.track_inventory ? (p.inventory?.stock_status || "NORMAL") : "UNTRACKED");
  const low = items.filter((p) => statusOf(p) === "LOW_STOCK").length;
  const out = items.filter((p) => statusOf(p) === "OUT_OF_STOCK").length;

  const filtered = items.filter((p) => {
    const q = search.toLowerCase();
    const matches = !search || p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q);
    const st = statusOf(p);
    const okFilter = filter === "all" || (filter === "low" && st === "LOW_STOCK") || (filter === "out" && st === "OUT_OF_STOCK");
    return matches && okFilter;
  });

  return (
    <FitPage
      title="My Stock"
      icon={Boxes}
      subtitle="Stock levels across your warehouse."
      summary={!loading && (
        <MiniStats items={[
          { label: "Items", value: items.length },
          { label: "Low", value: low, tone: low ? "gold" : undefined },
          { label: "Out", value: out, tone: out ? "bad" : undefined },
        ]} />
      )}
      toolbar={(
        <div className="space-y-2">
          <SearchBox value={search} onChange={setSearch} placeholder="Search by name or SKU…" />
          <FilterChips
            value={filter} onChange={setFilter}
            options={[
              { key: "all", label: "All", count: items.length },
              { key: "low", label: "Low stock", count: low },
              { key: "out", label: "Out of stock", count: out },
            ]}
          />
        </div>
      )}
    >
      {error && <Notice>{error}</Notice>}
      {loading && <LoadingBlock text="Loading inventory…" />}
      {!loading && filtered.length === 0 && <EmptyBlock>No products found.</EmptyBlock>}

      <CardGrid>
        {filtered.map((p) => {
          const st = statusOf(p);
          const qty = p.inventory?.quantity ?? 0;
          return (
            <DataCard
              key={p.id}
              title={p.name}
              subtitle={p.sku || " "}
              alert={st === "LOW_STOCK" || st === "OUT_OF_STOCK"}
              pill={p.track_inventory ? { tone: STATUS_TONE[st], label: st.replace("_", " ") } : undefined}
              big={p.track_inventory
                ? { value: qty, tone: st === "OUT_OF_STOCK" ? "bad" : undefined, label: "in stock" }
                : { value: "Not tracked", tone: "muted" }}
              metrics={p.track_inventory ? [
                { label: "Reorder at", value: p.reorder_level ?? 0 },
                { label: "Avg. cost", value: p.inventory ? Number(p.inventory.average_cost || 0).toLocaleString() : "—" },
              ] : undefined}
              actions={(
                <>
                  <IconBtn title="Movement history" onClick={() => setHistoryProduct(p)}><History size={14} /></IconBtn>
                  {p.track_inventory && (
                    <IconBtn title="Adjust stock" onClick={() => setAdjustingProduct(p)}><SlidersHorizontal size={14} /></IconBtn>
                  )}
                </>
              )}
            />
          );
        })}
      </CardGrid>

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
    </FitPage>
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

  const submit = singleFlight('InventoryPage.submit', async (e) => {
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
  });

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-[#23382B]">Adjust Stock</h3>
            <p className="text-xs text-[#6F7461]">{product.name} — currently {product.inventory?.quantity ?? 0}</p>
          </div>
          <button onClick={onClose}><X size={18} className="text-[#8B8766]" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {err && <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-2.5">{err}</div>}

          <label className="block">
            <div className="text-xs font-semibold text-[#6F7461] mb-1">Type</div>
            <select value={type} onChange={(e) => setType(e.target.value)} className="input">
              {MANUAL_ADJUSTMENT_TYPES.map((t) => (
                <option key={t} value={t}>{t.replace("_", " ")}</option>
              ))}
            </select>
          </label>

          {!hasFixedDirection && (
            <div className="flex gap-2">
              <button type="button" onClick={() => setDirection(1)} className={`flex-1 py-2 rounded-xl text-sm font-semibold border ${direction === 1 ? "bg-[#E3F1E7] border-[#1F6B45] text-[#1B5138]" : "border-[#E3DBB8] text-[#6F7461]"}`}>Add</button>
              <button type="button" onClick={() => setDirection(-1)} className={`flex-1 py-2 rounded-xl text-sm font-semibold border ${direction === -1 ? "bg-red-50 border-red-300 text-red-700" : "border-[#E3DBB8] text-[#6F7461]"}`}>Remove</button>
            </div>
          )}

          <label className="block">
            <div className="text-xs font-semibold text-[#6F7461] mb-1">Quantity</div>
            <input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" required />
          </label>

          <label className="block">
            <div className="text-xs font-semibold text-[#6F7461] mb-1">Reason</div>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="input" required />
          </label>

          <button type="submit" disabled={saving} className="w-full bg-[#1F6B45] hover:bg-[#17553A] border-b-2 border-[#C9A227] disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl transition">
            {saving ? "Saving…" : "Apply adjustment"}
          </button>
        </form>
        <style>{`.input { width: 100%; border: 1px solid #E3DBB8; border-radius: 0.75rem; padding: 0.6rem 0.75rem; font-size: 0.875rem; }`}</style>
      </div>
    </div>
  );
}

function StockHistoryDrawer({ product, onClose }) {
  const { movements, loading } = useStockHistory(product.id);

  return (
    <div className="fixed inset-0 bg-black/30 flex justify-end z-50">
      <div className="bg-white w-full max-w-md h-full overflow-y-auto shadow-2xl">
        <div className="p-5 border-b border-[#F0EACF] flex items-center justify-between">
          <h2 className="font-bold text-[#23382B]">{product.name}</h2>
          <button onClick={onClose}><X size={18} className="text-[#8B8766]" /></button>
        </div>
        <div className="p-5">
          {loading && <div className="text-center text-[#8B8766] text-sm py-8"><Loader2 size={16} className="animate-spin inline mr-2" /> Loading…</div>}
          {!loading && movements.length === 0 && <div className="text-center text-[#8B8766] text-sm py-8">No stock movements yet.</div>}
          {!loading && movements.map((m) => (
            <div key={m.id} className="flex items-center justify-between py-3 border-b border-[#F6F1DA] last:border-0">
              <div>
                <div className="text-sm font-semibold text-[#23382B]">{m.movement_type.replace("_", " ")}</div>
                <div className="text-xs text-[#8B8766]">{new Date(m.created_at).toLocaleString()}{m.notes ? ` · ${m.notes}` : ""}</div>
              </div>
              <div className={`text-sm font-bold ${m.quantity > 0 ? "text-[#1F6B45]" : "text-red-600"}`}>
                {m.quantity > 0 ? "+" : ""}{m.quantity}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
