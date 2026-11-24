// elimu/audit/pages/ActivityLogPage.jsx -- who did what and when (school management only). Read-only; CSV download.
// The screen itself is the shared ActivityLogView (timeline, filters, summary tiles); this page only fetches and shapes the rows.
import React, { useMemo } from 'react';
import { useAsync } from '../../hooks/useAsync.js';
import { activityService, actionLabel } from '../services/activityService.js';
import { downloadCsv } from '../../attendance/reports/export.js';
import { friendlyError } from '../../utils/validation.js';
import ActivityLogView from '../../ui/activity/ActivityLogView.jsx';

const iso = (d) => d.toISOString().slice(0, 10);
const COLS = [
  { key: 'at', label: 'When', fmt: (v) => (v ? new Date(v).toISOString().replace('T', ' ').slice(0, 19) : '') },
  { key: 'actor_name', label: 'Who' }, { key: 'action', label: 'Action', fmt: (v) => actionLabel(v) },
  { key: 'detail', label: 'Detail', fmt: (v) => (v ? JSON.stringify(v) : '') },
];
/** Turn a database row into the shape the view understands (readable summary, area from the detail). */
export function shapeActivity(r) {
  const d = r.detail && typeof r.detail === 'object' ? r.detail : {};
  const extra = Object.entries(d).filter(([k]) => k !== 'module').map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
  return { id: r.id, created_at: r.at, actor_name: r.actor_name || 'The system', action: r.action, module: d.module || r.entity_type, summary: `${actionLabel(r.action)}${extra ? ` (${extra})` : ''}` };
}

export default function ActivityLogPage() {
  const from = useMemo(() => iso(new Date(Date.now() - 29 * 864e5)), []); const to = useMemo(() => iso(new Date()), []);
  const { data, loading, error, reload } = useAsync(() => activityService.list({ from, to }), [from, to]);
  const rows = data?.rows || []; const entries = useMemo(() => rows.map(shapeActivity), [data]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-3">
      <ActivityLogView entries={entries} loading={loading} error={error ? friendlyError(error) : null} onRefresh={reload}
        subheading={rows.length >= 300 ? 'The latest 300 entries from the last 30 days.' : 'The last 30 days: who did what, and when.'} />
      {rows.length > 0 && <div className="text-center"><button type="button" className="min-h-[40px] px-4 rounded-xl text-xs font-semibold border border-[#E3DBB8] bg-white" onClick={() => downloadCsv(`activity-${from}-to-${to}.csv`, COLS, rows)}>Download as CSV</button></div>}
    </div>
  );
}
