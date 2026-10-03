import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

const manifest = JSON.parse(read('manifest.json'));
assert(manifest.manifest_version === 3, 'manifest must be MV3');
assert(manifest.background?.type === 'module', 'background must use ES modules');
assert(existsSync(join(root, manifest.background.service_worker)), 'background.js missing');
assert(!manifest.action.default_popup, 'manifest must not set action.default_popup');

for (const path of [
  manifest.options_ui.page,
  manifest.action.default_icon,
  manifest.icons['128'],
]) {
  assert(existsSync(join(root, path)), `missing manifest asset: ${path}`);
}

const optionsPage = read(manifest.options_ui.page);
assert(optionsPage.includes('type="module"'), `${manifest.options_ui.page} must load scripts as modules`);

const background = read('background.js');
assert(background.includes('chrome.action.onClicked'), 'background must handle chrome.action.onClicked');
assert(background.includes("case 'settingsUpdated'"), 'background missing settingsUpdated handler');
assert(background.includes('getLastFocusedWindowId'), 'background must track last focused window');
assert(background.includes('runWindowPipeline'), 'background must define runWindowPipeline');
assert(background.includes('function enqueueOp'), 'background must serialize top-level work');
assert(background.includes('layoutWindow'), 'background must lay windows out');
assert(background.includes('recordLastObservedAt'), 'background must record URL observation');
assert(!background.includes("status === 'complete' && tab.url"), 'complete must not write access');

const organizeBody = background.slice(
  background.indexOf('async function organizeWindow'),
  background.indexOf('async function runWindowPipeline')
);
const groupAt = organizeBody.indexOf('groupTabsByHostname');
const staleAt = organizeBody.indexOf('checkStaleTabs');
const cleanupAt = organizeBody.indexOf('cleanupSingleTabHostnameGroups');
const layoutAt = organizeBody.indexOf('layoutWindow');
assert(
  groupAt !== -1 && groupAt < staleAt && staleAt < cleanupAt && cleanupAt < layoutAt,
  'organizeWindow must group, then stale, then cleanup, then layout'
);

const updatedBody = background.slice(
  background.indexOf('async function handleUpdated'),
  background.indexOf('chrome.windows.onFocusChanged')
);
assert(updatedBody.includes('if (changeInfo.url && nextUrl)'), 'URL changes must record observation');
assert(!updatedBody.includes('touchLastSeenAt'), 'complete/update must not record attention');

const realtimeBody = background.slice(
  background.indexOf('async function handleRealTimeDedup'),
  background.indexOf('function scheduleRealTimeDedup')
);
assert(!realtimeBody.includes('layoutWindow'), 'realtime dedup must not lay out the window');
assert(!realtimeBody.includes('groupTabsByHostname'), 'realtime dedup must not regroup');

const options = read('options.js');
assert(!options.includes('entry.message;'), 'options log must not concatenate entry.message into innerHTML');
assert(options.includes('appendText'), 'options log must render via DOM text API');
assert(options.includes("import { DEFAULT_SETTINGS }"), 'options must import DEFAULT_SETTINGS');

const settings = read('lib/settings.js');
const settingsKeys = [...settings.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
const optionsFields = [...options.matchAll(/^\s{2}(\w+): document\.getElementById/gm)].map((m) => m[1]);
for (const key of optionsFields) {
  assert(settingsKeys.includes(key), `options field ${key} missing from DEFAULT_SETTINGS`);
}

console.log('Static smoke checks passed.');
