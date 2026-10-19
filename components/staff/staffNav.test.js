// Plain node, no framework: `node components/staff/staffNav.test.js`.
// The staff places and tabs (StaffNav.jsx, loaded as source with the JSX
// stripped) and the old-address redirect for the tabs that moved from Team to
// HR (staffNavRoutes.js, 2026-10-19).

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { NAV_HR_MOVED_TABS, NAV_legacyTeamRedirect } = require("./staffNavRoutes.js");

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

// Load the declarations at the top of StaffNav.jsx (up to the hash helpers
// that need a browser). Every tab whose `visible` test looks for a page
// component gets a stub, so those tabs count as present in this build.
const src = fs.readFileSync(path.join(__dirname, "StaffNav.jsx"), "utf8");
const cut = src.slice(0, src.indexOf("// Tab state for a hub page")).replace(/<[A-Za-z][^<>]*\/>/g, "null");
const sandbox = {};
[
  "PF_PerformanceTab",
  "TI_TechTab",
  "RT_ReplyTimesTab",
  "FB_FeedbackPage",
  "LR_SettingsPanel",
  "LR_ReviewFilePage",
  "DL_DeadlinesPage",
  "HB_HandbookTab",
  "TR_TeamReviewsPage",
  "SON_ProgressTab",
  "HR_RecordsTab",
].forEach((k) => (sandbox[k] = function () {}));
vm.createContext(sandbox);
const nav = vm.runInContext(
  cut + "\n({ NAV_PLACES, NAV_PLACE_BY_KEY, NAV_PLACE_BY_SLUG, NAV_visiblePlaces, NAV_visibleTabs })",
  sandbox,
);

const bookkeeper = { isAdmin: false, isRealAdmin: false, impersonating: false };
const tempAdmin = { isAdmin: true, isRealAdmin: false, impersonating: false };
const realAdmin = { isAdmin: true, isRealAdmin: true, impersonating: false };
const viewAs = { isAdmin: false, isRealAdmin: false, impersonating: true };
const keys = (list) => Array.from(list, (x) => x.key);

t("places: Team and HR are both left-rail places, HR right after Team", () => {
  const k = keys(nav.NAV_PLACES);
  assert.ok(k.indexOf("hr") === k.indexOf("team") + 1);
  assert.strictEqual(nav.NAV_PLACE_BY_SLUG.hr.key, "hr");
  assert.strictEqual(nav.NAV_PLACE_BY_SLUG.hr.label, "HR");
});

t("NAV_visiblePlaces: everyone who sees Team sees HR; View as hides both", () => {
  for (const ctx of [bookkeeper, tempAdmin, realAdmin]) {
    assert.deepStrictEqual(keys(nav.NAV_visiblePlaces(ctx)), ["today", "inbox", "work", "clients", "team", "hr"]);
  }
  assert.deepStrictEqual(keys(nav.NAV_visiblePlaces(viewAs)), ["today", "clients"]);
  assert.ok(keys(nav.NAV_visiblePlaces({ ...realAdmin, canViewInternal: true })).includes("internal"));
});

t("NAV_visibleTabs team: bookkeeper", () => {
  assert.deepStrictEqual(keys(nav.NAV_visibleTabs("team", bookkeeper)), ["people", "performance", "inventory"]);
});
t("NAV_visibleTabs team: temporary admin", () => {
  assert.deepStrictEqual(keys(nav.NAV_visibleTabs("team", tempAdmin)), [
    "people", "performance", "inventory", "hours", "reply-times", "feedback", "ledger",
  ]);
});
t("NAV_visibleTabs team: real admin; Feedback and Ledger review stay in Team", () => {
  assert.deepStrictEqual(keys(nav.NAV_visibleTabs("team", realAdmin)), [
    "people", "performance", "inventory", "hours", "reply-times", "feedback", "ledger",
  ]);
});
t("NAV_visibleTabs hr: bookkeeper", () => {
  assert.deepStrictEqual(keys(nav.NAV_visibleTabs("hr", bookkeeper)), ["handbook", "reviews", "onboarding"]);
});
t("NAV_visibleTabs hr: temporary admin gets Members but never Employee records", () => {
  assert.deepStrictEqual(keys(nav.NAV_visibleTabs("hr", tempAdmin)), ["handbook", "reviews", "onboarding", "members"]);
});
t("NAV_visibleTabs hr: real admin gets Employee records and Members", () => {
  assert.deepStrictEqual(keys(nav.NAV_visibleTabs("hr", realAdmin)), [
    "handbook", "reviews", "onboarding", "employees", "members",
  ]);
});
t("Employee records is hidden when its component is missing", () => {
  const sb = {};
  vm.createContext(sb);
  const n2 = vm.runInContext(cut + "\n({ NAV_visibleTabs })", sb);
  assert.deepStrictEqual(keys(n2.NAV_visibleTabs("hr", realAdmin)), ["members"]);
});
t("no tab key is in both Team and HR", () => {
  const a = keys(nav.NAV_visibleTabs("team", realAdmin));
  const b = keys(nav.NAV_visibleTabs("hr", realAdmin));
  assert.deepStrictEqual(a.filter((k) => b.includes(k)), []);
});

t("redirect: every moved tab keeps its whole sub-path, query and case", () => {
  const cases = {
    "#/team/reviews": "#/hr/reviews",
    "#/team/reviews/r/42": "#/hr/reviews/r/42",
    "#/team/reviews/r/0b1c-ab": "#/hr/reviews/r/0b1c-ab",
    "#/team/reviews/survey": "#/hr/reviews/survey",
    "#/team/handbook": "#/hr/handbook",
    "#/team/handbook/staff-sla": "#/hr/handbook/staff-sla",
    "#/team/handbook/new": "#/hr/handbook/new",
    "#/team/onboarding": "#/hr/onboarding",
    "#/team/employees": "#/hr/employees",
    "#/team/members": "#/hr/members",
    "#/team/members?item=abc": "#/hr/members?item=abc",
    "#/team/handbook/x?item=1#y": "#/hr/handbook/x?item=1#y",
    "#/team/Reviews/R/42": "#/hr/reviews/R/42",
  };
  for (const [from, to] of Object.entries(cases)) assert.strictEqual(NAV_legacyTeamRedirect(from), to, from);
});

t("redirect: leaves everything else alone (null)", () => {
  for (const h of [
    "", null, undefined, "#/team", "#/team/", "#/team/people", "#/team/hours", "#/team/feedback", "#/team/ledger",
    "#/team/tech", "#/team/reply-times", "#/team/reviewsx", "#/team/handbooks", "#/hr/reviews", "#/work/close",
    "#/today", "#/inbox/team/reviews", "team/reviews",
  ]) {
    assert.strictEqual(NAV_legacyTeamRedirect(h), null, String(h));
  }
});

t("redirect: result is stable (redirecting twice changes nothing)", () => {
  for (const k of NAV_HR_MOVED_TABS) {
    const once = NAV_legacyTeamRedirect("#/team/" + k + "/a/b");
    assert.strictEqual(NAV_legacyTeamRedirect(once), null);
  }
});

t("no old Team tab address is left unmapped", () => {
  // Every tab key #/team/<key> ever had (before 2026-10-19), plus the "tech"
  // alias. Each one must either still be a Team tab (or alias) or redirect.
  const oldTeamTabs = [
    "people", "performance", "inventory", "hours", "reply-times", "feedback", "ledger",
    "handbook", "reviews", "onboarding", "employees", "members", "tech",
  ];
  const teamNow = keys(nav.NAV_PLACE_BY_KEY.team.tabs);
  const hrNow = keys(nav.NAV_PLACE_BY_KEY.hr.tabs);
  for (const k of oldTeamTabs) {
    const redirected = NAV_legacyTeamRedirect("#/team/" + k);
    if (redirected) {
      const to = redirected.replace(/^#\/hr\//, "");
      assert.ok(hrNow.includes(to), k + " redirects to a tab HR does not have");
      assert.ok(!teamNow.includes(k), k + " is both redirected and still on Team");
    } else {
      assert.ok(teamNow.includes(k) || k === "tech", k + " has no address");
    }
  }
  // And the other way: every HR tab is reachable from its old Team address.
  for (const k of hrNow) assert.strictEqual(NAV_legacyTeamRedirect("#/team/" + k), "#/hr/" + k);
  assert.deepStrictEqual(hrNow.slice().sort(), NAV_HR_MOVED_TABS.slice().sort());
});

console.log("staffNav: " + n + " checks passed");
