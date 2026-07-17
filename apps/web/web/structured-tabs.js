function tabsInGroup(group) {
  return Array.from(group?.querySelectorAll?.("[data-structured-tab]") || []);
}

function panelsInGroup(group) {
  return Array.from(group?.querySelectorAll?.("[data-structured-tab-panel]") || []);
}

export function activateStructuredTab(tab, options = {}) {
  const group = tab?.closest?.("[data-structured-tabs]");
  if (!group) return false;

  const panelId = tab.getAttribute("aria-controls");
  if (!panelId) return false;

  const tabs = tabsInGroup(group);
  const panels = panelsInGroup(group);
  if (!tabs.includes(tab) || !panels.some((panel) => panel.id === panelId)) return false;

  tabs.forEach((item) => {
    const active = item === tab;
    item.setAttribute("aria-selected", String(active));
    item.tabIndex = active ? 0 : -1;
  });
  panels.forEach((panel) => {
    panel.hidden = panel.id !== panelId;
  });

  if (options.focus) tab.focus();
  return true;
}

export function enhanceStructuredTabs(root) {
  if (!root) return;

  const groups = Array.from(root.querySelectorAll?.("[data-structured-tabs]") || []);
  if (root.matches?.("[data-structured-tabs]")) groups.unshift(root);

  groups.forEach((group) => {
    const tabs = tabsInGroup(group);
    const selectedTab = tabs.find((tab) => tab.getAttribute("aria-selected") === "true") || tabs[0];
    if (!selectedTab) return;

    group.classList.add("is-enhanced");
    activateStructuredTab(selectedTab);
  });
}

export function handleStructuredTabClick(event) {
  const tab = event.target?.closest?.("[data-structured-tab]");
  return tab ? activateStructuredTab(tab) : false;
}

export function handleStructuredTabKeydown(event) {
  const tab = event.target?.closest?.("[data-structured-tab]");
  if (!tab) return false;

  const group = tab.closest("[data-structured-tabs]");
  const tabs = tabsInGroup(group);
  const currentIndex = tabs.indexOf(tab);
  if (currentIndex === -1) return false;

  let nextIndex;
  if (["ArrowRight", "ArrowDown"].includes(event.key)) nextIndex = (currentIndex + 1) % tabs.length;
  if (["ArrowLeft", "ArrowUp"].includes(event.key)) nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = tabs.length - 1;
  if (nextIndex === undefined) return false;

  event.preventDefault();
  return activateStructuredTab(tabs[nextIndex], { focus: true });
}
