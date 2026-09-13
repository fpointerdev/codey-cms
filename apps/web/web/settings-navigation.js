const tabs = ["launch", "general", "style", "marketing", "storage", "email", "multilingual", "updates", "security"];

export function selectSettingsTab(hash = window.location.hash, root = document) {
  const requested = String(hash || "").replace(/^#/, "");
  const tab = tabs.includes(requested) ? requested : "launch";
  const input = root.getElementById?.(`settings-tab-${tab}`);
  if (!input) return false;
  input.checked = true;
  return true;
}

export function saveSettingsTab(input) {
  const tab = input?.id?.replace(/^settings-tab-/, "");
  if (input?.name !== "settings-tab" || !input.checked || !tabs.includes(tab)) return;
  window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}#${tab}`);
}
