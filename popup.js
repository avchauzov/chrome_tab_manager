import { DEFAULT_SETTINGS } from './lib/settings.js';

const sortDedupeBtn = document.getElementById('sortDedupe');
const groupDomainBtn = document.getElementById('groupDomain');
const checkStaleBtn = document.getElementById('checkStale');
const autoGroupToggle = document.getElementById('autoGroup');
const realTimeDedupToggle = document.getElementById('realTimeDedup');
const statusEl = document.getElementById('status');
const settingsBtn = document.getElementById('settings');

function setButtonsDisabled(disabled) {
  sortDedupeBtn.disabled = disabled;
  groupDomainBtn.disabled = disabled;
  checkStaleBtn.disabled = disabled;
}

function loadSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (data) => {
    autoGroupToggle.checked = data.autoGroupByDomain;
    realTimeDedupToggle.checked = data.realTimeDedupEnabled;
  });
}

function loadStatus() {
  chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
    if (response?.summary) {
      statusEl.textContent = response.summary;
    }
  });
}

autoGroupToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ autoGroupByDomain: autoGroupToggle.checked });
});

realTimeDedupToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ realTimeDedupEnabled: realTimeDedupToggle.checked });
});

settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

async function runAction(action) {
  setButtonsDisabled(true);
  try {
    const win = await chrome.windows.getCurrent();
    const response = await chrome.runtime.sendMessage({ action, windowId: win.id });
    if (response?.summary) {
      statusEl.textContent = response.summary;
    }
  } finally {
    setButtonsDisabled(false);
  }
}

sortDedupeBtn.addEventListener('click', () => runAction('sortAndDedupe'));
groupDomainBtn.addEventListener('click', () => runAction('groupByDomain'));
checkStaleBtn.addEventListener('click', () => runAction('checkStale'));

loadSettings();
loadStatus();
