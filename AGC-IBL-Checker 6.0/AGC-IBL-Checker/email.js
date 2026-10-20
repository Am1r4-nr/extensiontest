/* email.js — prepares the "please verify these names" email for each publication date and opens it
 * as a Gmail draft (never sends). The notice PDFs are attached automatically where Gmail allows it. */
'use strict';

const EMAIL_DEFAULTS = {
  account: '',   // e.g. firdausfauzi@kaf.com.my — picks the right Gmail account if several are signed in
  to: '',
  cc: '',
  subject: 'AGC - Notice to Third Parties dated {date_long}',
  greeting: 'Dear En. Farid,',
  intro: 'Refer to the Notice to Third Parties (attached) published by the AGC Federal Legislation on {date_long}. We kindly request your assistance in verifying whether any individuals or entities listed below are clients of the Bank or authorized "signatories" or "mandatees" for any accounts with the Bank.',
  closing: 'Should you have any queries, please do not hesitate to contact us.\n\nThank you.',
  signature: 'Regards,\nFirdaus Fauzi\nGroup Compliance\nKAF Investment Bank Berhad\nDL: +603 9767 6228',
  autoOpen: true,
  mode: 'copy',   // 'copy' = copy & paste into Gmail in another Chrome profile; 'gmail' = open the draft here
};

const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (iso) => { const [y, m, d] = iso.split('-'); return `${+d} ${MONTH_LONG[+m - 1]} ${y}`; };
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fill = (t, iso) => t.replace(/\{date_long\}/g, longDate(iso)).replace(/\{date\}/g, iso.split('-').reverse().join('/'));

async function loadEmailSettings() {
  const { emailSettings } = await chrome.storage.local.get('emailSettings');
  return { ...EMAIL_DEFAULTS, ...(emailSettings || {}) };
}
async function saveEmailSettings(s) { await chrome.storage.local.set({ emailSettings: s }); }

// Group finished notices by publication date → one email per date
function emailGroups(notices) {
  const by = new Map();
  for (const n of notices) {
    if (n.status !== 'done' || !n.iso || !n.parties || !n.parties.length) continue;
    if (!by.has(n.iso)) by.set(n.iso, []);
    by.get(n.iso).push(n);
  }
  return [...by.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([iso, list]) => ({
    iso, notices: list,
    names: list.flatMap((n) => n.parties.map((p) => p.name).filter(Boolean)),
  }));
}

function buildEmailHtml(group, s) {
  const p = (t) => `<p style="margin:0 0 12px">${escHtml(t).replace(/\n/g, '<br>')}</p>`;
  const dmy = group.iso.split('-').reverse().join('/');
  const cell = 'border:1px solid #000;padding:2px 6px;';
  const rows = group.names.map((n, i) =>
    `<tr><td style="${cell}text-align:center">${i + 1}</td><td style="${cell}">${escHtml(n)}</td><td style="${cell}text-align:center">${dmy}</td></tr>`).join('');
  const table = `<table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt;margin:0 0 12px" cellpadding="0" cellspacing="0">
<tr style="background:#C5D9F1;font-weight:bold"><td style="${cell}text-align:center;width:60px">No</td><td style="${cell}width:320px">Name</td><td style="${cell}text-align:center;width:160px">Date of Publication</td></tr>${rows}</table>`;
  const closing = fill(s.closing, group.iso).split(/\n\s*\n/).map(p).join('');
  const sig = s.signature ? p(s.signature) : '';
  return `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">${p(fill(s.greeting, group.iso))}${p(fill(s.intro, group.iso))}${table}${closing}${sig}</div>`;
}

function pdfFileName(n) {
  const m = (n.pu || '').match(/(\d+)\/(\d{4})/);
  return m ? `PUB ${m[1]}_${m[2]}.pdf` : `AGC notice ${n.iso}.pdf`;
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Runs inside the Gmail tab: fills the body and drops the PDFs onto the compose window.
function gmailInjector(html, files) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return (async () => {
    let body = null;
    for (let i = 0; i < 80 && !body; i++) {
      body = document.querySelector('div[aria-label="Message Body"][contenteditable="true"], div[g_editable="true"][contenteditable="true"]');
      if (!body) await sleep(250);
    }
    if (!body) return { body: false, attached: [] };
    body.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.setStart(body, 0); range.collapse(true);
    sel.removeAllRanges(); sel.addRange(range);
    const ok = document.execCommand('insertHTML', false, html);
    if (!ok) body.insertAdjacentHTML('afterbegin', html);

    const attached = [];
    if (files.length) {
      const dt = new DataTransfer();
      for (const f of files) {
        const bin = atob(f.b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        dt.items.add(new File([arr], f.name, { type: 'application/pdf' }));
      }
      const target = body.closest('[role="dialog"]') || body.closest('table') || body;
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
        await sleep(150);
      }
      await sleep(3500);
      const scope = (body.closest('[role="dialog"]') || document.body).innerText;
      for (const f of files) if (scope.includes(f.name)) attached.push(f.name);
    }
    return { body: true, attached };
  })();
}

async function openGmailDraft(group, fetchPdfFn) {
  const s = await loadEmailSettings();
  if (!s.to.trim()) throw new Error('add the recipients under “Email settings” first');
  const html = buildEmailHtml(group, s);

  // Always put a copy on the clipboard as a fallback (paste with Ctrl+V)
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([group.names.map((n, i) => `${i + 1}. ${n}`).join('\n')], { type: 'text/plain' }),
    })]);
  } catch (e) { /* clipboard not available — not critical */ }

  // Collect the PDFs
  const files = [];
  for (const n of group.notices) {
    try {
      if (!n.pdfData && n.pdfUrl) n.pdfData = (await fetchPdfFn([n.pdfUrl, ...(n.pdfCandidates || [])])).data;
      if (n.pdfData) files.push({ name: pdfFileName(n), b64: toBase64(n.pdfData) });
    } catch (e) { /* leave it for manual attach */ }
  }

  const q = new URLSearchParams({ view: 'cm', fs: '1', to: s.to, su: fill(s.subject, group.iso) });
  if (s.cc.trim()) q.set('cc', s.cc);
  if (s.account.trim()) q.set('authuser', s.account.trim());
  const tab = await chrome.tabs.create({ url: `https://mail.google.com/mail/?${q}`, active: true });

  await new Promise((resolve) => {
    const t = setTimeout(resolve, 30000);
    chrome.tabs.onUpdated.addListener(function l(id, info) {
      if (id === tab.id && info.status === 'complete') { clearTimeout(t); chrome.tabs.onUpdated.removeListener(l); resolve(); }
    });
  });
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: gmailInjector, args: [html, files] });
  return { ...result, files: files.map((f) => f.name), missingPdf: group.notices.length - files.length, tabId: tab.id };
}

async function copyHtml(html, plain) {
  await navigator.clipboard.write([new ClipboardItem({
    'text/html': new Blob([html], { type: 'text/html' }),
    'text/plain': new Blob([plain], { type: 'text/plain' }),
  })]);
}
async function copyText(t) { await navigator.clipboard.writeText(t); }

if (typeof self !== 'undefined') Object.assign(self, { EmailDraft: { copyHtml, copyText, fill, pdfFileName, loadEmailSettings, saveEmailSettings, emailGroups, buildEmailHtml, openGmailDraft, longDate, EMAIL_DEFAULTS } });
