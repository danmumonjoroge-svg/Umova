// Chart of accounts: grouped by type, tap an account to see its ledger, add or edit accounts.
import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { FitPage, LoadingBlock, Notice, inputCls } from '../../../components/CardKit';
import Sheet from '../../components/AppSheet.jsx';
import { useLedger, SetupCard, AccountLedgerSheet, PARTY_LABEL, TYPE_LABEL, TYPE_ORDER, SECTIONS, SECTION_LABEL } from './ledgerKit.jsx';

function EditSheet({ ctx, account, onClose, onDone }) {
  const [f, setF] = useState(account || { code: '', name: '', type: 'EXPENSE', section: 'EXPENSE', is_cash: false, is_active: true, party: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setType = (e) => { const type = e.target.value; setF((x) => ({ ...x, type, section: SECTIONS[type][0], is_cash: type === 'ASSET' ? x.is_cash : false })); };
  const save = async () => { setBusy(true); setErr(''); try { await ctx.api.glSaveAccount(ctx.businessId, { ...(account ? { id: account.id } : {}), code: f.code, name: f.name, type: f.type, section: f.section, is_cash: f.is_cash, is_active: f.is_active, party: f.party || null }); await onDone(); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <Sheet title={account ? 'Edit account' : 'New account'} onClose={onClose}>
      {err && <Notice tone="bad">{err}</Notice>}
      <div className="space-y-3">
        <input className={inputCls} placeholder="Code (e.g. 5600)" value={f.code} onChange={set('code')} />
        <input className={inputCls} placeholder="Account name" value={f.name} onChange={set('name')} />
        <select className={inputCls} value={f.type} onChange={setType}>{TYPE_ORDER.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select>
        {SECTIONS[f.type].length > 1 && <select className={inputCls} value={f.section} onChange={set('section')}>{SECTIONS[f.type].map((s) => <option key={s} value={s}>{SECTION_LABEL[s]}</option>)}</select>}
        {f.type === 'ASSET' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={f.is_cash} onChange={set('is_cash')} />Cash or bank account</label>}
        {(f.section === 'CURRENT_ASSET' && !f.is_cash) || f.section === 'CURRENT_LIABILITY' ? <select className={inputCls} value={f.party || ''} onChange={set('party')}><option value="">Group on the receivables / payables report…</option>{Object.entries(PARTY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select> : null}
        {account && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={f.is_active} onChange={set('is_active')} />In use</label>}
        <p className="text-xs text-[#6F7461]">Once an account has journals, its code and type cannot change. Switch it off instead.</p>
        <button type="button" disabled={busy} onClick={save} className="w-full h-12 rounded-2xl bg-[#12261F] text-white font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Save account'}</button>
      </div></Sheet>);
}

export default function ElimuChartPage() {
  const { ctx, accounts, err, load, ready } = useLedger(); const [view, setView] = useState(null); const [edit, setEdit] = useState(null);
  if (!ready) return <LoadingBlock />;
  if (!ctx.can('report')) return <FitPage title="Chart of accounts"><Notice tone="gold">You do not have access to the ledger.</Notice></FitPage>;
  const canEdit = ctx.can('configure') || ctx.can('reconcile');
  return (
    <FitPage title="Chart of accounts" subtitle="The accounts every journal is posted to" action={canEdit && accounts?.length ? <button type="button" onClick={() => setEdit({})} className="h-10 px-3 rounded-xl bg-[#12261F] text-white text-sm font-semibold flex items-center gap-1.5"><Plus size={16} />Add</button> : null}>
      {err && <Notice tone="bad">{err}</Notice>}
      {accounts === null ? <LoadingBlock /> : !accounts.length ? <SetupCard ctx={ctx} onDone={load} /> : TYPE_ORDER.map((t) => { const list = accounts.filter((a) => a.type === t); if (!list.length) return null; return (
        <div key={t} className="mb-4"><h3 className="text-xs font-bold uppercase tracking-wide text-[#6F7461] mb-1.5">{TYPE_LABEL[t]}</h3>
          <div className="space-y-1.5">{list.map((a) => (
            <div key={a.id} className={`flex items-center rounded-xl border border-[#E3DBB8] bg-white ${a.is_active ? '' : 'opacity-50'}`}>
              <button type="button" onClick={() => setView(a)} className="flex-1 min-w-0 text-left p-3"><span className="font-mono text-xs text-[#6F7461] mr-2">{a.code}</span><span className="text-sm font-semibold">{a.name}</span>{a.is_cash && <span className="ml-2 text-[10px] font-bold text-emerald-700">CASH</span>}{!a.is_active && <span className="ml-2 text-[10px] font-bold">OFF</span>}</button>
              {canEdit && <button type="button" onClick={() => setEdit(a)} className="px-3 text-xs font-semibold text-[#8A6D0B] h-full">Edit</button>}</div>))}</div></div>); })}
      {view && <AccountLedgerSheet ctx={ctx} account={view} onClose={() => setView(null)} />}
      {edit && <EditSheet ctx={ctx} account={edit.id ? edit : null} onClose={() => setEdit(null)} onDone={load} />}
    </FitPage>);
}
