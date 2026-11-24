// Elimu's own sign-in: school code + username + password. Uses the shared login underneath; shows no POS wording.
import React, { useState } from 'react';
import { GraduationCap, Loader2, Fingerprint } from 'lucide-react';
import { usePOSAuth, posPasskeys } from '../services/platform.js';
import { ELIMU_DEMO_CODE, ELIMU_DEMO_USERNAME, ELIMU_DEMO_PASSWORD } from './demo.js';

const REASONS = {
  BUSINESS_NOT_FOUND: 'No school found with that code.',
  TENANT_NOT_APPROVED: "This school's registration is still pending approval.",
  TENANT_REJECTED: "This school's registration was rejected.",
  TENANT_SUSPENDED: "This school's account is suspended.",
  STAFF_DISABLED: 'This staff account has been disabled.',
  INVALID_CREDENTIALS: 'Incorrect username or password.',
};
/** The gate logs the sign-in once the session exists; this tells it how the person got in. */
const rememberMethod = (m) => { try { sessionStorage.setItem('elimu-signin-method', m); } catch { /* private mode: it logs as password */ } };
const field = 'w-full h-12 px-4 rounded-2xl border border-[#D9D2B4] bg-white text-[16px] outline-none focus:border-[#12261F] focus:ring-4 focus:ring-[#C9A227]/25';

export function AuthShell({ title, sub, children }) {
  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#12261F]" style={{ height: '100dvh' }}>
      <div className="min-h-full flex items-center justify-center p-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="w-full max-w-[400px] rounded-3xl bg-[#FBF8EA] p-6 shadow-xl">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#C9A227] text-[#12261F] mb-4"><GraduationCap size={26} /></span>
          <h1 className="text-2xl font-black text-[#12261F] tracking-tight">{title}</h1>
          {sub && <p className="text-sm text-[#5A6B5E] mt-1.5 mb-5">{sub}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

export default function ElimuLogin({ onGoToRegister, logoutNotice }) {
  const { login, loginWithPasskey } = usePOSAuth();
  const [code, setCode] = useState(''); const [user, setUser] = useState(''); const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');

  const run = async (c, u, p) => {
    setBusy(true); setError(''); rememberMethod('PASSWORD');
    const r = await login(c, u, p);
    if (!r.ok) setError(REASONS[r.reason] || r.detail || 'Something went wrong signing in. Try again.');
    setBusy(false);
  };
  const canPrint = (() => { try { return !!posPasskeys?.supported?.(); } catch { return false; } })();
  const finger = async () => {
    setBusy(true); setError(''); rememberMethod('FINGERPRINT');
    const r = await loginWithPasskey?.();
    if (r && !r.ok && r.reason === 'NO_PASSKEY') setError('No fingerprint is set up on this device yet. Sign in with your password once, then open Settings → My sign-in to turn it on.');
    else if (r && !r.ok && r.reason === 'PASSKEY_ERROR') setError(r.detail || 'Fingerprint sign-in failed. Use your password instead.');
    setBusy(false);
  };
  const submit = (e) => { e.preventDefault(); if (!code.trim() || !user.trim() || !pass) return setError('Enter your school code, username and password.'); run(code.trim(), user.trim(), pass); };
  const demo = async () => { setBusy(true); setError(''); rememberMethod('DEMO'); const r = await login(ELIMU_DEMO_CODE, ELIMU_DEMO_USERNAME, ELIMU_DEMO_PASSWORD);
    if (!r.ok) setError(r.reason === 'BUSINESS_NOT_FOUND' ? "The demo school isn't set up on this server yet." : REASONS[r.reason] || r.detail || 'Could not open the demo.'); setBusy(false); };

  return (
    <AuthShell title="Elimu sign in" sub="Sign in with your school code, username and password.">
      {logoutNotice && <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{logoutNotice}</div>}
      {error && <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</div>}
      <form onSubmit={submit} className="space-y-3">
        <input className={field} value={code} onChange={(e) => setCode(e.target.value)} placeholder="School code" autoCapitalize="characters" autoComplete="organization" disabled={busy} />
        <input className={field} value={user} onChange={(e) => setUser(e.target.value)} placeholder="Username" autoCapitalize="none" autoComplete="username" disabled={busy} />
        <input className={field} type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Password" autoComplete="current-password" disabled={busy} />
        <button type="submit" disabled={busy} className="w-full h-12 rounded-2xl bg-[#12261F] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
          {busy && <Loader2 className="animate-spin" size={16} />}{busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {canPrint && <button type="button" onClick={finger} disabled={busy} className="w-full mt-3 h-12 rounded-2xl border border-[#12261F]/30 bg-white text-[#12261F] font-semibold flex items-center justify-center gap-2 disabled:opacity-60"><Fingerprint size={18} />Sign in with fingerprint</button>}
      <button type="button" onClick={demo} disabled={busy} className="w-full mt-3 h-12 rounded-2xl border border-[#C9A227] bg-[#C9A227]/15 text-[#6B5510] font-semibold disabled:opacity-60">Try the demo school</button>
      <a href="/parent" className="block text-center mt-4 text-sm font-semibold text-[#1F6B45] underline" data-testid="parent-link">Are you a parent? Open the parent portal</a>
      <p className="text-center text-xs text-[#5A6B5E] mt-5">New school? <button type="button" onClick={onGoToRegister} className="font-semibold text-[#8A6D0B] underline">Register here</button></p>
    </AuthShell>
  );
}
