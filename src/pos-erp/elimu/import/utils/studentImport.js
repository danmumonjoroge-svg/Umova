// elimu/import/utils/studentImport.js -- maps a school's own column headings to the import layout and cleans the values.
// Pure functions. The database re-checks every value; this only makes common old-system layouts easy.

export const FIELDS = [
  { key: 'admission_no', label: 'Admission number', required: true, aliases: ['admissionno', 'admno', 'admission', 'admissionnumber', 'regno', 'registrationnumber', 'admn', 'adm', 'studentno', 'studentnumber'] },
  { key: 'first_name', label: 'First name', required: true, aliases: ['firstname', 'first', 'forename', 'givenname'] },
  { key: 'middle_name', label: 'Middle name', aliases: ['middlename', 'middle', 'othernames', 'othername'] },
  { key: 'last_name', label: 'Last name', required: true, aliases: ['lastname', 'surname', 'last', 'familyname'] },
  { key: 'full_name', label: 'Full name (if one column)', aliases: ['name', 'fullname', 'studentname', 'nameofstudent', 'pupilname'], splitOnly: true },
  { key: 'gender', label: 'Gender', aliases: ['gender', 'sex'] },
  { key: 'date_of_birth', label: 'Date of birth', date: true, aliases: ['dateofbirth', 'dob', 'birthdate', 'birthday'] },
  { key: 'admission_date', label: 'Admission date', date: true, aliases: ['admissiondate', 'dateadmitted', 'dateofadmission', 'datejoined', 'joined'] },
  { key: 'class', label: 'Class', required: true, aliases: ['class', 'grade', 'form', 'classname', 'currentclass', 'level'] },
  { key: 'stream', label: 'Stream', aliases: ['stream', 'streamname'] },
  { key: 'previous_school', label: 'Previous school', aliases: ['previousschool', 'formerschool', 'lastschool', 'schoolattendedbefore'] },
  { key: 'g1_name', label: 'Guardian 1 name', aliases: ['guardian1name', 'guardianname', 'parentname', 'parent', 'guardian', 'parent1name', 'parent1', 'guardian1', 'nameofparent'] },
  { key: 'g1_relationship', label: 'Guardian 1 relationship', aliases: ['guardian1relationship', 'relationship', 'relation', 'parentrelationship', 'parent1relationship'] },
  { key: 'g1_phone', label: 'Guardian 1 phone', aliases: ['guardian1phone', 'parentphone', 'guardianphone', 'phone', 'phonenumber', 'parentcontact', 'contact', 'tel', 'mobile', 'parent1phone', 'guardianphoneno', 'parentphoneno'] },
  { key: 'g1_email', label: 'Guardian 1 email', aliases: ['guardian1email', 'parentemail', 'guardianemail', 'email', 'parent1email'] },
  { key: 'g2_name', label: 'Guardian 2 name', aliases: ['guardian2name', 'parent2name', 'parent2', 'guardian2', 'secondparent'] },
  { key: 'g2_relationship', label: 'Guardian 2 relationship', aliases: ['guardian2relationship', 'parent2relationship'] },
  { key: 'g2_phone', label: 'Guardian 2 phone', aliases: ['guardian2phone', 'parent2phone', 'parent2contact', 'secondparentphone'] },
  { key: 'g2_email', label: 'Guardian 2 email', aliases: ['guardian2email', 'parent2email'] },
];
export const MAX_ROWS = 3000;
const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** headers -> { field key: column index | -1 }. Each column is used for at most one field. */
export function autoMap(headers) {
  const hs = headers.map(norm); const used = new Set(); const map = {};
  for (const f of FIELDS) { const i = hs.findIndex((h, ix) => !used.has(ix) && f.aliases.includes(h)); map[f.key] = i; if (i >= 0) used.add(i); }
  return map;
}
/** What is still missing before the file can be checked. */
export function mappingProblems(map) {
  const out = []; const has = (k) => map[k] >= 0;
  if (!has('admission_no')) out.push('Choose the Admission number column.');
  if (!has('class')) out.push('Choose the Class column.');
  if (!(has('first_name') && has('last_name')) && !has('full_name')) out.push('Choose First name and Last name columns, or one Full name column.');
  return out;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const p2 = (n) => String(n).padStart(2, '0');
/** Dates from old files: 2014-03-27, 27/03/2014 (day first, as in Kenya), 27-Mar-2014, or an Excel serial number like 41725. Anything else is returned unchanged so the check can name it. */
export function toIsoDate(v) {
  const t = String(v ?? '').trim(); if (!t) return '';
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(t); if (m) return `${m[1]}-${p2(m[2])}-${p2(m[3])}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t); if (m) return `${m[3]}-${p2(m[2])}-${p2(m[1])}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/.exec(t); if (m) return `${+m[3] > 40 ? 19 : 20}${m[3]}-${p2(m[2])}-${p2(m[1])}`;
  m = /^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ ,-]*(\d{4})$/.exec(t); if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${p2(MONTHS[m[2].toLowerCase()])}-${p2(m[1])}`;
  if (/^\d{4,5}(\.\d+)?$/.test(t)) { const n = Math.floor(parseFloat(t)); if (n > 1000 && n < 90000) { const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`; } }
  return t;
}
const cleanId = (v) => String(v ?? '').trim().replace(/\.0+$/, '');   // Excel turns 1234 into 1234.0 in some exports

/** table.rows + mapping -> rows in the import layout (all strings). Blank rows are dropped. */
export function buildRows(rows, map) {
  const out = [];
  for (const r of rows) {
    if (!r.some((c) => String(c).trim() !== '')) continue;
    const o = {}; for (const f of FIELDS) { if (f.splitOnly) continue; const i = map[f.key]; let v = i >= 0 ? String(r[i] ?? '').trim() : ''; if (f.date) v = toIsoDate(v); if (f.key === 'admission_no' || f.key === 'class') v = cleanId(v); o[f.key] = v; }
    if (map.full_name >= 0 && !o.first_name && !o.last_name) {
      const parts = String(r[map.full_name] ?? '').trim().split(/\s+/).filter(Boolean);
      if (parts.length === 1) o.last_name = parts[0]; else if (parts.length > 1) { o.first_name = parts[0]; o.last_name = parts[parts.length - 1]; o.middle_name = o.middle_name || parts.slice(1, -1).join(' '); }
    }
    out.push(o);
  }
  return out;
}

export const TEMPLATE_HEADERS = ['Admission number', 'First name', 'Middle name', 'Last name', 'Gender', 'Date of birth', 'Admission date', 'Class', 'Stream', 'Previous school', 'Guardian 1 name', 'Guardian 1 relationship', 'Guardian 1 phone', 'Guardian 1 email', 'Guardian 2 name', 'Guardian 2 relationship', 'Guardian 2 phone', 'Guardian 2 email'];
export const TEMPLATE_CSV = `${TEMPLATE_HEADERS.join(',')}\n` +
  'ADM-0001,Amani,,Oduor,F,2015-04-02,2021-01-11,Grade 5,Blue,Little Stars Academy,Rose Oduor,Mother,0711 000 111,rose@example.com,John Oduor,Father,0711 000 222,\n' +
  'ADM-0002,Baraka,Peter,Oduor,M,2017-09-20,2023-01-09,Grade 3,,,Rose Oduor,Mother,0711 000 111,,,,,\n';
