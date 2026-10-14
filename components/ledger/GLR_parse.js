// ----------------------------------------------------------------------------
// GLR_parse: turns a ledger into normalized lines (spec 2.1, 2.6; prototype
// README "Parsing rules").
//
// Two sources, one line shape:
//   - fromPull(response)  the qbo-gl-review edge function's `pull` result
//   - parseGL(rows)       a QuickBooks General Ledger export (CSV or XLSX),
//                         after readFile() has turned the file into rows
//
// Normalized line (both sources):
//   { source: 'api'|'file', key, line, askable, row,
//     date: 'YYYY-MM-DD', type, num, name, name_id, memo, split,
//     amt (signed number), cents (signed integer), bal (number|null),
//     seq (number|null: register order within the account, API only),
//     acct, acct_id, acct_type, acct_subtype, classification,
//     acct_type_source: 'api'|'guess'|'guess_default'|'override',
//     cls, loc, cleared: 'R'|'C'|'', v1099: true|false|null }
//
// No React, no DOM except readFile/loadSheetJS (browser only, injectable for
// tests). CSV is parsed here (RFC 4180), so PapaParse is not needed. XLSX
// needs SheetJS, which loadSheetJS() adds on demand, never on page load.
// ----------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module && module.exports) module.exports = factory(require("./GLR_config.js"), root);
  else root.GLR_parse = factory(root.GLR_config, root);
})(typeof window !== "undefined" ? window : globalThis, function (C, root) {
  "use strict";

  var txt = function (v) { return v == null ? "" : String(v).trim(); };

  // ---- Numbers: 1,234.56  -1234.56  (1,234.56)  $1,234.56  1234.56-
  function num(v) {
    if (typeof v === "number") return isFinite(v) ? v : 0;
    var s = txt(v);
    if (!s) return 0;
    var neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s) || /^\$\s*-/.test(s);
    s = s.replace(/[^0-9.]/g, "");
    var n = parseFloat(s) || 0;
    return neg ? -n : n;
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(y, m, d) {
    if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    var t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCMonth() !== m - 1) return null; // 02/30
    return y + "-" + pad(m) + "-" + pad(d);
  }

  // ---- Dates -> 'YYYY-MM-DD' or null.
  // MM/DD/YYYY, M/D/YY, YYYY-MM-DD (time ignored), Excel serials, Date objects.
  function parseDate(v) {
    if (v instanceof Date) {
      if (isNaN(v)) return null;
      return ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
    }
    if (typeof v === "number") return excelSerial(v);
    var s = txt(v), m;
    if (!s) return null;
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) {
      var y = +m[3];
      if (y < 100) y += 2000;
      return ymd(y, +m[1], +m[2]);
    }
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/))) return ymd(+m[1], +m[2], +m[3]);
    if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerial(+s);
    return null;
  }
  function excelSerial(n) {
    if (!(n > 20000 && n < 80000)) return null;
    var d = new Date(Math.round((Math.floor(n) - 25569) * 864e5));
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  function normCleared(v) {
    var s = txt(v).toUpperCase();
    if (s === "R" || s === "RECONCILED") return "R";
    if (s === "C" || s === "CLEARED") return "C";
    return "";
  }

  // ---- CSV (RFC 4180): quoted fields, "" escapes, CRLF/LF/CR, embedded
  // newlines, BOM. Returns string[][]; blank lines stay as [""] so source row
  // numbers line up with the file.
  function parseCsv(text) {
    var s = String(text == null ? "" : text);
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    var rows = [], row = [], field = "", i = 0, q = false, n = s.length;
    while (i < n) {
      var c = s[i];
      if (q) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"' && field === "") { q = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\r" || c === "\n") {
        row.push(field); rows.push(row); row = []; field = "";
        if (c === "\r" && s[i + 1] === "\n") i++;
        i++; continue;
      }
      field += c; i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // ---- Header detection and column resolution (by title, never position)
  function findHeader(rows) {
    for (var i = 0; i < rows.length; i++) {
      var l = (rows[i] || []).map(function (c) { return txt(c).toLowerCase(); });
      if (l.some(function (c) { return /date/.test(c); }) && l.some(function (c) { return /^amount$|debit/.test(c); })) return i;
    }
    return -1;
  }
  function resolveColumns(headerRow) {
    var H = headerRow.map(function (c) { return txt(c).toLowerCase(); });
    var col = function () {
      for (var a = 0; a < arguments.length; a++) {
        var t = arguments[a];
        for (var i = 0; i < H.length; i++) {
          if (t instanceof RegExp ? t.test(H[i]) : H[i] === t) return i;
        }
      }
      return -1;
    };
    return {
      date: col("transaction date", "date", /date/),
      type: col("transaction type", "type", /type/),
      num: col("num", "no.", "number", /^num/),
      name: col("name", "payee", "customer/vendor", "vendor", "customer", /^(?!.*account).*\bname$/),
      memo: col("memo/description", "memo", "description", /memo|desc/),
      account: col("account", "distribution account", "account full name", "account name"),
      split: col("split", "split account", /split/),
      amount: col("amount"),
      debit: col("debit", /debit/),
      credit: col("credit", /credit/),
      balance: col("balance", /balance/),
      cleared: col("clr", "cleared", "cleared status", "reconciled", /^clr\b|cleared/),
      cls: col("class", "class full name"),
      loc: col("location", "department", "location full name"),
    };
  }

  // File-line key: no QuickBooks id in an export, so a transaction is the
  // prototype/mockup dedupe identity (date, type, num, name, |amount|, memo),
  // plus an occurrence counter per account so two identical transactions on
  // the same day stay two keys (and duplicates can still be found).
  function fileKey(date, type, numStr, name, cents, memo) {
    return [date, type, numStr, String(name).toLowerCase(), Math.abs(cents), memo].join("|");
  }

  // ---- parseGL(rows) -> { company, period, basis, lines, cleared_available,
  //      class_tracking, location_tracking, columns, warnings }
  // Throws Error with a plain-language message when the file isn't a ledger.
  function parseGL(rows, opts) {
    opts = opts || {};
    rows = (rows || []).map(function (r) {
      return (r || []).map(function (c) { return c instanceof Date || typeof c === "number" ? c : txt(c); });
    });
    var hi = findHeader(rows);
    if (hi < 0) throw new Error("Couldn't find the column headers. Export the General Ledger report from QuickBooks Online and try again.");
    var ci = resolveColumns(rows[hi]);
    if (ci.date < 0) throw new Error("Couldn't find the date column. Export the General Ledger report from QuickBooks Online and try again.");
    var head = rows.slice(0, hi).map(function (r) { return r.filter(function (c) { return c !== "" && c != null; }).join(" "); }).filter(Boolean);
    var company = head[0] || "";
    var period = head.filter(function (h) { return /\d{4}/.test(h); })[0] || "";
    var basis = null;
    var lines = [];
    var cur = "";
    var warnings = [];
    var occ = {}; // fileKey|account -> count
    var cell = function (r, i) { return i >= 0 ? r[i] : ""; };

    for (var i = hi + 1; i < rows.length; i++) {
      var r = rows[i];
      var cells = r.filter(function (c) { return c !== "" && c != null; });
      if (!cells.length) continue;
      var d = parseDate(cell(r, ci.date));
      if (!d) {
        var first = String(cells[0]);
        var bm = first.match(/^(cash|accrual) basis/i);
        if (bm) { basis = bm[1].toLowerCase(); continue; }
        if (/^total|beginning balance/i.test(first) || (/\b(am|pm|gmt)\b/i.test(first) && /\d{4}/.test(first))) continue;
        if (cells.length <= 2 && /[a-z]/i.test(first)) cur = first.replace(/\s*\(\d+\)\s*$/, "");
        continue;
      }
      var amtCell = ci.amount >= 0 ? cell(r, ci.amount) : "";
      var hasAmt = ci.amount >= 0 ? txt(amtCell) !== "" || typeof amtCell === "number"
        : txt(cell(r, ci.debit)) !== "" || txt(cell(r, ci.credit)) !== "" || typeof cell(r, ci.debit) === "number" || typeof cell(r, ci.credit) === "number";
      if (!hasAmt) continue; // Bailley: keep dated rows with an amount
      var amt = ci.amount >= 0 ? num(amtCell) : num(cell(r, ci.debit)) - num(cell(r, ci.credit));
      var acct = (ci.account >= 0 && txt(cell(r, ci.account))) || cur || "(no account)";
      var type = txt(cell(r, ci.type));
      var numStr = txt(cell(r, ci.num));
      var name = txt(cell(r, ci.name));
      var memo = txt(cell(r, ci.memo));
      var cents = C.toCents(amt);
      var fk = fileKey(d, type, numStr, name, cents, memo);
      var ok = fk + "\u0001" + acct;
      occ[ok] = (occ[ok] || 0) + 1;
      var key = "file:" + d + ":" + C.shortHash(fk) + ":" + occ[ok];
      var balRaw = ci.balance >= 0 ? cell(r, ci.balance) : "";
      lines.push(finishLine({
        source: "file",
        key: key,
        line: key + ":" + acct,
        askable: false,
        row: i + 1,
        date: d,
        type: type,
        num: numStr,
        name: name,
        name_id: null,
        memo: memo,
        split: txt(cell(r, ci.split)),
        amt: amt,
        cents: cents,
        bal: txt(balRaw) !== "" || typeof balRaw === "number" ? num(balRaw) : null,
        seq: null,
        acct: acct,
        acct_id: null,
        acct_type: null,
        acct_subtype: null,
        classification: null,
        cls: txt(cell(r, ci.cls)),
        loc: txt(cell(r, ci.loc)),
        cleared: ci.cleared >= 0 ? normCleared(cell(r, ci.cleared)) : "",
        v1099: null,
      }));
    }
    if (!lines.length) throw new Error("Found the headers but no dated transactions under them.");
    if (ci.account < 0 && lines.some(function (l) { return l.acct === "(no account)"; })) {
      warnings.push("Some lines have no account. The export may be missing its account section headers.");
    }
    return {
      source: "file",
      company: company,
      period: period,
      basis: basis,
      lines: lines,
      cleared_available: ci.cleared >= 0,
      class_tracking: ci.cls >= 0,
      location_tracking: ci.loc >= 0,
      columns: ci,
      warnings: warnings,
    };
  }

  // Account type: QuickBooks type when given, else the name guess.
  function finishLine(l) {
    var t = C.normalizeAccountType(l.acct_type);
    if (t) {
      l.acct_type = t;
      l.classification = l.classification || C.classificationOf(t);
      l.acct_type_source = l.acct_type_source || "api";
    } else {
      var g = C.guessAccountType(l.acct);
      l.acct_type = g.type;
      l.classification = C.classificationOf(g.type);
      l.acct_type_source = g.fallback ? "guess_default" : "guess";
    }
    return l;
  }

  // ---- API lines (spec 2.6). Same shape as file lines. Pure.
  function normalizeApiLine(x, i) {
    x = x || {};
    var date = parseDate(x.date);
    var amt = typeof x.amt === "number" ? x.amt : num(x.amt);
    var key = txt(x.key) || "syn:" + (date || "") + ":" + txt(x.type) + ":" + txt(x.num) + ":" + txt(x.acct_id) + ":" + C.toCents(amt) + ":" + i;
    return finishLine({
      source: "api",
      key: key,
      line: txt(x.line) || key + ":" + txt(x.acct_id),
      askable: !/^syn:/.test(key),
      row: null,
      date: date,
      type: txt(x.type),
      num: txt(x.num),
      name: txt(x.name),
      name_id: x.name_id == null || x.name_id === "" ? null : String(x.name_id),
      memo: txt(x.memo),
      split: txt(x.split),
      amt: amt,
      cents: C.toCents(amt),
      bal: x.bal == null || x.bal === "" ? null : (typeof x.bal === "number" ? x.bal : num(x.bal)),
      // Register order within the account from qbo-gl-review (additive; older
      // responses have none and keep the order they came in).
      seq: typeof x.seq === "number" && isFinite(x.seq) ? x.seq : (x.seq != null && x.seq !== "" && isFinite(+x.seq) ? +x.seq : null),
      acct: txt(x.acct) || "(no account)",
      acct_id: x.acct_id == null || x.acct_id === "" ? null : String(x.acct_id),
      acct_type: x.acct_type || null,
      acct_subtype: x.acct_subtype || null,
      classification: x.classification || null,
      cls: txt(x.cls),
      loc: txt(x.loc),
      cleared: normCleared(x.cleared),
      v1099: x.v1099 == null ? null : !!x.v1099,
    });
  }
  function normalizeApiLines(lines) {
    return (lines || []).map(normalizeApiLine).filter(function (l) { return !!l.date; });
  }

  // fromPull(response) for {status:"ok", lines, cleared_available, ...}.
  function fromPull(res) {
    if (!res || res.status !== "ok") throw new Error((res && res.error) || "The ledger pull didn't finish.");
    return {
      source: "api",
      company: "",
      period: "",
      basis: res.basis || null,
      pulled_at: res.pulled_at || null,
      window: res.window || null,
      lines: normalizeApiLines(res.lines),
      cleared_available: !!res.cleared_available,
      class_tracking: !!res.class_tracking,
      location_tracking: !!res.location_tracking,
      warnings: [],
    };
  }

  // ---- Browser file reading. deps (tests): { XLSX, readText(file),
  // readArrayBuffer(file) }.
  var MAX_BYTES = 25 * 1024 * 1024;
  var SHEETJS_SRC = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
  var SHEETJS_SRI = "sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw";
  var sheetJsPromise = null;

  // Adds SheetJS once, on demand (first XLSX dropped). Pinned + SRI like the
  // other CDN scripts in index.html; jsdelivr is already in the CSP.
  function loadSheetJS(doc) {
    if (root && root.XLSX) return Promise.resolve(root.XLSX);
    if (sheetJsPromise) return sheetJsPromise;
    doc = doc || (typeof document !== "undefined" ? document : null);
    if (!doc) return Promise.reject(new Error("Excel files can only be read in the browser."));
    sheetJsPromise = new Promise(function (resolve, reject) {
      var s = doc.createElement("script");
      s.src = SHEETJS_SRC;
      s.integrity = SHEETJS_SRI;
      s.crossOrigin = "anonymous";
      s.async = true;
      s.onload = function () {
        if (root.XLSX) resolve(root.XLSX);
        else { sheetJsPromise = null; reject(new Error("Couldn't load the Excel reader. Try a CSV export instead.")); }
      };
      s.onerror = function () { sheetJsPromise = null; reject(new Error("Couldn't load the Excel reader. Check your connection or use a CSV export.")); };
      doc.head.appendChild(s);
    });
    return sheetJsPromise;
  }

  function readText(file) {
    if (file && typeof file.text === "function") return file.text();
    return new Promise(function (resolve, reject) {
      var rd = new FileReader();
      rd.onload = function () { resolve(rd.result); };
      rd.onerror = function () { reject(new Error("Couldn't read that file.")); };
      rd.readAsText(file);
    });
  }
  function readArrayBuffer(file) {
    if (file && typeof file.arrayBuffer === "function") return file.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var rd = new FileReader();
      rd.onload = function () { resolve(rd.result); };
      rd.onerror = function () { reject(new Error("Couldn't read that file.")); };
      rd.readAsArrayBuffer(file);
    });
  }

  // SheetJS workbook -> rows, with the prototype's options.
  function sheetRows(XLSX, data) {
    var wb = XLSX.read(data, { type: "array", cellDates: true });
    var ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: "mm/dd/yyyy", defval: "" });
  }

  // readFile(file) -> Promise<{ kind: 'csv'|'xlsx', rows }>
  function readFile(file, deps) {
    deps = deps || {};
    var name = String((file && file.name) || "").toLowerCase();
    if (file && file.size > MAX_BYTES) return Promise.reject(new Error("That file is over 25 MB. Export a shorter date range and try again."));
    if (/\.(xlsx|xls)$/.test(name)) {
      var getX = deps.XLSX ? Promise.resolve(deps.XLSX) : loadSheetJS();
      return Promise.all([getX, (deps.readArrayBuffer || readArrayBuffer)(file)]).then(function (r) {
        return { kind: "xlsx", rows: sheetRows(r[0], r[1]) };
      });
    }
    if (/\.csv$/.test(name)) {
      return Promise.resolve((deps.readText || readText)(file)).then(function (t) { return { kind: "csv", rows: parseCsv(t) }; });
    }
    return Promise.reject(new Error("Use a .csv or .xlsx export from QuickBooks Online."));
  }

  // parseFile(file) -> Promise<parseGL result + { file_name, kind }>
  function parseFile(file, deps) {
    return readFile(file, deps).then(function (r) {
      var out = parseGL(r.rows);
      out.kind = r.kind;
      out.file_name = (file && file.name) || "";
      return out;
    });
  }

  return {
    num: num,
    parseDate: parseDate,
    parseCsv: parseCsv,
    parseGL: parseGL,
    normalizeApiLine: normalizeApiLine,
    normalizeApiLines: normalizeApiLines,
    fromPull: fromPull,
    readFile: readFile,
    parseFile: parseFile,
    loadSheetJS: loadSheetJS,
    SHEETJS_SRC: SHEETJS_SRC,
    SHEETJS_SRI: SHEETJS_SRI,
  };
});
