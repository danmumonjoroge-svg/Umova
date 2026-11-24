// "My sign-in": where a staff member turns on fingerprint / face sign-in for THIS phone or computer.
// The passkey machinery is the host's (same as My Business); this page only frames it for Elimu.
import React from 'react';
import { Fingerprint, ShieldCheck } from 'lucide-react';
import { FitPage, POSPasskeySettings } from '../services/platform.js';
import { InfoCard } from '../ui/cards';

export default function MySignInPage() {
  return (
    <FitPage title="My sign-in" subtitle="Sign in faster and more safely">
      <InfoCard tone="tint" title="Why turn this on" className="mb-3">
        <ul className="text-sm space-y-1.5" style={{ color: 'var(--e-text,#23382B)' }}>
          <li className="flex gap-2"><Fingerprint size={16} className="mt-0.5 shrink-0" />Open Elimu with your fingerprint or face — nothing to type.</li>
          <li className="flex gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0" />Nobody can guess it or copy it from a shared screen. Your password still works.</li>
        </ul>
      </InfoCard>
      <POSPasskeySettings />
    </FitPage>);
}
