import { mock, test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = {
  tabGroups: { TAB_GROUP_ID_NONE: -1 },
  storage: {
    sync: {
      get: async (defaults) => ({ ...defaults }),
    },
  },
};

const store = {};
const grouped = [];

mock.module('../lib/safe.js', {
  namedExports: {
    safeStorageLocalGet: async (keys) => {
      if (keys === 'urlLastAccess') return { urlLastAccess: store.urlLastAccess || {} };
      if (keys === 'actionLogs') return { actionLogs: store.actionLogs || [] };
      return {};
    },
    safeStorageLocalSet: async (items) => {
      Object.assign(store, items);
      return true;
    },
    safeTabsQuery: async () => [
      {
        id: 1,
        windowId: 1,
        pinned: false,
        active: false,
        groupId: -1,
        url: 'https://example.com/page',
        lastAccessed: 0,
      },
    ],
    safeTabsGroup: async (opts) => {
      grouped.push(opts);
      return opts.createProperties ? 50 : 50;
    },
    safeTabGroupsUpdate: async () => null,
    safeTabsDiscard: async () => null,
    safeTabGroupsQuery: async () => [],
    safeTabGroupsGet: async () => null,
    safeWindowsGetAll: async () => [],
    safeTabsGet: async () => null,
    safeTabsRemove: async () => false,
    safeTabsMove: async () => null,
    safeTabsUngroup: async () => null,
    safeTabGroupsMove: async () => null,
    safeAlarmsCreate: async () => true,
    safeAlarmsClear: async () => true,
    safeAlarmsGet: async () => null,
    safeWindowsGetCurrent: async () => null,
  },
});

const { checkStaleTabs } = await import('../lib/stale.js');

test('missing lastObservedAt is seeded and the tab is not stale on that pass', async () => {
  store.urlLastAccess = {};
  store.actionLogs = [];
  grouped.length = 0;
  const before = Date.now();

  const result = await checkStaleTabs(1);

  const after = Date.now();
  assert.equal(result.moved, 0);
  assert.equal(grouped.length, 0);
  const entry = store.urlLastAccess['https://example.com/page'];
  assert.equal(typeof entry.lastObservedAt, 'number');
  assert.ok(entry.lastObservedAt >= before && entry.lastObservedAt <= after);
});

test('an aged lastObservedAt still moves the tab to Stale', async () => {
  const now = Date.now();
  store.urlLastAccess = {
    'https://example.com/page': { lastObservedAt: now - 10 * 24 * 60 * 60 * 1000 },
  };
  store.actionLogs = [];
  grouped.length = 0;

  const result = await checkStaleTabs(1);

  assert.equal(result.moved, 1);
  assert.equal(grouped.length > 0, true);
  assert.equal(
    store.urlLastAccess['https://example.com/page'].lastObservedAt,
    now - 10 * 24 * 60 * 60 * 1000
  );
});
