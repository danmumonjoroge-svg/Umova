// elimu/report_cards/services/printReportCards.js
// Individual, selected, whole-class or whole-stream report cards through the POS's EXISTING print engine (printDocument -> the
// device's print dialog -> "Save as PDF"). No new document/PDF engine. Logos pass through the POS's safeLogoUrl().
import { printDocument } from '../../../utils/printDocument';
import { safeLogoUrl } from '../../../utils/branding';
import { reportCardService } from './reportCardService';
import { reportCardsHtml, REPORT_CARD_STYLE } from '../utils/reportCardHtml';

/** cardIds: ids from elimu_list_report_cards. Returns the number printed. Drafts print with a DRAFT watermark. */
export async function printReportCards(cardIds, { tenantId } = {}) {
  if (!cardIds?.length) throw new Error('Choose at least one report card.');
  const rows = await reportCardService.payloads(cardIds);
  if (!rows.length) throw new Error('You do not have access to those report cards.');
  const payloads = rows.map((r) => ({ ...r.payload, school: { ...r.payload.school, logo_url: safeLogoUrl(r.payload.school?.logo_url, tenantId) || null } }));
  printDocument(payloads.length === 1 ? `Report card - ${payloads[0].student?.full_name}` : `Report cards (${payloads.length})`, reportCardsHtml(payloads), REPORT_CARD_STYLE);
  return payloads.length;
}

/** Whole class / stream: pages through the list (200 per page) and prints everything that matches the filters. */
export async function printClassReportCards({ yearId, termId, classId, streamId, status, tenantId }) {
  const ids = []; let page = 0; let total = Infinity;
  while (ids.length < total) {
    const r = await reportCardService.listCards({ yearId, termId, classId, streamId, status, page, pageSize: 200 });
    total = r.total; ids.push(...r.rows.map((x) => x.card_id)); page += 1; if (!r.rows.length) break;
  }
  return printReportCards(ids, { tenantId });
}
