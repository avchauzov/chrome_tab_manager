import { normalizeUrl } from './normalize.js';
import { safeStorageLocalGet } from './safe.js';

export function accessKey(url) {
  return normalizeUrl(url) ?? url;
}

export async function getUrlLastAccess() {
  const data = await safeStorageLocalGet('urlLastAccess');
  return data.urlLastAccess || {};
}

export function getLastAccess(urlLastAccess, url) {
  return urlLastAccess[accessKey(url)];
}
