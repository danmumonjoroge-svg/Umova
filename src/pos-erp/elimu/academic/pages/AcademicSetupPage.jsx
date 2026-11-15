// elimu/academic/pages/AcademicSetupPage.jsx — first-run defaults, academic roles (owner only), and the school's result rules.
import React, { useState } from 'react';
import { Settings } from 'lucide-react';
import { FitPage, LoadingBlock, formCard, inputCls, saveBtnCls } from '../../../components/CardKit';
import { useLoad } from '../../../components/network/networkKit';
import { usePosErpAuth } from '../../../auth/usePosErpAuth';
import { academicService } from '../services/academicService';
import AccessGate from '../components/AccessGate';
import Note from '../components/Note';

const ROLES = [['HEADTEACHER', 'Head teacher'], ['ACADEMIC_ADMIN', 'Academic admin'], ['EXAMS_OFFICER', 'Exams officer'], ['TEACHER', 'Teacher']];
export default function AcademicSetupPage() {
  const { tenant } = usePosErpAuth();
  const staff = useLoad(() => academicService.listStaff(), []); const settings = useLoad(() => academicService.getSettings(), []);
  const [msg, setMsg] = useState(null); const [draft, setDraft] = useState(null);
  const run = async (fn, ok) => { setMsg(null); try { await fn(); setMsg({ tone: 'good', text: ok }); staff.reload(); settings.reload(); } catch (e) { setMsg({ tone: 'bad', text: e.message }); } };
  const st = draft || settings.data;
  return (
    <FitPage title="Academic set-up" subtitle="Roles and result rules" icon={Settings}>
      <AccessGate need="config.manage">{(a) => (
        <div className="space-y-3">
          {msg && <Note tone={msg.tone}>{msg.text}</Note>}
          <div className={formCard}><div className="font-bold text-sm">First-run defaults</div><p className="text-xs text-[#6F7461] my-1">Adds the usual assessment types (CAT, Quiz, Exam…) and an editable example grading scheme. Existing data is never changed.</p>
            <button className={`${saveBtnCls} px-4`} onClick={() => run(academicService.seedDefaults, 'Defaults added where missing.')}>Add defaults</button></div>
          <div className={formCard}><div className="font-bold text-sm mb-1">Roles {!a.isOwner && <span className="text-xs font-normal text-[#6F7461]">(only the business owner can change roles)</span>}</div>
            {staff.loading && <LoadingBlock />}
            {(staff.data || []).map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1.5 border-t border-[#F0E9C8]"><div className="w-40 text-sm">{p.name}<span className="text-[10px] text-[#6F7461]"> ({p.pos_role})</span></div>
                {ROLES.map(([k, l]) => <label key={k} className="text-xs flex items-center gap-1"><input type="checkbox" disabled={!a.isOwner} checked={(p.academic_roles || []).includes(k)} onChange={(e) => run(() => academicService.setRole(p.id, k, e.target.checked), `${p.name}: ${l} ${e.target.checked ? 'given' : 'removed'}.`)} />{l}</label>)}</div>))}
          </div>
          {st && <div className={formCard}><div className="font-bold text-sm mb-1">Result rules</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-[#6F7461]">Absent counts as<select className={inputCls} value={st.absent_policy} onChange={(e) => setDraft({ ...st, absent_policy: e.target.value })}><option value="ZERO">Zero marks</option><option value="EXCLUDE">Left out (weights re-scaled)</option></select></label>
              <label className="text-xs text-[#6F7461]">Not submitted counts as<select className={inputCls} value={st.not_submitted_policy} onChange={(e) => setDraft({ ...st, not_submitted_policy: e.target.value })}><option value="ZERO">Zero marks</option><option value="EXCLUDE">Left out (weights re-scaled)</option></select></label>
              <label className="text-xs text-[#6F7461]">Head teacher's name<input className={inputCls} value={st.headteacher_name || ''} onChange={(e) => setDraft({ ...st, headteacher_name: e.target.value })} /></label>
              <label className="text-xs text-[#6F7461]">Title on report cards<input className={inputCls} value={st.headteacher_title || ''} onChange={(e) => setDraft({ ...st, headteacher_title: e.target.value })} /></label>
              <label className="text-xs text-[#6F7461]">School motto<input className={inputCls} value={st.school_motto || ''} onChange={(e) => setDraft({ ...st, school_motto: e.target.value })} /></label>
              <label className="text-xs text-[#6F7461]">Report card footer<input className={inputCls} value={st.report_footer || ''} onChange={(e) => setDraft({ ...st, report_footer: e.target.value })} /></label>
              <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={st.show_positions} onChange={(e) => setDraft({ ...st, show_positions: e.target.checked })} />Show class position</label>
              <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={st.show_grade_points} onChange={(e) => setDraft({ ...st, show_grade_points: e.target.checked })} />Show grade points</label>
            </div>
            <p className="text-[11px] text-[#6F7461] mt-1">A mark still waiting (pending) always blocks the result; exempted students are always left out. These rules apply to results calculated from now on; approved results never change.</p>
            <button className={`${saveBtnCls} px-4 mt-2`} disabled={!draft} onClick={() => run(async () => { const { tenant_id, updated_at, updated_by, ...patch } = draft; await academicService.saveSettings(tenant.id, patch); setDraft(null); }, 'Saved.')}>Save rules</button></div>}
        </div>)}
      </AccessGate>
    </FitPage>
  );
}
