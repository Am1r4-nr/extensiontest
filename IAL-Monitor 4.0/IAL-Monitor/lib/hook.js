/* Runs in the SC Investor Alert List page itself (MAIN world, before the page's scripts).
 * Keeps a copy of the page's own data responses so the extension can read the entries
 * without depending on how the page draws them.
 */
(function () {
  if (window.__ialHooked) return;
  window.__ialHooked = true;
  const store = [];
  function save(rec) {
    try {
      if (!rec.text || !/remark/i.test(rec.text)) return;
      store.push(rec);
      while (store.length > 15) store.shift();
      let el = document.getElementById('ial-capture');
      if (!el) {
        el = document.createElement('script');
        el.type = 'application/json';
        el.id = 'ial-capture';
        (document.body || document.documentElement).appendChild(el);
      }
      el.textContent = JSON.stringify(store);
    } catch (e) { /* never break the page */ }
  }
  const abs = u => { try { return new URL(u, location.href).href; } catch (e) { return String(u); } };

  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      const p = origFetch.apply(this, arguments);
      try {
        const url = abs(typeof input === 'string' ? input : input.url);
        const method = (init && init.method) || (input && input.method) || 'GET';
        const body = init && typeof init.body === 'string' ? init.body : null;
        const headers = init && init.headers && !(init.headers instanceof Headers) ? init.headers : null;
        p.then(res => res.clone().text().then(text => save({ url, method, body, headers, text }))).catch(() => {});
      } catch (e) { }
      return p;
    };
  }

  const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send, setH = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) { this.__ial = { method, url: abs(url), headers: {} }; return open.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { if (this.__ial) this.__ial.headers[k] = v; return setH.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (body) {
    const x = this;
    if (x.__ial) {
      x.__ial.body = typeof body === 'string' ? body : null;
      x.addEventListener('load', () => {
        try {
          const text = (x.responseType === '' || x.responseType === 'text') ? x.responseText : JSON.stringify(x.response);
          save({ ...x.__ial, text });
        } catch (e) { }
      });
    }
    return send.apply(this, arguments);
  };
})();
