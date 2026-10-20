import { CATEGORIES } from './sources.js';
import { getAll, putOne, putMany, deleteOne, getBySource } from './db.js';
import { refreshAll, REASONS, mergeSource } from './crawler.js';
import { readUpload } from './upload.js';
import { closeReaders } from './media.js';
import { BNM_CATEGORIES, RELATIONSHIPS, relationshipGroup, classify } from './bnm.js';
import { searchKey, nameKey, matchPosition } from './extractor.js';
import { loadSettings, saveSettings, effectiveSources, matchesName, fmtDate, staleness, recordRun, getLock, setLock, clearLock, updateLock, DEFAULT_AUTO } from './settings.js';

const $ = s => document.querySelector(s);
// Everything scraped from the web or imported is untrusted: always escape before inserting into the page.
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : '#');

let people = [];
let associates = [];
let runs = [];
let settings;
let lastRunId = '';
let refreshing = false;
let pepByLabel = new Map();

async function load() {
  settings = await loadSettings();
  [people, associates, runs] = await Promise.all([getAll('people'), getAll('associates'), getAll('runs')]);
  for (const p of people) if (!p.bnmCategory) p.bnmCategory = classify(p.position, p.category);
  runs.sort((a, b) => b.id.localeCompare(a.id));
  lastRunId = runs.find(r => !r.partial)?.id || '';
  renderSummary();
  await renderFreshness();
  renderFilters();
  renderPeople();
  renderAssociates();
  renderSources();
  renderUploadTargets();
  renderRuns();
}

// ---------- Freshness ----------
async function renderFreshness() {
  const { lastRun } = await chrome.storage.local.get('lastRun');
  const s = staleness(lastRun, settings);
  const lock = await getLock();
  const el = $('#stale');
  const bg = $('#bg');
  bg.hidden = !(lock && lock.by === 'auto' && !refreshing);
  if (!bg.hidden) {
    const stage = lock.stage === 2 ? 'second pass on sites that need extra work' : 'quick pass';
    $('#bgText').textContent = lock.total
      ? `Background refresh running (${stage}): ${lock.done} of ${lock.total} sources done. The table fills in as sources finish.`
      : 'Background refresh starting…';
  }
  if (lock && !refreshing) {
    el.hidden = true;
  } else if (s.stale) {
    el.hidden = false; el.style.color = '';
    el.textContent = lastRun ? `Out of date: last refreshed ${s.days} days ago. Select Refresh all sources.` : '';
    el.hidden = !lastRun;
  } else el.hidden = true;
  $('#autoRefresh').value = settings.autoRefresh ?? DEFAULT_AUTO;
  $('#useChrome').checked = settings.useChrome ?? true;
  $('#useMedia').checked = settings.useMedia ?? true;
  const alarm = await chrome.alarms.get('auto-refresh');
  $('#autoNext').textContent = alarm ? `Next automatic refresh: ${fmtDate(new Date(alarm.scheduledTime).toISOString())}` : 'Automatic refresh is off.';
}

$('#useMedia').addEventListener('change', async e => {
  settings.useMedia = e.target.checked;
  await saveSettings(settings);
});

$('#useChrome').addEventListener('change', async e => {
  settings.useChrome = e.target.checked;
  await saveSettings(settings);
});

$('#autoRefresh').addEventListener('change', async e => {
  settings.autoRefresh = e.target.value;
  await saveSettings(settings);
  await chrome.runtime.sendMessage({ type: 'settings-changed' });
  setTimeout(renderFreshness, 300);
});

$('#bgStop').addEventListener('click', async () => {
  if (!confirm('Stop the background refresh? People already collected stay in the register.')) return;
  await chrome.runtime.sendMessage({ type: 'stop-auto-refresh' });
  await load();
});

// Reload when a background refresh finishes, and refill the table while it runs.
let lastLiveReload = 0;
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || refreshing) return;
  if (changes.lastRun) { load(); return; }
  if (changes.refreshLock) {
    renderFreshness();
    if (Date.now() - lastLiveReload > 5000) {
      lastLiveReload = Date.now();
      people = await getAll('people');
      renderPeople();
    }
  }
});

// ---------- Summary ----------
function renderSummary() {
  const r = runs.find(x => !x.partial);
  const cur = people.filter(p => p.status === 'active' && !p.excluded).length;
  const former = people.filter(p => p.status === 'not_seen' && !p.excluded).length;
  const base = `${cur.toLocaleString()} current PEPs, ${former.toLocaleString()} former, ${associates.length.toLocaleString()} family members and close associates.`;
  $('#summary').textContent = r
    ? `${base} Last refreshed ${fmtDate(r.finishedAt)}: ${r.totals.added} new, ${r.totals.changed} changed position, ${r.totals.dropped} no longer listed` +
      (r.totals.failed ? `, ${r.totals.failed} sources could not be read.` : '.')
    : 'No refresh yet. Refresh to build the register from the enabled sources.';
}

function renderFilters() {
  const f = $('#fCategory');
  const keep = f.value;
  f.innerHTML = '<option value="">All BNM categories</option>' +
    [...BNM_CATEGORIES, 'Family member of PEP', 'Close associate of PEP'].map(c => `<option>${h(c)}</option>`).join('');
  f.value = keep;
}

// ---------- Unified register rows (PEPs + associates) ----------
function pepRow(p) {
  return {
    kind: 'pep', key: p.key, bareName: p.bareName, titles: p.titles, name: p.name,
    role: p.position, previousPosition: p.previousPosition, organisation: p.organisation, category: p.category,
    bnmCategory: p.bnmCategory, tier: p.tier, confidence: p.confidence, status: p.status, excluded: p.excluded,
    firstSeen: p.firstSeen, lastSeen: p.lastSeen, notSeenSince: p.notSeenSince, sourceUrl: p.sourceUrl, method: p.method || 'page', rec: p
  };
}
function assocRow(a) {
  const pep = people.find(p => p.key === a.pepKey);
  const pepName = pep ? pep.bareName : a.pepName;
  return {
    kind: 'rca', key: a.id, bareName: a.name, titles: '', name: a.name,
    role: `${a.relationship} of ${pepName}${pep ? ` (${pep.position})` : ' (PEP not found in register)'}`,
    organisation: pep?.organisation || '', category: pep?.category || '',
    bnmCategory: a.group === 'Family member' ? 'Family member of PEP' : 'Close associate of PEP',
    tier: 1, confidence: 'high', status: 'associate', excluded: false, pepStatus: pep?.status || 'unlinked',
    firstSeen: a.addedAt, lastSeen: '', sourceUrl: a.evidence, relationship: a.relationship, pepName, evidence: a.evidence, rec: a
  };
}

function filtered() {
  const q = $('#q').value.trim();
  const cat = $('#fCategory').value;
  const st = $('#fStatus').value;
  const tier = $('#fTier').value;
  const rows = [...people.map(pepRow), ...associates.map(assocRow)];
  return rows.filter(r => {
    if (cat && r.bnmCategory !== cat) return false;
    if (tier && String(r.tier) !== tier) return false;
    if (r.kind === 'rca') {
      if (!['pep', 'active', ''].includes(st)) return false;
    } else if (st === 'excluded') { if (!r.excluded) return false; }
    else if (st) {
      if (r.excluded) return false;
      if (st === 'active' && r.status !== 'active') return false;
      if (st === 'not_seen' && r.status !== 'not_seen') return false;
      if (st === 'new' && !(r.status === 'active' && lastRunId && r.firstSeen >= lastRunId)) return false;
      if (st === 'changed' && !(r.status === 'active' && r.previousPosition && lastRunId && r.lastSeen >= lastRunId)) return false;
    }
    return matchesName(r, q);
  }).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'pep' ? -1 : 1) || a.tier - b.tier ||
    (a.organisation || '').localeCompare(b.organisation || '') || a.bareName.localeCompare(b.bareName));
}

function statusBadges(r) {
  if (r.kind === 'rca') {
    return r.pepStatus === 'unlinked' ? '<span class="badge review">PEP not found</span>'
      : r.pepStatus === 'not_seen' ? '<span class="badge">Linked to former PEP</span>'
      : '<span class="badge">Linked to PEP</span>';
  }
  const b = [];
  if (r.excluded) b.push('<span class="badge">Excluded</span>');
  else if (r.status === 'not_seen') b.push(`<span class="badge gone" title="Not listed since ${h(fmtDate(r.notSeenSince))}. Still a PEP under the 'is, or has been' definition.">Former PEP</span>`);
  else if (lastRunId && r.firstSeen >= lastRunId) b.push('<span class="badge new">New</span>');
  else b.push('<span class="badge">Current</span>');
  if (r.previousPosition && r.status === 'active') b.push(`<span class="badge changed" title="Was: ${h(r.previousPosition)}">Position changed</span>`);
  if (r.tier === 2) b.push('<span class="badge review" title="Confirm this role is prominent enough to meet the PEP definition">Review</span>');
  if (r.method === 'image') b.push('<span class="badge review" title="Read from a picture with text recognition. Check the spelling against the source before relying on it.">From picture: check spelling</span>');
  if (r.method === 'pdf') b.push('<span class="badge" title="Read from a PDF or chart file">From PDF</span>');
  if (r.method === 'upload') b.push('<span class="badge" title="From a document you uploaded; kept even if websites change">Uploaded</span>');
  if (r.method === 'manual') b.push('<span class="badge" title="Added by hand; kept even if websites change">Added by hand</span>');
  if (r.confidence === 'low') b.push('<span class="badge review" title="Name has no title or bin/binti; check the source page">Check name</span>');
  return b.join(' ');
}

const MAX_ROWS = 1000;
function renderPeople() {
  const rows = filtered();
  $('#people tbody').innerHTML = rows.slice(0, MAX_ROWS).map(r => `
    <tr class="${r.excluded ? 'excluded' : ''}">
      <td><div class="name">${h(r.bareName)}</div><div class="sub">${h(r.titles)}</div></td>
      <td>${h(r.role)}${r.previousPosition ? `<div class="sub">Previously: ${h(r.previousPosition)}</div>` : ''}</td>
      <td>${h(r.organisation)}${r.sourceUrl && safeUrl(r.sourceUrl) !== '#' ? `<div class="sub"><a href="${h(r.sourceUrl)}" target="_blank" rel="noopener noreferrer">${r.kind === 'rca' ? 'Evidence' : 'Source page'}</a></div>` : r.sourceUrl ? `<div class="sub">${h(r.sourceUrl)}</div>` : ''}</td>
      <td>${h(r.bnmCategory)}</td>
      <td>${statusBadges(r)}</td>
      <td>${h(fmtDate(r.firstSeen))}</td>
      <td>${h(fmtDate(r.lastSeen))}</td>
      <td>${r.kind === 'pep' ? `<button class="row-btn" data-key="${h(r.key)}" type="button">${r.excluded ? 'Restore' : 'Exclude'}</button>` : ''}</td>
    </tr>`).join('');
  const total = rows.length;
  $('#count').textContent = total > MAX_ROWS
    ? `Showing ${MAX_ROWS.toLocaleString()} of ${total.toLocaleString()} records. Narrow the search to see the rest, or export all to CSV.`
    : `${total.toLocaleString()} record${total === 1 ? '' : 's'}`;
  const empty = $('#empty');
  empty.hidden = total > 0;
  empty.textContent = people.length || associates.length
    ? 'No records match. Clear the search or change the filters.'
    : 'The register is empty. Select Refresh all sources to collect office holders from the enabled sources.';
}

$('#people').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-key]');
  if (!btn) return;
  const p = people.find(x => x.key === btn.dataset.key);
  if (!p) return;
  p.excluded = !p.excluded;
  await putOne('people', p);
  renderPeople();
  renderSummary();
});
['#q', '#fCategory', '#fStatus', '#fTier'].forEach(s => $(s).addEventListener('input', renderPeople));

// ---------- CSV ----------
const csvCell = v => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // prevent spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function downloadCsv(filename, header, rows) {
  const csv = [header.map(csvCell).join(','), ...rows.map(r => r.map(csvCell).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

$('#exportBtn').addEventListener('click', () => {
  const cols = [
    ['Name', r => r.bareName], ['Titles', r => r.titles],
    ['PEP type', r => r.kind === 'pep' ? 'Domestic PEP' : r.bnmCategory === 'Family member of PEP' ? 'Family member of domestic PEP' : 'Close associate of domestic PEP'],
    ['BNM category', r => r.bnmCategory],
    ['Position', r => (r.kind === 'pep' ? r.role : '')], ['Previous position', r => r.previousPosition || ''],
    ['Relationship', r => r.relationship || ''], ['Related PEP', r => r.pepName || ''],
    ['Organisation', r => r.organisation], ['Source category', r => r.category],
    ['Role type', r => (r.tier === 1 ? 'Meets definition' : 'Senior role to review')], ['Name confidence', r => r.confidence],
    ['Read from', r => r.kind === 'rca' ? 'Manual entry' : ({ image: 'Picture (text recognition)', pdf: 'PDF / chart file', upload: 'Uploaded document', manual: 'Added by hand' }[r.method] || 'Web page')],
    ['Status', r => r.kind === 'rca' ? (r.pepStatus === 'unlinked' ? 'PEP not found' : 'Associate') : r.excluded ? 'Excluded' : r.status === 'active' ? 'Current PEP' : 'Former PEP'],
    ['First seen / added', r => r.firstSeen], ['Last seen', r => r.lastSeen], ['Not seen since', r => r.notSeenSince || ''],
    ['Source / evidence', r => r.sourceUrl], ['Country', () => 'Malaysia']
  ];
  downloadCsv(`malaysia-pep-register-${new Date().toISOString().slice(0, 10)}.csv`, cols.map(c => c[0]), filtered().map(r => cols.map(c => c[1](r))));
});

// ---------- Family & associates ----------
function renderAssociates() {
  const sel = $('#assocForm select[name=relationship]');
  if (!sel.options.length) {
    sel.innerHTML = '<option value="">Relationship</option>' + Object.entries(RELATIONSHIPS)
      .map(([g, list]) => `<optgroup label="${h(g)}">${list.map(r => `<option>${h(r)}</option>`).join('')}</optgroup>`).join('');
  }
  pepByLabel = new Map();
  const opts = [];
  for (const p of people) {
    if (p.excluded) continue;
    const label = `${p.bareName} | ${p.position} | ${p.organisation}`;
    pepByLabel.set(label, p);
    opts.push(`<option value="${h(label)}"></option>`);
  }
  $('#pepList').innerHTML = opts.join('');

  $('#assocTable tbody').innerHTML = associates.length ? associates
    .slice().sort((a, b) => a.name.localeCompare(b.name))
    .map(a => {
      const pep = people.find(p => p.key === a.pepKey);
      return `<tr>
        <td><div class="name">${h(a.name)}</div>${a.notes ? `<div class="sub">${h(a.notes)}</div>` : ''}</td>
        <td>${h(a.relationship)}<div class="sub">${h(a.group)}</div></td>
        <td>${pep ? `${h(pep.bareName)}<div class="sub">${h(pep.position)}, ${h(pep.organisation)}${pep.status === 'not_seen' ? ' (former)' : ''}</div>`
          : `${h(a.pepName)}<div class="sub"><span class="badge review">PEP not found in register</span></div>`}</td>
        <td>${safeUrl(a.evidence) !== '#' ? `<a href="${h(a.evidence)}" target="_blank" rel="noopener noreferrer">${h(a.evidence)}</a>` : h(a.evidence)}</td>
        <td>${h(fmtDate(a.addedAt))}</td>
        <td><button class="row-btn" data-del="${h(a.id)}" type="button">Remove</button></td>
      </tr>`;
    }).join('')
    : '<tr><td colspan="6" class="muted">No family members or close associates recorded yet. Add one above or import a CSV.</td></tr>';
}

function makeAssociate({ name, relationship, pep, pepName, evidence, notes }) {
  return {
    id: 'rca-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    name: name.trim(), relationship, group: relationshipGroup(relationship),
    pepKey: pep?.key || '', pepName: pep?.bareName || pepName || '',
    evidence: (evidence || '').trim(), notes: (notes || '').trim(), addedAt: new Date().toISOString()
  };
}

$('#assocForm').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const pepLabel = String(fd.get('pep'));
  const pep = pepByLabel.get(pepLabel);
  const rec = makeAssociate({ name: String(fd.get('name')), relationship: String(fd.get('relationship')), pep, pepName: pepLabel.split('|')[0], evidence: String(fd.get('evidence')), notes: String(fd.get('notes')) });
  await putOne('associates', rec);
  associates.push(rec);
  e.target.reset();
  $('#assocMsg').textContent = pep ? `Added ${rec.name} as ${rec.relationship} of ${pep.bareName}.`
    : `Added ${rec.name}. The PEP "${rec.pepName}" is not in the register yet, so the record is marked "PEP not found". Pick a name from the suggestions to link it.`;
  renderAssociates(); renderPeople(); renderSummary();
});

$('#assocTable').addEventListener('click', async e => {
  const id = e.target.dataset?.del;
  if (!id) return;
  const a = associates.find(x => x.id === id);
  if (!a || !confirm(`Remove ${a.name} from the register?`)) return;
  await deleteOne('associates', id);
  associates = associates.filter(x => x.id !== id);
  renderAssociates(); renderPeople(); renderSummary();
});

$('#assocTemplate').addEventListener('click', () => {
  downloadCsv('pep-associates-template.csv', ['name', 'relationship', 'pep_name', 'evidence', 'notes'],
    [['Full name as per NRIC', 'Spouse', 'Name of the PEP as shown in the register', 'https://… or document reference', '']]);
});

function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}

$('#assocFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const rows = parseCsv(await file.text());
  const head = (rows.shift() || []).map(x => x.trim().toLowerCase());
  const col = n => head.indexOf(n);
  if (col('name') < 0 || col('relationship') < 0 || col('pep_name') < 0) {
    $('#assocMsg').textContent = 'Import stopped: the file needs name, relationship and pep_name columns. Download the template to see the layout.';
    e.target.value = ''; return;
  }
  const allRel = Object.values(RELATIONSHIPS).flat();
  const relLookup = new Map(allRel.map(r => [r.toLowerCase(), r]));
  const byName = new Map();
  for (const p of people) {
    if (p.excluded) continue;
    const k = searchKey(p.bareName);
    if (!byName.has(k) || (byName.get(k).status !== 'active' && p.status === 'active')) byName.set(k, p);
  }
  const recs = []; const skipped = []; let linked = 0;
  rows.forEach((r, i) => {
    const name = (r[col('name')] || '').trim();
    const rel = relLookup.get((r[col('relationship')] || '').trim().toLowerCase());
    const pepName = (r[col('pep_name')] || '').trim();
    if (!name || !rel || !pepName) { skipped.push(i + 2); return; }
    const pep = byName.get(searchKey(pepName));
    if (pep) linked++;
    recs.push(makeAssociate({ name, relationship: rel, pep, pepName, evidence: r[col('evidence')] || '', notes: r[col('notes')] || '' }));
  });
  await putMany('associates', recs);
  associates.push(...recs);
  $('#assocMsg').textContent = `Imported ${recs.length} record${recs.length === 1 ? '' : 's'}: ${linked} linked to a PEP, ${recs.length - linked} marked "PEP not found".` +
    (skipped.length ? ` Skipped rows ${skipped.slice(0, 15).join(', ')}${skipped.length > 15 ? '…' : ''}: name, pep_name or a valid relationship was missing.` : '');
  e.target.value = '';
  renderAssociates(); renderPeople(); renderSummary();
});

// ---------- Refresh ----------
async function startRefresh() {
  if (refreshing) return;
  const lock = await getLock();
  if (lock) {
    alert(lock.by === 'auto'
      ? 'An automatic refresh is already running in the background. The register will update when it finishes.'
      : 'A refresh is already running in another tab.');
    return;
  }
  settings = await loadSettings();
  const sources = effectiveSources(settings).filter(s => s.enabled);
  if (!sources.length) { alert('No sources are switched on. Turn some on in the Sources tab.'); return; }
  refreshing = true;
  await setLock('manual');
  const btn = $('#refreshBtn');
  btn.disabled = true;
  btn.textContent = 'Refreshing…';
  $('#progress').hidden = false;
  $('#ledger').innerHTML = sources.map(s => `<li id="lg-${h(s.id)}"><span class="src">${h(s.name)}</span><span class="state">Waiting</span></li>`).join('');
  $('#progressText').textContent = `Reading ${sources.length} sources. Keep this tab open.`;
  $('#progressCount').textContent = `0 of ${sources.length}`;
  $('#barFill').style.width = '0%';

  const labels = { fetching: 'Reading…', empty: 'Nothing recognised', failed: 'Could not read', deep: 'Second pass later' };
  let lastBeat = 0;
  const run = await refreshAll(sources, ev => {
    const li = document.getElementById('lg-' + ev.id);
    if (li) {
      const st = li.querySelector('.state');
      st.className = 'state ' + ev.state;
      st.textContent = ev.state === 'ok' ? `${ev.found} found${ev.added ? `, ${ev.added} new` : ''}` : (REASONS[ev.reason]?.label || labels[ev.state]);
      if (ev.message) st.title = ev.message;
    }
    if (ev.stage === 2 && ev.deepTotal != null) {
      $('#progressText').textContent = ev.deepTotal
        ? `Quick pass done. Second pass on ${ev.deepTotal} sites that need extra work (opening in Chrome, reading org charts)…`
        : 'Quick pass done.';
    }
    if (ev.done != null && Date.now() - lastBeat > 3000) { lastBeat = Date.now(); updateLock({ done: ev.done, total: ev.total, stage: ev.stage }); }
    if (ev.done) {
      $('#progressCount').textContent = `${ev.done} of ${ev.total}`;
      $('#barFill').style.width = Math.round((ev.done / ev.total) * 100) + '%';
    }
  }, { useChrome: settings.useChrome ?? true, useMedia: settings.useMedia ?? true });
  await recordRun(run);
  await clearLock();
  chrome.runtime.sendMessage({ type: 'run-recorded' }).catch(() => {});
  const t = run.totals;
  $('#progressText').textContent =
    `Refresh finished: ${t.found} people found, ${t.added} new, ${t.changed} changed, ${t.dropped} no longer listed. ` +
    `${t.ok} sources read, ${t.empty} returned nothing, ${t.failed} could not be read.`;
  btn.disabled = false;
  btn.textContent = 'Refresh all sources';
  refreshing = false;
  await load();
}
$('#refreshBtn').addEventListener('click', startRefresh);
window.addEventListener('beforeunload', e => { if (refreshing) { e.preventDefault(); e.returnValue = ''; } });

// ---------- Sources tab ----------
function lastResultFor(id) {
  let r = null;
  for (const run of runs) { r = run.sources.find(s => s.id === id); if (r) break; }
  if (!r) return '<span class="state">Not read yet</span>';
  if (r.state === 'ok') {
    const notes = [r.usedChrome && 'read in Chrome', r.usedMedia && `${r.usedMedia} chart file${r.usedMedia === 1 ? '' : 's'} read`, r.pages?.some(p => String(p.via).endsWith('directory')) && 'staff directory checked'].filter(Boolean);
    return `<span class="state ok">${h(r.found)} found</span>${notes.length ? `<div class="sub">${h(notes.join(', '))}</div>` : ''}`;
  }
  const reason = REASONS[r.reason] || REASONS[r.state === 'empty' ? 'empty' : 'connection'];
  return `<span class="state ${h(r.state)}">${h(reason.label)}</span><div class="sub reason">${h(reason.help)}</div>`;
}

// What a link gave in the latest read of its source: "3 found", "Page not found"...
function linkResult(sourceId, url) {
  let r = null;
  for (const run of runs) { r = run.sources.find(s => s.id === sourceId); if (r) break; }
  if (!r) return '';
  const norm = u => String(u || '').replace(/^https?:\/\/(www\.)?/i, '').replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();
  const page = (r.pages || []).find(p => norm(p.url) === norm(url));
  if (page) return page.found ? `<span class="res ok">${h(page.found)} found</span>` : '<span class="res none">read, nobody found</span>';
  const err = (r.errors || []).find(e => norm(e.url) === norm(url));
  if (err) return `<span class="res bad" title="${h(err.error)}">${h((REASONS[err.kind] || {}).label || 'Could not read')}</span>`;
  return '<span class="res">not read (enough people found)</span>';
}

function renderSources() {
  const list = effectiveSources(settings);
  $('#sources tbody').innerHTML = list.map(s => `
    <tr>
      <td><input type="checkbox" data-toggle="${h(s.id)}" ${s.enabled ? 'checked' : ''} aria-label="Include ${h(s.name)}"></td>
      <td><div class="name">${h(s.name)}</div><div class="sub">${h(s.category)}
          ${s.custom ? ` <button class="row-btn" data-remove="${h(s.id)}" type="button">Remove source</button>` : ''}</div>
        <ul class="links">
          <li><span class="lbl">Link 1<br>main site</span>
            <span><a href="${h(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${h(s.url)}</a>${linkResult(s.id, s.url)}</span>
            <span class="btns"><button class="row-btn" data-edit="${h(s.id)}" type="button">Change</button>
              ${!s.custom && s.url !== s.defaultUrl ? `<button class="row-btn" data-reset="${h(s.id)}" type="button">Use original</button>` : ''}</span></li>
          ${s.pinnedUrls.map((u, k) => `
          <li><span class="lbl">Link ${k + 2}</span>
            <span><a href="${h(safeUrl(u))}" target="_blank" rel="noopener noreferrer">${h(u)}</a>${linkResult(s.id, u)}</span>
            <span class="btns"><button class="row-btn" data-editx="${h(s.id)}" data-k="${k}" type="button">Change</button>
              <button class="row-btn" data-delx="${h(s.id)}" data-k="${k}" type="button">Remove</button></span></li>`).join('')}
        </ul>
        <button class="row-btn add-link" data-add="${h(s.id)}" type="button">+ Add another link</button>
        <button class="row-btn add-link" data-clear="${h(s.id)}" type="button">Clear website records</button></td>
      <td>${lastResultFor(s.id)}<div><button class="row-btn read-btn" data-read="${h(s.id)}" type="button">Read this source now</button></div>
        <div class="read-msg" id="msg-${h(s.id)}">${s.pinnedUrls.length ? `Reads all ${s.pinnedUrls.length + 1} links` : ''}</div></td>
    </tr>`).join('');
  $('#addSource select[name=category]').innerHTML = CATEGORIES.map(c => `<option>${h(c)}</option>`).join('');
}

// Ask for a link, check it, and get permission to read its site.
async function askLink(title, current = '') {
  const input = prompt(title, current);
  if (input == null || !input.trim()) return null;
  let url;
  try { url = new URL(input.trim()); if (!/^https?:$/.test(url.protocol)) throw 0; } catch { alert('Enter a full web address starting with https://'); return null; }
  const granted = await chrome.permissions.request({ origins: [url.origin + '/*'] }).catch(() => false);
  if (!granted) { alert(`The extension needs permission to read ${url.origin}.`); return null; }
  return url.href;
}

async function saveExtraLinks(id, urls) {
  (settings.overrides[id] ||= {}).pinnedUrls = [...new Set(urls)];
  await saveSettings(settings);
  renderSources();
}

$('#sources').addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.toggle) {
    (settings.overrides[t.dataset.toggle] ||= {}).enabled = t.checked;
    await saveSettings(settings);
  }
  if (t.dataset.pin) {
    const urls = t.value.split(/\s+/).map(u => u.trim()).filter(u => /^https?:\/\//i.test(u));
    const origins = [...new Set(urls.map(u => new URL(u).origin + '/*'))];
    if (origins.length) { try { await chrome.permissions.request({ origins }); } catch { /* covered or dismissed */ } }
    (settings.overrides[t.dataset.pin] ||= {}).pinnedUrls = urls;
    await saveSettings(settings);
    t.value = urls.join('\n');
    const note = document.getElementById('note-' + t.dataset.pin);
    if (note) { note.className = 'link-note saved'; note.textContent = urls.length ? `Saved: ${urls.length} extra link${urls.length === 1 ? '' : 's'}. Use Read this source now to test.` : 'Saved: no extra links.'; }
  }
});

$('#sources').addEventListener('click', async e => {
  const ds = e.target.dataset || {};
  if (ds.edit) return changeMainLink(ds.edit);
  if (ds.reset) {
    delete (settings.overrides[ds.reset] ||= {}).url;
    await saveSettings(settings); renderSources(); return;
  }
  if (ds.read) return readOne(ds.read, e.target);
  if (ds.clear) {
    const src = effectiveSources(settings).find(x => x.id === ds.clear);
    const recs = (await getBySource(ds.clear)).filter(p => p.method !== 'upload' && p.method !== 'manual');
    if (!recs.length) { alert(`There are no website records for ${src.name}.`); return; }
    if (!confirm(`Delete the ${recs.length} records collected from ${src.name}'s websites?\n\nPeople you uploaded or added by hand stay. The next refresh or "Read this source now" collects them again from its links.`)) return;
    for (const p of recs) await deleteOne('people', p.key);
    await load();
    return;
  }
  if (ds.add) {
    const src = effectiveSources(settings).find(x => x.id === ds.add);
    const url = await askLink(`Add a link for ${src.name}.\nPaste the page that lists the leaders (or an org chart PDF / picture):`);
    if (url) await saveExtraLinks(ds.add, [...src.pinnedUrls, url]);
    return;
  }
  if (ds.editx) {
    const src = effectiveSources(settings).find(x => x.id === ds.editx);
    const k = Number(ds.k);
    const url = await askLink(`Change link ${k + 2} for ${src.name}:`, src.pinnedUrls[k]);
    if (url) { const list = [...src.pinnedUrls]; list[k] = url; await saveExtraLinks(ds.editx, list); }
    return;
  }
  if (ds.delx) {
    const src = effectiveSources(settings).find(x => x.id === ds.delx);
    const k = Number(ds.k);
    if (!confirm(`Remove this link from ${src.name}?\n${src.pinnedUrls[k]}`)) return;
    await saveExtraLinks(ds.delx, src.pinnedUrls.filter((_, n) => n !== k));
    return;
  }
  const id = ds.remove;
  if (!id) return;
  settings.custom = settings.custom.filter(s => s.id !== id);
  delete settings.overrides[id];
  await saveSettings(settings);
  renderSources();
});

$('#addSource').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const url = String(fd.get('url')).trim();
  let origin;
  try { origin = new URL(url).origin; } catch { alert('Enter a full web address starting with https://'); return; }
  const granted = await chrome.permissions.request({ origins: [origin + '/*'] }).catch(() => false);
  if (!granted) { alert(`The extension needs permission to read ${origin} before it can use it as a source.`); return; }
  settings.custom.push({ id: 'custom-' + Date.now(), name: String(fd.get('name')).trim(), category: String(fd.get('category')), url, custom: true });
  await saveSettings(settings);
  e.target.reset();
  renderSources();
});

// Change a source's main website address.
async function changeMainLink(id) {
  const src = effectiveSources(settings).find(s => s.id === id);
  if (!src) return;
  const input = prompt(`Main website address for ${src.name}:`, src.url);
  if (input == null) return;
  let url;
  try { url = new URL(input.trim()); if (!/^https?:$/.test(url.protocol)) throw 0; } catch { alert('Enter a full web address starting with https://'); return; }
  // Ask for permission to read a site the extension is not already allowed to read.
  const granted = await chrome.permissions.request({ origins: [url.origin + '/*'] }).catch(() => false);
  if (!granted) { alert(`The extension needs permission to read ${url.origin}.`); return; }
  if (src.custom) {
    const c = settings.custom.find(x => x.id === id);
    if (c) c.url = url.href;
  } else {
    const o = (settings.overrides[id] ||= {});
    if (url.href === src.defaultUrl) delete o.url; else o.url = url.href;
  }
  await saveSettings(settings);
  renderSources();
}

// Read one source now, without refreshing all of them.
async function readOne(id, btn) {
  if (refreshing) return;
  const lock = await getLock();
  if (lock) { alert(lock.by === 'auto' ? 'A background refresh is running. Wait for it to finish, or stop it first.' : 'A refresh is already running.'); return; }
  settings = await loadSettings();
  const src = effectiveSources(settings).find(s => s.id === id);
  if (!src) return;
  const msg = document.getElementById('msg-' + id);
  refreshing = true;
  await setLock('manual');
  btn.disabled = true; btn.textContent = 'Reading…';
  if (msg) msg.textContent = 'Reading the extra links and website. This can take up to a minute.';
  let row;
  try {
    const run = await refreshAll([src], ev => {
      if (ev.stage === 2 && ev.deepTotal && msg) msg.textContent = 'Few people found so far: trying Chrome and org chart files…';
    }, { useChrome: settings.useChrome ?? true, useMedia: settings.useMedia ?? true, partial: true });
    row = run.sources[0];
  } catch (e) {
    row = { state: 'failed', message: e.message, found: 0 };
  } finally {
    await clearLock();
    refreshing = false;
  }
  await load();
  const m = document.getElementById('msg-' + id);
  if (m) {
    m.style.color = row?.state === 'ok' ? 'var(--ok)' : 'var(--warn)';
    m.textContent = row?.state === 'ok'
      ? `Done: ${row.found} people found (${row.added} new, ${row.changed} changed). They are in the Register tab.`
      : `Done: ${row?.message || 'nothing found'}`;
  }
}

// ---------- Upload documents ----------
const UPLOAD_SOURCE = { id: 'uploads', name: 'Uploaded documents', category: 'Uploaded document' };
let upRows = [];
let upFiles = [];

function renderUploadTargets() {
  const sel = $('#upSource');
  const keep = sel.value;
  sel.innerHTML = `<option value="uploads">Uploaded documents (general)</option>` +
    effectiveSources(settings).map(s => `<option value="${h(s.id)}">${h(s.name)}</option>`).join('');
  if (keep) sel.value = keep;
}
const targetSource = id => id === 'uploads' ? UPLOAD_SOURCE : effectiveSources(settings).find(s => s.id === id) || UPLOAD_SOURCE;

async function handleFiles(files) {
  files = [...files];
  if (!files.length) return;
  $('#upPreview').hidden = true;
  upRows = []; upFiles = files.map(f => f.name);
  const msg = $('#upMsg');
  const notes = [];
  for (const [i, f] of files.entries()) {
    msg.style.color = 'var(--accent)';
    msg.textContent = `Reading ${f.name} (${i + 1} of ${files.length})… Pictures and scanned PDFs can take up to a minute each.`;
    try {
      const r = await readUpload(f);
      for (const p of r.people) upRows.push({ ...p, sel: true, file: f.name });
      notes.push(`${f.name}: ${r.people.length} found. ${r.note}`);
    } catch (e) {
      notes.push(`${f.name}: could not be read. ${e.message}`);
    }
  }
  await closeReaders();
  msg.style.color = '';
  msg.textContent = notes.join('  ');
  renderUploadPreview();
}

function renderUploadPreview() {
  const box = $('#upPreview');
  box.hidden = !upRows.length;
  if (!upRows.length) return;
  $('#upTable tbody').innerHTML = upRows.map((r, i) => `
    <tr class="${r.sel ? '' : 'off'}">
      <td class="chk"><input type="checkbox" data-i="${i}" data-f="sel" ${r.sel ? 'checked' : ''} aria-label="Save this person"></td>
      <td><input type="text" data-i="${i}" data-f="bareName" value="${h(r.bareName)}" aria-label="Name"></td>
      <td><input type="text" data-i="${i}" data-f="titles" value="${h(r.titles)}" aria-label="Titles"></td>
      <td><input type="text" data-i="${i}" data-f="position" value="${h(r.position)}" aria-label="Position"></td>
      <td><input type="text" data-i="${i}" data-f="organisation" value="${h(r.organisation)}" aria-label="Organisation"></td>
      <td><div class="sub">${h(r.file)}</div>${r.ocr ? '<span class="badge review">Check spelling</span>' : ''}${r.confidence === 'low' ? '<span class="badge review">Check name</span>' : ''}</td>
    </tr>`).join('');
  updateUpCount();
}
function updateUpCount() {
  const n = upRows.filter(r => r.sel).length;
  $('#upCount').textContent = `${n} of ${upRows.length} selected`;
  $('#upSave').textContent = `Save ${n} selected to register`;
  $('#upSave').disabled = !n;
}

$('#upTable').addEventListener('input', e => {
  const t = e.target; const i = Number(t.dataset.i); const f = t.dataset.f;
  if (!f || !upRows[i]) return;
  if (f === 'sel') { upRows[i].sel = t.checked; t.closest('tr').className = t.checked ? '' : 'off'; updateUpCount(); }
  else upRows[i][f] = t.value;
});
$('#upAll').addEventListener('click', () => { upRows.forEach(r => { r.sel = true; }); renderUploadPreview(); });
$('#upNone').addEventListener('click', () => { upRows.forEach(r => { r.sel = false; }); renderUploadPreview(); });
$('#upDiscard').addEventListener('click', () => { upRows = []; renderUploadPreview(); $('#upMsg').textContent = ''; $('#upFile').value = ''; });

// Save people (from an upload or added by hand) under a source, as one entry in the Refresh log.
async function saveUserPeople(rows, srcId, method, label) {
  const src = targetSource(srcId);
  const runAt = new Date().toISOString();
  const found = rows.map(r => {
    const bare = String(r.bareName || '').trim();
    const position = String(r.position || '').trim() || 'Position not stated in document';
    return {
      key: nameKey(bare), name: [r.titles, bare].filter(Boolean).join(' '), bareName: bare, titles: String(r.titles || '').trim(),
      position, organisation: String(r.organisation || '').trim(), tier: matchPosition(position)?.tier ?? 1,
      confidence: 'high', url: method === 'manual' ? 'Added by hand' : `Uploaded file: ${r.file}`, method
    };
  }).filter(p => p.key && p.key.split(' ').length >= 1 && p.bareName.length > 2);
  const m = await mergeSource(src, { people: found }, runAt, { keepOthers: true });
  await putOne('runs', {
    id: runAt, partial: true, upload: true, fileName: label, startedAt: runAt, finishedAt: runAt,
    sources: [{ id: src.id, name: src.name, state: 'ok', found: found.length, ...m, pages: [{ url: label, found: found.length, via: method }], errors: [], message: `${found.length} people saved from ${label}` }],
    totals: { found: found.length, added: m.added, changed: m.changed, dropped: 0, ok: 1, empty: 0, failed: 0 }
  });
  return { ...m, count: found.length, src };
}

$('#upSave').addEventListener('click', async () => {
  const rows = upRows.filter(r => r.sel && String(r.bareName).trim());
  if (!rows.length) return;
  const label = upFiles.length === 1 ? upFiles[0] : `${upFiles.length} files`;
  const r = await saveUserPeople(rows, $('#upSource').value, 'upload', label);
  upRows = []; renderUploadPreview(); $('#upFile').value = '';
  $('#upMsg').style.color = 'var(--ok)';
  $('#upMsg').textContent = `Saved ${r.count} people under ${r.src.name}: ${r.added} new, ${r.changed} updated. They are in the Register tab, marked "Uploaded".`;
  await load();
});

$('#manualForm').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const stripped = String(fd.get('name')).trim();
  const r = await saveUserPeople([{ bareName: stripped, titles: String(fd.get('titles')), position: String(fd.get('position')), organisation: String(fd.get('organisation')), file: '' }],
    $('#upSource').value, 'manual', 'Added by hand');
  e.target.reset();
  $('#manualMsg').style.color = 'var(--ok)';
  $('#manualMsg').textContent = `Added ${stripped} under ${r.src.name}.`;
  await load();
});

$('#upTemplate').addEventListener('click', () => {
  downloadCsv('pep-upload-template.csv', ['Nama / Name', 'Gelaran / Titles', 'Jawatan / Position', 'Organisasi / Organisation'],
    [['Ahmad bin Hamid', "YB Dato'", 'Timbalan Menteri Kewangan', 'Kementerian Kewangan']]);
});

$('#upFile').addEventListener('change', e => handleFiles(e.target.files));
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => handleFiles(e.dataTransfer.files));

// ---------- Refresh log ----------
function renderRuns() {
  $('#runs').innerHTML = runs.length ? runs.map(r => {
    const t = r.totals;
    const problems = r.sources.filter(s => s.state !== 'ok');
    return `<li>
      <strong>${h(fmtDate(r.startedAt))}</strong>${r.upload ? ` <span class="badge">Upload: ${h(r.fileName || '')}</span>` : r.partial ? ` <span class="badge">Single source: ${h(r.sources[0]?.name || '')}</span>` : ''}
      <div class="muted">${t.found} people found, ${t.added} new, ${t.changed} changed, ${t.dropped} no longer listed. ${t.ok} sources read, ${t.empty} empty, ${t.failed} failed.</div>
      <details><summary>Per-source detail</summary>
        <table><thead><tr><th>Source</th><th>Result</th><th>Pages read</th><th>Detail</th></tr></thead><tbody>
        ${r.sources.map(s => `<tr><td>${h(s.name)}</td><td><span class="state ${h(s.state)}">${h(s.state)}</span></td>
          <td>${s.pages.map(p => `<div><a href="${h(safeUrl(p.url))}" target="_blank" rel="noopener noreferrer">${h(p.url)}</a> (${p.found})</div>`).join('')}</td>
          <td>${h(s.message)}${s.errors.length ? `<div class="sub">${s.errors.map(x => h((x.url ? x.url + ': ' : '') + x.error)).join('<br>')}</div>` : ''}</td></tr>`).join('')}
        </tbody></table>
      </details>
      ${problems.length ? `<div class="sub">${problems.length} source${problems.length === 1 ? '' : 's'} need attention: ${h(problems.map(p => p.name).join(', '))}</div>` : ''}
    </li>`;
  }).join('') : '<li class="muted">No refreshes yet.</li>';
}

// ---------- Tabs ----------
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
  document.querySelectorAll('.tab').forEach(t => { t.hidden = t.id !== 'tab-' + b.dataset.tab; });
}));

// ---------- Start ----------
await load();
const hash = decodeURIComponent(location.hash.slice(1));
if (hash === 'refresh') { history.replaceState(null, '', location.pathname); startRefresh(); }
else if (hash.startsWith('q=')) { $('#q').value = hash.slice(2); $('#fStatus').value = ''; renderPeople(); }
