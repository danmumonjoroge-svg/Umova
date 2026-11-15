// src/pos-erp/components/ReportPreview.jsx
// Draws a report spec (utils/reportPdf.js) on screen. Same data as the PDF, so the screen and the paper agree.
// Phone: every row is a small card (name on the left, main figure on the right, other figures in a neat grid), so there is
// no sideways scrolling. Tablet / desktop: the familiar table.
import React from 'react';

const isNum = (c) => c.align === 'right';

function Summary({ items }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
      {items.map((s, i) => (
        <div key={s.label} className={`rounded-2xl px-3 py-2.5 min-w-0 ${i === 0 ? 'bg-[#17553A] text-white col-span-2 sm:col-span-1' : 'bg-[#F6F1DA] text-[#123C2A]'}`}>
          <div className={`text-[10.5px] font-bold uppercase tracking-wide truncate ${i === 0 ? 'text-[#E8C65A]' : 'text-[#6F7461]'}`}>{s.label}</div>
          <div className={`text-[17px] font-extrabold leading-tight break-words ${s.bad ? (i === 0 ? 'text-red-200' : 'text-[#B23A2E]') : ''}`}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

function Cards({ sec }) {
  const cols = sec.columns;
  const title = cols[0];
  const second = cols[1] && !isNum(cols[1]) ? cols[1] : null;
  const nums = cols.filter((c) => isNum(c));
  const main = nums.length ? nums[nums.length - 1] : null;      // the last figure column is the headline number
  const rest = nums.filter((c) => c !== main);
  if (!sec.rows.length) return <div className="rounded-xl bg-[#FBF9EE] text-sm text-[#6F7461] px-3 py-4">{sec.emptyText || 'Nothing to show for this period.'}</div>;
  return (
    <div className="grid gap-1.5">
      {sec.rows.map((r, ri) => {
        const kind = r._kind || 'row';
        if (kind === 'group') return <div key={ri} className="mt-1.5 rounded-xl bg-[#F3EED6] px-3 py-2 text-[13px] font-bold text-[#123C2A]">{r[title.key]}</div>;
        if (kind === 'total') return (
          <div key={ri} className="rounded-xl bg-[#17553A] text-white px-3 py-2.5">
            <div className="flex items-center justify-between gap-3"><span className="text-[13px] font-bold">{r[title.key]}</span>{main && <span className="text-[14px] font-extrabold tabular-nums">{r[main.key]}</span>}</div>
            {rest.some((c) => r[c.key]) && <div className="grid grid-cols-3 gap-x-2 mt-1">{rest.map((c) => r[c.key] ? <div key={c.key} className="min-w-0"><div className="text-[9.5px] uppercase text-white/65 truncate">{c.label}</div><div className="text-[12px] font-bold tabular-nums truncate">{r[c.key]}</div></div> : null)}</div>}
          </div>
        );
        return (
          <div key={ri} className={`rounded-xl border px-3 py-2 ${kind === 'sub' ? 'bg-[#FBF9EE] border-[#F1ECD2] ml-3' : 'bg-white border-[#EFE9CD]'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold text-[#23382B] leading-snug break-words">{r[title.key]}</div>
                {second && r[second.key] ? <div className="text-[11px] text-[#8B8766] truncate">{r[second.key]}</div> : null}
              </div>
              {main && <div className={`text-[14px] font-extrabold tabular-nums shrink-0 ${r._bad?.includes(main.key) ? 'text-[#B23A2E]' : 'text-[#123C2A]'}`}>{r[main.key]}</div>}
            </div>
            {rest.length > 0 && (
              <div className="grid grid-cols-3 gap-x-2 gap-y-1 mt-1.5 pt-1.5 border-t border-[#F1ECD2]">
                {rest.map((c) => (
                  <div key={c.key} className="min-w-0">
                    <div className="text-[9.5px] uppercase tracking-wide text-[#8B8766] truncate">{c.label}</div>
                    <div className={`text-[12px] font-semibold tabular-nums truncate ${r._bad?.includes(c.key) ? 'text-[#B23A2E]' : 'text-[#23382B]'}`}>{r[c.key]}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Table({ sec }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[#EFE8C8]">
      <table className="w-full text-[12.5px] min-w-[520px]">
        <thead>
          <tr className="bg-[#123C2A] text-white">
            {sec.columns.map((c) => <th key={c.key} className={`px-2.5 py-2 font-semibold whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {sec.rows.length === 0 && <tr><td colSpan={sec.columns.length} className="px-2.5 py-3 text-[#6F7461]">{sec.emptyText || 'Nothing to show for this period.'}</td></tr>}
          {sec.rows.map((r, ri) => {
            const kind = r._kind || 'row';
            return (
              <tr key={ri} className={`border-t border-[#EFE8C8] ${kind === 'group' ? 'bg-[#F3EED6] font-bold' : kind === 'total' ? 'bg-[#EAF3EC] font-bold border-t-2 border-t-[#123C2A]' : ri % 2 ? 'bg-[#FBF9EE]' : ''}`}>
                {sec.columns.map((c) => (
                  <td key={c.key} className={`px-2.5 py-1.5 ${c.align === 'right' ? 'text-right tabular-nums whitespace-nowrap' : ''} ${r._bad?.includes(c.key) ? 'text-[#B23A2E]' : ''}`}>{r[c.key]}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ReportPreview({ report }) {
  if (!report) return null;
  return (
    <div className="bg-white border border-[#E3DBB8] border-t-[3px] border-t-[#C9A227] rounded-2xl p-3 sm:p-4">
      <h2 className="text-[17px] font-extrabold text-[#23382B] leading-tight">{report.title}</h2>
      {report.subtitle && <p className="text-xs text-[#6F7461] mt-0.5">{report.subtitle}</p>}
      {report.period && <span className="inline-block mt-1.5 text-[11.5px] font-bold text-[#7A5A0E] bg-[#FBF0CC] rounded-full px-2.5 py-1">{report.period}</span>}

      {report.summary?.length > 0 && <Summary items={report.summary} />}

      {(report.sections || []).map((sec, si) => (
        <div key={si} className="mt-5">
          {sec.heading && (
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <h3 className="text-[14px] font-extrabold text-[#123C2A] flex items-center gap-2"><span className="w-1 h-4 rounded-full bg-[#C9A227]" />{sec.heading}</h3>
              {sec.headingRight && <span className="text-xs font-bold text-[#23382B]">{sec.headingRight}</span>}
            </div>
          )}
          {sec.note && <p className="text-[11px] text-[#6F7461] mb-1.5">{sec.note}</p>}
          <div className="sm:hidden"><Cards sec={sec} /></div>
          <div className="hidden sm:block"><Table sec={sec} /></div>
        </div>
      ))}
      {report.footnote && <p className="text-[11px] text-[#6F7461] mt-4 pt-3 border-t border-[#F1ECD2]">{report.footnote}</p>}
    </div>
  );
}
