// components/comm/CommSettings.jsx — greeting, sign-off, payment details, timing and which events prepare messages.
import React, { useEffect, useState } from 'react';
import { usePosErpAuth } from '../../auth/usePosErpAuth';
import { commEngineService } from '../../services/commEngineService';
import { AUTOMATIONS, AUTOMATION_MODES, MODE_LABEL, normalizePrefs, DEFAULT_PREFS } from '../../utils/comm';
import { fieldClass } from '../workspace/Sheet';

export default function CommSettings({ canEdit }) {
  const { tenant, staffId } = usePosErpAuth();
  const [p, setP] = useState(DEFAULT_PREFS);
  const [msg, setMsg] = useState('');
  useEffect(() => { if (tenant?.id) commEngineService.getPrefs({ tenantId: tenant.id, businessId: tenant.business_id }).then(setP).catch(() => setMsg('Could not load settings.')); }, [tenant]);
  const set = (k, v) => setP((x) => ({ ...x, [k]: v }));
  const setT = (k, v) => setP((x) => ({ ...x, timing: { ...x.timing, [k]: v } }));
  const setA = (key, mode) => setP((x) => ({ ...x, automations: { ...x.automations, [key]: { ...x.automations[key], mode } } }));
  const save = async () => { try { await commEngineService.savePrefs({ tenantId: tenant.id, businessId: tenant.business_id, settings: normalizePrefs({ settings: p }), userId: staffId }); setMsg('Saved.'); } catch (e) { setMsg(e?.code === '42501' ? 'You do not have permission to change these settings.' : 'Could not save.'); } };
  const lab = 'block text-xs font-semibold text-[#6F7461]';
  return (
    <div className="space-y-3">
      <label className={lab}>Greeting (leave empty for the standard one)<input disabled={!canEdit} className={fieldClass} value={p.greeting} onChange={(e) => set('greeting', e.target.value)} placeholder="Hello [Customer name]," /></label>
      <label className={lab}>Sign-off<input disabled={!canEdit} className={fieldClass} value={p.sign_off} onChange={(e) => set('sign_off', e.target.value)} placeholder="Kind regards, your business name" /></label>
      <label className={lab}>How customers can pay you (shown in payment reminders)<textarea disabled={!canEdit} rows={3} className={`${fieldClass} py-2`} value={p.payment_instructions} onChange={(e) => set('payment_instructions', e.target.value)} /></label>
      <label className={lab}>Default days to pay on credit (0 = no due date unless you set one)<input disabled={!canEdit} type="number" min="0" className={fieldClass} value={p.default_credit_days} onChange={(e) => set('default_credit_days', Number(e.target.value) || 0)} /></label>
      <label className={lab}>Remind this many days before a payment is due<input disabled={!canEdit} type="number" min="0" className={fieldClass} value={p.timing.payment_lead_days} onChange={(e) => setT('payment_lead_days', Number(e.target.value) || 0)} /></label>
      <div className="pt-1 text-sm font-semibold text-[#23382B]">What should My Business prepare for you?</div>
      <p className="text-xs text-[#6F7461]">"Prepare for me" puts a ready message in To send. Nothing is sent without you unless you choose "Send automatically", which also needs a sending service to be set up.</p>
      {AUTOMATIONS.map((a) => (
        <div key={a.key} className="flex items-center justify-between gap-2 border border-[#E3DBB8] rounded-xl px-3 py-2 bg-white">
          <span className="text-sm text-[#23382B]">{a.label}</span>
          <select disabled={!canEdit} className="text-sm border border-[#E3DBB8] rounded-lg px-2 min-h-[36px]" value={p.automations[a.key]?.mode || 'OFF'} onChange={(e) => setA(a.key, e.target.value)}>
            {AUTOMATION_MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
          </select>
        </div>
      ))}
      {msg && <div className="text-sm text-[#4A5240]">{msg}</div>}
      {canEdit ? <button onClick={save} className="w-full min-h-[48px] rounded-xl bg-[#1F6B45] text-white font-semibold border-b-2 border-[#C9A227]">Save settings</button> : <div className="text-xs text-[#8A8A70]">Only a manager can change these settings.</div>}
    </div>
  );
}
