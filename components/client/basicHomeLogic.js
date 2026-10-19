// Basic plan Home: pure rules for the page-wide drop-and-sort upload and the
// message card (BasicHome.jsx is the UI, basicHomeLogic.test.js the node
// test). No React, no Supabase.
//
// The upload itself is NOT here: BasicHome calls the same DRV_upload the
// Documents page uses (components/files/DriveFiles.js -> the drive-files
// function), so a file lands in <Client>/<Year>/<Document type> in Google
// Drive exactly as before. The limits below mirror drive-files/logic.ts
// (MAX_BYTES, ALLOWED_TYPES, typeOf); basicHomeLogic.test.js checks they
// still agree with it.

var BH_MAX_BYTES = 25 * 1024 * 1024;
var BH_TYPES = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  heic: "image/heic",
  csv: "text/csv",
  txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
var BH_MIME_ALIASES = {
  csv: ["application/vnd.ms-excel", "application/csv", "text/x-csv", "text/plain"],
  heic: ["image/heif"],
  jpg: ["image/pjpeg"],
  jpeg: ["image/pjpeg"],
};
var BH_GENERIC_MIMES = ["", "application/octet-stream", "binary/octet-stream"];
// The <input accept> list.
var BH_ACCEPT = Object.keys(BH_TYPES)
  .map(function (e) {
    return "." + e;
  })
  .join(",");

// Where a dropped file can go: big buttons in the chooser. docType is a
// drive-files DOC_TYPES value (the Drive folder name).
var BH_DESTINATIONS = [
  { key: "bank", label: "Bank statement", hint: "Checking or savings", docType: "Bank statements" },
  { key: "card", label: "Credit card statement", hint: "Monthly card statements", docType: "Credit card statements" },
  { key: "receipts", label: "Receipts", hint: "Photos or scans of receipts", docType: "Receipts" },
  { key: "invoices", label: "Invoices and bills", hint: "Sent to you or by you", docType: "Invoices" },
  { key: "tax", label: "Tax documents", hint: "Tax forms and letters", docType: "Tax forms" },
  { key: "other", label: "Something else", hint: "Your bookkeeper will sort it", docType: "Other" },
];

function BH_docTypeFor(key) {
  for (var i = 0; i < BH_DESTINATIONS.length; i++) if (BH_DESTINATIONS[i].key === key) return BH_DESTINATIONS[i].docType;
  return "Other";
}

function BH_labelFor(key) {
  for (var i = 0; i < BH_DESTINATIONS.length; i++) if (BH_DESTINATIONS[i].key === key) return BH_DESTINATIONS[i].label;
  return "Something else";
}

function BH_sizeLabel(bytes) {
  var b = Number(bytes) || 0;
  if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1).replace(/\.0$/, "") + " MB";
  if (b >= 1024) return Math.round(b / 1024) + " KB";
  return b + " B";
}

// null when the file is fine, else a short reason (client side only; the
// server checks again).
function BH_checkFile(file) {
  var name = String((file && file.name) || "");
  var dot = name.lastIndexOf(".");
  var ext = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
  if (!ext || !Object.prototype.hasOwnProperty.call(BH_TYPES, ext))
    return "Not a type we take (PDF, PNG, JPEG, HEIC, CSV, Excel, Word and text files only).";
  var declared = String((file && file.type) || "").split(";")[0].trim().toLowerCase();
  var okType = BH_GENERIC_MIMES.indexOf(declared) >= 0 || declared === BH_TYPES[ext] || (BH_MIME_ALIASES[ext] || []).indexOf(declared) >= 0;
  if (!okType) return "The file's type doesn't match its name.";
  var size = Number(file && file.size) || 0;
  if (size <= 0) return "The file is empty.";
  if (size > BH_MAX_BYTES) return "Over the 25 MB limit (" + BH_sizeLabel(size) + ").";
  return null;
}

// Same name, size and modified time: the same file picked or dropped twice.
function BH_fileSig(f) {
  return String((f && f.name) || "") + "|" + (Number(f && f.size) || 0) + "|" + ((f && f.lastModified) || 0);
}

// Splits a dropped or chosen list into what can be uploaded and what can't.
function BH_pickFiles(list) {
  var accepted = [];
  var rejected = [];
  var seen = {};
  Array.prototype.slice.call(list || []).forEach(function (f) {
    var why = BH_checkFile(f);
    if (why) {
      rejected.push({ name: String((f && f.name) || "File"), reason: why });
      return;
    }
    // The same file dropped twice in one go.
    var sig = BH_fileSig(f);
    if (seen[sig]) return;
    seen[sig] = true;
    accepted.push(f);
  });
  return { accepted: accepted, rejected: rejected };
}

// True when a drag carries files (not selected text or a link).
function BH_dragHasFiles(dt) {
  if (!dt || !dt.types) return false;
  var t = dt.types;
  for (var i = 0; i < t.length; i++) if (t[i] === "Files") return true;
  return false;
}

// "Uploaded 3 files to Receipts." / "2 of 3 uploaded; 1 didn't go through."
function BH_summary(ok, failed, destKey) {
  var plural = function (n) {
    return n + " file" + (n === 1 ? "" : "s");
  };
  if (!failed) return "Uploaded " + plural(ok) + " to " + BH_labelFor(destKey) + ". Your bookkeeper can see " + (ok === 1 ? "it" : "them") + " now.";
  if (!ok) return "Couldn't upload " + plural(failed) + ". Nothing was lost; try again.";
  return ok + " of " + (ok + failed) + " uploaded; " + failed + " didn't go through. Try those again.";
}

// The latest message from the bookkeeper, for the Home card. messages are in
// MessagesPage's shape (oldest first): { from, author, text, created_at,
// date, attachment }. Returns null when there is none. `waiting` is true when
// it is also the newest message in the thread (the client hasn't replied).
function BH_latestFromBookkeeper(messages) {
  var list = Array.isArray(messages) ? messages : [];
  for (var i = list.length - 1; i >= 0; i--) {
    var m = list[i];
    if (m && m.from === "bookkeeper") {
      var text = String(m.text || "").trim();
      return {
        author: m.author || "MyGoodBooks",
        text: text || (m.attachment && m.attachment.name ? "Sent a file: " + m.attachment.name : ""),
        at: m.created_at || m.date || null,
        waiting: i === list.length - 1,
      };
    }
  }
  return null;
}

// One short line of a message.
function BH_preview(text, max) {
  var s = String(text || "").replace(/\s+/g, " ").trim();
  var n = max || 140;
  return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    BH_MAX_BYTES: BH_MAX_BYTES,
    BH_TYPES: BH_TYPES,
    BH_ACCEPT: BH_ACCEPT,
    BH_DESTINATIONS: BH_DESTINATIONS,
    BH_docTypeFor: BH_docTypeFor,
    BH_labelFor: BH_labelFor,
    BH_sizeLabel: BH_sizeLabel,
    BH_checkFile: BH_checkFile,
    BH_fileSig: BH_fileSig,
    BH_pickFiles: BH_pickFiles,
    BH_dragHasFiles: BH_dragHasFiles,
    BH_summary: BH_summary,
    BH_latestFromBookkeeper: BH_latestFromBookkeeper,
    BH_preview: BH_preview,
  };
}
