// Wraps the staff screens: a gentle banner during the grace month, and a clear, kind stop screen once the school's subscription has ended.
import React, { useEffect, useState } from 'react';
import { licenceService, licenceNotice } from '../services/ElimuLicenceService.js';
import { ContactCard } from '../help/HelpCentre.jsx';

export default function LicenceGate({ children }) {
  const [s, setS] = useState(null);
  useEffect(() => { let live = true; licenceService.status().then((v) => live && setS(v)); return () => { live = false; }; }, []);
  if (s?.blocked) {
    return (
      <div role="alert" className="max-w-md mx-auto p-6">
        <h1 className="text-lg font-bold text-[#12261F]">{s.state === 'suspended' ? 'Your school’s Elimu access is paused' : 'Your school’s subscription has ended'}</h1>
        <p className="text-sm text-slate-600 mt-2">Elimu cannot be opened for your school right now. Please ask your school administrator to contact Elimu support to renew. All your school’s information is safe and will be there when the subscription is active again.</p>
        <div className="mt-4"><ContactCard /></div>
      </div>
    );
  }
  const n = licenceNotice(s);
  return <>{n && <p role="status" className={`mb-3 rounded-xl border p-3 text-sm ${n.tone === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-sky-50 border-sky-200 text-sky-900'}`}>{n.text}</p>}{children}</>;
}
