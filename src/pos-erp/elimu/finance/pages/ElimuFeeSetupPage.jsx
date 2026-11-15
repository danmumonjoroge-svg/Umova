// Fee setup + billing for administrators/bursars: periods, fee items, structures, then bill one class (with a dry-run preview first).
// Nothing is hard-coded: every fee, class and period comes from the school's own configuration tables.
import React, { useCallback, useEffect, useState } from 'react';
import { useElimuFinance } from '../hooks/useElimuFinance';
import { FitPage, LoadingBlock, EmptyBlock, Notice, DataCard, Pill, inputCls, saveBtnCls, formCard } from '../../../components/CardKit';
import { toCents, toDecimalString, fromDb, formatMoney, MoneyError } from '../utils/money';

const CATS = ['TUITION', 'ADMISSION', 'ACTIVITY', 'TRANSPORT', 'BOARDING', 'MEALS', 'EXAMINATION', 'DEVELOPMENT', 'MEDICAL', 'UNIFORM', 'BOOKS', 'OTHER'];
const FREQ = ['ONCE', 'TERM', 'ANNUAL', 'MONTHLY', 'CUSTOM'];

export default function ElimuFeeSetupPage() {
  const ctx = useElimuFinance(); const { api, businessId, can } = ctx;
  const [d, setD] = useState(null); const [err, setErr] = useState(null); const [ok, setOk] = useState(null);
  const [item, setItem] = useState({ name: '', category: 'TUITION', amount: '', frequency: 'TERM' });
  const [period, setPeriod] = useState({ academic_year: '', term: '', start_date: '', end_date: '', default_due_date: '' });
  const [struct, setStruct] = useState({ name: '', period_id: '', class_name: '', class_id: '', lines: {} });
  const [bill, setBill] = useState({ period_id: '', class_id: '' }); const [prev, setPrev] = useState(null);

  const load = useCallback(async () => {
    try { const [items, periods, structures, classes] = await Promise.all([
      api.list('elimu_fin_fee_items', businessId, { order: { col: 'name' } }), api.list('elimu_fin_periods', businessId, { order: { col: 'start_date', asc: false } }),
      api.structureReport(businessId), api.list('elimu_fin_students', businessId, { columns: 'class_id,class_name', limit: 500 })]);
      const seen = new Map(); classes.forEach(c => c.class_id && seen.set(c.class_id, c.class_name)); setD({ items, periods, structures, classes: [...seen] });
    } catch (e) { setErr(e.message); setD({ items: [], periods: [], structures: [], classes: [] }); }
  }, [api, businessId]);
  useEffect(() => { if (ctx.ready) load(); }, [ctx.ready, load]);
  if (!ctx.ready || !d) return <LoadingBlock />;

  const run = (fn, msg) => async () => { try { setErr(null); setOk(null); await fn(); setOk(msg); await load(); } catch (e) { setErr(e instanceof MoneyError ? e.message : e.message); } };
  const admin = can('configure'); const biller = can('bill');
  const saveItem = run(async () => { await api.saveConfig('elimu_fin_fee_items', businessId, { name: item.name.trim(), category: item.category, default_amount: toDecimalString(toCents(item.amount)), frequency: item.frequency }); setItem({ ...item, name: '', amount: '' }); }, 'Fee item saved.');
  const savePeriod = run(async () => { await api.saveConfig('elimu_fin_periods', businessId, { academic_year: period.academic_year.trim(), term: period.term.trim() || null, start_date: period.start_date, end_date: period.end_date, default_due_date: period.default_due_date || null }); }, 'Period saved.');
  const saveStruct = run(async () => {
    const lines = Object.entries(struct.lines).filter(([, v]) => v !== '' && v != null); if (!lines.length) throw new Error('Add at least one fee item amount.');
    const s = await api.saveConfig('elimu_fin_fee_structures', businessId, { name: struct.name.trim(), period_id: struct.period_id, class_id: struct.class_id || null, class_name: struct.class_id ? struct.class_name : null, status: 'ACTIVE' });
    for (const [itemId, v] of lines) await api.saveConfig('elimu_fin_fee_structure_items', businessId, { structure_id: s.id, fee_item_id: itemId, amount: toDecimalString(toCents(v)) });
    setStruct({ name: '', period_id: '', class_name: '', class_id: '', lines: {} });
  }, 'Fee structure saved.');
  const preview = run(async () => setPrev(await api.billBulk(businessId, bill.period_id, { classId: bill.class_id || null, dryRun: true })), 'Preview ready - nothing has been billed yet.');
  const billNow = run(async () => { const r = await api.billBulk(businessId, bill.period_id, { classId: bill.class_id || null }); setPrev(null); if (r.failed) throw new Error(`${r.created} billed, ${r.skipped} skipped, ${r.failed} FAILED. See details below.`); setPrev(r); }, 'Billing complete.');

  return (
    <FitPage title="Fee setup and billing" subtitle="Your school's fees, your way">
      {err && <Notice tone="bad">{err}</Notice>}{ok && <Notice tone="good">{ok}</Notice>}
      {admin && <>
        <div className={formCard}><div className="font-semibold mb-1">Billing period</div>
          <input className={inputCls + ' mb-1'} placeholder="Academic year e.g. 2026" value={period.academic_year} onChange={e => setPeriod({ ...period, academic_year: e.target.value })} />
          <input className={inputCls + ' mb-1'} placeholder="Term e.g. Term 1 (leave empty for a whole year)" value={period.term} onChange={e => setPeriod({ ...period, term: e.target.value })} />
          {[['start_date', 'Starts'], ['end_date', 'Ends'], ['default_due_date', 'Fees due by']].map(([k, l]) => <label key={k} className="text-xs block">{l}<input type="date" className={inputCls + ' mb-1'} value={period[k]} onChange={e => setPeriod({ ...period, [k]: e.target.value })} /></label>)}
          <button className={saveBtnCls} disabled={!period.academic_year || !period.start_date || !period.end_date} onClick={savePeriod}>Save period</button></div>
        <div className={formCard}><div className="font-semibold mb-1">New fee item</div>
          <input className={inputCls + ' mb-1'} placeholder="Name e.g. Tuition, Transport" value={item.name} onChange={e => setItem({ ...item, name: e.target.value })} />
          <select className={inputCls + ' mb-1'} value={item.category} onChange={e => setItem({ ...item, category: e.target.value })}>{CATS.map(c => <option key={c}>{c}</option>)}</select>
          <select className={inputCls + ' mb-1'} value={item.frequency} onChange={e => setItem({ ...item, frequency: e.target.value })}>{FREQ.map(c => <option key={c}>{c}</option>)}</select>
          <input className={inputCls + ' mb-1'} inputMode="decimal" placeholder="Default amount (KES)" value={item.amount} onChange={e => setItem({ ...item, amount: e.target.value })} />
          <button className={saveBtnCls} disabled={!item.name.trim() || !item.amount} onClick={saveItem}>Save fee item</button></div>
        <div className={formCard}><div className="font-semibold mb-1">New fee structure</div>
          <input className={inputCls + ' mb-1'} placeholder="Name e.g. Class 5 Term 1" value={struct.name} onChange={e => setStruct({ ...struct, name: e.target.value })} />
          <select className={inputCls + ' mb-1'} value={struct.period_id} onChange={e => setStruct({ ...struct, period_id: e.target.value })}><option value="">Choose period</option>{d.periods.map(p => <option key={p.id} value={p.id}>{p.academic_year} {p.term || ''}</option>)}</select>
          <select className={inputCls + ' mb-1'} value={struct.class_id} onChange={e => setStruct({ ...struct, class_id: e.target.value, class_name: (d.classes.find(([id]) => id === e.target.value) || [])[1] })}><option value="">All classes</option>{d.classes.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
          {d.items.filter(i => i.is_active).map(i => (<div key={i.id} className="flex items-center gap-2 mb-1"><span className="text-sm flex-1">{i.name}</span><input className={inputCls} style={{ maxWidth: 130 }} inputMode="decimal" placeholder={String(i.default_amount)} value={struct.lines[i.id] ?? ''} onChange={e => setStruct({ ...struct, lines: { ...struct.lines, [i.id]: e.target.value } })} /></div>))}
          <button className={saveBtnCls} disabled={!struct.name.trim() || !struct.period_id} onClick={saveStruct}>Save structure</button></div></>}
      <h3 className="font-semibold mt-2">Fee structures</h3>
      {d.structures.length === 0 ? <EmptyBlock>No fee structures yet.</EmptyBlock> : d.structures.map(s => (<DataCard key={s.structure_id} title={s.name} subtitle={`${s.academic_year} ${s.term || ''} - ${s.class || 'all classes'}`} pill={<Pill>{s.status.toLowerCase()}</Pill>} big={formatMoney(fromDb(s.total))}
        metrics={s.items.map(i => ({ label: i.item, value: formatMoney(fromDb(i.amount)) }))} />))}
      {biller && (<div className={formCard}><div className="font-semibold mb-1">Bill a class</div>
        <select className={inputCls + ' mb-1'} value={bill.period_id} onChange={e => { setPrev(null); setBill({ ...bill, period_id: e.target.value }); }}><option value="">Choose period</option>{d.periods.map(p => <option key={p.id} value={p.id}>{p.academic_year} {p.term || ''}</option>)}</select>
        <select className={inputCls + ' mb-1'} value={bill.class_id} onChange={e => { setPrev(null); setBill({ ...bill, class_id: e.target.value }); }}><option value="">All classes</option>{d.classes.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
        <div className="flex gap-2"><button className={saveBtnCls} disabled={!bill.period_id} onClick={preview}>1. Preview</button>
          <button className={saveBtnCls} disabled={!bill.period_id || !prev?.dry_run} onClick={billNow}>2. Issue invoices</button></div>
        <div className="text-xs mt-1">Students already billed for the same fee structure and period are skipped, so running this twice never double-bills.</div>
        {prev && <Notice tone={prev.failed ? 'bad' : 'neutral'}>{prev.dry_run ? 'Would bill' : 'Billed'} {prev.created} student(s) totalling {formatMoney(fromDb(prev.total_billed))}; {prev.skipped} skipped; {prev.failed} failed.
          {prev.detail?.slice(0, 8).map((x, i) => <div key={i}>{x.admission_no}: {x.result}{x.error ? ` - ${x.error}` : ''}</div>)}</Notice>}</div>)}
    </FitPage>
  );
}
