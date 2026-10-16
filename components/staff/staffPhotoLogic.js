// Staff profile photos: pure rules shared by the UI (StaffPhotoGate.jsx,
// StaffPhotoAdmin.jsx, Today.jsx) and the node test (staffPhotoLogic.test.js).
// No React, no DOM, no Supabase. Spec: docs/staff-photo-spec.md (Parts B, F).
//
// The server enforces the real rules (supabase/staff-photo.sql: sp_status_for,
// the sp_* RPCs and the storage policies). SP_deriveStatus mirrors sp_status_for
// and SP_paths builds names that match the storage policy regexes. These copies
// are for instant feedback; the database has the final say.

var SP_STATUS = { MISSING: "missing", EXEMPT: "exempt", SUBMITTED: "submitted", EDITED: "edited" };
var SP_LIMITS = { maxInputBytes: 15 * 1024 * 1024, minSide: 400, currentSize: 512, originalMaxSide: 2048 };
var SP_INPUT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

var SP_TYPE_ERROR = "Choose a JPG, PNG or WebP photo.";
var SP_SIZE_ERROR = "That photo is over 15 MB. Choose a smaller one.";

// Mirrors sp_status_for(): no photo is missing (or exempt); an admin edit as the
// current photo is edited; anything else with a photo is submitted.
function SP_deriveStatus(o) {
  o = o || {};
  if (!o.photoPath) return o.exempt ? SP_STATUS.EXEMPT : SP_STATUS.MISSING;
  if (o.currentKind === "admin_edit") return SP_STATUS.EDITED;
  return SP_STATUS.SUBMITTED;
}

// True only when the gate should block the app. Fails open on any doubt.
function SP_mustUpload(o) {
  o = o || {};
  if (!o.loaded || o.error) return false;
  if (o.active === false) return false;
  if (o.impersonating || o.previewing || o.dismissedThisLoad) return false;
  return o.status === SP_STATUS.MISSING;
}

function SP_statusLabel(status) {
  if (status === SP_STATUS.MISSING) return { label: "Missing", tone: "warn" };
  if (status === SP_STATUS.EXEMPT) return { label: "Not required", tone: "muted" };
  if (status === SP_STATUS.SUBMITTED) return { label: "Needs edit", tone: "attention" };
  if (status === SP_STATUS.EDITED) return { label: "Done", tone: "ok" };
  return { label: "—", tone: "muted" };
}

function SP_ext(name) {
  var m = /\.([A-Za-z0-9]+)$/.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
}

function SP_isHeic(o) {
  o = o || {};
  var type = String(o.type || "").toLowerCase();
  if (type === "image/heic" || type === "image/heif") return true;
  var ext = SP_ext(o.name);
  return ext === "heic" || ext === "heif";
}

function SP_validateFile(o) {
  o = o || {};
  var type = String(o.type || "").toLowerCase();
  var okType;
  if (type) {
    okType = SP_INPUT_TYPES.indexOf(type) !== -1;
  } else {
    okType = ["jpg", "jpeg", "png", "webp", "heic", "heif"].indexOf(SP_ext(o.name)) !== -1;
  }
  if (!okType) return { ok: false, error: SP_TYPE_ERROR };
  var size = Number(o.size);
  if (!(size > 0)) return { ok: false, error: SP_TYPE_ERROR };
  if (size > SP_LIMITS.maxInputBytes) return { ok: false, error: SP_SIZE_ERROR };
  return { ok: true };
}

function SP_tooSmall(imgW, imgH) {
  return Math.min(imgW, imgH) < SP_LIMITS.minSide;
}

// Largest zoom where the crop square is still at least minSide source pixels.
// Floored to 2 decimals so round(base / zoom) never drops below minSide.
function SP_maxZoom(imgW, imgH) {
  var base = Math.min(imgW, imgH);
  if (!(base >= SP_LIMITS.minSide)) return 1;
  var z = Math.floor((base / SP_LIMITS.minSide) * 100) / 100;
  return z < 1 ? 1 : z;
}

function SP_clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// zoom 1 = the largest square that fits; cx, cy = the crop center, 0..1 of the image.
function SP_cropRect(o) {
  var imgW = Math.max(1, Math.round(Number(o.imgW) || 1));
  var imgH = Math.max(1, Math.round(Number(o.imgH) || 1));
  var zoom = Number(o.zoom);
  if (!(zoom >= 1)) zoom = 1;
  var base = Math.min(imgW, imgH);
  var sSize = SP_clamp(Math.round(base / zoom), 1, base);
  var cx = SP_clamp(Number(o.cx) || 0, 0, 1);
  var cy = SP_clamp(Number(o.cy) || 0, 0, 1);
  var sx = SP_clamp(Math.round(cx * imgW - sSize / 2), 0, imgW - sSize);
  var sy = SP_clamp(Math.round(cy * imgH - sSize / 2), 0, imgH - sSize);
  return { sx: sx, sy: sy, sSize: sSize };
}

// Aspect kept, never upscaled.
function SP_fitWithin(w, h, max) {
  w = Number(w) || 0;
  h = Number(h) || 0;
  var longest = Math.max(w, h);
  if (!(longest > max)) return { w: Math.round(w), h: Math.round(h) };
  var k = max / longest;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

// Storage names that match the policy regexes in supabase/staff-photo.sql.
function SP_paths(email, kind, nowMs) {
  var e = String(email || "").trim().toLowerCase();
  if (kind === "original") return e + "/original-" + nowMs + ".jpg";
  if (kind === "current") return e + "/current-" + nowMs + ".jpg";
  if (kind === "edited") return e + "/edited-" + nowMs + ".png";
  throw new Error("Unknown photo kind: " + kind);
}

function SP_canAdmin(o) {
  o = o || {};
  return o.role === "admin" && !o.impersonating;
}

function SP_needsEditCount(rows) {
  var n = 0;
  for (var i = 0; i < (rows || []).length; i++) {
    if (rows[i] && rows[i].active && rows[i].status === SP_STATUS.SUBMITTED) n++;
  }
  return n;
}

function SP_rowName(r) {
  var n = r && (r.name || r.display_name);
  if (n && String(n).trim()) return String(n).trim();
  var e = String((r && r.email) || "");
  return e.split("@")[0] || e;
}

// The admin Today row, or null when nothing needs an edit.
function SP_todayItem(rows) {
  var need = [];
  for (var i = 0; i < (rows || []).length; i++) {
    if (rows[i] && rows[i].active && rows[i].status === SP_STATUS.SUBMITTED) need.push(rows[i]);
  }
  var count = need.length;
  if (!count) return null;
  var names = need.slice(0, 3).map(SP_rowName);
  var detail;
  if (count > 3) detail = names.join(", ") + " and " + (count - 3) + " more";
  else if (count === 1) detail = names[0];
  else detail = names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  return {
    key: "sp-needs-edit",
    count: count,
    title: count === 1 ? "1 profile photo to edit" : count + " profile photos to edit",
    detail: detail,
  };
}

// "jane-doe-original.jpg": slug of the name, else the local part of the email.
function SP_zipName(name, email, which, ext) {
  function slug(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
  var base = slug(name) || slug(String(email || "").split("@")[0]) || "staff";
  var x = String(ext || "").replace(/^\./, "").toLowerCase() || "jpg";
  return base + "-" + (which || "photo") + "." + x;
}

// ---------------------------------------------------------------------------
// Tiny stored (uncompressed) zip writer. Enough for a pile of small photos.
// ---------------------------------------------------------------------------
var SP_crcTable = null;
function SP_crc32(bytes) {
  if (!SP_crcTable) {
    SP_crcTable = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      SP_crcTable[n] = c >>> 0;
    }
  }
  var crc = 0xffffffff;
  for (var i = 0; i < bytes.length; i++) crc = SP_crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function SP_utf8(s) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
  var out = [];
  var enc = unescape(encodeURIComponent(s));
  for (var i = 0; i < enc.length; i++) out.push(enc.charCodeAt(i));
  return new Uint8Array(out);
}

// "a.jpg" twice becomes "a.jpg", "a-2.jpg", then "a-3.jpg".
function SP_uniqueNames(names) {
  var seen = {};
  var out = [];
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var cand = name;
    var n = 1;
    while (seen[cand.toLowerCase()]) {
      n++;
      var dot = name.lastIndexOf(".");
      cand = dot > 0 ? name.slice(0, dot) + "-" + n + name.slice(dot) : name + "-" + n;
    }
    seen[cand.toLowerCase()] = true;
    out.push(cand);
  }
  return out;
}

function SP_buildZip(entries, date) {
  entries = entries || [];
  var d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
  var dosTime = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() >> 1) & 31);
  var dosDate = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  var names = SP_uniqueNames(
    entries.map(function (e) {
      return String(e.name || "file");
    })
  );

  var parts = [];
  var central = [];
  var offset = 0;

  function u16(v) {
    return [v & 255, (v >>> 8) & 255];
  }
  function u32(v) {
    return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  }
  function push(arr, list) {
    var u = arr instanceof Uint8Array ? arr : new Uint8Array(arr);
    list.push(u);
    return u.length;
  }

  for (var i = 0; i < entries.length; i++) {
    var data = entries[i].bytes;
    var nameBytes = SP_utf8(names[i]);
    var crc = SP_crc32(data);
    // flags 0x0800 = UTF-8 names; method 0 = stored.
    var local = [].concat(
      [0x50, 0x4b, 0x03, 0x04],
      u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate),
      u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0)
    );
    var start = offset;
    offset += push(local, parts);
    offset += push(nameBytes, parts);
    offset += push(data, parts);
    central.push({ nameBytes: nameBytes, crc: crc, size: data.length, offset: start });
  }

  var cdStart = offset;
  var cdSize = 0;
  for (var j = 0; j < central.length; j++) {
    var c = central[j];
    var head = [].concat(
      [0x50, 0x4b, 0x01, 0x02],
      u16(20), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate),
      u32(c.crc), u32(c.size), u32(c.size), u16(c.nameBytes.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(c.offset)
    );
    cdSize += push(head, parts);
    cdSize += push(c.nameBytes, parts);
  }
  offset += cdSize;

  var end = [].concat(
    [0x50, 0x4b, 0x05, 0x06],
    u16(0), u16(0), u16(central.length), u16(central.length), u32(cdSize), u32(cdStart), u16(0)
  );
  offset += push(end, parts);

  var out = new Uint8Array(offset);
  var pos = 0;
  for (var p = 0; p < parts.length; p++) {
    out.set(parts[p], pos);
    pos += parts[p].length;
  }
  return out;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SP_STATUS: SP_STATUS, SP_LIMITS: SP_LIMITS, SP_INPUT_TYPES: SP_INPUT_TYPES,
    SP_deriveStatus: SP_deriveStatus, SP_mustUpload: SP_mustUpload, SP_statusLabel: SP_statusLabel,
    SP_validateFile: SP_validateFile, SP_isHeic: SP_isHeic, SP_cropRect: SP_cropRect,
    SP_maxZoom: SP_maxZoom, SP_tooSmall: SP_tooSmall, SP_fitWithin: SP_fitWithin, SP_paths: SP_paths,
    SP_canAdmin: SP_canAdmin, SP_needsEditCount: SP_needsEditCount, SP_todayItem: SP_todayItem,
    SP_zipName: SP_zipName, SP_crc32: SP_crc32, SP_buildZip: SP_buildZip,
  };
}
