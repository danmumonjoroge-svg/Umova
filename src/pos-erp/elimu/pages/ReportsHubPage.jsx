import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight, BarChart3, CalendarCheck, GraduationCap, Wallet,
  ClipboardCheck, FileText, ChevronRight,
} from 'lucide-react';
import { FitPage, Notice } from '../services/platform.js';

const REPORT_GROUPS = [
  {
    key: 'attendance',
    title: 'Attendance reports',
    description: 'Daily registers, class and student history, absentee lists, late arrivals and attendance summaries.',
    detail: 'Attendance records',
    to: '/reports',
    icon: CalendarCheck,
    tone: 'green',
  },
  {
    key: 'academic-results',
    title: 'Academic results',
    description: 'Review term results and the assessment outcomes already available to your academic role.',
    detail: 'Assessments and results',
    to: '/academics/results',
    icon: GraduationCap,
    tone: 'blue',
  },
  {
    key: 'report-cards',
    title: 'Report cards',
    description: 'Prepare, review and access learner report cards through the existing report-card workflow.',
    detail: 'Learner performance records',
    to: '/academics/report-cards',
    icon: FileText,
    tone: 'gold',
  },
  {
    key: 'finance',
    title: 'Finance reports',
    description: 'Collections, debtors, fee summaries, balances, income and expenditure, and budget reports.',
    detail: 'Confirmed finance records',
    to: '/school-finance/reports',
    icon: Wallet,
    tone: 'purple',
  },
];

const TONES = {
  green: 'bg-[#EAF3EC] text-[#1F6B45]',
  blue: 'bg-[#EAF0F5] text-[#45647A]',
  gold: 'bg-[#F8F1D9] text-[#92700E]',
  purple: 'bg-[#F0ECF8] text-[#65528B]',
};

function ReportCard({ item }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      className="group flex h-full min-w-0 flex-col rounded-2xl border border-[#E7E2D0] bg-white p-4 shadow-[0_2px_10px_rgba(35,56,43,0.035)] transition hover:-translate-y-0.5 hover:border-[#D6C57E] hover:shadow-[0_8px_24px_rgba(35,56,43,0.07)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${TONES[item.tone]}`}><Icon size={20} /></span>
        <ArrowUpRight size={17} className="text-[#A6A58F] transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </div>
      <h2 className="mt-4 text-base font-bold text-[#263D30]">{item.title}</h2>
      <p className="mt-1.5 flex-1 text-sm leading-relaxed text-[#73796D]">{item.description}</p>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-[#F0EEE5] pt-3">
        <span className="text-xs font-medium text-[#858775]">{item.detail}</span>
        <span className="inline-flex items-center gap-1 text-xs font-bold text-[#1F6B45]">Open <ChevronRight size={14} /></span>
      </div>
    </Link>
  );
}

export default function ReportsHubPage({ basePath = '/elimu' }) {
  return (
    <FitPage title="Reports centre" subtitle="One place to open the reports available across your school modules.">
      <div className="space-y-5 pb-4">
        <section className="relative overflow-hidden rounded-2xl bg-[#173D2B] p-5 text-white sm:p-6">
          <div className="pointer-events-none absolute -right-8 -top-12 h-40 w-40 rounded-full border-[20px] border-white/5" />
          <div className="relative flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[#E8D58C]"><BarChart3 size={22} /></span>
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#E8D58C]">School insights</div>
              <h2 className="mt-1 text-xl font-bold">Reports, grouped by what they measure.</h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/75">Choose a module to use its existing filters, report definitions and export tools. Access is checked again inside each module.</p>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {REPORT_GROUPS.map((item) => <ReportCard key={item.key} item={{ ...item, to: `${basePath}${item.to}` }} />)}
        </div>

        <Notice tone="info">
          Reports continue to use their own module data sources and permissions. This catalogue does not combine attendance, academic and finance figures into a new total or apply a shared date filter across modules.
        </Notice>
      </div>
    </FitPage>
  );
}
