// components/MessageComposer.jsx
//
// THE one place a message is written and sent from. Owner flow: purpose -> channel -> preview -> (edit) -> Send.
//   <MessageComposer recipient={{kind:'CUSTOMER', id}} purpose="PAYMENT_REMINDER" reference={{type:'SALE', id}} onClose={...} />
// Everything known (name, amounts, dates, items) is filled from the records. Nothing is sent until the user presses a
// send button. Edits apply to this message only; the saved template is never changed here.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Send, AlertTriangle, Info, WifiOff, Check } from 'lucide-react';
import Sheet, { fieldClass } from './workspace/Sheet';
import { Notice } from './CardKit';
import { useOnline } from './network/networkKit';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { commEngineService } from '../services/commEngineService';
import { PURPOSES, CHANNELS, CHANNEL_LABEL, checkFinal, smsInfo } from '../utils/comm';

const CHANNEL_HINT = { SMS: 'Text message', WHATSAPP: 'WhatsApp', EMAIL: 'Email' };

export default function MessageComposer({ recipient, purpose: initialPurpose, channel: initialChannel, reference, inputs, onClose, onDone, onRecorded }) {
  const { tenant, staffId } = usePosErpAuth();
  const online = useOnline();
  const kind = recipient?.kind || 'CUSTOMER';
  const options = useMemo(() => PURPOSES.filter((p) => !p.variantOf && (p.audience === kind || (kind === 'STAFF' && p.audience === 'BUSINESS') || (kind === 'OWNER' && p.audience === 'BUSINESS'))), [kind]);
  const [purpose, setPurpose] = useState(initialPurpose || options[0]?.key);
  const [channel, setChannel] = useState(initialChannel || 'WHATSAPP');
  const [composed, setComposed] = useState(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(null);      // the recorded log row after a send/open
  const [info, setInfo] = useState('');

  const load = useCallback(async () => {
    if (!tenant?.id || !purpose) return;
    setBusy(true); setError(''); setSaved(null); setInfo('');
    try {
      const c = await commEngineService.prepare({ tenantId: tenant.id, businessId: tenant.business_id, purpose, channel, recipient, reference, inputs });
      setComposed(c); setSubject(c.subject || ''); setBody(c.body || '');
    } catch (e) {
      console.error('[MessageComposer] prepare failed', e);
      const why = e?.message || e?.details || '';
      const missing = /does not exist|schema cache|PGRST20|42703|42P01|42883/i.test(`${why} ${e?.code || ''}`);
      setComposed(null);
      setError(!online ? 'You are offline. Messages are prepared from live records, so reconnect to prepare one.'
        : missing ? 'Messaging is not fully set up on the database yet (the phase 50 update has not been applied). Ask your administrator to run it.'
        : `We could not prepare this message${why ? `: ${why}` : ''}. Please try again.`);
    } finally { setBusy(false); }
  }, [tenant, purpose, channel, recipient, reference, inputs, online]);
  useEffect(() => { load(); }, [load]);

  const to = composed?.to || null;
  const check = useMemo(() => (composed ? checkFinal({ channel, subject, body, to }) : { ok: false, blocking: [], warnings: [] }), [composed, channel, subject, body, to]);
  const blocking = [...(composed?.blocking || []), ...check.blocking.filter((b) => !(composed?.blocking || []).some((x) => x.code === b.code))];
  const warnings = [...(composed?.warnings || []), ...check.warnings];
  const sms = channel === 'SMS' ? smsInfo(body) : null;
  const canSend = !!composed && blocking.length === 0 && !busy && !saved;
  const edited = composed && (body !== composed.body || subject !== (composed.subject || ''));

  const record = async () => {
    const row = await commEngineService.record({ tenantId: tenant.id, businessId: tenant.business_id, userId: staffId, composed, final: { subject, body, to }, channel });
    try { onRecorded?.(row); } catch { /* caller bookkeeping must never block sending */ }
    return row;
  };

  const openOnPhone = async (row0) => {
    const url = commEngineService.deepLink(channel, { to, subject, body });
    if (!url) { setError('This person has no usable number or address for that channel.'); return; }
    // Record first, but a failure to record must never stop the owner from sending. Navigate with the page itself,
    // because phones block window.open() once an await has happened.
    let row = row0 || null;
    if (!row) { try { row = await record(); } catch (e) { console.error('[MessageComposer] could not record message', e); } }
    try { if (row) setSaved(await commEngineService.setStatus(row.id, 'OPENED')); else setInfo('Opened. This message could not be saved to history.'); } catch { /* history is secondary */ }
    if (channel === 'WHATSAPP') { const w = window.open(url, '_blank', 'noopener'); if (!w) window.location.href = url; }
    else window.location.href = url;
  };
  // ONE Send button. WhatsApp opens WhatsApp with the message ready. SMS and Email go out through the business's sending
  // service when one is set up, otherwise they open the phone's messages / email app with the message ready.
  const send = async () => {
    setBusy(true); setError(''); setInfo('');
    try {
      if (channel === 'WHATSAPP') { await openOnPhone(); return; }
      let row = null;
      try { row = await record(); } catch (e) { console.error('[MessageComposer] could not record message', e); }
      if (row) {
        const r = await commEngineService.sendViaProvider(row.id);
        if (r.ok) { setSaved({ ...row, status: 'SUBMITTED' }); setInfo('Handed to the sending service. Delivery will show here once it is confirmed.'); onDone?.(); return; }
        if (r.code !== 'PROVIDER_NOT_CONFIGURED' && r.code !== 'OFFLINE') { setSaved(row); setError(r.message || 'Not sent.'); return; }
      }
      await openOnPhone(row);
    } finally { setBusy(false); }
  };
  const mark = async (status) => {
    setBusy(true);
    try { const row = await commEngineService.setStatus(saved.id, status); setSaved(row); if (status === 'SENT') onDone?.(); } catch { setError('Could not update this message.'); } finally { setBusy(false); }
  };

  return (
    <Sheet title={`Message ${recipient?.name || composed?.recipientRecord?.name || ''}`.trim()} onClose={onClose}>
      <div className="space-y-3">
        {!online && <Notice tone="warn"><WifiOff size={14} className="inline mr-1" />You are offline. You can still call; messages need a connection to prepare and record.</Notice>}

        <div>
          <label className="text-xs font-semibold text-[#6F7461]">What is this message about?</label>
          <select className={fieldClass} value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            {[...new Set(options.map((o) => o.group))].map((g) => (
              <optgroup key={g} label={g}>{options.filter((o) => o.group === g).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</optgroup>
            ))}
          </select>
        </div>

        <div className="flex gap-2" role="tablist">
          {CHANNELS.map((c) => (
            <button key={c} role="tab" aria-selected={channel === c} onClick={() => setChannel(c)}
              className={`flex-1 min-h-[44px] rounded-xl text-sm font-semibold border ${channel === c ? 'bg-[#1F6B45] text-white border-[#C9A227]' : 'bg-white text-[#23382B] border-[#E3DBB8]'}`}>
              {CHANNEL_HINT[c] || CHANNEL_LABEL[c]}
            </button>
          ))}
        </div>

        {composed?.switchedNote && <Notice tone="info"><Info size={14} className="inline mr-1" />{composed.switchedNote}</Notice>}
        {blocking.map((b) => <Notice key={b.code} tone="bad"><AlertTriangle size={14} className="inline mr-1" />{b.message}</Notice>)}
        {error && <Notice tone="bad">{error}</Notice>}

        {composed && (composed.details || []).length > 0 && (
          <div className="rounded-xl bg-[#FAF7E8] border border-[#E3DBB8] p-2.5 text-xs text-[#4A5240] grid grid-cols-2 gap-x-3 gap-y-1">
            <div><span className="text-[#8A8A70]">To </span>{composed.recipientRecord?.name}{to ? ` · ${to}` : ''}</div>
            {composed.details.map((d, i) => <div key={i}><span className="text-[#8A8A70]">{d.label} </span>{d.value}</div>)}
          </div>
        )}

        {composed && !blocking.some((b) => ['CLEARED', 'ALL_RECEIVED', 'PO_CLOSED', 'APPT_CANCELLED', 'APPT_PASSED', 'APPT_CLOSED', 'NO_BALANCE', 'NO_LOW_STOCK', 'SALE_VOIDED', 'NOT_CANCELLED', 'MISSING_INPUT', 'NO_EXPECTED_DATE', 'PO_NOT_APPROVED'].includes(b.code)) && (
          <>
            {channel === 'EMAIL' && (<div><label className="text-xs font-semibold text-[#6F7461]">Subject</label><input className={fieldClass} value={subject} onChange={(e) => setSubject(e.target.value)} /></div>)}
            <div>
              <label className="text-xs font-semibold text-[#6F7461]">Message {edited && <span className="font-normal text-[#8A6A12]">(edited for this message only)</span>}</label>
              <textarea className={`${fieldClass} py-2 leading-relaxed whitespace-pre-wrap`} rows={channel === 'SMS' ? 6 : 11} value={body} onChange={(e) => setBody(e.target.value)} />
              {sms && <div className="text-xs text-[#6F7461] mt-1">{sms.length} characters · {sms.segments} text message{sms.segments === 1 ? '' : 's'}{sms.unicode ? ' · special characters make each part shorter' : ''}</div>}
            </div>
            {warnings.map((w) => <div key={w.code} className="text-xs text-[#7A5A0E]"><AlertTriangle size={12} className="inline mr-1" />{w.message}</div>)}
            {edited && <button className="text-xs underline text-[#1F6B45]" onClick={() => { setSubject(composed.subject || ''); setBody(composed.body); }}>Undo my changes</button>}
          </>
        )}

        {info && <Notice tone="info">{info}</Notice>}

        {saved ? (
          <div className="rounded-xl border border-[#E3DBB8] p-3 text-sm space-y-2">
            <div className="font-semibold text-[#23382B]"><Check size={14} className="inline mr-1 text-[#1F6B45]" />
              {saved.status === 'OPENED' ? 'Opened on this phone. We cannot see whether you pressed Send.' : saved.status === 'SENT' ? 'Marked as sent by you.' : saved.status === 'SUBMITTED' ? 'Handed to the sending service.' : 'Saved as prepared.'}
            </div>
            {saved.status === 'OPENED' && (<div className="flex gap-2">
              <button disabled={busy} onClick={() => mark('SENT')} className="flex-1 min-h-[44px] rounded-xl bg-[#1F6B45] text-white font-semibold">I sent it</button>
              <button disabled={busy} onClick={() => mark('QUEUED')} className="flex-1 min-h-[44px] rounded-xl border border-[#E3DBB8]">Not sent</button>
            </div>)}
            <button onClick={onClose} className="w-full min-h-[44px] rounded-xl border border-[#E3DBB8]">Close</button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <button disabled={!canSend} onClick={send} className="w-full min-h-[48px] rounded-xl bg-[#1F6B45] text-white font-semibold border-b-2 border-[#C9A227] disabled:opacity-50 flex items-center justify-center gap-2"><Send size={16} />{busy ? 'Opening…' : `Send ${channel === 'WHATSAPP' ? 'on WhatsApp' : channel === 'SMS' ? 'as text message' : 'by email'}`}</button>
            <p className="text-[11px] text-[#8A8A70] text-center">Nothing is sent until you press Send.</p>
          </div>
        )}
      </div>
    </Sheet>
  );
}
