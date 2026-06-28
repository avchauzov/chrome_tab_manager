import { normalizeUrl } from './normalize.js';
import { isStaleGroup } from './grouping.js';
import {
  safeTabsQuery,
  safeTabsMove,
  safeTabsGet,
  safeTabGroupsQuery,
  safeWindowsGetAll,
} from './safe.js';

function compareTabs(a, b) {
  const normA = normalizeUrl(a.url) || a.url || '';
  const normB = normalizeUrl(b.url) || b.url || '';
  const cmp = normA.localeCompare(normB);
  if (cmp !== 0) return cmp;
  const rawCmp = (a.url || '').localeCompare(b.url || '');
  if (rawCmp !== 0) return rawCmp;
  return a.id - b.id;
}

export async function sortTabsInsideHostnameGroups(windowId, settings) {
  if (!settings.sortInsideGroups) return;

  const groups = await safeTabGroupsQuery({ windowId });
  for (const group of groups) {
    if (isStaleGroup(group)) continue;

    const tabs = await safeTabsQuery({ groupId: group.id });
    if (tabs.length < 2) continue;

    const sorted = [...tabs].sort(compareTabs);
    const baseIndex = Math.min(...tabs.map((t) => t.index));

    for (let i = 0; i < sorted.length; i++) {
      const targetIndex = baseIndex + i;
      const tab = await safeTabsGet(sorted[i].id);
      if (tab && tab.index !== targetIndex) {
        await safeTabsMove(tab.id, { index: targetIndex });
      }
    }
  }
}

export async function sortTabsInsideHostnameGroupsForAllWindows(settings) {
  const windows = await safeWindowsGetAll();
  for (const win of windows) {
    await sortTabsInsideHostnameGroups(win.id, settings);
  }
}

export async function sortTabs(windowId, settings) {
  const tabs = await safeTabsQuery({ windowId });
  const pinned = tabs.filter((t) => t.pinned);
  const unpinned = tabs.filter((t) => !t.pinned);

  let toSort;
  if (settings?.autoGroupByDomain) {
    toSort = unpinned.filter(
      (t) => t.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE
    );
  } else {
    toSort = [...unpinned];
  }

  toSort.sort((a, b) => (a.url || '').localeCompare(b.url || ''));

  const startIndex = pinned.length;
  for (let i = 0; i < toSort.length; i++) {
    const targetIndex = startIndex + i;
    const tab = await safeTabsGet(toSort[i].id);
    if (tab && tab.index !== targetIndex) {
      await safeTabsMove(tab.id, { index: targetIndex });
    }
  }
}

export async function sortTabsForAllWindows(settings) {
  const windows = await safeWindowsGetAll();
  for (const win of windows) {
    await sortTabs(win.id, settings);
  }
}
