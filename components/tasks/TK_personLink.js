// ----------------------------------------------------------------------------
// TK_personLink: the ONE way to open a staff member's Slate profile (Slate plus,
// docs/slateplus-profile-spec.md). Shared with the other Slate plus features
// (the workload strip calls TKP_openPerson).
//
//   TKP_personKey(email)  16 hex chars (two 32-bit FNV-1a hashes of the
//                         lowercased email). Slate never puts an email in a
//                         URL; the profile page resolves the key against
//                         staff_directory().
//   TKP_personHref(email) "#/tasks/person/<key>", or "" for no email.
//   TKP_openPerson(email) goes there (TK_navigate: works inside Slate and from
//                         the Team page). Does nothing and returns false while
//                         TKP_on() is false (preview off, switch unset, View as).
//   TKP_who(email, node)  TKP_PersonLink around node (Team, shout-outs).
//   TKP_PersonLink({ email, children, className, title })
//                         a link to the profile while the gate is on; with the
//                         gate off (or no email) it renders `children` exactly
//                         as given, so callers look the same as before.
//
// Browser file (plain JS, no JSX; React at call time only). Node tests:
// components/tasks/TK_profileLogic.test.js.
// ----------------------------------------------------------------------------

function TKP__fnv(str, basis) {
  var h = basis >>> 0;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i) & 0xff;
    h = Math.imul(h, 16777619) >>> 0;
    var hi = str.charCodeAt(i) >>> 8;
    if (hi) {
      h ^= hi;
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return ("0000000" + h.toString(16)).slice(-8);
}

function TKP_personKey(email) {
  var e = String(email == null ? "" : email).trim().toLowerCase();
  if (!e) return "";
  return TKP__fnv(e, 2166136261) + TKP__fnv(e.split("").reverse().join(""), 0x811c9dc5 ^ 0x5bd1e995);
}

function TKP_isPersonKey(s) {
  return typeof s === "string" && /^[0-9a-f]{16}$/.test(s);
}

function TKP_personHref(email) {
  var k = TKP_personKey(email);
  return k ? "#/tasks/person/" + k : "";
}

function TKP__gateOn() {
  try {
    return typeof TKP_on === "function" && TKP_on() === true;
  } catch (e) {
    return false;
  }
}

function TKP_openPerson(email) {
  if (!TKP__gateOn()) return false;
  var key = TKP_personKey(email);
  if (!key) return false;
  if (typeof TK_navigate === "function") {
    TK_navigate({ view: "profile", key: key });
    return true;
  }
  try {
    window.location.hash = "#/tasks/person/" + key;
  } catch (e) {
    return false;
  }
  return true;
}

function TKP_PersonLink(props) {
  var p = props || {};
  // A plain check, no hook: the preview reloads the page when ticked and the
  // firm switch is cached, so many links never mean many listeners.
  var on = TKP__gateOn();
  var email = String(p.email || "").trim().toLowerCase();
  if (!on || !email) return React.createElement(React.Fragment, null, p.children);
  return React.createElement(
    "a",
    {
      href: TKP_personHref(email),
      className: "tkp-plink" + (p.className ? " " + p.className : ""),
      title: p.title || "See profile",
      onClick: function (e) {
        // Rows and cards open their own thing on click; the link wins.
        if (e && typeof e.stopPropagation === "function") e.stopPropagation();
        if (!e || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        TKP_openPerson(email);
      },
      onKeyDown: function (e) {
        // Enter follows the link, not the row's "open task".
        if (e && e.key === "Enter" && typeof e.stopPropagation === "function") e.stopPropagation();
      },
    },
    p.children,
  );
}

// For callers outside Slate (Team, shout-outs): wrap `node` in a profile link.
// Off, it returns `node` itself, so nothing looks or mounts differently.
function TKP_who(email, node) {
  if (!email || !TKP__gateOn()) return node;
  return React.createElement(TKP_PersonLink, { email: email }, node);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TKP_personKey: TKP_personKey,
    TKP_isPersonKey: TKP_isPersonKey,
    TKP_personHref: TKP_personHref,
    TKP_openPerson: TKP_openPerson,
  };
}
