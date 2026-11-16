import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight, Users, ClipboardList, UserRound, GraduationCap,
  AlertCircle, CheckCircle2, Settings2, Plus, School, ChevronRight, BarChart3,
} from 'lucide-react';
import { FitPage, LoadingBlock, Notice, EmptyBlock } from '../services/platform.js';
import { studentService } from '../services/ElimuStudentService.js';
import { communicationService } from '../communication/ElimuCommunicationService.js';
import { useAsync } from '../hooks/useAsync.js';
import { useElimuAccess, useElimuSetup } from '../hooks/useElimu.js';
import { QUALITY_LABELS, notificationItems } from '../communication/notificationCatalog.js';
import { quickActions } from '../registry.js';

const number = (value) => Number(value || 0).toLocaleString('en-KE');
const sum = (record) => Object.values(record || {}).reduce((total, value) => total + Number(value || 0), 0);

const KPI = ({ label, value, note, icon: Icon, tone = 'green', to }) => {
  const styles = {
    green: 'bg-[#EAF3EC] text-[#1F6B45]',
    gold: 'bg-[#F8F1D9] text-[#92700E]',
    blue: 'bg-[#EAF0F5] text-[#45647A]',
    red: 'bg-[#F9EAE6] text-[#A94B3E]',
  };
  const content = (
    <div className="h-full rounded-2xl border border-[#E7E2D0] bg-white p-4 sm:p-5 shadow-[0_2px_10px_rgba(35,56,43,0.035)] transition hover:border-[#D8C77F]">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${styles[tone]}`}><Icon size={19} /></div>
        {to && <ArrowUpRight size={16} className="text-[#9A987F]" />}
      </div>
      <div className="mt-4 text-2xl sm:text-3xl font-bold tracking-tight text-[#20372A] tabular-nums">{number(value)}</div>
      <div className="mt-1 text-sm font-semibold text-[#45564A]">{label}</div>
      {note && <div className="mt-1 text-xs text-[#858775]">{note}</div>}
    </div>
  );
  return to ? <Link to={to} className="block min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] rounded-2xl">{content}</Link> : content;
};

const SectionHeading = ({ title, detail, action }) => (
  <div className="mb-3 flex items-center justify-between gap-3">
    <div><h2 className="text-sm font-bold text-[#263D30]">{title}</h2>{detail && <p className="mt-0.5 text-xs text-[#858775]">{detail}</p>}</div>
    {action}
  </div>
);

const ActionLink = ({ to, label, description, icon: Icon }) => (
  <Link to={to} className="group flex min-w-0 items-center gap-3 rounded-xl border border-[#E9E5D8] bg-white p-3 transition hover:border-[#D6C57E] hover:bg-[#FFFEF8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]">
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EEF4EF] text-[#1F6B45]"><Icon size={19} /></span>
    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-[#263D30]">{label}</span>{description && <span className="mt-0.5 block truncate text-xs text-[#858775]">{description}</span>}</span>
    <ChevronRight size={16} className="shrink-0 text-[#A6A58F] transition group-hover:translate-x-0.5" />
  </Link>
);

export default function ElimuDashboard({ basePath = '/elimu' }) {
  const setup = useElimuSetup();
  const { can } = useElimuAccess();
  const canSendComms = can('comms.send');
  const d = useAsync(() => (setup.data ? studentService.dashboard() : Promise.resolve(null)), [!!setup.data]);
  const q = useAsync(() => (setup.data && canSendComms ? communicationService.queue() : Promise.resolve([])), [!!setup.data, canSendComms]);
  if (setup.loading && !setup.data) return <LoadingBlock text="Getting your school ready…" />;
  if (setup.error && !setup.data) return <Notice tone="bad">{setup.error}</Notice>;

  const s = d.data;
  const by = s?.students_by_category || {};
  const apps = s?.applications_by_category || {};
  const openApplications = Number(apps.SUBMITTED || 0) + Number(apps.IN_REVIEW || 0);
  const activeStudents = Number(by.ACTIVE || 0);
  const registeredStudents = sum(by);
  const period = s?.current_period;
  const items = notificationItems({ summary: s, queue: q.data || [], basePath });
  const classes = s?.enrolment_by_class || [];
  const maxClassCount = Math.max(1, ...classes.map((item) => Number(item.students || 0)));
  const actions = [
    can('students.manage') && { key: 'student', label: 'Register student', description: 'Create a new student record', to: `${basePath}/students?new=1`, icon: Plus },
    can('admissions.manage') && { key: 'admission', label: 'New application', description: 'Start an admission application', to: `${basePath}/admissions?new=1`, icon: ClipboardList },
    can('students.view') && { key: 'students', label: 'Student register', description: 'Find and manage learners', to: `${basePath}/students`, icon: Users },
    can('guardians.view') && { key: 'guardians', label: 'Guardians', description: 'View family contacts', to: `${basePath}/guardians`, icon: UserRound },
    can('students.view') && { key: 'reports', label: 'Reports centre', description: 'Open academic, attendance and finance reports', to: `${basePath}/report-centre`, icon: BarChart3 },
    ...quickActions().filter((a) => can(a.action || 'students.view')).map((a) => ({
      key: a.key, label: a.label, description: 'Open school workspace', to: `${basePath}${a.to}`, icon: GraduationCap,
    })),
  ].filter(Boolean);

  return (
    <FitPage
      title="School overview"
      subtitle={setup.school?.schoolName || 'Your school at a glance'}
      action={can('settings.manage') ? (
        <Link to={`${basePath}/settings`} aria-label="School settings" className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#E7E2D0] bg-white text-[#526456] hover:border-[#C9A227]">
          <Settings2 size={18} />
        </Link>
      ) : null}
    >
      <div className="space-y-5 pb-3">
        <section className="relative overflow-hidden rounded-2xl bg-[#173D2B] p-5 sm:p-6 text-white">
          <div className="pointer-events-none absolute -right-8 -top-12 h-44 w-44 rounded-full border-[22px] border-white/5" />
          <div className="pointer-events-none absolute -right-1 -bottom-20 h-48 w-48 rounded-full border-[22px] border-[#C9A227]/15" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#E8D58C]"><School size={14} /> School management</div>
              <h2 className="max-w-xl text-xl sm:text-2xl font-bold leading-tight">A clearer view of your school.</h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/75">
                {period
                  ? `${period.academic_year_name}${period.term_name ? ` · ${period.term_name}` : ''} is your current academic period.`
                  : 'Set an academic year and term to begin tracking enrolments.'}
              </p>
            </div>
            {!period && can('structure.manage') && (
              <Link to={`${basePath}/settings`} className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-xl bg-[#D6B84D] px-4 text-sm font-bold text-[#20372A] hover:bg-[#E4CC70]">
                Set up school <ArrowUpRight size={16} />
              </Link>
            )}
          </div>
        </section>

        {!period && can('structure.manage') && (
          <Notice tone="warn">Set the current academic year and terms in <Link className="font-semibold underline" to={`${basePath}/settings`}>Settings</Link> before enrolling students.</Notice>
        )}

        <section>
          <SectionHeading title="School at a glance" detail="Figures from your school register and admissions records" />
          {d.loading && !s ? <LoadingBlock text="Loading school summary…" /> : d.error ? <Notice tone="bad">{d.error}</Notice> : (
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              <KPI label="Active students" value={activeStudents} note="Currently active" icon={Users} tone="green" to={`${basePath}/students`} />
              <KPI label="Registered students" value={registeredStudents} note="Across all student statuses" icon={GraduationCap} tone="blue" to={`${basePath}/students`} />
              <KPI label="Open applications" value={openApplications} note="Submitted or under review" icon={ClipboardList} tone="gold" to={can('admissions.view') ? `${basePath}/admissions` : null} />
              <KPI label="Guardians" value={s?.guardians || 0} note="Guardian records" icon={UserRound} tone="green" to={can('guardians.view') ? `${basePath}/guardians` : null} />
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-4">
          <section className="rounded-2xl border border-[#E7E2D0] bg-white p-4 sm:p-5">
            <SectionHeading title="Enrolment by class" detail="Students enrolled in the current academic year" />
            {d.loading && !s ? <div className="space-y-3 py-2">{[1, 2, 3].map((x) => <div key={x} className="h-8 animate-pulse rounded-lg bg-[#F3F1E8]" />)}</div> :
              classes.length === 0 ? <EmptyBlock>No students are enrolled in the current year yet.</EmptyBlock> : (
                <div className="space-y-4">
                  {classes.map((item) => {
                    const count = Number(item.students || 0);
                    const width = Math.max(3, (count / maxClassCount) * 100);
                    return (
                      <div key={item.class_name}>
                        <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                          <span className="truncate font-medium text-[#405247]">{item.class_name}</span>
                          <span className="shrink-0 font-bold tabular-nums text-[#263D30]">{number(count)}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-[#F0EFE6]">
                          <div className="h-full rounded-full bg-[#39815A]" style={{ width: `${width}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
          </section>

          <section className="rounded-2xl border border-[#E7E2D0] bg-white p-4 sm:p-5">
            <SectionHeading title="Needs attention" detail="Items that may need a staff member" action={<span className="rounded-full bg-[#F6F2E4] px-2.5 py-1 text-[11px] font-bold text-[#786522]">{items.length}</span>} />
            {q.loading && !q.data ? <LoadingBlock text="Checking reminders…" /> : q.error ? <Notice tone="bad">Could not load the reminder queue: {q.error}</Notice> : items.length === 0 ? (
              <div className="flex items-start gap-3 rounded-xl bg-[#F3F7F2] p-3">
                <CheckCircle2 size={19} className="mt-0.5 shrink-0 text-[#39815A]" />
                <div><div className="text-sm font-semibold text-[#294B35]">You're all caught up</div><p className="mt-1 text-xs leading-relaxed text-[#6F806F]">There are no outstanding reminders from the information currently available.</p></div>
              </div>
            ) : (
              <div className="space-y-2">
                {items.slice(0, 5).map((item) => (
                  <Link key={item.id} to={item.to} className={`flex items-start gap-3 rounded-xl border p-3 transition hover:bg-[#FFFEF8] ${item.tone === 'warn' ? 'border-[#EBDDA7] bg-[#FFFCF0]' : 'border-[#E7E2D0] bg-white'}`}>
                    <AlertCircle size={17} className={`mt-0.5 shrink-0 ${item.tone === 'warn' ? 'text-[#A27A12]' : 'text-[#6D806F]'}`} />
                    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-[#344A3A]">{item.title}</span>{item.detail && <span className="mt-0.5 block text-xs text-[#858775]">{item.detail}</span>}</span>
                    <ChevronRight size={16} className="mt-0.5 shrink-0 text-[#A6A58F]" />
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        <section>
          <SectionHeading title="Quick access" detail="Shortcuts based on your Elimu permissions" />
          {actions.length === 0 ? <EmptyBlock>No shortcuts are available for your current role.</EmptyBlock> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
              {actions.slice(0, 9).map((action) => <ActionLink key={action.key} {...action} />)}
            </div>
          )}
        </section>

        {Object.keys(s?.data_quality || {}).length > 0 && can('students.manage') && (
          <section className="rounded-2xl border border-[#E7E2D0] bg-white p-4 sm:p-5">
            <SectionHeading title="Data quality" detail="Records that may need attention" />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Object.entries(s.data_quality).map(([key, count]) => (
                <div key={key} className="rounded-xl bg-[#F8F7F1] p-3">
                  <div className="text-xl font-bold tabular-nums text-[#263D30]">{number(count)}</div>
                  <div className="mt-1 text-xs text-[#788174]">{QUALITY_LABELS[key] || key}</div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </FitPage>
  );
}
