// Reads org charts and leadership lists published as PDFs or pictures.
//   - PDF with text: text is read directly (pdf.js).
//   - Scanned PDF, PNG/JPG/WebP picture: text is recognised with OCR (Tesseract, English + Malay),
//     running inside the browser. Nothing is uploaded anywhere.
//   - SVG chart: the text inside the drawing is read directly.
// Org charts place people in boxes side by side, so text is first regrouped box by box
// (layoutLines) before names are matched with positions.

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_PDF_PAGES = 6;
const MAX_OCR_PAGES = 2;
const OCR_MIN_CONFIDENCE = 55;

// ---------- Layout: turn positioned text into box-by-box lines ----------
// items: [{ text, x0, x1, y0, y1 }] with y growing downwards. Returns lines, with '' between boxes.
export function layoutLines(items) {
  const its = items
    .map(i => ({ ...i, text: String(i.text || '').replace(/\s+/g, ' ').trim() }))
    .filter(i => i.text)
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);

  // 1. Join pieces of text on the same line that sit close together.
  const frags = [];
  for (const it of its) {
    const h = Math.max(4, it.y1 - it.y0);
    const f = frags.find(f => Math.abs(f.y0 - it.y0) < h * 0.5 && it.x0 - f.x1 < h * 1.2 && it.x0 >= f.x0 - h);
    if (f) {
      f.text += (it.x0 - f.x1 > h * 0.15 ? ' ' : '') + it.text;
      f.x1 = Math.max(f.x1, it.x1); f.y1 = Math.max(f.y1, it.y1);
    } else frags.push({ ...it });
  }

  // 2. Stack lines that sit directly under each other into boxes.
  frags.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const boxes = [];
  for (const f of frags) {
    const h = Math.max(4, f.y1 - f.y0);
    const cx = (f.x0 + f.x1) / 2;
    let best = null;
    for (const b of boxes) {
      const last = b.lines[b.lines.length - 1];
      const gap = f.y0 - last.y1;
      if (gap < -h * 0.3 || gap > h * 1.6) continue;
      const overlap = Math.min(f.x1, last.x1) - Math.max(f.x0, last.x0);
      const lcx = (last.x0 + last.x1) / 2;
      if (overlap > 0 || Math.abs(cx - lcx) < h * 2) {
        if (!best || gap < best.gap) best = { b, gap };
      }
    }
    if (best) best.b.lines.push(f);
    else boxes.push({ lines: [f], x0: f.x0, y0: f.y0 });
  }
  boxes.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const out = [];
  for (const b of boxes) { for (const l of b.lines) out.push(l.text); out.push(''); }
  return out;
}

// pdf.js text items -> positioned items (y downwards)
export function pdfItems(textContent, pageHeight) {
  return textContent.items.filter(it => it.str && it.str.trim()).map(it => {
    const [, , , d, e, f] = it.transform;
    const size = Math.abs(it.height || d || 10);
    const top = pageHeight - f - size;
    return { text: it.str, x0: e, x1: e + (it.width || it.str.length * size * 0.5), y0: top, y1: top + size };
  });
}

// Tesseract result -> positioned items
// Uses word positions, because OCR joins boxes that sit side by side into one line.
export function ocrItems(data) {
  const out = [];
  for (const l of data.lines || []) {
    if (l.confidence < OCR_MIN_CONFIDENCE) continue;
    for (const w of l.words || []) {
      const t = (w.text || '').trim();
      if (!t || w.confidence < 30) continue;
      // Use the line's height so words in one line share a baseline.
      out.push({ text: t, x0: w.bbox.x0, x1: w.bbox.x1, y0: l.bbox.y0, y1: l.bbox.y1 });
    }
  }
  return out;
}

// SVG text -> positioned items
export function svgItems(svgText) {
  const xml = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const out = [];
  for (const t of xml.querySelectorAll('text')) {
    const spans = t.querySelectorAll('tspan');
    const parts = spans.length ? [...spans] : [t];
    for (const p of parts) {
      const x = parseFloat(p.getAttribute('x') ?? t.getAttribute('x') ?? '0');
      const y = parseFloat(p.getAttribute('y') ?? t.getAttribute('y') ?? '0');
      const size = parseFloat(p.getAttribute('font-size') ?? t.getAttribute('font-size') ?? '12') || 12;
      const text = p.textContent || '';
      out.push({ text, x0: x, x1: x + text.length * size * 0.55, y0: y - size, y1: y });
    }
  }
  return out;
}

// ---------- Browser side ----------
let pdfjsPromise = null;
let ocrPromise = null;

async function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('./lib/pdf.min.mjs').then(m => {
      m.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.mjs');
      return m;
    });
  }
  return pdfjsPromise;
}

async function ocrWorker() {
  if (!ocrPromise) {
    ocrPromise = (async () => {
      const mod = await import('./lib/tesseract.esm.min.js');
      const Tesseract = mod.default || mod;
      return Tesseract.createWorker(['eng', 'msa'], 1, {
        workerPath: chrome.runtime.getURL('lib/tesseract-worker.min.js'),
        corePath: chrome.runtime.getURL('lib/tesseract-core-simd-lstm.wasm.js'),
        langPath: chrome.runtime.getURL('lib/lang'),
        workerBlobURL: false,
        cacheMethod: 'none',
        gzip: true
      });
    })();
    ocrPromise.catch(() => { ocrPromise = null; });
  }
  return ocrPromise;
}

export async function closeReaders() {
  if (ocrPromise) {
    try { (await ocrPromise).terminate(); } catch { /* already stopped */ }
    ocrPromise = null;
  }
}

async function fetchBinary(url) {
  const res = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new Error('File too large to read');
  const blob = await res.blob();
  if (blob.size > MAX_BYTES) throw new Error('File too large to read');
  return { blob, type: (res.headers.get('content-type') || blob.type || '').split(';')[0].toLowerCase(), finalUrl: res.url || url };
}

// Draw an image (upscaled when small, so OCR can read small print) and recognise the text.
async function ocrBitmap(bitmap) {
  const scale = bitmap.width < 1600 ? Math.min(3, 2400 / bitmap.width) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const worker = await ocrWorker();
  const { data } = await worker.recognize(canvas);
  return ocrItems(data);
}

export function isPdfUrl(u) { return /\.pdf($|[?#])/i.test(u || ''); }
export function isImageUrl(u) { return /\.(png|jpe?g|webp|gif|svg)($|[?#])/i.test(u || ''); }

// Returns { lines, method, finalUrl }
export async function readMedia(url) {
  const { blob, type, finalUrl } = await fetchBinary(url);
  return readMediaBlob(blob, type, finalUrl);
}

// Read a PDF / picture already in memory (downloaded, or uploaded from the user's computer).
export async function readMediaBlob(blob, type, finalUrl) {
  type = String(type || blob.type || '').toLowerCase();
  if (type.includes('pdf') || isPdfUrl(finalUrl)) {
    const lib = await pdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
    const lines = [];
    let ocrPages = 0, usedOcr = false;
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES); n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      let items = pdfItems(await page.getTextContent(), vp.height);
      if (items.map(i => i.text).join('').length < 30 && ocrPages < MAX_OCR_PAGES) {
        // Scanned page: draw it and recognise the text.
        ocrPages++; usedOcr = true;
        const view = page.getViewport({ scale: 2.5 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(view.width); canvas.height = Math.round(view.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: view }).promise;
        items = await ocrBitmap(await createImageBitmap(canvas));
      }
      lines.push(...layoutLines(items), '');
    }
    return { lines, method: usedOcr ? 'image' : 'pdf', finalUrl };
  }
  if (type.includes('svg') || /\.svg($|[?#])/i.test(finalUrl)) {
    return { lines: layoutLines(svgItems(await blob.text())), method: 'pdf', finalUrl };
  }
  if (type.startsWith('image/') || isImageUrl(finalUrl)) {
    const bitmap = await createImageBitmap(blob);
    if (bitmap.width < 300 || bitmap.height < 150) return { lines: [], method: 'image', finalUrl }; // icons, logos
    return { lines: layoutLines(await ocrBitmap(bitmap)), method: 'image', finalUrl };
  }
  throw new Error('Not a PDF or picture');
}
