// elimu/timetable/components/TimetableGrid.jsx -- weekly grid. Cells with more than one lesson are outlined red (a clash).
import React from 'react';
import { buildWeekGrid } from '../utils/grid';
import { DAY_SHORT } from '../../shared/utils/time';

export default function TimetableGrid({ entries, periods, days = [1, 2, 3, 4, 5], label, onCell, onEntry }) {
  const { rows, grid } = buildWeekGrid(entries, periods, { days });
  if (!rows.length) return <p className="text-sm text-[#6F7461] p-3">No periods or lessons yet.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-[#E3DBB8] bg-white">
      <table className="w-full text-xs border-collapse min-w-[560px]">
        <thead><tr className="bg-[#F3EFD6]"><th className="p-1.5 text-left w-20">Time</th>{days.map((d) => <th key={d} className="p-1.5 text-left">{DAY_SHORT[d]}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={`border-t border-[#EFE9CB] ${r.teaching ? '' : 'bg-[#FAF8EA] text-[#8A8F78]'}`}>
              <td className="p-1.5 align-top whitespace-nowrap"><div className="font-semibold">{r.start}</div><div>{r.end}</div>{r.label && <div className="text-[10px]">{r.label}</div>}</td>
              {days.map((d) => {
                const cell = grid[r.key][d]; const clash = cell.length > 1;
                return (
                  <td key={d} className={`p-1 align-top ${clash ? 'outline outline-2 outline-[#B23A2E] -outline-offset-2' : ''}`} onClick={() => !cell.length && r.teaching && onCell?.({ day: d, row: r })}>
                    {cell.map((e) => (
                      <button key={e.id} type="button" onClick={(ev) => { ev.stopPropagation(); onEntry?.(e); }} className="block w-full text-left rounded-lg bg-[#E8F3EC] border border-[#BFDCCB] px-1.5 py-1 mb-0.5 min-h-[40px]">
                        <div className="font-semibold text-[#17553A]">{label(e).title}</div><div className="text-[#4F5A4A]">{label(e).sub}</div>
                      </button>))}
                    {!cell.length && r.teaching && onCell && <div className="min-h-[40px] rounded-lg border border-dashed border-[#E3DBB8] text-center text-[#B8B08A] pt-2">+</div>}
                  </td>);
              })}
            </tr>))}
        </tbody>
      </table>
    </div>
  );
}
