// elimu/communication/academic/AcademicMessageSheet.jsx
// Compose / edit / send one academic message to one guardian. Wording is GENERATED from the reusable templates and stays fully editable.
// Delivery is the POS's existing machinery (outbox row + comm-send / phone deep links). Honest states: prepared -> opened on phone -> (provider) sent.
import React, { useEffect, useMemo, useState } from 'react';
import { Send, Smartphone, Save, WifiOff } from 'lucide-react';
import Sheet, { fieldClass } from '../../../components/workspace/Sheet';

import { useOnline } from '../../../components/network/networkKit';
import { usePosErpAuth } from '../../../auth/usePosErpAuth';
import { academicCommService, ACADEMIC_PURPOSES } from './academicCommService';
import { PURPOSE_BY_KEY } from '../templates/academicTemplates';
import Note from '../../academic/components/Note';

const CHANNELS = [['SMS', 'SMS'], ['WHATSAPP', 'WhatsApp'], ['EMAIL', 'Email']];

export default function AcademicMessageSheet({ purpose: initialPurpose = 'ELIMU_ACADEMIC_CONCERN', guardian, student, context = {}, reference, onClose, onDone }) {
  const { tenant, staffId } = usePosErpAuth(); const online = useOnline();
  const [purpose, setPurpose] = useState(initialPurpose);
  const [channel, setChannel] = useState(guardian?.phone ? 'SMS' : 'EMAIL');
  const [extras, setExtras] = useState({}); const [templates, setTemplates] = useState([]);
  const [subject, setSubject] = useState(''); const [body, setBody] = useState(''); const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false); const [result, setResult] = useState(null); const [err, setErr] = useState(null);

  useEffect(() => { if (tenant?.id) academicCommService.listTemplates({ tenantId: tenant.id, businessId: tenant.business_id }).then(setTemplates).catch(() => setTemplates([])); }, [tenant]);
  const prepared = useMemo(() => academicCommService.prepare({ purpose, channel, guardian, student, schoolName: context.schoolName || tenant?.business_name, term: context.term, academicYear: context.academicYear,
    exam: context.exam, subject: context.subject, resultDate: context.resultDate, extras, businessTemplates: templates }), [purpose, channel, guardian, student, context, extras, templates, tenant]);
  useEffect(() => { if (!touched) { setBody(prepared.body); setSubject(prepared.subject || ''); } }, [prepared, touched]);          // regenerate until the user edits
  const check = academicCommService.check({ channel, subject, body, to: prepared.to });
  const needed = (PURPOSE_BY_KEY[purpose]?.inputs || []).filter((i) => !i.optional && !extras[i.key]);

  const record = async () => {
    const composed = { ...prepared, body: prepared.body };
    return academicCommService.record({ tenantId: tenant.id, businessId: tenant.business_id, userId: staffId, composed, final: { subject, body, to: prepared.to }, guardian, student, reference });
  };
  const run = async (mode) => {
    setBusy(true); setErr(null); setResult(null);
    try {
      const { log, linkError } = await record();
      if (mode === 'prepare') setResult({ tone: 'good', text: 'Saved as a prepared message. It has NOT been sent.' });
      else if (mode === 'phone') {
        const url = await academicCommService.openOnPhone(log);
        if (url) { window.open(url, '_blank', 'noopener'); setResult({ tone: 'good', text: 'Opened on this phone and recorded as "opened". It is not marked sent until you confirm.' }); } else setResult({ tone: 'bad', text: 'There is no valid contact for this channel.' });
      } else {
        const r = await academicCommService.sendViaProvider(log.id);
        setResult(r.ok ? { tone: 'good', text: 'Submitted for sending. The status will update as the provider reports back.' } : { tone: 'warn', text: `${r.message || 'Could not send now.'} It is saved as prepared; you can open it on this phone instead.` });
      }
      if (linkError) setResult((x) => ({ ...x, text: `${x.text} (Note: it could not be linked to the student's history: ${linkError})` }));
      onDone?.(log);
    } catch (e) { setErr(e.message || 'Could not record the message.'); } finally { setBusy(false); }
  };
  const can = online && check.ok && !needed.length && !busy;

  return (
    <Sheet title={`Message ${guardian?.full_name || guardian?.guardian_name || 'guardian'}`} onClose={onClose}>
      <div className="space-y-3">
        {!online && <Note tone="warn"><WifiOff size={14} className="inline mr-1" />You are offline. You can write the message, but it cannot be recorded or sent until you are back online. Calling still works.</Note>}
        <label className="block text-xs text-[#6F7461]">Message type
          <select className={fieldClass} value={purpose} onChange={(e) => { setPurpose(e.target.value); setTouched(false); }}>{ACADEMIC_PURPOSES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></label>
        <div className="flex gap-2">{CHANNELS.map(([k, l]) => <button key={k} type="button" onClick={() => { setChannel(k); setTouched(false); }} className={`flex-1 rounded-xl min-h-[40px] text-sm font-semibold border ${channel === k ? 'bg-[#1F6B45] text-white border-[#C9A227]' : 'bg-white border-[#E3DBB8] text-[#1F6B45]'}`}>{l}</button>)}</div>
        {(PURPOSE_BY_KEY[purpose]?.inputs || []).map((i) => (
          <label key={i.key} className="block text-xs text-[#6F7461]">{i.label}{i.optional ? ' (optional)' : ''}
            <input className={fieldClass} value={extras[i.key] || ''} onChange={(e) => { setExtras({ ...extras, [i.key]: e.target.value }); setTouched(false); }} /></label>))}
        <div className="text-xs text-[#6F7461]">To: <b>{prepared.to || 'no valid contact'}</b></div>
        {channel === 'EMAIL' && <input aria-label="Subject" className={fieldClass} value={subject} onChange={(e) => { setSubject(e.target.value); setTouched(true); }} placeholder="Subject" />}
        <textarea aria-label="Message" rows={7} className={`${fieldClass} py-2`} value={body} onChange={(e) => { setBody(e.target.value); setTouched(true); }} />
        {channel === 'SMS' && check.sms && <div className="text-[11px] text-[#6F7461]">{check.sms.length} characters · {check.sms.segments} SMS part{check.sms.segments === 1 ? '' : 's'}</div>}
        {prepared.missing.length > 0 && <Note tone="warn">Some details are not available: {prepared.missing.join(', ').replace(/_/g, ' ')}. Fill them in or edit the message.</Note>}
        {[...check.blocking, ...check.warnings, ...prepared.warnings].map((w, i) => <Note key={i} tone={check.blocking.includes(w) ? 'bad' : 'warn'}>{w.message}</Note>)}
        {err && <Note tone="bad">{err}</Note>}{result && <Note tone={result.tone}>{result.text}</Note>}
        <div className="grid gap-2">
          <button type="button" disabled={!can} onClick={() => run('send')} className="inline-flex items-center justify-center gap-2 bg-[#1F6B45] text-white font-semibold rounded-xl min-h-[46px] border-b-2 border-[#C9A227] disabled:opacity-50"><Send size={16} />Send from the school</button>
          <button type="button" disabled={!can} onClick={() => run('phone')} className="inline-flex items-center justify-center gap-2 bg-white text-[#1F6B45] font-semibold rounded-xl min-h-[46px] border border-[#E3DBB8] disabled:opacity-50"><Smartphone size={16} />Open on this phone</button>
          <button type="button" disabled={!online || busy || !body.trim()} onClick={() => run('prepare')} className="inline-flex items-center justify-center gap-2 text-[#6F7461] text-sm min-h-[40px] disabled:opacity-50"><Save size={14} />Save as prepared (not sent)</button>
        </div>
      </div>
    </Sheet>
  );
}
