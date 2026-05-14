const DEFAULTS = {
  enabled: true,
  managerPanelHeight: 260
};

const enabledInput = document.querySelector("#enabled");

async function getSettings() {
  return chrome.storage.local.get(DEFAULTS);
}

async function saveSetting(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

getSettings().then((settings) => {
  enabledInput.checked = settings.enabled;
});

enabledInput.addEventListener("change", () => {
  saveSetting("enabled", enabledInput.checked);
});
