/* IAL Monitor - shared logic for reading SC Investor Alert List announcements.
 * Runs in the service worker (no DOM) and in extension pages, so parsing is string-based.
 */
(function (root) {
  const BASE = 'https://www.sc.com.my/resources/media/investor-alert-updates/investor-alert-list-as-at-';
  const LIST_URL = 'https://www.sc.com.my/investor-alert-list';
  const MEDIA_URL = 'https://www.sc.com.my/resources/media';
  const MAX_LOOKBACK_DAYS = 30;     // never probe further back than this
  const PARSER_VERSION = 2;
  const SETTLE_DAYS = 7;            // a date "not found" once it is this old is not probed again

  // ---------- dates ----------
  const pad = n => String(n).padStart(2, '0');
  const toIso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const todayIso = () => toIso(new Date());
  const isoToDmy = (iso, sep = '/') => { const [y, m, d] = iso.split('-'); return `${d}${sep}${m}${sep}${y}`; };

  // SC is not consistent with zero padding in its URLs (2292026, 0142024, 21072025, 01092026)
  function slugsFor(date) {
    const d = date.getDate(), m = date.getMonth() + 1, y = date.getFullYear();
    return [...new Set([`${d}${m}${y}`, `${pad(d)}${m}${y}`, `${d}${pad(m)}${y}`, `${pad(d)}${pad(m)}${y}`])];
  }

  // ---------- html helpers ----------
  function decodeEntities(s) {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
      rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', bull: '•' };
    return s
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in named ? named[n.toLowerCase()] : m));
  }
  const stripTags = s => decodeEntities(s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
    .replace(/[ \t\u00a0]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

  // ---------- announcement page ----------
  function parseAnnouncement(html, url) {
    const t = html.match(/Investor Alert List \(as at\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})\s*\)/i);
    if (!t) return null;
    const iso = `${t[3]}-${pad(t[2])}-${pad(t[1])}`;

    const NAV = /^(resources|media releases and announcements|investor alerts announcements|home|investor alert list)$/i;
    const metaM = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i);
    const metaNames = metaM ? (decodeEntities(metaM[1]).split(/added to the list\s*-\s*/i)[1] || '')
      .split(/,\s+/).map(x => x.trim()).filter(Boolean) : [];

    let names = [];
    const body = html.slice(Math.max(0, html.search(/<body/i)));
    let start = body.search(/added to the list as at/i);
    if (start < 0) start = body.search(/was\/were added to the list|added to the list/i);
    if (start >= 0) {
      const end = body.slice(start).search(/The list is updated periodically|is available at SC/i);
      const seg = body.slice(start, end > 0 ? start + end : start + 20000);
      const list = seg.match(/<(ol|ul)[^>]*>([\s\S]*?)<\/\1>/i);
      if (list) names = [...list[2].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(m => stripTags(m[1]));
      if (!names.length) names = stripTags(seg.slice(seg.indexOf(':') + 1).replace(/<\/p>/gi, '\n')).split('\n');
    }
    names = names.filter(n => !NAV.test(n.trim()));
    if (!names.length) names = metaNames;
    names = names.map(n => n.replace(/^\d+\.\s*/, '').replace(/\s+/g, ' ').trim()).filter(n => n && n.length < 300);
    return { iso, url, names: [...new Set(names)], v: PARSER_VERSION };
  }

  async function fetchText(url) {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) return null;
    return res.text();
  }

  async function probeDate(date) {
    const tries = slugsFor(date).map(async slug => {
      const url = BASE + slug;
      try {
        const html = await fetchText(url);
        const parsed = html && parseAnnouncement(html, url);
        return parsed && parsed.iso === toIso(date) ? parsed : null; // title must match the date asked for
      } catch (e) { return null; }
    });
    return (await Promise.all(tries)).find(Boolean) || null;
  }

  async function fetchAnnouncement(url) {
    const html = await fetchText(url);
    return html ? parseAnnouncement(html, url) : null;
  }

  // ---------- storage ----------
  const DEFAULTS = {
    settings: { baseline: '2026-09-22', checkedBy: '', autoCheck: true, intervalHours: 3 },
    updates: {},      // iso -> {iso,url,names,foundAt}
    processed: [],    // iso dates already exported to Excel
    missing: {},      // iso -> ISO timestamp when last confirmed missing
    details: {},      // entity key -> {identity,address,website,reasons,include}
    history: [],      // audit trail
    master: null,     // remembered master file {name, b64, savedAt}
    api: null,        // SC search service learned from the page
    lastCheck: null
  };
  async function load() {
    const got = await chrome.storage.local.get(Object.keys(DEFAULTS));
    const out = {};
    for (const k of Object.keys(DEFAULTS)) out[k] = got[k] ?? structuredClone(DEFAULTS[k]);
    out.settings = { ...DEFAULTS.settings, ...out.settings };
    return out;
  }
  const save = obj => chrome.storage.local.set(obj);

  async function log(action, detail) {
    const { history, settings } = await load();
    history.unshift({ at: new Date().toISOString(), by: settings.checkedBy || '', action, detail });
    await save({ history: history.slice(0, 500) });
  }

  function pendingUpdates(state) {
    const done = new Set(state.processed);
    return Object.values(state.updates)
      .filter(u => u.iso > state.settings.baseline && !done.has(u.iso))
      .sort((a, b) => a.iso.localeCompare(b.iso));
  }

  // Probe every date after the baseline that is not processed yet.
  async function checkForUpdates({ source = 'manual' } = {}) {
    const state = await load();
    const today = new Date();
    const earliest = addDays(today, -MAX_LOOKBACK_DAYS);
    let cursor = addDays(fromIso(state.settings.baseline), 1);
    if (cursor < earliest) cursor = earliest;

    const done = new Set(state.processed);
    // re-read updates saved by an older version of the parser
    for (const u of Object.values(state.updates)) {
      if ((u.v || 1) >= PARSER_VERSION || done.has(u.iso)) continue;
      const fresh = await fetchAnnouncement(u.url).catch(() => null);
      if (fresh) {
        for (const k of Object.keys(state.details)) if (k.startsWith(u.iso + '|')) delete state.details[k];
        state.updates[u.iso] = { ...fresh, foundAt: u.foundAt };
      }
    }
    const dates = [];
    for (let d = new Date(cursor); toIso(d) <= toIso(today); d = addDays(d, 1)) {
      const iso = toIso(d);
      if (done.has(iso) || state.updates[iso]) continue;
      const lastMissing = state.missing[iso];
      if (lastMissing && (new Date(lastMissing) - d) / 86400000 > SETTLE_DAYS) continue;
      dates.push(new Date(d));
    }
    const hits = await Promise.all(dates.map(d => probeDate(d)));
    const newly = [];
    dates.forEach((d, i) => {
      const iso = toIso(d), hit = hits[i];
      if (hit) { hit.foundAt = new Date().toISOString(); state.updates[iso] = hit; newly.push(hit); delete state.missing[iso]; }
      else state.missing[iso] = new Date().toISOString();
    });
    state.lastCheck = { at: new Date().toISOString(), source, newCount: newly.length };
    await save({ updates: state.updates, missing: state.missing, lastCheck: state.lastCheck, details: state.details });
    await log('Checked SC website', `${source} check - ${newly.length} new update(s)` +
      (newly.length ? `: ${newly.map(u => isoToDmy(u.iso)).join(', ')}` : ''));
    return { newly, pending: pendingUpdates({ ...state }) };
  }

  // Add an announcement found by other means (e.g. read from the SC media page in a tab)
  async function addAnnouncementUrls(urls) {
    const state = await load();
    const added = [];
    for (const url of urls) {
      if (Object.values(state.updates).some(u => u.url === url)) continue;
      const a = await fetchAnnouncement(url).catch(() => null);
      if (a && !state.updates[a.iso]) { a.foundAt = new Date().toISOString(); state.updates[a.iso] = a; added.push(a); }
    }
    await save({ updates: state.updates });
    return added;
  }

  const entityKey = (iso, name) => `${iso}|${name}`;

  function ensureDetail(state, u, name) {
    const key = entityKey(u.iso, name);
    if (!state.details[key]) state.details[key] = { identity: '', address: '', website: u.url, reasons: '', include: true, found: null };
    return state.details[key];
  }

  // names of pending entities that still have no details from the SC list page
  function namesNeedingDetails(state) {
    const out = [];
    for (const u of pendingUpdates(state)) for (const n of u.names) {
      const d = state.details[entityKey(u.iso, n)];
      if (!d || d.found !== true) out.push(n);
    }
    return [...new Set(out)];
  }

  // merge results read from the SC list page into the stored details
  function applyGrab(state, results) {
    let found = 0;
    for (const u of pendingUpdates(state)) for (const name of u.names) {
      const g = results[name];
      if (!g) continue;
      const d = ensureDetail(state, u, name);
      if (d.found === true) continue;
      d.found = g.found;
      if (!g.found) continue;
      found++;
      if (g.listName) d.listName = g.listName;
      if (!d.identity && g.identity) d.identity = g.identity;
      if (!d.address && g.address) d.address = g.address;
      if (!d.reasons && g.reasons) d.reasons = g.reasons;
      const sites = (g.websites || []).filter(w => !d.website.includes(w));
      if (sites.length) d.website = [...sites, d.website].filter(Boolean).join('\n');
    }
    return found;
  }

  // ArrayBuffer <-> base64 (to remember the master file)
  function bufToB64(buf) {
    const bytes = new Uint8Array(buf); let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64ToBuf(b64) {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  root.IAL = { BASE, LIST_URL, MEDIA_URL, toIso, fromIso, todayIso, isoToDmy, slugsFor, parseAnnouncement, probeDate,
    fetchAnnouncement, checkForUpdates, addAnnouncementUrls, pendingUpdates, load, save, log, entityKey, stripTags,
    ensureDetail, namesNeedingDetails, applyGrab, bufToB64, b64ToBuf };
})(typeof self !== 'undefined' ? self : globalThis);
