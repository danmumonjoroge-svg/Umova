// Small shared pieces for Elimu screens, built on the host's CardKit so the module looks like the rest of Umova.
import React from 'react';
import { Pill } from '../services/platform.js';
import { initials, shortName } from '../utils/format.js';

const TONE = { ACTIVE: 'good', APPLICANT: 'info', SUSPENDED: 'warn', TRANSFERRED: 'neutral', WITHDRAWN: 'neutral', GRADUATED: 'good', ALUMNI: 'neutral',
  SUBMITTED: 'info', IN_REVIEW: 'info', ACCEPTED: 'good', WAITLISTED: 'warn', REJECTED: 'bad', ADMITTED: 'good' };

export const StatusPill = ({ category, label }) => <Pill tone={TONE[category] || 'neutral'}>{label || category}</Pill>;

export function Avatar({ person, url, size = 40 }) {
  const s = { width: size, height: size, fontSize: size * 0.38 };
  return url
    ? <img src={url} alt="" style={s} className="rounded-full object-cover bg-[#EFE8C8]" />
    : <div style={s} className="rounded-full bg-[#E8F1EA] text-[#1F6B45] font-semibold flex items-center justify-center shrink-0" aria-hidden="true">{initials(person)}</div>;
}

export const PersonLine = ({ person, sub }) => (
  <div className="flex items-center gap-3 min-w-0"><Avatar person={person} /><div className="min-w-0"><div className="font-semibold text-sm text-[#23382B] truncate">{shortName(person)}</div>{sub && <div className="text-xs text-slate-500 truncate">{sub}</div>}</div></div>
);

export const Field = ({ label, error, hint, children }) => (
  <label className="block mb-3"><span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>{children}{hint && !error && <span className="block text-[11px] text-slate-400 mt-1">{hint}</span>}{error && <span className="block text-[11px] text-red-600 mt-1" role="alert">{error}</span>}</label>
);

export function Pager({ page, total, pageSize, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between py-3 text-sm text-slate-600">
      <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)} className="px-3 min-h-[40px] rounded-lg border border-[#E3DBB8] disabled:opacity-40">Previous</button>
      <span>Page {page + 1} of {pages}</span>
      <button type="button" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)} className="px-3 min-h-[40px] rounded-lg border border-[#E3DBB8] disabled:opacity-40">Next</button>
    </div>
  );
}

export const OfflineBanner = ({ online }) => online ? null : <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2" role="status">No internet. You can read what is already loaded. Messages are kept as drafts and are not sent.</div>;
