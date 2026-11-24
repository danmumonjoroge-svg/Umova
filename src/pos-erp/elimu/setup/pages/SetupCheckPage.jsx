// "Setup check": the student journey as a path (year, classes, admission, stream, parents, subjects, fees, billing, exams).
// Each step is either a tick or a card saying what is missing and where to fix it. Read-only.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, AlertTriangle, ArrowRight } from 'lucide-react';
import { FitPage, LoadingBlock, Notice } from '../../services/platform.js';
import { useAsync } from '../../hooks/useAsync.js';
import { friendlyError } from '../../utils/validation.js';
import { setupService, summaryLine, demoReport } from '../services/setupService.js';
import { V, SHAPE, lift } from '../../ui/cards';

/** The path along the top: one dot per step, joined by a line; a tick when done, a number badge when something is missing. */
export function JourneyPath({ checks = [] }) {
  return (
    <ol className="flex items-start overflow-x-auto pb-1 mb-3 -mx-1 px-1" aria-label="Student journey">
      {checks.map((c, i) => (
        <li key={c.key} className="flex items-start shrink-0">
          <div className="flex flex-col items-center w-[74px]">
            <span className="flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-black"
              style={c.ok ? { background: V.primary, color: '#fff' } : { background: V.accentTint, color: V.accentDeep, border: `2px solid ${V.accent}` }}>
              {c.ok ? <Check size={17} /> : c.count}</span>
            <span className="mt-1 text-[11px] text-center leading-tight" style={{ color: c.ok ? V.muted : V.text, fontWeight: c.ok ? 500 : 700 }}>{c.step}</span>
          </div>
          {i < checks.length - 1 && <span aria-hidden className="mt-[17px] h-[2px] w-4" style={{ background: c.ok ? V.primary : V.border }} />}
        </li>))}
    </ol>);
}

/** A step that needs attention: what is wrong, in plain words, and a button to the place that fixes it. */
export function GapCard({ step, title, detail, count, to }) {
  return (
    <div className="mb-3 p-4" style={{ background: V.accentTint, border: `1px solid ${V.accent}`, borderRadius: SHAPE.paper || '18px', boxShadow: lift }}>
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: V.accent, color: V.dark }}><AlertTriangle size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-[.09em]" style={{ color: V.accentDeep }}>{step}{count ? ` · ${count}` : ''}</div>
          <div className="font-bold mt-0.5" style={{ color: V.dark }}>{title}</div>
          <p className="text-sm mt-1" style={{ color: V.text }}>{detail}</p>
          <Link to={to} className="mt-2.5 inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl text-sm font-semibold" style={{ background: V.dark, color: V.onDark }}>Go and fix it <ArrowRight size={14} /></Link>
        </div>
      </div>
    </div>);
}

/** A step that is fine: one quiet line. */
export const DoneLine = ({ step, detail }) => (
  <li className="flex items-center gap-2.5 py-2 text-sm" style={{ color: V.text, borderBottom: `1px dashed ${V.border}` }}>
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ background: V.tint, color: V.deep }}><Check size={12} /></span>
    <span className="font-semibold">{step}</span><span style={{ color: V.muted }}>— {detail}</span></li>);

export function SetupCheckView({ data }) {
  const checks = data?.checks || []; const gaps = checks.filter((c) => !c.ok); const done = checks.filter((c) => c.ok);
  return (
    <>
      <p className="text-sm mb-3" style={{ color: V.muted }}>{data?.year ? `${data.year}: ` : ''}{data?.placed ?? 0} of {data?.learners ?? 0} learners placed in a class. {summaryLine(checks)}</p>
      <JourneyPath checks={checks} />
      {gaps.map((c) => <GapCard key={c.key} step={c.step} title={c.title} detail={c.detail} count={c.count} to={`../${c.fix}`} />)}
      {done.length > 0 && <ul className="mt-1">{done.map((c) => <DoneLine key={c.key} step={c.step} detail={c.detail} />)}</ul>}
    </>);
}

/** Demo school only: one button that fills the whole journey with sample data, then shows what each stage did. */
export function DemoFill({ onDone }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [rep, setRep] = useState(null);
  const go = async (family) => { setBusy(true); setErr(''); try { const r = await (family ? setupService.fillFamily() : setupService.fillDemo()); setRep(demoReport(r)); onDone?.(); } catch (e) { setErr(friendlyError(e)); } setBusy(false); };
  return (
    <div className="mb-3 p-4" style={{ background: V.soft, border: `1px dashed ${V.primary}`, borderRadius: '8px 24px 8px 24px' }}>
      <div className="font-bold" style={{ color: V.dark }}>This is the demo school</div>
      <p className="text-sm mt-1" style={{ color: V.text }}>Fill the rest of the journey with sample data: learners into streams, subjects with a teacher, fee structures and invoices, and an opening test with marks. Safe to press again.</p>
      {err && <Notice tone="bad">{err}</Notice>}
      <button type="button" disabled={busy} onClick={() => go(false)} className="mt-2.5 min-h-[44px] px-4 rounded-xl text-sm font-semibold disabled:opacity-60" style={{ background: V.dark, color: V.onDark }}>{busy ? 'Filling…' : 'Fill the demo journey'}</button>
      <button type="button" disabled={busy} onClick={() => go(true)} className="mt-2.5 ml-2 min-h-[44px] px-4 rounded-xl text-sm font-semibold disabled:opacity-60" style={{ border: `2px solid ${V.dark}`, color: V.dark, background: 'transparent' }}>{busy ? 'Filling…' : 'Add a demo parent and results'}</button>
      <p className="text-xs mt-1" style={{ color: V.text }}>Adds class teachers, a principal, an optional subject, a parent with two children and published report cards, so the parent screens have something to show. Then give "Demo Parent" a login under Registration &gt; Guardians &gt; Parent logins.</p>
      {rep && <ul className="mt-3 space-y-1 text-sm">{rep.map((x) => <li key={x.key} style={{ color: x.status === 'failed' ? V.accentDeep : V.text }}><b className="capitalize">{x.key}</b> — {x.status}: {x.detail}</li>)}</ul>}
    </div>);
}

export default function SetupCheckPage() {
  const { data, loading, error, reload } = useAsync(() => setupService.health(), []);
  const demo = useAsync(() => setupService.isDemo(), []);
  return (
    <FitPage title="Setup check" subtitle="Is the student journey joined up?">
      {error && <Notice tone="bad">{friendlyError(error)}</Notice>}
      {demo.data === true && <DemoFill onDone={reload} />}
      {loading ? <LoadingBlock /> : data ? <SetupCheckView data={data} /> : null}
    </FitPage>);
}
