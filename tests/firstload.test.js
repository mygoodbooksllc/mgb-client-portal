// Plain node: `node tests/firstload.test.js`. Static guards for the
// first-load crash a brand-new bookkeeper hit (2026-10-15): an empty client
// roster made baseClient undefined and the whole tree threw on first render.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "app.jsx"), "utf8");

const bc = src.slice(src.indexOf("const baseClient = useMemo("));
const chain = bc.slice(0, bc.indexOf("[selectedClientId, visibleClients, rosterClients]"));
assert(/CLIENTS\[0\]\s*\|\|[\s\S]*withClientDataDefaults\([\s\S]*isPlaceholder: true/.test(chain),
  "baseClient must end in a placeholder so an empty roster can't crash App");

const eb = src.slice(src.indexOf("class ErrorBoundary"), src.indexOf("class ErrorBoundary") + 3000);
assert(/MGB_reportError\(/.test(eb), "ErrorBoundary must log to client_errors");
assert(/Copy details/.test(eb) && /Error code/.test(eb), "boundary must show a code and Copy details");
assert(/ROSTER_LOAD_ERROR/.test(src) && /ROSTER_LOAD_ERROR/.test(fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")), "roster failure must be flagged and shown");
console.log("firstload.test.js ok");
