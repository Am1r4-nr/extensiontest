// UNSC Sanctions Watch - background service worker
const LIST_URL = 'https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list';
const PRESS_URL = 'https://press.un.org/en/content/security-council/press-release';
const ALARM = 'unsc-check';
const DEFAULT_INTERVAL = 60; // minutes
const LOG_LIMIT = 1000;
const SHOT_ALARM = 'unsc-daily-shot';
const DEFAULT_SETTINGS = { intervalMin: DEFAULT_INTERVAL, autoShot: true, shotTime: '09:00', shotOnChange: true };

// Words that suggest a press release is about sanctions lists / committees
const SANCTIONS_RE = /sanction|committee|removes?\b|adds?\b|amends?\b|delist|list(ing|ed)?\b|entr(y|ies)|1267|1518|1533|1591|1718|1970|2048|2127|2140|2206|2231|2374|2653|2713|2745|isil|da'?esh|al-?qaida|taliban/i;

// ---------- lifecycle ----------
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({ settings: await getSettings() });
  await ensureAlarm();
  await scheduleDailyShot();
  runCheck('install');
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  await scheduleDailyShot();
  await runCheck('browser start');
  catchUpDailyShot();
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) runCheck('scheduled').then(catchUpDailyShot);
  if (a.name === SHOT_ALARM) dailyShot();
});

chrome.notifications.onClicked.addListener((id) => {
  const url = id.startsWith('press') ? PRESS_URL : LIST_URL;
  chrome.tabs.create({ url });
  chrome.notifications.clear(id);
});

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function ensureAlarm() {
  const settings = await getSettings();
  const period = settings.intervalMin;
  const existing = await chrome.alarms.get(ALARM);
  if (!existing || existing.periodInMinutes !== period) {
    await chrome.alarms.clear(ALARM);
    chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: period });
  }
}

// ---------- messages from popup ----------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'check') {
      sendResponse(await runCheck('manual'));
    } else if (msg.type === 'ack') {
      sendResponse(await acknowledge(msg.target));
    } else if (msg.type === 'setInterval') {
      const { settings = {} } = await chrome.storage.local.get('settings');
      settings.intervalMin = msg.minutes;
      await chrome.storage.local.set({ settings });
      await ensureAlarm();
      sendResponse(await chrome.storage.local.get(null));
    } else if (msg.type === 'setShots') {
      const settings = await getSettings();
      Object.assign(settings, msg.values);
      await chrome.storage.local.set({ settings });
      await scheduleDailyShot();
      sendResponse(await chrome.storage.local.get(null));
    } else if (msg.type === 'captureTab') {
      await queueCapture(() => captureAndSave(msg.windowId, msg.tabId, 'manual'));
      sendResponse(await chrome.storage.local.get(null));
    } else if (msg.type === 'captureNow') {
      await queueCapture(() => autoCapture(LIST_URL, 'manual'));
      sendResponse(await chrome.storage.local.get(null));
    } else if (msg.type === 'log') {
      await addLog(msg.entry);
      sendResponse(await chrome.storage.local.get(null));
    } else if (msg.type === 'state') {
      sendResponse(await chrome.storage.local.get(null));
    }
  })();
  return true; // async response
});

// ---------- fetching & parsing ----------
async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-store', credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.text();
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseList(html) {
  const text = htmlToText(html);
  const date = text.match(/last updated on\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
  if (!date) throw new Error('Could not find the "last updated" date on the Consolidated List page. The page layout may have changed.');
  const ind = text.match(/Individuals\s*\(\s*([\d,]+)\s*individuals?\s*\)/i);
  const ent = text.match(/Entities and other groups\s*\(\s*([\d,]+)\s*entit(?:y|ies)\s*\)/i);
  return {
    date: date[1],
    individuals: ind ? Number(ind[1].replace(/,/g, '')) : null,
    entities: ent ? Number(ent[1].replace(/,/g, '')) : null,
  };
}

function parsePress(html) {
  const re = /<a[^>]+href="([^"]*\/(\d{4})\/(sc\d+)\.doc\.htm)"[^>]*>([\s\S]*?)<\/a>/gi;
  const items = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) && items.length < 25) {
    const id = m[3].toLowerCase();
    const title = htmlToText(m[4]);
    if (seen.has(id) || !title) continue;
    seen.add(id);
    items.push({
      id,
      ref: 'SC/' + id.slice(2),
      url: new URL(m[1], 'https://press.un.org').href,
      title,
      sanctions: SANCTIONS_RE.test(title),
    });
  }
  if (!items.length) throw new Error('No Security Council press releases found on the press release page. The page layout may have changed.');
  return items;
}

// ---------- main check ----------
let running = null;
function runCheck(trigger) {
  if (!running) running = doCheck(trigger).finally(() => { running = null; });
  return running;
}

async function doCheck(trigger) {
  const state = await chrome.storage.local.get(['list', 'press']);
  const now = Date.now();
  const entry = { at: now, trigger };

  // Consolidated List
  let list = { ...(state.list || {}) };
  try {
    const r = parseList(await fetchText(LIST_URL));
    if (!list.ackDate) {
      // first run: current page becomes the reviewed baseline
      Object.assign(list, { ackDate: r.date, ackAt: now, ackBy: 'baseline',
        ackIndividuals: r.individuals, ackEntities: r.entities });
    }
    const wasChanged = !!list.changed;
    const prevDate = list.lastDate;
    Object.assign(list, {
      lastDate: r.date, individuals: r.individuals, entities: r.entities,
      checkedAt: now, error: null, changed: r.date !== list.ackDate,
    });
    if (list.changed && (!wasChanged || prevDate !== r.date)) {
      list.detectedAt = now;
      notify('list-' + now, 'UNSC Consolidated List updated',
        `Last updated date is now ${r.date} (was ${list.ackDate}). Update KAF ID Screen.`);
    }
    Object.assign(entry, { listDate: r.date, individuals: r.individuals, entities: r.entities,
      listChanged: list.changed });
  } catch (e) {
    list.checkedAt = now;
    list.error = e.message;
    entry.error = 'List: ' + e.message;
  }

  // Press releases
  let press = { ...(state.press || {}) };
  try {
    const items = parsePress(await fetchText(PRESS_URL));
    const seenIds = new Set(press.seenIds || []);
    const firstRun = !press.seenIds;
    const fresh = firstRun ? [] : items.filter((i) => !seenIds.has(i.id));
    items.forEach((i) => seenIds.add(i.id));
    const unreviewed = [...fresh.map((i) => ({ ...i, foundAt: now })), ...(press.unreviewed || [])];
    Object.assign(press, {
      items: items.slice(0, 12),
      seenIds: [...seenIds].slice(-500),
      unreviewed,
      checkedAt: now,
      error: null,
    });
    const freshSanctions = fresh.filter((i) => i.sanctions);
    if (freshSanctions.length) {
      notify('press-' + now, `New sanctions press release${freshSanctions.length > 1 ? 's' : ''}`,
        freshSanctions.map((i) => `${i.ref}: ${i.title}`).join('\n').slice(0, 250));
    }
    Object.assign(entry, { newPress: fresh.map((i) => i.ref).join(' '),
      newSanctionsPress: freshSanctions.map((i) => i.ref).join(' ') });
  } catch (e) {
    press.checkedAt = now;
    press.error = e.message;
    entry.error = (entry.error ? entry.error + ' | ' : '') + 'Press: ' + e.message;
  }

  await chrome.storage.local.set({ list, press });
  await addLog(entry);
  await updateBadge();

  const settings = await getSettings();
  if (settings.shotOnChange) {
    if (list.detectedAt === now) captureWhenUnlocked(LIST_URL, 'change detected');
    if ((entry.newSanctionsPress || '').length) captureWhenUnlocked(PRESS_URL, 'new sanctions press release');
  }
  return chrome.storage.local.get(null);
}

async function acknowledge(target) {
  const { list = {}, press = {} } = await chrome.storage.local.get(['list', 'press']);
  const now = Date.now();
  if (target === 'list' && list.lastDate) {
    await addLog({ at: now, trigger: 'reviewed', listDate: list.lastDate,
      note: `Consolidated List change reviewed (${list.ackDate} -> ${list.lastDate})` });
    Object.assign(list, { ackDate: list.lastDate, ackAt: now, ackBy: 'user', changed: false,
      ackIndividuals: list.individuals, ackEntities: list.entities });
    await chrome.storage.local.set({ list });
  }
  if (target === 'press' && press.unreviewed?.length) {
    await addLog({ at: now, trigger: 'reviewed',
      note: 'Press releases reviewed: ' + press.unreviewed.map((i) => i.ref).join(' ') });
    press.unreviewed = [];
    await chrome.storage.local.set({ press });
  }
  await updateBadge();
  return chrome.storage.local.get(null);
}

// ---------- helpers ----------
async function addLog(entry) {
  const { log = [] } = await chrome.storage.local.get('log');
  log.unshift(entry);
  await chrome.storage.local.set({ log: log.slice(0, LOG_LIMIT) });
}

async function updateBadge() {
  const { list = {}, press = {} } = await chrome.storage.local.get(['list', 'press']);
  const pending = (list.changed ? 1 : 0) + (press.unreviewed || []).filter((i) => i.sanctions).length;
  if (pending) {
    chrome.action.setBadgeText({ text: String(pending) });
    chrome.action.setBadgeBackgroundColor({ color: '#B42318' });
  } else if (list.error || press.error) {
    chrome.action.setBadgeText({ text: '?' });
    chrome.action.setBadgeBackgroundColor({ color: '#8A6D1F' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

function notify(id, title, message) {
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    priority: 2,
    requireInteraction: true,
  });
}

// ---------- automatic evidence screenshots ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todayKey = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

async function scheduleDailyShot() {
  await chrome.alarms.clear(SHOT_ALARM);
  const s = await getSettings();
  if (!s.autoShot) return;
  const [h, m] = s.shotTime.split(':').map(Number);
  const next = new Date();
  next.setHours(h, m, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  chrome.alarms.create(SHOT_ALARM, { when: next.getTime(), periodInMinutes: 1440 });
}

// If Chrome was closed or the PC was locked at the scheduled time, take today's shot later.
async function catchUpDailyShot() {
  const s = await getSettings();
  if (!s.autoShot) return;
  const { lastDailyShot } = await chrome.storage.local.get('lastDailyShot');
  const [h, m] = s.shotTime.split(':').map(Number);
  const due = new Date();
  due.setHours(h, m, 0, 0);
  if (lastDailyShot !== todayKey() && Date.now() >= due.getTime()) dailyShot();
}

async function dailyShot() {
  const s = await getSettings();
  if (!s.autoShot) return;
  const { lastDailyShot } = await chrome.storage.local.get('lastDailyShot');
  if (lastDailyShot === todayKey()) return;
  const ok = await captureWhenUnlocked(LIST_URL, 'daily');
  if (ok) await chrome.storage.local.set({ lastDailyShot: todayKey() });
}

// A locked or sleeping screen gives blank screenshots, so wait until the user is back.
async function captureWhenUnlocked(url, reason) {
  const idle = await chrome.idle.queryState(60);
  if (idle === 'locked') {
    const { pendingShots = [] } = await chrome.storage.local.get('pendingShots');
    if (!pendingShots.some((p) => p.url === url && p.reason === reason)) pendingShots.push({ url, reason });
    await chrome.storage.local.set({ pendingShots });
    return false;
  }
  const res = await queueCapture(() => autoCapture(url, reason));
  return !!res;
}

chrome.idle.onStateChanged.addListener(async (state) => {
  if (state !== 'active') return;
  const { pendingShots = [] } = await chrome.storage.local.get('pendingShots');
  if (!pendingShots.length) return catchUpDailyShot();
  await chrome.storage.local.set({ pendingShots: [] });
  for (const p of pendingShots) {
    const ok = await queueCapture(() => autoCapture(p.url, p.reason + ' (delayed, screen was locked)'));
    if (ok && p.reason === 'daily') await chrome.storage.local.set({ lastDailyShot: todayKey() });
  }
});

// Run captures one at a time.
let captureChain = Promise.resolve();
function queueCapture(fn) {
  const next = captureChain.then(fn, fn);
  captureChain = next.catch(() => {});
  return next;
}

// Opens the page in a small window, captures it, then closes the window (about 5-10 seconds).
async function autoCapture(url, reason) {
  let win;
  try {
    win = await chrome.windows.create({ url, focused: true, type: 'normal', width: 1366, height: 900 });
    const tabId = win.tabs[0].id;
    await waitForLoad(tabId, 60000);
    await sleep(2500);
    return await captureAndSave(win.id, tabId, reason);
  } catch (e) {
    await addLog({ at: Date.now(), trigger: 'screenshot failed', error: e.message, note: `Automatic screenshot (${reason})` });
    notify('shotfail-' + Date.now(), 'Evidence screenshot failed', `${e.message} Take it manually from the extension popup.`);
    return null;
  } finally {
    if (win) chrome.windows.remove(win.id).catch(() => {});
  }
}

async function waitForLoad(tabId, timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete' && tab.url && !tab.url.startsWith('chrome')) return tab;
    await sleep(500);
  }
  throw new Error('The UN page took too long to load.');
}

// Scroll to and highlight the "last updated on ..." sentence so it is visible in the evidence.
async function highlightDate(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const els = [...document.querySelectorAll('p, li, td, div, span')]
          .filter((e) => /last updated on/i.test(e.textContent || ''));
        if (!els.length) return false;
        els.sort((a, b) => a.textContent.length - b.textContent.length);
        const el = els[0];
        el.scrollIntoView({ block: 'center' });
        el.style.outline = '3px solid #E0A800';
        el.style.background = '#FFF6D6';
        return true;
      },
    });
    await sleep(600);
  } catch (_) { /* page may block scripting; capture anyway */ }
}

async function captureAndSave(windowId, tabId, reason) {
  const tab = await chrome.tabs.get(tabId);
  await highlightDate(tabId);
  const shot = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const { list = {} } = await chrome.storage.local.get('list');
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const line1 = `Captured ${now.toLocaleString('en-GB', { hour12: false })} (${tz})   |   ${reason === 'manual' ? 'Manual' : 'Automatic: ' + reason}`;
  const line2 = `${list.lastDate ? 'Consolidated List last updated: ' + list.lastDate + '   |   ' : ''}${tab.url}`;
  const dataUrl = await stampImage(shot, line1, line2);

  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const page = tab.url.includes('press.un.org') ? 'PressRelease' : 'ConsolidatedList';
  const filename = `UNSC Evidence/UNSC_${page}_${stamp}.png`;
  await chrome.downloads.download({ url: dataUrl, filename, saveAs: false, conflictAction: 'uniquify' });

  const lastShot = { at: now.getTime(), filename, reason };
  await chrome.storage.local.set({ lastShot });
  await addLog({ at: now.getTime(), trigger: 'screenshot', listDate: list.lastDate,
    note: `${reason === 'manual' ? 'Manual' : 'Automatic (' + reason + ')'} evidence saved: ${filename}` });
  return lastShot;
}

async function stampImage(dataUrl, line1, line2) {
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const band = Math.max(60, Math.round(bmp.height * 0.07));
  const canvas = new OffscreenCanvas(bmp.width, bmp.height + band);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  ctx.fillStyle = '#16233A';
  ctx.fillRect(0, bmp.height, bmp.width, band);
  const fontPx = Math.round(band * 0.28);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `600 ${fontPx}px "Segoe UI", Arial, sans-serif`;
  ctx.fillText(line1, 16, bmp.height + band * 0.42);
  ctx.font = `${Math.round(fontPx * 0.85)}px "Segoe UI", Arial, sans-serif`;
  ctx.fillText(line2, 16, bmp.height + band * 0.8);
  const out = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let bin = '';
  for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
  return 'data:image/png;base64,' + btoa(bin);
}
