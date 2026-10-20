/* IAL Monitor - Excel output in the same layout as the Investor Alert master file
 * Columns: No | Year | Name | Identity | Address | Website URL | Reasons
 */
(function (root) {
  const HEADERS = ['No', 'Year', 'Name', 'Identity', 'Address', 'Website URL', 'Reasons'];
  const WIDTHS = [9.27, 8.73, 49.45, 23, 25.45, 99.36, 57.63];
  const FONT = { name: 'Calibri', size: 11 };
  const THIN = { style: 'thin' };
  const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

  const norm = s => String(s || '').toLowerCase()
    .replace(/[\u2010-\u2015]/g, '-').replace(/[’‘]/g, "'")
    .replace(/\s*-\s*/g, ' - ').replace(/\s+/g, ' ').trim();

  function rowValues(e) {
    return [e.year, e.name, e.identity || null, e.address || null, e.website || null, e.reasons || null];
  }

  function styleDataCell(cell) {
    cell.font = { ...FONT };
    cell.alignment = { vertical: 'top', wrapText: true };
    cell.border = BORDER;
  }

  // New-entries workbook (+ a check log sheet for audit)
  async function buildNewEntriesWorkbook(ExcelJS, entries, logRows) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'IAL Monitor';
    const ws = wb.addWorksheet('Investor Alert', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = HEADERS.map((h, i) => ({ header: h, width: WIDTHS[i] }));
    ws.getRow(1).eachCell(c => { c.font = { ...FONT, bold: true }; c.border = BORDER; c.alignment = { vertical: 'top' }; });
    entries.forEach((e, i) => {
      const row = ws.addRow([i + 1, ...rowValues(e)]);
      row.eachCell({ includeEmpty: true }, styleDataCell);
    });
    ws.autoFilter = { from: 'A1', to: `G${Math.max(1, entries.length + 1)}` };

    const lg = wb.addWorksheet('Check Log');
    lg.columns = [
      { header: 'Checked on', width: 20 }, { header: 'Checked by', width: 18 },
      { header: 'SC update (as at)', width: 16 }, { header: 'SC announcement URL', width: 95 },
      { header: 'No. of entities', width: 14 }, { header: 'Entities', width: 70 }
    ];
    lg.getRow(1).eachCell(c => { c.font = { ...FONT, bold: true }; c.border = BORDER; });
    logRows.forEach(r => lg.addRow(r).eachCell({ includeEmpty: true }, styleDataCell));
    return wb.xlsx.writeBuffer();
  }

  // Append to the user's own master file, keeping its layout
  async function appendToMaster(ExcelJS, buffer, entries) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.getWorksheet('Investor Alert') || wb.worksheets[0];
    if (!ws) throw new Error('The file has no worksheet.');
    const header = [1, 2, 3].map(c => String(ws.getRow(1).getCell(c).value || '').trim().toLowerCase());
    if (header[2] !== 'name') throw new Error('This does not look like the Investor Alert master file (cell C1 should say "Name").');

    let last = ws.rowCount;
    while (last > 1 && !String(ws.getRow(last).getCell(3).value ?? '').trim()) last--;

    const existing = new Set();
    for (let r = 2; r <= last; r++) {
      const v = ws.getRow(r).getCell(3).value;
      existing.add(norm(typeof v === 'object' && v && v.richText ? v.richText.map(t => t.text).join('') : v));
    }

    const lastRow = ws.getRow(last);
    const a = lastRow.getCell(1).value;
    let lastNo = typeof a === 'number' ? a : (a && typeof a.result === 'number' ? a.result : last - 1);
    const template = [1, 2, 3, 4, 5, 6, 7].map(c => JSON.parse(JSON.stringify(lastRow.getCell(c).style || {})));

    const added = [], skipped = [];
    let r = last;
    for (const e of entries) {
      if (existing.has(norm(e.name))) { skipped.push(e.name); continue; }
      r++; lastNo++;
      const row = ws.getRow(r);
      [lastNo, ...rowValues(e)].forEach((v, i) => {
        const cell = row.getCell(i + 1);
        cell.value = v;
        cell.style = JSON.parse(JSON.stringify(template[i]));
        cell.alignment = { ...(cell.alignment || {}), vertical: 'top', wrapText: true };
      });
      row.commit && row.commit();
      existing.add(norm(e.name));
      added.push(e.name);
    }
    const out = await wb.xlsx.writeBuffer();
    return { buffer: out, added, skipped, firstNewRow: last + 1, lastRow: r };
  }

  // Names in a master file (for duplicate warnings before export)
  async function readMasterNames(ExcelJS, buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.getWorksheet('Investor Alert') || wb.worksheets[0];
    const names = new Set();
    ws.eachRow((row, n) => { if (n > 1) { const v = row.getCell(3).value; if (v) names.add(norm(v.richText ? v.richText.map(t => t.text).join('') : v)); } });
    return names;
  }

  root.IALExcel = { HEADERS, buildNewEntriesWorkbook, appendToMaster, readMasterNames, norm };
})(typeof self !== 'undefined' ? self : globalThis);
