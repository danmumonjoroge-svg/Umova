// elimu/communication/components/GuardianMessageSheet.jsx -- review & edit a guardian message, then Call / SMS / WhatsApp / Email.
// The message is generated from a template but ALWAYS editable. Nothing is sent without the person pressing a button, and a
// message is shown as "Prepared" / "Opened" until the person confirms they sent it. Never "Delivered" unless the provider says so.
import React, { useEffect, useMemo, useState } from 'react';
import { Phone, MessageSquare, MessageCircle, Mail } from 'lucide-react';
import { Sheet, btn, btnPrimary, inputCls, Notice, Pill, Field, fieldClass } from '../../shared/components/kit';
import { useElimu } from '../../shared/hooks/ElimuContext';
import { foundationService } from '../../shared/services/foundationService';
import { guardianComms } from '../attendance/guardianComms';
import { pickGuardians, availableChannels } from '../attendance/contactPlan';
import { ATTENDANCE_TEMPLATES, PURPOSE_LABELS } from '../templates/attendanceTemplates';
import { absenceService } from '../../attendance/services/absenceService';

const CH = { SMS: ['SMS', MessageSquare], WHATSAPP: ['WhatsApp', MessageCircle], EMAIL: ['Email', Mail], CALL: ['Call', Phone] };
const TONE = { QUEUED: 'warn', OPENED: 'info', SENT: 'good', SUBMITTED: 'info', DELIVERED: 'good', READ: 'good', FAILED: 'bad', CANCELLED: 'neutral' };
const STATUS_TEXT = { QUEUED: 'Prepared (not sent)', OPENED: 'Opened in your app (not confirmed sent)', SENT: 'Sent', SUBMITTED: 'Handed to provider', DELIVERED: 'Delivered', READ: 'Read', FAILED: 'Failed', CANCELLED: 'Cancelled' };

export default function GuardianMessageSheet({ record, purpose: initialPurpose = 'ABSENT', followupId = null, settings = {}, classInfo, onClose, onChanged }) {
  const { tenantId, businessId, userId, schoolName } = useElimu();
  const [guardians, setGuardians] = useState(null); const [purpose, setPurpose] = useState(initialPurpose);
  const [gi, setGi] = useState(0); const [channel, setChannel] = useState(null); const [body, setBody] = useState(''); const [subject, setSubject] = useState('');
  const [history, setHistory] = useState([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null); const [info, setInfo] = useState(null); const [log, setLog] = useState(null);
  const rid = record.id || record.record_id;

  useEffect(() => { (async () => { const g = await foundationService.guardians(record.student_id); setGuardians(g.connected ? pickGuardians(g.rows) : []); })().catch((e) => setErr(e.message)); }, [record.student_id]);
  useEffect(() => { absenceService.contactHistory(rid).then(setHistory).catch(() => {}); }, [rid, log]);
  const g = guardians?.[gi];
  const channels = useMemo(() => (g ? availableChannels(g, settings.guardian_channels) : []), [g, settings.guardian_channels]);
  useEffect(() => { if (channels.length && (!channel || !channels.includes(channel))) setChannel(channels[0]); }, [channels, channel]);
  const draft = useMemo(() => (g && channel ? guardianComms.draft({ purpose, channel, record, guardian: g, schoolName, classInfo }) : null), [g, channel, purpose, record, schoolName, classInfo]);
  useEffect(() => { if (draft) { setBody(draft.body); setSubject(draft.subject || ''); setLog(null); setInfo(null); } }, [draft?.body, draft?.subject]); // eslint-disable-line

  const prepare = async (resend = false) => {
    setBusy(true); setErr(null);
    try {
      const r = await guardianComms.record({ tenantId, businessId, userId, record, guardian: g, purpose, channel, draft, final: { body, subject, to: draft.to }, resend });
      if (r.status === 'DUPLICATE') { setInfo('This message was already prepared for this guardian. Use "Prepare again" only if you really need to resend.'); return null; }
      if (r.status === 'QUEUED_OFFLINE') { setInfo('You are offline. The message is saved on this phone and will be recorded when the connection returns. It has NOT been sent.'); return null; }
      setLog(r.log); onChanged?.(); return r.log;
    } catch (e) { setErr(e.message); return null; } finally { setBusy(false); }
  };
  const open = async () => { const l = log || await prepare(); if (!l) return; try { await guardianComms.openOnPhone(l, { to: draft.to, subject, body }); setLog({ ...l, status: 'OPENED' }); setInfo('Opened in your phone app. Press Send there, then tap "I sent it".'); } catch (e) { setErr(e.message); } };
  const confirm = async () => { setBusy(true); try { const u = await guardianComms.confirmSent(log, followupId); setLog(u); setInfo('Recorded as sent.'); onChanged?.(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const call = async (outcome) => { setBusy(true); try { await guardianComms.logCall({ record, guardian: g, purpose, outcome }); setInfo(`Call recorded: ${outcome.replace('_', ' ').toLowerCase()}.`); setLog(null); onChanged?.(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };

  return (
    <Sheet title={`Contact guardian · ${record.student_name}`} onClose={onClose}>
      {err && <Notice tone="bad">{err}</Notice>}{info && <Notice tone="good">{info}</Notice>}
      {guardians === null && <p className="text-sm text-[#6F7461]">Loading guardians…</p>}
      {guardians && guardians.length === 0 && <Notice tone="gold">No guardian with contact details is linked to this student (or the guardian records are not connected yet).</Notice>}
      {g && (<>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Guardian"><select className={fieldClass} value={gi} onChange={(e) => setGi(Number(e.target.value))}>{guardians.map((x, i) => <option key={x.guardian_id} value={i}>{x.guardian_name}{x.relationship ? ` (${x.relationship})` : ''}</option>)}</select></Field>
          <Field label="About"><select className={fieldClass} value={purpose} onChange={(e) => setPurpose(e.target.value)}>{Object.keys(ATTENDANCE_TEMPLATES).map((k) => <option key={k} value={k}>{PURPOSE_LABELS[k]}</option>)}</select></Field>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-2">{channels.map((c) => { const [label, Icon] = CH[c]; return (<button key={c} onClick={() => setChannel(c)} className={`${btn} !min-h-[40px] flex items-center gap-1.5 ${channel === c ? '!bg-[#E3F1E7] !border-[#1F6B45]' : ''}`}><Icon size={15} />{label}</button>); })}</div>
        {channels.length === 0 && <Notice tone="gold">This guardian has no phone number or email on record.</Notice>}
        {channel && channel !== 'CALL' && draft && (<>
          {channel === 'EMAIL' && <Field label="Subject"><input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>}
          <Field label={`Message to ${draft.to || ''} (you can edit it)`}><textarea className={`${inputCls} min-h-[120px] py-2`} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          {draft.missing.length > 0 && <Notice tone="gold">Missing: {draft.missing.join(', ')}. Fill the ____ gaps before sending.</Notice>}
          {log && <p className="text-xs mb-2"><Pill tone={TONE[log.status]}>{STATUS_TEXT[log.status] || log.status}</Pill></p>}
          <div className="flex gap-2">
            {!log && <button className={`${btn} flex-1`} disabled={busy || !body} onClick={() => prepare()}>Save prepared</button>}
            <button className={`${btnPrimary} flex-1`} disabled={busy || !body || body.includes('____')} onClick={open}>Open {CH[channel][0]}</button>
          </div>
          {log && ['QUEUED', 'OPENED'].includes(log.status) && <button className={`${btn} w-full mt-2`} disabled={busy} onClick={confirm}>I sent it</button>}
          {log && <button className={`${btn} w-full mt-2`} disabled={busy} onClick={() => prepare(true)}>Prepare again (resend)</button>}
        </>)}
        {channel === 'CALL' && (<div><a href={`tel:${g.phone}`} className={`${btnPrimary} flex items-center justify-center mb-2`}>Call {g.phone}</a>
          <p className="text-[11.5px] text-[#6F7461] mb-1">After the call, record what happened:</p>
          <div className="grid grid-cols-2 gap-2">{[['ANSWERED', 'Spoke to guardian'], ['NO_ANSWER', 'No answer'], ['VOICEMAIL', 'Voicemail'], ['WRONG_NUMBER', 'Wrong number']].map(([k, l]) => <button key={k} className={btn} disabled={busy} onClick={() => call(k)}>{l}</button>)}</div></div>)}
      </>)}
      {history.length > 0 && (<div className="mt-4"><h4 className="text-[11.5px] font-bold uppercase tracking-wide text-[#6F7461] mb-1">Contact history</h4>
        {history.map((h) => (<div key={h.id} className="text-[12.5px] border-t border-[#EFE9CD] py-1.5"><div className="flex items-center gap-1.5 flex-wrap"><b>{PURPOSE_LABELS[h.purpose] || h.purpose}</b> · {h.channel} · {h.guardian_name || 'guardian'}
          {h.channel === 'CALL' ? <Pill tone={h.call_outcome === 'ANSWERED' ? 'good' : 'warn'}>{(h.call_outcome || '').replace('_', ' ')}</Pill> : <Pill tone={TONE[h.delivery_status] || 'neutral'}>{h.superseded_at ? 'Replaced' : (STATUS_TEXT[h.delivery_status] || 'Pending')}</Pill>}</div>
          <div className="text-[#6F7461]">{new Date(h.created_at).toLocaleString('en-GB')}{h.failure_reason ? ` · ${h.failure_reason}` : ''}</div></div>))}</div>)}
    </Sheet>
  );
}
