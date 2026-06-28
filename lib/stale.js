import { isSupportedUrl } from './normalize.js';
import { getLastAccess, getUrlLastAccess } from './access.js';
import { getSettings } from './settings.js';
import { STALE_GROUP_TITLE, isInStaleGroup } from './grouping.js';
import { addActionLog } from './log.js';
import {
  safeTabsQuery,
  safeTabsGroup,
  safeTabGroupsQuery,
  safeTabGroupsUpdate,
  safeWindowsGetAll,
} from './safe.js';

async function findStaleGroupId(windowId) {
  const groups = await safeTabGroupsQuery({ windowId, title: STALE_GROUP_TITLE });
  return groups.length > 0 ? groups[0].id : null;
}

async function logStaleTabs(tabIds, tabsById) {
  for (const tabId of tabIds) {
    const tab = tabsById.get(tabId);
    if (tab) await addActionLog('stale', `moved tab to Stale: ${tab.url}`);
  }
}

async function moveTabsToStale(windowId, staleGroupId, staleTabIds, tabs) {
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));

  if (staleGroupId === null) {
    const firstTab = staleTabIds[0];
    staleGroupId = await safeTabsGroup({
      tabIds: [firstTab],
      createProperties: { windowId },
    });
    if (staleGroupId === null) return 0;

    await safeTabGroupsUpdate(staleGroupId, { title: STALE_GROUP_TITLE, color: 'red' });
    await logStaleTabs([firstTab], tabsById);

    const rest = staleTabIds.slice(1);
    if (rest.length > 0) {
      await safeTabsGroup({ groupId: staleGroupId, tabIds: rest });
      await logStaleTabs(rest, tabsById);
    }
    return staleTabIds.length;
  }

  await safeTabsGroup({ groupId: staleGroupId, tabIds: staleTabIds });
  await logStaleTabs(staleTabIds, tabsById);
  return staleTabIds.length;
}

export function isStaleCandidate(tab, urlLastAccess, now, thresholdMs) {
  const lastAccess = getLastAccess(urlLastAccess, tab.url);
  if (lastAccess === undefined) return false;
  return now - lastAccess > thresholdMs;
}

export async function checkStaleTabs(windowId) {
  const urlLastAccess = await getUrlLastAccess();
  const settings = await getSettings();
  const thresholdMs = settings.staleThresholdDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const staleGroupId = await findStaleGroupId(windowId);
  const tabs = await safeTabsQuery({ windowId });
  const staleTabIds = [];

  for (const tab of tabs) {
    if (tab.pinned) continue;
    if (await isInStaleGroup(tab)) continue;
    if (!isSupportedUrl(tab.url)) continue;

    if (isStaleCandidate(tab, urlLastAccess, now, thresholdMs)) {
      staleTabIds.push(tab.id);
    }
  }

  if (staleTabIds.length === 0) return 0;

  return moveTabsToStale(windowId, staleGroupId, staleTabIds, tabs);
}

export async function checkStaleTabsForAllWindows() {
  const windows = await safeWindowsGetAll();
  let total = 0;
  for (const win of windows) {
    total += await checkStaleTabs(win.id);
  }
  return total;
}
