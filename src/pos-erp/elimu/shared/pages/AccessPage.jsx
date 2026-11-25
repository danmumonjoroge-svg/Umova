// elimu/shared/pages/AccessPage.jsx -- who may do what in Elimu, and which classes a teacher may take attendance for.
import React, { useCallback, useEffect, useState } from 'react';
import { useElimu } from '../hooks/ElimuContext';
import { useFoundation } from '../hooks/useFoundation';
import { FitPage, SelectField, LoadingBlock, Pill, ErrorLine, btnPrimary, btn, Notice } from '../components/kit';
import { accessService } from '../services/accessService';
import { ROLES } from '../utils/access';
const ROLE_LABELS = Object.fromEntries(ROLES.map((r) => [r.key, r.label]));

export default function AccessPage() {
  const { tenantId, businessId, userId, can } = useElimu(); const f = useFoundation({ teachers: true }); const manage = can('roles.manage');
  const [roles, setRoles] = useState([]); const [alloc, setAlloc] = useState([]); const [loading, setLoading] = useState(true); const [err, setErr] = useState(null);
  const [r, setR] = useState({ staff: '', role: '' }); const [a, setA] = useState({ staff: '', cls: '' });
  const load = useCallback(async () => { setLoading(true); try { const [x, y] = await Promise.all([accessService.listRoles(), accessService.listAllocations()]); setRoles(x); setAlloc(y); } catch (e) { setErr(e.message); } finally { setLoading(false); } }, []);
  useEffect(() => { load(); }, [load]);
  const run = (fn) => async () => { setErr(null); try { await fn(); await load(); } catch (e) { setErr(e.message); } };
  return (
    <FitPage title="Access" subtitle="Roles and class assignments (the school owner always has full access)">
      <ErrorLine error={err} />{loading && <LoadingBlock />}
      <h3 className="text-sm font-bold mb-1">Roles</h3>
      <ul className="space-y-1 mb-2">{roles.map((x) => <li key={x.id} className="flex justify-between items-center text-sm rounded-lg bg-white border border-[#E3DBB8] px-3 py-1.5"><span>{f.names.teacher(x.staff_id) || 'Staff member'}</span><span className="flex items-center gap-1.5"><Pill tone="neutral">{ROLE_LABELS[x.role] || x.role}</Pill>{manage && <button className="text-xs text-[#B23A2E] min-h-[36px] px-1" onClick={run(() => accessService.revokeRole(x.id))}>Remove</button>}</span></li>)}</ul>
      {manage && <div className="grid grid-cols-2 gap-x-3 mb-4"><SelectField label="Staff" value={r.staff} onChange={(v) => setR({ ...r, staff: v || '' })} options={f.teachers.map((t) => ({ value: t.teacher_id, label: t.teacher_name }))} />
        <SelectField label="Role" value={r.role} onChange={(v) => setR({ ...r, role: v || '' })} options={Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))} />
        <button className={`${btnPrimary} col-span-2`} disabled={!r.staff || !r.role} onClick={run(async () => { await accessService.grantRole({ tenantId, businessId, staffId: r.staff, role: r.role, userId }); setR({ staff: '', role: '' }); })}>Give role</button></div>}
      <h3 className="text-sm font-bold mb-1">Teacher class assignments</h3>
      <ul className="space-y-1 mb-2">{alloc.map((x) => <li key={x.id} className="flex justify-between items-center text-sm rounded-lg bg-white border border-[#E3DBB8] px-3 py-1.5"><span>{f.names.teacher(x.teacher_staff_id || x.staff_id) || 'Teacher'} · {f.classLabel(x.class_id, x.stream_id)}</span>{manage && <button className="text-xs text-[#B23A2E] min-h-[36px] px-1" onClick={run(() => accessService.deallocate(x.id))}>Remove</button>}</li>)}</ul>
      {manage && <div className="grid grid-cols-2 gap-x-3"><SelectField label="Teacher" value={a.staff} onChange={(v) => setA({ ...a, staff: v || '' })} options={f.teachers.map((t) => ({ value: t.teacher_id, label: t.teacher_name }))} />
        <SelectField label="Class" value={a.cls} onChange={(v) => setA({ ...a, cls: v || '' })} options={f.classStreams.map((c) => ({ value: `${c.class_id}|${c.stream_id || ''}`, label: [c.class_name, c.stream_name].filter(Boolean).join(' ') }))} />
        <button className={`${btnPrimary} col-span-2`} disabled={!a.staff || !a.cls} onClick={run(async () => { const [classId, streamId] = a.cls.split('|'); await accessService.allocate({ staffId: a.staff, classId, streamId: streamId || null }); setA({ staff: '', cls: '' }); })}>Assign</button></div>}
    </FitPage>
  );
}
