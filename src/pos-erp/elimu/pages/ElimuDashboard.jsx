import React from 'react';
import { Link } from 'react-router-dom';
import { FitPage, MiniStats, LoadingBlock, Notice, EmptyBlock } from '../services/platform.js';
import { studentService } from '../services/ElimuStudentService.js';
import { communicationService } from '../communication/ElimuCommunicationService.js';
import { useAsync } from '../hooks/useAsync.js';
import { useElimuAccess, useElimuSetup } from '../hooks/useElimu.js';
import { QUALITY_LABELS, notificationItems } from '../communication/notificationCatalog.js';
import { quickActions } from '../registry.js';

export default function ElimuDashboard({ basePath = '/elimu' }) {
  const setup = useElimuSetup(); const { can } = useElimuAccess();
  const d = useAsync(() => (setup.data ? studentService.dashboard() : Promise.resolve(null)), [!!setup.data]);
  const q = useAsync(() => (setup.data && can('comms.send') ? communicationService.queue() : Promise.resolve([])), [!!setup.data]);
  if (setup.loading && !setup.data) return <LoadingBlock text="Getting your school ready…" />;
  if (setup.error && !setup.data) return <Notice tone="bad">{setup.error}</Notice>;
  const s = d.data; const by = s?.students_by_category || {}; const apps = s?.applications_by_category || {};
  const open = (apps.SUBMITTED || 0) + (apps.IN_REVIEW || 0);
  const period = s?.current_period;
  const items = notificationItems({ summary: s, queue: q.data || [], basePath });
  return (
    <FitPage title={setup.school.schoolName || 'School'} subtitle={period ? `${period.academic_year_name}${period.term_name ? ` · ${period.term_name}` : ''}` : 'No current academic year set'}
      summary={<MiniStats items={[{ label: 'Active students', value: by.ACTIVE || 0 }, { label: 'Open applications', value: open }, { label: 'Guardians', value: s?.guardians || 0 }]} />}>
      {!period && can('structure.manage') && <Notice tone="warn">Set the current academic year and terms in <Link className="underline" to={`${basePath}/settings`}>Settings</Link> to start enrolling students.</Notice>}
      {items.length > 0 && (
        <section className="mb-4"><h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Needs attention</h2>
          <ul className="space-y-2">{items.map((i) => <li key={i.id}><Link to={i.to} className={`block rounded-xl border px-3 py-3 text-sm ${i.tone === 'warn' ? 'bg-amber-50 border-amber-200' : 'bg-white border-[#E3DBB8]'}`}>{i.title}{i.detail && <span className="block text-xs text-slate-500">{i.detail}</span>}</Link></li>)}</ul></section>
      )}
      <section className="mb-4"><h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Students by class</h2>
        {(s?.enrolment_by_class || []).length === 0 ? <EmptyBlock>No one is enrolled in the current year yet.</EmptyBlock> :
          <div className="bg-white border border-[#E3DBB8] rounded-xl divide-y divide-[#EFE8C8]">{s.enrolment_by_class.map((c) => <div key={c.class_name} className="flex justify-between px-3 py-2.5 text-sm"><span>{c.class_name}</span><b>{c.students}</b></div>)}</div>}
      </section>
      <section className="grid grid-cols-2 gap-2">
        {can('students.manage') && <Link className="rounded-xl bg-[#1F6B45] text-white text-center text-sm font-semibold min-h-[48px] flex items-center justify-center" to={`${basePath}/students?new=1`}>Add student</Link>}
        {can('admissions.manage') && <Link className="rounded-xl border border-[#E3DBB8] bg-white text-center text-sm font-semibold min-h-[48px] flex items-center justify-center" to={`${basePath}/admissions?new=1`}>New application</Link>}
        {quickActions().filter((a) => can(a.action || 'students.view')).map((a) => <Link key={a.key} className="rounded-xl border border-[#E3DBB8] bg-white text-center text-sm font-semibold min-h-[48px] flex items-center justify-center" to={`${basePath}${a.to}`}>{a.label}</Link>)}
      </section>
      {Object.keys(s?.data_quality || {}).length > 0 && can('students.manage') && (
        <section className="mt-4 text-xs text-slate-500">{Object.entries(s.data_quality).map(([k, n]) => <div key={k}>{n} · {QUALITY_LABELS[k] || k}</div>)}</section>
      )}
    </FitPage>
  );
}
