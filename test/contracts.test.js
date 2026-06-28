import test from 'node:test';
import assert from 'node:assert/strict';

import { accessKey, getLastAccess } from '../lib/access.js';
import { pickWinner } from '../lib/dedup.js';
import { isStaleGroup } from '../lib/grouping.js';
import { isStaleCandidate } from '../lib/stale.js';
import { formatSummary } from '../lib/log.js';
import { getHostname, isSupportedUrl, normalizeUrl } from '../lib/normalize.js';

const baseUrl = 'https://shop.com/item/42';

test('accessKey maps utm variants to the same storage key', () => {
  const withEmail = `${baseUrl}?utm_source=email`;
  const withAds = `${baseUrl}?utm_source=ads`;
  assert.equal(accessKey(withEmail), accessKey(withAds));
  assert.equal(accessKey(withEmail), 'https://shop.com/item/42');
});

test('getLastAccess reads by normalized key regardless of tab url variant', () => {
  const urlLastAccess = { [accessKey(baseUrl)]: 1000 };
  assert.equal(getLastAccess(urlLastAccess, `${baseUrl}?utm_source=email`), 1000);
  assert.equal(getLastAccess(urlLastAccess, `${baseUrl}?fbclid=xyz`), 1000);
  assert.equal(getLastAccess({}, `${baseUrl}?utm_source=email`), undefined);
});

test('normalizeUrl strips tracking noise and preserves meaningful query params', () => {
  assert.equal(
    normalizeUrl('HTTPS://Example.com/path/?utm_source=x&b=2&a=1#section'),
    'https://example.com/path?a=1&b=2'
  );
});

test('normalizeUrl rejects unsupported or malformed urls', () => {
  assert.equal(isSupportedUrl('chrome://extensions'), false);
  assert.equal(normalizeUrl('chrome://extensions'), null);
  assert.equal(normalizeUrl('not a url'), null);
});

test('getHostname lowercases supported hostnames', () => {
  assert.equal(getHostname('https://EXAMPLE.com/Page'), 'example.com');
});

test('formatSummary reports empty and pluralized changes', () => {
  assert.equal(formatSummary({ closed: 0, grouped: 0, stale: 0, ungrouped: 0 }), 'No changes');
  assert.equal(
    formatSummary({ closed: 1, grouped: 2, stale: 1, ungrouped: 2 }),
    'Closed 1 duplicate, grouped 2 tabs, moved 1 tab to Stale, ungrouped 2 single-tab groups'
  );
});

test('pickWinner priority: preferred > active > lastAccess > focused > maxId', () => {
  const urlLastAccess = {
    [accessKey('https://a.com/1')]: 100,
    [accessKey('https://a.com/2')]: 200,
  };
  const tabs = [
    { id: 1, url: 'https://a.com/1', windowId: 10, active: false },
    { id: 2, url: 'https://a.com/2', windowId: 10, active: false },
    { id: 3, url: 'https://a.com/3', windowId: 20, active: false },
  ];
  const ctx = { mode: 'manual', focusedWindowId: 10, urlLastAccess };

  assert.equal(
    pickWinner(tabs, { ...ctx, mode: 'realtime', preferredTabId: 1 }).id,
    1
  );
  assert.equal(pickWinner(tabs, { ...ctx, activeTabId: 3 }).id, 3);
  assert.equal(pickWinner(tabs, ctx).id, 2);
  assert.equal(
    pickWinner(
      [
        { id: 4, url: 'https://a.com/4', windowId: 10, active: false },
        { id: 5, url: 'https://a.com/5', windowId: 10, active: false },
      ],
      { ...ctx, urlLastAccess: {} }
    ).id,
    5
  );
  assert.equal(
    pickWinner(
      [
        { id: 6, url: 'https://a.com/6', windowId: 99, active: false },
        { id: 7, url: 'https://a.com/7', windowId: 99, active: false },
      ],
      { ...ctx, urlLastAccess: {}, focusedWindowId: 99 }
    ).id,
    7
  );
});

test('isStaleGroup matches only the Stale title', () => {
  assert.equal(isStaleGroup({ title: 'Stale' }), true);
  assert.equal(isStaleGroup({ title: 'example.com' }), false);
  assert.equal(isStaleGroup(null), false);
});

test('isStaleCandidate skips tabs without an access record', () => {
  const now = 10_000;
  const thresholdMs = 1000;
  const tab = { url: `${baseUrl}?utm_source=email` };

  assert.equal(isStaleCandidate(tab, {}, now, thresholdMs), false);
  assert.equal(
    isStaleCandidate(tab, { [accessKey(baseUrl)]: now - thresholdMs - 1 }, now, thresholdMs),
    true
  );
  assert.equal(
    isStaleCandidate(tab, { [accessKey(baseUrl)]: now - thresholdMs + 1 }, now, thresholdMs),
    false
  );
});
