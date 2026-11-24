// Register a school. Never signs in: the account waits for approval (same rule as every business).
import React, { useState } from 'react';
import { Loader2, CheckCircle2, ArrowLeft } from 'lucide-react';
import { usePOSAuth } from '../services/platform.js';
import { AuthShell } from './ElimuLogin.jsx';
import { humanMessage } from '../utils/humanError.js';

const field = 'w-full h-12 px-4 rounded-2xl border border-[#D9D2B4] bg-white text-[16px] outline-none focus:border-[#12261F]';
const REASONS = { WEAK_PASSWORD: 'Password must be at least 8 characters.', BUSINESS_CODE_TAKEN: 'That school code is already registered. Pick another.', DUPLICATE: 'That school code or username is already taken.' };
const EMPTY = { business_name: '', owner_name: '', phone: '', email: '', business_code: '', username: '', password: '', confirm: '', address: '' };

export default function ElimuRegister({ onBackToLogin }) {
  const { signup } = usePOSAuth();
  const [f, setF] = useState(EMPTY); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [done, setDone] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setError('');
    if (['business_name', 'owner_name', 'phone', 'business_code', 'username', 'password'].some((k) => !f[k].trim())) return setError('Please fill in every field marked *.');
    if (f.password.length < 8) return setError(REASONS.WEAK_PASSWORD);
    if (f.password !== f.confirm) return setError('Passwords do not match.');
    setBusy(true);
    try {
      const r = await signup({ p_business_name: f.business_name.trim(), p_owner_name: f.owner_name.trim(), p_phone: f.phone.trim(), p_email: f.email.trim() || null,
        p_business_code: f.business_code.trim(), p_username: f.username.trim(), p_password: f.password, p_business_type: 'school', p_address: f.address.trim() || null });
      if (!r.ok) return setError(REASONS[r.reason] || r.detail || 'Something went wrong. Please try again.');
      setDone(r.businessCode);
    } catch (err) { setError(humanMessage(err)); } finally { setBusy(false); }
  };
  if (done) return (
    <AuthShell title="Registration sent">
      <div className="text-center"><CheckCircle2 size={40} className="mx-auto text-emerald-700 mb-3" />
        <p className="text-sm text-[#23382B]">Your school code is <b className="font-mono">{done}</b>.</p>
        <p className="text-sm text-[#5A6B5E] mt-2 mb-5">Umova will review your school. Once approved, sign in with your school code, username and password.</p>
        <button type="button" onClick={onBackToLogin} className="w-full h-12 rounded-2xl bg-[#12261F] text-white font-bold">Back to sign in</button></div>
    </AuthShell>);
  return (
    <AuthShell title="Register your school">
      <button type="button" onClick={onBackToLogin} className="flex items-center gap-1 text-sm text-[#5A6B5E] mb-3"><ArrowLeft size={16} /> Back to sign in</button>
      {error && <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</div>}
      <form onSubmit={submit} className="space-y-3">
        <input className={field} placeholder="School name *" value={f.business_name} onChange={set('business_name')} />
        <input className={field} placeholder="Head teacher / owner name *" value={f.owner_name} onChange={set('owner_name')} />
        <input className={field} placeholder="Phone *" inputMode="tel" value={f.phone} onChange={set('phone')} />
        <input className={field} placeholder="Email" inputMode="email" value={f.email} onChange={set('email')} />
        <input className={field} placeholder="Choose a school code (e.g. SUNRISE) *" value={f.business_code} onChange={set('business_code')} autoCapitalize="characters" />
        <input className={field} placeholder="Username *" autoCapitalize="none" value={f.username} onChange={set('username')} />
        <input className={field} type="password" placeholder="Password *" value={f.password} onChange={set('password')} />
        <input className={field} type="password" placeholder="Confirm password *" value={f.confirm} onChange={set('confirm')} />
        <input className={field} placeholder="Address" value={f.address} onChange={set('address')} />
        <button type="submit" disabled={busy} className="w-full h-12 rounded-2xl bg-[#12261F] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">{busy && <Loader2 className="animate-spin" size={16} />}Register school</button>
      </form>
    </AuthShell>);
}
