// elimu/report_cards/utils/reportCardHtml.js
// PURE: report-card payload (from elimu_get_report_cards) -> HTML string. No DOM, no network, so it is unit-tested.
// Printing itself is done by the POS's existing printDocument() (see printReportCards.js): there is NO second document engine.
// Approved / published cards are rendered from their frozen snapshot, so a reprint is always identical to what was approved.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = 1) => (v === null || v === undefined || v === '' ? '' : Number(v).toFixed(d).replace(/\.0+$/, ''));
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

export const REPORT_CARD_STYLE = `
.rc{page-break-after:always;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#1b2b21;padding:6px 4px;position:relative}
.rc:last-child{page-break-after:auto}
.rc h1{font-size:18px;margin:0}.rc .hd{display:flex;gap:12px;align-items:center;border-bottom:2px solid #1F6B45;padding-bottom:8px;margin-bottom:8px}
.rc .hd img{max-height:64px;max-width:90px;object-fit:contain}.rc .sub{color:#5a6b60;font-size:11px}
.rc .title{text-align:center;font-weight:700;letter-spacing:.06em;margin:6px 0;font-size:14px}
.rc table{width:100%;border-collapse:collapse;margin:6px 0}.rc th,.rc td{border:1px solid #c9d3cc;padding:4px 6px;text-align:left;vertical-align:top}
.rc th{background:#eef3ef}.rc td.n,.rc th.n{text-align:right;white-space:nowrap}.rc .meta td{border:none;padding:2px 6px}
.rc .overall td{font-weight:700;background:#f6f8f6}.rc .box{border:1px solid #c9d3cc;border-radius:4px;padding:6px 8px;margin:6px 0;min-height:34px}
.rc .lbl{font-size:10px;color:#5a6b60;text-transform:uppercase;letter-spacing:.05em}.rc .sig{display:flex;gap:24px;margin-top:18px}.rc .sig div{flex:1;border-top:1px solid #1b2b21;padding-top:3px;font-size:11px}
.rc .key{font-size:10px;color:#475a4e}.rc .wm{position:absolute;top:38%;left:8%;font-size:72px;color:rgba(200,0,0,.12);transform:rotate(-25deg);pointer-events:none;font-weight:800}
.rc .note{background:#fff7e0;border:1px solid #e3c870;padding:4px 8px;margin:4px 0;font-size:11px}
.rc .inc{color:#a14b00;font-style:italic}`;

export function reportCardHtml(p) {
  if (!p) return '';
  const s = p.school || {}; const st = p.student || {}; const o = p.overall || {}; const rm = p.remarks || {}; const disp = p.display || {}; const card = p.card || {};
  const showPts = disp.show_grade_points !== false; const showPos = disp.show_positions !== false;
  const rows = (p.subjects || []).map((x) => {
    const done = x.completeness === 'COMPLETE';
    return `<tr><td>${esc(x.name)}</td><td class="n">${done ? esc(num(x.percentage)) : '<span class="inc">—</span>'}</td><td class="n">${done ? esc(x.grade ?? '') : ''}</td>`
      + (showPts ? `<td class="n">${done ? esc(num(x.grade_point, 2)) : ''}</td>` : '')
      + `<td>${done ? esc(x.teacher_remark || x.descriptor || '') : '<span class="inc">Incomplete: marks not yet final</span>'}</td></tr>`;
  }).join('');
  const bands = (p.grading?.bands || []).map((b) => `${esc(b.grade)} ${esc(num(b.min, 0))}–${esc(num(b.max, 0))}`).join(' &nbsp;|&nbsp; ');
  const wm = p.draft ? '<div class="wm">DRAFT</div>' : '';
  const revised = card.revision_no > 1 ? `<div class="note">Corrected report card (revision ${esc(card.revision_no)}). It replaces any earlier copy.</div>` : '';
  return `<div class="rc">${wm}
  <div class="hd">${s.logo_url ? `<img src="${esc(s.logo_url)}" alt="">` : ''}<div><h1>${esc(s.name)}</h1>
    <div class="sub">${[s.address, s.phone, s.email].filter(Boolean).map(esc).join(' · ')}</div>${s.motto ? `<div class="sub"><i>${esc(s.motto)}</i></div>` : ''}</div></div>
  <div class="title">REPORT CARD — ${esc(p.term?.name)} ${esc(p.academic_year?.name)}</div>${revised}
  <table class="meta"><tr><td><span class="lbl">Student</span><br><b>${esc(st.full_name)}</b></td><td><span class="lbl">Admission no.</span><br><b>${esc(st.admission_number)}</b></td>
    <td><span class="lbl">Class</span><br><b>${esc(p.class?.name)}${p.stream?.name ? ' ' + esc(p.stream.name) : ''}</b></td></tr></table>
  <table><thead><tr><th>Subject</th><th class="n">Marks %</th><th class="n">Grade</th>${showPts ? '<th class="n">Points</th>' : ''}<th>Remarks</th></tr></thead><tbody>${rows}
    <tr class="overall"><td>Overall</td><td class="n">${esc(num(o.mean_percentage))}</td><td class="n">${esc(o.grade ?? '')}</td>${showPts ? `<td class="n">${esc(num(o.grade_point, 2))}</td>` : ''}<td>${esc(o.remark || o.descriptor || '')}${o.is_complete ? '' : ' <span class="inc">(some subjects incomplete)</span>'}</td></tr></tbody></table>
  ${showPos && o.class_position ? `<div>Position in class: <b>${esc(ordinal(o.class_position))}</b> of ${esc(o.class_size)}${o.stream_position ? ` &nbsp;·&nbsp; In stream: <b>${esc(ordinal(o.stream_position))}</b> of ${esc(o.stream_size)}` : ''}</div>` : ''}
  <div class="box"><div class="lbl">Class teacher's remarks${rm.class_teacher_name ? ' — ' + esc(rm.class_teacher_name) : ''}</div>${esc(rm.class_teacher || '')}</div>
  <div class="box"><div class="lbl">${esc(s.headteacher_title || 'Head Teacher')}'s remarks${rm.head_name || s.headteacher_name ? ' — ' + esc(rm.head_name || s.headteacher_name) : ''}</div>${esc(rm.head || '')}</div>
  <div class="sig"><div>Class teacher</div><div>${esc(s.headteacher_title || 'Head Teacher')}</div><div>Parent / guardian</div></div>
  ${bands ? `<div class="key" style="margin-top:8px"><b>Grading key${p.grading?.scheme_name ? ' (' + esc(p.grading.scheme_name) + ')' : ''}:</b> ${bands}</div>` : ''}
  ${s.footer ? `<div class="key">${esc(s.footer)}</div>` : ''}</div>`;
}

/** Many cards, one per page. */
export const reportCardsHtml = (payloads) => payloads.map(reportCardHtml).join('');
