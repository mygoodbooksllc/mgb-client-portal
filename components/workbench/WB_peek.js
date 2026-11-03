// ----------------------------------------------------------------------------
// WB_peek: the Desk client summary ("peek") and Keep on Desk, plus the Desk
// Customize prefs (docs/desk-client-peek-spec.md, docs/desk-usability-review.md
// R1 and R3). Hidden until the owner launches it.
//
// ONE gate, WB_peekIsOn(deskOn, previewOn, switchValue), true only when:
//   - the Desk is on for this page (deskOn; the Desk never mounts under View
//     as, a plan preview, impersonation or Classic Today), AND
//   - a person's own preview: localStorage mgb_peek_preview === "1"
//     (Developer tools > Feature flags, "Desk client summary (preview)"), OR
//   - the firm switch tk_settings.desk_peek_enabled (owner-only; missing or
//     off = off; code NEVER writes it). Read once per page load after a
//     session exists, remembered per browser in mgb_peek_cache ("1" or
//     removed); window event mgb:peek fires when it changes.
// Components call `const peekOn = WB_usePeek(deskOn);`. Off: no reads, no
// listeners, and every gated spot draws exactly what it drew before.
//
// Keep (per person, per browser): localStorage mgb_wb_peek:<email> =
// { v: 1, keptId, at, collapsed }. collapsed is the summary fold (all
// clients). A keep older than 24 hours clears on the next read (owner
// decision 2026-11-03), with a one-time toast. Separate from the star pins
// (mgb_wb_pins:<email>); neither writes the other. Event mgb:wb-peek.
//
// The summary is built ONLY by WB_peekShape, a whitelist: it copies named
// fields and never spreads a client object (which carries QuickBooks and plan
// data). No money: the flag line, the last message and a contact's role go
// through WB_peekMoney; a hit shows "See pinned note" (flag) or a neutral line.
// Reads (WB_peekFetch) fire only for a client in my own client list
// (WB_peekAccess === "ok"); RLS is still the real gate.
//
// Desk Customize (R3, same gate): mgb_wb_deskprefs:<email> =
// { v: 1, on: { glance, rightNow }, closed: "both"|"rail"|"bar"|"neither" },
// read by WB_Drawer (WB_deskFill prefs, WB_deskClosedShow). Reset Desk clears
// it plus the Desk's width/layout (mgb_wb_desk:<email>), the saved tab/scroll
// (mgb_wb_hub:<email>) and the peek keep/fold. Star pins are kept.
//
// Browser file (plain JS, no JSX); loads after WB_clientExtras.js. Uses
// window.mgbSupabase and React at call time only. Node tests:
// components/workbench/WB_peek.test.js.
// ----------------------------------------------------------------------------

var WB_PEEK_PREVIEW_KEY = "mgb_peek_preview";
var WB_PEEK_CACHE_KEY = "mgb_peek_cache";
var WB_PEEK_EVENT = "mgb:peek"; // the gate's answer changed
var WB_PEEK_STATE_EVENT = "mgb:wb-peek"; // keep / fold changed, or "read again"
var WB_PEEK_SWITCH = "desk_peek_enabled";
var WB_PEEK_TTL_MS = 24 * 3600 * 1000; // keep expiry (owner: 24 hours)
var WB_PEEK_STALE_MS = 2 * 60 * 1000; // re-read on Desk open when older
var WB_PEEK_FLAG_MAX = 80;
var WB_PEEK_MSG_MAX = 90;
var WB_PEEK_ROLE_MAX = 30;
var WB_PEEK_NAME_MAX = 60;
var WB_PEEK_FLAG_HIDDEN = "See pinned note";
var WB_PEEK_MSG_HIDDEN = "Open the thread to read it";
var WB_PEEK_FLAG_CATS = ["status", "handoff"];
var WB_PEEK_NOTE_COLS = "id, client_id, text, pinned, category, created_at";
var WB_PEEK_MSG_COLS = "id, client_id, participant_email, author_kind, author_name, body, created_at, internal, deleted_at";
var WB_DESKPREFS_EVENT = "mgb:wb-deskprefs";
var WB_DESKPREFS_CLOSED = ["both", "rail", "bar", "neither"];

function WB__peekLs(k) {
  try {
    return window.localStorage.getItem(k);
  } catch (e) {
    return null;
  }
}
function WB__peekLsSet(k, v) {
  try {
    if (v == null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, v);
  } catch (e) {}
}
function WB__peekFire(name, detail) {
  try {
    window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  } catch (e) {}
}
function WB__peekStr(v) {
  return v == null ? "" : String(v);
}
function WB__peekEmail(email) {
  return WB__peekStr(email).trim().toLowerCase();
}
function WB__peekIdOk(id) {
  var s = WB__peekStr(id);
  return s.length > 0 && s.length < 80;
}
function WB__peekTrim(text, max) {
  var s = WB__peekStr(text).replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/\s+$/, "") + "…";
}

// ---- The gate ----

// Same truthy rule as WB_plusSwitchValue / OP__switchValue.
function WB_peekSwitchValue(v) {
  return v === true || v === "true" || v === 1 || (!!v && typeof v === "object" && v.on === true);
}

// The pure resolver (the ONE place the gate is decided).
function WB_peekIsOn(deskOn, previewOn, switchValue) {
  if (deskOn !== true) return false;
  return previewOn === true || WB_peekSwitchValue(switchValue);
}

function WB_peekPreviewOn() {
  return WB__peekLs(WB_PEEK_PREVIEW_KEY) === "1";
}

// One read of tk_settings.desk_peek_enabled per page load, after sign-in
// (the WB_plus.js state machine: idle | reading | done; no session: retry
// after 3s; an error: after 30s; never after 3 errors). Read only.
var WB__peekSwitch = { state: "idle", fails: 0, nextAt: 0 };
function WB_peekReadSwitch(force) {
  var c = typeof window !== "undefined" ? window.mgbSupabase : null;
  if (!c || (!force && WB__peekSwitch.state !== "idle")) return;
  if (!force && Date.now() < WB__peekSwitch.nextAt) return;
  WB__peekSwitch.state = "reading";
  var wait = function () {
    WB__peekSwitch.state = "idle";
    WB__peekSwitch.nextAt = Date.now() + 3000;
  };
  var fail = function () {
    WB__peekSwitch.fails += 1;
    WB__peekSwitch.state = WB__peekSwitch.fails >= 3 ? "done" : "idle";
    WB__peekSwitch.nextAt = Date.now() + 30000;
  };
  try {
    var go = function () {
      c.from("tk_settings")
        .select("value")
        .eq("key", WB_PEEK_SWITCH)
        .maybeSingle()
        .then(function (res) {
          if (!res || res.error) return fail();
          WB__peekSwitch.state = "done";
          var before = WB__peekLs(WB_PEEK_CACHE_KEY);
          WB__peekLsSet(WB_PEEK_CACHE_KEY, res.data && WB_peekSwitchValue(res.data.value) ? "1" : null);
          if (WB__peekLs(WB_PEEK_CACHE_KEY) !== before) WB__peekFire(WB_PEEK_EVENT);
        }, fail);
    };
    if (c.auth && typeof c.auth.getSession === "function") {
      c.auth.getSession().then(function (r) {
        if (r && r.data && r.data.session) go();
        else wait();
      }, fail);
    } else go();
  } catch (e) {
    fail();
  }
}

function WB__peekNow(deskOn) {
  if (deskOn !== true) return false;
  return WB_peekIsOn(true, WB_peekPreviewOn(), WB__peekLs(WB_PEEK_CACHE_KEY) === "1");
}

// True only when the FIREWIDE switch (desk_peek_enabled, cached) is on. The
// tour and tip use this, never the per-person preview: held drafts stay hidden
// until the owner flips the switch.
function WB_peekFirmOn() {
  return WB__peekLs(WB_PEEK_CACHE_KEY) === "1";
}

// For non-React callers (the Cmd-K row, the p key): the answer now.
function WB_peekOn(deskOn) {
  if (deskOn !== true) return false;
  if (!WB_peekPreviewOn() && WB__peekSwitch.state === "idle") WB_peekReadSwitch();
  return WB__peekNow(true);
}

// The hook every gated spot uses. Desk off: false, no listeners, no network.
function WB_usePeek(deskOn) {
  var on = deskOn === true;
  var s = React.useState(0);
  var bump = s[1];
  React.useEffect(
    function () {
      if (!on) return undefined;
      var hit = function () {
        bump(function (n) {
          return n + 1;
        });
      };
      var onStorage = function (e) {
        if (!e || !e.key || e.key === WB_PEEK_PREVIEW_KEY || e.key === WB_PEEK_CACHE_KEY) hit();
      };
      window.addEventListener(WB_PEEK_EVENT, hit);
      window.addEventListener("storage", onStorage);
      return function () {
        window.removeEventListener(WB_PEEK_EVENT, hit);
        window.removeEventListener("storage", onStorage);
      };
    },
    [on],
  );
  React.useEffect(function () {
    if (on && !WB_peekPreviewOn() && WB__peekSwitch.state === "idle") WB_peekReadSwitch();
  });
  return WB__peekNow(on);
}

// ---- Keep storage ----

function WB_peekKey(email) {
  var e = WB__peekEmail(email);
  return e ? "mgb_wb_peek:" + e : null;
}

// Saved text in, state out. Never throws. A keep older than the TTL (or
// dated in the future by more than a day: a bad clock) is dropped and
// reported as expired so the caller can toast once and write it back.
function WB_peekParse(raw, now) {
  // collapsed: true / false once the person chose, null = never chose (the
  // window height decides, WB_peekFolded).
  var out = { keptId: null, at: null, collapsed: null, expired: false };
  if (!raw) return out;
  var o;
  try {
    o = JSON.parse(raw);
  } catch (e) {
    return out;
  }
  if (!o || typeof o !== "object" || Array.isArray(o) || o.v !== 1) return out;
  out.collapsed = WB__peekFold(o.collapsed);
  var id = typeof o.keptId === "string" || typeof o.keptId === "number" ? WB__peekStr(o.keptId) : null;
  var at = Number(o.at);
  if (id && WB__peekIdOk(id)) {
    var t = typeof now === "number" ? now : Date.now();
    if (!isFinite(at) || at <= 0 || t - at > WB_PEEK_TTL_MS || at - t > WB_PEEK_TTL_MS) {
      out.expired = true;
    } else {
      out.keptId = id;
      out.at = at;
    }
  }
  return out;
}

function WB__peekFold(v) {
  return v === true ? true : v === false ? false : null;
}
function WB_peekSerialize(st) {
  var x = st || {};
  var id = x.keptId != null && WB__peekIdOk(x.keptId) ? WB__peekStr(x.keptId) : null;
  return JSON.stringify({ v: 1, keptId: id, at: id ? Number(x.at) || Date.now() : null, collapsed: WB__peekFold(x.collapsed) });
}

function WB_peekRead(email, now) {
  var k = WB_peekKey(email);
  return WB_peekParse(k ? WB__peekLs(k) : null, now);
}

// Writes the state (null clears the key) and tells this tab.
function WB_peekWrite(email, st) {
  var k = WB_peekKey(email);
  if (!k) return;
  var x = st || {};
  var empty = (x.keptId == null || x.keptId === "") && WB__peekFold(x.collapsed) == null;
  WB__peekLsSet(k, empty ? null : WB_peekSerialize(x));
  WB__peekFire(WB_PEEK_STATE_EVENT, { email: WB__peekEmail(email) });
}

// Keep one client (id) or stop keeping (null). The fold is kept.
function WB_peekSetKept(email, id, now) {
  var cur = WB_peekRead(email, now);
  var next = { keptId: id == null || id === "" ? null : WB__peekStr(id), at: typeof now === "number" ? now : Date.now(), collapsed: cur.collapsed };
  WB_peekWrite(email, next);
  return next;
}
function WB_peekSetCollapsed(email, collapsed, now) {
  var cur = WB_peekRead(email, now);
  WB_peekWrite(email, { keptId: cur.keptId, at: cur.at, collapsed: WB__peekFold(collapsed) });
}
// Ask the summary to read again (after an edit elsewhere, e.g. a pinned note).
function WB_peekReread(clientId) {
  WB__peekFire(WB_PEEK_STATE_EVENT, { reread: clientId == null ? true : WB__peekStr(clientId) });
}

// ---- Access and which client ----

// "ok" (in my client list), "none" (the list is loaded and it isn't there),
// "unknown" (no id, or the list isn't loaded yet). Reads fire only on "ok".
function WB_peekAccess(clientId, clients) {
  if (clientId == null || !WB__peekIdOk(clientId)) return "unknown";
  if (!Array.isArray(clients) || !clients.length) return "unknown";
  var id = WB__peekStr(clientId);
  for (var i = 0; i < clients.length; i++) {
    var c = clients[i];
    if (c && c.id != null && WB__peekStr(c.id) === id) return "ok";
  }
  return "none";
}

// Which client the Client tab shows. Kept wins over the page, unless the
// person chose "Show <page client>" on this page visit (suspendRoute equals
// the page client). Then the page client, then the last one. Returns
// { id, from: "kept" | "route" | "saved" | null }.
function WB_peekWhich(o) {
  var x = o || {};
  var kept = x.keptId != null && WB__peekIdOk(x.keptId) ? WB__peekStr(x.keptId) : null;
  var route = x.routeId != null && WB__peekIdOk(x.routeId) ? WB__peekStr(x.routeId) : null;
  var saved = x.savedId != null && WB__peekIdOk(x.savedId) ? WB__peekStr(x.savedId) : null;
  var suspended = route != null && x.suspendRoute != null && WB__peekStr(x.suspendRoute) === route;
  if (kept && !suspended) return { id: kept, from: "kept" };
  if (route) return { id: route, from: "route" };
  if (saved) return { id: saved, from: "saved" };
  return { id: null, from: null };
}

// ---- The money guard ----
// Conservative on purpose: a client's fee, rate or numbers must never show on
// the Desk, and the note is one click away. Run on the FULL, untrimmed text
// (before any shortening, so a cut like "1,5..." cannot slip through). Hidden
// when the text has: a currency symbol or code; a number token of 2+ digits
// (plain dates like 11/5 and times like 3:30pm are allowed, because staff write
// them all the time); a number with a k/M suffix; or a money word.
var WB_PEEK_MONEY_RE =
  /[$\u20ac\u00a3\u00a5]|\b(usd|eur|gbp|cad)\b|\d[\d,.]*\s?[km]\b|\d{2}|\d[,.]\d|\b(fees?|rates?|pric(e|es|ed|ing)|quot(e|es|ed|ing)|bill(s|ed|ing)?|invoic(e|es|ed|ing)|profits?|revenues?|budgets?|margins?|retainers?|dollars?|bucks|balances?|ar|ap|charg(e|es|ed|ing)|pay(s|ment|ments|ing|roll)?|paid|owe[sd]?|owing|discounts?|raise[sd]?|raising|per (month|hour|year|week)|monthly|hourly|annual|hours billed|costs?|costing|refunds?|salar(y|ies)|wages?|thousand|million|grand|cash ?flow|income|expenses?|spend|spent|worth|afford)\b|\/\s?(mo|hr|yr|month|hour|year)\b/i;
// Dates and times only (11/5, 11/5/26, 2026-11-05, 3:30pm, the 10th) are blanked first.
var WB_PEEK_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b|\b\d{1,2}:\d{2}(\s?[ap]m)?\b|\b\d{1,2}(st|nd|rd|th)\b/gi;
function WB_peekMoney(text) {
  var t = WB__peekStr(text).replace(WB_PEEK_DATE_RE, " ");
  return WB_PEEK_MONEY_RE.test(t);
}

// ---- The whitelist shaper ----

function WB__peekPerson(p, meEmail) {
  if (!p) return null;
  var name = "";
  var email = "";
  if (typeof p === "string") name = p;
  else if (typeof p === "object") {
    name = WB__peekStr(p.name);
    email = WB__peekEmail(p.email);
  }
  name = WB__peekTrim(name, WB_PEEK_NAME_MAX);
  if (!name && !email) return null;
  var you = !!meEmail && !!email && email === meEmail;
  return { name: you ? "You" : name || email.split("@")[0], you: you, key: email || name.toLowerCase() };
}

function WB__peekEmailOk(e) {
  var s = WB__peekStr(e).trim();
  return s.length > 3 && s.length < 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : "";
}

// Contacts: named request contacts first, then portal users (owner decision),
// one per email. Only role, name and email are copied (notes are dropped).
function WB_peekContacts(rec) {
  var r = rec && typeof rec === "object" ? rec : {};
  var seen = {};
  var out = [];
  var add = function (c, kind) {
    if (!c || typeof c !== "object") return;
    var email = WB__peekEmailOk(c.email);
    var name = WB__peekTrim(c.name, WB_PEEK_NAME_MAX);
    if (!email && !name) return;
    var key = email ? email.toLowerCase() : "n:" + name.toLowerCase();
    if (seen[key]) return;
    seen[key] = 1;
    var role = WB__peekTrim(c.role, WB_PEEK_ROLE_MAX);
    if (role && WB_peekMoney(role)) role = "";
    if (!role && kind === "portal") role = "Portal user";
    out.push({ role: role, name: name || email.split("@")[0], email: email });
  };
  (Array.isArray(r.contacts) ? r.contacts : []).forEach(function (c) {
    add(c, "contact");
  });
  (Array.isArray(r.portal) ? r.portal : []).forEach(function (c) {
    add(c, "portal");
  });
  return out;
}

// The flag: the newest pinned Status/Handoff note for this client.
function WB_peekFlag(rows, clientId) {
  var cid = WB__peekStr(clientId);
  var list = (Array.isArray(rows) ? rows : []).filter(function (n) {
    return (
      !!n &&
      n.pinned === true &&
      WB_PEEK_FLAG_CATS.indexOf(WB__peekStr(n.category).toLowerCase()) >= 0 &&
      WB__peekStr(n.client_id) === cid &&
      WB__peekStr(n.text).trim() !== ""
    );
  });
  list.sort(function (a, b) {
    return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0);
  });
  var n = list[0];
  if (!n) return null;
  if (WB_peekMoney(n.text)) return { text: WB_PEEK_FLAG_HIDDEN, hidden: true };
  return { text: WB__peekTrim(n.text, WB_PEEK_FLAG_MAX), hidden: false };
}

// The last message the client can see (internal strictly false, not deleted,
// this client).
function WB_peekMessage(rows, clientId) {
  var cid = WB__peekStr(clientId);
  var list = (Array.isArray(rows) ? rows : []).filter(function (m) {
    return !!m && m.internal === false && m.deleted_at == null && WB__peekStr(m.client_id) === cid;
  });
  list.sort(function (a, b) {
    return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0);
  });
  var m = list[0];
  if (!m) return null;
  var staff = m.author_kind === "staff";
  var hidden = WB_peekMoney(m.body); // the full text, before it is shortened
  var body = WB__peekTrim(m.body, WB_PEEK_MSG_MAX);
  var who = WB__peekTrim(m.author_name, WB_PEEK_NAME_MAX) || (staff ? "MyGoodBooks" : "Client");
  if (WB_peekMoney(who)) who = staff ? "MyGoodBooks" : "Client";
  hidden = hidden && !!body;
  return {
    who: who,
    kindLabel: staff ? "Staff" : "Client",
    at: m.created_at ? WB__peekStr(m.created_at) : null,
    text: !body ? "(attachment)" : hidden ? WB_PEEK_MSG_HIDDEN : body,
    hidden: hidden,
  };
}

function WB_peekDriveUrl(folderId, driveOn) {
  if (driveOn !== true) return null;
  var id = WB__peekStr(folderId).trim();
  if (!id || id.length > 200 || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  return "https://drive.google.com/drive/folders/" + encodeURIComponent(id);
}

// client: one entry of my client list. reads: { contacts, drive, flag,
// message }, each { status: "loading" | "ok" | "error", data }. me: my email.
// Returns ONLY the fields below.
function WB_peekShape(client, reads, me) {
  var c = client && typeof client === "object" ? client : {};
  var r = reads && typeof reads === "object" ? reads : {};
  var meEmail = WB__peekEmail(me);
  var cid = WB__peekStr(c.id);
  var st = function (k) {
    var x = r[k];
    return x && (x.status === "ok" || x.status === "error") ? x.status : "loading";
  };
  var data = function (k) {
    return r[k] && r[k].status === "ok" ? r[k].data : null;
  };
  var bk = WB__peekPerson(c.assignedBookkeeper, meEmail);
  var am = WB__peekPerson(c.accountManager, meEmail);
  if (am && bk && am.key && am.key === bk.key) am = null;
  var people = WB_peekContacts(data("contacts"));
  var drive = data("drive") || {};
  var view = {
    bookkeeper: bk ? { name: bk.name, you: bk.you } : null,
    am: am ? { name: am.name, you: am.you } : null,
    contact: people.length ? { role: people[0].role, name: people[0].name, email: people[0].email } : null,
    moreCount: Math.max(0, people.length - 1),
    driveUrl: WB_peekDriveUrl(drive.folderId, drive.on === true),
    flag: WB_peekFlag(data("flag"), cid),
    message: WB_peekMessage(data("message"), cid),
    status: { contacts: st("contacts"), drive: st("drive"), flag: st("flag"), message: st("message") },
  };
  return view;
}

// "3 open · 1 late" from the tab's own list (already loaded). isOpen / isLate
// default to TK_isOpen / TK_isOverdue when they are loaded.
function WB_peekTaskCount(tasks, today, isOpen, isLate) {
  var open = typeof isOpen === "function" ? isOpen : typeof TK_isOpen === "function" ? TK_isOpen : function (t) {
    return !!t && t.status !== "done" && t.status !== "cancelled";
  };
  var late = typeof isLate === "function" ? isLate : typeof TK_isOverdue === "function" ? TK_isOverdue : function (t, d) {
    return !!t && !!t.due_date && String(t.due_date).slice(0, 10) < d;
  };
  var n = 0;
  var l = 0;
  (Array.isArray(tasks) ? tasks : []).forEach(function (t) {
    if (!t || !open(t)) return;
    n += 1;
    if (late(t, today)) l += 1;
  });
  return { open: n, late: l, text: n ? n + " open" + (l ? " · " + l + " late" : "") : "No open tasks" };
}

// The folded one line: "Ana · Jo Smith · Drive ↗" (the Drive part is a link
// the component draws; here it is just whether to show it).
function WB_peekFoldParts(view) {
  var v = view || {};
  var parts = [];
  if (v.bookkeeper && v.bookkeeper.name) parts.push(v.bookkeeper.name);
  if (v.contact && v.contact.name) parts.push(v.contact.name);
  return { text: parts.join(" · "), drive: !!v.driveUrl };
}

// The summary's open/folded default per tier when the person never chose:
// short is folded, medium and tall are open. A saved fold always wins.
function WB_peekFolded(tier, saved) {
  if (saved === true) return true;
  if (saved === false) return false;
  return tier === "short";
}

// ---- The reads ----
// Four requests, in parallel, for ONE client I can open (the caller checks
// WB_peekAccess first; this checks again and fires nothing otherwise).
function WB__peekRows(res) {
  if (!res) throw new Error("No reply");
  if (res.error) throw res.error;
  return Array.isArray(res.data) ? res.data : res.data == null ? [] : [res.data];
}
function WB_peekQuery(sb, clientId, section) {
  var cid = WB__peekStr(clientId);
  if (section === "contacts") return sb.rpc("tk_request_recipients", { p_client_id: cid });
  if (section === "drive") {
    return sb.from("drive_folders").select("drive_folder_id").eq("client_id", cid).is("year", null).is("doc_type", null).limit(1);
  }
  if (section === "flag") {
    return sb
      .from("client_private_notes")
      .select(WB_PEEK_NOTE_COLS)
      .eq("client_id", cid)
      .eq("pinned", true)
      .in("category", WB_PEEK_FLAG_CATS)
      .order("created_at", { ascending: false })
      .limit(1);
  }
  if (section === "message") {
    return sb
      .from("client_messages")
      .select(WB_PEEK_MSG_COLS)
      .eq("client_id", cid)
      .eq("internal", false)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
  }
  throw new Error("Unknown section " + section);
}
var WB_PEEK_SECTIONS = ["contacts", "drive", "flag", "message"];

// sb: the Supabase client. clients: my client list (access check). seq: a
// WB_cxSeq()-style guard ({reset, start, ok}). driveStatus: () => Promise of
// true/false (DRV_status), optional. apply(section, state) with state
// { clientId, status, data }. Resolves when every read settled. Returns
// null (and fires NOTHING) when the client isn't one I can open.
function WB_peekFetch(sb, clientId, clients, seq, apply, driveStatus, sections) {
  if (!sb || WB_peekAccess(clientId, clients) !== "ok") return null;
  var cid = WB__peekStr(clientId);
  var list = Array.isArray(sections) && sections.length ? sections : WB_PEEK_SECTIONS;
  if (!Array.isArray(sections) || !sections.length) seq.reset();
  var jobs = list.map(function (sec) {
    var tok = seq.start(sec);
    apply(sec, { clientId: cid, status: "loading", data: null });
    var p = Promise.resolve().then(function () {
      if (sec === "contacts") {
        return Promise.resolve(WB_peekQuery(sb, cid, sec)).then(function (res) {
          if (!res) throw new Error("No reply");
          if (res.error) throw res.error;
          var d = res.data && typeof res.data === "object" && !Array.isArray(res.data) ? res.data : {};
          return { contacts: Array.isArray(d.contacts) ? d.contacts : [], portal: Array.isArray(d.portal) ? d.portal : [] };
        });
      }
      if (sec === "drive") {
        var on = typeof driveStatus === "function" ? Promise.resolve().then(driveStatus) : Promise.resolve(false);
        return on.then(function (isOn) {
          if (isOn !== true) return { on: false, folderId: null };
          return Promise.resolve(WB_peekQuery(sb, cid, sec)).then(function (res) {
            var rows = WB__peekRows(res);
            return { on: true, folderId: rows[0] && rows[0].drive_folder_id ? WB__peekStr(rows[0].drive_folder_id) : null };
          });
        });
      }
      return Promise.resolve(WB_peekQuery(sb, cid, sec)).then(WB__peekRows);
    });
    return p.then(
      function (data) {
        if (seq.ok(tok)) apply(sec, { clientId: cid, status: "ok", data: data });
      },
      function () {
        // Nothing is logged with client data.
        if (seq.ok(tok)) apply(sec, { clientId: cid, status: "error", data: null });
      },
    );
  });
  return Promise.all(jobs);
}

// A small per-page memory of the last reads, so re-opening the Desk within
// two minutes draws at once without reading again. Holds shaped-input rows
// for ONE client and one person; cleared on any other client.
var WB__peekMem = { email: null, clientId: null, at: 0, reads: null };
function WB_peekMemGet(email, clientId, now) {
  var m = WB__peekMem;
  var t = typeof now === "number" ? now : Date.now();
  if (!m.reads || m.email !== WB__peekEmail(email) || m.clientId !== WB__peekStr(clientId)) return null;
  return { reads: m.reads, fresh: t - m.at < WB_PEEK_STALE_MS };
}
function WB_peekMemPut(email, clientId, reads, now) {
  WB__peekMem = { email: WB__peekEmail(email), clientId: WB__peekStr(clientId), at: typeof now === "number" ? now : Date.now(), reads: reads };
}
function WB_peekMemClear() {
  WB__peekMem = { email: null, clientId: null, at: 0, reads: null };
}

// ---- Desk Customize prefs (R3) ----

function WB_deskPrefsKey(email) {
  var e = WB__peekEmail(email);
  return e ? "mgb_wb_deskprefs:" + e : null;
}
// Defaults: Glance and Right now on, both rail and bar when closed.
function WB_deskPrefsParse(raw) {
  var out = { on: { glance: true, rightNow: true }, closed: "both" };
  if (!raw) return out;
  var o;
  try {
    o = JSON.parse(raw);
  } catch (e) {
    return out;
  }
  if (!o || typeof o !== "object" || Array.isArray(o) || o.v !== 1) return out;
  var on = o.on && typeof o.on === "object" ? o.on : {};
  if (on.glance === false) out.on.glance = false;
  if (on.rightNow === false) out.on.rightNow = false;
  if (WB_DESKPREFS_CLOSED.indexOf(o.closed) >= 0) out.closed = o.closed;
  return out;
}
function WB_deskPrefsSerialize(p) {
  var x = WB_deskPrefsParse(JSON.stringify(Object.assign({ v: 1 }, p || {})));
  return JSON.stringify({ v: 1, on: { glance: x.on.glance, rightNow: x.on.rightNow }, closed: x.closed });
}
function WB_deskPrefsIsDefault(p) {
  var x = p || {};
  return !!(x.on && x.on.glance !== false && x.on.rightNow !== false) && (x.closed || "both") === "both";
}
function WB_deskPrefsRead(email) {
  var k = WB_deskPrefsKey(email);
  return WB_deskPrefsParse(k ? WB__peekLs(k) : null);
}
function WB_deskPrefsWrite(email, p) {
  var k = WB_deskPrefsKey(email);
  if (!k) return;
  WB__peekLsSet(k, WB_deskPrefsIsDefault(p) ? null : WB_deskPrefsSerialize(p));
  WB__peekFire(WB_DESKPREFS_EVENT, { email: WB__peekEmail(email) });
}
// The keys Reset Desk clears for one person. Star pins and recents stay.
function WB_deskResetKeys(email) {
  var e = WB__peekEmail(email);
  if (!e) return [];
  return ["mgb_wb_deskprefs:" + e, "mgb_wb_desk:" + e, "mgb_wb_hub:" + e, "mgb_wb_peek:" + e];
}
function WB_deskReset(email) {
  WB_deskResetKeys(email).forEach(function (k) {
    WB__peekLsSet(k, null);
  });
  WB_peekMemClear();
  // The in-memory Desk width and hub state too, so the change shows at once and
  // a pending hub save cannot write the old value back.
  try {
    if (typeof WB_store !== "undefined" && WB_store && typeof WB_store.resetDesk === "function") WB_store.resetDesk();
  } catch (e) {}
  WB__peekFire(WB_DESKPREFS_EVENT, { email: WB__peekEmail(email), reset: true });
  WB__peekFire(WB_PEEK_STATE_EVENT, { email: WB__peekEmail(email) });
}

// Hook: the prefs, re-read on change (this tab or another). Off: defaults,
// no listeners.
function WB_useDeskPrefs(email, on) {
  var live = on === true && !!WB_deskPrefsKey(email);
  var s = React.useState(0);
  var bump = s[1];
  React.useEffect(
    function () {
      if (!live) return undefined;
      var k = WB_deskPrefsKey(email);
      var hit = function () {
        bump(function (n) {
          return n + 1;
        });
      };
      var onStorage = function (e) {
        if (!e || !e.key || e.key === k) hit();
      };
      window.addEventListener(WB_DESKPREFS_EVENT, hit);
      window.addEventListener("storage", onStorage);
      return function () {
        window.removeEventListener(WB_DESKPREFS_EVENT, hit);
        window.removeEventListener("storage", onStorage);
      };
    },
    [live, email],
  );
  return live ? WB_deskPrefsRead(email) : null;
}

// Hook: my keep state ({ keptId, at, collapsed }), re-read on change (this
// tab or another). An expired keep is cleared once with a toast. Off: an
// empty state, no listeners, and the stored keep is left as it is.
var WB__peekExpiredToasted = {};
function WB_usePeekKeep(email, on) {
  var live = on === true && !!WB_peekKey(email);
  var s = React.useState(0);
  var bump = s[1];
  React.useEffect(
    function () {
      if (!live) return undefined;
      var k = WB_peekKey(email);
      var hit = function (e) {
        var d = e && e.detail;
        if (d && d.reread != null && d.email == null) return; // a re-read, not a keep change
        bump(function (n) {
          return n + 1;
        });
      };
      var onStorage = function (e) {
        if (!e || !e.key || e.key === k) hit();
      };
      // A keep older than 24 hours must also clear in a tab that stays open:
      // re-read on focus, when the tab becomes visible and every 5 minutes.
      var onVis = function () {
        if (typeof document === "undefined" || document.visibilityState !== "hidden") hit();
      };
      var tick = setInterval(hit, 5 * 60 * 1000);
      window.addEventListener(WB_PEEK_STATE_EVENT, hit);
      window.addEventListener("storage", onStorage);
      window.addEventListener("focus", hit);
      if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("visibilitychange", onVis);
      return function () {
        clearInterval(tick);
        window.removeEventListener(WB_PEEK_STATE_EVENT, hit);
        window.removeEventListener("storage", onStorage);
        window.removeEventListener("focus", hit);
        if (typeof document !== "undefined" && document.removeEventListener) document.removeEventListener("visibilitychange", onVis);
      };
    },
    [live, email],
  );
  var st = live ? WB_peekRead(email) : { keptId: null, at: null, collapsed: null, expired: false };
  var expired = live && st.expired;
  React.useEffect(
    function () {
      if (!expired) return;
      var who = WB__peekEmail(email);
      WB_peekWrite(email, { keptId: null, collapsed: st.collapsed });
      if (WB__peekExpiredToasted[who]) return;
      WB__peekExpiredToasted[who] = 1;
      try {
        window.dispatchEvent(new CustomEvent("mgb:toast", { detail: { text: "The Desk stopped keeping a client after 24 hours." } }));
      } catch (e) {}
    },
    [expired, email],
  );
  return st;
}

// The ⌘K row (TB_actionRows): null unless the peek is on and I'm on a client
// page. kept: my kept id. Returns { key, title, sub, keywords, kept }.
function WB_peekActionRow(on, client, keptId) {
  if (on !== true || !client || client.id == null || !WB__peekIdOk(client.id)) return null;
  var id = WB__peekStr(client.id);
  var name = WB__peekTrim(client.name, WB_PEEK_NAME_MAX) || "this client";
  var isKept = keptId != null && WB__peekStr(keptId) === id;
  return {
    key: "peek-keep",
    title: isKept ? "Stop keeping " + name : "Keep " + name + " on Desk",
    sub: isKept ? "The Desk's Client tab follows the page again" : "The Desk's Client tab stays on this client",
    keywords: ["keep", "pin", "desk", "peek", "client", "summary"],
    kept: isKept,
    clientId: id,
  };
}

// Keep or stop keeping the page client from outside the Desk (the client
// page button, ⌘K, the p key). Keeping also opens the Desk on the Client tab.
// Returns the new kept id (or null).
function WB_peekToggleFromPage(email, client) {
  if (!client || client.id == null || !WB__peekIdOk(client.id) || !WB_peekKey(email)) return null;
  var id = WB__peekStr(client.id);
  var cur = WB_peekRead(email);
  var name = WB__peekTrim(client.name, WB_PEEK_NAME_MAX) || "this client";
  if (cur.keptId === id) {
    WB_peekSetKept(email, null);
    try {
      window.dispatchEvent(new CustomEvent("mgb:toast", { detail: { text: "Stopped keeping " + name + " on the Desk." } }));
    } catch (e) {}
    return null;
  }
  WB_peekSetKept(email, id);
  if (typeof WB_store !== "undefined" && WB_store) {
    WB_store.setHub({ tab: "client", clientId: id });
    WB_store.setDrawerOpen(true, "peek");
  }
  try {
    window.dispatchEvent(new CustomEvent("mgb:toast", { detail: { text: "Keeping " + name + " on the Desk." } }));
  } catch (e) {}
  return id;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    WB_peekIsOn: WB_peekIsOn,
    WB_peekSwitchValue: WB_peekSwitchValue,
    WB_peekPreviewOn: WB_peekPreviewOn,
    WB_peekReadSwitch: WB_peekReadSwitch,
    WB_peekOn: WB_peekOn,
    WB_peekFirmOn: WB_peekFirmOn,
    WB_peekKey: WB_peekKey,
    WB_peekParse: WB_peekParse,
    WB_peekSerialize: WB_peekSerialize,
    WB_peekRead: WB_peekRead,
    WB_peekWrite: WB_peekWrite,
    WB_peekSetKept: WB_peekSetKept,
    WB_peekSetCollapsed: WB_peekSetCollapsed,
    WB_peekAccess: WB_peekAccess,
    WB_peekWhich: WB_peekWhich,
    WB_peekMoney: WB_peekMoney,
    WB_peekContacts: WB_peekContacts,
    WB_peekFlag: WB_peekFlag,
    WB_peekMessage: WB_peekMessage,
    WB_peekDriveUrl: WB_peekDriveUrl,
    WB_peekShape: WB_peekShape,
    WB_peekTaskCount: WB_peekTaskCount,
    WB_peekFoldParts: WB_peekFoldParts,
    WB_peekFolded: WB_peekFolded,
    WB_peekQuery: WB_peekQuery,
    WB_peekFetch: WB_peekFetch,
    WB_peekMemGet: WB_peekMemGet,
    WB_peekMemPut: WB_peekMemPut,
    WB_peekMemClear: WB_peekMemClear,
    WB_peekActionRow: WB_peekActionRow,
    WB_peekToggleFromPage: WB_peekToggleFromPage,
    WB_deskPrefsKey: WB_deskPrefsKey,
    WB_deskPrefsParse: WB_deskPrefsParse,
    WB_deskPrefsSerialize: WB_deskPrefsSerialize,
    WB_deskPrefsRead: WB_deskPrefsRead,
    WB_deskPrefsWrite: WB_deskPrefsWrite,
    WB_deskResetKeys: WB_deskResetKeys,
    WB_deskReset: WB_deskReset,
    WB_PEEK_PREVIEW_KEY: WB_PEEK_PREVIEW_KEY,
    WB_PEEK_CACHE_KEY: WB_PEEK_CACHE_KEY,
    WB_PEEK_EVENT: WB_PEEK_EVENT,
    WB_PEEK_STATE_EVENT: WB_PEEK_STATE_EVENT,
    WB_PEEK_SWITCH: WB_PEEK_SWITCH,
    WB_PEEK_TTL_MS: WB_PEEK_TTL_MS,
    WB_PEEK_FLAG_HIDDEN: WB_PEEK_FLAG_HIDDEN,
    WB_PEEK_MSG_HIDDEN: WB_PEEK_MSG_HIDDEN,
    WB_PEEK_SECTIONS: WB_PEEK_SECTIONS,
  };
}
