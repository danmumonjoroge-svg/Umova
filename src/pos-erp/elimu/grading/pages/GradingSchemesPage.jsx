// elimu/grading/pages/GradingSchemesPage.jsx — grading schemes and bands (nothing hard-coded). A scheme already used by results is
// locked by the database: use "New version" so old results keep the bands they were graded with.
import React, { useState } from 'react';
import { PenLine } from 'lucide-react';
import { FitPage, LoadingBlock, formCard, inputCls, saveBtnCls, Pill } from '../../../components/CardKit';
import { useLoad } from '../../../components/network/networkKit';
import { usePosErpAuth } from '../../../auth/usePosErpAuth';
import { gradingService } from '../services/gradingService';
import { validateScheme } from '../utils/gradingEngine';
import AccessGate from '../../academic/components/AccessGate';
import Note from '../../academic/components/Note';

export default function GradingSchemesPage() {
  const { tenant } = usePosErpAuth(); const { data, loading, error, reload } = useLoad(() => gradingService.listSchemes(), []);
  const [edit, setEdit] = useState(null); const [msg, setMsg] = useState(null);
  const run = async (fn, ok) => { setMsg(null); try { const r = await fn(); if (r && r.ok === false) setMsg({ tone: 'warn', text: (r.problems || []).join(' ') }); else setMsg({ tone: 'good', text: ok }); setEdit(null); reload(); } catch (e) { setMsg({ tone: 'bad', text: /locked/i.test(e.message) ? `${e.message}` : e.message }); } };
  const problems = edit ? validateScheme(edit.rules, edit.percent_decimals) : [];
  const setRule = (i, k, v) => setEdit({ ...edit, rules: edit.rules.map((r, j) => (j === i ? { ...r, [k]: v } : r)) });
  return (
    <FitPage title="Grading schemes" subtitle="Grades, ranges and points" icon={PenLine}
      action={<button className="text-xs font-bold text-white bg-[#1F6B45] rounded-lg px-3 min-h-[36px]" onClick={() => { const name = window.prompt('Name of the new scheme?'); if (name) run(() => gradingService.createScheme(tenant.id, { name }), 'Scheme created. Add its grade bands.'); }}>New scheme</button>}>
      <AccessGate need="config.manage">
        {msg && <Note tone={msg.tone}>{msg.text}</Note>}{loading && <LoadingBlock />}{error && <Note tone="bad">{error.message}</Note>}
        <div className="space-y-2">{(data || []).map((s) => (
          <div key={s.id} className={`${formCard} ${s.is_active ? '' : 'opacity-60'}`}>
            <div className="flex flex-wrap items-center gap-2"><b>{s.name}</b><Pill>v{s.version}</Pill>{s.is_default && <Pill tone="good">Default</Pill>}{!s.is_active && <Pill tone="neutral">Retired</Pill>}
              <span className="flex-1" />
              {s.is_active && !s.is_default && <button className="text-xs underline" onClick={() => run(() => gradingService.setDefault(s.id), 'Now the default scheme.')}>Make default</button>}
              {s.is_active && <button className="text-xs underline" onClick={() => setEdit({ ...s, rules: s.rules.map((r) => ({ ...r })) })}>Edit bands</button>}
              {s.is_active && <button className="text-xs underline" onClick={() => run(() => gradingService.newVersion(s.id), 'New version created. The old one is kept for past results.')}>New version</button>}</div>
            <table className="w-full text-xs mt-2"><tbody>{s.rules.map((r) => <tr key={r.id} className="border-t border-[#F0E9C8]"><td className="py-1 font-bold w-12">{r.grade}</td><td>{r.min_percent}–{r.max_percent}%</td><td>{r.grade_point ?? ''} pts</td><td className="text-[#6F7461]">{r.descriptor}</td><td>{r.is_pass ? '' : 'fail'}</td></tr>)}</tbody></table>
          </div>))}</div>
        {edit && (
          <div className={formCard}><div className="font-bold text-sm mb-2">Bands for “{edit.name}”</div>
            <div className="grid grid-cols-[48px_1fr_1fr_1fr_2fr_auto] gap-1.5 text-[10px] text-[#6F7461] mb-1"><span>Grade</span><span>From %</span><span>To %</span><span>Points</span><span>Descriptor</span><span>Pass</span></div>
            {edit.rules.map((r, i) => (<div key={i} className="grid grid-cols-[48px_1fr_1fr_1fr_2fr_auto] gap-1.5 mb-1">
              <input className={inputCls} value={r.grade} onChange={(e) => setRule(i, 'grade', e.target.value)} /><input className={inputCls} inputMode="decimal" value={r.min_percent} onChange={(e) => setRule(i, 'min_percent', e.target.value)} />
              <input className={inputCls} inputMode="decimal" value={r.max_percent} onChange={(e) => setRule(i, 'max_percent', e.target.value)} /><input className={inputCls} inputMode="decimal" value={r.grade_point ?? ''} onChange={(e) => setRule(i, 'grade_point', e.target.value)} />
              <input className={inputCls} value={r.descriptor || ''} onChange={(e) => setRule(i, 'descriptor', e.target.value)} /><input type="checkbox" checked={r.is_pass ?? true} onChange={(e) => setRule(i, 'is_pass', e.target.checked)} /></div>))}
            <button className="text-xs underline" onClick={() => setEdit({ ...edit, rules: [...edit.rules, { grade: '', min_percent: 0, max_percent: 0, grade_point: '', descriptor: '', is_pass: true }] })}>+ Add band</button>
            {problems.map((p, i) => <div key={i} className="text-xs text-[#A14B00] mt-1">⚠ {p}</div>)}
            <div className="flex gap-2 mt-2"><button className={`${saveBtnCls} px-4`} disabled={problems.length > 0} onClick={() => run(() => gradingService.saveRules(tenant.id, edit.id, edit.rules, edit.percent_decimals), 'Bands saved.')}>Save bands</button><button className="text-sm underline" onClick={() => setEdit(null)}>Cancel</button></div>
          </div>)}
      </AccessGate>
    </FitPage>
  );
}
