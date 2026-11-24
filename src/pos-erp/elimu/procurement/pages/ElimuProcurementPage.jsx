import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSchool, usePosErpAuth } from '../../services/platform.js';
import { useElimuFinance } from '../../finance/hooks/useElimuFinance';
import { elimuProcurementService as api } from '../../services/ElimuProcurementService.js';

const money = (v) => `KES ${Number(v || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const input = 'w-full min-h-10 rounded-xl border border-[#E3DBB8] bg-white px-3 text-sm outline-none focus:border-[#1F6B45]';
const button = 'inline-flex min-h-10 items-center justify-center rounded-xl bg-[#1F6B45] px-4 text-sm font-semibold text-white disabled:opacity-50';
const secondary = 'inline-flex min-h-9 items-center justify-center rounded-xl border border-[#E3DBB8] bg-white px-3 text-sm font-semibold text-[#23382B]';

export default function ElimuProcurementPage() {
  const school = useSchool(); const { can } = useElimuFinance(); const canWrite = can('expense'); const canApprove = can('approve');
  const { tenant, staffId } = usePosErpAuth();
  const [tab, setTab] = useState('suppliers');
  const [suppliers, setSuppliers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [grns, setGrns] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [supplierForm, setSupplierForm] = useState(false);
  const [poForm, setPoForm] = useState(false);
  const [receiving, setReceiving] = useState(null);
  const [receiveForm, setReceiveForm] = useState({ invoice_no: '', notes: '', paymentType: 'CREDIT' });
  const [saving, setSaving] = useState(false);
  const [supplier, setSupplier] = useState({ name: '', contact_person: '', phone: '', email: '', address: '', payment_terms: 'Cash' });
  const [po, setPo] = useState({ supplier_id: '', expected_date: '', product_id: '', quantity: '1', unit_cost: '' });
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [s, p, g] = await Promise.all([api.suppliers({ limit: 200 }), api.purchaseOrders({ limit: 200 }), api.goodsReceived({ limit: 200 })]);
      setSuppliers(s.data || []); setOrders(p.data || []); setGrns(g.data || []);
    } catch (e) { setError(e.message || 'Could not load procurement records.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (poForm) api.products().then(setProducts).catch(e => setError(e.message)); }, [poForm]);

  const visibleSuppliers = useMemo(() => suppliers.filter(s => `${s.name} ${s.contact_person || ''} ${s.phone || ''}`.toLowerCase().includes(search.toLowerCase())), [suppliers, search]);
  const totals = useMemo(() => ({ suppliers: suppliers.filter(s => s.is_active).length, open: orders.filter(o => ['DRAFT','PENDING_APPROVAL','APPROVED','PARTIALLY_RECEIVED'].includes(o.status)).length, received: grns.length, committed: orders.filter(o => !['CANCELLED'].includes(o.status)).reduce((n,o) => n + Number(o.total_amount || 0), 0) }), [suppliers, orders, grns]);

  async function saveSupplier(e) {
    e.preventDefault(); setSaving(true); setError('');
    try {
      if (!tenant?.id) throw new Error('School tenant is not available. Sign in again or contact the administrator.');
      await api.createSupplier({ ...supplier, tenant_id: tenant.id, business_id: tenant.business_id ?? null, created_by: staffId ?? null });
      setSupplier({ name: '', contact_person: '', phone: '', email: '', address: '', payment_terms: 'Cash' }); setSupplierForm(false); setNotice('Supplier saved.'); await load();
    } catch (e2) { setError(e2.message || 'Could not save supplier.'); }
    finally { setSaving(false); }
  }
  async function savePO(e) {
    e.preventDefault(); setSaving(true); setError('');
    try {
      if (!tenant?.id) throw new Error('School tenant is not available.');
      const product = products.find(p => p.id === po.product_id);
      if (!po.supplier_id || !product || !(Number(po.quantity) > 0) || !(Number(po.unit_cost) >= 0)) throw new Error('Select a supplier and product, then enter a valid quantity and unit cost.');
      await api.createPurchaseOrder({ tenant_id: tenant.id, business_id: tenant.business_id ?? null, created_by: staffId ?? null, supplier_id: po.supplier_id, expected_date: po.expected_date || null, status: 'DRAFT', items: [{ product_id: product.id, quantity: Number(po.quantity), unit_cost: Number(po.unit_cost) }] });
      setPo({ supplier_id: '', expected_date: '', product_id: '', quantity: '1', unit_cost: '' }); setPoForm(false); setNotice('Purchase order saved as draft.'); await load();
    } catch (e2) { setError(e2.message || 'Could not create purchase order.'); }
    finally { setSaving(false); }
  }
  async function receiveOrder(e) {
    e.preventDefault(); if (!receiving) return; setSaving(true); setError('');
    try {
      if (!tenant?.id) throw new Error('School tenant is not available.');
      const items = (receiving.items || []).map(i => ({ purchase_order_item_id: i.id, product_id: i.product_id, quantity: Number(i.receiveNow || 0), unit_cost: Number(i.unit_cost || 0) })).filter(i => i.quantity > 0);
      if (!items.length) throw new Error('Enter a received quantity for at least one item.');
      await api.receiveFromOrder(receiving.id, { tenant_id: tenant.id, business_id: tenant.business_id ?? null, received_by: staffId ?? null, invoice_no: receiveForm.invoice_no || null, notes: receiveForm.notes || null, payment: { type: receiveForm.paymentType }, items });
      setReceiving(null); setReceiveForm({ invoice_no: '', notes: '', paymentType: 'CREDIT' }); setNotice('Goods received note recorded and stock updated.'); await load();
    } catch (e2) { setError(e2.message || 'Could not record goods received.'); }
    finally { setSaving(false); }
  }
  async function setOrderStatus(id, status) {
    setSaving(true); setError('');
    try { await api.updatePurchaseOrderStatus(id, status); setNotice(`Purchase order ${status.toLowerCase().replaceAll('_',' ')}.`); await load(); }
    catch (e) { setError(e.message || 'Could not update purchase order.'); }
    finally { setSaving(false); }
  }

  return <div className="space-y-4 pb-8">
    <header className="rounded-2xl bg-[#1F6B45] p-4 text-white">
      <div className="text-xs font-semibold uppercase tracking-wider text-white/70">School operations</div>
      <h1 className="mt-1 text-2xl font-bold">Procurement & suppliers</h1>
      <p className="mt-1 max-w-2xl text-sm text-white/80">Manage approved suppliers, purchase orders and goods received for {school.schoolName || 'your school'}.</p>
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        {[['Active suppliers', totals.suppliers], ['Open orders', totals.open], ['Goods received', totals.received], ['Order value', money(totals.committed)]].map(([label,value]) => <div key={label} className="rounded-xl bg-white/10 p-3"><div className="text-[11px] text-white/70">{label}</div><div className="mt-1 text-lg font-bold">{value}</div></div>)}
      </div>
    </header>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}<button className="float-right font-bold" onClick={() => setNotice('')}>×</button></div>}
    <div className="flex flex-wrap items-center gap-2">
      {['suppliers','orders','received'].map(t => <button key={t} onClick={() => setTab(t)} className={`rounded-full px-4 py-2 text-sm font-semibold capitalize ${tab === t ? 'bg-[#1F6B45] text-white' : 'border border-[#E3DBB8] bg-white text-[#425344]'}`}>{t === 'orders' ? 'Purchase orders' : t === 'received' ? 'Goods received' : t}</button>)}
      <span className="flex-1" />
      {canWrite && tab === 'suppliers' && <button className={button} onClick={() => setSupplierForm(v => !v)}>+ Add supplier</button>}
      {canWrite && tab === 'orders' && <button className={button} onClick={() => setPoForm(v => !v)}>+ New purchase order</button>}
    </div>
    {supplierForm && <form onSubmit={saveSupplier} className="rounded-[18px] border border-[#E3DBB8] bg-white shadow-[0_1px_2px_rgba(18,38,31,.06),0_6px_14px_-8px_rgba(18,38,31,.18)] p-4">
      <h2 className="mb-3 font-bold">New supplier</h2><div className="grid gap-3 sm:grid-cols-2">
        <input className={input} placeholder="Supplier / company name *" required value={supplier.name} onChange={e => setSupplier({...supplier,name:e.target.value})}/>
        <input className={input} placeholder="Contact person" value={supplier.contact_person} onChange={e => setSupplier({...supplier,contact_person:e.target.value})}/>
        <input className={input} placeholder="Phone" value={supplier.phone} onChange={e => setSupplier({...supplier,phone:e.target.value})}/>
        <input className={input} type="email" placeholder="Email" value={supplier.email} onChange={e => setSupplier({...supplier,email:e.target.value})}/>
        <input className={input} placeholder="Address" value={supplier.address} onChange={e => setSupplier({...supplier,address:e.target.value})}/>
        <input className={input} placeholder="Payment terms (e.g. 30 days)" value={supplier.payment_terms} onChange={e => setSupplier({...supplier,payment_terms:e.target.value})}/>
      </div><div className="mt-3 flex justify-end gap-2"><button type="button" className={secondary} onClick={() => setSupplierForm(false)}>Cancel</button><button className={button} disabled={saving}>{saving ? 'Saving…' : 'Save supplier'}</button></div>
    </form>}
    {poForm && <form onSubmit={savePO} className="rounded-[18px] border border-[#E3DBB8] bg-white shadow-[0_1px_2px_rgba(18,38,31,.06),0_6px_14px_-8px_rgba(18,38,31,.18)] p-4">
      <h2 className="mb-3 font-bold">Create purchase order</h2><div className="grid gap-3 sm:grid-cols-2">
        <select className={input} required value={po.supplier_id} onChange={e => setPo({...po,supplier_id:e.target.value})}><option value="">Select supplier *</option>{suppliers.filter(s=>s.is_active).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <input className={input} type="date" value={po.expected_date} onChange={e => setPo({...po,expected_date:e.target.value})}/>
        <select className={input} required value={po.product_id} onChange={e => { const p=products.find(x=>x.id===e.target.value); setPo({...po,product_id:e.target.value,unit_cost:p?.cost_price ?? ''}); }}><option value="">Select stock item *</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}{p.sku ? ` · ${p.sku}` : ''}</option>)}</select>
        <input className={input} type="number" min="0.001" step="0.001" required placeholder="Quantity" value={po.quantity} onChange={e => setPo({...po,quantity:e.target.value})}/>
        <input className={input} type="number" min="0" step="0.01" required placeholder="Unit cost (KES)" value={po.unit_cost} onChange={e => setPo({...po,unit_cost:e.target.value})}/>
      </div><p className="mt-2 text-xs text-slate-500">This creates a draft order. Approval and receiving remain separate steps.</p><div className="mt-3 flex justify-end gap-2"><button type="button" className={secondary} onClick={() => setPoForm(false)}>Cancel</button><button className={button} disabled={saving}>{saving ? 'Saving…' : 'Save draft PO'}</button></div>
    </form>}
    {receiving && <form onSubmit={receiveOrder} className="rounded-[18px] border border-[#E3DBB8] bg-white shadow-[0_1px_2px_rgba(18,38,31,.06),0_6px_14px_-8px_rgba(18,38,31,.18)] p-4">
      <h2 className="font-bold">Receive goods · {receiving.po_number}</h2><p className="mb-3 text-xs text-slate-500">Record only the quantities physically delivered. You can receive the remaining balance later.</p>
      <div className="space-y-2">{(receiving.items || []).map(i => <div key={i.id} className="grid grid-cols-[1fr_86px_92px] items-center gap-2 rounded-xl bg-[#FBF8EA] p-2"><div className="min-w-0"><div className="truncate text-sm font-semibold">{i.product?.name || 'Stock item'}</div><div className="text-[11px] text-slate-500">Ordered: {i.quantity} · Received: {i.received_quantity || 0}</div></div><label className="text-[10px] text-slate-500">Receive now<input className={input} type="number" min="0" max={Math.max(0, Number(i.quantity || 0) - Number(i.received_quantity || 0))} step="0.001" value={i.receiveNow ?? ''} onChange={e=>setReceiving({...receiving,items:receiving.items.map(x=>x.id===i.id?{...x,receiveNow:e.target.value}:x)})}/></label><div className="text-right text-xs font-semibold">{money(Number(i.unit_cost || 0) * Number(i.receiveNow || 0))}</div></div>)}</div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3"><input className={input} placeholder="Supplier invoice no." value={receiveForm.invoice_no} onChange={e=>setReceiveForm({...receiveForm,invoice_no:e.target.value})}/><select className={input} value={receiveForm.paymentType} onChange={e=>setReceiveForm({...receiveForm,paymentType:e.target.value})}><option value="CREDIT">On credit</option><option value="CASH">Paid in full</option></select><input className={input} placeholder="Receiving notes" value={receiveForm.notes} onChange={e=>setReceiveForm({...receiveForm,notes:e.target.value})}/></div>
      <div className="mt-3 flex justify-end gap-2"><button type="button" className={secondary} onClick={()=>setReceiving(null)}>Cancel</button><button className={button} disabled={saving}>{saving?'Posting…':'Post goods received'}</button></div>
    </form>}
    {tab === 'suppliers' && <section className="space-y-3"><input className={input} placeholder="Search suppliers by name, contact or phone…" value={search} onChange={e=>setSearch(e.target.value)}/>{loading ? <p className="p-6 text-center text-sm text-slate-500">Loading suppliers…</p> : visibleSuppliers.length ? <div className="grid gap-3 md:grid-cols-2">{visibleSuppliers.map(s=><article key={s.id} className="rounded-[18px] border border-[#E3DBB8] bg-white shadow-[0_1px_2px_rgba(18,38,31,.06),0_6px_14px_-8px_rgba(18,38,31,.18)] p-4"><div className="flex items-start justify-between gap-2"><div><h3 className="font-bold text-[#23382B]">{s.name}</h3><p className="mt-1 text-xs text-slate-500">{s.contact_person || 'No contact person'}{s.phone ? ` · ${s.phone}` : ''}</p></div><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${s.is_active?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-500'}`}>{s.is_active?'Active':'Inactive'}</span></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div><div className="text-slate-400">Email</div><div className="mt-0.5 break-all">{s.email || '—'}</div></div><div><div className="text-slate-400">Outstanding</div><div className="mt-0.5 font-semibold">{money(s.outstanding_balance)}</div></div><div><div className="text-slate-400">Terms</div><div className="mt-0.5">{s.payment_terms || '—'}</div></div><div><div className="text-slate-400">Address</div><div className="mt-0.5">{s.address || '—'}</div></div></div></article>)}</div> : <div className="rounded-2xl border border-dashed border-[#D8D0B0] p-8 text-center"><div className="font-semibold">No suppliers found</div><p className="mt-1 text-sm text-slate-500">Add suppliers to start preparing school purchase orders.</p></div>}</section>}
    {tab === 'orders' && <section className="space-y-3">{loading ? <p className="p-6 text-center text-sm text-slate-500">Loading orders…</p> : orders.length ? orders.map(o=><article key={o.id} className="rounded-[18px] border border-[#E3DBB8] bg-white shadow-[0_1px_2px_rgba(18,38,31,.06),0_6px_14px_-8px_rgba(18,38,31,.18)] p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold">{o.po_number || 'Purchase order'}</h3><p className="text-xs text-slate-500">{o.supplier?.name || 'Supplier'} · {o.order_date || 'Date not set'}</p></div><span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">{String(o.status || '').replaceAll('_',' ')}</span></div><div className="mt-3 flex items-center justify-between"><span className="text-sm text-slate-500">{o.items?.length || 0} line(s)</span><strong>{money(o.total_amount)}</strong></div>{canWrite && o.status === 'DRAFT' && <div className="mt-3 flex justify-end"><button disabled={saving} className={secondary} onClick={()=>setOrderStatus(o.id,'PENDING_APPROVAL')}>Submit for approval</button></div>}{o.status === 'PENDING_APPROVAL' && (canApprove ? <div className="mt-3 flex justify-end gap-2"><button disabled={saving} className={secondary} onClick={()=>setOrderStatus(o.id,'CANCELLED')}>Decline</button><button disabled={saving} className={button} onClick={()=>setOrderStatus(o.id,'APPROVED')}>Approve order</button></div> : <p className="mt-3 text-right text-xs text-slate-500">Waiting for approval by the bursar or principal.</p>)}{canWrite && ['APPROVED','PARTIALLY_RECEIVED'].includes(o.status) && <div className="mt-3 flex justify-end"><button disabled={saving} className={secondary} onClick={()=>setReceiving({...o,items:(o.items||[]).map(i=>({...i,receiveNow:''}))})}>Receive delivery</button></div>}</article>) : <div className="rounded-2xl border border-dashed border-[#D8D0B0] p-8 text-center text-sm text-slate-500">No purchase orders yet.</div>}</section>}
    {tab === 'received' && <section className="space-y-3">{loading ? <p className="p-6 text-center text-sm text-slate-500">Loading goods received…</p> : grns.length ? grns.map(g=><article key={g.id} className="rounded-[18px] border border-[#E3DBB8] bg-white shadow-[0_1px_2px_rgba(18,38,31,.06),0_6px_14px_-8px_rgba(18,38,31,.18)] p-4"><div className="flex justify-between gap-2"><div><h3 className="font-bold">{g.grn_number || 'Goods received note'}</h3><p className="text-xs text-slate-500">{g.supplier?.name || 'Supplier'} · {g.received_date || 'Date not set'}</p></div><span className="text-xs font-semibold text-emerald-700">{g.status || 'RECORDED'}</span></div><div className="mt-2 flex justify-between text-sm"><span className="text-slate-500">{g.items?.length || 0} received line(s)</span><strong>{money(g.total_amount)}</strong></div></article>) : <div className="rounded-2xl border border-dashed border-[#D8D0B0] p-8 text-center text-sm text-slate-500">No goods received notes yet. Receive items against an approved order from the stock receiving workflow.</div>}</section>}
    <p className="text-[11px] text-slate-400">Records are stored in the shared POS procurement tables and protected by the host database tenant policies. Elimu-specific role enforcement and school-ledger posting still require the corresponding database migration.</p>
  </div>;
}
