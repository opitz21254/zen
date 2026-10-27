const fs = require("fs");
const path = require("path");
const vm = require("vm");

const context = { URL };
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "..", "logic.js"), "utf8"),
  context
);
const SpaceFreeze = context.SpaceFreeze;

let failed = 0;
function assert(cond, message) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", message);
  }
}

const page = "https://example.com/app";
assert(SpaceFreeze.linkShouldFreeze("https://example.com/other", page), "other url");
assert(
  SpaceFreeze.linkShouldFreeze("/elsewhere", page),
  "relative url"
);
assert(!SpaceFreeze.linkShouldFreeze("#section", page), "hash only");
assert(
  !SpaceFreeze.linkShouldFreeze("https://example.com/app#x", page),
  "same document hash"
);
assert(!SpaceFreeze.linkShouldFreeze("javascript:void(0)", page), "javascript");
assert(!SpaceFreeze.linkShouldFreeze("mailto:a@b.c", page), "mailto");
assert(
  SpaceFreeze.linkShouldFreeze("https://example.com/app?q=1", page),
  "query change"
);
assert(
  SpaceFreeze.sameUrl("https://Example.com/a/", "https://example.com/a"),
  "slash and host"
);
assert(
  !SpaceFreeze.sameUrl("https://example.com/a", "https://example.com/a?b=1"),
  "query differs"
);
assert(SpaceFreeze.targetStaysHere(""), "empty target");
assert(SpaceFreeze.targetStaysHere("_self"), "self");
assert(!SpaceFreeze.targetStaysHere("_blank"), "blank");

const base = {
  type: "main_frame",
  prefetch: false,
  frozen: true,
  requestAlreadyAllowed: false,
};

assert(
  SpaceFreeze.decide({ ...base, frozen: false, url: "https://a.test/", lockedUrl: null }) ===
    "ignore",
  "unfrozen"
);
assert(
  SpaceFreeze.decide({
    ...base,
    url: "https://a.test/",
    lockedUrl: null,
    originUrl: "https://a.test/",
  }) === "adopt",
  "first load"
);
assert(
  SpaceFreeze.decide({
    ...base,
    url: "https://a.test/path/",
    lockedUrl: "https://a.test/path",
    originUrl: "https://a.test/path",
  }) === "allow",
  "reload"
);
assert(
  SpaceFreeze.decide({
    ...base,
    url: "https://other.test/",
    lockedUrl: "https://a.test/",
    originUrl: "https://a.test/",
  }) === "divert",
  "site navigation"
);
assert(
  SpaceFreeze.decide({
    ...base,
    url: "https://other.test/",
    lockedUrl: "https://a.test/",
    originUrl: undefined,
  }) === "allow",
  "address bar"
);
assert(
  SpaceFreeze.decide({
    ...base,
    url: "https://other.test/",
    lockedUrl: "https://a.test/",
    originUrl: "https://a.test/",
    requestAlreadyAllowed: true,
  }) === "allow",
  "redirect chain"
);
assert(
  SpaceFreeze.decide({
    ...base,
    url: "https://other.test/",
    lockedUrl: "https://a.test/",
    prefetch: true,
    originUrl: "https://a.test/",
  }) === "ignore",
  "prefetch"
);
assert(
  SpaceFreeze.decide({
    ...base,
    type: "sub_frame",
    url: "https://other.test/",
    lockedUrl: "https://a.test/",
    originUrl: "https://a.test/",
  }) === "ignore",
  "subframe"
);

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("logic tests passed");
