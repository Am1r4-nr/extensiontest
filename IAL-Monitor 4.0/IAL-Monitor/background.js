importScripts('lib/sc.js', 'lib/records.js');

const ALARM = 'ial-check';
let busy = null; // one check/fill at a time

async function schedule() {
  const { settings } = await IAL.load();
  await chrome.alarms.clear(ALARM);
  if (settings.autoCheck) {
    chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: Math.max(1, settings.intervalHours) * 60 });
  }
}

async function refreshBadge() {
  const state = await IAL.load();
  const n = IAL.pendingUpdates(state).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#B42318' });
  await chrome.action.setBadgeText({ text: n ? String(n) : '' });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function exec(tabId, func, args = []) {
  await withTimeout(chrome.scripting.executeScript({ target: { tabId }, files: ['lib/records.js', 'lib/grabber.js'] }), 8000);
  const [r] = await withTimeout(chrome.scripting.executeScript({ target: { tabId }, func, args }), 8000);
  return r && r.result;
}
async function waitLoaded(tabId, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const t = await chrome.tabs.get(tabId); if (t.status === 'complete') return; await sleep(300); }
}
const coreName = n => n.replace(/^potential clone entity\s*[-\u2013\u2014]?\s*/i, '').trim();

// Ask SC's own search service directly (learned from the page the first time). No window needed.
async function viaApi(api, names) {
  const out = {};
  for (const name of names) {
    const q = coreName(name);
    const val = api.form === 'raw' ? q : api.form === 'plus' ? encodeURIComponent(q).replace(/%20/g, '+') : encodeURIComponent(q);
    try {
      const res = await withTimeout(fetch(api.url.split('{{Q}}').join(val), {
        method: api.method, credentials: 'include',
        headers: api.headers || undefined,
        body: api.method.toUpperCase() === 'GET' || !api.body ? undefined : api.body.split('{{Q}}').join(val)
      }), 15000);
      if (!res.ok) continue;
      const r = IALRecords.findInResponses([await res.text()], [name]).result[name];
      if (r) out[name] = r;
    } catch (e) { /* fall back to the page */ }
  }
  return out;
}

// Merge what the page shows (DOM) with what it downloaded (captured data)
async function readPage(tabId, names, query) {
  const cap = await exec(tabId, (n, q) => ialReadCaptured(n, q), [names, query || null]).catch(() => null);
  const dom = await exec(tabId, n => ialGrabFromListPage(n), [names]).catch(() => null) || {};
  const found = {};
  for (const n of names) {
    const a = cap && cap.found[n], b = dom[n] && dom[n].found ? dom[n] : null;
    if (a || b) found[n] = { ...(b || {}), ...(a || {}), websites: [...new Set([...(a ? a.websites : []), ...(b ? b.websites : [])])], found: true,
      reasons: (a && a.reasons) || (b && b.reasons) || '' };
  }
  return { found, api: cap && cap.api };
}

async function fillDetails() {
  const state = await IAL.load();
  const names = IAL.namesNeedingDetails(state);
  if (!names.length) return { found: 0, total: 0, missing: [] };
  const results = {};
  const progress = (i, name) => chrome.storage.local.set({ fillProgress: { i, total: names.length, name, at: Date.now() } });
  let error = null;

  // 1) direct, if we already know SC's search service
  if (state.api) Object.assign(results, await viaApi(state.api, names));

  // 2) the SC list page in a minimised window
  let todo = names.filter(n => !results[n]);
  let win;
  if (todo.length) {
    try {
      win = await chrome.windows.create({ url: IAL.LIST_URL, state: 'minimized', focused: false });
      const tabId = win.tabs[0].id;
      await waitLoaded(tabId);
      await sleep(2000);
      Object.assign(results, (await readPage(tabId, todo)).found);
      todo = names.filter(n => !results[n]);
      for (let i = 0; i < todo.length; i++) {
        const name = todo[i];
        await progress(i + 1, name);
        try {
          await exec(tabId, q => ialTypeSearch(q), [coreName(name)]);
          await sleep(800);
          await waitLoaded(tabId);
          for (let k = 0; k < 12; k++) {
            const r = await readPage(tabId, [name], coreName(name));
            if (r.api && !state.api) { state.api = r.api; await IAL.save({ api: r.api }); await IAL.log('Learned SC search', r.api.method + ' ' + r.api.url); }
            if (r.found[name]) { results[name] = r.found[name]; break; }
            await sleep(500);
          }
        } catch (e) { error = e.message; }
      }
    } catch (e) {
      error = e.message;
    } finally {
      if (win) chrome.windows.remove(win.id).catch(() => {});
    }
  }
  chrome.storage.local.remove('fillProgress');

  names.forEach(n => { if (!results[n]) results[n] = { found: false }; });
  const st = await IAL.load();
  const found = IAL.applyGrab(st, results);
  await IAL.save({ details: st.details });
  const missing = names.filter(n => !results[n].found);
  await IAL.log('Filled details from SC list', `${names.length - missing.length} of ${names.length} found` +
    (missing.length ? `; not found: ${missing.join('; ')}` : '') + (error ? `; problem: ${error}` : ''));
  return { found, total: names.length, missing, error };
}

async function runCheck(source) {
  let newly = [], fill = null, error = null;
  try {
    ({ newly } = await IAL.checkForUpdates({ source }));
    const state = await IAL.load();
    if (IAL.namesNeedingDetails(state).length) fill = await fillDetails();
    if (newly.length) {
      const names = newly.flatMap(u => u.names);
      chrome.notifications.create('ial-' + Date.now(), {
        type: 'basic', iconUrl: 'icons/icon128.png', priority: 2,
        title: `New SC Investor Alert update (${newly.map(u => IAL.isoToDmy(u.iso)).join(', ')})`,
        message: `${names.length} entit${names.length === 1 ? 'y' : 'ies'} added` +
          (fill ? `, details filled for ${fill.found} of ${fill.total}` : '') + '. Click to download the Excel.'
      });
    }
  } catch (e) {
    error = String(e && e.message || e);
    await IAL.log('Check failed', error);
  }
  await refreshBadge();
  return { newCount: newly.length, fill, error };
}

function once(fn) { if (!busy) busy = fn().finally(() => { busy = null; }); return busy; }

chrome.runtime.onInstalled.addListener(async () => { await schedule(); await refreshBadge(); });
chrome.runtime.onStartup.addListener(async () => { await schedule(); once(() => runCheck('startup')); });
chrome.alarms.onAlarm.addListener(a => { if (a.name === ALARM) once(() => runCheck('scheduled')); });
chrome.notifications.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('app.html') }));

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg) return;
  if (msg.type === 'reschedule') { schedule().then(() => reply(true)); return true; }
  if (msg.type === 'badge') { refreshBadge().then(() => reply(true)); return true; }
  if (msg.type === 'check') { once(() => runCheck('manual')).then(reply); return true; }
  if (msg.type === 'fill') { once(() => fillDetails().catch(e => ({ error: e.message }))).then(async r => { await refreshBadge(); reply(r); }); return true; }
});
