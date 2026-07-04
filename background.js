import { getSettings } from './lib/settings.js';
import { accessKey, getUrlLastAccess } from './lib/access.js';
import { isSupportedUrl } from './lib/normalize.js';
import {
  closeDuplicatesAcrossAllWindows,
  closeDuplicatesInWindow,
  pickRealtimeWinner,
} from './lib/dedup.js';
import {
  groupTabsByHostname,
  groupTabsByHostnameForAllWindows,
  cleanupSingleTabHostnameGroups,
  isInStaleGroup,
} from './lib/grouping.js';
import { checkStaleTabs, checkStaleTabsForAllWindows } from './lib/stale.js';
import {
  sortTabs,
  sortTabsInsideHostnameGroups,
} from './lib/sort.js';
import {
  safeTabsGet,
  safeTabsUngroup,
  safeAlarmsClear,
  safeAlarmsCreate,
  safeAlarmsGet,
  safeStorageLocalSet,
  safeWindowsGetAll,
} from './lib/safe.js';

const ALARM_NAME = 'tabManagerTick';
const debounceTimers = new Map();
let lastFocusedWindowId = null;

async function getLastFocusedWindowId() {
  if (lastFocusedWindowId == null) {
    try {
      const win = await chrome.windows.getLastFocused();
      lastFocusedWindowId = win?.id ?? null;
    } catch {
      lastFocusedWindowId = null;
    }
  }
  return lastFocusedWindowId;
}

async function setupAlarm(forceRecreate = false) {
  if (!forceRecreate) {
    const existing = await safeAlarmsGet(ALARM_NAME);
    if (existing) return;
  }

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

async function runWindowPipeline(windowId, { includeGrouping = false } = {}) {
  const settings = await getSettings();

  await closeDuplicatesInWindow(windowId);

  if (settings.autoCheckStale) {
    await checkStaleTabs(windowId);
  }

  await cleanupSingleTabHostnameGroups(windowId, settings);

  if (includeGrouping && settings.autoGroupByDomain) {
    await groupTabsByHostname(windowId, settings);
  }

  await sortTabs(windowId, settings);
  await sortTabsInsideHostnameGroups(windowId, settings);
}

async function runAlarmPipeline() {
  const focusedId = await getLastFocusedWindowId();
  const windows = await safeWindowsGetAll();

  for (const win of windows) {
    if (focusedId != null && win.id === focusedId) continue;
    await runWindowPipeline(win.id, { includeGrouping: true });
  }
}

async function handleMessage(msg) {
  switch (msg.action) {
    case 'settingsUpdated':
      await setupAlarm(true);
      return { ok: true };
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
  await getLastFocusedWindowId();
  await setupAlarm();
  await runStartupPipeline();
}

async function handleRealTimeDedup(tabId) {
  const settings = await getSettings();
  if (!settings.realTimeDedupEnabled) return;

  const tab = await safeTabsGet(tabId);
  if (!tab || !isSupportedUrl(tab.url)) return;

  const lastFocusedId = await getLastFocusedWindowId();
  await closeDuplicatesAcrossAllWindows({
    mode: 'realtime',
    winnerPicker: pickRealtimeWinner,
    lastFocusedWindowId: lastFocusedId,
  });

  await cleanupSingleTabHostnameGroups(undefined, settings);
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

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    lastFocusedWindowId = windowId;
  }
});

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

chrome.action.onClicked.addListener((tab) => {
  runWindowPipeline(tab.windowId).catch(() => {});
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  (async () => {
    const tab = await safeTabsGet(tabId);
    if (!tab) return;
    if (await isInStaleGroup(tab)) {
      await safeTabsUngroup([tabId]);
    }
    if (tab.url) await updateLastAccess(tab.url);
  })().catch(() => {});
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
