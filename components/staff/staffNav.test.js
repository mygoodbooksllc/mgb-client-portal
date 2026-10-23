// Plain node, no framework: `node components/staff/staffNav.test.js`.
// The staff places and tabs (StaffNav.jsx, loaded as source with the JSX
// stripped) and the old-address redirect for the tabs that moved from Team to
// HR (staffNavRoutes.js, 2026-10-19).

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  NAV_HR_MOVED_TABS,
  NAV_legacyTeamRedirect,
  NAV_restoreStashedHash,
  NAV_remapArrival,
} = require("./staffNavRoutes.js");

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

t("redirect: the slashless form (#team/...) is rewritten like #/team/...", () => {
  const cases = {
    "#team/reviews": "#/hr/reviews",
    "#team/reviews/r/42": "#/hr/reviews/r/42",
    "#team/handbook/staff-sla?item=1": "#/hr/handbook/staff-sla?item=1",
    "#team/Members": "#/hr/members",
  };
  for (const [from, to] of Object.entries(cases)) assert.strictEqual(NAV_legacyTeamRedirect(from), to, from);
});

t("redirect: strict boundary (a longer tab name or a Team tab is never rewritten)", () => {
  for (const h of [
    "#/team/membersX", "#/team/reviews-old", "#/team/reviewsx/r/1", "#team/membersX", "#team/reviews-old",
    "#/team/members_old", "#team/people", "#teamreviews", "#/teams/reviews", "#/xteam/reviews",
  ]) {
    assert.strictEqual(NAV_legacyTeamRedirect(h), null, h);
  }
});

t("stash restore: a review link keeps the whole path (#/hr/reviews/r/<id>)", () => {
  const id = "0b1c2d3e-aaaa-4bbb-8ccc-123456789abc";
  assert.strictEqual(NAV_restoreStashedHash("#/hr/reviews/r/" + id), "#/hr/reviews/r/" + id);
  assert.strictEqual(NAV_restoreStashedHash("#/hr/handbook/staff-sla"), "#/hr/handbook/staff-sla");
  assert.strictEqual(NAV_restoreStashedHash("#/hr/handbook/staff-sla?item=handbook:x"), "#/hr/handbook/staff-sla?item=handbook:x");
  assert.strictEqual(NAV_restoreStashedHash("#/work/close"), "#/work/close");
  assert.strictEqual(NAV_restoreStashedHash("#/help/some-article"), "#/help/some-article");
});

t("stash restore: an old stash (#/team/reviews/r/<id>, with or without the slash) comes back as HR", () => {
  assert.strictEqual(NAV_restoreStashedHash("#/team/reviews/r/abc-1"), "#/hr/reviews/r/abc-1");
  assert.strictEqual(NAV_restoreStashedHash("#team/reviews/r/abc-1"), "#/hr/reviews/r/abc-1");
  assert.strictEqual(NAV_restoreStashedHash("#/team/handbook/staff-sla"), "#/hr/handbook/staff-sla");
  // A Team tab that stayed is not touched.
  assert.strictEqual(NAV_restoreStashedHash("#/team/hours/x"), "#/team/hours/x");
});

t("stash restore: nothing to restore for a bare place, other places, auth or odd input (null)", () => {
  for (const h of [
    null, undefined, "", "#/hr", "#/team", "#/today", "#/inbox/x", "#/client/abc/needs", "#/tasks/my/x",
    "#/hr/Reviews/r/1", "#/hr/reviews/../x", "#/hr/reviews/r/1?evil=1", "#/hr/reviews//r",
    "#access_token=abc&type=recovery", "#/hr/reviews/r/<script>",
  ]) {
    assert.strictEqual(NAV_restoreStashedHash(h), null, String(h));
  }
});

t("saved arrival: team + a moved tab is remapped to hr (team/handbook included)", () => {
  const a = { place: "team", tab: "handbook", sub: "", kind: "handbook", id: "staff-sla", at: 5, rearmed: false };
  const r = NAV_remapArrival(a);
  assert.strictEqual(r.place, "hr");
  assert.strictEqual(r.tab, "handbook");
  assert.strictEqual(r.id, "staff-sla");
  assert.strictEqual(a.place, "team", "the input is not mutated");
  for (const k of NAV_HR_MOVED_TABS) assert.strictEqual(NAV_remapArrival({ place: "team", tab: k }).place, "hr", k);
  assert.strictEqual(NAV_remapArrival({ place: "team", tab: "Reviews" }).tab, "reviews");
});

t("saved arrival: anything else is returned unchanged", () => {
  for (const a of [
    { place: "team", tab: "hours" }, { place: "team", tab: "" }, { place: "hr", tab: "reviews" },
    { place: "client", tab: "handbook", clientId: "c1" }, { place: "work", tab: "members" },
  ]) {
    assert.strictEqual(NAV_remapArrival(a), a);
  }
  assert.strictEqual(NAV_remapArrival(null), null);
  assert.strictEqual(NAV_remapArrival(undefined), undefined);
});

// The real DeepLink.jsx functions (LK_parsePath, LK_remapStored), cut out of
// the source and run with the redirect's globals, so a saved arrival and a
// hash that reaches LK_parse in the old form are checked against the code the
// app ships.
const dl = fs.readFileSync(path.join(__dirname, "DeepLink.jsx"), "utf8");
const dlStart = dl.indexOf("// Path part of a hash");
const dlEnd = dl.indexOf("// Parse a full hash with a query");
assert.ok(dlStart > 0 && dlEnd > dlStart, "DeepLink.jsx markers moved");
const dlSandbox = {
  NAV_HR_MOVED_TABS,
  NAV_remapArrival,
  LK_normTab: (x) => String(x || "").toLowerCase(),
};
vm.createContext(dlSandbox);
vm.runInContext(dl.slice(dlStart, dlEnd) + "\nthis.LK_parsePath = LK_parsePath; this.LK_remapStored = LK_remapStored;", dlSandbox);

t("DeepLink: a saved team/<moved tab> arrival is remapped to hr", () => {
  const saved = JSON.parse(JSON.stringify({ place: "team", tab: "reviews", sub: "r", kind: "view", id: "", at: 1 }));
  assert.strictEqual(dlSandbox.LK_remapStored(saved).place, "hr");
  const hb = dlSandbox.LK_remapStored({ place: "team", tab: "handbook", kind: "handbook", id: "x" });
  assert.strictEqual(hb.place + "/" + hb.tab, "hr/handbook");
  const hours = { place: "team", tab: "hours", kind: "view" };
  assert.strictEqual(dlSandbox.LK_remapStored(hours).place, "team");
});

t("DeepLink: LK_parsePath maps old team/<moved> to hr, with or without the slash, and leaves Team tabs", () => {
  const p = (h) => dlSandbox.LK_parsePath(h);
  assert.strictEqual(p("#/team/reviews/r/42").place, "hr");
  assert.strictEqual(p("#team/handbook").place, "hr");
  assert.strictEqual(p("#/team/hours").place, "team");
  assert.strictEqual(p("#/team/membersx").place, "team");
  assert.strictEqual(p("#/hr/reviews/r/42").place, "hr");
});

t("app.jsx and DeepLink.jsx actually use the restore and remap helpers", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "..", "app.jsx"), "utf8");
  assert.ok(/NAV_restoreStashedHash\(stashed\)/.test(app), "sign-in restore does not call NAV_restoreStashedHash");
  assert.ok(/NAV_legacyTeamRedirect\(stashed\)/.test(app), "sign-in restore does not remap an old stash");
  assert.ok((dl.match(/LK_remapStored\(JSON\.parse/g) || []).length >= 2, "saved arrivals are not remapped on read");
});

// ---- Client org profile: Team › Client gifts (hidden) ----------------------
t("Client gifts tab: real admins only, and only while OP_isOn()", () => {
  const box = {};
  ["PF_PerformanceTab", "TI_TechTab", "RT_ReplyTimesTab", "FB_FeedbackPage", "LR_SettingsPanel"].forEach((k) => (box[k] = function () {}));
  vm.createContext(box);
  const nav2 = vm.runInContext(cut + "\n({ NAV_visibleTabs })", box);
  const teamKeys = (ctx) => keys(nav2.NAV_visibleTabs("team", ctx));
  // No OP files loaded at all: hidden.
  assert.ok(!teamKeys(realAdmin).includes("gifts"));
  box.OP_GiftsTab = function () {};
  box.OP_isOn = () => false;
  assert.ok(!teamKeys(realAdmin).includes("gifts"), "gate off");
  box.OP_isOn = () => true;
  assert.ok(teamKeys(realAdmin).includes("gifts"), "gate on: real admin");
  assert.strictEqual(teamKeys(realAdmin)[teamKeys(realAdmin).length - 1], "gifts", "last Team tab");
  assert.ok(!teamKeys(tempAdmin).includes("gifts"), "temporary admin");
  assert.ok(!teamKeys(bookkeeper).includes("gifts"), "bookkeeper");
  // The default sandbox (no OP stubs) keeps the old Team tabs.
  assert.ok(!keys(nav.NAV_visibleTabs("team", realAdmin)).includes("gifts"));
});

console.log("staffNav: " + n + " checks passed");
