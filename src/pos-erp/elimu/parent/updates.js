// Pure: turns what the portal already loads into one "What's new" list for a child, most urgent first. No React, no network.
// Each item: { key, kind, title, detail, when (ISO date string or ''), urgent, tab } -- `tab` is the portal screen to open.
const iso = (d) => (d ? String(d).slice(0, 10) : '');
export function buildUpdates({ notices = [], calendar = [], trips = [], passes = [], results = [], fees = null } = {}, today = new Date().toISOString().slice(0, 10)) {
  const out = [];
  for (const p of passes) if (p.state === 'REQUESTED') out.push({ key: `gp-${p.id}`, kind: 'gatepass', title: 'The school asks to let your child leave', detail: p.reason || '', when: iso(p.requested_at), urgent: true, tab: 'gatepass' });
  for (const t of trips) if (!t.cancelled && t.can_answer && !t.consent) out.push({ key: `trip-${t.id}`, kind: 'trip', title: `Please answer: ${t.title}`, detail: t.consent_deadline ? `Reply by ${iso(t.consent_deadline)}` : '', when: iso(t.trip_date), urgent: true, tab: 'trips' });
  const owed = Number(fees?.outstanding_total || 0);
  if (owed > 0) out.push({ key: 'fees', kind: 'fees', title: 'Fee balance to pay', detail: `KES ${owed.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`, when: '', urgent: false, tab: 'fees' });
  for (const r of results.slice(0, 1)) out.push({ key: `rc-${r.report_card_id}`, kind: 'report', title: `Report card: ${r.term} ${r.year}`, detail: r.grade ? `Grade ${r.grade}` : '', when: iso(r.published_at), urgent: false, tab: 'results' });
  for (const n of notices.slice(0, 5)) out.push({ key: `n-${n.id}`, kind: 'notice', title: n.title, detail: n.class_name || 'School notice', when: iso(n.at), urgent: !!n.important, tab: 'notices' });
  for (const e of calendar) if (iso(e.start_date) >= today) out.push({ key: `ev-${e.id}`, kind: 'event', title: e.title, detail: e.expected_amount > 0 ? `KES ${Number(e.expected_amount).toLocaleString('en-KE')} expected` : '', when: iso(e.start_date), urgent: false, tab: 'calendar' });
  const rank = (x) => (x.kind === 'gatepass' ? 0 : x.urgent ? 1 : x.kind === 'fees' ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b) || (a.kind === 'event' && b.kind === 'event' ? a.when.localeCompare(b.when) : b.when.localeCompare(a.when))).slice(0, 12);
}
