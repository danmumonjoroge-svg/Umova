// Elimu's own sign-in: school code + user ID + password, through the ElimuSession (app/auth). Shows no POS wording; keeps the demo school and Register paths.
import React, { useEffect, useRef, useState } from 'react';
import { GraduationCap, Loader2, Eye, EyeOff } from 'lucide-react';
import { useElimuAuth } from '../app/auth/ElimuAuthContext.jsx';
import { validateLoginForm, retryDelaySeconds } from '../app/auth/identifiers.js';
import { authMessage } from '../app/auth/authAdapter.js';
import { ELIMU_DEMO_CODE, ELIMU_DEMO_USERNAME, ELIMU_DEMO_PASSWORD } from './demo.js';

const LAST_CODE = 'elimu:last-school-code';       // per-device convenience only; nothing secret is stored
const readCode = () => { try { return localStorage.getItem(LAST_CODE) || ''; } catch { return ''; } };
const writeCode = (v) => { try { localStorage.setItem(LAST_CODE, v); } catch { /* private mode: fine */ } };
const field = 'w-full h-12 px-4 rounded-2xl border border-[#D9D2B4] bg-white text-[16px] outline-none focus:border-[#12261F] focus:ring-4 focus:ring-[#C9A227]/25 disabled:opacity-60';
const fieldErr = 'border-red-400';

export function AuthShell({ title, sub, children }) {
  return (
    <div className="elimu-app fixed inset-0 overflow-y-auto bg-[#12261F]" style={{ height: '100dvh' }}>
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
  const { signIn } = useElimuAuth();
  const [code, setCode] = useState(readCode); const [user, setUser] = useState(''); const [pass, setPass] = useState(''); const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [fieldErrors, setFieldErrors] = useState({});
  const [failures, setFailures] = useState(0); const [wait, setWait] = useState(0);
  const mounted = useRef(true); const userRef = useRef(null); const passRef = useRef(null);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => { if (wait <= 0) return undefined; const t = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(t); }, [wait]);

  const run = async (form, { remember = true } = {}) => {
    setBusy(true); setError('');
    try { await signIn(form); if (remember) writeCode(form.schoolCode.replace(/\s+/g, '')); }
    catch (e) {
      if (!mounted.current) return;
      setError(e?.message || authMessage(e?.code));
      if (e?.code === 'INVALID_CREDENTIALS') { const n = failures + 1; setFailures(n); setWait(retryDelaySeconds(n)); setPass(''); passRef.current?.focus(); }
    } finally { if (mounted.current) setBusy(false); }
  };
  const submit = (e) => {
    e.preventDefault(); if (busy || wait > 0) return;
    const v = validateLoginForm({ schoolCode: code, identifier: user, password: pass });
    setFieldErrors(v.errors);
    if (!v.ok) { setError(''); (v.errors.schoolCode ? null : v.errors.identifier ? userRef.current : passRef.current)?.focus(); return; }
    run(v.value);
  };
  const demo = () => run({ schoolCode: ELIMU_DEMO_CODE, identifier: ELIMU_DEMO_USERNAME, password: ELIMU_DEMO_PASSWORD }, { remember: false });
  const err = (k) => (fieldErrors[k] ? <p className="mt-1 ml-1 text-xs text-red-600" role="alert">{fieldErrors[k]}</p> : null);

  return (
    <AuthShell title="Elimu sign in" sub="Sign in with your school code, user ID and password.">
      {logoutNotice && <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{logoutNotice}</div>}
      {error && <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</div>}
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div><input className={`${field} ${fieldErrors.schoolCode ? fieldErr : ''}`} value={code} onChange={(e) => setCode(e.target.value)} placeholder="School code" aria-label="School code" autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="organization" disabled={busy} />{err('schoolCode')}</div>
        <div><input ref={userRef} className={`${field} ${fieldErrors.identifier ? fieldErr : ''}`} value={user} onChange={(e) => setUser(e.target.value)} placeholder="User ID" aria-label="User ID" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" disabled={busy} />{err('identifier')}</div>
        <div>
          <div className="relative">
            <input ref={passRef} className={`${field} pr-12 ${fieldErrors.password ? fieldErr : ''}`} type={show ? 'text' : 'password'} value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Password" aria-label="Password" autoComplete="current-password" disabled={busy} />
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-1 top-1 h-10 w-10 flex items-center justify-center rounded-full text-[#5A6B5E] active:bg-black/5">{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          </div>{err('password')}
        </div>
        <button type="submit" disabled={busy || wait > 0} className="w-full h-12 rounded-2xl bg-[#12261F] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
          {busy && <Loader2 className="animate-spin" size={16} />}{busy ? 'Signing in…' : wait > 0 ? `Try again in ${wait}s` : 'Sign in'}
        </button>
      </form>
      <button type="button" onClick={demo} disabled={busy} className="w-full mt-3 h-12 rounded-2xl border border-[#C9A227] bg-[#C9A227]/15 text-[#6B5510] font-semibold disabled:opacity-60">Try the demo school</button>
      <p className="text-center text-xs text-[#5A6B5E] mt-5">New school? <button type="button" onClick={onGoToRegister} className="font-semibold text-[#8A6D0B] underline">Register here</button></p>
    </AuthShell>
  );
}
