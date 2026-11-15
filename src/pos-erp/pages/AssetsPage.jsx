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
import { FitPage, AddButton, SearchBox, FilterChips, MiniStats, CardGrid, DataCard, IconTile, TextBtn, Notice, LoadingBlock, EmptyBlock } from '../components/CardKit';
import { singleFlight } from '../utils/singleFlight';

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
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
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

  const handleSubmit = singleFlight('AssetsPage.handleSubmit', async (e) => {
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
  });

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

  const shown = assets.filter((a) => {
    const q = search.toLowerCase();
    const okSearch = !search || a.name?.toLowerCase().includes(q) || a.category?.toLowerCase().includes(q) || a.location?.toLowerCase().includes(q);
    const okFilter = filter === 'all' || (filter === 'active' && a.status === 'ACTIVE') || (filter === 'repair' && a.status === 'UNDER_MAINTENANCE') || (filter === 'gone' && (a.status === 'DISPOSED' || a.status === 'WRITTEN_OFF'));
    return okSearch && okFilter;
  });

  return (
    <FitPage
      title="My Equipment"
      icon={HardHat}
      subtitle="Fridges, freezers, vehicles, furniture — bought once, used for years."
      action={<AddButton onClick={() => (showForm ? setShowForm(false) : openCreate())} open={showForm} label="Equipment" icon={Plus} />}
      summary={summary && (
        <MiniStats items={[
          { label: 'Cost', value: fmt(summary.cost).replace(/\.00$/, '') },
          { label: 'Wear & tear', value: fmt(summary.accumulated).replace(/\.00$/, ''), tone: 'gold' },
          { label: 'Worth now', value: fmt(summary.netBookValue).replace(/\.00$/, ''), tone: 'good' },
        ]} />
      )}
      toolbar={(
        <div className="space-y-2">
          <SearchBox value={search} onChange={setSearch} placeholder="Search equipment…" />
          <FilterChips value={filter} onChange={setFilter} options={[
            { key: 'all', label: 'All' }, { key: 'active', label: 'In use' },
            { key: 'repair', label: 'Repairing' }, { key: 'gone', label: 'Sold / gone' },
          ]} />
        </div>
      )}
    >
      {/* Said plainly, because assuming otherwise means double-counting. */}
      <Notice tone="gold">
        <span className="flex items-start gap-2"><Info size={14} className="mt-0.5 shrink-0" />
          <span>Adding equipment records what you own — it does not take money out of My Money or add to People I Owe. Wear and tear, once recorded, shows in My Profit.</span>
        </span>
      </Notice>

      {actionError && <div className="mb-2 bg-[#FBE4E0] border border-[#F0C2BB] text-[#8F2E24] text-sm rounded-xl px-3 py-2">{actionError}</div>}

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white p-3 rounded-xl mb-3 grid grid-cols-1 md:grid-cols-3 gap-2.5 border border-[#E3DBB8] border-t-[3px] border-t-[#C9A227]">
          {formError && <div className="md:col-span-3 bg-red-50 text-red-700 text-sm rounded px-3 py-2">{formError}</div>}

          <input required placeholder="What is it? (e.g. Chest freezer)" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="border border-[#E3DBB8] rounded-lg px-3 min-h-[40px] text-sm" />
          <input list="asset-categories" placeholder="Type (fridge, vehicle…)" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="border border-[#E3DBB8] rounded-lg px-3 min-h-[40px] text-sm" />
          <datalist id="asset-categories">{CATEGORY_SUGGESTIONS.map(c => <option key={c} value={c} />)}</datalist>
          <select value={form.supplier_id} onChange={e => setForm({ ...form, supplier_id: e.target.value })} className="border border-[#E3DBB8] rounded-lg px-3 min-h-[40px] text-sm text-sm">
            <option value="">Bought from (optional)</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">When you bought it</label>
            <input required type="date" value={form.purchase_date} onChange={e => setForm({ ...form, purchase_date: e.target.value })} className="border border-[#E3DBB8] rounded-lg px-3 min-h-[40px] text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">What it cost (KES)</label>
            <input required type="number" min="0" step="0.01" value={form.purchase_cost} onChange={e => setForm({ ...form, purchase_cost: e.target.value })} className="border border-[#E3DBB8] rounded-lg px-3 min-h-[40px] text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">What it'll be worth at the end (KES)</label>
            <input type="number" min="0" step="0.01" value={form.salvage_value} onChange={e => setForm({ ...form, salvage_value: e.target.value })} className="border border-[#E3DBB8] rounded-lg px-3 min-h-[40px] text-sm" />
          </div>

          <input placeholder="Serial number (optional)" value={form.serial_number} onChange={e => setForm({ ...form, serial_number: e.target.value })} className="border border-[#E3DBB8] rounded-lg px-3 min-h-[40px] text-sm" />
          <input placeholder="Where it is (optional)" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} className="border border-[#E3DBB8] rounded-lg px-3 min-h-[40px] text-sm" />
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">How many years it will last</label>
            <input type="number" min="1" value={form.useful_life_years} onChange={e => setForm({ ...form, useful_life_years: e.target.value })} className="border border-[#E3DBB8] rounded-lg px-3 min-h-[40px] text-sm" />
          </div>

          <div className="flex flex-col gap-1 md:col-span-2">
            <label className="text-xs text-slate-500">How its value should drop over time</label>
            <select value={form.depreciation_method} onChange={e => setForm({ ...form, depreciation_method: e.target.value })} className="border border-[#E3DBB8] rounded-lg px-3 min-h-[40px] text-sm">
              {DEPRECIATION_METHODS.map(m => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
            </select>
          </div>
          {form.depreciation_method === 'REDUCING_BALANCE' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Percentage each year</label>
              <input type="number" min="0" max="100" step="0.01" value={form.depreciation_rate} onChange={e => setForm({ ...form, depreciation_rate: e.target.value })} className="border border-[#E3DBB8] rounded-lg px-3 min-h-[40px] text-sm" />
            </div>
          )}

          <input placeholder="Notes (optional)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="border border-[#E3DBB8] rounded-lg px-3 min-h-[40px] text-sm md:col-span-3" />

          <button type="submit" disabled={saving} className="bg-[#1F6B45] hover:bg-[#17553A] border-b-2 border-[#C9A227] text-white min-h-[42px] rounded-lg md:col-span-3 disabled:opacity-60 font-semibold">
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Save'}
          </button>
        </form>
      )}

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <Notice>Couldn't load equipment: {error}</Notice>
      ) : shown.length === 0 ? (
        <EmptyBlock>{assets.length === 0 ? 'Nothing here yet. Add the fridge, the freezer, the delivery bike.' : 'No equipment matches.'}</EmptyBlock>
      ) : (
        <CardGrid>
          {shown.map((a) => {
            const blocker = depreciationBlocker(a);
            const monthly = monthlyDepreciation(a);
            const result = assetService.disposalResult(a);
            const tone = a.status === 'ACTIVE' ? 'good' : a.status === 'UNDER_MAINTENANCE' ? 'warn' : 'neutral';
            return (
              <DataCard
                key={a.id}
                dim={a.status === 'DISPOSED' || a.status === 'WRITTEN_OFF'}
                thumb={<IconTile icon={HardHat} tone="gold" />}
                title={a.name}
                subtitle={[a.category, a.location].filter(Boolean).join(' · ') || a.purchase_date}
                pill={{ tone, label: STATUS_LABEL[a.status] }}
                big={{ value: fmt(bookValue(a)).replace(/\.00$/, ''), tone: 'good', label: 'worth now' }}
                metrics={[
                  { label: 'Cost', value: fmt(a.purchase_cost).replace(/\.00$/, '') },
                  { label: 'Wear & tear', value: fmt(a.accumulated_depreciation).replace(/\.00$/, ''), tone: 'gold' },
                ]}
                actions={(
                  <>
                    <TextBtn onClick={() => openEdit(a)}>Edit</TextBtn>
                    {!blocker && a.status !== 'DISPOSED' && a.status !== 'WRITTEN_OFF' && (
                      <TextBtn tone="gold" disabled={busyId === a.id} onClick={() => handleDepreciate(a)} title={`Records ${fmt(monthly)} of wear and tear for this month`}>
                        {busyId === a.id ? 'Recording…' : 'Record wear'}
                      </TextBtn>
                    )}
                    {a.status === 'ACTIVE' && <TextBtn onClick={() => setMaintenance(a.id, true)}>Repairing</TextBtn>}
                    {a.status === 'UNDER_MAINTENANCE' && <TextBtn onClick={() => setMaintenance(a.id, false)}>Back in use</TextBtn>}
                    {a.status !== 'DISPOSED' && a.status !== 'WRITTEN_OFF' && (
                      <TextBtn tone="danger" onClick={() => { setDisposing(a); setActionError(''); }}>Sold / gone</TextBtn>
                    )}
                  </>
                )}
              >
                {blocker && <div className="mt-1 text-[10px] text-[#A29E80] leading-tight">{blocker}</div>}
                {result != null && (
                  <div className={`mt-1 text-[10.5px] font-semibold ${result >= 0 ? 'text-[#1B6B45]' : 'text-[#B23A2E]'}`}>
                    {result >= 0 ? 'Made' : 'Lost'} {fmt(Math.abs(result))} on disposal
                  </div>
                )}
              </DataCard>
            );
          })}
        </CardGrid>
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
              <input required type="date" value={disposalForm.disposalDate} onChange={e => setDisposalForm({ ...disposalForm, disposalDate: e.target.value })} className="border border-[#E3DBB8] rounded-lg px-3 min-h-[40px] text-sm w-full" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">What you got for it (KES)</label>
              <input type="number" min="0" step="0.01" value={disposalForm.proceeds} onChange={e => setDisposalForm({ ...disposalForm, proceeds: e.target.value })} className="border border-[#E3DBB8] rounded-lg px-3 min-h-[40px] text-sm w-full" />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={disposalForm.writtenOff} onChange={e => setDisposalForm({ ...disposalForm, writtenOff: e.target.checked, proceeds: e.target.checked ? '0' : disposalForm.proceeds })} />
              It broke or was stolen — nothing received
            </label>
            <p className="text-xs text-slate-400">
              This doesn't add the money to My Money. If you were paid for it, record that separately.
            </p>
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={busyId === disposing.id} className="flex-1 bg-[#1F6B45] hover:bg-[#17553A] border-b-2 border-[#C9A227] text-white py-2 rounded-xl font-semibold disabled:opacity-60">
                {busyId === disposing.id ? 'Saving…' : 'Confirm'}
              </button>
              <button type="button" onClick={() => setDisposing(null)} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600">Cancel</button>
            </div>
          </form>
        </div>
      )}
    </FitPage>
  );
}
