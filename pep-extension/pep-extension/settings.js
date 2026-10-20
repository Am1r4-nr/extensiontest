import { DEFAULT_SOURCES } from './sources.js';
import { searchKey } from './extractor.js';

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { overrides: {}, custom: [], ...(settings || {}) };
}

// Automatic refresh: runs in the background while Chrome is open.
export const AUTO_PERIODS = { off: 0, daily: 1, weekly: 7, fortnightly: 14 };
export const DEFAULT_AUTO = 'weekly';
export function autoDays(settings) { return AUTO_PERIODS[settings.autoRefresh ?? DEFAULT_AUTO] ?? 7; }

// Data counts as stale one day after the scheduled refresh was due (or after 8 days if automatic refresh is off).
export function staleness(lastRun, settings) {
  const limit = (autoDays(settings) || 7) + 1;
  if (!lastRun) return { stale: true, days: null, limit };
  const days = Math.floor((Date.now() - new Date(lastRun.finishedAt).getTime()) / 86400000);
  return { stale: days >= limit, days, limit };
}

export async function recordRun(run) {
  const problems = run.sources.filter(s => s.state !== 'ok').map(s => s.name);
  const lastRun = { id: run.id, finishedAt: run.finishedAt, totals: run.totals, problems };
  await chrome.storage.local.set({ lastRun });
  return lastRun;
}

// A shared lock so a manual and an automatic refresh never run at the same time.
// The lock stays valid only while the running refresh keeps reporting progress (heartbeat),
// so a refresh that crashed never blocks the next one for long.
const HEARTBEAT_MINUTES = 5;
export async function getLock() {
  const { refreshLock } = await chrome.storage.local.get('refreshLock');
  if (refreshLock && Date.now() - (refreshLock.heartbeat || refreshLock.startedAt) < HEARTBEAT_MINUTES * 60000) return refreshLock;
  return null;
}
export async function setLock(by) { await chrome.storage.local.set({ refreshLock: { by, startedAt: Date.now(), heartbeat: Date.now() } }); }
export async function updateLock(progress) {
  const { refreshLock } = await chrome.storage.local.get('refreshLock');
  if (refreshLock) await chrome.storage.local.set({ refreshLock: { ...refreshLock, ...progress, heartbeat: Date.now() } });
}
export async function clearLock() { await chrome.storage.local.remove('refreshLock'); }

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

export function effectiveSources(settings) {
  return [...DEFAULT_SOURCES, ...settings.custom].map(s => {
    const o = settings.overrides[s.id] || {};
    return { ...s, url: o.url || s.url, defaultUrl: s.url, enabled: o.enabled ?? s.enabled !== false, pinnedUrls: o.pinnedUrls || [], custom: !!s.custom };
  });
}

// Every query word must match the start of a word in the person's name (titles ignored).
export function matchesName(person, query) {
  const q = searchKey(query).split(' ').filter(Boolean);
  if (!q.length) return true;
  const words = searchKey(person.bareName || person.name).split(' ');
  return q.every(t => words.some(w => w.startsWith(t)));
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
