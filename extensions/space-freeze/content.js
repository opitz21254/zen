/* Rewrites same-tab links in a frozen (pinned / in-space) tab. */

let frozen = false;

function markDocument(isFrozen) {
  frozen = !!isFrozen;
  const root = document.documentElement;
  if (!root) {
    return;
  }
  if (frozen) {
    root.dataset.spaceFreeze = "1";
  } else {
    delete root.dataset.spaceFreeze;
  }
  try {
    sessionStorage.setItem("spaceFreeze", frozen ? "1" : "0");
  } catch (e) {
    // Some documents refuse sessionStorage.
  }
}

function publishOpener() {
  try {
    if (window.wrappedJSObject?.spaceFreezeOpen) {
      return;
    }
    const opener = exportFunction(url => {
      requestOpen(String(url));
    }, window);
    window.wrappedJSObject.spaceFreezeOpen = opener;
  } catch (e) {
    // The attribute/event bridge in page-hook.js covers this case.
  }
}

function requestOpen(url) {
  if (!frozen || !SpaceFreeze.isHttp(url)) {
    return;
  }
  browser.runtime
    .sendMessage({ type: "open", url })
    .then(response => {
      if (!response?.ok) {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    })
    .catch(() => {
      window.open(url, "_blank", "noopener,noreferrer");
    });
}

function shouldHandleAnchor(anchor) {
  if (!anchor || anchor.closest("a, area") !== anchor) {
    return false;
  }
  if (anchor.hasAttribute("download")) {
    return false;
  }
  if (!SpaceFreeze.targetStaysHere(anchor.getAttribute("target"))) {
    return false;
  }
  return SpaceFreeze.linkShouldFreeze(anchor.getAttribute("href"), location.href);
}

function rewriteAnchor(anchor) {
  if (!shouldHandleAnchor(anchor) && anchor.dataset.spaceFreeze !== "1") {
    return;
  }
  if (!frozen) {
    restoreAnchor(anchor);
    return;
  }
  if (!shouldHandleAnchor(anchor) && anchor.dataset.spaceFreeze === "1") {
    return;
  }
  if (anchor.dataset.spaceFreeze !== "1") {
    anchor.dataset.spaceFreezeTarget = anchor.getAttribute("target") ?? "";
    anchor.dataset.spaceFreezeRel = anchor.getAttribute("rel") ?? "";
    anchor.dataset.spaceFreeze = "1";
  }
  anchor.setAttribute("target", "_blank");
  const rel = new Set(
    (anchor.getAttribute("rel") || "").split(/\s+/).filter(Boolean)
  );
  rel.delete("opener");
  rel.add("noopener");
  rel.add("noreferrer");
  anchor.setAttribute("rel", [...rel].join(" "));
}

function restoreAnchor(anchor) {
  if (anchor.dataset.spaceFreeze !== "1") {
    return;
  }
  const target = anchor.dataset.spaceFreezeTarget || "";
  const rel = anchor.dataset.spaceFreezeRel || "";
  if (target) {
    anchor.setAttribute("target", target);
  } else {
    anchor.removeAttribute("target");
  }
  if (rel) {
    anchor.setAttribute("rel", rel);
  } else {
    anchor.removeAttribute("rel");
  }
  delete anchor.dataset.spaceFreeze;
  delete anchor.dataset.spaceFreezeTarget;
  delete anchor.dataset.spaceFreezeRel;
}

function rewriteForm(form) {
  if (!(form instanceof HTMLFormElement)) {
    return;
  }
  if (!frozen) {
    restoreForm(form);
    return;
  }
  const target = (form.getAttribute("target") || "").toLowerCase();
  if (form.dataset.spaceFreeze === "1") {
    return;
  }
  if (target && !SpaceFreeze.targetStaysHere(target)) {
    return;
  }
  form.dataset.spaceFreezeTarget = form.getAttribute("target") ?? "";
  form.dataset.spaceFreeze = "1";
  form.setAttribute("target", "_blank");
}

function restoreForm(form) {
  if (form.dataset.spaceFreeze !== "1") {
    return;
  }
  const target = form.dataset.spaceFreezeTarget || "";
  if (target) {
    form.setAttribute("target", target);
  } else {
    form.removeAttribute("target");
  }
  delete form.dataset.spaceFreeze;
  delete form.dataset.spaceFreezeTarget;
}

function scan(root) {
  if (!root || root.nodeType !== 1) {
    return;
  }
  if (root.localName === "a" || root.localName === "area") {
    rewriteAnchor(root);
  }
  if (root.localName === "form") {
    rewriteForm(root);
  }
  if (root.querySelectorAll) {
    root.querySelectorAll("a[href], area[href]").forEach(rewriteAnchor);
    root.querySelectorAll("form").forEach(rewriteForm);
  }
}

function restoreAll() {
  document.querySelectorAll("a[data-space-freeze], area[data-space-freeze]").forEach(restoreAnchor);
  document.querySelectorAll("form[data-space-freeze]").forEach(restoreForm);
}

function onClick(event) {
  if (!frozen || event.defaultPrevented) {
    return;
  }
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  const anchor = event.target?.closest?.("a[href], area[href]");
  if (!anchor) {
    return;
  }
  // Rewritten links already have target=_blank, so shouldHandleAnchor is false.
  // Still take the click so the page cannot also navigate this tab.
  const owned = anchor.dataset.spaceFreeze === "1";
  if (!owned && !shouldHandleAnchor(anchor)) {
    return;
  }
  if (!SpaceFreeze.linkShouldFreeze(anchor.getAttribute("href"), location.href)) {
    return;
  }
  let next;
  try {
    next = new URL(anchor.getAttribute("href"), location.href).href;
  } catch (e) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  requestOpen(next);
}

function onSubmit(event) {
  if (!frozen) {
    return;
  }
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }
  rewriteForm(form);
}

function onPending(event) {
  const root = document.documentElement;
  const url = root?.getAttribute("data-space-freeze-pending");
  if (!url) {
    return;
  }
  root.removeAttribute("data-space-freeze-pending");
  requestOpen(url);
}

const observer = new MutationObserver(records => {
  for (const record of records) {
    if (record.type === "childList") {
      record.addedNodes.forEach(scan);
    } else if (record.type === "attributes" && record.target) {
      scan(record.target);
    }
  }
});

function start() {
  const root = document.documentElement;
  if (!root) {
    return;
  }
  try {
    if (sessionStorage.getItem("spaceFreeze") === "1") {
      markDocument(true);
      scan(document);
    }
  } catch (e) {
    // Ignore unavailable sessionStorage.
  }
  publishOpener();
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href", "target"],
  });
  document.addEventListener("click", onClick, true);
  document.addEventListener("submit", onSubmit, true);
  document.addEventListener("space-freeze-pending", onPending, true);
  browser.runtime
    .sendMessage({ type: "query-freeze" })
    .then(response => {
      markDocument(!!response?.frozen);
      if (frozen) {
        scan(document);
      } else {
        restoreAll();
      }
      return frozen;
    })
    .catch(() => false);
}

browser.runtime.onMessage.addListener(message => {
  if (!message || message.type !== "freeze-state") {
    return;
  }
  markDocument(!!message.frozen);
  if (frozen) {
    scan(document);
  } else {
    restoreAll();
  }
});

start();
