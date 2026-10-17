// Plain node, no framework: `node components/staff/staffNavLabels.test.js`.
// Source-level guards for the Desk rename follow-ups: Today is always named
// "Today", and the Slate tab is findable in Cmd/Ctrl+K as "tasks".

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const nav = fs.readFileSync(path.join(__dirname, "StaffNav.jsx"), "utf8");
const bar = fs.readFileSync(path.join(__dirname, "TopBar.jsx"), "utf8");

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

t("Today's label is the plain string Today, never WB_NAME", () => {
  const block = nav.slice(nav.indexOf('key: "today"'), nav.indexOf('key: "inbox"'));
  assert.ok(/\blabel: "Today",/.test(block));
  assert.ok(!/get label/.test(block));
  assert.ok(!/WB_NAME/.test(block.replace(/\/\/.*$/gm, "")));
});

t("the Slate tab carries tasks keywords", () => {
  const m = nav.match(/\{ key: "tasks", label: "Slate", keywords: \[([^\]]*)\]/);
  assert.ok(m);
  assert.ok(m[1].includes('"tasks"') && m[1].includes('"my tasks"'));
});

t("Cmd+K page rows pass keywords and the filter matches them", () => {
  assert.ok(/keywords: t\.keywords/.test(bar));
  assert.ok(/\(r\.keywords \|\| \[\]\)\.some/.test(bar));
});

console.log("staffNavLabels: " + n + " checks passed");
