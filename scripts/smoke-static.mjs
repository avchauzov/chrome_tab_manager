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

for (const path of [
  manifest.action.default_popup,
  manifest.options_ui.page,
  manifest.action.default_icon,
  manifest.icons['128'],
]) {
  assert(existsSync(join(root, path)), `missing manifest asset: ${path}`);
}

for (const html of [manifest.action.default_popup, manifest.options_ui.page]) {
  const content = read(html);
  assert(content.includes('type="module"'), `${html} must load scripts as modules`);
}

const popupActions = ['sortAndDedupe', 'groupByDomain', 'checkStale', 'getStatus'];
const background = read('background.js');
for (const action of popupActions) {
  assert(background.includes(`case '${action}'`), `background missing handler: ${action}`);
}
assert(background.includes("case 'settingsUpdated'"), 'background missing settingsUpdated handler');

const options = read('options.js');
assert(!options.includes('entry.message;'), 'options log must not concatenate entry.message into innerHTML');
assert(options.includes('appendText'), 'options log must render via DOM text API');
assert(options.includes("import { DEFAULT_SETTINGS }"), 'options must import DEFAULT_SETTINGS');

const popup = read('popup.js');
assert(popup.includes("import { DEFAULT_SETTINGS }"), 'popup must import DEFAULT_SETTINGS');

const settings = read('lib/settings.js');
const settingsKeys = [...settings.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
const optionsFields = [...options.matchAll(/^\s{2}(\w+): document\.getElementById/gm)].map((m) => m[1]);
for (const key of optionsFields) {
  assert(settingsKeys.includes(key), `options field ${key} missing from DEFAULT_SETTINGS`);
}

console.log('Static smoke checks passed.');
