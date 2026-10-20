/* app.js — AGC third-party notice checker */
'use strict';

const LISTING_URL = 'https://lom.agc.gov.my/subsid.php?type=pub';

// Values written into the workbooks. They match the existing rows in the KAF files exactly
// (including the trailing space and non-breaking spaces). Edit here if the house format changes.
const CONFIG = {
  notSpecified: 'Not Specified ',
  basis: 'Notice to Third Parties published by the\u00a0AGC\u00a0Federal Legislation ',
  remarksUrl: LISTING_URL,
  ibl: { sheet: 'Sheet1', nameCol: 'B', dateCol: 'F' },
  agc: { listSheet: 'Sheet1', detailSheet: 'Sheet2', nameCol: 'B', dateCol: 'C' },
};

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');

const $ = (id) => document.getElementById(id);
const state = {
  masters: { ibl: null, agc: null },   // { fileName, data:ArrayBuffer, keys:Set, lastNo, lastIso, count }
  notices: [],                          // listing rows + extraction results
  processed: {},
};

/* ---------------- IndexedDB (master workbooks survive between sessions) ---------------- */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('agc-ibl', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((res, rej) => {
    const q = db.transaction('kv').objectStore('kv').get(key);
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
}
async function idbSet(key, val) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(val, key);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}

/* ---------------- helpers ---------------- */
const fmtDMY = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const isoFromSerial = (serial) => {
  const d = new Date(Date.UTC(1899, 11, 30) + Number(serial) * 86400000);
  return d.toISOString().slice(0, 10);
};
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function progress(msg, isError) {
  const p = $('progress');
  p.textContent = msg || '';
  p.classList.toggle('error', !!isError);
}
function el(tag, attrs = {}, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  if (text !== undefined) e.textContent = text;
  return e;
}

/* ---------------- master workbooks ---------------- */
async function loadMaster(kind, fileName, data, persist, path = '') {
  const cfg = CONFIG[kind];
  const sheet = kind === 'ibl' ? cfg.sheet : cfg.listSheet;
  const names = await XlsxAppend.readNames(JSZip, data, sheet, cfg.nameCol);
  const dates = await XlsxAppend.readNames(JSZip, data, sheet, cfg.dateCol);
  const serials = dates.values.map((v) => Number(v.value)).filter((n) => n > 30000 && n < 80000);
  const lastIso = serials.length ? isoFromSerial(Math.max(...serials)) : '';
  const keys = new Set(names.values.map((v) => AgcParser.normKey(v.value)));
  // AGC master: also index the detail sheet so either list catches duplicates
  state.masters[kind] = { fileName, path, data, keys, lastNo: names.lastNo, lastIso, count: names.values.length };
  if (persist) await idbSet('master-' + kind, { fileName, data, savedAt: new Date().toISOString() });
  renderMasters();
}

function renderMasters() {
  for (const kind of ['ibl', 'agc']) {
    const m = state.masters[kind];
    const box = $('master-' + kind);
    box.classList.toggle('loaded', !!m);
    $(kind + '-state').textContent = m ? 'Ready' : 'Not loaded';
    if (m) {
      $(kind + '-meta').textContent =
        `${m.path ? m.path.replace(/\//g, ' › ') : ''}${m.fileName} — ${m.count.toLocaleString()} names, last No. ${m.lastNo}` + (m.lastIso ? `, latest entry ${fmtDMY(m.lastIso)}` : '');
    }
  }
  setDefaultSince();
}

// "From" date = the newest of: last run, latest date in the workbooks. Nothing yet → last 30 days.
function setDefaultSince() {
  const since = $('since-date');
  if (since.dataset.touched) return;
  const cands = [state.cursorIso, state.masters.ibl && state.masters.ibl.lastIso, state.masters.agc && state.masters.agc.lastIso].filter(Boolean).sort();
  if (cands.length) { since.value = cands.pop(); return; }
  const d = new Date(); d.setDate(d.getDate() - 30);
  since.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function wireMasterInput(kind) {
  const input = $(kind + '-file');
  const box = $('master-' + kind);
  const handle = async (file) => {
    if (!file) return;
    try {
      progress(`Reading ${file.name}…`);
      await loadMaster(kind, file.name, await file.arrayBuffer(), true);
      progress(`${file.name} loaded.`);
      refreshAll();
    } catch (e) {
      progress(`Could not read ${file.name}: ${e.message}`, true);
    }
  };
  input.addEventListener('change', () => handle(input.files[0]));
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('drag'); });
  box.addEventListener('dragleave', () => box.classList.remove('drag'));
  box.addEventListener('drop', (e) => { e.preventDefault(); box.classList.remove('drag'); handle(e.dataTransfer.files[0]); });
}

/* ---------------- AGC listing ---------------- */
async function fetchListingDoc() {
  const res = await fetch(LISTING_URL, { credentials: 'include' });
  if (!res.ok) throw new Error(`AGC site returned HTTP ${res.status}`);
  return new DOMParser().parseFromString(await res.text(), 'text/html');
}

// Fallback for when the table is filled in by JavaScript: open the page in a background tab and read the rendered DOM
async function renderedListingDoc() {
  const tab = await chrome.tabs.create({ url: LISTING_URL, active: false });
  try {
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 25000);
      chrome.tabs.onUpdated.addListener(function l(id, info) {
        if (id === tab.id && info.status === 'complete') { clearTimeout(t); chrome.tabs.onUpdated.removeListener(l); resolve(); }
      });
    });
    await new Promise((r) => setTimeout(r, 2500));
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => document.documentElement.outerHTML });
    return new DOMParser().parseFromString(result, 'text/html');
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function fetchPdf(urls) {
  let lastErr;
  for (const url of urls) {
    try {
      let target = url;
      for (let hop = 0; hop < 3; hop++) {
        const res = await fetch(target, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const head = new TextDecoder('latin1').decode(buf.slice(0, 1024));
        if (head.includes('%PDF')) return { data: buf, url: res.url || target };
        // Not a PDF: probably a viewer page. Look for the real file inside it.
        const html = new TextDecoder().decode(buf);
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const cand = [
          ...[...doc.querySelectorAll('iframe[src], embed[src], object[data], a[href]')]
            .map((n) => n.getAttribute('src') || n.getAttribute('data') || n.getAttribute('href'))
            .filter((u) => u && /\.pdf|processFile|download/i.test(u)),
          ...(html.match(/https?:[^"'\s<>]+\.pdf/gi) || []),
          ...((html.match(/url=([^"'>\s]+)/i) || []).slice(1)),
        ];
        if (!cand.length) throw new Error('link did not return a PDF');
        target = new URL(cand[0], res.url || target).href;
      }
      throw new Error('too many redirects to reach the PDF');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('no PDF link found in this row');
}

/* ---------------- main check ---------------- */
async function runCheck() {
  const btn = $('check-btn');
  btn.disabled = true;
  try {
    progress('Reading the AGC listing…');
    let doc = await fetchListingDoc();
    let found = AgcParser.parseListing(doc, LISTING_URL);
    if (!found.length) {
      progress('Listing loads by script — opening it in a background tab…');
      doc = await renderedListingDoc();
      found = AgcParser.parseListing(doc, LISTING_URL);
    }
    await chrome.storage.local.set({ lastManualCheck: new Date().toISOString() });
    if (!found.length) {
      state.notices = [];
      renderResults();
      progress('No Act 613 third-party notices on the listing right now. If you can see one on the site, use “Add a notice PDF manually”.');
      return;
    }

    const since = $('since-date').value || todayIso();
    const keep = new Map(state.notices.filter((n) => n.manual).map((n) => [n.puKey, n]));
    state.notices = [...found.map((n) => ({ ...n, status: 'idle' })), ...keep.values()];

    const toExtract = state.notices.filter((n) => !n.manual && !state.processed[n.puKey] && n.iso && n.iso >= since);
    renderResults();
    let i = 0;
    for (const n of toExtract) {
      i++;
      progress(`Opening PDF ${i} of ${toExtract.length} — ${n.pu} (${n.date})…`);
      await extractNotice(n);
    }
    const newCount = allParties().filter((p) => p.checked).length;
    progress(toExtract.length
      ? `Checked ${found.length} notice(s) on the listing. ${toExtract.length} dated from ${fmtDMY(since)} were read; ${newCount} name(s) are new.`
      : `Checked ${found.length} notice(s) on the listing. Nothing new dated from ${fmtDMY(since)}.`);
    chrome.runtime.sendMessage({ type: 'refresh-badge' }).catch(() => {});
    const attention = state.notices.filter((n) => n.status === 'error' || (n.parsed && n.parsed.mismatch));
    if ($('auto-update').checked && state.masters.ibl && state.masters.agc) {
      // Only notices that read cleanly are added automatically; anything doubtful waits for review
      for (const n of attention) for (const p of n.parties || []) p.checked = false;
      if (allParties().some((p) => p.checked && p.name)) await generate();
      if (attention.length) {
        const p = $('progress');
        p.textContent += ` ${attention.length} notice(s) need a manual look: ${attention.map((n) => n.pu).join(', ')}.`;
        p.classList.add('error');
      }
      renderResults();
    } else if (allParties().some((p) => p.checked) && (!state.masters.ibl || !state.masters.agc)) {
      progress(`${allParties().length} name(s) found. Load or link the two workbooks (top of the page) to compare them and add the new ones.`);
    }
  } catch (e) {
    progress(`Check failed: ${e.message}. Make sure you can open lom.agc.gov.my in this browser.`, true);
  } finally {
    btn.disabled = false;
  }
}

async function extractNotice(n, pdfData) {
  n.status = 'working';
  renderResults();
  try {
    let data = pdfData;
    if (!data) {
      if (!n.pdfUrl) throw new Error('no PDF link found in this row');
      data = (await fetchPdf([n.pdfUrl, ...(n.pdfCandidates || []).filter((u) => u !== n.pdfUrl)])).data;
    }
    n.pdfData = data.slice(0);   // pdf.js takes ownership of the buffer it reads
    const { text } = await PdfText.extractPdfText(pdfjsLib, new Uint8Array(data));
    if (text.replace(/\s/g, '').length < 50) throw new Error('the PDF has no readable text (it may be a scanned image) — key the names in manually');
    const parsed = AgcParser.parseNoticeText(text);
    if (!parsed.parties.length) throw new Error('could not find the “terhadap … supaya hadir” sentence in the PDF');
    n.parsed = parsed;
    n.parties = parsed.parties.map((p) => {
      const key = AgcParser.normKey(p.name);
      const inIbl = !!(state.masters.ibl && state.masters.ibl.keys.has(key));
      const inAgc = !!(state.masters.agc && state.masters.agc.keys.has(key));
      return { ...p, key, inIbl, inAgc, checked: !(inIbl && inAgc) };
    });
    n.status = 'done';
  } catch (e) {
    n.status = 'error';
    n.error = e.message;
  }
  renderResults();
}

/* ---------------- rendering ---------------- */
function allParties() {
  return state.notices.flatMap((n) => (n.parties || []).map((p) => Object.assign(p, { notice: n })));
}

function renderResults() {
  const box = $('results');
  box.textContent = '';
  if (!state.notices.length) {
    box.append(el('div', { class: 'empty' }, 'Press “Check AGC for new notices” to scan the listing.'));
    updateActionBar();
    return;
  }
  const tpl = $('notice-tpl');
  for (const n of state.notices) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.querySelector('.n-date').textContent = n.date || 'Undated';
    node.querySelector('.n-pu').textContent = n.pu;
    const pdf = node.querySelector('.n-pdf');
    if (n.pdfUrl) pdf.href = n.pdfUrl; else pdf.remove();
    const status = node.querySelector('.n-status');
    const exBtn = node.querySelector('.n-extract');
    const body = node.querySelector('.n-body');

    const already = state.processed[n.puKey];
    if (n.status === 'working') { status.textContent = 'Reading PDF…'; exBtn.remove(); }
    else if (n.status === 'error') { node.classList.add('is-error'); status.textContent = 'Needs attention'; exBtn.textContent = 'Try again'; }
    else if (n.status === 'done') {
      const fresh = n.parties.filter((p) => !(p.inIbl && p.inAgc)).length;
      const compared = state.masters.ibl && state.masters.agc;
      node.classList.add(fresh ? 'is-new' : 'is-done');
      status.textContent = !compared ? `${n.parties.length} name${n.parties.length > 1 ? 's' : ''} found`
        : fresh ? `${fresh} new name${fresh > 1 ? 's' : ''}` : 'All names already listed';
      exBtn.remove();
    } else if (already) {
      node.classList.add('is-done');
      status.textContent = `Added on ${fmtDMY(already.at.slice(0, 10))}`;
      exBtn.textContent = 'Re-read';
    } else {
      status.textContent = 'Not read';
    }
    exBtn.addEventListener?.('click', () => extractNotice(n));

    if (n.status === 'error') body.append(el('p', { class: 'n-err' }, `Could not read this notice: ${n.error}.`));
    if (n.status === 'done') body.append(renderParties(n));
    box.append(node);
  }
  updateActionBar();
}

function renderParties(n) {
  const frag = document.createDocumentFragment();
  const p = n.parsed;
  if (p.court) frag.append(el('p', { class: 'n-info' }, `Hearing: ${p.court}`));
  if (p.mismatch) frag.append(el('p', { class: 'n-warn' }, 'The Malay and English paragraphs list different names. Check each row against the PDF before updating.'));

  const table = el('table', { class: 'parties' });
  const thead = el('thead');
  const hr = el('tr');
  ['', 'Name (edit if needed)', 'Type', 'ID found', 'Status'].forEach((h, i) => hr.append(el('th', { class: ['c-chk', '', 'c-kind', 'c-id', 'c-flag'][i] }, h)));
  thead.append(hr);
  table.append(thead);
  const tb = el('tbody');
  for (const party of n.parties) {
    const tr = el('tr', { class: party.inIbl && party.inAgc ? 'dup' : '' });
    const chk = el('input', { type: 'checkbox', 'aria-label': `Include ${party.name}` });
    chk.checked = party.checked;
    chk.addEventListener('change', () => { party.checked = chk.checked; updateActionBar(); });
    const name = el('input', { type: 'text', value: party.name, 'aria-label': 'Name' });
    name.addEventListener('input', () => {
      party.name = name.value.trim();
      party.key = AgcParser.normKey(party.name);
      party.inIbl = !!(state.masters.ibl && state.masters.ibl.keys.has(party.key));
      party.inAgc = !!(state.masters.agc && state.masters.agc.keys.has(party.key));
      flag.textContent = flagText(party);
      flag.className = party.inIbl && party.inAgc ? 'flag-dup' : 'flag-new';
    });
    const flag = el('span', { class: party.inIbl && party.inAgc ? 'flag-dup' : 'flag-new' }, flagText(party));
    const cells = [chk, name, document.createTextNode(party.kind), document.createTextNode(party.ids.join(', ') || '—'), flag];
    ['c-chk', '', 'c-kind', 'c-id', 'c-flag'].forEach((c, i) => { const td = el('td', { class: c }); td.append(cells[i]); tr.append(td); });
    tb.append(tr);
  }
  table.append(tb);
  frag.append(table);

  if (p.schedule) {
    const d = el('details', { class: 'schedule' });
    d.append(el('summary', {}, 'Schedule (Jadual) — property named in the notice'), el('p', {}, p.schedule));
    frag.append(d);
  }
  return frag;
}

function flagText(p) {
  if (!state.masters.ibl || !state.masters.agc) return 'Not compared yet';
  if (p.inIbl && p.inAgc) return 'Already in both lists';
  if (p.inIbl) return 'In IBL only';
  if (p.inAgc) return 'In AGC list only';
  return 'New';
}

async function renderEmailPanel() {
  const groups = EmailDraft.emailGroups(state.notices);
  const box = $('email'), list = $('email-list');
  box.hidden = !groups.length;
  list.textContent = '';
  for (const g of groups) {
    const row = el('div', { class: 'e-row' });
    row.append(el('span', { class: 'e-date' }, EmailDraft.longDate(g.iso)),
      el('span', { class: 'e-count' }, `${g.names.length} name${g.names.length > 1 ? 's' : ''} · ${g.notices.length} PDF${g.notices.length > 1 ? 's' : ''}`));
    const s = state.emailSettings || EmailDraft.EMAIL_DEFAULTS;
    if (s.mode === 'gmail') {
      const b = el('button', { class: 'ghost' }, 'Open email draft');
      b.addEventListener('click', () => draftEmail(g));
      row.append(b);
    } else {
      const acts = el('span', { class: 'e-acts' });
      const mk = (label, fn) => { const b = el('button', { class: 'ghost' }, label); b.addEventListener('click', async () => {
        try { await fn(); const old = b.textContent; b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = old; }, 1800); }
        catch (e) { progress(`Could not copy: ${e.message}`, true); } }); acts.append(b); };
      mk('Copy To', async () => EmailDraft.copyText((await EmailDraft.loadEmailSettings()).to));
      mk('Copy subject', async () => EmailDraft.copyText(EmailDraft.fill((await EmailDraft.loadEmailSettings()).subject, g.iso)));
      mk('Copy email', async () => { const es = await EmailDraft.loadEmailSettings(); await EmailDraft.copyHtml(EmailDraft.buildEmailHtml(g, es), g.names.join('\n')); });
      const pb = el('button', { class: 'ghost' }, 'Save PDF');
      pb.addEventListener('click', () => savePdfs(g, true));
      acts.append(pb);
      row.append(acts);
    }
    list.append(row);
  }
}

// Put the notice PDF(s) in the AGC folder (day folder if it uses one), else Downloads
async function savePdfs(g, announce) {
  const saved = [];
  for (const n of g.notices) {
    try {
      if (!n.pdfData && n.pdfUrl) n.pdfData = (await fetchPdf([n.pdfUrl, ...(n.pdfCandidates || [])])).data;
      if (!n.pdfData) continue;
      state.savedTo = [];
      await saveOutput('agc', new Blob([n.pdfData], { type: 'application/pdf' }), EmailDraft.pdfFileName(n), g.iso);
      saved.push(`${EmailDraft.pdfFileName(n)} (${state.savedTo.join(', ').replace(/^AGC list in /, '')})`);
    } catch (e) { /* skip */ }
  }
  if (announce) progress(saved.length ? `Saved ${saved.join('; ')}.` : 'Could not get the PDF — use the PDF link on the notice.', !saved.length);
  return saved;
}

async function prepareCopyEmail(g) {
  const es = await EmailDraft.loadEmailSettings();
  let copied = false;
  try { await EmailDraft.copyHtml(EmailDraft.buildEmailHtml(g, es), g.names.join('\n')); copied = true; } catch (e) { /* page not focused */ }
  const saved = await savePdfs(g, false);
  return `Email for ${EmailDraft.longDate(g.iso)}: ${copied ? 'the email is copied — ' : ''}in your Work Chrome open Gmail › Compose, use “Copy To” and “Copy subject” below, ${copied ? 'click in the message and press Ctrl+V' : 'press “Copy email” and paste it'}, then attach ${saved.length ? saved.join('; ') : 'the notice PDF'}.`;
}

async function draftEmail(g) {
  try {
    progress(`Opening Gmail draft for ${EmailDraft.longDate(g.iso)}…`);
    const r = await EmailDraft.openGmailDraft(g, fetchPdf);
    if (!r.body) progress('Gmail opened, but the message body could not be filled. The email is on your clipboard — click in the body and press Ctrl+V.', true);
    else {
      const notAttached = r.files.filter((f) => !r.attached.includes(f));
      let msg = `Draft ready in Gmail for ${EmailDraft.longDate(g.iso)} — check it and press Send.`;
      if (notAttached.length || r.missingPdf) {
        msg += ` Please attach the notice PDF yourself (${notAttached.join(', ') || 'download it from the PDF link'}).`;
        for (const n of g.notices) if (n.pdfData && notAttached.includes(EmailDraftPdfName(n))) download(new Blob([n.pdfData], { type: 'application/pdf' }), EmailDraftPdfName(n));
      }
      progress(msg, !!(notAttached.length || r.missingPdf));
    }
  } catch (e) {
    progress(`Could not prepare the email: ${e.message}.`, true);
  }
}
function EmailDraftPdfName(n) { const m = (n.pu || '').match(/(\d+)\/(\d{4})/); return m ? `PUB ${m[1]}_${m[2]}.pdf` : `AGC notice ${n.iso}.pdf`; }

async function initEmailSettings() {
  const s = await EmailDraft.loadEmailSettings();
  for (const k of ['account', 'to', 'cc', 'subject', 'greeting', 'intro', 'closing', 'signature']) {
    const f = $('em-' + k);
    f.value = s[k];
    f.addEventListener('change', async () => { const cur = await EmailDraft.loadEmailSettings(); cur[k] = f.value; await EmailDraft.saveEmailSettings(cur); state.emailSettings = cur; });
  }
  state.emailSettings = s;
  for (const r of document.querySelectorAll('input[name=em-mode]')) {
    r.checked = r.value === s.mode;
    r.addEventListener('change', async () => { const cur = await EmailDraft.loadEmailSettings(); cur.mode = r.value; await EmailDraft.saveEmailSettings(cur); state.emailSettings = cur; renderEmailPanel(); });
  }
  $('em-autoOpen').checked = !!s.autoOpen;
  $('em-autoOpen').addEventListener('change', async (e) => { const cur = await EmailDraft.loadEmailSettings(); cur.autoOpen = e.target.checked; await EmailDraft.saveEmailSettings(cur); });
  $('em-reset').addEventListener('click', async () => { await EmailDraft.saveEmailSettings({ ...EmailDraft.EMAIL_DEFAULTS, to: $('em-to').value, cc: $('em-cc').value, account: $('em-account').value }); location.reload(); });
}

function updateActionBar() {
  renderEmailPanel();
  const picked = allParties().filter((p) => p.checked && p.name);
  const bar = $('actionbar');
  bar.hidden = !allParties().length;
  $('ab-summary').textContent = picked.length
    ? `${picked.length} name${picked.length > 1 ? 's' : ''} selected for IBL and AGC Consolidated List`
    : 'No names selected';
  $('generate-btn').disabled = !picked.length;
}

/* ---------------- write workbooks ---------------- */
function download(blob, fileName) {
  const a = el('a', { href: URL.createObjectURL(blob), download: fileName });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

async function generate() {
  const btn = $('generate-btn');
  if (!state.masters.ibl || !state.masters.agc) {
    progress('Load or link both workbooks first so the row numbers continue from your latest file.', true);
    return;
  }
  btn.disabled = true;
  try {
    // Oldest notice first so the lists stay chronological
    const picked = allParties()
      .filter((p) => p.checked && p.name)
      .sort((a, b) => (a.notice.iso || '').localeCompare(b.notice.iso || ''));
    const serialOf = (p) => {
      const [y, m, d] = (p.notice.iso || todayIso()).split('-').map(Number);
      return XlsxAppend.excelSerial(new Date(y, m - 1, d));
    };
    const ns = CONFIG.notSpecified;
    const idOf = (p) => (p.ids.length ? p.ids.join(' / ') : ns);

    // IBL: only names not already in IBL
    const iblRows = picked.filter((p) => !p.inIbl).map((p) => ({
      A: '__AUTO__', B: p.name, C: idOf(p), D: ns, E: ns, F: serialOf(p), G: ns, H: CONFIG.basis, I: CONFIG.remarksUrl,
    }));
    // AGC: only names not already in the AGC list
    const agcPicked = picked.filter((p) => !p.inAgc);
    const agcList = agcPicked.map((p) => ({ A: '__AUTO__', B: p.name, C: serialOf(p) }));
    const agcDetail = agcPicked.map((p) => ({
      A: '__AUTO__', B: p.name, C: idOf(p), D: ns, E: ns, F: serialOf(p), G: ns, H: CONFIG.basis,
    }));

    const S = (c) => ({ col: c, type: 'string' });
    const iblCols = [{ col: 'A', type: 'number' }, S('B'), S('C'), S('D'), S('E'), { col: 'F', type: 'date' }, S('G'), S('H'), S('I')];
    const latestIso = picked.map((p) => p.notice.iso).filter(Boolean).sort().pop() || todayIso();
    const [yy, mm, dd] = latestIso.split('-');
    state.savedTo = [];
    const done = [];

    if (iblRows.length) {
      progress('Updating IBL workbook…');
      const out = await XlsxAppend.appendToWorkbook(JSZip, state.masters.ibl.data, [
        { sheetName: CONFIG.ibl.sheet, columns: iblCols, rows: iblRows },
      ]);
      const name = `IBL_${dd}_${mm}_${yy}.xlsx`;
      await saveOutput('ibl', out.blob, name, latestIso);
      await loadMaster('ibl', name, await out.blob.arrayBuffer(), true);
      done.push(`${iblRows.length} row(s) added to ${name} (No. ${out.report[0].firstNo}–${out.report[0].lastNo})`);
    }
    if (agcList.length) {
      progress('Updating AGC Consolidated List…');
      const out = await XlsxAppend.appendToWorkbook(JSZip, state.masters.agc.data, [
        { sheetName: CONFIG.agc.listSheet, columns: [{ col: 'A', type: 'number' }, S('B'), { col: 'C', type: 'date' }], rows: agcList },
        { sheetName: CONFIG.agc.detailSheet, fallbackIndex: 1, columns: iblCols.slice(0, 8), rows: agcDetail },
      ]);
      const name = state.masters.agc.fileName || 'AGC_Consolidated_List.xlsx';
      await saveOutput('agc', out.blob, name, latestIso);
      await loadMaster('agc', name, await out.blob.arrayBuffer(), true);
      done.push(`${agcList.length} row(s) added to ${name}`);
    }

    // Remember which notices are finished
    const at = new Date().toISOString();
    for (const n of new Set(picked.map((p) => p.notice))) {
      state.processed[n.puKey] = { at, date: n.date, names: n.parties.map((p) => p.name) };
    }
    for (const n of state.notices) if (n.status === 'done' && !state.processed[n.puKey]) {
      state.processed[n.puKey] = { at, date: n.date, names: n.parties.map((p) => p.name) };
    }
    state.cursorIso = latestIso;
    await chrome.storage.local.set({ processed: state.processed, cursorIso: latestIso });

    // Refresh duplicate flags against the updated masters
    for (const p of allParties()) {
      p.inIbl = state.masters.ibl.keys.has(p.key);
      p.inAgc = state.masters.agc.keys.has(p.key);
      p.checked = !(p.inIbl && p.inAgc);
    }
    renderResults();
    progress(done.length
      ? `${done.join('. ')}. Saved: ${state.savedTo.join('; ')} — upload the IBL file to KAF ID Screen.`
      : 'Every selected name was already in both lists, so no file was changed.');
    chrome.runtime.sendMessage({ type: 'refresh-badge' }).catch(() => {});
    const es = await EmailDraft.loadEmailSettings();
    if (done.length && es.autoOpen) {
      const dates = new Set(picked.map((p) => p.notice.iso));
      const summary = $('progress').textContent;
      if (es.mode !== 'gmail') {
        const parts = [];
        for (const g of EmailDraft.emailGroups(state.notices).filter((g) => dates.has(g.iso))) parts.push(await prepareCopyEmail(g));
        progress(`${summary} ${parts.join(' ')}`);
      } else if (!es.to.trim()) progress(`${summary} To open the branch email automatically, add recipients under “Email settings”.`);
      else for (const g of EmailDraft.emailGroups(state.notices).filter((g) => dates.has(g.iso))) {
        await draftEmail(g);
        $('progress').textContent = `${summary} ${$('progress').textContent}`;
      }
    }
  } catch (e) {
    progress(`Could not update the workbooks: ${e.message}`, true);
  } finally {
    updateActionBar();
  }
}

/* ---------------- manual PDF ---------------- */
async function addManualPdf(file) {
  if (!file) return;
  const pu = (file.name.match(/(\d+)[_ -](\d{4})/) || []);
  const iso = $('since-date').value || todayIso();
  const n = {
    manual: true,
    pu: pu[1] ? `P.U. (B) ${pu[1]}/${pu[2]}` : file.name,
    puKey: pu[1] ? `P.U. (B) ${pu[1]}/${pu[2]}` : 'manual:' + file.name,
    date: fmtDMY(iso), iso, pdfUrl: null, status: 'idle',
  };
  state.notices = [n, ...state.notices.filter((x) => x.puKey !== n.puKey)];
  progress(`Reading ${file.name} (dated ${n.date} — change the date box first if that is wrong)…`);
  await extractNotice(n, await file.arrayBuffer());
  progress(n.status === 'done' ? `${file.name} read.` : `Could not read ${file.name}.`, n.status !== 'done');
}

function refreshAll() {
  for (const p of allParties()) {
    if (!state.masters.ibl || !state.masters.agc) continue;
    p.inIbl = state.masters.ibl.keys.has(p.key);
    p.inAgc = state.masters.agc.keys.has(p.key);
  }
  renderResults();
}


/* ---------------- linked folders (optional) ---------------- */
// The IBL and the AGC list can live in different folders, so each has its own link.
// Each run reads the newest file from its folder (searching month / day sub-folders) and saves the
// updated file back: into the day folder if the folder is organised as "9. September › 25.09.2026",
// otherwise next to the file it was read from (the old version is copied to _backup first).
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const KIND_LABEL = { ibl: 'IBL', agc: 'AGC list' };
state.dirs = { ibl: null, agc: null };
state.foundIn = { ibl: null, agc: null };   // folder handle the current file was read from

async function usesMonthFolders(dir) {
  for await (const [n, h] of dir.entries()) {
    if (h.kind === 'directory' && /^\d{1,2}\.\s*/.test(n) && MONTHS.some((x) => n.toLowerCase().includes(x.toLowerCase()))) return true;
  }
  return false;
}

async function outputFolder(kind, iso) {
  const dir = state.dirs[kind];
  if (!(await usesMonthFolders(dir))) {
    const h = state.foundIn[kind] || dir;
    return { handle: h, label: h === dir ? dir.name : `${dir.name} › ${(state.masters[kind].path || '').replace(/\/$/, '').replace(/\//g, ' › ')}` };
  }
  const [y, m, d] = iso.split('-');
  let monthDir = null;
  for await (const [n, h] of dir.entries()) {
    const mm = n.match(/^(\d{1,2})\.\s*/);
    if (h.kind === 'directory' && mm && +mm[1] === +m) { monthDir = h; break; }
  }
  if (!monthDir) monthDir = await dir.getDirectoryHandle(`${+m}. ${MONTHS[+m - 1]}`, { create: true });
  const dayName = `${d}.${m}.${y}`;
  return { handle: await monthDir.getDirectoryHandle(dayName, { create: true }), label: `${dir.name} › ${monthDir.name} › ${dayName}` };
}

async function saveOutput(kind, blob, name, iso) {
  const dir = state.dirs[kind];
  if (dir && (await dir.queryPermission({ mode: 'readwrite' })) === 'granted') {
    try {
      const target = await outputFolder(kind, iso || todayIso());
      const existing = await target.handle.getFileHandle(name).catch(() => null);
      if (existing) {
        const bdir = await target.handle.getDirectoryHandle('_backup', { create: true });
        const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
        const bw = await (await bdir.getFileHandle(name.replace(/\.xlsx$/i, `_${stamp}.xlsx`), { create: true })).createWritable();
        await bw.write(await existing.getFile()); await bw.close();
      }
      const w = await (await target.handle.getFileHandle(name, { create: true })).createWritable();
      await w.write(blob); await w.close();
      state.savedTo.push(`${KIND_LABEL[kind]} in “${target.label}”`);
      return;
    } catch (e) {
      progress(`Could not save ${name} into the folder (${e.message}${/lock|modif|state/i.test(e.message) ? ' — is it open in Excel?' : ''}). Downloading it instead.`, true);
    }
  }
  download(blob, name);
  state.savedTo.push(`${KIND_LABEL[kind]} in Downloads`);
}

// Find the newest file of one kind in its folder (and up to 3 levels of sub-folders)
async function loadFromFolder(kind) {
  const dir = state.dirs[kind];
  const found = [];
  async function walk(d, path, depth) {
    for await (const [fname, h] of d.entries()) {
      if (fname.startsWith('~$') || fname.startsWith('.') || /^_backup$/i.test(fname)) continue;
      if (h.kind === 'directory') { if (depth < 3) await walk(h, path + fname + '/', depth + 1); continue; }
      const pd = path.match(/(\d{2})\.(\d{2})\.(\d{4})\/$/) || [];
      const pathKey = pd[3] ? `${pd[3]}${pd[2]}${pd[1]}` : '';
      if (kind === 'ibl') {
        const m = fname.match(/^IBL[\s_-]*(\d{1,2})[\s_.-](\d{1,2})[\s_.-](\d{4}).*\.xlsx$/i);
        if (m) found.push({ h, parent: d, fname, path, key: `${m[3]}${m[2].padStart(2, '0')}${m[1].padStart(2, '0')}` });
      } else if (/^AGC[\s_-]*Consolidated[\s_-]*List.*\.xlsx$/i.test(fname)) {
        found.push({ h, parent: d, fname, path, key: pathKey + (/^AGC[\s_-]*Consolidated[\s_-]*List\.xlsx$/i.test(fname) ? '1' : '0') });
      }
    }
  }
  await walk(dir, '', 0);
  if (!found.length) return false;
  const withFile = await Promise.all(found.map(async (x) => ({ ...x, file: await x.h.getFile() })));
  withFile.sort((a, b) => a.key.localeCompare(b.key) || a.file.lastModified - b.file.lastModified);
  const best = withFile.pop();
  state.foundIn[kind] = best.parent;
  await loadMaster(kind, best.fname, await best.file.arrayBuffer(), true, best.path);
  return true;
}

async function renderFolder(kind) {
  const btn = $(kind + '-folder-btn'), st = $(kind + '-folder-state');
  const dir = state.dirs[kind];
  if (!dir) { st.textContent = 'or link its folder so it loads and saves by itself:'; btn.textContent = 'Link folder'; return 'none'; }
  const perm = await dir.queryPermission({ mode: 'readwrite' });
  if (perm === 'granted') { st.textContent = `Linked folder: ${dir.name}`; btn.textContent = 'Change'; }
  else { st.textContent = `Linked folder: ${dir.name} — Chrome needs one click to allow access.`; btn.textContent = 'Allow access'; }
  return perm;
}

async function onFolderButton(kind) {
  try {
    const dir = state.dirs[kind];
    if (dir && (await dir.queryPermission({ mode: 'readwrite' })) !== 'granted') {
      if ((await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') return;
    } else {
      state.dirs[kind] = await window.showDirectoryPicker({ id: 'idscreen-' + kind, mode: 'readwrite' });
      await idbSet('dir-' + kind, state.dirs[kind]);
    }
    const ok = await loadFromFolder(kind);
    await renderFolder(kind);
    progress(ok ? `${KIND_LABEL[kind]} folder linked — latest file loaded.`
      : `${KIND_LABEL[kind]} folder linked, but no ${kind === 'ibl' ? 'IBL_DD_MM_YYYY.xlsx' : 'AGC_Consolidated_List.xlsx'} was found in it or its sub-folders.`, !ok);
    refreshAll();
  } catch (e) {
    if (e.name !== 'AbortError') progress(`Could not use that folder: ${e.message}`, true);
  }
}

/* ---------------- boot ---------------- */
(async function init() {
  try { $('version').textContent = 'Version ' + chrome.runtime.getManifest().version; } catch (e) { /* demo */ }
  wireMasterInput('ibl');
  wireMasterInput('agc');
  $('since-date').addEventListener('change', (e) => { e.target.dataset.touched = '1'; });
  $('check-btn').addEventListener('click', runCheck);
  $('generate-btn').addEventListener('click', generate);
  $('manual-pdf').addEventListener('change', (e) => addManualPdf(e.target.files[0]));
  $('copy-btn').addEventListener('click', async () => {
    const names = allParties().filter((p) => p.checked && p.name).map((p) => p.name).join('\n');
    await navigator.clipboard.writeText(names);
    progress('Selected names copied.');
  });

  await initEmailSettings();
  $('ibl-folder-btn').addEventListener('click', () => onFolderButton('ibl'));
  $('agc-folder-btn').addEventListener('click', () => onFolderButton('agc'));
  const st = await chrome.storage.local.get(['processed', 'lastManualCheck', 'cursorIso', 'autoUpdate']);
  state.processed = st.processed || {};
  state.cursorIso = st.cursorIso || '';
  $('auto-update').checked = !!st.autoUpdate;
  $('auto-update').addEventListener('change', (e) => chrome.storage.local.set({ autoUpdate: e.target.checked }));
  if (st.lastManualCheck) $('check-sub').textContent = `Last checked ${new Date(st.lastManualCheck).toLocaleString('en-MY')}`;

  for (const kind of ['ibl', 'agc']) {
    const saved = await idbGet('master-' + kind).catch(() => null);
    if (saved) {
      try { await loadMaster(kind, saved.fileName, saved.data, false); } catch (e) { /* ignore corrupt cache */ }
    }
  }
  const legacy = await idbGet('dir').catch(() => null);   // v1.1–1.2 linked one folder for both
  for (const kind of ['ibl', 'agc']) {
    state.dirs[kind] = (await idbGet('dir-' + kind).catch(() => null)) || legacy || null;
    if ((await renderFolder(kind)) === 'granted') {
      try {
        if (!(await loadFromFolder(kind))) progress(`No ${KIND_LABEL[kind]} file found in its linked folder.`, true);
      } catch (e) { progress(`Could not read the ${KIND_LABEL[kind]} folder: ${e.message}`, true); }
    }
  }
  renderMasters();
  renderResults();
  // Opened from the toolbar icon → run the full check straight away
  runCheck();
})();
