// ElimuContactActions — the SMS / WhatsApp / Email / Call row. Drop it next to any guardian (or a student's primary guardian) on any page.
// A button that cannot be used is greyed with the reason in its tooltip/label, so staff know WHY (opted out, no number, ...).
import React, { useState } from 'react';
import { MessageSquare, Mail, Phone, MessageCircle } from 'lucide-react';
import { Notice } from '../services/platform.js';
import { channelsFor } from '../communication/consent.js';
import { communicationService } from '../communication/ElimuCommunicationService.js';
import ElimuMessageComposer from './ElimuMessageComposer.jsx';
import { useElimuAccess } from '../hooks/useElimu.js';
import { friendlyError } from '../utils/validation.js';

const ICON = { SMS: MessageSquare, WHATSAPP: MessageCircle, EMAIL: Mail, CALL: Phone };
const NAME = { SMS: 'SMS', WHATSAPP: 'WhatsApp', EMAIL: 'Email', CALL: 'Call' };

export default function ElimuContactActions({ guardian, student, application, klass, purpose = 'ELIMU_GENERAL_NOTICE', settings, overrides, compact = false, onDone }) {
  const { can } = useElimuAccess();
  const [composer, setComposer] = useState(null);
  const [callId, setCallId] = useState(null);
  const [err, setErr] = useState(null);
  if (!guardian) return null;
  const allowed = can('comms.send');
  const results = channelsFor({ guardian, purpose, settings });

  const call = async () => {
    setErr(null);
    try {
      const r = await communicationService.startCall({ guardianId: guardian.id, studentId: student?.id, purpose });
      setCallId(r.callId); window.location.href = r.url;
    } catch (e) { setErr(friendlyError(e)); }
  };
  const outcome = async (o) => { try { await communicationService.recordCallOutcome(callId, o); setCallId(null); onDone?.(); } catch (e) { setErr(friendlyError(e)); } };

  return (
    <div>
      <div className="flex gap-2" role="group" aria-label={`Contact ${guardian.first_name}`}>
        {results.map((r) => {
          const Icon = ICON[r.channel]; const off = !allowed || !r.ok;
          const why = !allowed ? 'You do not have permission to contact guardians.' : r.reason;
          return (
            <button key={r.channel} type="button" disabled={off} title={off ? why : `${NAME[r.channel]} ${guardian.first_name}`} aria-label={off ? `${NAME[r.channel]} unavailable: ${why}` : `${NAME[r.channel]} ${guardian.first_name}`}
              onClick={() => (r.channel === 'CALL' ? call() : setComposer(r.channel))}
              className={`${compact ? 'w-10 h-10' : 'flex-1 min-h-[44px]'} rounded-xl border border-[#E3DBB8] bg-white text-[#1F6B45] flex items-center justify-center gap-1.5 text-xs font-medium disabled:opacity-40 disabled:text-slate-400`}>
              <Icon size={16} />{!compact && NAME[r.channel]}
            </button>
          );
        })}
      </div>
      {err && <div className="mt-2"><Notice tone="bad">{err}</Notice></div>}
      {callId && (
        <div className="mt-2 rounded-xl bg-[#FBF8EA] border border-[#E3DBB8] p-3 text-sm" role="group" aria-label="Call outcome">
          <div className="font-medium mb-2">Call started. How did it go?</div>
          <div className="flex flex-wrap gap-2">{[['ANSWERED', 'Spoke to them'], ['NO_ANSWER', 'No answer'], ['BUSY', 'Busy'], ['VOICEMAIL', 'Left voicemail'], ['WRONG_NUMBER', 'Wrong number'], ['CALL_BACK', 'Call back later']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => outcome(k)} className="px-3 min-h-[40px] rounded-lg border border-[#E3DBB8] bg-white text-xs">{l}</button>))}
            <button type="button" onClick={() => setCallId(null)} className="px-3 min-h-[40px] rounded-lg text-xs text-slate-500">Decide later</button></div>
        </div>
      )}
      {composer && <ElimuMessageComposer guardian={guardian} student={student} application={application} klass={klass} purpose={purpose} channel={composer} settings={settings} overrides={overrides} onClose={() => setComposer(null)} onRecorded={onDone} />}
    </div>
  );
}
