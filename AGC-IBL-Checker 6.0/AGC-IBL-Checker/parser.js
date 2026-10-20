/*
 * parser.js
 * 1) Finds "Notis Kepada Pihak Ketiga / Notice to Third Parties" (Act 613) rows on
 *    https://lom.agc.gov.my/subsid.php?type=pub
 * 2) Pulls the named parties (companies / individuals) out of the notice PDF text.
 */
(function (root) {
  'use strict';

  const clean = (s) => String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

  function parseDMY(s) {
    const m = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return null;
    return { dmy: `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`, iso: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` };
  }

  function decodeToken(url) {
    try {
      const u = new URL(url);
      const tok = u.searchParams.get('token');
      if (!tok) return '';
      const b64 = tok.replace(/-/g, '+').replace(/_/g, '/');
      const txt = (typeof atob === 'function') ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
      return txt.split('|')[0];
    } catch (e) { return ''; }
  }

  function urlsFromElement(el, baseUrl) {
    const out = [];
    const push = (raw, hasImg) => {
      if (!raw) return;
      try { out.push({ url: new URL(raw, baseUrl).href, hasImg }); } catch (e) { /* ignore */ }
    };
    for (const a of el.querySelectorAll('a[href], [onclick], [data-href], [data-url]')) {
      const hasImg = !!a.querySelector('img, i, svg') || /pdf/i.test(a.className || '');
      const href = a.getAttribute('href');
      if (href && !/^javascript:/i.test(href) && href !== '#') push(href, hasImg);
      for (const attr of ['onclick', 'href', 'data-href', 'data-url']) {
        const v = a.getAttribute(attr) || '';
        for (const m of v.matchAll(/['"]([^'"]+(?:\.pdf|processFile\.php|download|viewFile)[^'"]*)['"]/gi)) push(m[1], hasImg);
        if (attr === 'data-href' || attr === 'data-url') push(v, hasImg);
      }
    }
    return out;
  }

  function scorePdfLink(link) {
    const inner = decodeToken(link.url);
    const all = (link.url + ' ' + inner).toLowerCase();
    if (/act-detail|legislation-detail|subsid-detail/.test(all) && !/\.pdf/.test(all)) return -1;
    let s = 0;
    if (/\.pdf/.test(all)) s += 4;
    if (link.hasImg) s += 2;
    if (/processfile|download|viewfile|upload/.test(all)) s += 1;
    return s;
  }

  /* Returns [{ date, iso, pu, puKey, pdfUrl, title }] for Act 613 third-party notices */
  function parseListing(doc, baseUrl) {
    const found = new Map();
    for (const tr of doc.querySelectorAll('tr')) {
      const text = clean(tr.textContent);
      if (!/PIHAK KETIGA|THIRD PART/i.test(text)) continue;
      if (!/\b613\b/.test(text)) continue;
      const d = parseDMY(text);
      const pm = text.match(/P\.?\s*U\.?\s*\(\s*B\s*\)\s*(\d+)\s*\/\s*(\d{4})/i);
      const pu = pm ? `P.U. (B) ${pm[1]}/${pm[2]}` : null;
      const links = urlsFromElement(tr, baseUrl)
        .map((l) => ({ ...l, score: scorePdfLink(l) }))
        .filter((l) => l.score >= 0)
        .sort((a, b) => b.score - a.score);
      const key = pu || (d ? d.iso : '') + '|' + (links[0] ? links[0].url : text.slice(0, 40));
      if (found.has(key)) continue;
      found.set(key, {
        date: d ? d.dmy : '',
        iso: d ? d.iso : '',
        pu: pu || '(no P.U. number)',
        puKey: key,
        pdfUrl: links[0] ? links[0].url : null,
        pdfCandidates: links.map((l) => l.url),
        title: 'Notis Kepada Pihak Ketiga — Akta 613',
      });
    }
    return [...found.values()].sort((a, b) => (b.iso || '').localeCompare(a.iso || ''));
  }

  /* ---------- PDF text → parties ---------- */

  // Split "A, B, C dan D" on commas outside brackets, then split the last item on the conjunction.
  function splitParties(list, conj) {
    const parts = [];
    let depth = 0, cur = '';
    for (const ch of list) {
      if (ch === '(' || ch === '[') depth++;
      if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    parts.push(cur);
    // conjunction is matched lowercase only, so names like "Tour And Travel" / "Kedai Dan Minum" stay intact
    const conjRe = new RegExp('\\s' + conj + '\\s', 'g');
    const out = [];
    parts.forEach((p, i) => {
      let t = p.trim().replace(new RegExp('^' + conj + '\\s+'), '');
      if (i === parts.length - 1 || parts.length === 1) {
        // split on the LAST lowercase conjunction outside brackets
        let lastIdx = -1, d = 0;
        for (let k = 0; k < t.length; k++) {
          const ch = t[k];
          if (ch === '(') d++;
          if (ch === ')') d = Math.max(0, d - 1);
          if (d === 0 && t.startsWith(' ' + conj + ' ', k)) lastIdx = k;
        }
        if (lastIdx > 0) { out.push(t.slice(0, lastIdx)); out.push(t.slice(lastIdx + conj.length + 2)); return; }
      }
      out.push(t);
    });
    void conjRe;
    return out.map((s) => s.trim().replace(/[,;:]+$/, '').trim()).filter(Boolean);
  }

  const COMPANY_WORDS = /\b(sdn\.?\s*bhd|bhd|berhad|plt|enterprise|enterprises|trading|services?|resources|holdings?|ventures?|solutions?|construction|global|company|co\.|agency|industries|group|hub|design|works|systems?|technology|tech|marketing|management|consultancy|consultants?|supplies|suppliers|store|mart|travel|tours?|motor|auto|properties|property|development|engineering|network|international|studio|academy|kedai|syarikat|perniagaan|niaga|ltd|limited|inc|llp|gmbh|pte)\b/i;
  const PERSON_WORDS = /\b(bin|binti|bt|bte|a\/l|a\/p|anak|s\/o|d\/o)\b|@/i;

  function extractIds(s) {
    const ids = [];
    for (const m of s.matchAll(/\b\d{6}-\d{2}-\d{4}\b/g)) ids.push(m[0]);          // MyKad
    for (const m of s.matchAll(/\b(19|20)\d{10}\b/g)) ids.push(m[0]);                // new SSM no.
    for (const m of s.matchAll(/\b\d{4,7}-[A-Z]\b/g)) ids.push(m[0]);               // old SSM no.
    for (const m of s.matchAll(/\b[A-Z]{1,2}\d{6,9}\b/g)) ids.push(m[0]);            // passport-like
    for (const m of s.matchAll(/\b[A-Z]{2}\d{7}-[A-Z]\b/g)) ids.push(m[0]);          // business reg e.g. JM0123456-X
    return [...new Set(ids)];
  }

  function cleanParty(raw) {
    const ids = extractIds(raw);
    let name = raw
      .replace(/\((?:[^()]|\([^()]*\))*\)/g, ' ')               // drop bracketed details
      .replace(/\b(No\.?\s*)?(K\/P|KP|Kad Pengenalan|NRIC|Pasport|Passport|No\. Syarikat|No\. Pendaftaran)[^,]*$/i, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(yang dikenali sebagai|iaitu)\s+/i, '');
    let kind = 'Unknown';
    if (ids.some((i) => /^\d{6}-\d{2}-\d{4}$/.test(i)) || (PERSON_WORDS.test(name) && !COMPANY_WORDS.test(name))) kind = 'Individual';
    else if (COMPANY_WORDS.test(name)) kind = 'Entity';
    else if (name.split(' ').length >= 2 && !/\d/.test(name)) kind = 'Individual?';
    return { name, ids, kind, raw: raw.trim() };
  }

  function normKey(name) {
    return String(name).toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/\bsendirian\s+berhad\b/g, 'sdnbhd')
      .replace(/[^a-z0-9]/g, '');
  }

  function parseNoticeText(fullText) {
    const text = clean(fullText).replace(/(\w)-\s+(\w)/g, (m, a, b) => (/[a-z]/.test(b) ? a + b : m));
    const bm = [...text.matchAll(/\bterhadap\s+(.+?)\s+supaya\s+(?:hadir|menghadirkan)/gi)].map((m) => m[1]);
    const en = [...text.matchAll(/\bagainst\s+(.+?)\s+to\s+(?:appear|attend)/gi)].map((m) => m[1]);

    const bmParties = bm.flatMap((l) => splitParties(l, 'dan')).map(cleanParty);
    const enParties = en.flatMap((l) => splitParties(l, 'and')).map(cleanParty);

    const merged = new Map();
    for (const p of bmParties) if (!merged.has(normKey(p.name))) merged.set(normKey(p.name), { ...p, in: ['BM'] });
    for (const p of enParties) {
      const k = normKey(p.name);
      if (merged.has(k)) merged.get(k).in.push('EN');
      else merged.set(k, { ...p, in: ['EN'] });
    }
    const parties = [...merged.values()].filter((p) => p.name.length > 1);
    const mismatch = bmParties.length && enParties.length && parties.some((p) => p.in.length === 1);

    const court = (text.match(/hadapan\s+(Mahkamah.{3,80}?)\s+pada\s+(\d{1,2}\s+\w+\s+\d{4})/i) || []);
    const courtEn = (text.match(/before\s+the\s+(.{3,80}?Court.{0,40}?)\s+on\s+(\d{1,2}\s+\w+\s+\d{4})/i) || []);
    const jadualIdx = text.search(/\bJADUAL\b/);
    let schedule = '';
    if (jadualIdx >= 0) {
      schedule = text.slice(jadualIdx + 6).split(/\b(Bertarikh|Dated|SCHEDULE|NOTICE TO THIRD)\b/)[0].trim().slice(0, 900);
    }
    return {
      parties,
      mismatch: !!mismatch,
      foundBM: bm.length, foundEN: en.length,
      court: court[1] ? `${court[1]}, ${court[2]}` : (courtEn[1] ? `${courtEn[1]}, ${courtEn[2]}` : ''),
      schedule,
    };
  }

  const api = { parseListing, parseNoticeText, splitParties, cleanParty, normKey, parseDMY, decodeToken, clean };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AgcParser = api;
})(typeof self !== 'undefined' ? self : this);
