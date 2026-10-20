// Fetches each source, finds leadership pages, extracts people and merges them into the register.
// Reading strategy, in order:
//   1. Direct request (with one retry and www / http variants for slow or unreachable sites).
//   2. If the site refuses the request, never answers, or the page only fills in with JavaScript:
//      open it in a minimized Chrome window, exactly as a person would view it, and read the finished page.
//      If the site shows a "verify you are human" check, stop and ask the user to open it themselves.
//   3. Find leadership pages from homepage links, then the site's sitemap, then WordPress page search,
//      then one level under Profil / Mengenai Kami.
//   4. Staff directories (Direktori Pegawai) are read for senior officials only.
//   5. Org charts published as PDFs or pictures are read (text directly, or OCR for pictures and scans).
import { extractPeople, extractFromLines, contextFromText, discoverLinks, discoverMedia, scoreUrl, baseDomain } from './extractor.js';
import { readMedia, isPdfUrl, isImageUrl, closeReaders } from './media.js';
import { getBySource, putMany, putOne } from './db.js';
import { classify, adjustTier } from './bnm.js';

// Two-stage refresh:
//   Quick pass: every source, direct reading only (fast, like v1.2).
//   Deep pass: only sources the quick pass could not read, or that gave fewer than 3 people:
//   open in Chrome, read PDF / picture org charts.
const MAX_PAGES_PER_SOURCE = 10;
const QUICK_BUDGET_MS = 60000;   // time per source in the quick pass
const DEEP_BUDGET_MS = 150000;   // time per source in the deep pass
const QUICK_CONCURRENCY = 6;
const DEEP_CONCURRENCY = 2;
const MAX_CHROME_OPENS_PER_SOURCE = 3;
const MAX_MEDIA_PER_SOURCE = 4;
const MAX_DIRECTORIES_PER_SOURCE = 2;

// On staff directories, keep only roles that are clearly senior.
const SENIOR_DEPUTY = /timbalan ketua (setiausaha|pengarah)|deputy (secretary|director)[\s-]general/i;
const seniorOnly = list => list.filter(p => p.tier === 1 || SENIOR_DEPUTY.test(p.position));
const TIMEOUT_MS = 15000;
const RETRY_TIMEOUT_MS = 20000;
const PAUSE_MS = 400; // be polite to government servers

const sleep = ms => new Promise(r => setTimeout(r, ms));

// What went wrong, in plain words, and what the user can do about it.
export const REASONS = {
  blocked: { label: 'Blocked by site', help: 'The site refused automated access and could not be opened in Chrome either. Open the leadership page in Chrome and use "Add people from this page" in the popup.' },
  challenge: { label: 'Needs you', help: 'The site asks visitors to prove they are human. Open the leadership page in Chrome, complete the check yourself, then use "Add people from this page" in the popup.' },
  timeout: { label: 'No response', help: 'The site did not answer after three tries. It may be down; the next refresh tries again.' },
  connection: { label: 'Cannot connect', help: 'The site could not be reached (down, wrong address or certificate problem). Check it opens in Chrome.' },
  server: { label: 'Site error', help: 'The site returned a server error. The next refresh tries again.' },
  not_found: { label: 'Page not found', help: 'The page no longer exists. Update the link in the Sources tab.' },
  not_html: { label: 'Not a web page', help: 'The link is a file type that cannot be read. Add the web page that lists the leadership instead.' },
  empty: { label: 'Nothing recognised', help: 'Pages were read but no office holders were recognised. Find the page that lists the leaders, copy its address and paste it into this source\'s links box, or open it and use "Add people from this page".' }
};

class FetchError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

async function fetchOnce(url, timeout, { anyType = false } = {}) {
  let res;
  try {
    res = await fetch(url, { credentials: 'omit', cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    if (e.name === 'TimeoutError') throw new FetchError('timeout', `No response within ${timeout / 1000} seconds`);
    throw new FetchError('connection', 'Could not connect');
  }
  if ([401, 403, 429].includes(res.status)) throw new FetchError('blocked', `The site refused the request (HTTP ${res.status})`);
  if (res.status === 404 || res.status === 410) throw new FetchError('not_found', `Page not found (HTTP ${res.status})`);
  if (!res.ok) throw new FetchError('server', `Server error (HTTP ${res.status})`);
  const ct = res.headers.get('content-type') || '';
  if (!anyType && ct && !/html|xml/i.test(ct)) throw new FetchError('not_html', `Not a web page (${ct.split(';')[0]})`);
  return { html: await res.text(), finalUrl: res.url || url };
}

function variants(url) {
  const out = [];
  try {
    const u = new URL(url);
    const alt = new URL(url);
    alt.hostname = u.hostname.startsWith('www.') ? u.hostname.slice(4) : 'www.' + u.hostname;
    out.push(alt.href);
    if (u.protocol === 'https:') { const h = new URL(url); h.protocol = 'http:'; out.push(h.href); }
  } catch { /* bad URL */ }
  return out;
}

export async function fetchHtml(url, { retry = true, tryVariants = false } = {}) {
  try { return await fetchOnce(url, TIMEOUT_MS); } catch (e) {
    if (!retry || !['timeout', 'connection', 'server'].includes(e.kind)) throw e;
    // Unreachable homepage: try www / non-www and http first (quick), then one slower retry.
    if (tryVariants && e.kind === 'connection') {
      for (const v of variants(url)) { try { return await fetchOnce(v, 10000); } catch { /* next */ } }
    }
    await sleep(1000);
    return fetchOnce(url, RETRY_TIMEOUT_MS);
  }
}

// Open the page in Chrome (via the background service worker) and read the finished page.
async function openInChrome(url) {
  let r;
  try { r = await chrome.runtime.sendMessage({ type: 'render-page', url }); } catch { r = null; }
  if (!r) throw new FetchError('connection', 'Chrome could not open the page');
  if (r.challenge) throw new FetchError('challenge', 'The site shows a "verify you are human" check');
  if (r.error) throw new FetchError(r.kind || 'connection', r.error);
  return { html: r.html, finalUrl: r.finalUrl || url };
}

const parse = html => new DOMParser().parseFromString(html, 'text/html');

// A page that is only a shell filled in later by JavaScript.
function looksEmpty(doc) {
  const text = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim();
  const appShell = doc.querySelector('#root, #app, #__next, #__nuxt, app-root, [ng-app], [data-reactroot]');
  return text.length < 400 || (!!appShell && text.length < 1500);
}

function sameSite(url, home) {
  try {
    const h = new URL(url).hostname.replace(/^www\d?\./, '');
    const b = baseDomain(home);
    return h === b || h.endsWith('.' + b);
  } catch { return false; }
}

// Leadership pages listed in the site's sitemap.
async function sitemapLinks(home) {
  const origin = new URL(home).origin;
  const maps = [];
  try {
    const robots = await fetchOnce(origin + '/robots.txt', 6000, { anyType: true });
    for (const m of robots.html.matchAll(/^\s*sitemap:\s*(\S+)/gim)) maps.push(m[1]);
  } catch { /* no robots.txt */ }
  maps.push(origin + '/sitemap.xml', origin + '/sitemap_index.xml', origin + '/wp-sitemap.xml');
  const seen = new Set();
  const pages = [];
  let fetched = 0;
  while (maps.length && fetched < 3) {
    const m = maps.shift();
    if (seen.has(m)) continue;
    seen.add(m);
    try {
      const { html } = await fetchOnce(m, 8000, { anyType: true });
      fetched++;
      const xml = new DOMParser().parseFromString(html, 'text/xml');
      const locs = [...xml.getElementsByTagName('loc')].map(l => l.textContent.trim());
      const isIndex = xml.getElementsByTagName('sitemapindex').length > 0;
      for (const loc of locs) {
        if (isIndex || /\.xml(\.gz)?$/i.test(loc)) { if (maps.length < 10) maps.push(loc); }
        else if (sameSite(loc, home)) pages.push(loc);
      }
    } catch { /* missing sitemap */ }
  }
  return pages.map(url => ({ url, score: scoreUrl(url) })).filter(x => x.score >= 3).sort((a, b) => b.score - a.score);
}

// WordPress sites expose a page search; use it to find leadership pages.
async function wordpressLinks(home) {
  const origin = new URL(home).origin;
  const out = [];
  for (const term of ['pengurusan', 'lembaga', 'board', 'leadership', 'exco', 'majlis']) {
    if (out.length >= 4) break;
    try {
      const res = await fetch(`${origin}/wp-json/wp/v2/pages?search=${encodeURIComponent(term)}&per_page=10&_fields=link,title`,
        { credentials: 'omit', signal: AbortSignal.timeout(6000) });
      if (!res.ok) { if (res.status === 404) break; continue; }
      const list = await res.json();
      for (const p of Array.isArray(list) ? list : []) {
        const title = p?.title?.rendered || '';
        const score = Math.max(scoreUrl(p.link), scoreUrl('x/' + title));
        if (score >= 3 && sameSite(p.link, home) && !out.some(o => o.url === p.link)) out.push({ url: p.link, score });
      }
    } catch { break; }
  }
  return out;
}

export async function crawlSource(src, { useChrome = true, useMedia = true, budgetMs = QUICK_BUDGET_MS } = {}) {
  const started = Date.now();
  const overBudget = () => Date.now() - started > budgetMs;
  const visited = new Set();
  const pages = [];
  const errors = [];
  const people = new Map();
  let chromeOpens = 0;
  let mediaRead = 0;
  const mediaCandidates = new Map();
  let emptyLeadPage = false;

  const keep = (found, method = 'page') => {
    for (const p of found) {
      p.method = p.method || method;
      if (method === 'image' && p.confidence === 'high') p.confidence = 'medium'; // OCR can misspell
      const prev = people.get(p.key);
      if (!prev || p.tier < prev.tier || (p.tier === prev.tier && p.confidence === 'high' && prev.confidence !== 'high')) people.set(p.key, p);
    }
  };

  const tryChrome = async url => {
    if (!useChrome || chromeOpens >= MAX_CHROME_OPENS_PER_SOURCE) return null;
    chromeOpens++;
    return openInChrome(url);
  };

  // Read a PDF or picture.
  const visitMedia = async (url, hint = '') => {
    if (visited.has(url) || mediaRead >= MAX_MEDIA_PER_SOURCE || overBudget()) return;
    visited.add(url); mediaRead++;
    try {
      const r = await readMedia(url);
      const ctx = contextFromText(hint + ' ' + decodeURIComponent(url) + ' ' + r.lines.slice(0, 8).join(' '));
      const found = extractFromLines(r.lines, ctx, r.finalUrl);
      keep(found, r.method);
      pages.push({ url: r.finalUrl, found: found.length, via: r.method });
    } catch (e) {
      errors.push({ url, kind: 'media', error: 'Could not read file: ' + e.message });
    }
  };

  // lead = the page is expected to list office holders; directory = staff directory (senior roles only)
  const visit = async (url, { lead = false, directory = false } = {}) => {
    if (useMedia && (isPdfUrl(url) || isImageUrl(url))) { await visitMedia(url); return null; }
    if (visited.has(url) || visited.size >= MAX_PAGES_PER_SOURCE || (visited.size && overBudget())) return null;
    const isHome = visited.size === 0;
    visited.add(url);
    let page = null, doc = null, via = 'direct', firstError = null;
    // Only the homepage (or a pinned page) gets the slow retries; other pages fail fast.
    try { page = await fetchHtml(url, { retry: isHome || lead, tryVariants: isHome }); doc = parse(page.html); } catch (e) { firstError = e; }

    const refused = firstError && ['blocked', 'timeout', 'connection', 'server'].includes(firstError.kind);
    let found = doc ? extractPeople(doc, page.finalUrl) : [];
    // Open in Chrome when the direct request was refused, or when nobody was found on a page that is
    // either a JavaScript shell or expected to list office holders.
    if (refused || (doc && !found.length && (looksEmpty(doc) || lead))) {
      try {
        const r = await tryChrome(url);
        if (r) { page = r; doc = parse(r.html); via = 'chrome'; found = extractPeople(doc, page.finalUrl); }
      } catch (e) {
        errors.push({ url, kind: e.kind, error: e.message });
        if (!doc) return null;
      }
    }
    if (!doc) { errors.push({ url, kind: firstError?.kind || 'connection', error: firstError?.message || 'Could not read' }); return null; }
    if (directory) found = seniorOnly(found);
    // Homepages and menu pages are mostly news: take only people with a title or bin/binti AND a
    // position right next to their name, and nothing at all from political party news pages.
    if (!lead) found = src.category === 'Political party' ? [] : found.filter(p => p.confidence === 'high');
    // Party websites are full of Title Case headlines: never accept names without a title or bin/binti there.
    if (src.category === 'Political party') found = found.filter(p => p.confidence !== 'low');
    keep(found);
    pages.push({ url: page.finalUrl, found: found.length, via: directory ? via + '-directory' : via });
    if (!lead && !directory) {
      // Homepage and menu pages: only files clearly named as org charts.
      for (const m of discoverMedia(doc, page.finalUrl, src.url).filter(m => m.score >= 5)) {
        if (!mediaCandidates.has(m.url)) mediaCandidates.set(m.url, { ...m, hint: 'carta organisasi' });
      }
    }
    if (lead && !directory) {
      if (!found.length) emptyLeadPage = true;
      const title = doc.title || '';
      for (const m of discoverMedia(doc, page.finalUrl, src.url)) {
        const prev = mediaCandidates.get(m.url);
        if (!prev || prev.score < m.score) mediaCandidates.set(m.url, { ...m, hint: title });
      }
    }
    await sleep(PAUSE_MS);
    return { doc, finalUrl: page.finalUrl, html: page.html };
  };

  // Extra links the user added for this source are read first (they may be PDFs or pictures too).
  // If they give fewer than 3 people, the homepage search runs as well.
  const pinned = (src.pinnedUrls || []).filter(Boolean);
  for (const u of pinned) await visit(u, { lead: true });
  if (!pinned.length || people.size < 3) {
    const home = await visit(src.url);
    const links = home ? discoverLinks(home.doc, home.finalUrl, src.url) : [];
    for (const l of links.filter(l => l.score >= 3).slice(0, 5)) await visit(l.url, { lead: true });

    if (people.size < 3 && home) {
      const extra = [...await sitemapLinks(home.finalUrl)];
      if (/wp-content|wp-json/i.test(home.html)) extra.push(...await wordpressLinks(home.finalUrl));
      for (const l of extra.filter(l => !visited.has(l.url)).slice(0, 4)) await visit(l.url, { lead: true });
    }
    const directories = links.filter(l => l.score === 2);
    if (people.size < 3 && home) {
      for (const a of links.filter(l => l.score === 1).slice(0, 2)) {
        const page = await visit(a.url);
        if (!page) continue;
        const sub = discoverLinks(page.doc, page.finalUrl, src.url);
        for (const l of sub.filter(l => l.score >= 3).slice(0, 3)) await visit(l.url, { lead: true });
        directories.push(...sub.filter(l => l.score === 2));
      }
    }
    // Staff directories: senior officials only.
    const seenDir = new Set();
    for (const d of directories) {
      if (seenDir.size >= MAX_DIRECTORIES_PER_SOURCE) break;
      if (seenDir.has(d.url)) continue;
      seenDir.add(d.url);
      await visit(d.url, { lead: true, directory: true });
    }
  }

  // Org charts as PDFs or pictures, when the pages themselves did not give enough people.
  if (useMedia && (people.size < 3 || emptyLeadPage)) {
    const list = [...mediaCandidates.values()].sort((a, b) => b.score - a.score);
    for (const m of list.slice(0, MAX_MEDIA_PER_SOURCE)) await visitMedia(m.url, m.hint);
  }
  return { people: [...people.values()], pages, errors };
}

// Merge one source's results into the register.
// keepOthers: a single captured page must not mark the rest of the source as "no longer listed".
export async function mergeSource(src, result, runAt, { keepOthers = false } = {}) {
  const existing = await getBySource(src.id);
  const byKey = new Map(existing.map(p => [p.key, p]));
  const out = [];
  const seen = new Set();
  let added = 0, changed = 0, dropped = 0;

  for (const f of result.people) {
    const key = src.id + '|' + f.key;
    if (seen.has(key)) continue;
    seen.add(key);
    const prev = byKey.get(key);
    if (!prev) added++;
    else if (prev.position !== f.position) changed++;
    out.push({
      key,
      sourceId: src.id,
      organisation: f.organisation || src.name,
      category: src.category,
      name: f.name,
      bareName: f.bareName,
      titles: f.titles,
      position: f.position,
      previousPosition: prev && prev.position !== f.position ? prev.position : (prev?.previousPosition || ''),
      tier: adjustTier(f.tier, f.position, src.category),
      bnmCategory: classify(f.position, src.category),
      confidence: f.confidence,
      // A person the user uploaded or added keeps that origin even if a web refresh also finds them.
      method: prev && (prev.method === 'upload' || prev.method === 'manual') && !f.method?.match(/upload|manual/) ? prev.method : (f.method || 'page'),
      sourceUrl: f.url,
      firstSeen: prev?.firstSeen || runAt,
      lastSeen: runAt,
      status: 'active',
      notSeenSince: '',
      excluded: prev?.excluded || false,
      note: prev?.note || ''
    });
  }

  // Only mark people as "not seen" when the source was read successfully and returned people,
  // so a site outage or layout change does not wipe the register.
  if (!keepOthers && result.people.length > 0) {
    for (const p of existing) {
      // People from uploaded documents or added by hand are never marked as gone by a web refresh.
      if (!seen.has(p.key) && p.status !== 'not_seen' && p.method !== 'upload' && p.method !== 'manual') {
        dropped++;
        out.push({ ...p, status: 'not_seen', notSeenSince: runAt });
      }
    }
  }
  await putMany('people', out);
  return { added, changed, dropped };
}

function summarise(src, r, m) {
  const state = r.pages.length === 0 ? 'failed' : r.people.length === 0 ? 'empty' : 'ok';
  const kinds = r.errors.map(e => e.kind);
  const reason = state === 'ok' ? '' : state === 'empty' ? (kinds.includes('challenge') ? 'challenge' : 'empty')
    : ['challenge', 'blocked', 'not_found', 'not_html', 'timeout', 'server', 'connection'].find(k => kinds.includes(k)) || 'connection';
  return {
    id: src.id, name: src.name, state, reason,
    found: r.people.length, ...m,
    pages: r.pages, errors: r.errors,
    usedChrome: r.pages.some(p => String(p.via).startsWith('chrome')),
    usedMedia: r.pages.filter(p => p.via === 'pdf' || p.via === 'image').length,
    message: state === 'ok' ? `${r.people.length} people` : REASONS[reason].help
  };
}

async function pool(items, n, fn) {
  let next = 0;
  const worker = async () => { while (next < items.length) { const it = items[next++]; await fn(it); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

// onProgress receives per-source events plus { stage, done, total }.
// partial: a single-source read from the Sources tab; it does not count as a full refresh.
export async function refreshAll(sources, onProgress = () => {}, { useChrome = true, useMedia = true, partial = false } = {}) {
  const runAt = new Date().toISOString();
  const results = new Map();
  const deep = useChrome || useMedia;
  const quick = new Map(); // quick-pass results waiting for the deep pass
  let done = 0;

  // ---- Stage 1: quick pass over every source ----
  await pool(sources, QUICK_CONCURRENCY, async src => {
    onProgress({ id: src.id, state: 'fetching', stage: 1 });
    let row;
    try {
      const r = await crawlSource(src, { useChrome: false, useMedia: false, budgetMs: QUICK_BUDGET_MS });
      if (deep && r.people.length < 3) {
        quick.set(src.id, { src, r });
        row = { id: src.id, name: src.name, state: 'deep', found: r.people.length };
      } else {
        const m = await mergeSource(src, r, runAt);
        row = summarise(src, r, m);
        results.set(src.id, row);
        done++;
      }
    } catch (e) {
      row = { id: src.id, name: src.name, state: 'failed', reason: 'connection', found: 0, added: 0, changed: 0, dropped: 0, pages: [], errors: [{ error: e.message }], message: e.message };
      results.set(src.id, row); done++;
    }
    onProgress({ ...row, stage: 1, done, total: sources.length });
  });

  // ---- Stage 2: deep pass, only for sources that need it ----
  const pending = [...quick.values()];
  onProgress({ stage: 2, done, total: sources.length, deepTotal: pending.length });
  await pool(pending, DEEP_CONCURRENCY, async ({ src, r: first }) => {
    onProgress({ id: src.id, state: 'fetching', stage: 2 });
    let r = first;
    try {
      const second = await crawlSource(src, { useChrome, useMedia, budgetMs: DEEP_BUDGET_MS });
      // Keep everyone found in either pass; the better record wins.
      const byKey = new Map(first.people.map(p => [p.key, p]));
      for (const p of second.people) { const q = byKey.get(p.key); if (!q || p.tier < q.tier) byKey.set(p.key, p); }
      r = { people: [...byKey.values()], pages: [...first.pages, ...second.pages], errors: second.people.length ? second.errors : [...first.errors, ...second.errors] };
    } catch (e) {
      r = { ...first, errors: [...first.errors, { kind: 'connection', error: e.message }] };
    }
    const m = await mergeSource(src, r, runAt);
    const row = summarise(src, r, m);
    results.set(src.id, row); done++;
    onProgress({ ...row, stage: 2, done, total: sources.length });
  });

  try { await chrome.runtime.sendMessage({ type: 'render-finished' }); } catch { /* background asleep */ }
  await closeReaders();

  const list = sources.map(s => results.get(s.id)).filter(Boolean);
  const run = {
    id: runAt,
    partial,
    startedAt: runAt,
    finishedAt: new Date().toISOString(),
    sources: list,
    totals: list.reduce((t, r) => ({
      found: t.found + r.found, added: t.added + r.added, changed: t.changed + r.changed, dropped: t.dropped + r.dropped,
      ok: t.ok + (r.state === 'ok' ? 1 : 0), empty: t.empty + (r.state === 'empty' ? 1 : 0), failed: t.failed + (r.state === 'failed' ? 1 : 0)
    }), { found: 0, added: 0, changed: 0, dropped: 0, ok: 0, empty: 0, failed: 0 })
  };
  await putOne('runs', run);
  return run; // callers record lastRun (offscreen documents have no chrome.storage)
}
