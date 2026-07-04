import { mock, test } from 'node:test';
import assert from 'node:assert/strict';

const noop = async () => {};

mock.module('../lib/log.js', {
  namedExports: {
    addActionLog: noop,
  },
});

mock.module('../lib/safe.js', {
  namedExports: {
    safeTabsGroup: async (opts) => {
      if (opts.createProperties) return 100;
      if (opts.groupId === 200) return null;
      if (opts.groupId === 100) return null;
      return 100;
    },
    safeTabGroupsUpdate: noop,
    safeTabsDiscard: async () => null,
    safeTabsQuery: async () => [],
    safeTabGroupsQuery: async () => [],
    safeWindowsGetAll: async () => [],
    safeStorageLocalGet: async () => ({}),
    safeStorageLocalSet: async () => true,
    safeTabsGet: async () => null,
    safeTabsRemove: async () => false,
    safeTabsMove: async () => null,
    safeTabsUngroup: async () => null,
    safeTabGroupsGet: async () => null,
    safeAlarmsCreate: async () => true,
    safeAlarmsClear: async () => true,
    safeAlarmsGet: async () => null,
    safeWindowsGetCurrent: async () => null,
  },
});

const { moveTabsToStale } = await import('../lib/stale.js');

test('moveTabsToStale reports partial moved when append to new stale group fails', async () => {
  const tabs = [
    { id: 1, url: 'https://a.com/1', active: false, audible: false, discarded: false, pinned: false },
    { id: 2, url: 'https://a.com/2', active: false, audible: false, discarded: false, pinned: false },
  ];

  const result = await moveTabsToStale(1, null, [1, 2], tabs);
  assert.equal(result.moved, 1);
  assert.equal(result.discarded, 0);
});

test('moveTabsToStale returns zero when grouping into existing stale group fails', async () => {
  const tabs = [
    { id: 3, url: 'https://a.com/3', active: false, audible: false, discarded: false, pinned: false },
  ];

  const result = await moveTabsToStale(1, 200, [3], tabs);
  assert.equal(result.moved, 0);
  assert.equal(result.discarded, 0);
});
