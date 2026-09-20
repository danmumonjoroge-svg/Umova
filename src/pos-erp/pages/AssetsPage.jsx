// src/pos-erp/pages/AssetsPage.jsx
//
// My Equipment (brief §10). The whole design rule here is §10's own
// closing line: "normal users should not need to understand
// depreciation." So:
//
//   - The word "depreciation" appears once, in the advanced/accountant
//     wording under the header. Everywhere the owner works it is
//     "wear and tear" and "what it's worth now".
//   - The owner never types a depreciation figure. They press one
//     button; the amount is computed from what they already told us.
//   - When we can't compute it honestly (no useful life set, method
//     NONE), the button is replaced by what's missing — never by a
//     zero, and never by a guess (§13).
//
// The purchase of an asset does NOT reduce cash or create a payable —
// there's no general ledger in this schema to post the other side to.
// That's stated on the page, not buried in a comment, because an owner
// who assumes otherwise would be double-counting.

import React, { useState } from 'react';
import { HardHat, Plus, Loader2, Info, Wrench, Archive } from 'lucide-react';
import { useAssets } from '../hooks/useAssets';
import { useSuppliers } from '../hooks/useSuppliers';
import { assetService, bookValue, monthlyDepreciation, monthBounds, DEPRECIATION_METHODS } from '../services/assetService';

const CATEGORY_SUGGESTIONS = ['Fridge', 'Freezer', 'Vehicle', 'Computer', 'Furniture', 'Machinery', 'Equipment'];

const METHOD_LABELS = {
  STRAIGHT_LINE: 'Same amount every year',
  REDUCING_BALANCE: 'A percentage of what it is worth now',
  NONE: "Don't reduce its value",
};

const STATUS_CHIP = {
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  UNDER_MAINTENANCE: 'bg-amber-50 text-amber-700',
  DISPOSED: 'bg-slate-100 text-slate-500',
  WRITTEN_OFF: 'bg-slate-100 text-slate-500',
};

const STATUS_LABEL = {
  ACTIVE: 'In use',
  UNDER_MAINTENANCE: 'Being repaired',
  DISPOSED: 'Sold / gone',
  WRITTEN_OFF: 'Written off',
};

const EMPTY_FORM = {
  name: '', category: '', purchase_date: new Date().toISOString().slice(0, 10), purchase_cost: '',
  supplier_id: '', serial_number: '', location: '', useful_life_years: '',
  depreciation_method: 'STRAIGHT_LINE', depreciation_rate: '', salvage_value: '0', notes: '',
};

function fmt(n) {
  return (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AssetsPage() {
  const { assets, summary, loading, error, create, update, setMaintenance, dispose, postDepreciation } = useAssets();
  const { suppliers } = useSuppliers();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [disposing, setDisposing] = useState(null);
  const [disposalForm, setDisposalForm] = useState({ disposalDate: new Date().toISOString().slice(0, 10), proceeds: '0', writtenOff: false });

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowForm(true); };

  const openEdit = (a) => {
    setEditing(a);
    setForm({
      name: a.name || '', category: a.category || '', purchase_date: a.purchase_date || '',
      purchase_cost: String(a.purchase_cost ?? ''), supplier_id: a.supplier_id || '',
      serial_number: a.serial_number || '', location: a.location || '',
      useful_life_years: a.useful_life_years == null ? '' : String(a.useful_life_years),
      depreciation_method: a.depreciation_method || 'STRAIGHT_LINE',
      depreciation_rate: a.depreciation_rate == null ? '' : String(a.depreciation_rate),
      salvage_value: String(a.salvage_value ?? '0'), notes: a.notes || '',
    });
    setFormError('');
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      if (editing) await update(editing.id, form);
      else await create(form);
      setShowForm(false);
      setEditing(null);
      setForm(EMPTY_FORM);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDepreciate = async (asset) => {
    setActionError('');
    const amount = monthlyDepreciation(asset);
    if (amount == null || amount <= 0) return;
    const { periodStart, periodEnd } = monthBounds();
    setBusyId(asset.id);
    try {
      await postDepreciation({ assetId: asset.id, periodStart, periodEnd, amount });
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDispose = async (e) => {
    e.preventDefault();
    setActionError('');
    setBusyId(disposing.id);
    try {
      await dispose(disposing.id, disposalForm);
      setDisposing(null);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  // What blocks the wear-and-tear button, in the owner's words. Returning
  // a reason instead of silently hiding the button is the point — an
  // owner who set no useful life should be told that, not left guessing.
  const depreciationBlocker = (a) => {
    if (a.status === 'DISPOSED' || a.status === 'WRITTEN_OFF') return 'No longer owned';
    if (a.status === 'UNDER_MAINTENANCE') return 'Being repaired';
    if (a.depreciation_method === 'NONE') return 'Value not reduced';
    const amount = monthlyDepreciation(a);
    if (amount === 0) return 'Fully written down';
    if (amount == null) {
      return a.depreciation_method === 'STRAIGHT_LINE'
        ? 'Set how many years it will last'
        : 'Set a yearly percentage';
    }
    return null;
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <HardHat size={22} className="text-amber-600" /> My Equipment
          </h1>
          <p className="text-slate-500 text-sm">
            Fridges, freezers, vehicles, furniture — the things you bought once and keep using.
            <span className="text-slate-400"> (Accountant: fixed asset register &amp; depreciation.)</span>
          </p>
        </div>
        <button onClick={() => (showForm ? setShowForm(false) : openCreate())} className="bg-emerald-800 hover:bg-emerald-900 text-white px-4 py-2 rounded-xl font-semibold shadow-[0_2px_0_0_rgba(251,191,36,0.6)] flex items-center gap-2">
          <Plus size={16} /> {showForm ? 'Cancel' : 'Add Equipment'}
        </button>
      </div>

      {/* Said plainly, because assuming otherwise means double-counting. */}
      <div className="flex items-start gap-2 bg-slate-50 border border-slate-200 text-slate-600 text-sm rounded-xl px-4 py-3 my-4">
        <Info size={16} className="mt-0.5 shrink-0 text-slate-400" />
        <span>
          Adding equipment here records what you own — it does not take the money out of My Money or add it to People I Owe.
          If you paid for it from the business, record that separately. Wear and tear, once you record it, does show up in My Profit.
        </span>
      </div>

      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
            <div className="text-xs font-bold text-slate-400 uppercase">What it all cost</div>
            <div className="text-xl font-black text-slate-800">{fmt(summary.cost)}</div>
          </div>
          <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
            <div className="text-xs font-bold text-slate-400 uppercase">Wear and tear so far</div>
            <div className="text-xl font-black text-amber-700">{fmt(summary.accumulated)}</div>
          </div>
          <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
            <div className="text-xs font-bold text-slate-400 uppercase">Worth now</div>
            <div className="text-xl font-black text-emerald-800">{fmt(summary.netBookValue)}</div>
          </div>
        </div>
      )}

      {actionError && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{actionError}</div>}

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white p-4 rounded-2xl shadow mb-6 grid grid-cols-1 md:grid-cols-3 gap-3 border border-slate-100">
          {formError && <div className="md:col-span-3 bg-red-50 text-red-700 text-sm rounded px-3 py-2">{formError}</div>}

          <input required placeholder="What is it? (e.g. Chest freezer)" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2" />
          <input list="asset-categories" placeholder="Type (fridge, vehicle…)" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2" />
          <datalist id="asset-categories">{CATEGORY_SUGGESTIONS.map(c => <option key={c} value={c} />)}</datalist>
          <select value={form.supplier_id} onChange={e => setForm({ ...form, supplier_id: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2 text-sm">
            <option value="">Bought from (optional)</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">When you bought it</label>
            <input required type="date" value={form.purchase_date} onChange={e => setForm({ ...form, purchase_date: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">What it cost (KES)</label>
            <input required type="number" min="0" step="0.01" value={form.purchase_cost} onChange={e => setForm({ ...form, purchase_cost: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">What it'll be worth at the end (KES)</label>
            <input type="number" min="0" step="0.01" value={form.salvage_value} onChange={e => setForm({ ...form, salvage_value: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2" />
          </div>

          <input placeholder="Serial number (optional)" value={form.serial_number} onChange={e => setForm({ ...form, serial_number: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2" />
          <input placeholder="Where it is (optional)" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2" />
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">How many years it will last</label>
            <input type="number" min="1" value={form.useful_life_years} onChange={e => setForm({ ...form, useful_life_years: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2" />
          </div>

          <div className="flex flex-col gap-1 md:col-span-2">
            <label className="text-xs text-slate-500">How its value should drop over time</label>
            <select value={form.depreciation_method} onChange={e => setForm({ ...form, depreciation_method: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2">
              {DEPRECIATION_METHODS.map(m => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
            </select>
          </div>
          {form.depreciation_method === 'REDUCING_BALANCE' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Percentage each year</label>
              <input type="number" min="0" max="100" step="0.01" value={form.depreciation_rate} onChange={e => setForm({ ...form, depreciation_rate: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2" />
            </div>
          )}

          <input placeholder="Notes (optional)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2 md:col-span-3" />

          <button type="submit" disabled={saving} className="bg-emerald-800 hover:bg-emerald-900 text-white px-6 py-2 rounded-xl md:col-span-3 disabled:opacity-60 font-semibold shadow-[0_2px_0_0_rgba(251,191,36,0.6)]">
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Save'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="text-center py-10 text-slate-500"><Loader2 size={16} className="animate-spin inline mr-2" /> Loading…</div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-4 py-3">Couldn't load equipment: {error}</div>
      ) : (
        <div className="bg-white rounded-2xl shadow overflow-x-auto border border-slate-100">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-2">Item</th><th>Bought</th><th>Cost</th>
                <th>Wear and tear</th><th>Worth now</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {assets.map(a => {
                const blocker = depreciationBlocker(a);
                const monthly = monthlyDepreciation(a);
                const result = assetService.disposalResult(a);
                return (
                  <tr key={a.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{a.name}</div>
                      <div className="text-xs text-slate-400">
                        {[a.category, a.location, a.supplier?.name && `from ${a.supplier.name}`].filter(Boolean).join(' · ') || '—'}
                      </div>
                      {result != null && (
                        <div className={`text-xs mt-1 font-semibold ${result >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                          {result >= 0 ? 'Made' : 'Lost'} {fmt(Math.abs(result))} on disposal
                        </div>
                      )}
                    </td>
                    <td className="py-3 text-slate-500 whitespace-nowrap">{a.purchase_date}</td>
                    <td className="py-3">{fmt(a.purchase_cost)}</td>
                    <td className="py-3 text-amber-700">{fmt(a.accumulated_depreciation)}</td>
                    <td className="py-3 font-bold text-emerald-800">{fmt(bookValue(a))}</td>
                    <td className="py-3">
                      <span className={`text-xs font-bold px-2 py-1 rounded-full whitespace-nowrap ${STATUS_CHIP[a.status]}`}>{STATUS_LABEL[a.status]}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-wrap gap-3">
                        <button onClick={() => openEdit(a)} className="text-emerald-700 text-sm hover:underline">Edit</button>

                        {blocker ? (
                          <span className="text-sm text-slate-300" title="Wear and tear can't be worked out yet">{blocker}</span>
                        ) : (
                          <button
                            onClick={() => handleDepreciate(a)}
                            disabled={busyId === a.id}
                            className="text-amber-700 text-sm hover:underline disabled:text-slate-300"
                            title={`Records ${fmt(monthly)} of wear and tear for this month`}
                          >
                            {busyId === a.id ? 'Recording…' : `Record wear (${fmt(monthly)})`}
                          </button>
                        )}

                        {a.status === 'ACTIVE' && (
                          <button onClick={() => setMaintenance(a.id, true)} className="text-slate-600 text-sm hover:underline flex items-center gap-1"><Wrench size={13} /> Repairing</button>
                        )}
                        {a.status === 'UNDER_MAINTENANCE' && (
                          <button onClick={() => setMaintenance(a.id, false)} className="text-emerald-700 text-sm hover:underline">Back in use</button>
                        )}
                        {a.status !== 'DISPOSED' && a.status !== 'WRITTEN_OFF' && (
                          <button onClick={() => { setDisposing(a); setActionError(''); }} className="text-slate-500 text-sm hover:text-red-600 flex items-center gap-1"><Archive size={13} /> Sold / gone</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {assets.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Nothing here yet. Add the fridge, the freezer, the delivery bike.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Disposal */}
      {disposing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setDisposing(null)}>
          <form onClick={e => e.stopPropagation()} onSubmit={handleDispose} className="bg-white rounded-2xl p-6 w-full max-w-md space-y-3 max-h-[90vh] overflow-y-auto">
            <h2 className="font-bold text-slate-800">{disposing.name} — sold or gone</h2>
            <p className="text-sm text-slate-500">
              It's worth {fmt(bookValue(disposing))} on your books right now. If you sold it for more, that's a gain; for less, a loss.
            </p>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">When</label>
              <input required type="date" value={disposalForm.disposalDate} onChange={e => setDisposalForm({ ...disposalForm, disposalDate: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2 w-full" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">What you got for it (KES)</label>
              <input type="number" min="0" step="0.01" value={disposalForm.proceeds} onChange={e => setDisposalForm({ ...disposalForm, proceeds: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2 w-full" />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={disposalForm.writtenOff} onChange={e => setDisposalForm({ ...disposalForm, writtenOff: e.target.checked, proceeds: e.target.checked ? '0' : disposalForm.proceeds })} />
              It broke or was stolen — nothing received
            </label>
            <p className="text-xs text-slate-400">
              This doesn't add the money to My Money. If you were paid for it, record that separately.
            </p>
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={busyId === disposing.id} className="flex-1 bg-emerald-800 hover:bg-emerald-900 text-white py-2 rounded-xl font-semibold disabled:opacity-60">
                {busyId === disposing.id ? 'Saving…' : 'Confirm'}
              </button>
              <button type="button" onClick={() => setDisposing(null)} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600">Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
