// components/staff/staffNavRoutes.js — old Team addresses that moved to HR.
//
// HR place split (2026-10-19): Handbook, Reviews, Onboarding, Employee records
// and Members moved from the Team place to a new HR place (#/hr/<tab>). Review
// emails, announcements, Today rows and bookmarks still carry #/team/<tab>, so
// every one of those addresses is rewritten here, before anything reads the
// hash.
//
//   NAV_HR_MOVED_TABS            the tab keys that moved (Team -> HR)
//   NAV_legacyTeamRedirect(hash) pure: "#/team/reviews/r/42?item=x" ->
//                                "#/hr/reviews/r/42?item=x", or null when the
//                                hash is not an old moved-tab address (the
//                                "#team/..." form without the slash too)
//   NAV_restoreStashedHash(h)    the full hash to restore after sign-in, or null
//   NAV_remapArrival(a)          a saved DeepLink arrival, team -> hr if moved
//
// Plain JavaScript with no JSX and no app globals, so `node
// components/staff/staffNav.test.js` can load it. It loads before
// DeepLink.jsx (see window.__SOURCE_ORDER in index.html): at script load, and
// on every hashchange, it rewrites an old address in place with
// history.replaceState (not a new history entry, so Back does not return to the
// old address), which fires no hashchange of its own. The listeners that run
// after this one (DeepLink's LK_capture, App, the hub's NAV_useHashSub) and the
// first render therefore only ever see #/hr/...; the whole sub-path and the
// ?item= query are kept.

var NAV_HR_MOVED_TABS = ["handbook", "reviews", "onboarding", "employees", "members"];

function NAV_legacyTeamRedirect(hash) {
  var h = String(hash == null ? "" : hash);
  // Case-insensitive on the place and tab (a hand-typed link); the tab ends at
  // the next "/", "?" or "#", so "#/team/reviewsx" and "#/team/people" pass.
  // The slash after "#" is optional ("#team/reviews/r/42"): the app's route
  // parser accepts both forms, so both are rewritten.
  var m = /^#\/?team\/(handbook|reviews|onboarding|employees|members)(?=$|[/?#])/i.exec(h);
  if (!m) return null;
  return "#/hr/" + m[1].toLowerCase() + h.slice(m[0].length);
}

// Places whose sub-path (#/hr/reviews/r/<id>) the app keeps across a sign-in
// round trip (HASH_SUB_ROUTE_PAGES in app.jsx, without tasks, which has its own
// stash rule).
var NAV_STASH_SUB_PLACES = ["work", "team", "hr", "help"];

// The hash to put back after sign-in (Google, magic link) for a stashed route,
// or null when the stash is not a sub-route address (the app then falls back to
// the page alone). Pure. An old stash from before the HR split
// (#/team/reviews/r/<id>) is rewritten first. Same shape buildHashRoute keeps:
// lowercase path segments, plus the one ?item= pointer DeepLink strips.
function NAV_restoreStashedHash(stashed) {
  var h = String(stashed == null ? "" : stashed);
  var moved = NAV_legacyTeamRedirect(h);
  if (moved) h = moved;
  var m = /^#\/([a-z]+)((?:\/[a-z0-9-]+)+)(\?item=[a-z]+:[A-Za-z0-9%._~-]+)?$/.exec(h);
  if (!m || NAV_STASH_SUB_PLACES.indexOf(m[1]) === -1) return null;
  return h;
}

// A saved DeepLink arrival ({ place, tab, ... }) from before the deploy may
// still say place "team" with a tab that moved to HR. Returns the arrival
// unchanged, or a copy with place "hr". Pure.
function NAV_remapArrival(a) {
  if (!a || a.place !== "team") return a;
  if (NAV_HR_MOVED_TABS.indexOf(String(a.tab || "").toLowerCase()) === -1) return a;
  var out = {};
  for (var k in a) out[k] = a[k];
  out.place = "hr";
  out.tab = String(a.tab).toLowerCase();
  return out;
}

function NAV_applyLegacyTeamRedirect() {
  try {
    var next = NAV_legacyTeamRedirect(window.location.hash);
    if (!next) return false;
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search + next);
    return true;
  } catch (e) {
    return false;
  }
}

if (typeof window !== "undefined" && window.location && window.addEventListener) {
  NAV_applyLegacyTeamRedirect();
  window.addEventListener("hashchange", NAV_applyLegacyTeamRedirect);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    NAV_HR_MOVED_TABS: NAV_HR_MOVED_TABS,
    NAV_legacyTeamRedirect: NAV_legacyTeamRedirect,
    NAV_restoreStashedHash: NAV_restoreStashedHash,
    NAV_remapArrival: NAV_remapArrival,
  };
}
