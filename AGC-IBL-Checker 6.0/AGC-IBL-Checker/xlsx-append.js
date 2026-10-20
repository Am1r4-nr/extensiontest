/*
 * xlsx-append.js
 * Appends rows to existing .xlsx workbooks by editing the sheet XML directly,
 * so every existing style, column width, filter, hyperlink and formatting rule
 * in the master file is preserved. New cells copy the style of the last data row.
 */
(function (root) {
  'use strict';

  const XML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => XML_ESC[c]);
  const unesc = (s) => s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

  function colToNum(col) {
    let n = 0;
    for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  }

  // Excel serial date (1900 system) for a JS Date at local midnight
  function excelSerial(d) {
    const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((utc - Date.UTC(1899, 11, 30)) / 86400000);
  }

  async function resolveSheetPaths(zip) {
    const wb = await zip.file('xl/workbook.xml').async('string');
    const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    const relMap = {};
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = (m[0].match(/\bId="([^"]+)"/) || [])[1];
      const target = (m[0].match(/\bTarget="([^"]+)"/) || [])[1];
      if (id && target) {
        relMap[id] = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      }
    }
    const sheets = [];
    for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
      const name = unesc((m[0].match(/\bname="([^"]*)"/) || [])[1] || '');
      const rid = (m[0].match(/\br:id="([^"]+)"/) || [])[1];
      sheets.push({ name, path: relMap[rid] });
    }
    return sheets;
  }

  async function readSharedStrings(zip) {
    const f = zip.file('xl/sharedStrings.xml');
    if (!f) return [];
    const xml = await f.async('string');
    const out = [];
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      let t = '';
      for (const tm of m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) t += tm[1];
      // skip phonetic runs
      out.push(unesc(t));
    }
    return out;
  }

  function cellValue(cellXml, shared) {
    const type = (cellXml.match(/\bt="([^"]+)"/) || [])[1];
    if (type === 'inlineStr') {
      let t = '';
      for (const tm of cellXml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) t += tm[1];
      return unesc(t);
    }
    const v = (cellXml.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
    if (v == null) return null;
    if (type === 's') return shared[+v];
    if (type === 'str') return unesc(v);
    return v;
  }

  // Read every value in one column of a sheet (row 2 onwards)
  async function readColumn(zip, sheetPath, col) {
    const shared = await readSharedStrings(zip);
    const xml = await zip.file(sheetPath).async('string');
    const re = new RegExp('<c r="' + col + '(\\d+)"[^>]*?(?:/>|>[\\s\\S]*?</c>)', 'g');
    const out = [];
    for (const m of xml.matchAll(re)) {
      if (+m[1] < 2) continue;
      const v = cellValue(m[0], shared);
      if (v != null && String(v).trim() !== '') out.push({ row: +m[1], value: String(v) });
    }
    return out;
  }

  // Find the last row in sheetData whose column A holds a number (the running "No")
  function findLastDataRow(xml) {
    const end = xml.indexOf('</sheetData>');
    if (end < 0) throw new Error('Sheet has no sheetData');
    let pos = end;
    for (let i = 0; i < 400; i++) {
      const start = xml.lastIndexOf('<row ', pos - 1);
      if (start < 0) break;
      const rowEnd = xml.indexOf('</row>', start);
      const rowXml = rowEnd > 0 && rowEnd < end + 1 ? xml.slice(start, rowEnd + 6) : xml.slice(start, xml.indexOf('>', start) + 1);
      const r = +(rowXml.match(/^<row [^>]*\br="(\d+)"/) || [])[1];
      const aCell = rowXml.match(/<c r="A\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/);
      const aVal = aCell ? (aCell[0].match(/<v>([^<]*)<\/v>/) || [])[1] : null;
      if (aVal != null && /^\d+(\.0+)?$/.test(aVal)) {
        return { rowNum: r, rowXml, lastNo: parseInt(aVal, 10), sheetDataEnd: end, lastRowStart: start };
      }
      pos = start;
    }
    // Header-only sheet
    return { rowNum: 1, rowXml: null, lastNo: 0, sheetDataEnd: end, lastRowStart: -1 };
  }

  function cellStyles(rowXml) {
    const styles = {};
    if (!rowXml) return styles;
    for (const m of rowXml.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(\/?)>/g)) {
      const s = (m[2].match(/\bs="(\d+)"/) || [])[1];
      if (s) styles[m[1]] = s;
    }
    return styles;
  }

  function rowOpenTag(templateRowXml, r, lastCol) {
    if (!templateRowXml) return `<row r="${r}" spans="1:${lastCol}">`;
    let tag = templateRowXml.match(/^<row [^>]*>/)[0];
    tag = tag.replace(/\br="\d+"/, `r="${r}"`).replace(/\bspans="[^"]*"/, `spans="1:${lastCol}"`);
    return tag;
  }

  /*
   * columns: [{ col: 'A', type: 'number'|'string'|'date' }]
   * rows: array of objects keyed by column letter. 'A' is auto-numbered when value === '__AUTO__'.
   */
  function appendRowsToSheetXml(xml, columns, rows) {
    const info = findLastDataRow(xml);
    const styles = cellStyles(info.rowXml);
    const lastColNum = Math.max(...columns.map((c) => colToNum(c.col)));
    let r = info.rowNum;
    let no = info.lastNo;
    let added = '';
    for (const row of rows) {
      r += 1;
      no += 1;
      let cells = '';
      for (const c of columns) {
        const ref = c.col + r;
        const s = styles[c.col] ? ` s="${styles[c.col]}"` : '';
        let v = row[c.col];
        if (v === '__AUTO__') v = no;
        if (v == null || v === '') { cells += `<c r="${ref}"${s}/>`; continue; }
        if (c.type === 'number' || c.type === 'date') {
          cells += `<c r="${ref}"${s}><v>${Number(v)}</v></c>`;
        } else {
          const txt = String(v);
          const sp = /^\s|\s$|\n/.test(txt) ? ' xml:space="preserve"' : '';
          cells += `<c r="${ref}"${s} t="inlineStr"><is><t${sp}>${esc(txt)}</t></is></c>`;
        }
      }
      added += rowOpenTag(info.rowXml, r, lastColNum) + cells + '</row>';
    }

    // Insert after the last data row (drop any stray empty rows that followed it so row order stays valid)
    let insertAt = info.sheetDataEnd;
    let tail = '';
    if (info.lastRowStart >= 0) {
      const afterLast = info.lastRowStart + info.rowXml.length;
      const between = xml.slice(afterLast, info.sheetDataEnd);
      // keep only rows beyond our new range
      for (const m of between.matchAll(/<row [^>]*\br="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g)) {
        if (+m[1] > r) tail += m[0];
      }
      insertAt = afterLast;
    }
    let out = xml.slice(0, insertAt) + added + tail + xml.slice(info.sheetDataEnd);

    // Update <dimension ref="A1:X123"/>
    out = out.replace(/<dimension ref="([A-Z]+\d+):([A-Z]+)(\d+)"\/>/, (m, a, col, row) =>
      `<dimension ref="${a}:${col}${Math.max(+row, r)}"/>`);

    // Extend a hyperlink range that ended on the old last row and points at the AGC page
    out = out.replace(/<hyperlink ref="([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?"([^>]*)\/>/g, (m, c1, r1, c2, r2, rest) => {
      const endRow = +(r2 || r1);
      if (endRow === info.rowNum && /lom\.agc\.gov\.my/.test(rest) && (!c2 || c2 === c1) && rows.length) {
        return `<hyperlink ref="${c1}${r1}:${c1}${r}"${rest}/>`;
      }
      return m;
    });

    return { xml: out, firstRow: info.rowNum + 1, lastRow: r, firstNo: info.lastNo + 1, lastNo: no };
  }

  async function appendToWorkbook(JSZipLib, fileData, sheetSpecs) {
    const zip = await JSZipLib.loadAsync(fileData);
    const sheets = await resolveSheetPaths(zip);
    const report = [];
    for (const spec of sheetSpecs) {
      const sh = sheets.find((s) => s.name === spec.sheetName) || sheets[spec.fallbackIndex ?? 0];
      if (!sh) throw new Error(`Sheet "${spec.sheetName}" not found`);
      const xml = await zip.file(sh.path).async('string');
      const res = appendRowsToSheetXml(xml, spec.columns, spec.rows);
      zip.file(sh.path, res.xml);
      report.push({ sheet: sh.name, ...res, xml: undefined });
    }
    const blob = await zip.generateAsync({
      type: typeof Blob !== 'undefined' && typeof window !== 'undefined' ? 'blob' : 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    return { blob, report };
  }

  async function readNames(JSZipLib, fileData, sheetName, col) {
    const zip = await JSZipLib.loadAsync(fileData);
    const sheets = await resolveSheetPaths(zip);
    const sh = sheets.find((s) => s.name === sheetName) || sheets[0];
    const values = await readColumn(zip, sh.path, col);
    const xml = await zip.file(sh.path).async('string');
    const last = findLastDataRow(xml);
    return { sheet: sh.name, values, lastNo: last.lastNo, lastRow: last.rowNum };
  }

  const api = { appendToWorkbook, readNames, readColumn, excelSerial, resolveSheetPaths, appendRowsToSheetXml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.XlsxAppend = api;
})(typeof self !== 'undefined' ? self : this);
