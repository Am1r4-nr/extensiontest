import { cleanRegister } from './cleanup.js';
import { loadSettings, effectiveSources, autoDays, staleness, recordRun, getLock, setLock, clearLock, updateLock } from './settings.js';

const ALARM = 'auto-refresh';
const BADGE_ALARM = 'badge-check';
const DASHBOARD = () => chrome.runtime.getURL('dashboard.html');

// ---------- Scheduling ----------
async function schedule() {
  const settings = await loadSettings();
  const days = autoDays(settings);
  await chrome.alarms.clear(ALARM);
  if (!days) return;
  const { lastRun } = await chrome.storage.local.get('lastRun');
  const due = lastRun ? new Date(lastRun.finishedAt).getTime() + days * 86400000 : Date.now() + 60 * 60000;
  await chrome.alarms.create(ALARM, { when: Math.max(due, Date.now() + 60000), periodInMinutes: days * 1440 });
}

// If Chrome was closed when a refresh was due, run it now.
async function runIfOverdue() {
  const settings = await loadSettings();
  const days = autoDays(settings);
  const { lastRun } = await chrome.storage.local.get('lastRun');
  if (!days || !lastRun) return; // first build is started by the user
  if (Date.now() - new Date(lastRun.finishedAt).getTime() >= days * 86400000) await startAutoRefresh();
}

// ---------- Background refresh ----------
async function startAutoRefresh() {
  if (await getLock()) return; // a refresh is already running
  await setLock('auto');
  await updateBadge();
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (!existing.length) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: 'Read government and GLC web pages to extract office holders for the PEP register'
    });
  }
}

async function finish() {
  try { await chrome.offscreen.closeDocument(); } catch { /* already closed */ }
  await clearLock();
  await schedule();
  await updateBadge();
}

// ---------- Open a page in Chrome and read it (for sites that refuse direct requests) ----------
// Pages load in a minimized window, as for any visitor. If the site shows a "verify you are human"
// check, nothing is attempted: the user is asked to open the page themselves.
const CHALLENGE_RE = /just a moment|checking your browser|attention required|verify you are human|are you a robot|captcha|request unsuccessful|ddos protection|access denied/i;
let renderWinId = null;
let closeTimer = null;
let renderQueue = Promise.resolve();
const sleep = ms => new Promise(r => setTimeout(r, ms));

function renderPage(url) {
  const job = renderQueue.then(() => doRender(url));
  renderQueue = job.catch(() => {});
  return job;
}
async function renderWindow() {
  if (renderWinId != null) {
    try { await chrome.windows.get(renderWinId); return renderWinId; } catch { renderWinId = null; }
  }
  const w = await chrome.windows.create({ url: 'about:blank', focused: false, state: 'minimized' });
  renderWinId = w.id;
  return renderWinId;
}
async function closeRenderWindow() {
  if (renderWinId == null) return;
  try { await chrome.windows.remove(renderWinId); } catch { /* already closed */ }
  renderWinId = null;
}
function waitForLoad(tabId, ms) {
  return new Promise(resolve => {
    const done = () => { clearTimeout(t); chrome.tabs.onUpdated.removeListener(l); resolve(); };
    const l = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    const t = setTimeout(done, ms);
    chrome.tabs.onUpdated.addListener(l);
  });
}
async function doRender(url) {
  clearTimeout(closeTimer);
  let tabId;
  try {
    const winId = await renderWindow();
    const tab = await chrome.tabs.create({ windowId: winId, url, active: true });
    tabId = tab.id;
    await waitForLoad(tabId, 20000);
    await sleep(1500); // let JavaScript finish filling the page
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const text = document.body ? document.body.innerText : '';
        return { html: document.documentElement.outerHTML, url: location.href, title: document.title, head: text.slice(0, 600), len: text.length };
      }
    });
    const r = res?.result;
    if (!r) return { error: 'Chrome could not read the page', kind: 'connection' };
    if (r.len < 2500 && CHALLENGE_RE.test(r.title + ' ' + r.head)) return { challenge: true };
    return { html: r.html, finalUrl: r.url };
  } catch (e) {
    const msg = String(e?.message || e);
    return { error: /error page|cannot access|chrome-error|frame/i.test(msg) ? 'Chrome could not load the page (site down or certificate problem)' : msg, kind: 'connection' };
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId); } catch { /* closed */ } }
    closeTimer = setTimeout(closeRenderWindow, 60000);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'render-page') {
    renderPage(msg.url).then(sendResponse);
    return true;
  }
  if (msg?.type === 'render-finished') { renderQueue.then(closeRenderWindow); return; }
  if (msg?.type === 'refresh-progress') { updateLock({ done: msg.done, total: msg.total, stage: msg.stage }); return; }
  if (msg?.type === 'stop-auto-refresh') {
    (async () => {
      try { await chrome.offscreen.closeDocument(); } catch { /* not running */ }
      await closeRenderWindow();
      await clearLock();
      await updateBadge();
      sendResponse(true);
    })();
    return true;
  }
  if (msg?.type === 'get-refresh-job') {
    loadSettings().then(s => sendResponse({ sources: effectiveSources(s).filter(x => x.enabled), useChrome: s.useChrome ?? true, useMedia: s.useMedia ?? true }));
    return true;
  }
  if (msg?.type === 'auto-refresh-done') {
    (async () => {
      const last = await recordRun(msg.run);
      await finish();
      const t = last.totals;
      notify('PEP register updated',
        `${t.added} new, ${t.changed} changed position, ${t.dropped} no longer listed.` +
        (last.problems.length ? ` ${last.problems.length} source${last.problems.length === 1 ? '' : 's'} need${last.problems.length === 1 ? 's' : ''} attention.` : ''));
    })();
  }
  if (msg?.type === 'auto-refresh-failed') {
    (async () => {
      await finish();
      notify('PEP register refresh did not finish', `${msg.error}. Open the register and select Refresh all sources.`);
    })();
  }
  if (msg?.type === 'settings-changed') schedule().then(updateBadge);
  if (msg?.type === 'run-recorded') schedule().then(updateBadge);
});

// ---------- Toolbar badge: shows when data is out of date ----------
async function updateBadge() {
  const settings = await loadSettings();
  const { lastRun } = await chrome.storage.local.get('lastRun');
  const lock = await getLock();
  if (lock) {
    await chrome.action.setBadgeText({ text: '…' });
    await chrome.action.setBadgeBackgroundColor({ color: '#0B5A68' });
    await chrome.action.setTitle({ title: 'PEP Register: refreshing now' });
    return;
  }
  const s = staleness(lastRun, settings);
  if (s.stale) {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#A33131' });
    await chrome.action.setTitle({ title: lastRun
      ? `PEP Register: last refreshed ${s.days} days ago. Refresh needed.`
      : 'PEP Register: not built yet. Open and select Refresh now.' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: `PEP Register: refreshed ${s.days === 0 ? 'today' : s.days + ' day(s) ago'}` });
  }
}

function notify(title, message) {
  chrome.notifications.create('pep-' + Date.now(), { type: 'basic', iconUrl: 'icons/icon128.png', title, message, priority: 1 });
}
chrome.notifications.onClicked.addListener(id => {
  chrome.tabs.create({ url: DASHBOARD() });
  chrome.notifications.clear(id);
});

// ---------- Events ----------
chrome.runtime.onInstalled.addListener(async details => {
  if (details.reason === 'update') {
    try {
      const r = await cleanRegister();
      await chrome.storage.local.set({ lastCleanup: { at: new Date().toISOString(), ...r } });
      if (r.removed || r.fixed) notify('PEP register cleaned up', `${r.removed} entries that were not people were removed and ${r.fixed} names were corrected. Run a refresh to pick up any changes.`);
    } catch (e) { /* register empty or not yet created */ }
  }
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'pep-check', title: 'Check "%s" in PEP register', contexts: ['selection'] });
  await chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 60 });
  await schedule();
  await updateBadge();
});
chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 60 });
  await schedule();
  await updateBadge();
  await runIfOverdue();
});
chrome.alarms.onAlarm.addListener(a => {
  if (a.name === ALARM) startAutoRefresh();
  if (a.name === BADGE_ALARM) updateBadge();
});
chrome.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId !== 'pep-check' || !info.selectionText) return;
  const q = encodeURIComponent('q=' + info.selectionText.trim().slice(0, 120));
  chrome.tabs.create({ url: DASHBOARD() + '#' + q });
});
