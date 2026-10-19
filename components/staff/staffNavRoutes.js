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
//                                hash is not an old moved-tab address
//
// Plain JavaScript with no JSX and no app globals, so `node
// components/staff/staffNavRoutes.test.js` can load it. It loads before
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
  var m = /^#\/team\/(handbook|reviews|onboarding|employees|members)(?=$|[/?#])/i.exec(h);
  if (!m) return null;
  return "#/hr/" + m[1].toLowerCase() + h.slice(m[0].length);
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
  };
}
