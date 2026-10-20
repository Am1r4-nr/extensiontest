/* pdftext.js — turns a PDF (ArrayBuffer) into plain text with sensible spaces between words */
(function (root) {
  'use strict';

  async function extractPdfText(pdfjsLib, data) {
    const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      let out = '';
      let prev = null;
      for (const it of tc.items) {
        if (typeof it.str !== 'string') continue;
        const x = it.transform[4], y = it.transform[5];
        const size = Math.hypot(it.transform[2], it.transform[3]) || 10;
        if (prev) {
          const sameLine = Math.abs(y - prev.y) < size * 0.5;
          if (!sameLine) out += '\n';
          else {
            const gap = x - (prev.x + prev.w);
            if (gap > size * 0.12 && !out.endsWith(' ') && !it.str.startsWith(' ')) out += ' ';
          }
        }
        out += it.str;
        if (it.hasEOL) out += '\n';
        prev = { x, y, w: it.width, size };
      }
      pages.push(out);
    }
    return { text: pages.join('\n\n'), pages: pages.length };
  }

  const api = { extractPdfText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PdfText = api;
})(typeof self !== 'undefined' ? self : this);
