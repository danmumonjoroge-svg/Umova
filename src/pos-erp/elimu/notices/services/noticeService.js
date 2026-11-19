// elimu/notices/services/noticeService.js -- notices and announcements (elimu_1015): an in-app notice board for staff and parents.
import { rpc } from '../../shared/services/elimuDb';

export const AUDIENCES = [['EVERYONE', 'Parents and staff'], ['PARENTS', 'All parents'], ['STAFF', 'Staff only'], ['CLASS', 'One class']];
export const AUDIENCE_LABEL = Object.fromEntries(AUDIENCES);
export function noticeProblems({ title, body, audience, classId, expires }) {
  const p = [];
  if (String(title || '').trim().length < 3) p.push('Give the notice a title.');
  if (String(body || '').trim().length < 3) p.push('Write the notice.');
  if (audience === 'CLASS' && !classId) p.push('Choose the class.');
  if (expires && new Date(`${expires}T23:59:59`) < new Date()) p.push('The expiry date is in the past.');
  return p;
}
export const noticeService = {
  board: (includeOld) => rpc('elimu_notice_board', { p_include_old: !!includeOld }),
  post: ({ title, body, audience, classId, important, expires, publishFrom }) => rpc('elimu_notice_post', { p_title: title.trim(), p_body: body.trim(), p_audience: audience, p_class: audience === 'CLASS' ? classId : null, p_important: !!important, p_expires: expires || null, p_publish_from: publishFrom ? new Date(publishFrom).toISOString() : null }),
  withdraw: (id) => rpc('elimu_notice_withdraw', { p_notice: id }),
};
