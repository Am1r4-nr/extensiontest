// Reads documents the user uploads and pulls out people with their positions.
//   Spreadsheets (XLSX, XLS, CSV): columns such as Nama / Name, Jawatan / Position,
//     Organisasi / Organisation and Gelaran / Titles are read directly, row by row.
//   Word (DOCX), PDF, pictures, saved web pages and text files: read like web pages.
// Everything stays in the browser. Results go to a preview first; nothing is saved until the user confirms.
import { readMediaBlob } from './media.js';
import { extractPeople, extractFromLines, contextFromText, parseName, stripHonorifics, normApos } from './extractor.js';

let xlsxPromise = null;
const xlsx = () => (xlsxPromise ||= import('./lib/xlsx.mjs'));

const NAME_COL = /^(nama|name|full ?name|nama penuh|individu|individual|person)\b/i;
const POS_COL = /(jawatan|position|designation|portfolio|role|appointment|pelantikan)/i;
const TITLE_POS_COL = /^(title|job title)$/i;
const ORG_COL = /(organi[sz]ation|organisasi|agensi|agency|kementerian|ministry|jabatan|department|company|syarikat|entity|institution)/i;
const HON_COL = /(gelaran|salutation|honou?rific|pangkat|prefix)/i;

const ext = name => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
const clean = v => normApos(v == null ? '' : String(v));

// Default context for uploaded documents: the user chose the document, so it counts as a leadership list.
function uploadContext(fileName, lines) {
  return contextFromText(fileName + ' ' + lines.slice(0, 10).join(' ')) || { position: 'Position not stated in document', tier: 2, fromPage: true };
}

function fromLines(lines, fileName, ocr = false) {
  return extractFromLines(lines, uploadContext(fileName, lines), 'upload').map(p => ({
    bareName: p.bareName, titles: p.titles, position: p.position, organisation: '', ocr, confidence: p.confidence
  }));
}

// ---------- Spreadsheets ----------
function mapHeader(row) {
  const cols = { name: -1, pos: -1, org: -1, hon: -1 };
  row.forEach((c, i) => {
    const t = clean(c);
    if (!t) return;
    if (cols.name < 0 && NAME_COL.test(t)) cols.name = i;
    else if (cols.pos < 0 && POS_COL.test(t)) cols.pos = i;
    else if (cols.org < 0 && ORG_COL.test(t)) cols.org = i;
    else if (cols.hon < 0 && HON_COL.test(t)) cols.hon = i;
  });
  if (cols.pos < 0) row.forEach((c, i) => { if (cols.pos < 0 && i !== cols.name && TITLE_POS_COL.test(clean(c))) cols.pos = i; });
  return cols;
}

function fromSheetRows(rows, fileName) {
  // Find the header row within the first 15 rows.
  for (let h = 0; h < Math.min(15, rows.length); h++) {
    const cols = mapHeader(rows[h] || []);
    if (cols.name < 0 || (cols.pos < 0 && cols.org < 0)) continue;
    const out = [];
    for (const r of rows.slice(h + 1)) {
      const rawName = clean(r[cols.name]);
      if (!rawName) continue;
      const hon = cols.hon >= 0 ? clean(r[cols.hon]) : '';
      const parsed = parseName(hon ? `${hon} ${rawName}` : rawName);
      // The user's own list: keep the name as written even if it does not look like a typical name.
      const stripped = stripHonorifics(rawName);
      out.push({
        bareName: parsed?.bareName || stripped.rest || rawName,
        titles: parsed ? parsed.titles.join(' ') : [hon, ...stripped.titles].filter(Boolean).join(' '),
        position: cols.pos >= 0 ? clean(r[cols.pos]) : '',
        organisation: cols.org >= 0 ? clean(r[cols.org]) : '',
        ocr: false,
        confidence: 'high'
      });
    }
    return { people: out, structured: true };
  }
  // No recognisable header: read the cells like a document, one row per box.
  const lines = [];
  for (const r of rows) { for (const c of r) { const t = clean(c); if (t) lines.push(t); } lines.push(''); }
  return { people: fromLines(lines, fileName), structured: false };
}

async function readSpreadsheet(file) {
  const X = await xlsx();
  const wb = X.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  let people = [], structured = false;
  for (const name of wb.SheetNames) {
    const rows = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
    const r = fromSheetRows(rows, file.name);
    people.push(...r.people);
    structured = structured || r.structured;
  }
  return { people, note: structured ? 'Read from the spreadsheet columns.' : 'No Name / Position column headings found, so the cells were read as text. Check the results carefully.' };
}

// ---------- Word (DOCX) ----------
async function readDocx(file) {
  const X = await xlsx();
  const zip = X.CFB.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  const entry = X.CFB.find(zip, 'word/document.xml') || X.CFB.find(zip, '/word/document.xml');
  if (!entry) throw new Error('This Word file could not be opened');
  const xml = new DOMParser().parseFromString(new TextDecoder('utf-8').decode(entry.content), 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const lines = [];
  const paraText = p => [...p.getElementsByTagNameNS(W, 't')].map(t => t.textContent).join('');
  const body = xml.getElementsByTagNameNS(W, 'body')[0];
  const walk = node => {
    for (const el of node.children) {
      if (el.localName === 'p') { const t = clean(paraText(el)); if (t) lines.push(t); }
      else if (el.localName === 'tbl') {
        for (const tr of el.getElementsByTagNameNS(W, 'tr')) {
          for (const tc of tr.getElementsByTagNameNS(W, 'tc')) {
            for (const p of tc.getElementsByTagNameNS(W, 'p')) { const t = clean(paraText(p)); if (t) lines.push(t); }
          }
          lines.push('');
        }
      } else walk(el);
    }
  };
  if (body) walk(body);
  return { people: fromLines(lines, file.name), note: 'Read from the Word document.' };
}

// ---------- Entry point ----------
export async function readUpload(file) {
  const e = ext(file.name);
  if (['xlsx', 'xls', 'xlsm', 'csv', 'ods'].includes(e)) return readSpreadsheet(file);
  if (e === 'docx') return readDocx(file);
  if (e === 'doc') throw new Error('Old Word (.doc) files cannot be read. Save it as .docx or PDF and upload again.');
  if (['html', 'htm', 'mhtml'].includes(e)) {
    const doc = new DOMParser().parseFromString(await file.text(), 'text/html');
    const found = extractPeople(doc, 'upload');
    return { people: found.map(p => ({ bareName: p.bareName, titles: p.titles, position: p.position, organisation: '', ocr: false, confidence: p.confidence })), note: 'Read from the saved web page.' };
  }
  if (e === 'txt') {
    const lines = (await file.text()).split(/\r?\n/).map(clean);
    return { people: fromLines(lines, file.name), note: 'Read from the text file.' };
  }
  if (e === 'pdf' || /^(png|jpe?g|webp|gif|bmp|svg)$/.test(e)) {
    const type = e === 'pdf' ? 'application/pdf' : e === 'svg' ? 'image/svg+xml' : 'image/' + (e === 'jpg' ? 'jpeg' : e);
    const r = await readMediaBlob(file, file.type || type, file.name);
    const ocr = r.method === 'image';
    return {
      people: fromLines(r.lines, file.name, ocr),
      note: ocr ? 'Read with text recognition. Check every spelling against the document before saving.' : 'Read from the PDF text.'
    };
  }
  throw new Error(`Files of type .${e || '?'} cannot be read. Use PDF, a picture, Excel/CSV, Word (.docx), a saved web page or a text file.`);
}
