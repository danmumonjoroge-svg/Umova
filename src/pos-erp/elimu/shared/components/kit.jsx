// elimu/shared/components/kit.jsx -- small shared UI pieces. Re-uses the POS CardKit/Sheet styling (gold + green); no second design system.
import React from 'react';
import { Pill, FitPage, LoadingBlock, EmptyBlock, Notice, inputCls, saveBtnCls, formCard, MiniStats, TextBtn } from '../../../components/CardKit';
import Sheet, { fieldClass } from '../../../components/workspace/Sheet';
import { statusMeta, COMPLETION_LABELS, COMPLETION_TONE } from '../../attendance/utils/statuses';

export { Pill, FitPage, LoadingBlock, EmptyBlock, Notice, inputCls, saveBtnCls, formCard, MiniStats, TextBtn, Sheet, fieldClass };

export const StatusPill = ({ status, custom }) => { const m = statusMeta(status, custom); return <Pill tone={m.tone}>{m.label}</Pill>; };
export const CompletionPill = ({ state }) => <Pill tone={COMPLETION_TONE[state] || 'neutral'}>{COMPLETION_LABELS[state] || state}</Pill>;

export const btn = 'min-h-[44px] px-4 rounded-xl text-sm font-semibold border border-[#E3DBB8] bg-white text-[#23382B] active:bg-[#F3EFD6] disabled:opacity-40';
export const btnPrimary = 'min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-[#1F6B45] text-white border-b-2 border-[#C9A227] disabled:opacity-50';
export const btnDanger = 'min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-[#B23A2E] text-white disabled:opacity-50';

export function Field({ label, children, hint }) {
  return (<label className="block mb-2.5"><span className="block text-[11.5px] font-bold uppercase tracking-wide text-[#6F7461] mb-1">{label}</span>{children}{hint && <span className="block text-[11.5px] text-[#8A8F78] mt-0.5">{hint}</span>}</label>);
}
export const DateField = ({ value, onChange, max, label = 'Date' }) => (<Field label={label}><input type="date" className={fieldClass} value={value || ''} max={max} onChange={(e) => onChange(e.target.value)} /></Field>);
export const TimeField = ({ value, onChange, label }) => (<Field label={label}><input type="time" className={fieldClass} value={value ? String(value).slice(0, 5) : ''} onChange={(e) => onChange(e.target.value || null)} /></Field>);
export const SelectField = ({ label, value, onChange, options, placeholder = 'Choose…', disabled }) => (
  <Field label={label}><select className={fieldClass} value={value || ''} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}><option value="">{placeholder}</option>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>);

/** "Are you sure?" step used before every bulk change and every irreversible action. */
export function ConfirmSheet({ title, children, confirmLabel = 'Confirm', danger, busy, onConfirm, onCancel }) {
  return (
    <Sheet title={title} onClose={onCancel}>
      <div className="text-sm text-[#23382B] mb-4 space-y-2">{children}</div>
      <div className="flex gap-2"><button className={`${btn} flex-1`} onClick={onCancel} disabled={busy}>Cancel</button><button className={`${danger ? btnDanger : btnPrimary} flex-1`} onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button></div>
    </Sheet>
  );
}
export function ErrorLine({ error }) { return error ? <Notice tone="bad">{error}</Notice> : null; }
export function NotConnected() {
  return (<Notice tone="gold">Student records are not connected yet. The school's student foundation must provide the views listed in elimu/INTEGRATION.md before registers can be opened.</Notice>);
}
/** Class/stream options from the foundation view, optionally limited to a set of allowed class ids (teachers see their own classes). */
export function classOptions(classStreams, allowed = null) {
  return classStreams.filter((c) => !allowed || allowed.has(c.class_id)).map((c) => ({ value: `${c.class_id}|${c.stream_id || ''}`, label: [c.class_name, c.stream_name].filter(Boolean).join(' ') }));
}
export const splitClassValue = (v) => { const [classId, streamId] = String(v || '').split('|'); return { classId: classId || null, streamId: streamId || null }; };
