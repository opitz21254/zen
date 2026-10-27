/* Page-world hooks. Runs only while <html data-space-freeze="1"> is set.
   location.href still goes through the background network listener. */
(() => {
  if (window.__spaceFreezeInstalled) {
    return;
  }
  window.__spaceFreezeInstalled = true;

  const nativeOpen = window.open.bind(window);
  const nativePush = history.pushState.bind(history);
  const nativeReplace = history.replaceState.bind(history);
  const started = Date.now();

  function enabled() {
    return document.documentElement?.dataset.spaceFreeze === "1";
  }

  function abs(url) {
    try {
      return new URL(url, location.href);
    } catch (e) {
      return null;
    }
  }

  function pathOf(url) {
    const path = url.pathname || "/";
    return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  }

  function navigatesAway(url) {
    const next = abs(url);
    if (!next || (next.protocol !== "http:" && next.protocol !== "https:")) {
      return false;
    }
    return (
      next.origin !== location.origin ||
      pathOf(next) !== pathOf(location) ||
      next.search !== location.search
    );
  }

  function shouldTrap(url) {
    if (!enabled() || !navigatesAway(url)) {
      return false;
    }
    // Let a same-origin redirect finish while the pinned page is still loading.
    if (Date.now() - started < 800) {
      const next = abs(url);
      if (next && next.origin === location.origin) {
        return false;
      }
    }
    return true;
  }

  function ask(url) {
    const next = abs(url);
    if (!next) {
      return;
    }
    try {
      if (typeof window.spaceFreezeOpen === "function") {
        window.spaceFreezeOpen(next.href);
        return;
      }
    } catch (e) {
      // The content-script bridge may not be installed yet.
    }
    const root = document.documentElement;
    if (!root) {
      return;
    }
    root.setAttribute("data-space-freeze-pending", next.href);
    root.dispatchEvent(new Event("space-freeze-pending", { bubbles: true }));
  }

  window.open = function (url, target, features) {
    const where = String(target ?? "_blank").toLowerCase();
    const sameTab =
      where === "_self" || where === "_parent" || where === "_top";
    if (url && sameTab && shouldTrap(url)) {
      ask(url);
      return null;
    }
    return nativeOpen(url, target, features);
  };

  function guard(native) {
    return function (state, title, url) {
      if (url != null && shouldTrap(url)) {
        ask(url);
        return;
      }
      return native(state, title, url);
    };
  }

  history.pushState = guard(nativePush);
  history.replaceState = guard(nativeReplace);

  try {
    const locationProto = Location.prototype;
    const href = Object.getOwnPropertyDescriptor(locationProto, "href");
    if (href?.set && href.configurable) {
      Object.defineProperty(locationProto, "href", {
        configurable: true,
        enumerable: href.enumerable,
        get: href.get,
        set(value) {
          if (shouldTrap(value)) {
            ask(value);
            return;
          }
          href.set.call(this, value);
        },
      });
    }
    for (const name of ["assign", "replace"]) {
      const original = locationProto[name];
      if (typeof original !== "function") {
        continue;
      }
      locationProto[name] = function (url) {
        if (shouldTrap(url)) {
          ask(url);
          return;
        }
        return original.call(this, url);
      };
    }
  } catch (e) {
    // location is often non-configurable. The network listener still locks it.
  }
})();
