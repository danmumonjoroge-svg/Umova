// elimu/import/utils/readSheet.js -- reads a school's old spreadsheet in the browser. No library needed:
//   .csv  -> text parser (comma or semicolon)
//   .xlsx -> an .xlsx file is a zip of XML; the zip is opened with the browser's built-in DecompressionStream, the first sheet is read.
// Returns { headers:[string], rows:[[string]] }. Everything stays in the browser until the school presses "Check the file".
import { parseCsv } from '../../finance/utils/statementImport.js';

const u16 = (d, o) => d[o] | (d[o + 1] << 8);
const u32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
const utf8 = (b) => new TextDecoder('utf-8').decode(b);

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open .xlsx files. Save the sheet as CSV from Excel and upload that instead.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Lists the entries of a zip: { name -> { method, csize, usize, offset } }. */
export function zipEntries(d) {
  let e = -1; for (let i = d.length - 22; i >= Math.max(0, d.length - 65557); i--) { if (u32(d, i) === 0x06054b50) { e = i; break; } }
  if (e < 0) throw new Error('This file is not a valid .xlsx workbook.');
  const total = u16(d, e + 10); let p = u32(d, e + 16); const out = {};
  for (let n = 0; n < total; n++) {
    if (u32(d, p) !== 0x02014b50) break;
    const nl = u16(d, p + 28), el = u16(d, p + 30), cl = u16(d, p + 32);
    out[utf8(d.subarray(p + 46, p + 46 + nl))] = { method: u16(d, p + 10), csize: u32(d, p + 20), usize: u32(d, p + 24), offset: u32(d, p + 42) };
    p += 46 + nl + el + cl;
  }
  return out;
}
async function entryText(d, ent) {
  const o = ent.offset; if (u32(d, o) !== 0x04034b50) throw new Error('This file is not a valid .xlsx workbook.');
  const start = o + 30 + u16(d, o + 26) + u16(d, o + 28); const raw = d.subarray(start, start + ent.csize);
  if (ent.method === 0) return utf8(raw);
  if (ent.method === 8) return utf8(await inflateRaw(raw));
  throw new Error('This workbook uses a compression this page cannot read. Save the sheet as CSV from Excel and upload that instead.');
}

const unent = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const textOf = (xml) => { let s = ''; xml.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (_, t) => { s += unent(t); return ''; }); return s; };
const colIndex = (ref) => { const m = /^([A-Z]+)/.exec(ref); let n = 0; for (const ch of m ? m[1] : 'A') n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

/** Reads the first worksheet of an .xlsx (ArrayBuffer or Uint8Array) into an array of string rows. */
export async function readXlsx(buf) {
  const d = buf instanceof Uint8Array ? buf : new Uint8Array(buf); const files = zipEntries(d);
  const sheets = Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/(\d+)\.xml/)[1]) - parseInt(b.match(/(\d+)\.xml/)[1]));
  if (!sheets.length) throw new Error('No sheet was found in this workbook.');
  const shared = []; if (files['xl/sharedStrings.xml']) { (await entryText(d, files['xl/sharedStrings.xml'])).replace(/<si\b[^>]*>([\s\S]*?)<\/si>/g, (_, si) => { shared.push(textOf(si)); return ''; }); }
  const xml = await entryText(d, files[sheets[0]]); const rows = [];
  xml.replace(/<row\b[^>]*>([\s\S]*?)<\/row>/g, (_, rowXml) => {
    const cells = [];
    rowXml.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (__, attrs, inner) => {
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs); const t = /\bt="(\w+)"/.exec(attrs); const i = ref ? colIndex(ref[1]) : cells.length; let v = '';
      if (inner) {
        if (t && t[1] === 'inlineStr') v = textOf(inner);
        else { const m = /<v>([\s\S]*?)<\/v>/.exec(inner); if (m) v = t && t[1] === 's' ? (shared[+m[1]] ?? '') : t && t[1] === 'b' ? (m[1] === '1' ? 'TRUE' : 'FALSE') : unent(m[1]); }
      }
      while (cells.length < i) cells.push(''); cells[i] = v; return '';
    });
    rows.push(cells);
  });
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/** file: a File (name, text(), arrayBuffer()). Returns { headers, rows }. The first non-empty row is the header. */
export async function readTable(file) {
  const name = String(file.name || '').toLowerCase(); let rows;
  if (name.endsWith('.xlsx')) rows = await readXlsx(await file.arrayBuffer());
  else if (name.endsWith('.csv') || name.endsWith('.txt')) rows = parseCsv(await file.text());
  else throw new Error('Upload an Excel (.xlsx) or CSV (.csv) file. Older .xls files: open them in Excel and Save As .xlsx.');
  if (rows.length < 2) throw new Error('The file needs a header row and at least one student row.');
  const headers = rows[0].map((h) => String(h ?? '').trim()); const width = headers.length;
  return { headers, rows: rows.slice(1).map((r) => Array.from({ length: width }, (_, i) => String(r[i] ?? '').trim())) };
}
