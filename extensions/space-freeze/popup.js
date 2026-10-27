const enabledInput = document.querySelector("#enabled");
const containersEl = document.querySelector("#containers");
const tabsEl = document.querySelector("#tabs");

let settings = {
  enabled: true,
  containers: {},
  tabOverrides: {},
};

function containerChecked(id) {
  return settings.containers[id] !== false;
}

function tabChecked(url) {
  if (!SpaceFreeze.isHttp(url)) {
    return false;
  }
  return settings.tabOverrides[SpaceFreeze.normalize(url)] !== false;
}

function row(label, detail, checked, disabled, onChange) {
  const wrap = document.createElement("label");
  wrap.className = "row";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.disabled = disabled;
  input.addEventListener("change", () => onChange(input.checked));
  const text = document.createElement("span");
  const title = document.createElement("b");
  title.textContent = label;
  text.append(title);
  if (detail) {
    const sub = document.createElement("small");
    sub.textContent = detail;
    text.append(sub);
  }
  wrap.append(input, text);
  return wrap;
}

async function save(partial) {
  settings = Object.assign({}, settings, partial);
  await browser.storage.local.set(partial);
  render();
}

function render() {
  document.body.classList.toggle("disabled", !settings.enabled);
  enabledInput.checked = settings.enabled;
  containersEl.replaceChildren();
  tabsEl.replaceChildren();

  const identities = window.__identities || [];
  const containers = [
    { cookieStoreId: "firefox-default", name: "Default profile", color: "" },
    ...identities.map(identity => ({
      cookieStoreId: identity.cookieStoreId,
      name: identity.name,
      color: identity.color,
    })),
  ];
  for (const container of containers) {
    containersEl.append(
      row(
        container.name,
        "",
        containerChecked(container.cookieStoreId),
        !settings.enabled,
        async checked => {
          const next = Object.assign({}, settings.containers);
          if (checked) {
            delete next[container.cookieStoreId];
          } else {
            next[container.cookieStoreId] = false;
          }
          await save({ containers: next });
        }
      )
    );
  }

  const tabs = window.__pinnedTabs || [];
  if (!tabs.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No pinned tabs in this window.";
    tabsEl.append(empty);
    return;
  }
  for (const tab of tabs) {
    const store = tab.cookieStoreId || "firefox-default";
    const containerOff = !containerChecked(store);
    let host = tab.url;
    try {
      host = new URL(tab.url).host;
    } catch (e) {
      host = tab.url;
    }
    tabsEl.append(
      row(
        tab.title || host || "Pinned tab",
        host,
        settings.enabled && !containerOff && tabChecked(tab.url),
        !settings.enabled || containerOff || !SpaceFreeze.isHttp(tab.url),
        async checked => {
          const key = SpaceFreeze.normalize(tab.url);
          const next = Object.assign({}, settings.tabOverrides);
          if (checked) {
            delete next[key];
          } else {
            next[key] = false;
          }
          await save({ tabOverrides: next });
        }
      )
    );
  }
}

enabledInput.addEventListener("change", () => {
  save({ enabled: enabledInput.checked });
});

async function init() {
  const stored = await browser.storage.local.get({
    enabled: true,
    containers: {},
    tabOverrides: {},
  });
  settings = {
    enabled: stored.enabled !== false,
    containers: stored.containers || {},
    tabOverrides: stored.tabOverrides || {},
  };
  try {
    window.__identities = await browser.contextualIdentities.query({});
  } catch (e) {
    window.__identities = [];
  }
  window.__pinnedTabs = await browser.tabs.query({
    pinned: true,
    currentWindow: true,
  });
  render();
}

init().catch(err => {
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = "Space Freeze could not read its settings.";
  document.body.append(empty);
  console.error(err);
});
