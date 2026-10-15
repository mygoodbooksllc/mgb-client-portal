// Explains a sign-in that came back without signing anyone in. Before this, a
// staff member whose Google sign-in failed landed back on the client sign-in
// page with no message, and neither they nor an admin could tell why.
//
// This file loads BEFORE supabaseClient.js (see index.html's load order): it
// has to read the return URL before the Supabase client touches it. It
// exposes window.mgbSignInNotice for AuthGate and ClientAuthGate.
//
// What it records, all in sessionStorage so it survives the redirects:
//   - a one-shot flag set when the staff Google sign-in starts, read (and
//     removed) on the next load so the return can be recognised;
//   - a notice for the page to show: { reason, email? }.
// It never stores or logs the OAuth code, tokens or any other URL value.
// error / error_code / error_description are stripped from the address bar
// as soon as they are read; only the fact that an error came back is kept.
(function () {
  var FLAG_KEY = "mgb_staff_signin_started_v1";
  var NOTICE_KEY = "mgb_signin_notice_v1";
  var FLAG_TTL_MS = 10 * 60 * 1000;
  var NOTICE_TTL_MS = 2 * 60 * 1000;

  function store(fn) {
    try {
      return fn(window.sessionStorage);
    } catch (e) {
      return null;
    }
  }

  // Was the staff Google flow started in this tab shortly before this load?
  var started = false;
  var startedAt = store(function (s) {
    var v = s.getItem(FLAG_KEY);
    s.removeItem(FLAG_KEY);
    return v;
  });
  if (startedAt && Date.now() - Number(startedAt) < FLAG_TTL_MS) started = true;

  // Read the OAuth return. Query and fragment are both checked: the PKCE flow
  // answers in the query, the implicit flow in the fragment.
  var returned = false; // a code, token or error came back on the URL
  var hadError = false;
  try {
    var search = new URLSearchParams(window.location.search);
    var rawHash = String(window.location.hash || "");
    // A route such as #/help/signing-in is not a parameter list.
    var hashIsParams = /^#[^/]*=/.test(rawHash);
    var hash = new URLSearchParams(hashIsParams ? rawHash.slice(1) : "");
    var ERR_KEYS = ["error", "error_code", "error_description"];
    ERR_KEYS.forEach(function (k) {
      if (search.has(k) || hash.has(k)) hadError = true;
    });
    returned = hadError || search.has("code") || hash.has("access_token");
    if (hadError) {
      ERR_KEYS.forEach(function (k) {
        search.delete(k);
        hash.delete(k);
      });
      var qs = search.toString();
      var hs = hashIsParams ? hash.toString() : rawHash.replace(/^#/, "");
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + (qs ? "?" + qs : "") + (hs ? "#" + hs : ""),
      );
    }
  } catch (e) {}

  function write(notice) {
    store(function (s) {
      s.setItem(NOTICE_KEY, JSON.stringify({ reason: notice.reason, email: notice.email || "", at: Date.now() }));
    });
  }

  // A failed return is recorded now, so it survives the gate reloading the
  // page. A staff attempt gets the staff wording; anything else that came
  // back with an error (an expired email link, say) gets a link message.
  if (hadError) write({ reason: started ? "staff" : "link" });

  function isStaffEmail(email) {
    return String(email || "").toLowerCase().endsWith("@mygoodbooks.org");
  }

  function take() {
    var raw = store(function (s) {
      var v = s.getItem(NOTICE_KEY);
      s.removeItem(NOTICE_KEY);
      return v;
    });
    if (!raw) return null;
    try {
      var n = JSON.parse(raw);
      if (!n || typeof n.reason !== "string") return null;
      // Stale (no gate mounted on that load): don't show it on a later load.
      if (!(Date.now() - Number(n.at) < NOTICE_TTL_MS)) return null;
      return {
        reason: n.reason,
        email: typeof n.email === "string" ? n.email.slice(0, 254) : "",
      };
    } catch (e) {
      return null;
    }
  }

  var firstId = null;
  var taken; // the stored notice, read once per page load

  var HELP =
    "Use your @mygoodbooks.org Google account (not a personal Gmail). If it still fails, try a normal (non-private) browser window and allow cookies, then ask an admin to check your Google Workspace account.";

  window.mgbSignInNotice = {
    // Called when the staff Google sign-in is about to start.
    markStaffStart: function () {
      store(function (s) {
        s.setItem(FLAG_KEY, String(Date.now()));
      });
    },
    // Called once by a gate after getSession(). Returns the notice to show
    // (or null) and clears the stored one. A staff return with no session, or
    // with a non-@mygoodbooks.org session, is turned into a notice here.
    // Idempotent for a page load: AuthGate/ClientAuthGate reach it from both
    // getSession() and onAuthStateChange, and both must see the same answer.
    resolve: function (session) {
      // The notice belongs to the first session (or none) seen on this load;
      // a different session arriving later (another tab, an emailed code)
      // is an ordinary sign-in and gets no staff wording.
      var id = (session && session.user && session.user.id) || null;
      if (taken === undefined) {
        taken = take();
        firstId = id;
      } else if (id !== firstId) {
        return null;
      }
      var n = taken;
      if (n) return n;
      if (!started || !returned) return null;
      var email = session && session.user && session.user.email;
      if (!session) return { reason: "staff", email: "" };
      if (!isStaffEmail(email)) return { reason: "wrong-account", email: email || "" };
      return null;
    },
    // Keeps a notice across the gate's page reload (AuthGate sends a
    // non-staff session back to "/").
    stash: function (n) {
      if (n) write(n);
    },
    text: function (n) {
      if (!n) return "";
      if (n.reason === "link") {
        return "That sign-in link didn't work. It may have expired or already been used. Enter your email below to get a new one.";
      }
      if (n.reason === "wrong-account" && n.email) {
        return "We couldn't sign you in as " + n.email + ", which isn't a @mygoodbooks.org account. " + HELP;
      }
      return "We couldn't sign you in. " + HELP;
    },
  };
})();
