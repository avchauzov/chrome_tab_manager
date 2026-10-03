import { mock, test } from 'node:test';
import assert from 'node:assert/strict';

const ungrouped = [];

mock.module('../lib/safe.js', {
  namedExports: {
    safeTabGroupsQuery: async () => [
      { id: 1, title: 'a.com', windowId: 1 },
      { id: 2, title: 'Stale', windowId: 1 },
      { id: 3, title: 'b.com', windowId: 1 },
    ],
    safeTabsQuery: async (query) => {
      if (query.groupId === 1) return [{ id: 10, groupId: 1 }];
      if (query.groupId === 2) return [{ id: 11, groupId: 2 }];
      if (query.groupId === 3) return [{ id: 12, groupId: 3 }, { id: 13, groupId: 3 }];
      return [];
    },
    safeTabsUngroup: async (ids) => {
      ungrouped.push(...ids);
      return ids;
    },
    safeWindowsGetAll: async () => [],
    safeTabsGroup: async () => null,
    safeTabsGet: async () => null,
    safeTabsRemove: async () => false,
    safeTabsMove: async () => null,
    safeTabsDiscard: async () => null,
    safeTabGroupsGet: async () => null,
    safeTabGroupsUpdate: async () => null,
    safeTabGroupsMove: async () => null,
    safeStorageLocalGet: async () => ({ actionLogs: [] }),
    safeStorageLocalSet: async () => true,
    safeAlarmsCreate: async () => true,
    safeAlarmsClear: async () => true,
    safeAlarmsGet: async () => null,
    safeWindowsGetCurrent: async () => null,
  },
});

const { cleanupSingleTabHostnameGroups } = await import('../lib/grouping.js');

test('min-size cleanup ungroups a small hostname group and keeps Stale', async () => {
  ungrouped.length = 0;
  await cleanupSingleTabHostnameGroups(1, { minTabsPerGroup: 2 });
  assert.deepEqual(ungrouped, [10]);
});
