// ----------------------------------------------------------------------------
// GLR_fingerprint: month fingerprints (spec 4.5).
//
// For each month: one string per line  key|acct_id|date|cents|cls|loc|name_id
// sorted (never QuickBooks row order), joined with "\n", SHA-256 hex.
// line_count = lines; debit_total = sum of debit-side amounts, where the
// debit side is fixed by the account's classification:
//   Asset, Expense (and unknown): positive amount = debit
//   Liability, Equity, Revenue:   negative amount = debit
// so a balanced month has debit_total equal to its credit total.
//
// The qbo-gl-review edge function must build the same strings (Deno port);
// the browser computes it for display and tests only.
//
//   monthPrints(lines, { basis }) -> Promise<[{ period 'YYYY-MM-01', basis, ym, line_count,
//     debit_total, debit_cents, credit_cents, hash }]>
//   lineString(line) -> string
//   sha256Hex(string) -> Promise<hex>
//   baselineLines(lines, 'YYYY-MM') -> [[key, acct_id, date, cents, name]]
// ----------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module && module.exports) module.exports = factory(require("./GLR_config.js"));
  else root.GLR_fingerprint = factory(root.GLR_config);
})(typeof window !== "undefined" ? window : globalThis, function (C) {
  "use strict";

  var s = function (v) { return v == null ? "" : String(v).replace(/[|\n\r]/g, " "); };

  function centsOf(l) { return l.cents != null ? Math.round(l.cents) : C.toCents(l.amt); }

  function lineString(l) {
    return [s(l.key), s(l.acct_id), s(l.date), String(centsOf(l)), s(l.cls), s(l.loc), s(l.name_id)].join("|");
  }

  function isDebit(l) {
    var c = centsOf(l);
    var cls = l.classification;
    var creditNormal = cls === "Liability" || cls === "Equity" || cls === "Revenue";
    return creditNormal ? c < 0 : c > 0;
  }

  function toHex(buf) {
    var b = new Uint8Array(buf), out = "";
    for (var i = 0; i < b.length; i++) out += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return out;
  }

  function sha256Hex(str) {
    var subtle = typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle;
    if (subtle && typeof TextEncoder !== "undefined") {
      return subtle.digest("SHA-256", new TextEncoder().encode(str)).then(toHex);
    }
    try {
      // Older Node without globalThis.crypto
      var nodeCrypto = require("crypto");
      return Promise.resolve(nodeCrypto.createHash("sha256").update(str, "utf8").digest("hex"));
    } catch (e) {
      return Promise.reject(new Error("SHA-256 isn't available in this browser."));
    }
  }

  function byMonth(lines) {
    var m = new Map();
    (lines || []).forEach(function (l) {
      if (!l || !l.date) return;
      var k = C.ym(l.date);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(l);
    });
    return m;
  }

  function monthPrints(lines, opts) {
    var basis = opts && opts.basis ? String(opts.basis) : null;
    var months = Array.from(byMonth(lines).entries()).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
    return Promise.all(months.map(function (e) {
      var list = e[1];
      var strs = list.map(lineString).sort();
      var deb = 0, cred = 0;
      list.forEach(function (l) {
        var c = Math.abs(centsOf(l));
        if (isDebit(l)) deb += c; else cred += c;
      });
      return sha256Hex(strs.join("\n")).then(function (hash) {
        return {
          period: e[0] + "-01",
          basis: basis,
          ym: e[0],
          line_count: list.length,
          debit_total: deb / 100,
          debit_cents: deb,
          credit_cents: cred,
          hash: hash,
        };
      });
    }));
  }

  // Closed-month snapshot rows (spec 4.5), sorted like the hash input.
  function baselineLines(lines, period) {
    return (lines || []).filter(function (l) { return l && l.date && C.ym(l.date) === period; })
      .map(function (l) { return [l.key, l.acct_id == null ? null : String(l.acct_id), l.date, centsOf(l), l.name || ""]; })
      .sort(function (a, b) {
        var x = a.join("|"), y = b.join("|");
        return x < y ? -1 : x > y ? 1 : 0;
      });
  }

  return { monthPrints: monthPrints, lineString: lineString, sha256Hex: sha256Hex, baselineLines: baselineLines, isDebit: isDebit };
});
