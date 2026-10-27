/* Space Freeze background.
   Pinned tabs are the tabs Zen saves into a space. Their URL stays put.
   Site navigations open an unpinned tab, which Zen places in the general list. */

const DEFAULTS = {
  enabled: true,
  containers: {},
  tabOverrides: {},
};

let settings = structuredClone(DEFAULTS);
const pinned = new Map();
const allowedRequests = new Set();
const recentOpens = new Map();

function isFrozenSync(tab) {
  if (!settings.enabled || !tab?.pinned) {
    return false;
  }
  const store = tab.cookieStoreId || "firefox-default";
  if (Object.prototype.hasOwnProperty.call(settings.containers, store)) {
    if (settings.containers[store] === false) {
      return false;
    }
  }
  if (SpaceFreeze.isHttp(tab.url)) {
    const key = SpaceFreeze.normalize(tab.url);
    if (settings.tabOverrides[key] === false) {
      return false;
    }
  }
  return true;
}

function frozenForState(state, tabId) {
  if (!state) {
    return false;
  }
  return isFrozenSync({
    id: tabId,
    pinned: true,
    url: state.url,
    cookieStoreId: state.cookieStoreId,
  });
}

async function loadSettings() {
  const stored = await browser.storage.local.get(DEFAULTS);
  settings = {
    enabled: stored.enabled !== false,
    containers: stored.containers || {},
    tabOverrides: stored.tabOverrides || {},
  };
  for (const [id, state] of pinned) {
    const frozen = frozenForState(state, id);
    const changed = state.frozen !== frozen;
    state.frozen = frozen;
    if (changed) {
      notify(id, frozen);
    }
  }
}

function rememberTab(tab) {
  if (!tab || tab.id == null) {
    return;
  }
  if (!tab.pinned) {
    if (pinned.has(tab.id)) {
      pinned.delete(tab.id);
      notify(tab.id, false);
    }
    return;
  }
  const prev = pinned.get(tab.id);
  const state = prev || {
    url: null,
    navDepth: 0,
    settleUntil: 0,
    acceptUntil: 0,
    restoreUntil: 0,
    frozen: null,
  };
  state.cookieStoreId = tab.cookieStoreId;
  state.windowId = tab.windowId;
  if (!state.url && SpaceFreeze.isHttp(tab.url)) {
    state.url = tab.url;
  }
  const frozen = isFrozenSync({
    pinned: true,
    url: state.url || tab.url,
    cookieStoreId: tab.cookieStoreId,
  });
  const changed = state.frozen !== frozen;
  state.frozen = frozen;
  pinned.set(tab.id, state);
  if (changed) {
    notify(tab.id, state.frozen);
  }
}

function notify(tabId, frozen) {
  browser.tabs.sendMessage(tabId, { type: "freeze-state", frozen }).catch(() => {});
}

async function refreshPinned() {
  const tabs = await browser.tabs.query({ pinned: true });
  const seen = new Set();
  for (const tab of tabs) {
    seen.add(tab.id);
    rememberTab(tab);
  }
  for (const id of [...pinned.keys()]) {
    if (!seen.has(id)) {
      pinned.delete(id);
    }
  }
}

function isPrefetch(details) {
  const headers = details.requestHeaders || [];
  return headers.some(header => {
    const name = String(header.name || "").toLowerCase();
    const value = String(header.value || "").toLowerCase();
    if (name === "x-moz" && value.includes("prefetch")) {
      return true;
    }
    if (
      (name === "purpose" || name === "sec-purpose" || name === "x-purpose") &&
      (value.includes("prefetch") || value.includes("preview"))
    ) {
      return true;
    }
    return false;
  });
}

function beginAllowed(state, requestId) {
  allowedRequests.add(requestId);
  state.navDepth += 1;
}

function endAllowed(tabId, requestId, finalUrl, ok) {
  allowedRequests.delete(requestId);
  const state = pinned.get(tabId);
  if (!state) {
    return;
  }
  state.navDepth = Math.max(0, state.navDepth - 1);
  if (ok && SpaceFreeze.isHttp(finalUrl) && state.acceptUntil > Date.now()) {
    state.url = finalUrl;
  }
}

async function openInGeneralArea(url, openerTabId, windowId, cookieStoreId) {
  if (!SpaceFreeze.isHttp(url)) {
    return;
  }
  const key = `${openerTabId}:${SpaceFreeze.normalize(url)}`;
  const now = Date.now();
  const previous = recentOpens.get(key);
  if (previous && now - previous < 1200) {
    return;
  }
  recentOpens.set(key, now);

  // Unpinned, with no opener, so Zen files it in the general tab list.
  const create = { url, active: true };
  if (windowId != null) {
    create.windowId = windowId;
  }
  if (cookieStoreId && cookieStoreId !== "firefox-default") {
    create.cookieStoreId = cookieStoreId;
  }
  let tab;
  try {
    tab = await browser.tabs.create(create);
  } catch (e) {
    delete create.cookieStoreId;
    try {
      tab = await browser.tabs.create(create);
    } catch (err) {
      console.error("Space Freeze could not open a tab", err);
      return;
    }
  }
  if (tab?.pinned) {
    try {
      await browser.tabs.update(tab.id, { pinned: false });
    } catch (e) {
      // The tab is already in the general list if unpinning is refused.
    }
  }
}

function onBeforeRequest(details) {
  const state = pinned.get(details.tabId);
  let decision = SpaceFreeze.decide({
    url: details.url,
    type: details.type,
    originUrl: details.originUrl,
    frozen: !!state?.frozen,
    lockedUrl: state?.url || null,
    requestAlreadyAllowed: allowedRequests.has(details.requestId),
    prefetch: isPrefetch(details),
  });

  if (
    decision === "divert" &&
    state?.settleUntil > Date.now() &&
    state.url &&
    SpaceFreeze.sameOrigin(details.url, state.url)
  ) {
    decision = "allow";
  }

  if (decision === "ignore" || !state) {
    return {};
  }

  if (decision === "adopt") {
    state.url = details.url;
    state.settleUntil = Date.now() + 800;
    state.acceptUntil = Date.now() + 3000;
    beginAllowed(state, details.requestId);
    return {};
  }

  if (decision === "allow") {
    beginAllowed(state, details.requestId);
    if (!state.url || !SpaceFreeze.sameUrl(details.url, state.url)) {
      state.acceptUntil = Date.now() + 3000;
    }
    return {};
  }

  openInGeneralArea(
    details.url,
    details.tabId,
    state.windowId,
    state.cookieStoreId
  );
  return { cancel: true };
}

function onRequestDone(details) {
  if (details.tabId < 0) {
    return;
  }
  const ok = details.error == null;
  endAllowed(details.tabId, details.requestId, details.url, ok);
}

async function onTabUpdated(tabId, changeInfo, tab) {
  if (changeInfo.pinned === false) {
    pinned.delete(tabId);
    notify(tabId, false);
    return;
  }

  const becamePinned = changeInfo.pinned === true;
  const urlChanged = !!changeInfo.url;
  if (!tab.pinned && !becamePinned) {
    return;
  }

  if (!pinned.has(tabId) || becamePinned || changeInfo.cookieStoreId) {
    rememberTab(tab);
  } else {
    const state = pinned.get(tabId);
    state.cookieStoreId = tab.cookieStoreId;
    state.windowId = tab.windowId;
    const frozen = isFrozenSync({
      pinned: true,
      url: state.url || tab.url,
      cookieStoreId: tab.cookieStoreId,
    });
    if (state.frozen !== frozen) {
      state.frozen = frozen;
      notify(tabId, frozen);
    }
  }

  const state = pinned.get(tabId);
  if (!state?.frozen || !urlChanged || !state.url) {
    if (state && !state.url && SpaceFreeze.isHttp(changeInfo.url)) {
      state.url = changeInfo.url;
    }
    return;
  }

  if (state.restoreUntil > Date.now()) {
    return;
  }

  if (state.navDepth > 0 && !(state.acceptUntil > Date.now())) {
    state.navDepth = 0;
  }

  if (state.navDepth > 0 || state.acceptUntil > Date.now()) {
    if (SpaceFreeze.isHttp(changeInfo.url)) {
      state.url = changeInfo.url;
    }
    return;
  }

  if (SpaceFreeze.sameUrl(changeInfo.url, state.url)) {
    state.url = changeInfo.url;
    return;
  }

  const drifted = changeInfo.url;
  const locked = state.url;
  state.restoreUntil = Date.now() + 2000;
  if (SpaceFreeze.isHttp(drifted)) {
    openInGeneralArea(drifted, tabId, tab.windowId, tab.cookieStoreId);
  }
  try {
    await browser.tabs.update(tabId, { url: locked });
  } catch (e) {
    console.error("Space Freeze could not restore the locked URL", e);
  }
}

browser.webRequest.onBeforeRequest.addListener(
  onBeforeRequest,
  { urls: ["<all_urls>"], types: ["main_frame"] },
  ["blocking", "requestHeaders"]
);

browser.webRequest.onCompleted.addListener(onRequestDone, {
  urls: ["<all_urls>"],
  types: ["main_frame"],
});

browser.webRequest.onErrorOccurred.addListener(onRequestDone, {
  urls: ["<all_urls>"],
  types: ["main_frame"],
});

browser.tabs.onUpdated.addListener(onTabUpdated);
browser.tabs.onRemoved.addListener(tabId => pinned.delete(tabId));
browser.tabs.onCreated.addListener(tab => {
  if (tab.pinned) {
    rememberTab(tab);
  }
});

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return;
  }
  if (message.type === "query-freeze") {
    const tab = sender.tab;
    const state = tab && pinned.get(tab.id);
    const frozen = state ? state.frozen : !!(tab && isFrozenSync(tab));
    sendResponse({ frozen });
    return;
  }
  if (message.type === "open") {
    const tab = sender.tab;
    const state = tab && pinned.get(tab.id);
    const frozen = state ? state.frozen : !!(tab && isFrozenSync(tab));
    if (!tab || !frozen || !SpaceFreeze.isHttp(message.url)) {
      sendResponse({ ok: false });
      return;
    }
    openInGeneralArea(
      message.url,
      tab.id,
      tab.windowId,
      state?.cookieStoreId || tab.cookieStoreId
    );
    sendResponse({ ok: true });
  }
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }
  loadSettings().catch(err => console.error(err));
});

browser.runtime.onInstalled.addListener(() => {
  browser.storage.local.get(DEFAULTS).then(stored => {
    const next = Object.assign({}, DEFAULTS, stored);
    if (!stored.containers) {
      next.containers = {};
    }
    if (!stored.tabOverrides) {
      next.tabOverrides = {};
    }
    return browser.storage.local.set(next);
  });
});

try {
  browser.contextMenus.create({
    id: "space-freeze-toggle-tab",
    title: "Toggle Space Freeze for this pinned tab",
    contexts: ["tab"],
  });
} catch (e) {
  // Created again after a reload of the temporary add-on.
}

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "space-freeze-toggle-tab" || !tab?.pinned) {
    return;
  }
  if (!SpaceFreeze.isHttp(tab.url)) {
    return;
  }
  const key = SpaceFreeze.normalize(tab.url);
  const overrides = Object.assign({}, settings.tabOverrides);
  if (overrides[key] === false) {
    delete overrides[key];
  } else {
    overrides[key] = false;
  }
  await browser.storage.local.set({ tabOverrides: overrides });
});

if (browser.menus?.onShown) {
  browser.menus.onShown.addListener(async (info, tab) => {
    const pinnedTab = !!tab?.pinned && SpaceFreeze.isHttp(tab.url);
    const frozen = pinnedTab && isFrozenSync(tab);
    try {
      await browser.contextMenus.update("space-freeze-toggle-tab", {
        visible: pinnedTab,
        title: frozen
          ? "Unfreeze this pinned tab"
          : "Freeze this pinned tab",
      });
      browser.menus.refresh();
    } catch (e) {
      // The menu can close before the update lands.
    }
  });
}

loadSettings()
  .then(refreshPinned)
  .catch(err => console.error(err));
