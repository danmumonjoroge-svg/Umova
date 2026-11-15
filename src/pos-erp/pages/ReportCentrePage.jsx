// src/pos-erp/pages/ReportCentrePage.jsx
//
// "Printable Reports": pick a report, pick the dates, look at it on screen, then Download the PDF, Print it, or Share it
// (WhatsApp / email) on a phone. Which reports show depends on the signed-in person's permissions; Download / Print /
// Share need "Export reports" (reports.export). Everything is read-only.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { FileText, Download, Printer, Share2, ArrowLeft, Boxes, BarChart3, Wallet, ChevronRight, AlertTriangle, TrendingUp, Layers, ShoppingBag, Receipt, Smartphone, HandCoins, CalendarDays } from 'lucide-react';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { usePermissions } from '../navigation/PermissionsContext';
import { settingsService } from '../services/settingsService';
import { reportCentreService, nairobiToday } from '../services/reportCentreService';
import { buildReportPdf, reportFileName, savePdf, printPdf, sharePdf, loadLogoPng } from '../utils/reportPdf';
import ReportPreview from '../components/ReportPreview';
import { FitPage, FilterChips, LoadingBlock, Notice, formCard, inputCls, saveBtnCls } from '../components/CardKit';

const GROUP_ICON = { Stock: Boxes, Sales: BarChart3, Money: Wallet };
const GROUP_COLOR = { Stock: '#1F6B45', Sales: '#B8921C', Money: '#3E8A5A' };
const REPORT_ICON = { stock: Boxes, lowstock: AlertTriangle, sales: TrendingUp, byclass: Layers, items: ShoppingBag, expenses: Receipt, mpesa: Smartphone, debtors: HandCoins };

export default function ReportCentrePage() {
  const { tenant, staffName } = usePosErpAuth();
  const { canAny, can } = usePermissions();
  const businessId = tenant?.business_id;
  const allowed = useMemo(() => reportCentreService.REPORTS.filter((r) => canAny(r.perms)), [canAny]);
  const canPrint = can('reports.export');

  const presets = useMemo(() => reportCentreService.periodPresets(), []);
  const [picked, setPicked] = useState(null);           // the report definition
  const [preset, setPreset] = useState('month');
  const [from, setFrom] = useState(presets.find((p) => p.key === 'month').from);
  const [to, setTo] = useState(nairobiToday());
  const [groupBy, setGroupBy] = useState('class');
  const [classId, setClassId] = useState('');
  const [classes, setClasses] = useState([]);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [business, setBusiness] = useState(null);

  useEffect(() => {
    if (!businessId) return;
    settingsService.getBusinessProfile(businessId).then(setBusiness).catch(() => {});
    reportCentreService.listClasses(businessId).then(setClasses).catch(() => setClasses([]));
  }, [businessId]);

  const choosePreset = (key) => {
    setPreset(key);
    const p = presets.find((x) => x.key === key);
    if (p && key !== 'custom') { setFrom(p.from); setTo(p.to); }
  };

  const run = useCallback(async () => {
    if (!picked) return;
    setBusy(true); setError(''); setNote(''); setReport(null);
    try {
      if (picked.period && from > to) throw new Error('The start date is after the end date.');
      setReport(await reportCentreService.build(picked.key, { businessId, from, to, groupBy, classId: classId || null }));
    } catch (e) {
      setError(e?.code === '42501' ? 'You do not have access to this report.' : (e?.message || 'Could not build the report.'));
    } finally { setBusy(false); }
  }, [picked, from, to, groupBy, classId, businessId]);

  // re-run when the choices change (reports are cheap read-only queries)
  useEffect(() => { if (picked) run(); }, [picked, run]);

  const makePdf = async () => {
    const logo = await loadLogoPng(business?.logo_url);
    return buildReportPdf(report, { business, logo, generatedBy: staffName });
  };
  const guard = (fn) => async () => {
    setNote(''); setError('');
    try { await fn(); } catch (e) { setError(e?.message || 'That did not work.'); }
  };
  const onDownload = guard(async () => { const how = await savePdf(await makePdf(), reportFileName(report), report.title); setNote(how === 'shared' ? 'Choose where to save it (Files, Drive) or send it (WhatsApp, email) from the list that opened.' : 'PDF saved to your downloads.'); });
  const onPrint = guard(async () => { printPdf(await makePdf(), { onError: (e) => setError(e.message), fileName: reportFileName(report), title: report.title }); });
  const onShare = guard(async () => {
    const ok = await sharePdf(await makePdf(), reportFileName(report), report.title);
    if (!ok) setNote('Sharing is not available on this device. Use Download PDF instead.');
  });

  // ---------- list ----------
  if (!picked) {
    const groups = ['Stock', 'Sales', 'Money'].map((g) => [g, allowed.filter((r) => r.group === g)]).filter(([, l]) => l.length);
    return (
      <FitPage title="Printable Reports" subtitle="Print, save as PDF or send on WhatsApp" icon={FileText}>
        <div className="rounded-3xl bg-[#17553A] text-white p-4 mb-4 relative overflow-hidden">
          <div className="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-[#C9A227]/15" aria-hidden="true" />
          <div className="relative flex items-center gap-3">
            <span className="w-12 h-12 rounded-2xl bg-[#E8C65A] text-[#3B2F06] flex items-center justify-center shrink-0"><FileText size={24} /></span>
            <div className="min-w-0">
              <div className="text-[17px] font-extrabold leading-tight">{allowed.length} report{allowed.length === 1 ? '' : 's'} ready</div>
              <div className="text-[12.5px] text-white/75">Pick one, choose the dates, then download or print.</div>
            </div>
          </div>
        </div>
        {allowed.length === 0 && <Notice tone="gold">You do not have access to any reports. Ask the business owner.</Notice>}
        {!canPrint && allowed.length > 0 && <Notice tone="gold">You can look at reports here. Printing and saving PDFs needs the "Export reports" right.</Notice>}
        {groups.map(([g, list]) => {
          const Icon = GROUP_ICON[g] || FileText;
          const color = GROUP_COLOR[g] || '#1F6B45';
          return (
            <div key={g} className="mb-5">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-[#6F7461] mb-2 flex items-center gap-2 px-0.5"><span className="w-1 h-3.5 rounded-full bg-[#C9A227]" /><Icon size={13} style={{ color }} />{g}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {list.map((r) => {
                  const RIcon = REPORT_ICON[r.key] || FileText;
                  return (
                    <button key={r.key} type="button" onClick={() => { setPicked(r); setReport(null); }}
                      className="group flex items-center gap-3 text-left bg-white border border-[#E3DBB8] rounded-2xl px-3 py-3 active:bg-[#FAF7EA] hover:border-[#C9A227] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]/40 transition-colors">
                      <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}1F`, color }}><RIcon size={21} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14.5px] font-bold text-[#23382B] leading-tight">{r.title}</span>
                        <span className="block text-[12px] text-[#6F7461] leading-snug mt-0.5 line-clamp-2">{r.desc}</span>
                        <span className="inline-flex items-center gap-1 mt-1.5 text-[10.5px] font-bold rounded-full px-2 py-0.5" style={{ background: `${color}14`, color }}><CalendarDays size={10} />{r.period ? 'Choose dates' : 'As at today'}</span>
                      </span>
                      <ChevronRight size={17} className="text-[#B9B28A] shrink-0" />
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </FitPage>
    );
  }

  // ---------- one report ----------
  return (
    <FitPage
      title={picked.title} subtitle={picked.desc} icon={FileText}
      action={<button type="button" onClick={() => { setPicked(null); setReport(null); setError(''); }} className="inline-flex items-center gap-1 text-sm font-semibold text-[#1F6B45] min-h-[38px]"><ArrowLeft size={15} /> All reports</button>}
    >
      <div className={`${formCard} !rounded-2xl`}>
        {picked.period && (
          <>
            <FilterChips value={preset} onChange={choosePreset} options={presets.map((p) => ({ key: p.key, label: p.label }))} />
            {preset === 'custom' && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <label className="text-xs text-[#6F7461]">From<input type="date" className={inputCls} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
                <label className="text-xs text-[#6F7461]">To<input type="date" className={inputCls} value={to} min={from} max={nairobiToday()} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
              </div>
            )}
          </>
        )}
        {picked.options?.includes('groupBy') && (
          <div className="mt-2"><div className="text-xs text-[#6F7461] mb-1">Group the items by</div>
            <FilterChips value={groupBy} onChange={setGroupBy} options={[{ key: 'class', label: 'Class' }, { key: 'category', label: 'Category' }, { key: 'none', label: 'No grouping' }]} /></div>
        )}
        {picked.options?.includes('classId') && (
          <label className="block mt-2 text-xs text-[#6F7461]">Which class
            <select className={inputCls} value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">All classes (one page each)</option>
              {classes.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="none">Not classified</option>
            </select>
          </label>
        )}
        {picked.options?.includes('classId') && classes.length === 0 && <p className="text-[11px] text-[#8A6A12] mt-1">No classes yet. Add them under My Items &rarr; Classes to split sales by Restaurant, Bar, Accommodation and so on.</p>}
        <div className="grid grid-cols-[1fr_auto_auto] gap-2 mt-3">
          <button type="button" disabled={!report || !canPrint} onClick={onDownload} className={`${saveBtnCls} px-4 inline-flex items-center justify-center gap-1.5`}><Download size={16} /> Download PDF</button>
          <button type="button" disabled={!report || !canPrint} onClick={onPrint} aria-label="Print" className="px-4 min-h-[42px] rounded-lg border border-[#1F6B45] text-[#1F6B45] font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"><Printer size={16} /><span className="hidden min-[400px]:inline">Print</span></button>
          <button type="button" disabled={!report || !canPrint} onClick={onShare} aria-label="Share" className="px-4 min-h-[42px] rounded-lg border border-[#E3DBB8] text-[#23382B] font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"><Share2 size={16} /><span className="hidden min-[400px]:inline">Share</span></button>
        </div>
        {!canPrint && <p className="text-[11px] text-[#8A6A12] mt-1.5">Printing and saving need the "Export reports" right. Ask the business owner.</p>}
      </div>

      {error && <Notice>{error}</Notice>}
      {note && <Notice tone="good">{note}</Notice>}
      {busy && <LoadingBlock text="Building the report…" />}
      {!busy && <ReportPreview report={report} />}
    </FitPage>
  );
}
