export const DEFAULT_SETTINGS = {
  intervalMinutes: 60,
  staleThresholdDays: 3,
  autoGroupByDomain: true,
  realTimeDedupEnabled: true,
  debounceMs: 750,
  minTabsPerGroup: 2,
  sortInsideGroups: true,
  autoCheckStale: true,
  runOnStartup: true,
};

export async function getSettings() {
  return chrome.storage.sync.get(DEFAULT_SETTINGS);
}
