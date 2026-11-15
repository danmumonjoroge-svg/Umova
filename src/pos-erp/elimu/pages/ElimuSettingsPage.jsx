// School setup: academic years & terms, the switches in elimu_settings, custom statuses, and a plain-language table of school roles.
import React, { useState } from 'react';
import { FitPage, LoadingBlock, Notice, Sheet, fieldClass, saveBtnCls } from '../services/platform.js';
import { setupService } from '../services/ElimuSetupService.js';
import { enrollmentService } from '../services/ElimuEnrollmentService.js';
import { useAsync } from '../hooks/useAsync.js';
import { useElimuAccess, useElimuSetup } from '../hooks/useElimu.js';
import { Field, StatusPill } from '../components/ui.jsx';
import { SETTING_DEFS } from '../utils/settings.js';
import { SCHOOL_ROLES } from '../utils/permissions.js';
import { QUALITY_LABELS } from '../communication/notificationCatalog.js';
import { formatDate } from '../utils/format.js';
import { friendlyError } from '../utils/validation.js';

const Card = ({ title, children, action }) => <section className="bg-white border border-[#E3DBB8] rounded-xl p-3 mb-3"><div className="flex items-center justify-between mb-2"><h2 className="text-sm font-semibold">{title}</h2>{action}</div>{children}</section>;

export default function ElimuSettingsPage() {
  const { can } = useElimuAccess(); const setup = useElimuSetup(); const [err, setErr] = useState(null); const [sheet, setSheet] = useState(null);
  const years = useAsync(() => setupService.years(), []); const terms = useAsync(() => setupService.terms(), []);
  const sts = useAsync(() => setupService.studentStatuses(), []); const ads = useAsync(() => setupService.admissionStatuses(), []);
  const dq = useAsync(() => enrollmentService.dataQuality(), []);
  const school = useAsync(() => setupService.mySchool(), []);
  if (setup.loading && !setup.data) return <LoadingBlock />;
  const toggle = async (k, v) => { try { await setupService.saveSettings(setup.settingsRow.id, { [k]: v }); setup.reload(); } catch (e) { setErr(friendlyError(e)); } };
  const manage = can('structure.manage');
  const counts = (dq.data || []).reduce((a, r) => ({ ...a, [r.issue]: (a[r.issue] || 0) + 1 }), {});
  return (
    <FitPage title="School settings">
      {err && <Notice tone="bad">{err}</Notice>}
      <Card title="School code">
        <p className="text-2xl font-bold tracking-widest text-[#1F6B45]">{school.data?.school_code || '------'}</p>
        <p className="text-sm text-slate-500 mt-1">Permanent and unique to your school. Parents and payers quote <b>{school.data?.school_code || 'CODE'}-ADMNO</b> (for example {school.data?.school_code || 'E7K3QX'}-S100) so a payment can never land on another school's student, even when admission numbers match.</p>
      </Card>
      <Card title="Academic years" action={manage && <button type="button" className="text-sm font-semibold text-[#1F6B45] underline" onClick={() => setSheet({ kind: 'year' })}>Add year</button>}>
        {(years.data || []).map((y) => <div key={y.id} className="py-2 border-b border-[#EFE8C8] last:border-0"><div className="flex items-center justify-between text-sm"><span><b>{y.name}</b> <span className="text-xs text-slate-500">{formatDate(y.start_date)} – {formatDate(y.end_date)}</span></span><span className="flex items-center gap-2"><StatusPill category={y.status === 'CURRENT' ? 'ACTIVE' : 'ALUMNI'} label={y.status.toLowerCase()} />{manage && y.status === 'PLANNED' && <button type="button" className="text-xs underline" onClick={async () => { try { await setupService.saveYear({ id: y.id, status: 'CURRENT' }); years.reload(); setup.reload(); } catch (e) { setErr(friendlyError(e)); } }}>Make current</button>}</span></div>
          <div className="text-xs text-slate-500 mt-1">{(terms.data || []).filter((t) => t.academic_year_id === y.id).map((t) => `${t.name} (${formatDate(t.start_date)} – ${formatDate(t.end_date)})`).join(' · ') || 'No terms yet'}{manage && <button type="button" className="ml-2 underline" onClick={() => setSheet({ kind: 'term', year: y })}>Add term</button>}</div></div>)}
        {years.data?.length === 0 && <p className="text-sm text-slate-500">No academic year yet. Add one, then make it current.</p>}
      </Card>
      <Card title="How Elimu behaves">{SETTING_DEFS.map((d) => <label key={d.key} className="flex items-start justify-between gap-3 py-2 text-sm"><span>{d.label}<span className="block text-[11px] text-slate-500">{d.hint}</span></span><input type="checkbox" className="mt-1" disabled={!can('settings.manage')} checked={!!setup.settings[d.key]} onChange={(e) => toggle(d.key, e.target.checked)} /></label>)}</Card>
      <Card title="Student statuses"><p className="text-[11px] text-slate-500 mb-2">Rename or add your own. Each one belongs to a fixed group so reports stay reliable.</p>{(sts.data || []).map((s) => <div key={s.id} className="flex justify-between py-1 text-sm"><span>{s.label}</span><span className="text-xs text-slate-500">{s.category.toLowerCase()}{s.is_system ? ' · built in' : ''}</span></div>)}</Card>
      <Card title="Application stages">{(ads.data || []).map((s) => <div key={s.id} className="flex justify-between py-1 text-sm"><span>{s.label}</span><span className="text-xs text-slate-500">{s.category.toLowerCase().replace('_', ' ')}</span></div>)}</Card>
      <Card title="Records to tidy up">{Object.keys(counts).length === 0 ? <p className="text-sm text-slate-500">Nothing to fix.</p> : Object.entries(counts).map(([k, n]) => <div key={k} className="flex justify-between py-1 text-sm"><span>{QUALITY_LABELS[k] || k}</span><b>{n}</b></div>)}</Card>
      <Card title="Who can do what"><p className="text-[11px] text-slate-500 mb-2">Set each person’s role in Staff. This table shows which Umova role fits each school job.</p>{SCHOOL_ROLES.map((r) => <div key={r.key} className="py-2 border-b border-[#EFE8C8] last:border-0 text-sm"><div className="font-medium">{r.label} <span className="text-xs font-normal text-slate-500">· {r.umovaRole}</span></div><div className="text-xs text-slate-500">{r.does}</div></div>)}</Card>
      {sheet && <PeriodSheet sheet={sheet} onClose={() => setSheet(null)} onSaved={() => { years.reload(); terms.reload(); setup.reload(); }} />}
    </FitPage>
  );
}

function PeriodSheet({ sheet, onClose, onSaved }) {
  const isYear = sheet.kind === 'year'; const [f, setF] = useState({ name: '', start_date: '', end_date: '' }); const [err, setErr] = useState(null);
  const save = async () => {
    try {
      if (isYear) await setupService.saveYear({ name: f.name.trim(), start_date: f.start_date, end_date: f.end_date, status: 'PLANNED' });
      else { const n = ((await setupService.terms(sheet.year.id)) || []).length + 1; await setupService.saveTerm({ academic_year_id: sheet.year.id, term_number: n, name: f.name.trim() || `Term ${n}`, start_date: f.start_date, end_date: f.end_date }); }
      onSaved(); onClose();
    } catch (e) { setErr(friendlyError(e)); }
  };
  return (
    <Sheet title={isYear ? 'New academic year' : `New term in ${sheet.year.name}`} onClose={onClose}>{err && <Notice tone="bad">{err}</Notice>}
      <Field label="Name"><input className={fieldClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={isYear ? '2027' : 'Term 1'} /></Field>
      <Field label="Starts"><input type="date" className={fieldClass} value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
      <Field label="Ends"><input type="date" className={fieldClass} value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
      <button type="button" className={`${saveBtnCls} w-full`} disabled={!f.start_date || !f.end_date || (isYear && !f.name.trim())} onClick={save}>Save</button>
    </Sheet>
  );
}
