// Plain node, no framework: `node components/auth/browserLabel.test.js`.
// MGB_parseBrowser in app.jsx ("Chrome 141 · macOS"), used by HR › Members ›
// Last seen and the usage_events.browser column (view-as-full-app-spec.md).
// The function is sliced out of app.jsx by name and run in a vm.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "..", "..", "app.jsx"), "utf8");
const start = src.indexOf("function MGB_parseBrowser(");
assert.ok(start >= 0, "MGB_parseBrowser not found in app.jsx");
const end = src.indexOf("\n}\n", start);
assert.ok(end > start, "end of MGB_parseBrowser not found");
const sandbox = { String };
vm.createContext(sandbox);
vm.runInContext(src.slice(start, end + 2) + "\nthis.MGB_parseBrowser = MGB_parseBrowser;", sandbox);
const parse = sandbox.MGB_parseBrowser;

let n = 0;
function t(name, fn) {
  try {
    fn();
  } catch (e) {
    console.error("FAIL " + name);
    throw e;
  }
  n++;
}

t("Chrome on macOS", () =>
  assert.strictEqual(
    parse("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"),
    "Chrome 141 · macOS",
  ));

t("Edge on Windows (Edge before Chrome)", () =>
  assert.strictEqual(
    parse(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.3485.54",
    ),
    "Edge 140 · Windows",
  ));

t("Firefox on Linux", () =>
  assert.strictEqual(parse("Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0"), "Firefox 131 · Linux"));

t("Safari on iPhone", () =>
  assert.strictEqual(
    parse(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    ),
    "Safari 18 · iOS",
  ));

t("Chrome on iOS (CriOS)", () =>
  assert.strictEqual(
    parse(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1",
    ),
    "Chrome 141 · iOS",
  ));

t("Chrome on Android (Android before Linux)", () =>
  assert.strictEqual(
    parse("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36"),
    "Chrome 141 · Android",
  ));

t("Safari on macOS", () =>
  assert.strictEqual(
    parse("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15"),
    "Safari 18 · macOS",
  ));

t("ChromeOS", () =>
  assert.strictEqual(
    parse("Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"),
    "Chrome 141 · ChromeOS",
  ));

t("empty, null and junk", () => {
  assert.strictEqual(parse(""), "Unknown browser");
  assert.strictEqual(parse(null), "Unknown browser");
  assert.strictEqual(parse(undefined), "Unknown browser");
  assert.strictEqual(parse("curl/8.4.0"), "Unknown browser");
});

t("capped at 60 characters", () => {
  const out = parse("Mozilla/5.0 (Windows NT 10.0) Chrome/" + "9".repeat(200) + ".0");
  assert.strictEqual(out.length, 60);
  assert.ok(out.startsWith("Chrome 999"));
});

console.log("browserLabel: " + n + " passed");
