// elimu/academic/pages/AcademicHomePage.jsx — entry point of the module. Shows only what the person may use.
import React from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, BookOpen, Users, ClipboardList, PenLine, Award, FileText, Settings } from 'lucide-react';
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
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {a.access.is_teacher && <Tile t={{ to: 'my-assessments', icon: PenLine, title: 'My marks entry', text: 'Assessments for the classes you teach' }} />}
          {TILES.filter((t) => a.can(t.need) || (t.alt && a.access?.[t.alt])).map((t) => <Tile key={t.to} t={t} />)}
        </div>)}
      </AccessGate>
    </FitPage>
  );
}
const Tile = ({ t }) => (
  <Link to={t.to} className="flex gap-3 items-start bg-white border border-[#E3DBB8] border-t-[3px] border-t-[#C9A227] rounded-xl p-3 hover:bg-[#FBF7E4]">
    <t.icon size={22} className="text-[#2E7D52] shrink-0 mt-0.5" /><div><div className="font-bold text-[#23382B]">{t.title}</div><div className="text-xs text-[#6F7461]">{t.text}</div></div></Link>);
