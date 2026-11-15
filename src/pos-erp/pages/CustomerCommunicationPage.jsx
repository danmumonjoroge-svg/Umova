// src/pos-erp/pages/CustomerCommunicationPage.jsx
//
// Messages hub (phase 50). Replaces the old single-purpose Messages screen; the same route (/pos/messages).
//   To send   messages My Business prepared for you (due payments, deliveries, appointments...). Review, edit, send.
//   History   every message with an honest status: Prepared, Opened, Handed to sender, Sent, Delivered, Read, Failed.
//   Wording   the business's own templates.      Settings   greeting, timing and what gets prepared.
// New messages are started from the record itself (customer, supplier, order, appointment) via ContactActions, or "New message" here.
// Internal alerts live in Notifications (CommunicationPage), not here.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, RefreshCw } from 'lucide-react';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { useCustomers } from '../hooks/useCustomers';
import { useSuppliers } from '../hooks/useSuppliers';
import { commEngineService } from '../services/commEngineService';
import { PURPOSE_BY_KEY, CHANNEL_LABEL, describeStatus, manualActions } from '../utils/comm';
import MessageComposer from '../components/MessageComposer';
import TemplateEditor from '../components/comm/TemplateEditor';
import CommSettings from '../components/comm/CommSettings';
import Sheet, { fieldClass } from '../components/workspace/Sheet';

const TABS = [['send', 'To send'], ['history', 'History'], ['wording', 'Wording'], ['settings', 'Settings']];
const TONE = { good: 'bg-emerald-50 text-emerald-700', warn: 'bg-amber-50 text-amber-700', bad: 'bg-red-50 text-red-700', neutral: 'bg-slate-100 text-slate-600', info: 'bg-sky-50 text-sky-700' };
const when = (t) => (t ? new Date(t).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');

export default function CustomerCommunicationPage() {
  const { tenant, isAdmin } = usePosErpAuth();
  const { customers } = useCustomers();
  const { suppliers } = useSuppliers();
  const [tab, setTab] = useState('send');
  const [jobs, setJobs] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [composer, setComposer] = useState(null); // { recipient, purpose, channel, reference, jobId }
  const [picker, setPicker] = useState(false);
  const [q, setQ] = useState('');

  const names = useMemo(() => ({ ...Object.fromEntries((customers || []).map((c) => [c.id, c.name])), ...Object.fromEntries((suppliers || []).map((s) => [s.id, s.name])) }), [customers, suppliers]);

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true); setError('');
    try {
      const [j, h] = await Promise.all([commEngineService.toSend({ tenantId: tenant.id, businessId: tenant.business_id }), commEngineService.history({ tenantId: tenant.id, businessId: tenant.business_id })]);
      setJobs(j); setHistory(h);
    } catch { setError('Could not load messages. Check your connection.'); }
    finally { setLoading(false); }
  }, [tenant]);
  useEffect(() => { load(); }, [load]);

  const act = async (row, status) => { try { await commEngineService.setStatus(row.id, status); load(); } catch { setError('Could not update that message.'); } };
  const retry = async (row) => { const r = await commEngineService.sendViaProvider(row.id); if (!r.ok) setError(r.message || 'Not sent.'); load(); };

  const people = [...(customers || []).map((c) => ({ ...c, kind: 'CUSTOMER' })), ...(suppliers || []).map((s) => ({ ...s, kind: 'SUPPLIER' }))].filter((p) => !q || p.name?.toLowerCase().includes(q.toLowerCase())).slice(0, 30);

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-2xl font-bold text-[#23382B]">Messages</h1>
        <div className="flex gap-2">
          <button onClick={load} className="w-10 h-10 rounded-full border border-[#E3DBB8] flex items-center justify-center" aria-label="Refresh">{loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}</button>
          <button onClick={() => setPicker(true)} className="min-h-[40px] px-4 rounded-full bg-[#1F6B45] text-white text-sm font-semibold border-b-2 border-[#C9A227] flex items-center gap-1"><Plus size={16} />New message</button>
        </div>
      </div>
      <div className="flex gap-1 mb-4 overflow-x-auto" role="tablist">
        {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-4 min-h-[40px] rounded-full text-sm font-semibold whitespace-nowrap border ${tab === k ? 'bg-[#1F6B45] text-white border-[#C9A227]' : 'bg-white border-[#E3DBB8] text-[#23382B]'}`}>{label}{k === 'send' && jobs.length ? ` (${jobs.length})` : ''}</button>)}
      </div>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3 mb-3">{error}</div>}

      {tab === 'send' && (
        <div className="space-y-2">
          {!loading && jobs.length === 0 && <div className="text-center text-[#8A8A70] py-10">Nothing waiting. When a payment is due or a delivery is late, a ready message appears here.</div>}
          {jobs.map((j) => (
            <div key={j.id} className="bg-white border border-[#E3DBB8] rounded-2xl p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[#23382B] truncate">{names[j.customer_id || j.supplier_id] || 'Recipient'}</div>
                <div className="text-xs text-[#6F7461]">{PURPOSE_BY_KEY[j.purpose]?.label || j.purpose} · {CHANNEL_LABEL[j.channel] || j.channel}</div>
              </div>
              <button onClick={() => commEngineService.dismissJob(j.id).then(load)} className="text-xs text-[#8A8A70] underline">Dismiss</button>
              <button onClick={() => setComposer({ recipient: { kind: j.recipient_kind, id: j.customer_id || j.supplier_id, name: names[j.customer_id || j.supplier_id] }, purpose: j.purpose, channel: j.channel, reference: j.reference_id ? { type: j.reference_type, id: j.reference_id } : undefined, jobId: j.id })} className="min-h-[40px] px-4 rounded-xl bg-[#1F6B45] text-white text-sm font-semibold">Review</button>
            </div>
          ))}
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-2">
          {!loading && history.length === 0 && <div className="text-center text-[#8A8A70] py-10">No messages yet.</div>}
          {history.map((h) => {
            const st = describeStatus(h); const acts = manualActions(h);
            return (
              <div key={h.id} className="bg-white border border-[#E3DBB8] rounded-2xl p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-[#23382B] truncate">{h.recipient_name || names[h.customer_id || h.supplier_id] || h.recipient}</div>
                  <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${TONE[st.tone] || TONE.neutral}`}>{st.label}</span>
                </div>
                <div className="text-xs text-[#6F7461]">{PURPOSE_BY_KEY[h.purpose]?.label || h.message_type} · {CHANNEL_LABEL[h.channel]} · {when(h.created_at)}{h.was_edited ? ' · edited' : ''}</div>
                <p className="text-sm text-[#4A5240] mt-1 whitespace-pre-wrap line-clamp-3">{h.rendered_message}</p>
                {(h.failure_reason || st.note) && <p className="text-xs text-[#8F2E24] mt-1">{h.failure_reason || st.note}</p>}
                <div className="flex gap-3 mt-2">
                  {acts.includes('MARK_SENT') && <button onClick={() => act(h, 'SENT')} className="text-xs font-semibold text-[#1F6B45] underline">I sent it</button>}
                  {acts.includes('MARK_NOT_SENT') && h.status === 'OPENED' && <button onClick={() => act(h, 'QUEUED')} className="text-xs underline text-[#6F7461]">Not sent</button>}
                  {h.status === 'FAILED' && <button onClick={() => retry(h)} className="text-xs font-semibold text-[#1F6B45] underline">Try again</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'wording' && <TemplateEditor canEdit={isAdmin} />}
      {tab === 'settings' && <CommSettings canEdit={isAdmin} />}

      {picker && (
        <Sheet title="Who is it for?" onClose={() => setPicker(false)}>
          <input className={fieldClass} placeholder="Search customers and suppliers" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="mt-2 divide-y divide-[#EFE8C8]">
            {people.map((p) => (
              <button key={`${p.kind}${p.id}`} className="w-full text-left py-3 flex justify-between" onClick={() => { setPicker(false); setComposer({ recipient: { kind: p.kind, id: p.id, name: p.name, phone: p.phone, email: p.email } }); }}>
                <span className="font-medium text-[#23382B]">{p.name}</span><span className="text-xs text-[#8A8A70]">{p.kind === 'SUPPLIER' ? 'Supplier' : 'Customer'}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {composer && <MessageComposer {...composer} onRecorded={(row) => { if (composer.jobId) commEngineService.completeJob(composer.jobId, row.id).catch(() => {}); }} onClose={() => { setComposer(null); load(); }} />}
    </div>
  );
}
