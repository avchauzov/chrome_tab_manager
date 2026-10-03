import { mock, test } from 'node:test';
import assert from 'node:assert/strict';

const NONE = -1;
globalThis.chrome = { tabGroups: { TAB_GROUP_ID_NONE: NONE } };

const state = {
  tabs: [],
  groups: [],
  calls: [],
};

function reindex() {
  state.tabs.forEach((tab, index) => {
    tab.index = index;
  });
}

function clone(tab) {
  return { ...tab };
}

function moveTab(id, index) {
  state.calls.push({ type: 'tab', id, index });
  const src = state.tabs.findIndex((tab) => tab.id === id);
  const [tab] = state.tabs.splice(src, 1);
  let dest = index;
  if (dest > src) dest -= 1;
  dest = Math.max(0, Math.min(dest, state.tabs.length));
  state.tabs.splice(dest, 0, tab);
  reindex();
}

function moveGroup(groupId, index) {
  state.calls.push({ type: 'group', groupId, index });
  const members = state.tabs
    .filter((tab) => tab.groupId === groupId)
    .sort((a, b) => a.index - b.index);
  const oldIndexes = members.map((tab) => tab.index);
  state.tabs = state.tabs.filter((tab) => tab.groupId !== groupId);
  reindex();
  let dest = state.tabs.length;
  if (index !== -1) {
    const removedBefore = oldIndexes.filter((oldIndex) => oldIndex < index).length;
    dest = index - removedBefore;
  }
  dest = Math.max(0, Math.min(dest, state.tabs.length));
  state.tabs.splice(dest, 0, ...members);
  reindex();
}

mock.module('../lib/safe.js', {
  namedExports: {
    safeTabsQuery: async (query) => {
      let list = state.tabs;
      if (query.windowId != null) list = list.filter((tab) => tab.windowId === query.windowId);
      if (query.groupId != null) list = list.filter((tab) => tab.groupId === query.groupId);
      return list.map(clone);
    },
    safeTabsGet: async (id) => {
      const tab = state.tabs.find((item) => item.id === id);
      return tab ? clone(tab) : null;
    },
    safeTabsMove: async (id, props) => {
      moveTab(id, props.index);
      return clone(state.tabs.find((tab) => tab.id === id));
    },
    safeTabGroupsQuery: async (query) =>
      state.groups
        .filter((group) => query.windowId == null || group.windowId === query.windowId)
        .map((group) => ({ ...group })),
    safeTabGroupsMove: async (groupId, props) => {
      moveGroup(groupId, props.index);
      return { id: groupId };
    },
    safeTabsRemove: async () => false,
    safeTabsDiscard: async () => null,
    safeTabsGroup: async () => null,
    safeTabsUngroup: async () => null,
    safeTabGroupsGet: async () => null,
    safeTabGroupsUpdate: async () => null,
    safeStorageLocalGet: async () => ({}),
    safeStorageLocalSet: async () => true,
    safeAlarmsCreate: async () => true,
    safeAlarmsClear: async () => true,
    safeAlarmsGet: async () => null,
    safeWindowsGetAll: async () => [],
    safeWindowsGetCurrent: async () => null,
  },
});

const { layoutWindow } = await import('../lib/sort.js');

function tab(id, index, url, groupId, extra = {}) {
  return { id, index, url, groupId, windowId: 1, pinned: false, ...extra };
}

function loadInterleaved() {
  state.tabs = [
    tab(9, 0, 'https://pin.example/', NONE, { pinned: true }),
    tab(1, 1, 'https://b.com/a', 2),
    tab(2, 2, 'https://b.com/b', 2),
    tab(3, 3, 'https://z.com/2', NONE),
    tab(4, 4, 'https://a.com/1', 1),
    tab(5, 5, 'https://a.com/2', 1),
    tab(6, 6, 'https://a.com/3', 1),
    tab(7, 7, 'https://z.com/1', NONE),
    tab(8, 8, 'https://old.com/x', 3),
  ];
  state.groups = [
    { id: 2, title: 'b.com', windowId: 1 },
    { id: 1, title: 'a.com', windowId: 1 },
    { id: 3, title: 'Stale', windowId: 1 },
  ];
  state.calls = [];
}

test('layoutWindow packs ungrouped tabs, then hostname groups A-Z, then Stale', async () => {
  loadInterleaved();
  await layoutWindow(1, { sortInsideGroups: true });

  assert.deepEqual(
    state.tabs.map((item) => item.id),
    [9, 7, 3, 4, 5, 6, 1, 2, 8]
  );
  const groupMoves = state.calls.filter((call) => call.type === 'group');
  assert.equal(groupMoves.some((call) => call.index === 3), false);
  assert.equal(groupMoves[0].groupId, 1);
  assert.equal(groupMoves[0].index, 8);
  assert.equal(state.calls.filter((call) => call.type === 'tab' && call.id === 8).length, 0);
});

test('already laid-out window is not moved again', async () => {
  state.tabs = [
    tab(9, 0, 'https://pin.example/', NONE, { pinned: true }),
    tab(7, 1, 'https://z.com/1', NONE),
    tab(3, 2, 'https://z.com/2', NONE),
    tab(4, 3, 'https://a.com/1', 1),
    tab(5, 4, 'https://a.com/2', 1),
    tab(6, 5, 'https://a.com/3', 1),
    tab(1, 6, 'https://b.com/a', 2),
    tab(2, 7, 'https://b.com/b', 2),
    tab(8, 8, 'https://old.com/x', 3),
  ];
  state.groups = [
    { id: 1, title: 'a.com', windowId: 1 },
    { id: 2, title: 'b.com', windowId: 1 },
    { id: 3, title: 'Stale', windowId: 1 },
  ];
  state.calls = [];

  await layoutWindow(1, { sortInsideGroups: true });
  assert.deepEqual(state.calls, []);
});

test('Stale is parked at the end once and its tabs are not sorted', async () => {
  state.tabs = [
    tab(4, 0, 'https://a.com/1', 1),
    tab(8, 1, 'https://old.com/b', 3),
    tab(7, 2, 'https://old.com/a', 3),
    tab(3, 3, 'https://z.com/1', NONE),
  ];
  state.groups = [
    { id: 1, title: 'a.com', windowId: 1 },
    { id: 3, title: 'Stale', windowId: 1 },
  ];
  state.calls = [];

  await layoutWindow(1, { sortInsideGroups: true });

  const staleMoves = state.calls.filter((call) => call.type === 'group' && call.groupId === 3);
  assert.deepEqual(staleMoves, [{ type: 'group', groupId: 3, index: -1 }]);
  assert.equal(state.calls.some((call) => call.type === 'tab' && (call.id === 8 || call.id === 7)), false);
  assert.deepEqual(
    state.tabs.map((item) => item.id),
    [3, 4, 8, 7]
  );
});

test('sortInsideGroups false moves group blocks without reordering their tabs', async () => {
  state.tabs = [
    tab(2, 0, 'https://b.com/b', 2),
    tab(1, 1, 'https://b.com/a', 2),
    tab(3, 2, 'https://z.com/2', NONE),
    tab(4, 3, 'https://a.com/1', 1),
    tab(7, 4, 'https://z.com/1', NONE),
    tab(8, 5, 'https://old.com/x', 3),
  ];
  state.groups = [
    { id: 2, title: 'b.com', windowId: 1 },
    { id: 1, title: 'a.com', windowId: 1 },
    { id: 3, title: 'Stale', windowId: 1 },
  ];
  state.calls = [];

  await layoutWindow(1, { sortInsideGroups: false });

  assert.deepEqual(
    state.tabs.map((item) => item.id),
    [7, 3, 4, 2, 1, 8]
  );
  const movedTabIds = state.calls.filter((call) => call.type === 'tab').map((call) => call.id);
  assert.deepEqual(movedTabIds.filter((id) => id === 1 || id === 2 || id === 4), []);
});

test('without Stale, hostname groups are appended A-Z', async () => {
  state.tabs = [
    tab(2, 0, 'https://b.com/a', 2),
    tab(3, 1, 'https://z.com/1', NONE),
    tab(4, 2, 'https://a.com/1', 1),
  ];
  state.groups = [
    { id: 2, title: 'b.com', windowId: 1 },
    { id: 1, title: 'a.com', windowId: 1 },
  ];
  state.calls = [];

  await layoutWindow(1, { sortInsideGroups: false });

  assert.deepEqual(
    state.tabs.map((item) => item.id),
    [3, 4, 2]
  );
  const groupMoves = state.calls.filter((call) => call.type === 'group');
  assert.ok(groupMoves.length > 0);
  assert.ok(groupMoves.every((call) => call.index === -1));
});
