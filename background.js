import { getSettings } from './lib/settings.js';
import { accessKey, getUrlLastAccess } from './lib/access.js';
import { isSupportedUrl } from './lib/normalize.js';
import { closeDuplicatesAcrossAllWindows } from './lib/dedup.js';
import {
  groupTabsByHostname,
  groupTabsByHostnameForAllWindows,
  cleanupSingleTabHostnameGroups,
} from './lib/grouping.js';
import { checkStaleTabs, checkStaleTabsForAllWindows } from './lib/stale.js';
import {
  sortTabs,
  sortTabsForAllWindows,
  sortTabsInsideHostnameGroups,
  sortTabsInsideHostnameGroupsForAllWindows,
} from './lib/sort.js';
import { setLastStatus, formatSummary } from './lib/log.js';
import {
  safeTabsGet,
  safeAlarmsClear,
  safeAlarmsCreate,
  safeStorageLocalGet,
  safeStorageLocalSet,
  safeWindowsGetCurrent,
} from './lib/safe.js';

const ALARM_NAME = 'tabManagerTick';
const debounceTimers = new Map();

const createSummary = () => ({ closed: 0, grouped: 0, stale: 0, ungrouped: 0 });

async function setupAlarm() {
  const { intervalMinutes } = await getSettings();
  await safeAlarmsClear(ALARM_NAME);
  await safeAlarmsCreate(ALARM_NAME, { periodInMinutes: intervalMinutes });
}

async function updateLastAccess(url) {
  if (!url) return;
  const urlLastAccess = await getUrlLastAccess();
  urlLastAccess[accessKey(url)] = Date.now();
  await safeStorageLocalSet({ urlLastAccess });
}

async function runAlarmPipeline() {
  const settings = await getSettings();
  const summary = createSummary();

  summary.closed += (await closeDuplicatesAcrossAllWindows({ mode: 'alarm' })).closedCount;
  summary.ungrouped += await cleanupSingleTabHostnameGroups(undefined, settings);

  if (settings.autoGroupByDomain) {
    summary.grouped += await groupTabsByHostnameForAllWindows(settings);
    if (settings.sortInsideGroups) {
      await sortTabsInsideHostnameGroupsForAllWindows(settings);
    }
  }

  if (settings.autoCheckStale) {
    summary.stale += await checkStaleTabsForAllWindows();
  }

  summary.ungrouped += await cleanupSingleTabHostnameGroups(undefined, settings);
  await sortTabsForAllWindows(settings);

  await setLastStatus(formatSummary(summary));
  return summary;
}

async function currentWindowId(requestedWindowId) {
  if (requestedWindowId !== undefined) return requestedWindowId;
  return (await safeWindowsGetCurrent())?.id;
}

async function respondWithSummary(summary) {
  const text = formatSummary(summary);
  await setLastStatus(text);
  return { ok: true, summary: text };
}

async function sortAndDedupe(windowId) {
  const settings = await getSettings();
  const summary = createSummary();

  summary.closed += (
    await closeDuplicatesAcrossAllWindows({ mode: 'manual' })
  ).closedCount;

  if (windowId !== undefined) {
    await sortTabs(windowId, settings);
  }

  summary.ungrouped += await cleanupSingleTabHostnameGroups(undefined, settings);
  return respondWithSummary(summary);
}

async function groupByDomain(windowId) {
  const settings = await getSettings();
  const summary = createSummary();

  if (windowId !== undefined) {
    summary.grouped += await groupTabsByHostname(windowId, settings);
    await sortTabsInsideHostnameGroups(windowId, settings);
  }

  summary.ungrouped += await cleanupSingleTabHostnameGroups(undefined, settings);
  return respondWithSummary(summary);
}

async function checkStale(windowId) {
  const summary = createSummary();
  if (windowId !== undefined) {
    summary.stale += await checkStaleTabs(windowId);
  }
  return respondWithSummary(summary);
}

async function handleMessage(msg) {
  switch (msg.action) {
    case 'settingsUpdated':
      await setupAlarm();
      return { ok: true };
    case 'sortAndDedupe':
      return sortAndDedupe(await currentWindowId(msg.windowId));
    case 'groupByDomain':
      return groupByDomain(await currentWindowId(msg.windowId));
    case 'checkStale':
      return checkStale(await currentWindowId(msg.windowId));
    case 'getStatus': {
      const data = await safeStorageLocalGet('lastActionSummary');
      return { ok: true, summary: data.lastActionSummary || 'Ready' };
    }
    default:
      return { ok: false };
  }
}

async function runStartupPipeline() {
  const settings = await getSettings();
  if (!settings.runOnStartup) return;

  await closeDuplicatesAcrossAllWindows({ mode: 'alarm' });

  if (settings.autoGroupByDomain) {
    await groupTabsByHostnameForAllWindows(settings);
  }

  if (settings.autoCheckStale) {
    await checkStaleTabsForAllWindows();
  }

  await cleanupSingleTabHostnameGroups(undefined, settings);
}

async function initExtension() {
  await setupAlarm();
  await runStartupPipeline();
}

async function handleRealTimeDedup(tabId) {
  const settings = await getSettings();
  if (!settings.realTimeDedupEnabled) return;

  const tab = await safeTabsGet(tabId);
  if (!tab || !isSupportedUrl(tab.url)) return;

  const result = await closeDuplicatesAcrossAllWindows({
    preferredTabId: tabId,
    mode: 'realtime',
  });

  await cleanupSingleTabHostnameGroups(undefined, settings);

  if (result.closedCount > 0) {
    await setLastStatus(
      formatSummary({ closed: result.closedCount, grouped: 0, stale: 0, ungrouped: 0 })
    );
  }
}

function scheduleRealTimeDedup(tabId) {
  getSettings()
    .then((settings) => {
      if (!settings.realTimeDedupEnabled) return;

      clearTimeout(debounceTimers.get(tabId));
      debounceTimers.set(
        tabId,
        setTimeout(() => {
          debounceTimers.delete(tabId);
          handleRealTimeDedup(tabId).catch(() => {});
        }, settings.debounceMs)
      );
    })
    .catch(() => {});
}

chrome.runtime.onInstalled.addListener(() => {
  initExtension().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  initExtension().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runAlarmPipeline().catch(() => {});
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  safeTabsGet(tabId).then((tab) => {
    if (tab?.url) updateLastAccess(tab.url).catch(() => {});
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    scheduleRealTimeDedup(tabId);
  }
  if (changeInfo.status === 'complete' && tab.url) {
    updateLastAccess(tab.url).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      sendResponse(await handleMessage(msg));
    } catch {
      sendResponse({ ok: false, summary: 'Error' });
    }
  })();
  return true;
});
