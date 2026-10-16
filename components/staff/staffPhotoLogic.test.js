// Plain node, no framework: `node components/staff/staffPhotoLogic.test.js`.
// Guards the staff profile photo rules the UI shows instantly. The same rules
// are enforced in SQL (supabase/staff-photo.sql); keep the two in step.

const assert = require("assert");
const L = require("./staffPhotoLogic.js");

let n = 0;
function t(name, fn) {
  fn();
}
// One counted check per assertion.
const eq = (a, b, msg) => {
  assert.deepStrictEqual(a, b, msg);
  n++;
};
const ok = (v, msg) => {
  assert.ok(v, msg);
  n++;
};

// --- SP_deriveStatus ---------------------------------------------------------
t("deriveStatus: four states", () => {
  eq(L.SP_deriveStatus({ photoPath: null, currentKind: null, exempt: false }), "missing");
  eq(L.SP_deriveStatus({ photoPath: null, currentKind: null, exempt: true }), "exempt");
  eq(L.SP_deriveStatus({ photoPath: "a@x.com/current-1.jpg", currentKind: "staff_crop", exempt: false }), "submitted");
  eq(L.SP_deriveStatus({ photoPath: "a@x.com/edited-1.png", currentKind: "admin_edit", exempt: false }), "edited");
});
t("deriveStatus: exempt plus a photo, and unknown kinds", () => {
  eq(L.SP_deriveStatus({ photoPath: "a@x.com/c.jpg", currentKind: "staff_crop", exempt: true }), "submitted");
  eq(L.SP_deriveStatus({ photoPath: "a@x.com/e.png", currentKind: "admin_edit", exempt: true }), "edited");
  eq(L.SP_deriveStatus({ photoPath: "a@x.com/c.jpg", currentKind: "mystery", exempt: false }), "submitted");
  eq(L.SP_deriveStatus({ photoPath: "a@x.com/c.jpg", currentKind: "original", exempt: false }), "submitted");
  eq(L.SP_deriveStatus({ photoPath: "a@x.com/c.jpg", currentKind: null, exempt: false }), "submitted");
});

// --- SP_mustUpload -----------------------------------------------------------
const base = { loaded: true, error: "", status: "missing", active: true, impersonating: false, previewing: false, dismissedThisLoad: false };
t("mustUpload: missing is true", () => {
  eq(L.SP_mustUpload(base), true);
  eq(L.SP_mustUpload(Object.assign({}, base, { active: undefined })), true);
});
t("mustUpload: fails open", () => {
  eq(L.SP_mustUpload(Object.assign({}, base, { error: "boom" })), false);
  eq(L.SP_mustUpload(Object.assign({}, base, { loaded: false })), false);
  eq(L.SP_mustUpload({}), false);
  eq(L.SP_mustUpload(undefined), false);
});
t("mustUpload: other blockers", () => {
  eq(L.SP_mustUpload(Object.assign({}, base, { impersonating: true })), false);
  eq(L.SP_mustUpload(Object.assign({}, base, { previewing: true })), false);
  eq(L.SP_mustUpload(Object.assign({}, base, { active: false })), false);
  eq(L.SP_mustUpload(Object.assign({}, base, { dismissedThisLoad: true })), false);
});
t("mustUpload: only missing blocks", () => {
  ["exempt", "submitted", "edited", "none", undefined].forEach((s) => eq(L.SP_mustUpload(Object.assign({}, base, { status: s })), false));
});

// --- SP_statusLabel ----------------------------------------------------------
t("statusLabel", () => {
  eq(L.SP_statusLabel("missing"), { label: "Missing", tone: "warn" });
  eq(L.SP_statusLabel("exempt"), { label: "Not required", tone: "muted" });
  eq(L.SP_statusLabel("submitted"), { label: "Needs edit", tone: "attention" });
  eq(L.SP_statusLabel("edited"), { label: "Done", tone: "ok" });
  eq(L.SP_statusLabel("nope"), { label: "—", tone: "muted" });
  eq(L.SP_statusLabel(undefined), { label: "—", tone: "muted" });
});

// --- SP_validateFile / SP_isHeic --------------------------------------------
t("validateFile: accepted", () => {
  eq(L.SP_validateFile({ type: "image/jpeg", size: 1000, name: "a.jpg" }), { ok: true });
  eq(L.SP_validateFile({ type: "image/png", size: 1000, name: "a.png" }), { ok: true });
  eq(L.SP_validateFile({ type: "image/webp", size: 1000, name: "a.webp" }), { ok: true });
  eq(L.SP_validateFile({ type: "image/heic", size: 1000, name: "a.heic" }), { ok: true });
  eq(L.SP_validateFile({ type: "", size: 1000, name: "IMG_1.HEIC" }), { ok: true });
  eq(L.SP_validateFile({ type: "", size: 1000, name: "me.JPEG" }), { ok: true });
  eq(L.SP_validateFile({ type: "image/jpeg", size: 15 * 1024 * 1024, name: "a.jpg" }), { ok: true });
});
t("validateFile: rejected", () => {
  eq(L.SP_validateFile({ type: "image/jpeg", size: 0, name: "a.jpg" }), { ok: false, error: "Choose a JPG, PNG or WebP photo." });
  eq(L.SP_validateFile({ type: "image/jpeg", size: 15 * 1024 * 1024 + 1, name: "a.jpg" }), { ok: false, error: "That photo is over 15 MB. Choose a smaller one." });
  eq(L.SP_validateFile({ type: "image/gif", size: 1000, name: "a.gif" }), { ok: false, error: "Choose a JPG, PNG or WebP photo." });
  eq(L.SP_validateFile({ type: "", size: 1000, name: "notes.pdf" }), { ok: false, error: "Choose a JPG, PNG or WebP photo." });
  eq(L.SP_validateFile({ type: "", size: 1000, name: "" }).ok, false);
});
t("isHeic", () => {
  eq(L.SP_isHeic({ type: "image/heic", name: "a.jpg" }), true);
  eq(L.SP_isHeic({ type: "image/heif", name: "a" }), true);
  eq(L.SP_isHeic({ type: "", name: "IMG_9.HEIC" }), true);
  eq(L.SP_isHeic({ type: "image/jpeg", name: "a.jpg" }), false);
});

// --- crop geometry -----------------------------------------------------------
t("cropRect: zoom 1 portrait and landscape", () => {
  eq(L.SP_cropRect({ imgW: 1000, imgH: 1500, zoom: 1, cx: 0.5, cy: 0.5 }), { sx: 0, sy: 250, sSize: 1000 });
  eq(L.SP_cropRect({ imgW: 1500, imgH: 1000, zoom: 1, cx: 0.5, cy: 0.5 }), { sx: 250, sy: 0, sSize: 1000 });
  eq(L.SP_cropRect({ imgW: 800, imgH: 800, zoom: 1, cx: 0.2, cy: 0.9 }), { sx: 0, sy: 0, sSize: 800 });
});
t("cropRect: clamps at the edges", () => {
  eq(L.SP_cropRect({ imgW: 1000, imgH: 1000, zoom: 2, cx: 0, cy: 0 }), { sx: 0, sy: 0, sSize: 500 });
  eq(L.SP_cropRect({ imgW: 1000, imgH: 1000, zoom: 2, cx: 1, cy: 1 }), { sx: 500, sy: 500, sSize: 500 });
  eq(L.SP_cropRect({ imgW: 1000, imgH: 1000, zoom: 2, cx: -3, cy: 7 }), { sx: 0, sy: 500, sSize: 500 });
  eq(L.SP_cropRect({ imgW: 1000, imgH: 1000, zoom: 0.2, cx: 0.5, cy: 0.5 }).sSize, 1000);
});
t("cropRect: integers and inside the image", () => {
  const r = L.SP_cropRect({ imgW: 1234, imgH: 987, zoom: 1.37, cx: 0.333, cy: 0.711 });
  ok(Number.isInteger(r.sx) && Number.isInteger(r.sy) && Number.isInteger(r.sSize));
  ok(r.sx >= 0 && r.sy >= 0 && r.sx + r.sSize <= 1234 && r.sy + r.sSize <= 987);
});
t("maxZoom", () => {
  eq(L.SP_maxZoom(400, 400), 1);
  eq(L.SP_maxZoom(1600, 1200), 3);
  eq(L.SP_maxZoom(300, 300), 1);
  eq(L.SP_maxZoom(5000, 800), 2);
  const z = L.SP_maxZoom(1234, 987);
  ok(L.SP_cropRect({ imgW: 1234, imgH: 987, zoom: z, cx: 0.5, cy: 0.5 }).sSize >= 400);
});
t("tooSmall", () => {
  eq(L.SP_tooSmall(399, 2000), true);
  eq(L.SP_tooSmall(400, 400), false);
  eq(L.SP_tooSmall(2000, 399), true);
});
t("fitWithin", () => {
  eq(L.SP_fitWithin(4000, 3000, 2048), { w: 2048, h: 1536 });
  eq(L.SP_fitWithin(3000, 4000, 2048), { w: 1536, h: 2048 });
  eq(L.SP_fitWithin(800, 600, 2048), { w: 800, h: 600 });
  eq(L.SP_fitWithin(2048, 2048, 2048), { w: 2048, h: 2048 });
});

// --- paths: must match the storage policy regexes in staff-photo.sql --------
t("paths", () => {
  const re = {
    original: /^[^/]+\/original-[0-9]{10,16}\.jpg$/,
    current: /^[^/]+\/current-[0-9]{10,16}\.jpg$/,
    edited: /^[^/]+\/edited-[0-9]{10,16}\.png$/,
  };
  const now = 1760600000000;
  eq(L.SP_paths("Jane.Doe@MyGoodBooks.com", "original", now), "jane.doe@mygoodbooks.com/original-1760600000000.jpg");
  eq(L.SP_paths("A@b.co", "current", now), "a@b.co/current-1760600000000.jpg");
  eq(L.SP_paths("A@b.co", "edited", now), "a@b.co/edited-1760600000000.png");
  Object.keys(re).forEach((k) => ok(re[k].test(L.SP_paths("x@y.com", k, now)), k));
  assert.throws(() => L.SP_paths("x@y.com", "bogus", now));
  ok(true);
});

// --- admin helpers -----------------------------------------------------------
t("canAdmin", () => {
  eq(L.SP_canAdmin({ role: "admin", impersonating: false }), true);
  eq(L.SP_canAdmin({ role: "admin", impersonating: true }), false);
  eq(L.SP_canAdmin({ role: "bookkeeper", impersonating: false }), false);
  eq(L.SP_canAdmin({ role: "temp_admin" }), false);
});

const row = (email, name, status, active) => ({ email, name, status, active: active !== false });
t("needsEditCount and todayItem: zero rows", () => {
  eq(L.SP_needsEditCount([]), 0);
  eq(L.SP_needsEditCount(undefined), 0);
  eq(L.SP_todayItem([]), null);
  eq(L.SP_todayItem(undefined), null);
  eq(L.SP_todayItem([row("a@x.com", "A", "edited"), row("b@x.com", "B", "missing")]), null);
});
t("todayItem: one row", () => {
  const it = L.SP_todayItem([row("jane@x.com", "Jane Doe", "submitted"), row("b@x.com", "B", "edited")]);
  eq(it, { key: "sp-needs-edit", count: 1, title: "1 profile photo to edit", detail: "Jane Doe" });
});
t("todayItem: five rows, inactive ignored, name falls back to email", () => {
  const rows = [
    row("a@x.com", "Ann", "submitted"),
    row("b@x.com", "Ben", "submitted"),
    row("c@x.com", "", "submitted"),
    row("d@x.com", "Dee", "submitted"),
    row("e@x.com", "Eve", "submitted"),
    row("f@x.com", "Fay", "submitted", false),
  ];
  eq(L.SP_needsEditCount(rows), 5);
  const it = L.SP_todayItem(rows);
  eq(it.count, 5);
  eq(it.title, "5 profile photos to edit");
  eq(it.detail, "Ann, Ben, c and 2 more");
});
t("todayItem: two and three rows", () => {
  eq(L.SP_todayItem([row("a@x.com", "Ann", "submitted"), row("b@x.com", "Ben", "submitted")]).detail, "Ann and Ben");
  eq(L.SP_todayItem([row("a@x.com", "Ann", "submitted"), row("b@x.com", "Ben", "submitted"), row("c@x.com", "Cy", "submitted")]).detail, "Ann, Ben and Cy");
});

// --- zip names, crc, zip -----------------------------------------------------
t("zipName", () => {
  eq(L.SP_zipName("Jane Doe", "j@x.com", "original", "jpg"), "jane-doe-original.jpg");
  eq(L.SP_zipName("", "jane.doe@x.com", "current", ".PNG"), "jane-doe-current.png");
  eq(L.SP_zipName("  O'Brien, Pat  ", "p@x.com", "current", "png"), "o-brien-pat-current.png");
});
t("crc32", () => {
  eq(L.SP_crc32(new Uint8Array(Buffer.from("123456789"))), 0xcbf43926);
  eq(L.SP_crc32(new Uint8Array(0)), 0);
});
t("buildZip: signatures, counts and stored data", () => {
  const a = new Uint8Array(Buffer.from("hello"));
  const b = new Uint8Array(Buffer.from("world!"));
  const zip = L.SP_buildZip(
    [
      { name: "a.jpg", bytes: a },
      { name: "a.jpg", bytes: b },
      { name: "a.jpg", bytes: a },
      { name: "b.png", bytes: b },
    ],
    new Date(2026, 9, 16, 13, 30, 10)
  );
  const buf = Buffer.from(zip);
  eq(Array.from(zip.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
  const endAt = buf.length - 22;
  eq(Array.from(zip.slice(endAt, endAt + 4)), [0x50, 0x4b, 0x05, 0x06]);
  eq(buf.readUInt16LE(endAt + 8), 4);
  eq(buf.readUInt16LE(endAt + 10), 4);
  // central directory sits where the end record says, and is followed by the end record
  const cdSize = buf.readUInt32LE(endAt + 12);
  const cdOff = buf.readUInt32LE(endAt + 16);
  eq(cdOff + cdSize, endAt);
  eq(Array.from(zip.slice(cdOff, cdOff + 4)), [0x50, 0x4b, 0x01, 0x02]);
  // names de-duplicated, stored (method 0), UTF-8 flag, crc matches
  const text = buf.toString("latin1");
  ok(text.indexOf("a.jpg") !== -1 && text.indexOf("a-2.jpg") !== -1 && text.indexOf("a-3.jpg") !== -1 && text.indexOf("b.png") !== -1);
  eq(buf.readUInt16LE(6), 0x0800);
  eq(buf.readUInt16LE(8), 0);
  eq(buf.readUInt32LE(14), L.SP_crc32(a));
  eq(buf.readUInt32LE(18), 5);
  eq(buf.readUInt32LE(22), 5);
  // DOS time 13:30:10 and date 2026-10-16
  eq(buf.readUInt16LE(10), (13 << 11) | (30 << 5) | 5);
  eq(buf.readUInt16LE(12), ((2026 - 1980) << 9) | (10 << 5) | 16);
  eq(buf.slice(30 + 5, 30 + 5 + 5).toString(), "hello");
});
t("buildZip: empty", () => {
  const zip = L.SP_buildZip([], new Date(2026, 9, 16));
  eq(zip.length, 22);
  eq(Array.from(zip.slice(0, 4)), [0x50, 0x4b, 0x05, 0x06]);
});

assert.ok(n >= 40, "need at least 40 checks, got " + n);
console.log("staffPhotoLogic: " + n + " checks passed");
