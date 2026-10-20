const LIST_URL = 'https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list';
const PRESS_URL = 'https://press.un.org/en/content/security-council/press-release';
const UN_PAGE_RE = /^https:\/\/(main|press)\.un\.org\//;

const $ = (id) => document.getElementById(id);
const fmt = (t) => t ? new Date(t).toLocaleString('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
}) : '–';
const send = (msg) => chrome.runtime.sendMessage(msg);

let state = {};
let activeTab = null;

async function init() {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state = await send({ type: 'state' });
  render();
  // Refresh on open if the last check is older than 10 minutes
  const last = state.list?.checkedAt || 0;
  if (Date.now() - last > 10 * 60 * 1000) doCheck();
}

function render() {
  const list = state.list || {};
  const press = state.press || {};
  const settings = state.settings || {};

  $('checked').textContent = list.checkedAt ? `Last checked ${fmt(list.checkedAt)}` : 'Not checked yet';
  $('interval').value = String(settings.intervalMin || 60);

  // Date plate
  const plate = $('plate');
  plate.className = 'plate';
  $('listDate').textContent = list.lastDate || '–';
  $('ackList').hidden = true;

  const counts = [];
  if (list.individuals != null) counts.push(`${list.individuals} individuals${delta(list.individuals, list.ackIndividuals)}`);
  if (list.entities != null) counts.push(`${list.entities} entities${delta(list.entities, list.ackEntities)}`);
  $('counts').innerHTML = counts.join(', ');

  if (list.error) {
    plate.classList.add('warn');
    $('listStatus').textContent = `Check failed: ${list.error} Showing the last known date.`;
  } else if (list.changed) {
    plate.classList.add('alert');
    $('listStatus').textContent = `Changed from ${list.ackDate}, detected ${fmt(list.detectedAt)}. Update KAF ID Screen.`;
    $('ackList').hidden = false;
  } else if (list.lastDate) {
    plate.classList.add('ok');
    $('listStatus').textContent = list.ackBy === 'baseline'
      ? `No change since monitoring started (${fmt(list.ackAt)}).`
      : `No change since you reviewed it on ${fmt(list.ackAt)}.`;
  } else {
    $('listStatus').textContent = 'Checking the Consolidated List…';
  }

  // Press releases
  const unreviewed = press.unreviewed || [];
  const newIds = new Set(unreviewed.map((i) => i.id));
  $('ackPress').hidden = !unreviewed.length;
  if (press.error) {
    $('pressStatus').textContent = `Check failed: ${press.error}`;
  } else if (unreviewed.length) {
    const s = unreviewed.filter((i) => i.sanctions).length;
    $('pressStatus').textContent = `${unreviewed.length} new since your last review` + (s ? `, ${s} sanctions-related.` : '.');
  } else {
    $('pressStatus').textContent = press.checkedAt ? 'No new press releases since your last review.' : '';
  }
  const shown = [...unreviewed, ...(press.items || []).filter((i) => !newIds.has(i.id))].slice(0, 10);
  const ul = $('pressList');
  ul.replaceChildren(...shown.map((i) => {
    const li = document.createElement('li');
    if (newIds.has(i.id)) li.className = 'new';
    const a = document.createElement('a');
    a.href = i.url;
    a.target = '_blank';
    const ref = document.createElement('span');
    ref.className = 'ref';
    ref.textContent = i.ref;
    a.append(ref, i.title);
    li.append(a);
    if (newIds.has(i.id)) li.append(tag('New', 'newtag'));
    if (i.sanctions) li.append(tag('Sanctions'));
    return li;
  }));

  // Screenshot controls
  const onUn = activeTab && UN_PAGE_RE.test(activeTab.url || '');
  $('capture').textContent = onUn ? 'Save evidence screenshot of this page' : 'Save evidence screenshot now';
  $('captureHint').textContent = onUn
    ? 'Captures this page with the date, time, and URL stamped at the bottom.'
    : 'Opens the Consolidated List in a small window, captures it, and closes it.';
  $('autoShot').checked = settings.autoShot !== false;
  $('shotTime').value = settings.shotTime || '09:00';
  $('shotOnChange').checked = settings.shotOnChange !== false;
  const ls = state.lastShot;
  $('lastShot').textContent = ls
    ? `Last screenshot ${fmt(ls.at)} (${ls.reason}), saved to Downloads/${ls.filename}`
    : 'Screenshots are saved to Downloads/UNSC Evidence.';
}

function delta(now, before) {
  if (before == null || now == null || now === before) return '';
  const d = now - before;
  return ` <span class="delta">(${d > 0 ? '+' : ''}${d})</span>`;
}

function tag(text, cls = '') {
  const s = document.createElement('span');
  s.className = 'tag ' + cls;
  s.textContent = text;
  return s;
}

async function doCheck() {
  $('refresh').disabled = true;
  $('refresh').textContent = 'Checking…';
  state = await send({ type: 'check' });
  $('refresh').disabled = false;
  $('refresh').textContent = 'Check now';
  render();
}

// ---------- evidence screenshot ----------
async function captureEvidence() {
  const btn = $('capture');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  const onUn = activeTab && UN_PAGE_RE.test(activeTab.url || '');
  const before = state.lastShot?.at;
  state = onUn
    ? await send({ type: 'captureTab', tabId: activeTab.id, windowId: activeTab.windowId })
    : await send({ type: 'captureNow' });
  btn.disabled = false;
  render();
  if (state.lastShot?.at === before) $('captureHint').textContent = 'The screenshot wasn’t saved. Check the log (CSV) for the reason, then try again.';
}

async function saveShotSettings() {
  state = await send({ type: 'setShots', values: {
    autoShot: $('autoShot').checked,
    shotTime: $('shotTime').value || '09:00',
    shotOnChange: $('shotOnChange').checked,
  } });
  render();
}

// ---------- CSV export ----------
function exportCsv() {
  const log = state.log || [];
  const cols = ['Date/time', 'Event', 'Consolidated List last updated', 'Individuals', 'Entities',
    'List changed', 'New press releases', 'New sanctions press releases', 'Error', 'Note'];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = log.map((e) => [fmt(e.at), e.trigger, e.listDate, e.individuals, e.entities,
    e.listChanged == null ? '' : (e.listChanged ? 'Yes' : 'No'),
    e.newPress, e.newSanctionsPress, e.error, e.note].map(esc).join(','));
  const csv = '\uFEFF' + [cols.join(','), ...rows].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const d = new Date();
  const name = `UNSC Evidence/UNSC_check_log_${d.toISOString().slice(0, 10)}.csv`;
  chrome.downloads.download({ url, filename: name, saveAs: false });
}

// ---------- wiring ----------
$('refresh').addEventListener('click', doCheck);
$('ackList').addEventListener('click', async () => { state = await send({ type: 'ack', target: 'list' }); render(); });
$('ackPress').addEventListener('click', async () => { state = await send({ type: 'ack', target: 'press' }); render(); });
$('capture').addEventListener('click', captureEvidence);
$('openList').addEventListener('click', () => chrome.tabs.create({ url: LIST_URL }));
$('openPress').addEventListener('click', () => chrome.tabs.create({ url: PRESS_URL }));
$('export').addEventListener('click', exportCsv);
['autoShot', 'shotTime', 'shotOnChange'].forEach((id) => $(id).addEventListener('change', saveShotSettings));
$('interval').addEventListener('change', async (e) => {
  state = await send({ type: 'setInterval', minutes: Number(e.target.value) });
  render();
});

init();
