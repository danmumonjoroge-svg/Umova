// Per-channel consent / opt-out for one guardian, with where the answer came from. Opt-outs are honoured by the database.
import React, { useState } from 'react';
import { guardianService } from '../services/ElimuGuardianService.js';
import { Notice } from '../services/platform.js';
import { friendlyError } from '../utils/validation.js';

const CH = [['SMS', 'SMS'], ['WHATSAPP', 'WhatsApp'], ['EMAIL', 'Email'], ['PHONE', 'Phone calls']];

export default function ConsentEditor({ guardian, canEdit, onChanged }) {
  const [err, setErr] = useState(null);
  const cur = (ch) => guardian.consent?.find((c) => c.channel === ch)?.status || 'NOT_ASKED';
  const change = async (ch, status) => { setErr(null); try { await guardianService.setConsent(guardian.id, ch, status); onChanged?.(); } catch (e) { setErr(friendlyError(e)); } };
  return (
    <div>
      {err && <Notice tone="bad">{err}</Notice>}
      {CH.map(([k, l]) => (
        <div key={k} className="flex items-center justify-between py-2 border-b border-[#EFE8C8] last:border-0">
          <span className="text-sm">{l}</span>
          <select disabled={!canEdit} value={cur(k)} onChange={(e) => change(k, e.target.value)} className="border border-[#E3DBB8] rounded-lg px-2 min-h-[40px] text-sm bg-white" aria-label={`${l} consent`}>
            <option value="NOT_ASKED">Not asked</option><option value="ALLOWED">Allowed</option><option value="OPTED_OUT">Opted out</option>
          </select>
        </div>
      ))}
    </div>
  );
}
