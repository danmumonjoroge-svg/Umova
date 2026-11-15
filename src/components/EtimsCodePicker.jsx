// A search box over ONE of KRA's own code lists. Type a word or code, pick from at most 30 matches.
import React, { useEffect, useState } from 'react';
import { etimsService } from '../services/etimsService';

export default function EtimsCodePicker({ label, list, environment, value, onChange }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    const t = setTimeout(async () => {
      try { const r = await etimsService.searchCodes(environment, list, q); if (alive) setRows(r); } catch { if (alive) setRows([]); }
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [open, q, list, environment]);

  const shown = picked && picked.code === value ? `${picked.code} · ${picked.name || ''}` : value || '';
  return (
    <div className="min-w-0">
      <label className="block text-xs font-semibold text-[#68756D] mb-1">{label}</label>
      <button type="button" onClick={() => setOpen(!open)} className="w-full min-h-[44px] px-3 text-left text-sm border border-[#DDE3DD] rounded-lg bg-white truncate">
        {shown || <span className="text-[#9AA39C]">Choose…</span>}
      </button>
      {open && (
        <div className="mt-1 border border-[#DDE3DD] rounded-lg bg-white">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-full min-h-[40px] px-3 text-sm border-b border-[#EEF1EE] rounded-t-lg" />
          <ul className="max-h-48 overflow-y-auto">
            {rows.length === 0 && <li className="px-3 py-2 text-xs text-[#68756D]">Nothing found. If this list is empty, download the KRA lists in Settings.</li>}
            {rows.map((r) => (
              <li key={r.code}>
                <button type="button" onClick={() => { setPicked(r); onChange(r.code); setOpen(false); }} className="w-full text-left px-3 py-2 text-sm hover:bg-[#F3F6F3]">
                  <span className="font-semibold">{r.code}</span> <span className="text-[#68756D]">{r.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
