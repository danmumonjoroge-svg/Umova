// Elimu's own gate (replaces the shop sign-in screens): sign in / register / waiting for approval / set new password / the app.
// Driven by the ElimuSession status: only status 'authenticated' ever renders the app.
import React, { useState } from 'react';
import { Loader2, Clock, XCircle, Ban, LogOut } from 'lucide-react';
import { POSForcePasswordChange } from '../services/platform.js';
import { useElimuAuth } from '../app/auth/ElimuAuthContext.jsx';
import ElimuLogin, { AuthShell } from './ElimuLogin.jsx';
import ElimuRegister from './ElimuRegister.jsx';

const STATUS = {
  pending: [Clock, 'Waiting for approval', "Your school's registration is awaiting approval from Umova. You can sign in as soon as it is reviewed."],
  rejected: [XCircle, 'Registration not approved', "Your school's application was not approved."],
  suspended: [Ban, 'Account suspended', 'This school account has been suspended. Contact Umova support.'],
};
function Status({ stage, detail }) {
  const { signOut } = useElimuAuth(); const [Icon, title, body] = STATUS[stage] || STATUS.pending;
  return (<AuthShell title={title}><Icon size={32} className="text-[#8A6D0B] mb-3" /><p className="text-sm text-[#23382B]">{body}</p>
    {detail && <p className="text-xs text-[#5A6B5E] mt-2">{String(detail)}</p>}
    <button type="button" onClick={signOut} className="mt-5 w-full h-12 rounded-2xl border border-[#12261F] text-[#12261F] font-semibold flex items-center justify-center gap-2"><LogOut size={16} />Sign out</button></AuthShell>);
}
const Loading = () => <div className="elimu-app fixed inset-0 flex items-center justify-center bg-[#12261F]" role="status" aria-label="Loading"><Loader2 className="animate-spin text-[#C9A227]" size={28} /></div>;

export default function ElimuAuthGate({ children }) {
  const { session } = useElimuAuth(); const [screen, setScreen] = useState('login');
  switch (session.status) {
    case 'loading': return <Loading />;
    case 'signed_out': return screen === 'register' ? <ElimuRegister onBackToLogin={() => setScreen('login')} /> : <ElimuLogin onGoToRegister={() => setScreen('register')} logoutNotice={session.notice} />;
    case 'blocked':
      if (session.stage === 'must_change_password') return <POSForcePasswordChange staffName={session.user?.name} />;
      return <Status stage={session.stage} detail={session.problem?.detail} />;
    case 'authenticated': return children;
    default: return <Loading />;
  }
}
