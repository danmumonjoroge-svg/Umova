// elimu/library/services/bookService.js -- physical book lending (elimu_1014). Needs library.manage.
import { rpc } from '../../shared/services/elimuDb';

export const money = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
export const LOAN_VIEWS = [['out', 'On loan'], ['overdue', 'Overdue'], ['fines', 'Fines'], ['history', 'History'], ['books', 'Catalogue']];
export function bookProblems({ title, copies, accessions }) {
  const p = [];
  if (String(title || '').trim().length < 2) p.push('Give the book a title.');
  const acc = String(accessions || '').split(/[\s,;]+/).filter(Boolean);
  if (!acc.length) { const n = Number(copies); if (!(n >= 1 && n <= 200)) p.push('Add 1 to 200 copies.'); }
  else if (new Set(acc).size !== acc.length) p.push('An accession number is repeated.');
  return p;
}
export const bookService = {
  list: (search) => rpc('elimu_book_list', { p_search: search || null }),
  add: ({ title, author, isbn, copies, price, accessions }) => {
    const acc = String(accessions || '').split(/[\s,;]+/).filter(Boolean);
    return rpc('elimu_book_add', { p_title: title, p_author: author || null, p_isbn: isbn || null, p_subject: null, p_copies: acc.length ? null : Number(copies), p_price: Number(price || 0), p_accessions: acc.length ? acc : null });
  },
  loans: (view, search) => rpc('elimu_loan_list', { p_view: view, p_student: null, p_search: search || null }),
  issue: (accession, studentId, due) => rpc('elimu_loan_issue', { p_accession: accession, p_student: studentId, p_due: due || null }),
  giveBack: (loanId, lost, note) => rpc('elimu_loan_return', { p_loan: loanId, p_lost: !!lost, p_note: note || null }),
  settle: (loanId, action) => rpc('elimu_loan_fine_settle', { p_loan: loanId, p_action: action }),
  getSettings: () => rpc('elimu_book_settings_get'),
  setSettings: (s) => rpc('elimu_book_settings_set', { p_loan_days: Number(s.loan_days), p_fine_per_day: Number(s.fine_per_day), p_max_loans: Number(s.max_loans) }),
};
