// elimu/attendance/pages/AttendanceSettingsPage.jsx -- school hours, grace period, deadlines, notification options, custom statuses, reasons.
import React, { useState } from 'react';
import { useElimu } from '../../shared/hooks/ElimuContext';
import { useAttendanceConfig } from '../hooks/useAttendanceConfig';
import { FitPage, Field, TimeField, LoadingBlock, Notice, ErrorLine, fieldClass, btn, btnPrimary, Pill } from '../../shared/components/kit';
import { attendanceService } from '../services/attendanceService';
import { DAY_SHORT } from '../../shared/utils/time';

const CATS = ['ILLNESS', 'FAMILY_MATTER', 'SCHOOL_ACTIVITY', 'TRANSPORT_PROBLEM', 'DISCIPLINARY', 'UNKNOWN', 'OTHER'];

export default function AttendanceSettingsPage() {
  const { tenantId, businessId, userId, can } = useElimu(); const cfg = useAttendanceConfig();
  const [v, setV] = useState(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null); const [err, setErr] = useState(null);
  const s = v || cfg.settings; const edit = can('settings.manage');
  const set = (k, val) => setV({ ...s, [k]: val });
  const num = (k) => (e) => set(k, e.target.value === '' ? null : Number(e.target.value));
  const toggleDay = (d) => set('weekend_days', s.weekend_days.includes(d) ? s.weekend_days.filter((x) => x !== d) : [...s.weekend_days, d].sort());
  const save = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const { id, tenant_id, business_id, created_at, updated_at, updated_by, ...values } = s;
      await attendanceService.saveSettings(tenantId, businessId, values, userId); setMsg('Settings saved. They apply from the next register.'); setV(null); cfg.reload();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  if (cfg.loading) return <FitPage title="Attendance settings"><LoadingBlock /></FitPage>;
  const chk = (k, label) => <label className="flex items-center gap-2 text-sm py-1"><input type="checkbox" disabled={!edit} checked={!!s[k]} onChange={(e) => set(k, e.target.checked)} /> {label}</label>;
  return (
    <FitPage title="Attendance settings" subtitle="Changes are recorded in the audit log">
      {!edit && <Notice tone="good">You can view these settings. Only the school administrator can change them.</Notice>}
      <div className="grid grid-cols-2 gap-x-3">
        <TimeField label="School opens" value={s.opening_time} onChange={(x) => set('opening_time', x)} />
        <TimeField label="School closes" value={s.closing_time} onChange={(x) => set('closing_time', x)} />
        <Field label="Grace period (minutes)" hint="Late only after this many minutes past the start"><input type="number" min="0" className={fieldClass} disabled={!edit} value={s.grace_minutes ?? ''} onChange={num('grace_minutes')} /></Field>
        <TimeField label="Register due by" value={s.attendance_deadline} onChange={(x) => set('attendance_deadline', x)} />
      </div>
      <Field label="Days with no school"><div className="flex gap-1.5 flex-wrap">{[1, 2, 3, 4, 5, 6, 7].map((d) => <button key={d} type="button" disabled={!edit} onClick={() => toggleDay(d)} className={`${btn} !min-h-[40px] !px-3 ${s.weekend_days.includes(d) ? '!bg-[#F3EFD6]' : ''}`}>{DAY_SHORT[d]}</button>)}</div></Field>
      <Field label="Take attendance"><select className={fieldClass} disabled={!edit} value={s.daily_mode} onChange={(e) => set('daily_mode', e.target.value)}><option value="DAILY">Once a day</option><option value="LESSON">Per lesson</option><option value="BOTH">Both</option></select></Field>
      {chk('require_submit_all_marked', 'Do not allow submit while students are unmarked')}
      {chk('amendment_requires_reason', 'Require a reason when correcting a submitted register')}
      {chk('excused_counts_as_present', 'Count excused students as present in attendance %')}
      {chk('early_departure_requires_approval', 'Early departure needs approval')}
      <div className="grid grid-cols-3 gap-x-2 mt-2">
        <Field label="Repeated: days in a row"><input type="number" min="2" className={fieldClass} disabled={!edit} value={s.repeated_absence_threshold ?? ''} onChange={num('repeated_absence_threshold')} /></Field>
        <Field label="…or absences"><input type="number" min="2" className={fieldClass} disabled={!edit} value={s.repeated_absence_count ?? ''} onChange={num('repeated_absence_count')} /></Field>
        <Field label="…within days"><input type="number" min="1" className={fieldClass} disabled={!edit} value={s.repeated_absence_window_days ?? ''} onChange={num('repeated_absence_window_days')} /></Field>
      </div>
      <div className="text-xs font-bold uppercase text-[#6F7461] mt-2">Prepare guardian messages for</div>
      {chk('notify_absent', 'Absent')}{chk('notify_late', 'Late')}{chk('notify_left_early', 'Left early')}{chk('notify_repeated', 'Repeated absence')}{chk('notify_correction', 'Corrections')}
      <Field label="Messages" hint="Messages are only prepared. Staff review and send them; nothing is sent automatically."><select className={fieldClass} disabled={!edit} value={s.notify_mode} onChange={(e) => set('notify_mode', e.target.value)}><option value="PREPARE">Prepare for staff to send</option><option value="OFF">Off</option></select></Field>
      <ErrorLine error={err} />{msg && <Notice tone="good">{msg}</Notice>}
      {edit && <button className={`${btnPrimary} w-full`} disabled={busy || !v} onClick={save}>{busy ? 'Saving…' : 'Save settings'}</button>}
      <ReasonsAndStatuses cfg={cfg} edit={edit} tenantId={tenantId} businessId={businessId} />
    </FitPage>
  );
}

function ReasonsAndStatuses({ cfg, edit, tenantId, businessId }) {
  const [st, setSt] = useState({ code: '', label: '', status_group: 'PRESENT' }); const [rs, setRs] = useState({ code: '', label: '', category: 'OTHER' }); const [err, setErr] = useState(null);
  const addStatus = async () => { setErr(null); try { await attendanceService.saveStatus({ tenant_id: tenantId, business_id: businessId, code: st.code.trim().toUpperCase().replace(/\s+/g, '_'), label: st.label.trim(), status_group: st.status_group }); setSt({ code: '', label: '', status_group: 'PRESENT' }); cfg.reload(); } catch (e) { setErr(e.message); } };
  const addReason = async () => { setErr(null); try { await attendanceService.saveReason({ tenant_id: tenantId, business_id: businessId, code: rs.code.trim().toUpperCase().replace(/\s+/g, '_'), label: rs.label.trim(), category: rs.category }); setRs({ code: '', label: '', category: 'OTHER' }); cfg.reload(); } catch (e) { setErr(e.message); } };
  return (
    <div className="mt-5">
      <ErrorLine error={err} />
      <h3 className="text-sm font-bold text-[#23382B] mb-1">Your own statuses</h3>
      <p className="text-xs text-[#6F7461] mb-1.5">Built-in statuses (Present, Absent, Late, Excused, Sick, Left early) cannot be changed. Each of yours counts as Present, Absent, Excused or Neutral.</p>
      <div className="flex flex-wrap gap-1.5 mb-2">{cfg.custom.map((c) => <Pill key={c.id} tone="neutral">{c.label} · {c.status_group.toLowerCase()}</Pill>)}{cfg.custom.length === 0 && <span className="text-xs text-[#8A8F78]">None yet.</span>}</div>
      {edit && <div className="grid grid-cols-[1fr_1fr] gap-2"><input className={fieldClass} placeholder="Code, e.g. ON_TRIP" value={st.code} onChange={(e) => setSt({ ...st, code: e.target.value })} /><input className={fieldClass} placeholder="Label" value={st.label} onChange={(e) => setSt({ ...st, label: e.target.value })} />
        <select className={fieldClass} value={st.status_group} onChange={(e) => setSt({ ...st, status_group: e.target.value })}>{['PRESENT', 'ABSENT', 'EXCUSED', 'NEUTRAL'].map((g) => <option key={g}>{g}</option>)}</select><button className={btn} disabled={!st.code || !st.label} onClick={addStatus}>Add status</button></div>}
      <h3 className="text-sm font-bold text-[#23382B] mt-4 mb-1">Reasons</h3>
      <div className="flex flex-wrap gap-1.5 mb-2">{(cfg.allReasons || cfg.reasons).map((r) => <Pill key={r.id} tone={r.is_active ? 'neutral' : 'warn'}>{r.label}</Pill>)}</div>
      {edit && <div className="grid grid-cols-[1fr_1fr] gap-2"><input className={fieldClass} placeholder="Code" value={rs.code} onChange={(e) => setRs({ ...rs, code: e.target.value })} /><input className={fieldClass} placeholder="Label" value={rs.label} onChange={(e) => setRs({ ...rs, label: e.target.value })} />
        <select className={fieldClass} value={rs.category} onChange={(e) => setRs({ ...rs, category: e.target.value })}>{CATS.map((g) => <option key={g}>{g}</option>)}</select><button className={btn} disabled={!rs.code || !rs.label} onClick={addReason}>Add reason</button></div>}
    </div>
  );
}
