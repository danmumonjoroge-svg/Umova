// elimu/academic/components/ScopeBar.jsx — year / term / class / stream (/ subject) filters. Pass `show` to choose which.
import React from 'react';
import { fieldClass } from '../../../components/workspace/Sheet';

export default function ScopeBar({ s, show = ['year', 'term', 'class', 'stream'], subjects = [] }) {
  const { refs, scope, setScope, termsForYear, streamsForClass } = s; if (!refs) return null;
  const Sel = ({ label, value, onChange, options, any }) => (
    <label className="text-[11px] text-[#6F7461] min-w-[110px] flex-1">{label}<select className={`${fieldClass} !min-h-[40px]`} value={value} onChange={(e) => onChange(e.target.value)}>
      {any && <option value="">{any}</option>}{options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>);
  return (
    <div className="flex flex-wrap gap-2">
      {show.includes('year') && <Sel label="Year" value={scope.yearId} onChange={(v) => setScope({ yearId: v })} options={refs.years} />}
      {show.includes('term') && <Sel label="Term" value={scope.termId} onChange={(v) => setScope({ termId: v })} options={termsForYear} />}
      {show.includes('class') && <Sel label="Class" value={scope.classId} onChange={(v) => setScope({ classId: v })} options={refs.classes} any="Choose class" />}
      {show.includes('stream') && <Sel label="Stream" value={scope.streamId} onChange={(v) => setScope({ streamId: v })} options={streamsForClass} any="All streams" />}
      {show.includes('subject') && <Sel label="Subject" value={scope.subjectId} onChange={(v) => setScope({ subjectId: v })} options={subjects} any="All subjects" />}
    </div>
  );
}
