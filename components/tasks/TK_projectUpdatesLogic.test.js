// Node test for TK_projectUpdatesLogic.js (Slate plus project status updates
// + Portfolio). Run: node components/tasks/TK_projectUpdatesLogic.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const L = require("./TK_projectUpdatesLogic.js");

let n = 0;
function t(name, fn) {
  try {
    fn();
    n++;
  } catch (e) {
    console.error("FAIL: " + name);
    throw e;
  }
}

const DAY = 86400000;
const NOW = new Date(2026, 9, 28, 12, 0, 0).getTime(); // Oct 28 2026, local noon
const iso = (ms) => new Date(ms).toISOString();

t("statuses match the database check and always carry a word", () => {
  assert.deepStrictEqual(L.TKPU_STATUSES.map((s) => s.key), ["on_track", "at_risk", "off_track", "done"]);
  L.TKPU_STATUSES.forEach((s) => assert.ok(s.label.length > 2));
  assert.strictEqual(L.TKPU_status("at_risk").label, "At risk");
  assert.strictEqual(L.TKPU_status("nope").label, "No status yet");
  assert.strictEqual(L.TKPU_status(undefined), L.TKPU_NONE);
  assert.ok(L.TKPU_isStatus("done"));
  assert.ok(!L.TKPU_isStatus("none"));
  const sql = fs.readFileSync(path.join(__dirname, "../../supabase/slateplus-project-updates.sql"), "utf8");
  assert.ok(/status in \('on_track', 'at_risk', 'off_track', 'done'\)/.test(sql));
  assert.ok(/between 1 and 1000/.test(sql));
  assert.strictEqual(L.TKPU_BODY_MAX, 1000);
});

t("status rank: off track, at risk, on track, none, done", () => {
  const order = ["off_track", "at_risk", "on_track", "none", "done"].map((k) => L.TKPU_status(k).rank);
  assert.deepStrictEqual(order, [0, 1, 2, 3, 4]);
});

t("draft check", () => {
  assert.strictEqual(L.TKPU_checkDraft({ status: "", body: "x" }).field, "status");
  assert.strictEqual(L.TKPU_checkDraft({ status: "on_track", body: "   " }).field, "body");
  assert.strictEqual(L.TKPU_checkDraft({ status: "on_track", body: "x".repeat(1001) }).field, "body");
  assert.ok(L.TKPU_checkDraft({ status: "on_track", body: "  " + "x".repeat(1000) + "  " }).ok);
  assert.ok(!L.TKPU_checkDraft(null).ok);
});

t("counter shows only from 900", () => {
  assert.strictEqual(L.TKPU_counterText("x".repeat(899)), "");
  assert.strictEqual(L.TKPU_counterText("x".repeat(900)), "100 characters left");
  assert.strictEqual(L.TKPU_counterText("x".repeat(999)), "1 character left");
  assert.strictEqual(L.TKPU_counterText("x".repeat(1001)), "1 character over");
  assert.strictEqual(L.TKPU_counterText("x".repeat(1005)), "5 characters over");
  assert.strictEqual(L.TKPU_counterText(null), "");
});

t("when text: today, yesterday, short date, other year", () => {
  assert.strictEqual(L.TKPU_whenText(iso(NOW - 3600000), NOW), "today");
  assert.strictEqual(L.TKPU_whenText(iso(NOW - DAY), NOW), "yesterday");
  assert.strictEqual(L.TKPU_whenText(iso(new Date(2026, 9, 3, 9).getTime()), NOW), "Oct 3");
  assert.strictEqual(L.TKPU_whenText(iso(new Date(2025, 11, 30, 9).getTime()), NOW), "Dec 30, 2025");
  // DST: just after midnight on the day after clocks spring forward (US
  // 2026-03-08), anything on Mar 8 is still "yesterday".
  var dstNow = new Date(2026, 2, 9, 0, 30).getTime();
  assert.strictEqual(L.TKPU_whenText(iso(new Date(2026, 2, 8, 0, 10).getTime()), dstNow), "yesterday");
  assert.strictEqual(L.TKPU_whenText(iso(new Date(2026, 2, 7, 23, 50).getTime()), dstNow), "Mar 7");
  assert.strictEqual(L.TKPU_whenText("garbage", NOW), "");
  assert.strictEqual(L.TKPU_whenText(null, NOW), "");
});

t("byline", () => {
  const u = { created_at: iso(NOW - 60000), author_email: "g@x.com" };
  assert.strictEqual(L.TKPU_bylineText(u, () => "Grace", NOW), "Updated today by Grace");
  assert.strictEqual(L.TKPU_bylineText(u, null, NOW), "Updated today");
  assert.strictEqual(L.TKPU_bylineText(null), "");
});

t("stale: 14 days, not done, not archived; no update counts from creation", () => {
  const p = { id: "p1", created_at: iso(NOW - 30 * DAY) };
  assert.ok(L.TKPU_isStale(p, null, NOW));
  assert.ok(!L.TKPU_isStale({ id: "p2", created_at: iso(NOW - 3 * DAY) }, null, NOW));
  assert.ok(L.TKPU_isStale(p, { status: "on_track", created_at: iso(NOW - 14 * DAY) }, NOW));
  assert.ok(!L.TKPU_isStale(p, { status: "on_track", created_at: iso(NOW - 13 * DAY) }, NOW));
  assert.ok(!L.TKPU_isStale(p, { status: "done", created_at: iso(NOW - 60 * DAY) }, NOW));
  assert.ok(!L.TKPU_isStale(Object.assign({}, p, { archived_at: iso(NOW) }), null, NOW));
  assert.ok(!L.TKPU_isStale({ id: "p3" }, null, NOW));
  assert.ok(!L.TKPU_isStale(null, null, NOW));
});

t("latest map skips hidden and picks the newest", () => {
  const m = L.TKPU_latestMap([
    { id: "a", project_id: "p1", status: "on_track", created_at: iso(NOW - 5 * DAY) },
    { id: "b", project_id: "p1", status: "at_risk", created_at: iso(NOW - 1 * DAY) },
    { id: "c", project_id: "p1", status: "off_track", created_at: iso(NOW), hidden_at: iso(NOW) },
    { id: "d", project_id: "p2", status: "done", created_at: iso(NOW - 2 * DAY) },
    null,
  ]);
  assert.strictEqual(m.p1.id, "b");
  assert.strictEqual(m.p2.id, "d");
  assert.deepStrictEqual(L.TKPU_latestMap(null), {});
});

t("timeline newest first, hidden dropped, input untouched", () => {
  const rows = [
    { id: "a", created_at: iso(NOW - 5 * DAY) },
    { id: "b", created_at: iso(NOW - 1 * DAY) },
    { id: "c", created_at: iso(NOW), hidden_at: iso(NOW) },
  ];
  assert.deepStrictEqual(L.TKPU_timeline(rows).map((r) => r.id), ["b", "a"]);
  assert.strictEqual(rows[0].id, "a");
});

t("due cell: same year short, other year with year, late unless archived", () => {
  assert.deepStrictEqual(L.TKPU_dueCell({ due_on: "2026-11-04" }, "2026-10-28"), { text: "Nov 4", late: false, ymd: "2026-11-04" });
  assert.strictEqual(L.TKPU_dueCell({ due_on: "2027-01-15" }, "2026-10-28").text, "Jan 15, 2027");
  const late = L.TKPU_dueCell({ due_on: "2026-10-20" }, "2026-10-28");
  assert.ok(late.late);
  assert.strictEqual(late.text, "Late: Oct 20");
  assert.ok(!L.TKPU_dueCell({ due_on: "2026-10-28" }, "2026-10-28").late);
  assert.ok(!L.TKPU_dueCell({ due_on: "2026-10-20", archived_at: "x" }, "2026-10-28").late);
  assert.strictEqual(L.TKPU_dueCell({ due_on: null }, "2026-10-28"), null);
  assert.strictEqual(L.TKPU_dueCell({ due_on: "bad" }, "2026-10-28"), null);
});

function sample() {
  const projects = [
    { id: "p1", name: "Bravo", owner_email: "Grace@x.com", created_at: iso(NOW - 40 * DAY), due_on: "2026-11-10" },
    { id: "p2", name: "alpha", owner_email: "sam@x.com", created_at: iso(NOW - 2 * DAY) },
    { id: "p3", name: "Charlie", owner_email: "sam@x.com", created_at: iso(NOW - 40 * DAY), due_on: "2026-10-30" },
    { id: "p4", name: "Delta", owner_email: "sam@x.com", created_at: iso(NOW - 40 * DAY), due_on: "2026-10-01" },
    { id: "p5", name: "Echo", archived_at: iso(NOW - DAY), created_at: iso(NOW - 40 * DAY) },
  ];
  const latest = {
    p1: { id: "u1", project_id: "p1", status: "on_track", created_at: iso(NOW - 20 * DAY) },
    p3: { id: "u3", project_id: "p3", status: "off_track", created_at: iso(NOW - DAY) },
    p4: { id: "u4", project_id: "p4", status: "done", created_at: iso(NOW - 3 * DAY) },
  };
  return { projects, latest };
}

t("portfolio rows: archived hidden by default, fields filled", () => {
  const s = sample();
  const names = { "grace@x.com": "Grace" };
  const rows = L.TKPU_portfolioRows(s.projects, s.latest, { nowMs: NOW, today: "2026-10-28", nameOf: (e) => names[e] || e.split("@")[0] });
  assert.deepStrictEqual(rows.map((r) => r.id), ["p1", "p2", "p3", "p4"]);
  const p1 = rows[0];
  assert.strictEqual(p1.owner, "Grace");
  assert.strictEqual(p1.status.key, "on_track");
  assert.ok(p1.stale);
  assert.strictEqual(p1.due.text, "Nov 10");
  assert.strictEqual(rows[1].status.key, "none");
  assert.strictEqual(rows[1].lastMs, null);
  assert.ok(!rows[1].stale);
  assert.ok(rows[3].due.late);
  assert.ok(!rows[3].stale);
  const all = L.TKPU_portfolioRows(s.projects, s.latest, { showArchived: true, nowMs: NOW, today: "2026-10-28" });
  assert.strictEqual(all.length, 5);
  assert.strictEqual(all[4].owner, "");
  assert.ok(all[4].archived);
  assert.ok(!all[4].stale);
  assert.deepStrictEqual(L.TKPU_portfolioRows(null, null, null), []);
});

t("sort by status, due, name, updated", () => {
  const s = sample();
  const rows = L.TKPU_portfolioRows(s.projects, s.latest, { nowMs: NOW, today: "2026-10-28" });
  assert.deepStrictEqual(L.TKPU_sortRows(rows, "status", "asc").map((r) => r.id), ["p3", "p1", "p2", "p4"]);
  assert.deepStrictEqual(L.TKPU_sortRows(rows, "status", "desc").map((r) => r.id), ["p4", "p2", "p1", "p3"]);
  assert.deepStrictEqual(L.TKPU_sortRows(rows, "due", "asc").map((r) => r.id), ["p4", "p3", "p1", "p2"]);
  assert.deepStrictEqual(L.TKPU_sortRows(rows, "due", "desc").map((r) => r.id), ["p1", "p3", "p4", "p2"]);
  assert.deepStrictEqual(L.TKPU_sortRows(rows, "name", "asc").map((r) => r.id), ["p2", "p1", "p3", "p4"]);
  assert.deepStrictEqual(L.TKPU_sortRows(rows, "updated", "desc").map((r) => r.id), ["p3", "p4", "p1", "p2"]);
  assert.deepStrictEqual(L.TKPU_sortRows(rows, "bogus", "asc").map((r) => r.id), ["p3", "p1", "p2", "p4"]);
  assert.deepStrictEqual(rows.map((r) => r.id), ["p1", "p2", "p3", "p4"]);
});

t("status ties go by name", () => {
  const rows = L.TKPU_portfolioRows(
    [{ id: "x", name: "Zed" }, { id: "y", name: "amy" }],
    {},
    { nowMs: NOW }
  );
  assert.deepStrictEqual(L.TKPU_sortRows(rows, "status", "asc").map((r) => r.name), ["amy", "Zed"]);
  assert.deepStrictEqual(L.TKPU_sortRows(rows, "status", "desc").map((r) => r.name), ["amy", "Zed"]);
});

t("next sort and aria-sort", () => {
  assert.deepStrictEqual(L.TKPU_nextSort({ key: "status", dir: "asc" }, "status"), { key: "status", dir: "desc" });
  assert.deepStrictEqual(L.TKPU_nextSort({ key: "status", dir: "desc" }, "due"), { key: "due", dir: "asc" });
  assert.deepStrictEqual(L.TKPU_nextSort(null, "updated"), { key: "updated", dir: "desc" });
  assert.strictEqual(L.TKPU_ariaSort({ key: "due", dir: "asc" }, "due"), "ascending");
  assert.strictEqual(L.TKPU_ariaSort({ key: "due", dir: "desc" }, "due"), "descending");
  assert.strictEqual(L.TKPU_ariaSort({ key: "due", dir: "asc" }, "status"), "none");
});

t("summary text", () => {
  const s = sample();
  const rows = L.TKPU_portfolioRows(s.projects, s.latest, { nowMs: NOW, today: "2026-10-28" });
  assert.strictEqual(L.TKPU_summaryText(rows), "4 projects · 1 off track · 1 stale");
  assert.strictEqual(L.TKPU_summaryText([]), "0 projects");
});

t("#/tasks/portfolio is unknown with the gate off, portfolio with it on", () => {
  const R = require("./TK_logic.js");
  delete global.TKP_on;
  assert.strictEqual(R.TK_parseRoute("#/tasks/portfolio").view, "unknown");
  global.TKP_on = () => false;
  assert.strictEqual(R.TK_parseRoute("#/tasks/portfolio").view, "unknown");
  global.TKP_on = () => true;
  assert.deepStrictEqual(R.TK_parseRoute("#/tasks/portfolio"), { view: "portfolio" });
  assert.deepStrictEqual(R.TK_parseRoute("#/tasks/Portfolio/"), { view: "portfolio" });
  assert.strictEqual(R.TK_parseRoute("#/tasks/portfolio/x").view, "unknown");
  delete global.TKP_on;
  assert.strictEqual(R.TK_formatRoute({ view: "portfolio" }), "#/tasks/portfolio");
});

t("wiring: index.html loads the files; views gate on Slate plus", () => {
  const root = path.join(__dirname, "../..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.ok(html.includes("components/tasks/TK_projectUpdatesLogic.js"));
  assert.ok(html.includes("components/tasks/TK_ProjectUpdates.jsx"));
  assert.ok(html.includes("components/tasks/tk-projupdates.css"));
  assert.ok(html.indexOf("TK_projectUpdatesLogic.js") < html.indexOf("TK_ProjectUpdates.jsx"));
  assert.ok(html.indexOf("TK_ProjectUpdates.jsx") < html.indexOf("components/tasks/TK_App.jsx"));
  const jsx = fs.readFileSync(path.join(__dirname, "TK_ProjectUpdates.jsx"), "utf8");
  assert.ok(/function TKPU_ProjectStatus\(/.test(jsx));
  assert.ok(/function TKPU_Portfolio\(/.test(jsx));
  assert.ok(jsx.includes("TKP_useOn"));
  assert.ok(jsx.includes('data-tour="tk-projstatus"'));
  assert.ok(!/mailto:|sendEmail|functions\.invoke|notification-emails|tk_notify/i.test(jsx), "no emails or notifications");
  const list = fs.readFileSync(path.join(__dirname, "TK_List.jsx"), "utf8");
  assert.ok(/plusOn && typeof TKPU_ProjectStatus === "function"/.test(list));
  const app = fs.readFileSync(path.join(__dirname, "TK_App.jsx"), "utf8");
  assert.ok(/route\.view === "portfolio" && typeof TKPU_Portfolio === "function" && TKP_on\(\)/.test(app));
  const side = fs.readFileSync(path.join(__dirname, "TK_Sidebar.jsx"), "utf8");
  assert.ok(side.includes('tour="tk-portfolio-nav"'));
  const api = fs.readFileSync(path.join(__dirname, "TK_api.js"), "utf8");
  ["listProjectUpdates", "postProjectUpdate", "hideProjectUpdate", "projectUpdatesLatest"].forEach((f) => assert.ok(api.includes(f), f));
  assert.ok(!/tk_project_updates"\)\s*\.delete/.test(api), "never hard deletes updates");
});

console.log("TK_projectUpdatesLogic: " + n + " passed");
