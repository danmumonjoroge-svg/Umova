// ElimuMessageComposer — reusable. Opens for one guardian + one purpose; the person picks a channel, reviews/edits the generated text and
// decides. It NEVER sends silently: every route is an explicit tap, and every status shown is exactly what is known.
import React, { useEffect, useMemo, useState } from 'react';
import { Sheet, fieldClass, saveBtnCls, Notice, useSchool } from '../services/platform.js';
import { communicationService } from '../communication/ElimuCommunicationService.js';
import { PURPOSES, getPurpose } from '../communication/purposes.js';
import { channelsFor } from '../communication/consent.js';
import { useOnline } from '../hooks/useAsync.js';
import { friendlyError } from '../utils/validation.js';

const LABEL = { SMS: 'SMS', WHATSAPP: 'WhatsApp', EMAIL: 'Email' };

export default function ElimuMessageComposer({ guardian, student, application, klass, purpose: initialPurpose = 'ELIMU_GENERAL_NOTICE', channel: initialChannel, extra, settings, overrides = [], onClose, onRecorded }) {
  const { tenantId, schoolName } = useSchool();
  const online = useOnline();
  const [purpose, setPurpose] = useState(initialPurpose);
  const options = useMemo(() => channelsFor({ guardian, purpose, settings }).filter((c) => c.channel !== 'CALL'), [guardian, purpose, settings]);
  const [channel, setChannel] = useState(initialChannel && initialChannel !== 'CALL' ? initialChannel : (options.find((o) => o.ok)?.channel || 'SMS'));
  const [extraVals, setExtraVals] = useState(extra || {});
  const prepared = useMemo(() => communicationService.prepare({ purpose, channel, guardian, student, application, klass, school: { name: schoolName }, extra: extraVals, overrides, settings }), [purpose, channel, guardian, student, application, klass, schoolName, extraVals, overrides, settings]);
  const [subject, setSubject] = useState(prepared.subject || '');
  const [body, setBody] = useState(prepared.body);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);       // { tone, text }
  const [logId, setLogId] = useState(null);   // set once handed off, to offer "I sent it"
  // When the purpose/channel/fields change, regenerate the text (the person's edits for the previous setup are intentionally replaced).
  useEffect(() => { setSubject(prepared.subject || ''); setBody(prepared.body); setLogId(null); setMsg(null); }, [prepared.generated, prepared.generatedSubject, channel]); // eslint-disable-line
  const edited = body !== prepared.generated || (subject || '') !== (prepared.generatedSubject || '');
  const needsExtra = (getPurpose(purpose)?.fields || []).filter((f) => ['message', 'event_name', 'event_date', 'meeting_date', 'amount', 'due_date', 'reply_by', 'outcome', 'date', 'term_name'].includes(f));
  const common = { channel, purpose, guardianId: guardian.id, contactId: prepared.contactId, studentId: student?.id, applicationId: application?.id, subject, body, generated: prepared.generated, templateId: prepared.templateId, templateSource: prepared.source, tenantId, referenceLabel: student ? `${student.first_name} ${student.last_name}` : null };

  const run = async (fn) => { setBusy(true); setMsg(null); try { await fn(); } catch (e) { setMsg({ tone: 'bad', text: friendlyError(e) }); } finally { setBusy(false); } };
  const saveOnly = () => run(async () => { const r = await communicationService.record({ ...common, status: 'QUEUED' }); if (r.offline) return setMsg({ tone: 'warn', text: r.message }); setLogId(r.logId); setMsg({ tone: 'good', text: 'Saved as prepared. It has not been sent.' }); onRecorded?.(r); });
  const openApp = () => run(async () => {
    const r = await communicationService.handOff({ ...common, recipient: prepared.recipient });
    if (r.offline) return setMsg({ tone: 'warn', text: r.message });
    setLogId(r.logId); onRecorded?.(r);
    setMsg({ tone: 'good', text: `Opened ${LABEL[channel]} on this device. Send it there, then tap “I sent it”.` });
    window.location.href = r.url;
  });
  const provider = () => run(async () => {
    const r = await communicationService.record({ ...common, status: 'QUEUED' });
    if (r.offline) return setMsg({ tone: 'warn', text: r.message });
    setLogId(r.logId);
    const s = await communicationService.sendViaProvider(r.logId);
    setMsg(s.ok ? { tone: 'good', text: 'Handed to the sending service. Delivery will update when the provider confirms.' } : { tone: 'warn', text: `${s.message} You can open it on your phone instead.` });
    onRecorded?.(r);
  });
  const sentByHand = () => run(async () => { await communicationService.confirmSentByHand(logId); setMsg({ tone: 'good', text: 'Marked as sent by you.' }); setLogId(null); });

  return (
    <Sheet title="Message guardian" onClose={onClose}>
      <p className="text-sm text-slate-600 mb-3">To <b>{guardian.first_name} {guardian.last_name}</b>{student ? <> about <b>{student.preferred_name || student.first_name}</b></> : null}</p>
      <label className="block text-xs font-medium text-slate-600 mb-1">Reason</label>
      <select className={`${fieldClass} mb-3`} value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-label="Reason for the message">
        {PURPOSES().map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
      </select>
      <div className="flex gap-2 mb-3" role="tablist" aria-label="Channel">
        {options.map((o) => (
          <button key={o.channel} type="button" role="tab" aria-selected={channel === o.channel} onClick={() => setChannel(o.channel)} disabled={!o.ok && !o.contact}
            className={`flex-1 min-h-[44px] rounded-xl border text-sm font-medium ${channel === o.channel ? 'bg-[#1F6B45] text-white border-[#1F6B45]' : 'bg-white border-[#E3DBB8] text-[#23382B]'} ${o.ok ? '' : 'opacity-50'}`}>{LABEL[o.channel]}</button>
        ))}
      </div>
      {!prepared.eligible && <Notice tone="warn">{prepared.reason}</Notice>}
      {prepared.override && <Notice tone="warn">{prepared.reason}</Notice>}
      {needsExtra.map((f) => (
        <div key={f} className="mb-2"><label className="block text-xs text-slate-600 mb-1">{f.replace(/_/g, ' ')}</label>
          <input className={fieldClass} value={extraVals[f] || ''} onChange={(e) => setExtraVals({ ...extraVals, [f]: e.target.value })} /></div>
      ))}
      {channel === 'EMAIL' && (<><label className="block text-xs font-medium text-slate-600 mb-1">Subject</label><input className={`${fieldClass} mb-3`} value={subject} onChange={(e) => setSubject(e.target.value)} /></>)}
      <label className="block text-xs font-medium text-slate-600 mb-1">Message (you can edit it)</label>
      <textarea className={`${fieldClass} py-2 mb-1`} rows={channel === 'EMAIL' ? 9 : 6} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="text-[11px] text-slate-400 mb-3 flex justify-between"><span>{prepared.source === 'BUSINESS' ? 'School template' : 'Standard template'}{edited ? ' · edited' : ''}</span>{channel === 'SMS' && <span>{body.length} characters · {Math.max(1, Math.ceil(body.length / 160))} SMS</span>}</div>
      {prepared.missing.length > 0 && <Notice tone="warn">Still empty: {prepared.missing.map((m) => m.replace(/_/g, ' ')).join(', ')}. Check the text before sending.</Notice>}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {!online && <Notice tone="warn">No internet. Saving keeps a draft on this device. Nothing is sent.</Notice>}
      <div className="grid gap-2 mt-2">
        <button type="button" className={`${saveBtnCls} px-4`} disabled={busy || !prepared.eligible || !body.trim() || (channel === 'EMAIL' && !subject.trim())} onClick={openApp}>Open in {LABEL[channel]}</button>
        <button type="button" className="min-h-[44px] rounded-xl border border-[#E3DBB8] bg-white text-sm font-medium disabled:opacity-50" disabled={busy || !prepared.eligible || !body.trim()} onClick={provider}>Send through the school’s sending service</button>
        <button type="button" className="min-h-[44px] rounded-xl border border-[#E3DBB8] bg-white text-sm font-medium disabled:opacity-50" disabled={busy || !prepared.eligible || !body.trim()} onClick={saveOnly}>Save without sending</button>
        {logId && <button type="button" className="min-h-[44px] rounded-xl bg-[#E8F1EA] text-[#1F6B45] text-sm font-semibold" disabled={busy} onClick={sentByHand}>I sent it</button>}
      </div>
    </Sheet>
  );
}
