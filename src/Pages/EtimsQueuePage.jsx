// src/pos-erp/pages/EtimsQueuePage.jsx   (route: /pos/etims)
// Tax invoices (KRA): what needs attention + the items' KRA codes. Plain words; no accounting terms.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { WorkspacePage, SectionTitle } from '../components/workspace/WorkspaceKit';
import Sheet from '../components/workspace/Sheet';
import EtimsCodePicker from '../components/EtimsCodePicker';
import { useEtims } from '../hooks/useEtims';
import { etimsService, ETIMS_STATUS_LABEL } from '../services/etimsService';

const card = 'bg-white border border-[#DDE3DD] rounded-xl p-3';
const btn = 'min-h-[40px] px-3 rounded-lg text-sm font-semibold disabled:opacity-60';
const REG = { NOT_REGISTERED: ['Not sent to KRA', 'text-[#6F7461] bg-[#EEF1EE]'], PENDING: ['Sending…', 'text-[#6b5516] bg-[#FBF6E4]'], REGISTERED: ['Registered ✓', 'text-[#17583a] bg-[#E3F1E9]'], REJECTED: ['KRA refused', 'text-red-700 bg-red-50'] };
const FIELDS = [
  ['tax_code', 'Tax type', 'tax_type'], ['item_class_code', 'Item class', 'item_class'], ['unit_code', 'Unit', 'unit'],
  ['packaging_code', 'Packaging', 'packaging'], ['origin_country_code', 'Country of origin', 'country'],
];

export default function EtimsQueuePage() {
  const { businessId, status, refresh } = useEtims();
  const [att, setAtt] = useState(null);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [edit, setEdit] = useState(null);
  const [codes, setCodes] = useState({});
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    if (!businessId) return;
    try {
      const [a, i] = await Promise.all([etimsService.attention(businessId).catch(() => null), etimsService.listItems(businessId)]);
      setAtt(a); setItems(i);
    } catch (e) { setErr(e.message); }
  }, [businessId]);
  useEffect(() => { load(); }, [load]);

  const run = async (key, work, ok) => {
    setBusy(key); setErr(null); setMsg(null);
    try { await work(); if (ok) setMsg(ok); await Promise.all([load(), refresh()]); } catch (e) { setErr(e.message); } finally { setBusy(null); }
  };

  const openItem = (it) => { setEdit(it); setCodes({ ...(it.map || {}) }); };
  const save = async (register) => {
    const body = Object.fromEntries(FIELDS.map(([k]) => [k, codes[k] || '']));
    await run('item', async () => {
      await etimsService.setItemCodes(businessId, edit.id, body);
      if (register) await etimsService.registerItem(edit.id);
      setEdit(null);
    }, register ? 'Item registered with KRA.' : 'Codes saved.');
  };

  if (status && !status.configured) {
    return <WorkspacePage title="Tax invoices" subtitle="KRA eTIMS"><div className={card}>Tax invoices are not set up yet. <Link className="underline font-semibold" to="/pos/settings?s=etims">Set them up in Settings</Link>.</div></WorkspacePage>;
  }
  const attn = (att?.invoices?.length || 0) + (att?.held_back?.length || 0);
  const shownItems = items.filter((i) => !filter || i.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <WorkspacePage title="Tax invoices" subtitle="KRA eTIMS · what needs you">
      {err && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-3">{err}</div>}
      {msg && <div className="bg-[#E3F1E9] border border-[#b9dcc8] text-[#17583a] text-sm rounded-lg p-3 mb-3">{msg}</div>}

      <div className="flex flex-wrap gap-2 mb-3">
        <button className={`${btn} bg-[#237A52] text-white`} disabled={!!busy || !status?.enabled} onClick={() => run('send', () => etimsService.sendNow(), 'Sent what was waiting.')}>
          {busy === 'send' ? 'Sending…' : 'Send now'}
        </button>
        <button className={`${btn} border border-[#DDE3DD] bg-white text-[#26352D]`} disabled={!!busy} onClick={() => run('held', () => etimsService.retryHeld(businessId), 'Checked again.')}>
          <RefreshCw size={14} className="inline mr-1" />Check again
        </button>
        {status?.pending > 0 && <span className="text-xs text-[#68756D] self-center">{status.pending} waiting to send</span>}
      </div>

      <SectionTitle>{attn ? `Needs attention (${attn})` : 'Needs attention'}</SectionTitle>
      {!att && <div className={card}><Loader2 className="animate-spin inline mr-2" size={14} />Loading…</div>}
      {att && attn === 0 && <div className={`${card} text-sm text-[#17583a] flex items-center gap-2`}><CheckCircle2 size={16} /> Nothing needs you.</div>}
      <div className="space-y-2">
        {(att?.invoices || []).map((i) => (
          <div key={i.id} className={card}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#26352D]">{i.doc_type === 'CREDIT_NOTE' ? 'Credit note' : 'Sale'} {i.sale_number} · KES {Number(i.total).toLocaleString()}</p>
                <p className="text-xs text-[#68756D] mt-0.5">{i.status === 'SENT_UNCONFIRMED' ? 'KRA did not confirm. Check with KRA, then send again if it is not there.' : ETIMS_STATUS_LABEL[i.status]}</p>
                {i.message && <p className="text-xs text-red-700 mt-1">{i.message}</p>}
              </div>
              <button className={`${btn} border border-[#DDE3DD]`} disabled={!!busy} onClick={() => run('r' + i.id, () => etimsService.requeue(i.id), 'It will be sent again.')}>Send again</button>
            </div>
          </div>
        ))}
        {(att?.held_back || []).map((h) => (
          <div key={h.sale_id} className={`${card} flex gap-2`}>
            <AlertTriangle size={16} className="text-[#B8921C] shrink-0 mt-0.5" />
            <div className="min-w-0"><p className="text-sm font-semibold text-[#26352D]">Sale {h.sale_number} · KES {Number(h.total).toLocaleString()} not sent yet</p><p className="text-xs text-[#68756D] mt-0.5">{h.reason}</p></div>
          </div>
        ))}
      </div>

      <div className="mt-5" />
      <SectionTitle>My items and KRA codes</SectionTitle>
      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search items…" className="w-full min-h-[44px] px-3 mb-2 border border-[#DDE3DD] rounded-lg text-sm bg-white" />
      <div className="space-y-2">
        {shownItems.map((it) => {
          const [label, tone] = REG[it.map?.registration_status || 'NOT_REGISTERED'];
          const ready = it.map && FIELDS.every(([k]) => it.map[k]);
          return (
            <button key={it.id} type="button" onClick={() => openItem(it)} className={`${card} w-full text-left flex items-center justify-between gap-2`}>
              <span className="min-w-0"><span className="block text-sm font-semibold text-[#26352D] truncate">{it.name}</span>
                <span className="block text-xs text-[#68756D]">{ready ? `Tax ${it.map.tax_code}` : 'Codes not set'}</span></span>
              <span className={`text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap ${tone}`}>{label}</span>
            </button>
          );
        })}
      </div>

      {edit && (
        <Sheet title={edit.name} onClose={() => setEdit(null)}>
          <p className="text-xs text-[#68756D] mb-3">Pick each code from KRA's own list. Then register the item with KRA once.</p>
          {!status?.has_comm_key && <p className="text-xs text-red-700 mb-2">Connect to KRA in Settings first, so the lists are available.</p>}
          <div className="space-y-3">
            {FIELDS.map(([k, label, list]) => <EtimsCodePicker key={k} label={label} list={list} environment={status?.environment || 'sandbox'} value={codes[k]} onChange={(v) => setCodes({ ...codes, [k]: v })} />)}
            {edit.map?.registration_error && <p className="text-xs text-red-700">{edit.map.registration_error}</p>}
            <div className="flex gap-2 pt-1">
              <button className={`${btn} border border-[#DDE3DD]`} disabled={!!busy} onClick={() => save(false)}>Save codes</button>
              <button className={`${btn} bg-[#237A52] text-white`} disabled={!!busy || !FIELDS.every(([k]) => codes[k])} onClick={() => save(true)}>{busy === 'item' ? 'Working…' : 'Save and register'}</button>
            </div>
          </div>
        </Sheet>
      )}
    </WorkspacePage>
  );
}
