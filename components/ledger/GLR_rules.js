// ----------------------------------------------------------------------------
// GLR_rules: applies gl_review_rules rows (spec 4.2) to lines and flags.
//
// Rule row (the table's columns; extra fields ignored):
//   { id, kind: 'stop_flagging'|'pass_through'|'account_type_override'|'threshold',
//     status: 'active'|'suggested'|'dismissed', flag_type, match_name,
//     account_qbo_id, account_name, account_type_override, params }
//
// Only 'active' rules apply. A 'dismissed' pass_through row for an account
// turns off the name-based pass-through suggestion for it ("removable
// suggestion", spec 4.2). 'threshold' rules are stored for later and ignored.
//
// Account matching: API lines match on account_qbo_id; file lines (no ids)
// match on account_name, case-insensitive. A rule with only account_name also
// matches API lines by name, so a rule saved from a file still works.
// ----------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module && module.exports) module.exports = factory(require("./GLR_config.js"));
  else root.GLR_rules = factory(root.GLR_config);
})(typeof window !== "undefined" ? window : globalThis, function (C) {
  "use strict";

  var low = function (s) { return String(s == null ? "" : s).trim().toLowerCase(); };
  function active(rules, kind) {
    return (rules || []).filter(function (r) { return r && r.kind === kind && (r.status || "active") === "active"; });
  }

  // Does rule's account part match this line? null when the rule names no account.
  function accountMatches(rule, line) {
    var hasId = rule.account_qbo_id != null && rule.account_qbo_id !== "";
    var hasName = low(rule.account_name) !== "";
    if (!hasId && !hasName) return null;
    if (hasId && line.acct_id != null && String(rule.account_qbo_id) === String(line.acct_id)) return true;
    if (hasName && low(rule.account_name) === low(line.acct)) return true;
    return false;
  }

  // account key used across GLR_ files: id when present, else the name.
  function acctKey(line) { return line.acct_id != null ? "id:" + line.acct_id : "n:" + low(line.acct); }

  // ---- account_type_override: rewrites acct_type / classification in place
  // (on copies). Returns new line objects; input untouched.
  function applyAccountTypes(lines, rules) {
    var overrides = active(rules, "account_type_override").filter(function (r) { return C.normalizeAccountType(r.account_type_override); });
    if (!overrides.length) return lines.slice();
    return lines.map(function (l) {
      for (var i = 0; i < overrides.length; i++) {
        if (accountMatches(overrides[i], l)) {
          var t = C.normalizeAccountType(overrides[i].account_type_override);
          var copy = Object.assign({}, l, { acct_type: t, classification: C.classificationOf(t), acct_type_source: "override" });
          return copy;
        }
      }
      return l;
    });
  }

  // ---- pass_through. Returns { keys: {acctKey: true}, accounts: [...] }.
  // accounts[]: { acct, acct_id, source: 'rule'|'auto', rule_id }.
  // Auto-detection (name regex) only considers balance-sheet accounts, so an
  // expense like "Wheelchair ramp repairs" is never a spend card.
  function passThrough(lines, rules) {
    var explicit = active(rules, "pass_through");
    var dismissed = (rules || []).filter(function (r) { return r && r.kind === "pass_through" && r.status === "dismissed"; });
    var keys = {}, accounts = [], seen = {};
    (lines || []).forEach(function (l) {
      var k = acctKey(l);
      if (seen[k]) return;
      seen[k] = true;
      for (var i = 0; i < explicit.length; i++) {
        if (accountMatches(explicit[i], l)) {
          keys[k] = true;
          accounts.push({ acct: l.acct, acct_id: l.acct_id, source: "rule", rule_id: explicit[i].id || null });
          return;
        }
      }
      if (C.RX.passThrough.test(l.acct) && !C.isPL(l.classification)) {
        for (var j = 0; j < dismissed.length; j++) if (accountMatches(dismissed[j], l)) return;
        keys[k] = true;
        accounts.push({ acct: l.acct, acct_id: l.acct_id, source: "auto", rule_id: null });
      }
    });
    return { keys: keys, accounts: accounts, has: function (line) { return !!keys[acctKey(line)]; } };
  }

  // ---- stop_flagging. flag has flag_type and _lines (every line behind it).
  // Name match is case-insensitive exact on the line name; when the rule has
  // both a name and an account, both must match.
  function stopRuleFor(flag, rules) {
    var list = active(rules, "stop_flagging");
    var lines = flag._lines && flag._lines.length ? flag._lines : flag.line ? [flag.line] : [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (r.flag_type && r.flag_type !== flag.flag_type) continue;
      if (!r.flag_type) continue; // spec: stop_flagging needs a flag_type
      var wantName = low(r.match_name) !== "";
      var ok = lines.some(function (l) {
        var a = accountMatches(r, l);
        var n = wantName ? low(l.name) === low(r.match_name) : null;
        if (a === null && n === null) return false;
        return (a === null || a) && (n === null || n);
      });
      if (ok) return r;
    }
    return null;
  }

  return {
    applyAccountTypes: applyAccountTypes,
    passThrough: passThrough,
    stopRuleFor: stopRuleFor,
    accountMatches: accountMatches,
    acctKey: acctKey,
  };
});
