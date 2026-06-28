import { DEFAULT_SETTINGS } from './lib/settings.js';

const fields = {
  realTimeDedupEnabled: document.getElementById('realTimeDedupEnabled'),
  debounceMs: document.getElementById('debounceMs'),
  autoGroupByDomain: document.getElementById('autoGroupByDomain'),
  minTabsPerGroup: document.getElementById('minTabsPerGroup'),
  sortInsideGroups: document.getElementById('sortInsideGroups'),
  staleThresholdDays: document.getElementById('staleThresholdDays'),
  autoCheckStale: document.getElementById('autoCheckStale'),
  intervalMinutes: document.getElementById('intervalMinutes'),
  runOnStartup: document.getElementById('runOnStartup'),
};

const saveBtn = document.getElementById('save');
const savedEl = document.getElementById('saved');
const logsEl = document.getElementById('logs');

function loadSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (data) => {
    for (const [key, field] of Object.entries(fields)) {
      if (field.type === 'checkbox') {
        field.checked = data[key];
      } else {
        field.value = data[key];
      }
    }
  });
}

function appendText(parent, className, text) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  parent.appendChild(span);
}

function loadLogs() {
  chrome.storage.local.get('actionLogs', (data) => {
    const logs = data.actionLogs || [];
    logsEl.innerHTML = '';
    if (logs.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No actions logged yet.';
      logsEl.appendChild(li);
      return;
    }
    for (const entry of logs) {
      const li = document.createElement('li');
      const time = new Date(entry.timestamp).toLocaleString();
      appendText(li, 'log-time', time);
      appendText(li, 'log-type', `[${entry.type}]`);
      li.append(entry.message);
      logsEl.appendChild(li);
    }
  });
}

saveBtn.addEventListener('click', () => {
  const settings = {
    realTimeDedupEnabled: fields.realTimeDedupEnabled.checked,
    debounceMs: parseInt(fields.debounceMs.value, 10),
    autoGroupByDomain: fields.autoGroupByDomain.checked,
    minTabsPerGroup: parseInt(fields.minTabsPerGroup.value, 10),
    sortInsideGroups: fields.sortInsideGroups.checked,
    staleThresholdDays: parseInt(fields.staleThresholdDays.value, 10),
    autoCheckStale: fields.autoCheckStale.checked,
    intervalMinutes: parseInt(fields.intervalMinutes.value, 10),
    runOnStartup: fields.runOnStartup.checked,
  };

  chrome.storage.sync.set(settings, () => {
    chrome.runtime.sendMessage({ action: 'settingsUpdated' });
    savedEl.style.visibility = 'visible';
    setTimeout(() => {
      savedEl.style.visibility = 'hidden';
    }, 2000);
  });
});

loadSettings();
loadLogs();
