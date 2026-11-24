// Elimu's own gate (replaces the shop sign-in screens): sign in / register / waiting for approval / set new password / the app.
import React, { useEffect, useState } from 'react';
import { signinService } from './signinService.js';
import { Loader2, Clock, XCircle, Ban, LogOut } from 'lucide-react';
import { usePOSAuth, POSForcePasswordChange } from '../services/platform.js';
import ElimuLogin, { AuthShell } from './ElimuLogin.jsx';
import ElimuRegister from './ElimuRegister.jsx';

const STATUS = {
  pending: [Clock, 'Waiting for approval', "Your school's registration is awaiting approval from Umova. You can sign in as soon as it is reviewed."],
  rejected: [XCircle, 'Registration not approved', "Your school's application was not approved."],
  suspended: [Ban, 'Account suspended', 'This school account has been suspended. Contact Umova support.'],
};
function Status({ stage }) {
  const { logout, statusDetail } = usePOSAuth(); const [Icon, title, body] = STATUS[stage] || STATUS.pending;
  return (<AuthShell title={title}><Icon size={32} className="text-[#8A6D0B] mb-3" /><p className="text-sm text-[#23382B]">{body}</p>
    {statusDetail && <p className="text-xs text-[#5A6B5E] mt-2">{String(statusDetail)}</p>}
    <button type="button" onClick={logout} className="mt-5 w-full h-12 rounded-2xl border border-[#12261F] text-[#12261F] font-semibold flex items-center justify-center gap-2"><LogOut size={16} />Sign out</button></AuthShell>);
}

export default function ElimuAuthGate({ children }) {
  const { authStage, staff, logoutNotice } = usePOSAuth(); const [screen, setScreen] = useState('login');
  // Once per browser tab session, write "signed in" to the activity log. Best effort: a failure here never blocks the person.
  useEffect(() => { if (authStage === 'authenticated') signinService.record(); if (authStage === 'logged_out') signinService.reset(); }, [authStage]);
  switch (authStage) {
    case 'checking': return <div className="fixed inset-0 flex items-center justify-center bg-[#12261F]"><Loader2 className="animate-spin text-[#C9A227]" size={28} /></div>;
    case 'logged_out': return screen === 'register' ? <ElimuRegister onBackToLogin={() => setScreen('login')} /> : <ElimuLogin onGoToRegister={() => setScreen('register')} logoutNotice={logoutNotice} />;
    case 'pending': case 'rejected': case 'suspended': return <Status stage={authStage} />;
    case 'must_change_password': return <POSForcePasswordChange staffName={staff?.name} />;
    case 'authenticated': return children;
    default: return <div className="fixed inset-0 flex items-center justify-center bg-[#12261F]"><Loader2 className="animate-spin text-[#C9A227]" size={28} /></div>;
  }
}
