// ----------------------------------------------------------------------------
// Slate plus: @mention helpers for task comments (pure, no DOM, no network).
// Only used while TKP_on() (components/tasks/TK_slatePlus.js) is true; with it
// off TK_Comments behaves exactly as before. Spec:
// docs/slateplus-mentions-spec.md (G1 picker, G2 note after posting, G3 "me").
//
//   TKM_pickerLists(query, staff, candidates, matchFn, me)
//       -> { pick: [staff], off: [staff] }
//     pick: who can be mentioned (in candidates, from tk_mention_candidates).
//     off: up to 2 matching active staff who can't see this task (shown muted,
//     not pickable). You (me) are in neither list: the server never lists the
//     caller and a self-mention sends nothing. candidates not an array (still
//     loading or failed): the old list, nothing marked off.
//   TKM_postNote({ body, staff, mentions, candidates, me }) -> { notified,
//     missed, inactive, self, text }
//     Built from the SAVED row's server-computed mentions, never a guess.
//   TKM_isMe(handle, me) -> boolean
//
// Node tests: components/tasks/TK_mentionsLogic.test.js.
// ----------------------------------------------------------------------------

var TKM_HANDLE_RE = /(^|[^A-Za-z0-9_.])@([A-Za-z0-9._-]{2,64})/g;

function TKM__lower(s) {
  return String(s == null ? "" : s).trim().toLowerCase();
}
function TKM__handle(email) {
  return TKM__lower(email).split("@")[0];
}

function TKM_isMe(handle, me) {
  var h = TKM__lower(handle).replace(/^@+/, "");
  return !!h && !!me && h === TKM__handle(me);
}

function TKM__set(list) {
  var out = {};
  (list || []).forEach(function (e) {
    var k = TKM__lower(e && typeof e === "object" ? e.email : e);
    if (k) out[k] = true;
  });
  return out;
}

function TKM_pickerLists(query, staff, candidates, matchFn, me) {
  var list = staff || [];
  if (typeof matchFn !== "function") return { pick: [], off: [] };
  if (!Array.isArray(candidates)) return { pick: matchFn(query, list, 6), off: [] };
  var ok = TKM__set(candidates);
  var mine = TKM__lower(me);
  var inSet = list.filter(function (s) { return s && ok[TKM__lower(s.email)] && TKM__lower(s.email) !== mine; });
  var outSet = list.filter(function (s) {
    return s && s.email && !ok[TKM__lower(s.email)] && TKM__lower(s.email) !== mine;
  });
  return { pick: matchFn(query, inSet, 6), off: matchFn(query, outSet, 2) };
}

// "A", "A and B", "A, B and C"
function TKM__names(names) {
  if (names.length <= 1) return names.join("");
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

function TKM_postNote(o) {
  var opt = o || {};
  var me = TKM__lower(opt.me);
  var byHandle = {};
  (opt.staff || []).forEach(function (s) {
    if (s && s.email) {
      var h = TKM__handle(s.email);
      if (!byHandle[h]) byHandle[h] = s;
    }
  });
  var saved = TKM__set(opt.mentions);
  var cands = Array.isArray(opt.candidates) ? TKM__set(opt.candidates) : null;
  var seen = {};
  var res = { notified: [], missed: [], inactive: [], self: false, text: "" };
  var s = String(opt.body == null ? "" : opt.body);
  var m;
  TKM_HANDLE_RE.lastIndex = 0;
  while ((m = TKM_HANDLE_RE.exec(s)) !== null) {
    var h = m[2].toLowerCase().replace(/\.+$/, "");
    var person = byHandle[h];
    if (!person) continue; // not a staff handle: plain text, same as rendering
    var em = TKM__lower(person.email);
    if (seen[em]) continue;
    seen[em] = true;
    var name = person.name || TKM__handle(em);
    if (em === me) res.self = true;
    else if (person.active === false) res.inactive.push(name);
    else if (saved[em] && (!cands || cands[em])) res.notified.push(name);
    else res.missed.push(name);
  }
  var parts = [];
  if (res.notified.length) parts.push(TKM__names(res.notified) + (res.notified.length === 1 ? " was" : " were") + " notified.");
  if (res.missed.length) parts.push(TKM__names(res.missed) + " can't see this task, so they weren't notified.");
  if (res.inactive.length) parts.push(TKM__names(res.inactive) + (res.inactive.length === 1 ? " isn't an active staff member" : " aren't active staff members") + ", so no notice was sent.");
  if (res.self) parts.push("You don't get a notice for mentioning yourself.");
  res.text = parts.join(" ");
  return res;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TKM_pickerLists: TKM_pickerLists,
    TKM_postNote: TKM_postNote,
    TKM_isMe: TKM_isMe,
  };
}
