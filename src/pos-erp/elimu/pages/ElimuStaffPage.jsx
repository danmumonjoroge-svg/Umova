// School staff: add people, give them school roles, reset a password, switch an account off. Owner only (the database enforces it).
import React, { useState } from 'react';
import { UserPlus, KeyRound, Power } from 'lucide-react';
import { FitPage, LoadingBlock, Notice, Sheet, fieldClass, saveBtnCls } from '../services/platform.js';
import { staffAdmin, generateTempPassword } from '../services/ElimuStaffService.js';
import { useAsync } from '../hooks/useAsync.js';
import { useElimuAccess } from '../hooks/useElimu.js';
import { Field } from '../components/ui.jsx';
import { STAFF_ROLE_CHOICES } from '../utils/permissions.js';
import { friendlyError } from '../utils/validation.js';

const label = (k) => STAFF_ROLE_CHOICES.find((r) => r.key === k)?.label || k;

function AddSheet({ onClose, onDone }) {
  const [f, setF] = useState({ name: '', username: '', phone: '', role: 'class_teacher', pass: generateTempPassword() });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [made, setMade] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy(true); setErr('');
    try { await staffAdmin.create({ name: f.name, username: f.username, phone: f.phone, role: f.role, tempPassword: f.pass }); setMade(f); onDone(); }
    catch (e) { setErr(friendlyError(e)); if (e.partial) onDone(); } finally { setBusy(false); }
  };
  if (made) return (
    <Sheet title="Staff member added" onClose={onClose}>
      <p className="text-sm mb-2">Give {made.name} these sign-in details. They will be asked to choose a new password the first time.</p>
      <div className="rounded-xl bg-[#F4EFD3] p-3 text-sm font-mono space-y-1"><div>Username: {made.username.toLowerCase()}</div><div>Temporary password: {made.pass}</div></div>
      <p className="text-xs text-[#6F7461] mt-2">They also need the school code. It is shown in Settings. This password is not shown again.</p>
      <button type="button" onClick={onClose} className={`${saveBtnCls} mt-4 w-full`}>Done</button>
    </Sheet>);
  return (
    <Sheet title="Add staff member" onClose={onClose}>
      {err && <Notice tone="bad">{err}</Notice>}
      <Field label="Full name"><input className={fieldClass} value={f.name} onChange={set('name')} /></Field>
      <Field label="Username" hint="3 to 30 letters or numbers, no spaces"><input className={fieldClass} value={f.username} onChange={set('username')} autoCapitalize="none" /></Field>
      <Field label="Phone"><input className={fieldClass} value={f.phone} onChange={set('phone')} inputMode="tel" /></Field>
      <Field label="Role at school" hint={STAFF_ROLE_CHOICES.find((r) => r.key === f.role)?.does}>
        <select className={fieldClass} value={f.role} onChange={set('role')}>{STAFF_ROLE_CHOICES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></Field>
      <Field label="Temporary password"><input className={fieldClass} value={f.pass} onChange={set('pass')} /></Field>
      <button type="button" disabled={busy} onClick={save} className={`${saveBtnCls} mt-3 w-full`}>{busy ? 'Adding…' : 'Add staff member'}</button>
    </Sheet>);
}

function PersonSheet({ p, onClose, onChanged }) {
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [pw, setPw] = useState(null);
  const run = async (fn) => { setBusy(true); setErr(''); try { await fn(); onChanged(); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); } };
  const isOwnerRow = p.role === 'owner'; const locked = isOwnerRow || p.is_self;
  return (
    <Sheet title={p.name} onClose={onClose}>
      {err && <Notice tone="bad">{err}</Notice>}
      <p className="text-xs text-[#6F7461] mb-3">{p.username}{p.phone ? ` · ${p.phone}` : ''} · {p.status === 'active' ? 'Active' : 'Switched off'}</p>
      <h3 className="text-sm font-semibold mb-1">School roles</h3>
      <div className="space-y-1.5 mb-4">{STAFF_ROLE_CHOICES.map((r) => { const on = p.roles.includes(r.key); return (
        <label key={r.key} className="flex items-start gap-2 rounded-xl border border-[#E3DBB8] bg-white p-2.5 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={on} disabled={busy || isOwnerRow} onChange={() => run(() => staffAdmin.setRole(p.id, r.key, !on))} />
          <span><b>{r.label}</b><span className="block text-xs text-[#6F7461]">{r.does}</span></span></label>); })}</div>
      {isOwnerRow && <p className="text-xs text-[#6F7461]">The owner already has full access.</p>}
      {!locked && (<div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy} onClick={() => { const t = generateTempPassword(); run(async () => { await staffAdmin.resetPassword(p.id, t); setPw(t); }); }} className="h-11 rounded-xl border border-[#12261F] text-sm font-semibold flex items-center justify-center gap-1.5"><KeyRound size={15} />Reset password</button>
        <button type="button" disabled={busy} onClick={() => run(() => staffAdmin.setStatus(p.id, p.status === 'active' ? 'disabled' : 'active'))} className="h-11 rounded-xl border border-[#B3402A] text-[#B3402A] text-sm font-semibold flex items-center justify-center gap-1.5"><Power size={15} />{p.status === 'active' ? 'Switch off' : 'Switch on'}</button></div>)}
      {pw && <div className="mt-3 rounded-xl bg-[#F4EFD3] p-3 text-sm font-mono">New temporary password: {pw}<div className="font-sans text-xs text-[#6F7461] mt-1">Shown once. They choose a new one at next sign-in.</div></div>}
    </Sheet>);
}

export default function ElimuStaffPage() {
  const { isOwner, loaded } = useElimuAccess();
  const list = useAsync(() => (isOwner ? staffAdmin.list() : Promise.resolve([])), [isOwner]);
  const [add, setAdd] = useState(false); const [open, setOpen] = useState(null);
  if (!loaded || (list.loading && !list.data)) return <LoadingBlock />;
  if (!isOwner) return <FitPage title="Staff"><Notice tone="bad">Only the school owner can manage staff.</Notice></FitPage>;
  const people = list.data || []; const current = open ? people.find((x) => x.id === open) : null;
  return (
    <FitPage title="Staff" action={<button type="button" onClick={() => setAdd(true)} className="h-10 px-3 rounded-xl bg-[#12261F] text-white text-sm font-semibold flex items-center gap-1.5"><UserPlus size={16} />Add</button>}>
      {list.error && <Notice tone="bad">{list.error}</Notice>}
      <div className="space-y-2">{people.map((p) => (
        <button key={p.id} type="button" onClick={() => setOpen(p.id)} className="w-full text-left rounded-2xl border border-[#E3DBB8] bg-white p-3 active:bg-[#F4EFD3]">
          <div className="flex items-center justify-between gap-2"><b className="text-sm truncate">{p.name}{p.is_self ? ' (you)' : ''}</b>
            <span className={`text-[11px] font-semibold ${p.status === 'active' ? 'text-emerald-700' : 'text-[#B3402A]'}`}>{p.status === 'active' ? 'Active' : 'Off'}</span></div>
          <div className="text-xs text-[#6F7461] mt-0.5">{p.role === 'owner' ? 'Owner' : p.roles.length ? p.roles.map(label).join(', ') : 'No school role yet'}</div></button>))}
        {!people.length && <p className="text-sm text-[#6F7461]">No staff yet.</p>}</div>
      {add && <AddSheet onClose={() => setAdd(false)} onDone={list.reload} />}
      {current && <PersonSheet p={current} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </FitPage>);
}
