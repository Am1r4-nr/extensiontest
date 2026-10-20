/* Injected into https://www.sc.com.my/investor-alert-list (isolated world). Self-contained. */
var ialNorm = s => String(s || '').toLowerCase()
  .replace(/[\u2010-\u2015]/g, '-').replace(/[’‘]/g, "'")
  .replace(/\s*-\s*/g, ' - ').replace(/\s+/g, ' ').trim();
var ialCore = s => ialNorm(s).replace(/^potential clone entity\s*-?\s*/, '').trim();

function ialGrabFromListPage(names) {
  const leaves = el => {
    const out = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const p = n.parentElement;
      if (p && ['SCRIPT', 'STYLE', 'TEMPLATE'].includes(p.tagName)) continue;
      const t = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (t && !/^\[.*\]$/.test(t)) out.push(t);
    }
    return out;
  };
  const candidates = Array.from(document.querySelectorAll('body *'))
    .filter(el => !['SCRIPT', 'STYLE', 'TEMPLATE', 'INPUT', 'TEXTAREA'].includes(el.tagName) && el.children.length <= 3)
    .map(el => ({ el, t: ialNorm(el.textContent) }))
    .filter(x => x.t && x.t.length < 250);

  const result = {};
  for (const name of names) {
    const target = ialNorm(name), core = ialCore(name);
    const rowOf = el => {
      let e = el;
      while (e && e !== document.body && !/REMARK/.test(e.textContent)) e = e.parentElement;
      if (!e || e === document.body) return null;
      return (e.textContent.match(/REMARK/g) || []).length <= 2 ? e : null; // skip big containers
    };
    const matches = candidates.filter(x => x.t === target)
      .concat(core.length >= 4 ? candidates.filter(x => ialCore(x.t) === core) : []);
    let row = null, listName = '';
    for (const m of matches) { row = rowOf(m.el); if (row) { listName = m.el.textContent.replace(/\s+/g, ' ').trim(); break; } }
    if (!row) { result[name] = { found: false }; continue; }

    const parts = leaves(row);
    let k = parts.findIndex(p => /^REMARKS?$/.test(p));
    if (k < 0) {                                   // "REMARK" glued to the text that follows
      k = parts.findIndex(p => /^REMARKS?/.test(p));
      if (k < 0) { result[name] = { found: false }; continue; }
      parts.splice(k, 1, 'REMARK', parts[k].replace(/^REMARKS?\s*/, ''));
    }
    const before = parts.slice(0, k);
    const after = [];
    for (const p of parts.slice(k + 1)) {           // stop if hidden "more info" repeats the row
      if (/^REMARKS?$/.test(p) || ialNorm(p) === target) break;
      after.push(p);
    }

    const urls = new Set();
    row.querySelectorAll('a[href^="http"]').forEach(a => { if (!/sc\.com\.my/i.test(a.href)) urls.add(a.href.trim()); });
    before.join(' ').split(/\s*\|\s*|\s+/).forEach(tok => { if (/^(https?:\/\/|www\.)\S+/i.test(tok) && !/sc\.com\.my/i.test(tok)) urls.add(tok); });

    let identity = '';
    const address = [];
    for (const p of before) {
      const np = ialNorm(p);
      if (np === target || ialCore(p) === core || p === '|' || /^(n\/a|-|more info|\d{4}|details|name)$/i.test(p) || /(https?:\/\/|www\.)/i.test(p)) continue;
      if (/^\(?\d{5,12}[- ]?[A-Z]\)?$/.test(p) || /^\d{6}-\d{2}-\d{4}$/.test(p) || /^\d{12}$/.test(p)) { identity = p.replace(/[()]/g, ''); continue; }
      if (!address.includes(p)) address.push(p);
    }
    const bullets = after.join('\n').split(/•/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    result[name] = {
      found: true, listName, identity, address: address.join(', '), websites: [...urls],
      reasons: bullets.map(b => '• ' + b).join('\n')
    };
  }
  return result;
}

// Types a query into the SC search box and triggers the search. Returns true if a box was found.
function ialTypeSearch(query) {
  const input = document.querySelector('input[placeholder*="name or entity" i]') ||
    document.querySelector('input[placeholder*="search" i]') || document.querySelector('input[type="search"]');
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  input.focus();
  setter.call(input, query);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  const key = type => {
    const ev = new KeyboardEvent(type, { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'keyCode', { get: () => 13 });
    Object.defineProperty(ev, 'which', { get: () => 13 });
    return ev;
  };
  ['keydown', 'keypress', 'keyup'].forEach(t => input.dispatchEvent(key(t)));
  // the magnifier icon next to the box
  let scope = input.parentElement, btn = null;
  for (let i = 0; i < 3 && scope && !btn; i++, scope = scope.parentElement) {
    btn = Array.from(scope.querySelectorAll('button, a, [role="button"], [class*="search" i]'))
      .find(e => e !== input && !e.contains(input) && !/clear/i.test(e.textContent) && e.offsetWidth < 200);
  }
  if (btn) btn.click();
  return true;
}

function ialCollectAnnouncementLinks() {
  return [...new Set(Array.from(document.querySelectorAll('a[href*="investor-alert-list-as-at"]')).map(a => a.href.split('#')[0]))];
}

// Entries from the page's own data responses (captured by hook.js), plus request info for learning the API.
function ialReadCaptured(names, query) {
  let recs = [];
  try { recs = JSON.parse((document.getElementById('ial-capture') || {}).textContent || '[]'); } catch (e) { }
  const found = self.IALRecords ? IALRecords.findInResponses(recs.map(r => r.text), names).result : {};
  let api = null;
  if (query) {
    const enc = encodeURIComponent(query), plus = enc.replace(/%20/g, '+');
    for (const r of recs.slice().reverse()) {
      const hasName = names.some(n => found[n]) && IALRecords.findInResponses([r.text], names).recordCount > 0;
      if (!hasName) continue;
      for (const [form, q] of [['enc', enc], ['plus', plus], ['raw', query]]) {
        if ((r.url && r.url.includes(q)) || (r.body && r.body.includes(q))) {
          api = { url: r.url.split(q).join('{{Q}}'), method: r.method || 'GET', body: r.body ? r.body.split(q).join('{{Q}}') : null,
            headers: r.headers || null, form };
          break;
        }
      }
      if (api) break;
    }
  }
  return { found, api, captured: recs.length };
}
