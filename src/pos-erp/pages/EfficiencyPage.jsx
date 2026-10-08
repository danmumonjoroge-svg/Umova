// src/pos-erp/pages/EfficiencyPage.jsx
//
// "How we are doing". Every number comes from the owner's own records through
// efficiency_report(); a section appears only when its data exists, and a figure that
// cannot be worked out shows "—". No targets, no estimates, no sample numbers.

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Gauge } from 'lucide-react';
import { efficiencyService, RANGES, rangeDates } from '../services/efficiencyService';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { useNetStatus } from '../offline/useNetStatus';
import { WorkspacePage, SectionTitle, kes } from '../components/workspace/WorkspaceKit';

const num = (v, d = 0) => (v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));
const pct = (v) => (v == null ? '—' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);
const money = (v) => (v == null ? '—' : kes(v));
const TYPE_LABEL = { ROOM: 'Room', PRODUCT: 'Items', SERVICE: 'Services', ACTIVITY: 'Activities', PACKAGE: 'Packages', OTHER: 'Other', ADJUSTMENT: 'Discounts' };

function Tile({ label, value, sub }) {
  return (
    <div className="bg-white border border-[#DDE3DD] rounded-xl p-3 min-w-0">
      <div className="text-[11px] font-bold uppercase tracking-wider text-[#68756D] truncate">{label}</div>
      <div className="text-xl font-bold text-[#1B5138] tabular-nums truncate">{value}</div>
      {sub && <div className="text-xs text-[#68756D]">{sub}</div>}
    </div>
  );
}
const Grid = ({ children }) => <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{children}</div>;
function Rows({ rows }) {
  if (!rows?.length) return null;
  return (
    <div className="bg-white border border-[#DDE3DD] rounded-xl divide-y divide-[#DDE3DD] mt-2">
      {rows.map((r) => (
        <div key={r.key} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
          <div className="min-w-0"><div className="text-[#26352D] truncate">{r.primary}</div>{r.secondary && <div className="text-xs text-[#68756D]">{r.secondary}</div>}</div>
          <div className="font-semibold tabular-nums shrink-0">{r.right}</div>
        </div>
      ))}
    </div>
  );
}

export default function EfficiencyPage() {
  const { tenant } = usePosErpAuth();
  const { isOnline } = useNetStatus();
  const [range, setRange] = useState('week');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setData(null);
    try { setData(await efficiencyService.report({ businessId: tenant?.business_id, ...rangeDates(range) })); setError(''); }
    catch (err) { setError(err.message || 'Could not work out the figures.'); setData({}); }
  }, [range, tenant?.business_id]);
  useEffect(() => { if (isOnline) load(); }, [load, isOnline]);

  const r = data?.rooms; const f = data?.folios; const p = data?.production; const k = data?.packages;
  const empty = data && !r && !f && !p && !k;

  return (
    <WorkspacePage title="How We Are Doing" subtitle="Worked out from your own records. Nothing is estimated.">
      <div className="grid grid-cols-4 gap-1 bg-[#EEF1EC] rounded-xl p-1 mb-3">
        {RANGES.map(([key, label]) => (
          <button key={key} onClick={() => setRange(key)} aria-pressed={range === key} className={`min-h-[40px] rounded-lg text-xs font-semibold px-1 ${range === key ? 'bg-white shadow-sm text-[#1B5138]' : 'text-[#68756D]'}`}>{label}</button>
        ))}
      </div>
      {!isOnline && <p className="text-sm text-[#68756D]">These figures need a connection.</p>}
      {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2 mb-3">{error}</div>}
      {isOnline && data === null && <div className="flex items-center gap-2 text-sm text-[#68756D]"><Loader2 size={16} className="animate-spin" /> Working it out…</div>}
      {empty && !error && (
        <div className="bg-white border border-[#DDE3DD] rounded-xl p-6 text-center text-sm text-[#68756D]">
          <Gauge className="mx-auto mb-2 text-[#237A52]" />
          Nothing to measure in this period yet. Figures appear here once you have rooms, guest bills, packages sold or production runs.
        </div>
      )}

      {r && (<>
        <SectionTitle>Rooms</SectionTitle>
        <Grid>
          <Tile label="Occupancy" value={pct(r.occupancy_pct)} sub={`${num(r.room_nights_sold)} of ${num(r.room_nights_available)} room nights`} />
          <Tile label="Average room price" value={money(r.adr)} sub="per night sold" />
          <Tile label="Income per room" value={money(r.revpar)} sub="per room per night" />
          <Tile label="Room income" value={money(r.room_revenue)} />
          <Tile label="Average stay" value={r.avg_stay_nights == null ? '—' : `${num(r.avg_stay_nights, 1)} nights`} sub={`${num(r.stays_checked_out)} guests left`} />
          <Tile label="In the rooms now" value={num(r.in_house_now)} sub={`${num(r.rooms)} rooms in use`} />
        </Grid>
      </>)}

      {f && (<>
        <SectionTitle>Guest bills</SectionTitle>
        <Grid>
          <Tile label="Average guest spend" value={money(f.avg_guest_spend)} sub={`${num(f.settled_count)} bills settled`} />
          <Tile label="Settled" value={money(f.settled_total)} />
          <Tile label="Still open" value={money(f.open_balance)} sub={`${num(f.open_count)} bills`} />
        </Grid>
        {f.by_type?.length > 0 && (<>
          <div className="text-xs font-semibold text-[#68756D] mt-3">Where the money came from (charges posted in this period)</div>
          <Rows rows={f.by_type.map((t) => ({ key: t.type, primary: TYPE_LABEL[t.type] || t.type, right: money(t.amount) }))} />
        </>)}
        {f.top_activities?.length > 0 && (<>
          <div className="text-xs font-semibold text-[#68756D] mt-3">Best-selling activities</div>
          <Rows rows={f.top_activities.map((a) => ({ key: a.name, primary: a.name, secondary: `${num(a.quantity)} sold`, right: money(a.amount) }))} />
        </>)}
      </>)}

      {k && (<>
        <SectionTitle>Packages</SectionTitle>
        <Grid>
          <Tile label="Packages sold" value={num(k.sold)} />
          <Tile label="Package income" value={money(k.revenue)} />
        </Grid>
        <Rows rows={(k.by_package || []).map((x) => ({ key: x.name, primary: x.name, secondary: `${num(x.sold)} sold`, right: money(x.revenue) }))} />
      </>)}

      {p && (<>
        <SectionTitle>Production</SectionTitle>
        <Grid>
          <Tile label="Yield" value={pct(p.yield_pct)} sub={`${num(p.actual, 1)} made of ${num(p.expected, 1)} expected`} />
          <Tile label="Wastage" value={num(p.wastage_qty, 1)} sub={`cost ${money(p.wastage_cost)}`} />
          <Tile label="Materials used" value={money(p.input_cost)} sub={`${num(p.runs)} batches`} />
        </Grid>
        {p.by_recipe?.length > 0 && (<>
          <div className="text-xs font-semibold text-[#68756D] mt-3">By recipe (most wastage first)</div>
          <Rows rows={p.by_recipe.map((x) => ({ key: x.name, primary: x.name, secondary: `${num(x.actual, 1)} of ${num(x.expected, 1)} · ${num(x.runs)} batches`, right: pct(x.yield_pct) }))} />
        </>)}
        {p.wastage_by_reason?.length > 0 && (<>
          <div className="text-xs font-semibold text-[#68756D] mt-3">Why things were lost</div>
          <Rows rows={p.wastage_by_reason.map((x) => ({ key: x.reason, primary: x.reason, secondary: `${num(x.qty, 1)} lost`, right: money(x.cost) }))} />
        </>)}
      </>)}

      {data && !empty && (
        <p className="text-xs text-[#68756D] mt-4">
          Measured {data.from} to {data.measured_to}{data.measured_to < data.to ? ' (days still to come are not counted)' : ''}. Occupancy = room nights sold ÷ room nights available. Average room price = room income ÷ nights sold. Yield = made ÷ expected. Room income is nights × the stay's price.
        </p>
      )}
    </WorkspacePage>
  );
}
