// Progress graph: one point per term (mean %), drawn as an SVG line, with the numbers listed under it (so it reads without the picture).
// Used by the parent portal and by staff. Pure presentation: the numbers come from the database (elimu_parent_progress / elimu_student_progress).
import React from 'react';

const pct = (n) => (n == null ? '—' : `${Number(n).toFixed(1)}%`);

export function TermLine({ terms }) {
  const pts = (terms || []).filter((t) => t.mean_percentage != null);
  if (pts.length === 0) return null;
  const W = 320, H = 150, L = 34, R = 12, T = 12, B = 30; const x = (i) => (pts.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (pts.length - 1)); const y = (v) => T + ((100 - v) * (H - T - B)) / 100;
  const label = pts.map((p) => `${p.term} ${p.year}: ${pct(p.mean_percentage)}`).join('; ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Mean score by term. ${label}`} className="w-full h-auto">
      {[0, 25, 50, 75, 100].map((g) => (<g key={g}><line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="#E3DBB8" strokeWidth="1" /><text x={L - 5} y={y(g) + 3} fontSize="9" textAnchor="end" fill="#6F7461">{g}</text></g>))}
      {pts.length > 1 && <polyline fill="none" stroke="#1F6B45" strokeWidth="2.5" strokeLinejoin="round" points={pts.map((p, i) => `${x(i)},${y(Number(p.mean_percentage))}`).join(' ')} />}
      {pts.map((p, i) => (<g key={`${p.year}-${p.term}`}><circle cx={x(i)} cy={y(Number(p.mean_percentage))} r="4" fill="#1F6B45" />
        <text x={x(i)} y={y(Number(p.mean_percentage)) - 8} fontSize="9" textAnchor="middle" fill="#23382B" fontWeight="700">{Math.round(Number(p.mean_percentage))}</text>
        <text x={x(i)} y={H - 16} fontSize="8.5" textAnchor="middle" fill="#6F7461">{String(p.term).replace(/^Term\s*/i, 'T')}</text><text x={x(i)} y={H - 6} fontSize="8" textAnchor="middle" fill="#8A8F7C">{p.year}</text></g>))}
    </svg>);
}

export default function ProgressView({ data }) {
  const terms = data?.terms || []; const asm = data?.assessments || [];
  if (terms.length === 0 && asm.length === 0) return <p className="p-4 text-sm text-slate-500">No results are available yet.</p>;
  const change = terms.length > 1 ? Number(terms[terms.length - 1].mean_percentage) - Number(terms[terms.length - 2].mean_percentage) : null;
  const bySubject = asm.reduce((m, a) => { (m[a.subject] = m[a.subject] || []).push(a); return m; }, {});
  return (
    <div className="space-y-3">
      {terms.length > 0 && (
        <div className="rounded-2xl bg-white border border-[#E3DBB8] p-3">
          <div className="flex items-baseline justify-between"><b className="text-sm">Mean score by term</b>
            {change != null && <span className={`text-xs font-semibold ${change >= 0 ? 'text-emerald-700' : 'text-[#8A3B2E]'}`}>{change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)} points since last term</span>}</div>
          <TermLine terms={terms} />
          <table className="w-full text-xs mt-1"><thead><tr className="text-left text-[#6F7461]"><th>Term</th><th>Class</th><th>Mean</th><th>Grade</th><th>Position</th></tr></thead>
            <tbody>{terms.map((t) => (<tr key={`${t.year}-${t.term}`} className="border-t border-[#F0ECD9]"><td className="py-1">{t.term} · {t.year}</td><td>{t.class_name}</td><td>{pct(t.mean_percentage)}</td><td>{t.grade || '—'}</td><td>{t.class_position ? `${t.class_position} of ${t.class_size}` : '—'}</td></tr>))}</tbody></table>
        </div>)}
      {Object.keys(bySubject).sort().map((s) => (
        <div key={s} className="rounded-2xl bg-white border border-[#E3DBB8] p-3"><b className="text-sm">{s}</b>
          <ul className="mt-1 divide-y divide-[#F0ECD9]">{bySubject[s].map((a, i) => (
            <li key={i} className="flex justify-between gap-2 py-1.5 text-sm"><span className="min-w-0"><span className="block truncate">{a.name}</span><span className="block text-[11px] text-slate-500">{a.term} · {a.year}{a.date ? ` · ${a.date}` : ''}</span></span>
              <span className="text-right shrink-0">{a.status === 'ABSENT' ? <span className="text-slate-500">Absent</span> : <><b>{pct(a.percentage)}</b><span className="block text-[11px] text-slate-500">{Number(a.obtained)} / {Number(a.max)}</span></>}</span></li>))}</ul></div>))}
    </div>);
}
