// elimu/export/pages/ExportPage.jsx -- Export & backup: download any part of the school's data as a spreadsheet (CSV), or everything at once.
import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { FitPage, Notice, fieldClass } from '../../services/platform.js';
import { useAsync } from '../../hooks/useAsync.js';
import { setupService } from '../../services/ElimuSetupService.js';
import { exportService, DATASETS, toCsv, saveCsv, fileName, rangeProblem } from '../services/exportService.js';
import { friendlyError } from '../../utils/validation.js';

const btnP = 'min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-[#1F6B45] text-white disabled:opacity-50';
const btnS = 'min-h-[40px] px-3 rounded-xl text-xs font-semibold border border-[#E3DBB8] bg-white text-[#23382B] disabled:opacity-50';
const iso = (d) => d.toISOString().slice(0, 10);

export default function ExportPage() {
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 29 * 864e5))); const [to, setTo] = useState(() => iso(new Date()));
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState(null); const school = useAsync(() => setupService.mySchool().catch(() => null), []);
  const name = school.data?.name || 'school'; const problem = rangeProblem(from, to);
  const one = async (d) => {
    const r = await exportService.fetch(d.key, from, to);
    saveCsv(fileName(d.key, name, from, to, d.dated), toCsv(r.columns, r.rows)); return r;
  };
  const run = async (list) => {
    setBusy(list.length > 1 ? 'ALL' : list[0].key); setMsg(null);
    try {
      const notes = []; for (const d of list) { const r = await one(d); notes.push(`${d.label}: ${r.row_count} row${r.row_count === 1 ? '' : 's'}${r.cut ? ' (cut at 50,000: choose shorter dates)' : ''}`); }
      setMsg({ tone: 'good', text: notes.join(' · ') });
    } catch (e) { setMsg({ tone: 'bad', text: friendlyError(e) }); }
    setBusy('');
  };
  const needsDates = (d) => d.dated;
  return (
    <FitPage title="Export & backup" icon={Download} subtitle="Download your school's data as spreadsheets">
      <div className="space-y-3">
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <div className="rounded-[18px] border border-[#E3DBB8] bg-white shadow-[0_1px_2px_rgba(18,38,31,.06),0_6px_14px_-8px_rgba(18,38,31,.18)] p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-[#6F7461] mb-2">Dates for invoices, payments and attendance</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">From<input type="date" className={fieldClass} value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="text-xs">To<input type="date" className={fieldClass} value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label></div>
          {problem && <p className="text-xs text-red-700 mt-1">{problem}</p>}
        </div>
        <div className="space-y-2">{DATASETS.map((d) => (
          <div key={d.key} className="rounded-[18px] border border-[#E3DBB8] bg-white shadow-[0_1px_2px_rgba(18,38,31,.06),0_6px_14px_-8px_rgba(18,38,31,.18)] p-3 flex items-center gap-3">
            <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{d.label}</div><div className="text-xs text-[#6F7461]">{d.hint}</div></div>
            <button type="button" className={btnS} disabled={!!busy || (needsDates(d) && !!problem)} onClick={() => run([d])}>{busy === d.key ? 'Preparing...' : 'Download'}</button>
          </div>))}</div>
        <button type="button" className={btnP} disabled={!!busy || !!problem} onClick={() => run(DATASETS)}>{busy === 'ALL' ? 'Preparing...' : 'Download everything'}</button>
        <p className="text-xs text-[#6F7461]">Everything arrives as separate CSV files that open in Excel or Google Sheets. Keep them somewhere safe: they hold personal details of children and parents. Each download is recorded in the activity log. This is a copy of your data for safekeeping and reports; it is not a way to restore the system, which your database host backs up separately.</p>
      </div>
    </FitPage>
  );
}
