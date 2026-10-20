import { getAll } from './db.js';
import { matchesName, fmtDate, loadSettings, saveSettings, effectiveSources, staleness, getLock } from './settings.js';
import { extractPeople, extractFromLines, contextFromText, baseDomain } from './extractor.js';
import { readMedia, isPdfUrl, isImageUrl, closeReaders } from './media.js';
import { mergeSource } from './crawler.js';
import { CATEGORIES } from './sources.js';

const $ = s => document.querySelector(s);
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const open = hash => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') + (hash ? '#' + hash : '') });

const people = (await getAll('people')).filter(p => !p.excluded);
const associates = await getAll('associates');
const byKey = new Map(people.map(p => [p.key, p]));
const { lastRun } = await chrome.storage.local.get('lastRun');
const cur = people.filter(p => p.status === 'active').length;
$('#meta').textContent = lastRun
  ? `${cur.toLocaleString()} current PEPs, ${(people.length - cur).toLocaleString()} former, ${associates.length.toLocaleString()} family and associates. Last refreshed ${fmtDate(lastRun.finishedAt)}.`
  : 'Register is empty. Select Refresh now to build it.';

const settings = await loadSettings();
const st = staleness(lastRun, settings);
const lock = await getLock();
const alarm = await chrome.alarms.get('auto-refresh');
const stale = $('#stale');
if (lock) { stale.hidden = false; stale.style.color = 'var(--accent)'; stale.textContent = lock.total ? `Refreshing now: ${lock.done} of ${lock.total} sources done.` : 'Refreshing now.'; }
else if (lastRun && st.stale) { stale.hidden = false; stale.textContent = `Out of date: last refreshed ${st.days} days ago. Select Refresh now.`; }
else if (alarm) { stale.hidden = false; stale.style.color = 'var(--muted)'; stale.style.fontWeight = '400'; stale.textContent = `Next automatic refresh: ${fmtDate(new Date(alarm.scheduledTime).toISOString())}`; }

$('#q').addEventListener('input', () => {
  const q = $('#q').value.trim();
  const ul = $('#results');
  if (q.length < 3) { ul.innerHTML = ''; return; }
  const peps = people.filter(p => matchesName(p, q)).map(p => ({
    title: `${p.titles} ${p.bareName}`,
    sub: `${p.position}, ${p.organisation}${p.status === 'not_seen' ? ' (former PEP)' : ''}`
  }));
  const rcas = associates.filter(a => matchesName({ bareName: a.name }, q)).map(a => {
    const pep = byKey.get(a.pepKey);
    return { title: a.name, sub: `${a.group}: ${a.relationship} of ${pep ? `${pep.bareName} (${pep.position})` : a.pepName}` };
  });
  const hits = [...peps, ...rcas];
  ul.innerHTML = hits.length
    ? `<li class="hit">${hits.length} possible match${hits.length === 1 ? '' : 'es'}</li>` +
      hits.slice(0, 20).map(x => `<li><strong>${h(x.title.trim())}</strong><div class="sub">${h(x.sub)}</div></li>`).join('')
    : `<li class="clear">No match in the register for “${h(q)}”.</li>`;
});
$('#refresh').addEventListener('click', () => open('refresh'));
$('#open').addEventListener('click', () => open(''));
$('#q').focus();

// ---------- Add people from the page open in this tab ----------
// For sites that ask visitors to prove they are human, or that the refresh cannot read:
// the user opens the page, passes any check, and captures it here.
let captured = null;
$('#capture').addEventListener('click', async () => {
  const box = $('#capBox'); box.hidden = false;
  $('#capSave').hidden = true; $('#capList').innerHTML = '';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/i.test(tab.url || '')) { $('#capMsg').textContent = 'Open the leadership page of a website in this tab first, then try again.'; return; }
  let page, found;
  if (isPdfUrl(tab.url) || isImageUrl(tab.url)) {
    // A PDF or picture open in the tab: read it directly (text recognition for pictures and scans).
    $('#capMsg').textContent = 'Reading the file. Pictures and scanned PDFs can take up to a minute; keep this popup open.';
    try {
      const r = await readMedia(tab.url);
      page = { url: r.finalUrl, title: decodeURIComponent(tab.url.split('/').pop().split('?')[0]) };
      found = extractFromLines(r.lines, contextFromText(page.title + ' ' + r.lines.slice(0, 8).join(' ')), r.finalUrl)
        .map(p => ({ ...p, method: r.method, confidence: r.method === 'image' && p.confidence === 'high' ? 'medium' : p.confidence }));
    } catch (e) { $('#capMsg').textContent = 'Could not read this file: ' + e.message; return; }
    finally { closeReaders(); }
  } else {
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ html: document.documentElement.outerHTML, url: location.href, title: document.title }) });
      page = res.result;
    } catch { $('#capMsg').textContent = 'Chrome did not allow the extension to read this page.'; return; }
    found = extractPeople(new DOMParser().parseFromString(page.html, 'text/html'), page.url);
  }
  if (!found.length) {
    $('#capMsg').textContent = 'No office holders recognised on this page. Make sure it is the page that lists names with positions (for example Pengurusan Tertinggi or Lembaga Pengarah).';
    return;
  }
  captured = { page, found };
  $('#capMsg').textContent = `${found.length} ${found.length === 1 ? 'person' : 'people'} found on this page. Check the list, then save.`;
  $('#capList').innerHTML = found.slice(0, 50).map(p => `<li><strong>${h(p.bareName)}</strong> — ${h(p.position)}</li>`).join('') +
    (found.some(p => p.method === 'image') ? '<li class="muted">Read from a picture: check spellings against the source.</li>' : '');

  const settings = await loadSettings();
  const sources = effectiveSources(settings);
  const host = baseDomain(page.url);
  const match = sources.find(s => { const b = baseDomain(s.url); return host === b || host.endsWith('.' + b) || b.endsWith('.' + host); });
  $('#capSource').innerHTML = `<option value="__new">New source: ${h(page.title.slice(0, 60) || host)}</option>` +
    sources.map(s => `<option value="${h(s.id)}"${match && s.id === match.id ? ' selected' : ''}>${h(s.name)}</option>`).join('');
  $('#capCategory').innerHTML = CATEGORIES.map(c => `<option>${h(c)}</option>`).join('');
  const syncCat = () => { $('#capCategory').hidden = $('#capSource').value !== '__new'; };
  $('#capSource').onchange = syncCat; syncCat();
  $('#capSave').hidden = false;
});

$('#capConfirm').addEventListener('click', async () => {
  if (!captured) return;
  const { page, found } = captured;
  const settings = await loadSettings();
  let src;
  if ($('#capSource').value === '__new') {
    const origin = new URL(page.url).origin;
    src = { id: 'custom-' + Date.now(), name: page.title.slice(0, 80) || new URL(page.url).hostname, category: $('#capCategory').value, url: origin + '/', custom: true };
    settings.custom.push(src);
  } else {
    src = effectiveSources(settings).find(s => s.id === $('#capSource').value);
  }
  // Remember this page so future refreshes read it directly.
  const o = (settings.overrides[src.id] ||= {});
  o.pinnedUrls = [...new Set([...(o.pinnedUrls || []), page.url])];
  await saveSettings(settings);
  const m = await mergeSource(src, { people: found }, new Date().toISOString(), { keepOthers: true });
  $('#capSave').hidden = true;
  $('#capMsg').textContent = `Saved under ${src.name}: ${m.added} new, ${m.changed} updated. This page is now pinned for future refreshes.`;
  // Future refreshes need permission to read this site; ask last because the prompt can close the popup.
  try { await chrome.permissions.request({ origins: [new URL(page.url).origin + '/*'] }); } catch { /* covered already */ }
});
