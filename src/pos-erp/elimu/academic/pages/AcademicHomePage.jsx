// elimu/academic/pages/AcademicHomePage.jsx — entry point of the module. Shows only what the person may use.
import React from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, BookOpen, Users, ClipboardList, PenLine, Award, FileText, Settings, ArrowUpRight } from 'lucide-react';
import { FitPage } from '../../../components/CardKit';
import AccessGate from '../components/AccessGate';

const TILES = [
  { to: 'assessments', icon: ClipboardList, title: 'Assessments', text: 'Create tests and exams, set marks and weights', need: 'assessment.create' },
  { to: 'results', icon: Award, title: 'Term results', text: 'Calculate, check and rank results', need: 'view.all', alt: 'is_class_teacher' },
  { to: 'report-cards', icon: FileText, title: 'Report cards', text: 'Review, approve, publish, print and notify', need: 'view.all', alt: 'is_class_teacher' },
  { to: 'subjects', icon: BookOpen, title: 'Subjects', text: 'Subjects, codes and levels', need: 'config.manage' },
  { to: 'allocations', icon: Users, title: 'Teachers & classes', text: 'Who teaches what; class teachers', need: 'config.manage' },
  { to: 'grading', icon: PenLine, title: 'Grading schemes', text: 'Grade bands and points', need: 'config.manage' },
  { to: 'setup', icon: Settings, title: 'Academic set-up', text: 'Roles, rules and school details', need: 'config.manage' },
];
export default function AcademicHomePage() {
  return (
    <FitPage title="Academics & exams" subtitle="Marks, results and report cards" icon={GraduationCap}>
      <AccessGate>{(a) => (
        <>
        <div className="mb-4 rounded-2xl border border-[#DCE9DF] bg-gradient-to-br from-[#F1F8F3] to-white p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#DCEFE2] text-[#1F6B45]"><GraduationCap size={23} /></span>
            <div className="min-w-0"><div className="text-sm font-semibold text-[#1D3B2A]">Academic workspace</div><p className="mt-1 max-w-2xl text-sm text-[#637267]">Manage assessments, marks, results and the academic structure. Available tools depend on your school role.</p></div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {a.access.is_teacher && <Tile t={{ to: 'my-assessments', icon: PenLine, title: 'My marks entry', text: 'Assessments for the classes you teach' }} />}
          {TILES.filter((t) => a.can(t.need) || (t.alt && a.access?.[t.alt])).map((t) => <Tile key={t.to} t={t} />)}
        </div>
        </>)}
      </AccessGate>
    </FitPage>
  );
}
const Tile = ({ t }) => (
  <Link to={t.to} className="group flex min-h-[104px] items-start gap-3 rounded-2xl border border-[#E1E8E1] bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[#A9CBB3] hover:bg-[#FAFCFA] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2E7D52]">
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#E8F2EA] text-[#2E7D52]"><t.icon size={21} /></span><span className="min-w-0 flex-1"><span className="block font-bold text-[#23382B]">{t.title}</span><span className="mt-1 block text-xs leading-5 text-[#6F7461]">{t.text}</span></span><ArrowUpRight size={17} className="mt-0.5 shrink-0 text-[#8A9B8D] transition group-hover:text-[#2E7D52]" /></Link>);
