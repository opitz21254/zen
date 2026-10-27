/* Shared decisions for Space Freeze. Loaded as a classic script. */
var SpaceFreeze = (() => {
  function isHttp(url) {
    return typeof url === "string" && /^https?:/i.test(url);
  }

  function normalize(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      return String(url || "");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return parsed.href;
    }
    let path = parsed.pathname || "/";
    if (path.length > 1 && path.endsWith("/")) {
      path = path.slice(0, -1);
    }
    return parsed.origin + path + parsed.search;
  }

  function sameUrl(a, b) {
    if (!a || !b) {
      return false;
    }
    return normalize(a) === normalize(b);
  }

  function sameOrigin(a, b) {
    try {
      return new URL(a).origin === new URL(b).origin;
    } catch (e) {
      return false;
    }
  }

  function isContentInitiated(originUrl) {
    return isHttp(originUrl);
  }

  // True when an <a href> would leave the current document.
  function linkShouldFreeze(href, pageUrl) {
    if (!href || !pageUrl) {
      return false;
    }
    const trimmed = String(href).trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return false;
    }
    if (/^(javascript|mailto|tel|blob|data):/i.test(trimmed)) {
      return false;
    }
    let next;
    let page;
    try {
      next = new URL(trimmed, pageUrl);
      page = new URL(pageUrl);
    } catch (e) {
      return false;
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      return false;
    }
    return !sameUrl(next.href, page.href);
  }

  function targetStaysHere(target) {
    const value = String(target || "")
      .trim()
      .toLowerCase();
    return (
      value === "" || value === "_self" || value === "_top" || value === "_parent"
    );
  }

  /**
   * @returns {"ignore"|"adopt"|"allow"|"divert"}
   * ignore: not our concern
   * adopt: first real load of a frozen tab; remember this URL
   * allow: reload, redirect of an allowed load, or a user/chrome navigation
   * divert: site is leaving the locked URL; cancel and open a general tab
   */
  function decide(input) {
    if (!input || !input.frozen) {
      return "ignore";
    }
    if (input.type && input.type !== "main_frame") {
      return "ignore";
    }
    if (input.prefetch) {
      return "ignore";
    }
    if (!isHttp(input.url)) {
      return "ignore";
    }
    if (input.requestAlreadyAllowed) {
      return "allow";
    }
    if (!input.lockedUrl) {
      return "adopt";
    }
    if (sameUrl(input.url, input.lockedUrl)) {
      return "allow";
    }
    if (!isContentInitiated(input.originUrl)) {
      return "allow";
    }
    return "divert";
  }

  return {
    isHttp,
    normalize,
    sameUrl,
    sameOrigin,
    isContentInitiated,
    linkShouldFreeze,
    targetStaysHere,
    decide,
  };
})();
