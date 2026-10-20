/* global IAL, IALExcel, ExcelJS */
const $ = s => document.querySelector(s);
let state = null;
let masterBuffer = null;
let masterNames = null;

const fmtDateTime = iso => {
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function reload() {
  state = await IAL.load();
  if (state.master && !masterBuffer) {
    try {
      masterBuffer = IAL.b64ToBuf(state.master.b64);
      masterNames = await IALExcel.readMasterNames(ExcelJS, masterBuffer.slice(0));
    } catch (e) { masterBuffer = null; masterNames = null; }
  }
  render();
}

async function rememberMaster(buffer, name) {
  masterBuffer = buffer;
  masterNames = await IALExcel.readMasterNames(ExcelJS, buffer.slice(0));
  state.master = { name, b64: IAL.bufToB64(buffer), savedAt: new Date().toISOString() };
  await IAL.save({ master: state.master });
}

const detailFor = (u, name) => IAL.ensureDetail(state, u, name);

let saveTimer = null;
function saveDetailsSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => IAL.save({ details: state.details }), 300);
}

function render() {
  const pending = IAL.pendingUpdates(state);
  const s = state.settings;

  // status line
  const last = state.lastCheck ? `Last checked <strong>${fmtDateTime(state.lastCheck.at)}</strong>` : 'Not checked yet';
  const pend = pending.length
    ? `<span class="pending">${pending.length} update${pending.length > 1 ? 's' : ''} waiting to be exported</span>`
    : 'Nothing waiting to be exported';
  $('#status').innerHTML = `${last}. ${pend}. Cut-off: updates after ${IAL.isoToDmy(s.baseline)}.`;

  // settings
  $('#set-baseline').value = s.baseline;
  $('#set-by').value = s.checkedBy;
  $('#set-auto').checked = s.autoCheck;
  $('#set-interval').value = String(s.intervalHours);

  // updates
  const box = $('#updates');
  if (!pending.length) {
    box.innerHTML = `<div class="empty">No new Investor Alert List updates after ${IAL.isoToDmy(s.baseline)}. Click “Check SC now” to look again.</div>`;
  } else {
    box.innerHTML = pending.map(u => {
      const rows = u.names.map((name, i) => {
        const d = detailFor(u, name);
        const isDup = masterNames && (masterNames.has(IALExcel.norm(name)) || (d.listName && masterNames.has(IALExcel.norm(d.listName))));
        const tag = d.found === true ? '<span class="tag ok">Filled from SC list</span>'
          : d.found === false ? '<span class="tag miss">Not found on SC list yet, check and type in</span>'
          : '<span class="tag dup">Waiting for details</span>';
        const dup = isDup ? '<span class="tag dup">Already in master file</span>' : '';
        return `<tr class="${d.include ? '' : 'excluded'}" data-iso="${u.iso}" data-i="${i}">
          <td class="inc"><input type="checkbox" data-f="include" ${d.include ? 'checked' : ''} aria-label="Include ${esc(name)}"></td>
          <td class="name">${esc(d.listName || name)}<br>${tag}${dup}</td>
          <td class="small-col"><textarea data-f="identity" rows="2" placeholder="Reg. / IC no.">${esc(d.identity)}</textarea></td>
          <td class="small-col"><textarea data-f="address" rows="2">${esc(d.address)}</textarea></td>
          <td><textarea data-f="website" rows="3">${esc(d.website)}</textarea></td>
          <td><textarea data-f="reasons" rows="3" placeholder="• Reason from SC list">${esc(d.reasons)}</textarea></td>
        </tr>`;
      }).join('');
      return `<div class="update">
        <div class="update-head">
          <h3>Investor Alert List (as at ${IAL.isoToDmy(u.iso)})</h3>
          <a href="${esc(u.url)}" target="_blank" rel="noopener">Open SC announcement</a>
          <span class="hint">${u.names.length} entit${u.names.length === 1 ? 'y' : 'ies'}</span>
          <span class="spacer"></span>
          <button class="small" data-dismiss="${u.iso}">Mark as done without exporting</button>
        </div>
        <div class="tbl-wrap"><table class="entities">
          <thead><tr><th></th><th>Name</th><th>Identity</th><th>Address</th><th>Website URL</th><th>Reasons</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>`;
    }).join('');
  }
  IAL.save({ details: state.details });

  const hasRows = collectEntries().length > 0;
  $('#btn-export-new').disabled = !hasRows;
  $('#btn-export-master').disabled = !hasRows || !masterBuffer;
  $('#btn-grab').disabled = !pending.length;
  $('#master-line').textContent = state.master
    ? `Master file: ${state.master.name} (${masterNames ? masterNames.size : '?'} names). It is updated each time you download, so next time you just click again.`
    : 'No master file yet. Choose it once and it will be remembered.';
  $('#master-pick').textContent = state.master ? 'Use a different master file' : 'Choose master file';
  $('#export-note').textContent = !pending.length
    ? 'Nothing to export: there are no new updates.'
    : !hasRows ? 'Tick at least one entity in step 2 to export.'
    : !masterBuffer ? 'Choose your master file once to enable the one-click master download.' : '';

  // history
  $('#history tbody').innerHTML = state.history.slice(0, 60).map(h =>
    `<tr><td>${fmtDateTime(h.at)}</td><td>${esc(h.by)}</td><td>${esc(h.action)}</td><td>${esc(h.detail)}</td></tr>`).join('')
    || '<tr><td colspan="4" class="hint">No activity yet.</td></tr>';
}

// edits in the review table
$('#updates').addEventListener('input', e => {
  const tr = e.target.closest('tr[data-iso]');
  const f = e.target.dataset.f;
  if (!tr || !f) return;
  const u = state.updates[tr.dataset.iso];
  const d = detailFor(u, u.names[+tr.dataset.i]);
  d[f] = f === 'include' ? e.target.checked : e.target.value;
  if (f === 'include') { tr.classList.toggle('excluded', !d.include); render(); }
  saveDetailsSoon();
});

$('#updates').addEventListener('click', async e => {
  const iso = e.target.dataset.dismiss;
  if (!iso) return;
  if (!confirm(`Mark the update as at ${IAL.isoToDmy(iso)} as done? It will not be exported.`)) return;
  state.processed.push(iso);
  await IAL.save({ processed: state.processed });
  await IAL.log('Marked as done (not exported)', `Update as at ${IAL.isoToDmy(iso)}`);
  chrome.runtime.sendMessage({ type: 'badge' });
  reload();
});

function collectEntries() {
  const out = [];
  for (const u of IAL.pendingUpdates(state)) {
    for (const name of u.names) {
      const d = detailFor(u, name);
      if (!d.include) continue;
      out.push({ iso: u.iso, url: u.url, year: +u.iso.slice(0, 4), name: d.listName || name,
        identity: d.identity.trim(), address: d.address.trim(), website: d.website.trim(), reasons: d.reasons.trim() });
    }
  }
  return out;
}

// ---------- step 1 ----------
$('#btn-check').addEventListener('click', async () => {
  const b = $('#btn-check');
  b.disabled = true; b.textContent = 'Checking SC and filling details…';
  const r = await chrome.runtime.sendMessage({ type: 'check' });
  if (r && r.error) alert('Could not reach the SC website: ' + r.error);
  b.textContent = r && r.newCount ? `Found ${r.newCount} new update${r.newCount > 1 ? 's' : ''}` : 'No new updates';
  if (r && r.fill) $('#grab-note').textContent = `Details filled for ${r.fill.total - r.fill.missing.length} of ${r.fill.total}.` +
    (r.fill.missing.length ? ` Not found: ${r.fill.missing.join('; ')}.` : '') + (r.fill.error ? ` Problem: ${r.fill.error}` : '');
  await reload();
  setTimeout(() => { b.disabled = false; b.textContent = 'Check SC now'; }, 2500);
});

$('#btn-scan-tab').addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ url: 'https://www.sc.com.my/*' });
  if (!tabs.length) { alert('Open the SC media page (sc.com.my/resources/media) in a tab first, then try again.'); return; }
  let links = [];
  for (const t of tabs) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['lib/grabber.js'] });
      const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => ialCollectAnnouncementLinks() });
      links = links.concat(r.result || []);
    } catch (e) { /* tab not ready */ }
  }
  const added = await IAL.addAnnouncementUrls([...new Set(links)]);
  await IAL.log('Read links from SC page', `${links.length} link(s) seen, ${added.length} new update(s)`);
  chrome.runtime.sendMessage({ type: 'badge' });
  alert(added.length ? `Added ${added.length} update(s): ${added.map(a => IAL.isoToDmy(a.iso)).join(', ')}` : `No new updates in the ${links.length} link(s) on the open SC page.`);
  reload();
});

$('#btn-save-settings').addEventListener('click', async () => {
  const s = {
    baseline: $('#set-baseline').value || state.settings.baseline,
    checkedBy: $('#set-by').value.trim(),
    autoCheck: $('#set-auto').checked,
    intervalHours: +$('#set-interval').value
  };
  await IAL.save({ settings: s });
  await IAL.log('Settings changed', `Cut-off ${IAL.isoToDmy(s.baseline)}, auto-check ${s.autoCheck ? 'every ' + s.intervalHours + 'h' : 'off'}`);
  chrome.runtime.sendMessage({ type: 'reschedule' });
  chrome.runtime.sendMessage({ type: 'badge' });
  reload();
});

// ---------- step 2 ----------
$('#btn-grab').addEventListener('click', async () => {
  const note = $('#grab-note'), b = $('#btn-grab');
  b.disabled = true;
  note.textContent = 'Reading the SC Investor Alert List page (a minimised window opens and closes by itself)…';
  // allow retry for names previously not found
  for (const d of Object.values(state.details)) if (d.found === false) d.found = null;
  await IAL.save({ details: state.details });
  const r = await chrome.runtime.sendMessage({ type: 'fill' });
  if (r && r.error) note.textContent = 'Could not read the SC list page: ' + r.error;
  else if (r && r.total) note.textContent = `Filled ${r.total - r.missing.length} of ${r.total}.` + (r.missing.length ? ` Not found: ${r.missing.join('; ')}. SC sometimes adds them to the list later; try again, or type them in.` : '') + (r.error ? ` Problem: ${r.error}` : '');
  else note.textContent = 'All entities already have details.';
  b.disabled = false;
  reload();
});

// ---------- step 3 ----------
function download(buffer, filename) {
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function logRowsFor(entries) {
  const byIso = {};
  entries.forEach(e => { (byIso[e.iso] = byIso[e.iso] || { url: e.url, names: [] }).names.push(e.name); });
  const now = fmtDateTime(new Date().toISOString());
  return Object.entries(byIso).map(([iso, v]) => [now, state.settings.checkedBy, IAL.isoToDmy(iso), v.url, v.names.length, v.names.join('; ')]);
}

async function afterExport(entries, what) {
  const isos = [...new Set(entries.map(e => e.iso))];
  await IAL.log(what, `${entries.length} entit${entries.length === 1 ? 'y' : 'ies'} from update(s) ${isos.map(i => IAL.isoToDmy(i)).join(', ')}`);
  if ($('#mark-done').checked) {
    // updates where every entity was excluded are also closed
    const all = IAL.pendingUpdates(state).map(u => u.iso);
    state.processed.push(...all);
    await IAL.save({ processed: [...new Set(state.processed)] });
  }
  chrome.runtime.sendMessage({ type: 'badge' });
}

const latestIso = entries => entries.map(e => e.iso).sort().pop();

$('#btn-export-new').addEventListener('click', async () => {
  const out = $('#export-result');
  const entries = collectEntries();
  const blanks = entries.filter(e => !e.reasons).length;
  if (blanks && !confirm(`${blanks} entit${blanks === 1 ? 'y has' : 'ies have'} no Reasons filled in. Download anyway?`)) return;
  try {
    const buf = await IALExcel.buildNewEntriesWorkbook(ExcelJS, entries, logRowsFor(entries));
    const file = `Investor_Alert_New_${IAL.isoToDmy(latestIso(entries), '_')}.xlsx`;
    download(buf, file);
    await afterExport(entries, `Downloaded ${file}`);
    out.className = 'result ok';
    out.textContent = `Downloaded ${file} with ${entries.length} new row${entries.length === 1 ? '' : 's'}.`;
    reload();
  } catch (e) { out.className = 'result err'; out.textContent = 'Export failed: ' + e.message; }
});

$('#master-file').addEventListener('change', async e => {
  const f = e.target.files[0];
  const out = $('#export-result');
  if (!f) return;
  try {
    await rememberMaster(await f.arrayBuffer(), f.name);
    await IAL.log('Master file set', f.name);
    out.className = 'result'; out.textContent = `${f.name} saved as your master file (${masterNames.size} names).`;
  } catch (err) {
    out.className = 'result err'; out.textContent = 'Could not read that file: ' + err.message;
  }
  e.target.value = '';
  reload();
});

$('#btn-export-master').addEventListener('click', async () => {
  const out = $('#export-result');
  const entries = collectEntries();
  const blanks = entries.filter(e => !e.reasons).length;
  if (blanks && !confirm(`${blanks} entit${blanks === 1 ? 'y has' : 'ies have'} no Reasons filled in. Continue?`)) return;
  try {
    const r = await IALExcel.appendToMaster(ExcelJS, masterBuffer.slice(0), entries);
    const file = `Investor_Alert_${IAL.isoToDmy(latestIso(entries), '_')}.xlsx`;
    download(r.buffer, file);
    await rememberMaster(r.buffer, file);
    await afterExport(entries, `Added to master, downloaded ${file}`);
    out.className = 'result ok';
    out.textContent = `Downloaded ${file}: ${r.added.length} row${r.added.length === 1 ? '' : 's'} added (rows ${r.firstNewRow}-${r.lastRow})` +
      (r.skipped.length ? `, skipped as already in the file: ${r.skipped.join('; ')}` : '') + '.';
    reload();
  } catch (e) { out.className = 'result err'; out.textContent = 'Could not update the master file: ' + e.message; }
});

chrome.storage.onChanged.addListener(changes => {
  if (changes.fillProgress) {
    const p = changes.fillProgress.newValue;
    $('#grab-note').textContent = p ? `Reading SC list page: ${p.i} of ${p.total} (${p.name})…` : '';
    if (!p) reload();                     // background fill finished
  }
  if (changes.updates || changes.lastCheck) reload();
});

reload();
