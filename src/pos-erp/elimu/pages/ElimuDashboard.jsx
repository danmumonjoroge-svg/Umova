import React from 'react';
import { TallyStrip } from '../ui/cards';
import { Link } from 'react-router-dom';
import { FitPage, MiniStats, LoadingBlock, Notice } from '../services/platform.js';
import { studentService } from '../services/ElimuStudentService.js';
import { communicationService } from '../communication/ElimuCommunicationService.js';
import { useAsync } from '../hooks/useAsync.js';
import { useElimuAccess, useElimuSetup } from '../hooks/useElimu.js';
import { QUALITY_LABELS, notificationItems } from '../communication/notificationCatalog.js';
import { quickActions } from '../registry.js';
import DashboardView from '../dashboard/components/DashboardView.jsx';
import { AttentionNote, ClassMosaic, ActionDock, InfoCard } from '../ui/cards/index.js';

const MGMT = ['settings.manage', 'marks.manage_all', 'finance.report', 'attendance.view_all', 'students.manage', 'library.manage'];

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
  if (MGMT.some((a) => can(a))) {   // principals, heads, admins, bursars, registrars...: the full dashboard with charts
    const links = [];
    if (can('students.manage')) links.push({ to: `${basePath}/students?new=1`, label: 'Add student', primary: true });
    if (can('admissions.manage')) links.push({ to: `${basePath}/admissions?new=1`, label: 'New application' });
    quickActions().filter((a) => can(a.action || 'students.view')).forEach((a) => links.push({ to: `${basePath}${a.to}`, label: a.label }));
    return <DashboardView basePath={basePath} heading={setup.school.schoolName || 'School'} subheading={period ? `${period.academic_year_name}${period.term_name ? ` · ${period.term_name}` : ''}` : 'No current academic year set'}
      attention={[...(!period && can('structure.manage') ? [{ id: 'noyear', title: 'Set the current academic year and terms in Settings.', to: `${basePath}/settings` }] : []), ...items.map((i) => ({ id: i.id, title: i.title, detail: i.detail, to: i.to }))]} links={links} />;
  }
  return (
    <FitPage title={setup.school.schoolName || 'School'} subtitle={period ? `${period.academic_year_name}${period.term_name ? ` · ${period.term_name}` : ''}` : 'No current academic year set'}
      summary={<TallyStrip showBar={false} items={[{ label: 'Active students', value: by.ACTIVE || 0, tone: 'ok' }, { label: 'Open applications', value: open, tone: 'warn' }, { label: 'Guardians', value: s?.guardians || 0, tone: 'quiet' }]} />}>
      {!period && can('structure.manage') && <Notice tone="warn">Set the current academic year and terms in <Link className="underline" to={`${basePath}/settings`}>Settings</Link> to start enrolling students.</Notice>}
      {items.length > 0 && <div className="mb-4"><AttentionNote items={items.map((i) => ({ id: i.id, title: i.title, detail: i.detail, to: i.to }))} /></div>}
      <div className="mb-4"><InfoCard tone="soft" title="Students by class">
        <ClassMosaic rows={(s?.enrolment_by_class || []).map((c) => ({ label: c.class_name, value: Number(c.students) }))} to={`${basePath}/classes`} /></InfoCard></div>
      <ActionDock links={[...(can('students.manage') ? [{ to: `${basePath}/students?new=1`, label: 'Add student', primary: true }] : []), ...(can('admissions.manage') ? [{ to: `${basePath}/admissions?new=1`, label: 'New application' }] : []),
        ...quickActions().filter((a) => can(a.action || 'students.view')).map((a) => ({ to: `${basePath}${a.to}`, label: a.label }))]} />
      {Object.keys(s?.data_quality || {}).length > 0 && can('students.manage') && (
        <section className="mt-4 text-xs text-slate-500">{Object.entries(s.data_quality).map(([k, n]) => <div key={k}>{n} · {QUALITY_LABELS[k] || k}</div>)}</section>
      )}
    </FitPage>
  );
}
