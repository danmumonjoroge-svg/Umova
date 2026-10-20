// Staff, roles and permissions. Every change goes through the database's EXISTING owner-only
// functions (pos_list_staff, pos_create_staff, pos_set_staff_template, pos_set_staff_permission,
// pos_set_staff_status, pos_reset_staff_password). They re-check that you are the owner --
// hiding a button here is a courtesy, not the control. Refusals come straight back from the database.
import React, { useCallback, useEffect, useState } from 'react';
import { permissionService } from '../services/permissionService';
import { usePermissions } from '../navigation/PermissionsContext';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { singleFlight } from '../utils/singleFlight';
import { ROLES, ROLE_LABEL, PERMISSION_GROUPS } from '../constants/permissions';

const STATES = [
  { v: 'default', label: 'Role default', val: null },
  { v: 'allow', label: 'Always allow', val: true },
  { v: 'deny', label: 'Never allow', val: false },
];
const stateOf = (o, k) => (o && k in o ? (o[k] ? 'allow' : 'deny') : 'default');
const EMPTY = { name: '', username: '', phone: '', template: 'cashier', password: '' };

export default function StaffPage() {
  const { posStaffId } = usePosErpAuth();
  const { isOwner, loaded } = usePermissions();
  const [staff, setStaff] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(null);
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [resetFor, setResetFor] = useState(null);
  const [newPw, setNewPw] = useState('');

  const load = useCallback(async () => {
    try { setStaff(await permissionService.listStaff()); setError(''); }
    catch (e) { setError(e.message); setStaff([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (key, fn, okMsg) => {
    setBusy(key); setError(''); setNotice('');
    try { await fn(); if (okMsg) setNotice(okMsg); await load(); } catch (e) { setError(e.message); } finally { setBusy(null); }
  };

  const create = singleFlight('staff-create', () => run('new', async () => {
    await permissionService.create({ username: form.username, name: form.name, phone: form.phone, template: form.template, password: form.password });
    setForm(EMPTY); setAdding(false);
  }, 'Staff member added. Give them the username and temporary password; they must change it when they first sign in.'));

  const reset = singleFlight('staff-reset', () => run(resetFor, async () => {
    await permissionService.resetPassword(resetFor, newPw);
    setResetFor(null); setNewPw('');
  }, 'Password reset. They will be signed out and must choose a new password at next sign-in.'));

  if (loaded && !isOwner) {
    return <div className="p-6 text-center text-sm text-slate-600">Only the business owner can manage staff and permissions.</div>;
  }

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Staff and permissions</h1>
          <p className="text-xs text-slate-500">Changes take effect straight away and are written to the audit trail. You cannot change your own role or permissions.</p>
        </div>
        <button type="button" onClick={() => setAdding((a) => !a)} className="text-sm font-semibold px-3 min-h-[40px] rounded-lg bg-emerald-800 text-white shrink-0">{adding ? 'Cancel' : 'Add staff'}</button>
      </div>
      {error && <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-xl p-3">{error}</div>}
      {notice && <div role="status" className="text-sm bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl p-3">{notice}</div>}

      {adding && (
        <form onSubmit={(e) => { e.preventDefault(); create(); }} className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2">
          <div className="grid sm:grid-cols-2 gap-2">
            <label className="text-xs text-slate-600">Full name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 min-h-[40px] text-sm" /></label>
            <label className="text-xs text-slate-600">Username (for sign-in)
              <input value={form.username} autoCapitalize="none" onChange={(e) => setForm({ ...form, username: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 min-h-[40px] text-sm" /></label>
            <label className="text-xs text-slate-600">Phone (optional)
              <input value={form.phone} inputMode="tel" onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 min-h-[40px] text-sm" /></label>
            <label className="text-xs text-slate-600">Role
              <select value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 min-h-[40px] text-sm bg-white">
                {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
            <label className="text-xs text-slate-600 sm:col-span-2">Temporary password (at least 8 characters)
              <input value={form.password} type="text" autoComplete="off" onChange={(e) => setForm({ ...form, password: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 min-h-[40px] text-sm" /></label>
          </div>
          <p className="text-xs text-slate-500">{ROLES.find((r) => r.key === form.template)?.hint}</p>
          <button type="submit" disabled={busy === 'new'} className="text-sm font-semibold px-4 min-h-[40px] rounded-lg bg-emerald-800 text-white disabled:opacity-50">{busy === 'new' ? 'Adding…' : 'Add staff member'}</button>
        </form>
      )}

      {staff === null && <p className="text-sm text-slate-500">Loading…</p>}
      {(staff || []).map((s) => {
        const me = s.id === posStaffId;
        const owner = s.role === 'owner';
        return (
          <div key={s.id} className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900 truncate">{s.name}{me ? ' (you)' : ''}</p>
                <p className="text-xs text-slate-500">{s.username} · {ROLE_LABEL[s.template] || s.template} · {s.status === 'disabled' ? 'Switched off' : 'Active'}</p>
              </div>
              {!me && !owner && (
                <div className="flex items-center gap-2 flex-wrap">
                  <select aria-label={`Role for ${s.name}`} value={s.template} disabled={busy === s.id}
                    onChange={(e) => {
                      if (!window.confirm(`Change ${s.name} to ${ROLE_LABEL[e.target.value]}? Their individual permission changes will be cleared.`)) return;
                      run(s.id, () => permissionService.setTemplate(s.id, e.target.value, true));
                    }}
                    className="border border-slate-300 rounded-lg text-sm px-2 min-h-[40px] bg-white">
                    {!ROLES.some((r) => r.key === s.template) && <option value={s.template}>{ROLE_LABEL[s.template] || s.template}</option>}
                    {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                  <button type="button" disabled={busy === s.id}
                    onClick={() => run(s.id, () => permissionService.setStatus(s.id, s.status === 'disabled' ? 'active' : 'disabled'))}
                    className="text-sm font-semibold px-3 min-h-[40px] rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50">
                    {s.status === 'disabled' ? 'Switch on' : 'Switch off'}
                  </button>
                  <button type="button" onClick={() => { setResetFor(resetFor === s.id ? null : s.id); setNewPw(''); }}
                    className="text-sm font-semibold px-3 min-h-[40px] rounded-lg border border-slate-300 hover:bg-slate-50">Reset password</button>
                  <button type="button" onClick={() => setOpen(open === s.id ? null : s.id)}
                    className="text-sm font-semibold px-3 min-h-[40px] rounded-lg bg-emerald-800 text-white">{open === s.id ? 'Close' : 'Permissions'}</button>
                </div>
              )}
            </div>
            {owner && <p className="text-xs text-slate-500">Owners can do everything and cannot be restricted.</p>}
            {resetFor === s.id && (
              <form onSubmit={(e) => { e.preventDefault(); reset(); }} className="flex items-end gap-2 flex-wrap border-t border-slate-100 pt-2">
                <label className="text-xs text-slate-600 flex-1 min-w-[200px]">New temporary password (8+ characters)
                  <input value={newPw} autoComplete="off" onChange={(e) => setNewPw(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2 min-h-[40px] text-sm" /></label>
                <button type="submit" disabled={busy === s.id} className="text-sm font-semibold px-3 min-h-[40px] rounded-lg bg-amber-600 text-white disabled:opacity-50">Reset and sign them out</button>
              </form>
            )}
            {open === s.id && !owner && (
              <div className="border-t border-slate-100 pt-2 space-y-3">
                <p className="text-xs text-slate-500">{ROLES.find((r) => r.key === s.template)?.hint} “Role default” follows the role; the other two override it for this person only.</p>
                {PERMISSION_GROUPS.map(({ group, items }) => (
                  <div key={group}>
                    <p className="text-xs font-bold uppercase text-slate-400 mb-1">{group}</p>
                    <div className="space-y-1">
                      {items.map(([key, label]) => (
                        <div key={key} className="flex items-center justify-between gap-2">
                          <span className="text-sm text-slate-700">{label}{(s.permissions || []).includes(key) ? <span className="ml-1 text-emerald-700 text-xs">● allowed</span> : null}</span>
                          <select aria-label={`${label} for ${s.name}`} value={stateOf(s.overrides, key)} disabled={busy === s.id}
                            onChange={(e) => run(s.id, () => permissionService.setPermission(s.id, key, STATES.find((x) => x.v === e.target.value).val))}
                            className="border border-slate-300 rounded-lg text-xs px-2 min-h-[36px] bg-white">
                            {STATES.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
