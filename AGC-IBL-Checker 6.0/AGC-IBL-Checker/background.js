/* background.js — opens the checker page and shows a badge when new notices appear */
const LISTING_URL = 'https://lom.agc.gov.my/subsid.php?type=pub';
const APP_URL = chrome.runtime.getURL('app.html');

chrome.action.onClicked.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: APP_URL });
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.tabs.reload(tabs[0].id); // reload = run the check again
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: APP_URL });
  }
});

function setupAlarm() {
  chrome.alarms.get('agc-check', (a) => {
    if (!a) chrome.alarms.create('agc-check', { delayInMinutes: 1, periodInMinutes: 120 });
  });
}
chrome.runtime.onInstalled.addListener(setupAlarm);
chrome.runtime.onStartup.addListener(setupAlarm);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'agc-check') quickCheck().catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === 'refresh-badge') { quickCheck().then(reply, () => reply(null)); return true; }
  return false;
});

// Light-weight check without a DOM: count Act 613 third-party notices not yet processed.
async function quickCheck() {
  const res = await fetch(LISTING_URL, { credentials: 'include' });
  const html = await res.text();
  const { processed = {}, cursorIso = '' } = await chrome.storage.local.get(['processed', 'cursorIso']);
  let count = 0;
  const seen = new Set();
  for (const chunk of html.split(/<tr[\s>]/i).slice(1)) {
    const text = chunk.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    if (!/PIHAK KETIGA|THIRD PART/i.test(text) || !/\b613\b/.test(text)) continue;
    const pm = text.match(/P\.?\s*U\.?\s*\(\s*B\s*\)\s*(\d+)\s*\/\s*(\d{4})/i);
    const dm = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    const key = pm ? `P.U. (B) ${pm[1]}/${pm[2]}` : null;
    const iso = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (processed[key]) continue;
    if (cursorIso && iso && iso < cursorIso) continue;
    count++;
  }
  await chrome.action.setBadgeBackgroundColor({ color: '#8A1C2B' });
  await chrome.action.setBadgeText({ text: count ? String(count) : '' });
  await chrome.storage.local.set({ lastBackgroundCheck: new Date().toISOString(), pendingCount: count });
  return count;
}
