/* Reads Investor Alert entries out of the SC list page's data responses. No DOM needed. */
(function (root) {
  const norm = s => String(s || '').toLowerCase()
    .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/[\u2010-\u2015]/g, '-').replace(/[’‘]/g, "'")
    .replace(/\s*-\s*/g, ' - ').replace(/\s+/g, ' ').trim();
  const core = s => norm(s).replace(/^potential clone entity\s*-?\s*/, '').trim();
  const clean = s => String(s ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;|&rsquo;/g, '’').replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  const isNA = s => !s || /^(n\/a|na|-|null|none)$/i.test(String(s).trim());

  function parseAny(text) {
    let v;
    try { v = JSON.parse(text); } catch (e) {
      const m = String(text).match(/[\[{][\s\S]*[\]}]/); // JSONP or wrapped
      if (!m) return null;
      try { v = JSON.parse(m[0]); } catch (e2) { return null; }
    }
    return v;
  }

  // walk any JSON shape and collect objects that look like list entries
  function collectRecords(v, out = [], depth = 0) {
    if (depth > 12 || v == null) return out;
    if (typeof v === 'string') {
      const t = v.trim();
      if ((t.startsWith('{') || t.startsWith('[')) && /remark/i.test(t)) collectRecords(parseAny(t), out, depth + 1);
      return out;
    }
    if (Array.isArray(v)) { v.forEach(x => collectRecords(x, out, depth + 1)); return out; }
    if (typeof v === 'object') {
      const keys = Object.keys(v);
      if (keys.some(k => /remark/i.test(k)) && keys.some(k => /name|title/i.test(k))) out.push(v);
      keys.forEach(k => collectRecords(v[k], out, depth + 1));
    }
    return out;
  }

  function field(rec, re, not) {
    const k = Object.keys(rec).find(k => re.test(k) && !(not && not.test(k)) && typeof rec[k] !== 'object');
    return k ? rec[k] : '';
  }

  function toDetails(rec) {
    const name = clean(field(rec, /^(name|title|entityname|entity_name)$/i) || field(rec, /name|title/i, /file|type|cat/i));
    const address = clean(field(rec, /address|addr/i));
    const bank = clean(field(rec, /bank/i));
    const siteRaw = clean(field(rec, /web|url|site|link/i, /image|img|icon|thumb/i));
    const remark = clean(field(rec, /remark/i));
    const idRaw = clean(field(rec, /identity|regno|registration|reg_no|^ic$|^icno$|nric|companyno/i, /icon|image/i));

    const websites = isNA(siteRaw) ? [] : siteRaw.split(/\s*\|\s*|\s*\n\s*|\s+(?=https?:\/\/|www\.)/).map(s => s.trim()).filter(s => s && !isNA(s));
    const bullets = remark.split(/•|\n/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const addr = [address, bank].filter(x => !isNA(x)).join(', ');
    return {
      found: true, listName: name, identity: isNA(idRaw) ? '' : idRaw, address: addr, websites,
      reasons: bullets.map(b => '• ' + b).join('\n')
    };
  }

  // texts: array of response bodies. names: entity names from the SC announcement.
  function findInResponses(texts, names) {
    const records = [];
    texts.forEach(t => collectRecords(parseAny(t), records));
    const result = {};
    for (const n of names) {
      const t = norm(n), c = core(n);
      const nameOf = r => field(r, /^(name|title|entityname|entity_name)$/i) || field(r, /name|title/i, /file|type|cat/i);
      const rec = records.find(r => norm(nameOf(r)) === t) || (c.length >= 4 && records.find(r => core(nameOf(r)) === c));
      if (rec) result[n] = toDetails(rec);
    }
    return { result, recordCount: records.length };
  }

  root.IALRecords = { findInResponses, collectRecords, parseAny, norm, core };
})(typeof self !== 'undefined' ? self : globalThis);
