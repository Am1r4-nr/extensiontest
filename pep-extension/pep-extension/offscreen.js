// Runs an automatic refresh in the background. An offscreen document is used because
// reading web pages needs DOMParser, which the service worker does not have.
import { refreshAll } from './crawler.js';

const job = await chrome.runtime.sendMessage({ type: 'get-refresh-job' });
try {
  let last = 0;
const report = ev => {
  // Throttled progress report to the background, which keeps it for the dashboard and popup.
  if (ev.done == null || Date.now() - last < 2000 && ev.done !== ev.total) return;
  last = Date.now();
  chrome.runtime.sendMessage({ type: 'refresh-progress', done: ev.done, total: ev.total, stage: ev.stage }).catch(() => {});
};
const run = await refreshAll(job?.sources || [], report, { useChrome: job?.useChrome ?? true, useMedia: job?.useMedia ?? true });
  await chrome.runtime.sendMessage({ type: 'auto-refresh-done', run });
} catch (e) {
  await chrome.runtime.sendMessage({ type: 'auto-refresh-failed', error: e.message });
}
