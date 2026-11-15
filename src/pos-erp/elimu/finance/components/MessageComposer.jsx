// Review-and-edit-before-sending, for any finance notice. Uses the POS comm engine for everything except the finance wording.
// HONESTY: "Prepare" only saves a QUEUED row. "Open in WhatsApp/SMS/email" records OPENED. Only "I sent it" (or a provider) marks SENT.
// Nothing here ever says "delivered" - that word is the provider's, via describeStatus().
import React, { useMemo, useState } from 'react';
import { MessageSquare, Phone, X } from 'lucide-react';
import { commEngineService } from '../../../services/commEngineService';
import { posSupabase as supabase } from '../../../services/posSupabaseClient';
import { composeFinanceMessage, prepareRecord, statusLabel } from '../../communication/finance/financeComm';
import { FINANCE_PURPOSE_BY_KEY } from '../../communication/templates/financeTemplates';
import { Notice, inputCls, saveBtnCls, formCard, Pill } from '../../../components/CardKit';

export default function MessageComposer({ ctx, purpose, vars, contact, reference, studentId, templates = [], onClose, onDone }) {
  const [channel, setChannel] = useState(contact?.phone ? 'SMS' : contact?.email ? 'EMAIL' : 'SMS');
  const composed = useMemo(() => composeFinanceMessage({ purpose, channel, vars, contact, templates }), [purpose, channel, vars, contact, templates]);
  const [edit, setEdit] = useState({ key: '', body: null, subject: null });
  const key = `${purpose}|${channel}`;
  const body = edit.key === key && edit.body !== null ? edit.body : composed.body;
  const subject = edit.key === key && edit.subject !== null ? edit.subject : composed.subject;
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null); const [row, setRow] = useState(null);
  const P = FINANCE_PURPOSE_BY_KEY[purpose];

  const prepare = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await prepareRecord({ supabase, comm: commEngineService, tenantId: ctx.tenantId, businessId: ctx.businessId, userId: ctx.staffId, studentId, composed,
        final: { body, subject, to: composed.to, recipientName: vars.guardian_name }, reference });
      if (r.duplicate) setMsg({ tone: 'warn', text: 'This notice was already prepared for this guardian. Open the message history to resend it deliberately.' });
      else { setRow(r.log); onDone?.(r.log); }
    } catch (e) { setMsg({ tone: 'bad', text: e.message }); } finally { setBusy(false); }
  };
  const open = async () => {
    const url = commEngineService.deepLink(channel, { to: composed.to, subject, body });
    if (!url) return setMsg({ tone: 'bad', text: 'No contact for this channel.' });
    window.open(url, '_blank'); setRow(await commEngineService.setStatus(row.id, 'OPENED'));
  };
  const markSent = async () => setRow(await commEngineService.setStatus(row.id, 'SENT'));
  const viaProvider = async () => {
    setBusy(true); const r = await commEngineService.sendViaProvider(row.id); setBusy(false);
    setMsg(r.ok ? { tone: 'good', text: 'Handed to the message provider. Delivery shows below once the provider reports it.' } : { tone: 'bad', text: r.message || 'Could not send. You can still open it on this phone.' });
  };

  return (
    <div className={formCard}>
      <div className="flex items-center justify-between mb-2"><div className="font-semibold">{P?.label}</div>{onClose && <button onClick={onClose} aria-label="Close"><X size={18} /></button>}</div>
      <div className="flex gap-2 mb-2">{['SMS', 'WHATSAPP', 'EMAIL'].map(c => (
        <button key={c} disabled={!!row} onClick={() => setChannel(c)} className={`px-3 py-1 rounded-full text-sm border ${channel === c ? 'bg-[#1F6B45] text-white' : 'bg-white'}`}>{c === 'WHATSAPP' ? 'WhatsApp' : c === 'SMS' ? 'SMS' : 'Email'}</button>))}</div>
      <div className="text-xs mb-1">To: <b>{composed.to || 'no valid contact'}</b> {contact?.phone && channel !== 'EMAIL' && <a href={`tel:${contact.phone}`} className="ml-2 underline"><Phone size={12} className="inline" /> Call</a>}</div>
      {composed.problems.map(p => <Notice key={p} tone="warn">{p}</Notice>)}
      {channel === 'EMAIL' && <input className={inputCls + ' mb-2'} disabled={!!row} value={subject || ''} onChange={e => setEdit({ key, body: edit.key === key ? edit.body : null, subject: e.target.value })} aria-label="Subject" />}
      <textarea className={inputCls + ' min-h-[140px]'} disabled={!!row} value={body} onChange={e => setEdit({ key, body: e.target.value, subject: edit.key === key ? edit.subject : null })} aria-label="Message" />
      {composed.sms && channel === 'SMS' && <div className="text-xs text-[#68756D] mt-1">{composed.sms.length} characters, {composed.sms.segments} SMS</div>}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {!row ? (
        <button className={saveBtnCls + ' mt-2 w-full'} disabled={busy || !composed.to || composed.missing.length > 0} onClick={prepare}><MessageSquare size={16} className="inline mr-1" />Prepare message</button>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="text-sm">Status: <Pill>{statusLabel(row)?.label || row.status}</Pill></div>
          <div className="flex gap-2 flex-wrap">
            <button className={saveBtnCls} onClick={open}>Open on this phone</button>
            <button className={saveBtnCls} disabled={busy} onClick={viaProvider}>Send via provider</button>
            {row.status === 'OPENED' && <button className="border rounded-lg px-3 min-h-[42px]" onClick={markSent}>I sent it</button>}
          </div>
        </div>)}
    </div>
  );
}
