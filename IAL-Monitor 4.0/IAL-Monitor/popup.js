/* global IAL */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function render() {
  const state = await IAL.load();
  const pending = IAL.pendingUpdates(state);
  const last = state.lastCheck ? new Date(state.lastCheck.at).toLocaleString('en-GB') : 'never';
  $('#status').innerHTML = pending.length
    ? `<strong>${pending.length} update${pending.length > 1 ? 's' : ''} ready.</strong> Open the workspace and click “Download updated master Excel”. Last checked ${esc(last)}.`
    : `No new updates after ${IAL.isoToDmy(state.settings.baseline)}. Last checked ${esc(last)}.`;
  $('#list').innerHTML = pending.map(u =>
    `<li><strong>As at ${IAL.isoToDmy(u.iso)}</strong>: ${u.names.map(esc).join('; ')}</li>`).join('');
}

$('#open').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('app.html') }));
$('#check').addEventListener('click', async () => {
  const b = $('#check'); b.disabled = true; b.textContent = 'Checking…';
  b.textContent = 'Checking…';
  const r = await chrome.runtime.sendMessage({ type: 'check' });
  if (r && r.error) { $('#status').textContent = 'Could not reach the SC website: ' + r.error; }
  b.disabled = false; b.textContent = 'Check SC now';
  render();
});
render();
