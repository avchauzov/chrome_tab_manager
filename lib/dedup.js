import { normalizeUrl, isSupportedUrl, formatLogUrl } from './normalize.js';
import { getLastAccess, getUrlLastAccess } from './access.js';
import { addActionLog } from './log.js';
import {
  safeTabsQuery,
  safeTabsRemove,
  safeWindowsGetAll,
  safeWindowsGetCurrent,
} from './safe.js';

export function pickWinner(tabs, { focusedWindowId, activeTabId, urlLastAccess }) {
  if (activeTabId) {
    const active = tabs.find((t) => t.id === activeTabId);
    if (active) return active;
  }

  let best = null;
  let bestAccess = -1;
  for (const tab of tabs) {
    const access = getLastAccess(urlLastAccess, tab.url);
    if (access !== undefined && access > bestAccess) {
      bestAccess = access;
      best = tab;
    }
  }
  if (best) return best;

  const inFocused = tabs.filter((t) => t.windowId === focusedWindowId);
  if (inFocused.length > 0) {
    return inFocused.reduce((a, b) => (a.id > b.id ? a : b));
  }

  return tabs.reduce((a, b) => (a.id > b.id ? a : b));
}

export function pickRealtimeWinner(tabs, { lastFocusedWindowId, activeTabId, urlLastAccess, focusedWindowId }) {
  const inLastFocused =
    lastFocusedWindowId != null ? tabs.filter((t) => t.windowId === lastFocusedWindowId) : [];
  const pool = inLastFocused.length > 0 ? inLastFocused : tabs;
  return pickWinner(pool, {
    activeTabId,
    urlLastAccess,
    focusedWindowId: inLastFocused.length > 0 ? lastFocusedWindowId : focusedWindowId,
  });
}

function buildDedupBuckets(tabs) {
  const byNormalized = new Map();

  for (const tab of tabs) {
    if (tab.pinned) continue;
    if (!isSupportedUrl(tab.url)) continue;
    const key = normalizeUrl(tab.url);
    if (!key) continue;
    if (!byNormalized.has(key)) byNormalized.set(key, []);
    byNormalized.get(key).push(tab);
  }

  return byNormalized;
}

async function closeDuplicateLosers(tabs, winner, windows, windowFilter) {
  let closedCount = 0;

  for (const tab of tabs) {
    if (tab.id === winner.id) continue;
    if (windowFilter && tab.windowId !== windowFilter) continue;

    const win = windows.find((w) => w.id === tab.windowId);
    const winLabel = win ? `Window ${win.id}` : 'unknown window';
    const removed = await safeTabsRemove(tab.id);
    if (removed) {
      closedCount++;
      await addActionLog('dedup', `closed duplicate: ${formatLogUrl(tab.url)} from ${winLabel}`);
    }
  }

  return closedCount;
}

export async function closeDuplicatesInWindow(windowId, { mode = 'manual' } = {}) {
  const windowTabs = await safeTabsQuery({ windowId });
  const activeTabId = windowTabs.find((t) => t.active)?.id ?? null;

  const urlLastAccess = await getUrlLastAccess();
  const byNormalized = buildDedupBuckets(windowTabs);
  const windows = await safeWindowsGetAll();
  let closedCount = 0;

  for (const [, tabs] of byNormalized) {
    if (tabs.length < 2) continue;

    const winner = pickWinner(tabs, {
      mode,
      focusedWindowId: windowId,
      activeTabId,
      urlLastAccess,
    });

    closedCount += await closeDuplicateLosers(tabs, winner, windows, windowId);
  }

  return { closedCount };
}

export async function closeDuplicatesAcrossAllWindows({
  mode = 'manual',
  winnerPicker = pickWinner,
  lastFocusedWindowId = null,
} = {}) {
  const allTabs = await safeTabsQuery({});
  const focusedWindow = await safeWindowsGetCurrent();
  const focusedWindowId = focusedWindow?.id ?? null;
  const activeTabId = focusedWindow?.focused
    ? allTabs.find((t) => t.active && t.windowId === focusedWindowId)?.id ?? null
    : allTabs.find((t) => t.active)?.id ?? null;

  const urlLastAccess = await getUrlLastAccess();
  const byNormalized = buildDedupBuckets(allTabs);
  const windows = await safeWindowsGetAll();
  let closedCount = 0;

  for (const [, tabs] of byNormalized) {
    if (tabs.length < 2) continue;

    const winner = winnerPicker(tabs, {
      mode,
      focusedWindowId,
      activeTabId,
      urlLastAccess,
      lastFocusedWindowId,
    });

    closedCount += await closeDuplicateLosers(tabs, winner, windows);
  }

  return { closedCount };
}
