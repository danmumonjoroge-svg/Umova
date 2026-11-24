// elimu/teachers/services/teacherService.js -- teacher reports and activities (elimu_1032) + the small pure helpers the pages share.
import { rpc } from '../../shared/services/elimuDb';

export const teacherService = {
  list: (term) => rpc('elimu_teacher_list', { p_term: term || null }),
  report: (staff, term) => rpc('elimu_teacher_report', { p_staff: staff || null, p_term: term || null }),
  activities: () => rpc('elimu_activity_list'),
  saveActivity: (f) => rpc('elimu_activity_save', { p_id: f.id || null, p_name: f.name, p_kind: f.kind, p_note: f.note || null, p_active: f.active !== false }),
  assign: (activity, staff, role) => rpc('elimu_activity_assign', { p_activity: activity, p_staff: staff, p_role: role }),
  endRole: (id, reason) => rpc('elimu_activity_end', { p_assignment: id, p_reason: reason || null }),
  addEvent: (f) => rpc('elimu_activity_event_add', { p_activity: f.activity, p_date: f.date, p_title: f.title, p_level: f.level, p_result: f.result || null, p_note: f.note || null }),
  payCandidates: () => rpc('elimu_teacher_pay_candidates'),
  payLink: (staff, employee) => rpc('elimu_teacher_pay_link', { p_staff: staff, p_employee: employee || null }),
};

export const KIND_LABEL = { GAMES: 'Games & sports', CLUB: 'Club', DRAMA_MUSIC: 'Drama & music', ACADEMIC: 'Academic', COMMUNITY: 'Community', OTHER: 'Other' };
export const ROLE_LABEL = { LEADER: 'Leader', ASSISTANT: 'Assistant', PARTICIPANT: 'Takes part' };
export const LEVEL_LABEL = { SCHOOL: 'School', ZONE: 'Zone', SUB_COUNTY: 'Sub-county', COUNTY: 'County', REGIONAL: 'Regional', NATIONAL: 'National', OTHER: 'Other' };
const ORD = (n) => { const v = Number(n); return v % 100 >= 11 && v % 100 <= 13 ? `${v}th` : `${v}${['th', 'st', 'nd', 'rd'][v % 10 > 3 ? 0 : v % 10]}`; };

export const pts = (n) => (n == null ? '' : `${Number(n) > 0 ? '+' : ''}${Number(n).toFixed(1)} pts`);
export const pctText = (n) => (n == null ? '-' : `${Number(n).toFixed(1)}%`);
export const money = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
export const groupName = (r) => `${r.class_name}${r.stream_name ? ` ${r.stream_name}` : ''} - ${r.subject_name}`;

/** Plain-language lines a head teacher would want to see first. Built only from what the report holds. */
export function teacherNotes(rep) {
  const out = []; if (!rep) return out;
  const rows = rep.performance?.rows || [];
  const ch = rep.performance?.change; if (ch != null && Math.abs(Number(ch)) >= 1) out.push({ tone: Number(ch) < 0 ? 'bad' : 'ok', text: `Overall average is ${Number(ch) < 0 ? 'down' : 'up'} ${Math.abs(Number(ch)).toFixed(1)} points on last term.` });
  rows.forEach((r) => {
    if (r.stream_rank && r.stream_count >= 2) out.push({ tone: Number(r.stream_rank) === 1 ? 'ok' : 'info', text: `${groupName(r)}: ${ORD(r.stream_rank)} of ${r.stream_count} streams.` });
    if (r.mean != null && r.class_mean != null && Number(r.mean) - Number(r.class_mean) <= -5) out.push({ tone: 'bad', text: `${groupName(r)}: ${Math.abs(Number(r.mean) - Number(r.class_mean)).toFixed(1)} points below the class average.` });
    if (r.learners === 0) out.push({ tone: 'info', text: `${groupName(r)}: no results this term yet.` });
  });
  const m = rep.marking; if (m && Number(m.marks_pending) > 0) out.push({ tone: 'bad', text: `${m.marks_pending} mark${Number(m.marks_pending) === 1 ? ' is' : 's are'} still waiting to be entered.` });
  (rep.class_teacher || []).forEach((c) => { const miss = Number(c.cards_total) - Number(c.cards_with_remarks); if (miss > 0) out.push({ tone: 'info', text: `${c.class_name}${c.stream_name ? ` ${c.stream_name}` : ''}: ${miss} report card${miss === 1 ? ' has' : 's have'} no class teacher remark yet.` }); });
  const a = rep.attendance; if (a && Number(a.lessons_taken) > Number(a.lessons_submitted)) out.push({ tone: 'bad', text: `${Number(a.lessons_taken) - Number(a.lessons_submitted)} lesson register${Number(a.lessons_taken) - Number(a.lessons_submitted) === 1 ? ' was' : 's were'} not submitted.` });
  return out;
}
