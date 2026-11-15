// components/comm/TemplateEditor.jsx — "Your wording". Edit how a kind of message reads for THIS business.
// Details are shown as [Customer name]-style chips, never {{codes}}. Saving changes the business's permanent wording
// (needs the settings permission, enforced by the database too). Editing inside a single message never touches this.
import React, { useEffect, useRef, useState } from 'react';
import { usePosErpAuth } from '../../auth/usePosErpAuth';
import { commEngineService } from '../../services/commEngineService';
import { PURPOSES, CHANNELS, CHANNEL_LABEL, DEFAULT_TEMPLATES, VARIABLE_LABELS, variablesForPurpose, toFriendly, fromFriendly, findBusinessTemplate } from '../../utils/comm';
import { fieldClass } from '../workspace/Sheet';

export default function TemplateEditor({ canEdit }) {
  const { tenant, staffId } = usePosErpAuth();
  const list = PURPOSES.filter((p) => DEFAULT_TEMPLATES[p.key]);
  const [purpose, setPurpose] = useState(list[0]?.key);
  const [channel, setChannel] = useState('WHATSAPP');
  const [rows, setRows] = useState([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState('');
  const ref = useRef(null);
  const load = async () => { try { setRows(await commEngineService.listTemplates({ tenantId: tenant.id, businessId: tenant.business_id })); } catch { setMsg('Could not load your wording.'); } };
  useEffect(() => { if (tenant?.id) load(); /* eslint-disable-next-line */ }, [tenant]);
  const own = findBusinessTemplate(rows, purpose, channel);
  const sys = DEFAULT_TEMPLATES[purpose]?.[channel];
  useEffect(() => {
    const src = own || sys || {};
    setSubject(toFriendly(src.subject || '', VARIABLE_LABELS)); setBody(toFriendly(src.body || '', VARIABLE_LABELS)); setMsg('');
  }, [own?.id, own?.body, purpose, channel]); // eslint-disable-line
  const chips = variablesForPurpose(purpose, channel);
  const insert = (k) => { const t = `[${VARIABLE_LABELS[k]}]`; const el = ref.current; const a = el?.selectionStart ?? body.length; const b = el?.selectionEnd ?? body.length; setBody(body.slice(0, a) + t + body.slice(b)); };
  const save = async () => { try { await commEngineService.saveTemplate({ tenantId: tenant.id, businessId: tenant.business_id, purpose, channel, subject, body: fromFriendly(body, VARIABLE_LABELS), userId: staffId }); setMsg('Saved. New messages of this kind will use your wording.'); load(); } catch (e) { setMsg(e?.code === '42501' ? 'You do not have permission to change the business wording.' : 'Could not save. Try again.'); } };
  const reset = async () => { try { await commEngineService.resetTemplate({ tenantId: tenant.id, businessId: tenant.business_id, purpose, channel }); setMsg('Back to the standard wording.'); load(); } catch { setMsg('Could not reset.'); } };
  return (
    <div className="space-y-3">
      <select className={fieldClass} value={purpose} onChange={(e) => setPurpose(e.target.value)}>
        {[...new Set(list.map((p) => p.group))].map((g) => <optgroup key={g} label={g}>{list.filter((p) => p.group === g).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</optgroup>)}
      </select>
      <div className="flex gap-2">{CHANNELS.map((c) => <button key={c} onClick={() => setChannel(c)} className={`flex-1 min-h-[40px] rounded-xl text-sm font-semibold border ${channel === c ? 'bg-[#1F6B45] text-white border-[#C9A227]' : 'bg-white border-[#E3DBB8]'}`}>{CHANNEL_LABEL[c]}</button>)}</div>
      <div className="text-xs text-[#6F7461]">{own ? 'Using your own wording.' : 'Using the standard wording.'} Dates, amounts and names are filled in automatically.</div>
      {channel === 'EMAIL' && <input className={fieldClass} value={subject} disabled={!canEdit} onChange={(e) => setSubject(e.target.value)} />}
      <textarea ref={ref} className={`${fieldClass} py-2`} rows={10} value={body} disabled={!canEdit} onChange={(e) => setBody(e.target.value)} />
      {canEdit && <div className="flex flex-wrap gap-1.5">{chips.map((k) => <button key={k} onClick={() => insert(k)} className="px-2.5 py-1 rounded-full text-xs border border-[#E3DBB8] bg-[#FAF7E8]">+ {VARIABLE_LABELS[k]}</button>)}</div>}
      {msg && <div className="text-sm text-[#4A5240]">{msg}</div>}
      {canEdit ? (
        <div className="flex gap-2">
          <button onClick={save} className="flex-1 min-h-[44px] rounded-xl bg-[#1F6B45] text-white font-semibold border-b-2 border-[#C9A227]">Save wording</button>
          {own && <button onClick={reset} className="min-h-[44px] px-4 rounded-xl border border-[#E3DBB8]">Use standard</button>}
        </div>
      ) : <div className="text-xs text-[#8A8A70]">Only a manager can change the business wording. You can still edit any single message before sending.</div>}
    </div>
  );
}
