// Client org profile: one-time import DRY RUN (pure logic, nothing is saved).
// Reads the owner's anniversary sheet as CSV text (columns Customer Name,
// Email, Anniversary, Address), matches each row to a portal client by name,
// and sorts the rows into buckets for a report. There is no write path here:
// the real import waits for owner approval.
// Tested by components/client/OP_importLogic.test.js on invented rows only.
// No sheet content belongs in the repo, tests, reports or commits.

// RFC-4180-ish CSV: quoted fields, "" inside quotes, CRLF or LF, a BOM.
// Returns { headers: [..], rows: [{header: value}] }. Blank lines are skipped.
function OPI_parseCsv(text) {
  var s = String(text || "");
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  var records = [];
  var field = "";
  var rec = [];
  var inQ = false;
  for (var i = 0; i < s.length; i++) {
    var ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQ = true;
    else if (ch === ",") {
      rec.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      rec.push(field);
      records.push(rec);
      rec = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || rec.length) {
    rec.push(field);
    records.push(rec);
  }
  records = records.filter(function (r) {
    return r.some(function (c) {
      return String(c).trim() !== "";
    });
  });
  if (!records.length) return { headers: [], rows: [] };
  var headers = records[0].map(function (h) {
    return String(h).trim();
  });
  var rows = records.slice(1).map(function (r) {
    var o = {};
    headers.forEach(function (h, j) {
      o[h] = r[j] === undefined ? "" : String(r[j]).trim();
    });
    return o;
  });
  return { headers: headers, rows: rows };
}

// Find a column by a loose header name ("customer name", "Customer  Name").
function OPI_col(headers, want) {
  var w = want.toLowerCase().replace(/[^a-z]/g, "");
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).toLowerCase().replace(/[^a-z]/g, "") === w) return headers[i];
  }
  return null;
}

// Words that do not tell two organizations apart.
var OPI_STOP = { the: 1, inc: 1, incorporated: 1, llc: 1, ltd: 1, co: 1, corp: 1, corporation: 1, company: 1, pllc: 1, pc: 1, lp: 1, llp: 1, of: 1 };

// Lowercase, & -> and, punctuation out, legal suffixes and "the" dropped.
function OPI_normalizeName(s) {
  var t = String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return t
    .split(/\s+/)
    .filter(function (w) {
      return w && !OPI_STOP[w];
    })
    .join(" ");
}

function OPI_tokens(norm) {
  return norm ? norm.split(" ") : [];
}

// Similarity 0..1 of two normalized names: token overlap (Dice), with a
// bonus when one name's words are all inside the other's.
function OPI_similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  var ta = OPI_tokens(a);
  var tb = OPI_tokens(b);
  var setB = {};
  tb.forEach(function (w) {
    setB[w] = 1;
  });
  var common = 0;
  var seen = {};
  ta.forEach(function (w) {
    if (setB[w] && !seen[w]) {
      common++;
      seen[w] = 1;
    }
  });
  var ua = Object.keys(
    ta.reduce(function (m, w) {
      m[w] = 1;
      return m;
    }, {}),
  ).length;
  var ub = Object.keys(setB).length;
  if (!common) return 0;
  var dice = (2 * common) / (ua + ub);
  var contained = common === Math.min(ua, ub);
  // One name inside the other ("Example Food Bank" vs "Example Food Bank of
  // Springfield") is a strong hint but not an exact match.
  return contained ? Math.max(dice, 0.85) : dice;
}

var OPI_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

function OPI_pad2(n) {
  return (n < 10 ? "0" : "") + n;
}
function OPI_daysIn(y, m) {
  var leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

// Which date this probably is, from its year (owner note: recent years are
// the date they became a client; older years are when they were founded).
function OPI_hint(year) {
  if (year >= 2025 && year <= 2026) return "probably client-since";
  return "probably established";
}

// Read a hand-typed anniversary. `today` is "YYYY-MM-DD".
// Returns { status, iso?, year?, month?, day?, hint?, reason? } where status is
//   "ok"         a full date (iso set)
//   "partial"    month and year, or a year only (no day)
//   "ambiguous"  "Maybe ..." or similar hedges (what follows is still read)
//   "bad"        not a date, or in the future
//   "empty"      blank
function OPI_parseLooseDate(raw, today) {
  var s = String(raw || "").trim();
  today = today || new Date().toISOString().slice(0, 10);
  if (!s) return { status: "empty" };
  var hedge = /^(maybe|possibly|approx\.?|approximately|around|about|circa|ca\.?|~|\?)\s*/i.exec(s);
  if (hedge || /\?\s*$/.test(s)) {
    var rest = s.replace(/^(maybe|possibly|approx\.?|approximately|around|about|circa|ca\.?|~|\?)\s*/i, "").replace(/\?\s*$/, "");
    var inner = rest && rest !== s ? OPI_parseLooseDate(rest, today) : { status: "bad" };
    var out = { status: "ambiguous", reason: "hedged" };
    if (inner.year) {
      out.year = inner.year;
      out.month = inner.month;
      out.day = inner.day;
      out.iso = inner.iso;
      out.hint = inner.hint;
    }
    return out;
  }
  var y, m, d, mm;
  // M/D/YY or M/D/YYYY (also with - or .)
  if ((mm = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/.exec(s))) {
    m = +mm[1];
    d = +mm[2];
    y = +mm[3];
    if (mm[3].length === 2) y = y <= +today.slice(2, 4) ? 2000 + y : 1900 + y;
  } else if ((mm = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) {
    y = +mm[1];
    m = +mm[2];
    d = +mm[3];
  } else if ((mm = /^(\d{1,2})[\/\-.](\d{4})$/.exec(s))) {
    // MM/YYYY
    m = +mm[1];
    y = +mm[2];
  } else if ((mm = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(s))) {
    m = OPI_MONTHS[mm[1].toLowerCase().slice(0, 3)];
    d = +mm[2];
    y = +mm[3];
    if (!m) return { status: "bad", reason: "unreadable" };
  } else if ((mm = /^([a-z]+)\.?,?\s+(\d{4})$/i.exec(s))) {
    m = OPI_MONTHS[mm[1].toLowerCase().slice(0, 3)];
    y = +mm[2];
    if (!m) return { status: "bad", reason: "unreadable" };
  } else if ((mm = /^(\d{4})$/.exec(s))) {
    y = +mm[1];
  } else {
    return { status: "bad", reason: "unreadable" };
  }
  if (y < 1800 || (m !== undefined && (m < 1 || m > 12))) return { status: "bad", reason: "out of range" };
  if (d !== undefined && (d < 1 || d > OPI_daysIn(y, m))) return { status: "bad", reason: "not a real date" };
  var todayY = +today.slice(0, 4);
  var hint = OPI_hint(y);
  if (d === undefined) {
    var ym = y + "-" + OPI_pad2(m || 1);
    if (y > todayY || ym > today.slice(0, 7)) return { status: "bad", reason: "in the future" };
    return { status: "partial", year: y, month: m || null, hint: hint, reason: m ? "no day" : "year only" };
  }
  var iso = y + "-" + OPI_pad2(m) + "-" + OPI_pad2(d);
  if (iso > today) return { status: "bad", reason: "in the future" };
  return { status: "ok", iso: iso, year: y, month: m, day: d, hint: hint };
}

// Address checks: a PO box (couriers can't deliver there), or no city / ZIP.
function OPI_checkAddress(raw) {
  var s = String(raw || "").trim();
  if (!s) return { empty: true, incomplete: true, poBox: false, noZip: true, noCity: true };
  var poBox = /\bp\.?\s*o\.?\s*box\b|\bpost\s+office\s+box\b|\bpob\s+\d/i.test(s);
  var noZip = !/\b\d{5}(?:-\d{4})?\b/.test(s);
  var parts = s.split(/[,\n]+/).map(function (p) {
    return p.trim();
  }).filter(Boolean);
  // A city is a part after the street (split on commas or line breaks) with a
  // word of three or more letters. "1 Main St, NY 10001" has no city.
  var noCity = !parts.slice(1).some(function (p) {
    return /[a-z]{3,}/i.test(p);
  });
  return { empty: false, incomplete: noZip || noCity, poBox: poBox, noZip: noZip, noCity: noCity };
}

var OPI_MATCH_MIN = 0.8; // best score needed for a match
var OPI_MATCH_GAP = 0.1; // the runner-up must trail by this much

// Match CSV rows to clients ([{id, name}]) and bucket them.
// opts.today "YYYY-MM-DD". Returns:
//   { total, buckets: {matched, unmatched, ambiguousName, badDates,
//     ambiguousDates, incompleteAddress, poBox}, counts: {...} }
// Name buckets (matched / unmatched / ambiguousName) split every row once.
// The date and address buckets are extra flags on the same rows.
// Each entry: { row (1-based, after the header), name, client?, candidates?,
//               score?, date, address }.
function OPI_matchClients(rows, clients, opts) {
  opts = opts || {};
  var today = opts.today || new Date().toISOString().slice(0, 10);
  var list = (clients || [])
    .filter(function (c) {
      return c && c.id && c.name;
    })
    .map(function (c) {
      return { id: c.id, name: c.name, norm: OPI_normalizeName(c.name) };
    });
  var byNorm = {};
  list.forEach(function (c) {
    (byNorm[c.norm] = byNorm[c.norm] || []).push(c);
  });
  var headers = rows && rows.length ? Object.keys(rows[0]) : [];
  var colName = OPI_col(headers, "Customer Name") || OPI_col(headers, "Name");
  var colDate = OPI_col(headers, "Anniversary");
  var colAddr = OPI_col(headers, "Address");
  var b = { matched: [], unmatched: [], ambiguousName: [], badDates: [], ambiguousDates: [], incompleteAddress: [], poBox: [] };
  var clientHits = {};
  (rows || []).forEach(function (r, i) {
    var name = colName ? r[colName] : "";
    var norm = OPI_normalizeName(name);
    var date = OPI_parseLooseDate(colDate ? r[colDate] : "", today);
    var address = OPI_checkAddress(colAddr ? r[colAddr] : "");
    var e = { row: i + 1, name: name, date: date, address: address };
    var exact = norm ? byNorm[norm] || [] : [];
    if (exact.length === 1) {
      e.client = { id: exact[0].id, name: exact[0].name };
      e.score = 1;
      b.matched.push(e);
    } else if (exact.length > 1) {
      e.candidates = exact.map(function (c) {
        return { id: c.id, name: c.name };
      });
      b.ambiguousName.push(e);
    } else {
      var scored = list
        .map(function (c) {
          return { c: c, s: OPI_similarity(norm, c.norm) };
        })
        .filter(function (x) {
          return x.s >= OPI_MATCH_MIN - OPI_MATCH_GAP;
        })
        .sort(function (x, y) {
          return y.s - x.s || (x.c.name < y.c.name ? -1 : 1);
        });
      var top = scored[0];
      var next = scored[1];
      if (top && top.s >= OPI_MATCH_MIN && (!next || top.s - next.s >= OPI_MATCH_GAP)) {
        e.client = { id: top.c.id, name: top.c.name };
        e.score = Math.round(top.s * 100) / 100;
        e.fuzzy = true;
        b.matched.push(e);
      } else if (top && top.s >= OPI_MATCH_MIN) {
        e.candidates = scored
          .filter(function (x) {
            return top.s - x.s < OPI_MATCH_GAP;
          })
          .slice(0, 5)
          .map(function (x) {
            return { id: x.c.id, name: x.c.name };
          });
        b.ambiguousName.push(e);
      } else {
        if (top) e.candidates = [{ id: top.c.id, name: top.c.name }];
        b.unmatched.push(e);
      }
    }
    if (e.client) {
      clientHits[e.client.id] = (clientHits[e.client.id] || 0) + 1;
    }
    if (date.status === "bad" || date.status === "empty") b.badDates.push(e);
    else if (date.status === "ambiguous" || date.status === "partial") b.ambiguousDates.push(e);
    if (address.incomplete) b.incompleteAddress.push(e);
    if (address.poBox) b.poBox.push(e);
  });
  // Two sheet rows on one client: flag them (they stay matched).
  b.matched.forEach(function (e) {
    if (clientHits[e.client.id] > 1) e.duplicate = true;
  });
  var counts = {};
  Object.keys(b).forEach(function (k) {
    counts[k] = b[k].length;
  });
  counts.duplicateClients = Object.keys(clientHits).filter(function (k) {
    return clientHits[k] > 1;
  }).length;
  counts.hintClientSince = b.matched.concat(b.unmatched, b.ambiguousName).filter(function (e) {
    return e.date && e.date.hint === "probably client-since";
  }).length;
  counts.hintEstablished = b.matched.concat(b.unmatched, b.ambiguousName).filter(function (e) {
    return e.date && e.date.hint === "probably established";
  }).length;
  return {
    total: (rows || []).length,
    columns: { name: colName, anniversary: colDate, address: colAddr },
    buckets: b,
    counts: counts,
  };
}

// Run the whole dry run from CSV text.
function OPI_dryRun(csvText, clients, opts) {
  var parsed = OPI_parseCsv(csvText);
  var res = OPI_matchClients(parsed.rows, clients, opts);
  res.headers = parsed.headers;
  return res;
}

// Counts only (no names, emails or addresses): what the CLI prints.
function OPI_countsReport(res) {
  var c = res.counts;
  var lines = [
    "Rows: " + res.total,
    "Columns found: name " + (res.columns.name ? "yes" : "NO") + ", anniversary " + (res.columns.anniversary ? "yes" : "NO") + ", address " + (res.columns.address ? "yes" : "NO"),
    "Matched: " + c.matched,
    "Unmatched: " + c.unmatched,
    "Ambiguous names: " + c.ambiguousName,
    "Bad or missing dates: " + c.badDates,
    "Ambiguous or partial dates: " + c.ambiguousDates,
    "Incomplete addresses: " + c.incompleteAddress,
    "PO boxes: " + c.poBox,
    "Clients matched by more than one row: " + c.duplicateClients,
    "Dates that look like client-since (2025-2026): " + c.hintClientSince,
    "Dates that look like established (older): " + c.hintEstablished,
  ];
  return lines.join("\n");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseCsv: OPI_parseCsv,
    normalizeName: OPI_normalizeName,
    similarity: OPI_similarity,
    parseLooseDate: OPI_parseLooseDate,
    checkAddress: OPI_checkAddress,
    matchClients: OPI_matchClients,
    dryRun: OPI_dryRun,
    countsReport: OPI_countsReport,
  };
}
