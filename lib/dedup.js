import { normalizeUrl, isSupportedUrl } from './normalize.js';
import { getLastAccess, getUrlLastAccess } from './access.js';
import { addActionLog } from './log.js';
import {
  safeTabsQuery,
  safeTabsRemove,
  safeWindowsGetAll,
  safeWindowsGetCurrent,
} from './safe.js';

export function pickWinner(tabs, { mode, preferredTabId, focusedWindowId, activeTabId, urlLastAccess }) {
  if (mode === 'realtime' && preferredTabId) {
    const preferred = tabs.find((t) => t.id === preferredTabId);
    if (preferred) return preferred;
  }

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

export async function closeDuplicatesAcrossAllWindows({ preferredTabId, mode = 'manual' } = {}) {
  const allTabs = await safeTabsQuery({});
  const focusedWindow = await safeWindowsGetCurrent();
  const focusedWindowId = focusedWindow?.id ?? null;
  const activeTabId = focusedWindow?.focused
    ? allTabs.find((t) => t.active && t.windowId === focusedWindowId)?.id ?? null
    : allTabs.find((t) => t.active)?.id ?? null;

  const urlLastAccess = await getUrlLastAccess();
  const byNormalized = new Map();

  for (const tab of allTabs) {
    if (tab.pinned) continue;
    if (!isSupportedUrl(tab.url)) continue;
    const key = normalizeUrl(tab.url);
    if (!key) continue;
    if (!byNormalized.has(key)) byNormalized.set(key, []);
    byNormalized.get(key).push(tab);
  }

  let closedCount = 0;
  const windows = await safeWindowsGetAll();

  for (const [, tabs] of byNormalized) {
    if (tabs.length < 2) continue;

    const winner = pickWinner(tabs, {
      mode,
      preferredTabId,
      focusedWindowId,
      activeTabId,
      urlLastAccess,
    });

    for (const tab of tabs) {
      if (tab.id === winner.id) continue;

      const win = windows.find((w) => w.id === tab.windowId);
      const winLabel = win ? `Window ${win.id}` : 'unknown window';
      const removed = await safeTabsRemove(tab.id);
      if (removed) {
        closedCount++;
        await addActionLog('dedup', `closed duplicate: ${tab.url} from ${winLabel}`);
      }
    }
  }

  return { closedCount };
}
