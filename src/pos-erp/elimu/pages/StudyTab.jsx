// "Subjects & stream" tab on the student profile: the one place to see and change where a learner sits (stream) and what they take
// (compulsory subjects are listed, electives are ticked on or off). Changes save at once; history is kept by the database.
import React, { useState } from 'react';
import { LoadingBlock, Notice } from '../services/platform.js';
import { enrollmentService } from '../services/ElimuEnrollmentService.js';
import { useAsync } from '../hooks/useAsync.js';
import { friendlyError } from '../utils/validation.js';
import { V, SHAPE } from '../ui/cards/tokens.js';

const chip = { borderRadius: 999, padding: '4px 12px', fontSize: 13, background: V.soft, color: V.text };

export default function StudyTab({ studentId }) {
  const r = useAsync(() => enrollmentService.study(studentId), [studentId]);
  const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [note, setNote] = useState('');
  const d = r.data; const canChange = !!d?.can_edit;
  if (r.loading && !d) return <LoadingBlock />;
  if (r.error && !d) return <Notice tone="bad">{r.error}</Notice>;
  if (!d?.enrolled) return <Notice tone="info">This learner is not enrolled in a class yet. Enrol them first, then their stream and subjects appear here.</Notice>;
  const run = async (key, fn, msg) => { setBusy(key); setErr(''); setNote(''); try { await fn(); setNote(msg); r.reload(); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(''); } };
  const setStream = (id) => run('stream', () => enrollmentService.move(d.enrollment_id, d.class_id, id || null, 'Stream chosen on the learner profile'), 'Stream saved.');
  const toggle = (sub) => run(sub.id, () => enrollmentService.choose(d.enrollment_id, sub.id, !sub.chosen), sub.chosen ? `${sub.name} dropped.` : `${sub.name} chosen.`);
  const box = { background: '#fff', border: '1px solid #E3DBB8', borderRadius: SHAPE.paper, padding: 14 };
  return (
    <div className="space-y-3" data-testid="study-tab">
      {err && <Notice tone="bad">{err}</Notice>}{note && <Notice tone="good">{note}</Notice>}
      <div style={box}>
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Class and stream</div>
        <div className="font-semibold mb-2">{d.class_name}{d.stream_name ? ` · ${d.stream_name}` : ''}</div>
        {d.streams.length === 0 ? <div className="text-sm text-slate-500">This class has no streams. Add one under Classes if you need them.</div> : (
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Stream">
            {d.streams.map((st) => { const on = st.id === d.stream_id; return (
              <button key={st.id} type="button" role="radio" aria-checked={on} disabled={!d.can_move || busy === 'stream'} onClick={() => !on && setStream(st.id)}
                className="min-h-[44px] px-4 rounded-xl text-sm font-medium disabled:opacity-60" style={{ border: `2px solid ${on ? '#1F6B45' : '#E3DBB8'}`, background: on ? '#1F6B45' : '#fff', color: on ? '#fff' : '#12261F' }}>{st.name}</button>); })}
            {!d.stream_id && <span className="self-center text-sm text-amber-700">Not placed in a stream yet — tap one.</span>}
          </div>)}
      </div>
      <div style={box}>
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Subjects every learner in this class takes</div>
        {d.compulsory.length ? <div className="flex flex-wrap gap-2">{d.compulsory.map((x) => <span key={x.id} style={chip}>{x.name}</span>)}</div>
          : <div className="text-sm text-slate-500">No subjects are set up for this class yet. Add them under Academics &gt; Subjects.</div>}
      </div>
      <div style={box}>
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Optional subjects</div>
        {!canChange && d.electives.length > 0 && <p className="text-xs text-slate-500 mb-2">Chosen at admission. Only administration can change them.</p>}
        {d.electives.length === 0 ? <div className="text-sm text-slate-500">This class has no optional subjects. Mark a subject as optional when you allocate it to the class.</div> : (
          <div className="space-y-2">{d.electives.map((x) => (
            <label key={x.id} className="flex items-center gap-3 min-h-[48px] rounded-xl px-3" style={{ border: `1px solid ${x.chosen ? '#1F6B45' : '#E3DBB8'}`, background: x.chosen ? '#EAF4EE' : '#fff' }}>
              <input type="checkbox" checked={!!x.chosen} disabled={!canChange || busy === x.id} onChange={() => toggle(x)} style={{ width: 22, height: 22 }} />
              <span className="flex-1 font-medium">{x.name}</span><span className="text-xs text-slate-500">{x.chosen ? 'Taking it' : 'Not taking'}</span>
            </label>))}</div>)}
      </div>
    </div>);
}
