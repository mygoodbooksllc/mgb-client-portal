// Plain node: `node components/client/clientPageDropLogic.test.js`.
// Guards the client page drop's pure rules (clientPageDropLogic.js): the
// gate resolver (same rule as the database's cpd__on), the 10-file cap on
// top of the Basic Home type and size checks, names, the "who can see it"
// list rules (uploader kept on Only, never on Except, stale logins dropped),
// badges, View as filtering, error wording, history lines, copy link and
// folder names. Also checks the gate file keeps its keys.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const L = require("./clientPageDropLogic.js");

let n = 0;
function t(name, fn) {
  try {
    fn();
  } catch (e) {
    console.error("FAIL " + name);
    throw e;
  }
  n++;
}
const f = (name, size, type, lm) => ({ name, size: size == null ? 100 : size, type: type || "", lastModified: lm || 1 });

// ---- Gate
t("switch values", () => {
  assert.strictEqual(L.CPD_switchValue(true), true);
  assert.strictEqual(L.CPD_switchValue("true"), true);
  assert.strictEqual(L.CPD_switchValue({ on: true }), true);
  assert.strictEqual(L.CPD_switchValue(false), false);
  assert.strictEqual(L.CPD_switchValue(null), false);
  assert.strictEqual(L.CPD_switchValue("yes"), false);
});
t("on for a client only when enabled AND in the pilot", () => {
  assert.strictEqual(L.CPD_switchOnFor(true, "all", "a"), true);
  assert.strictEqual(L.CPD_switchOnFor(true, ["a", "b"], "a"), true);
  assert.strictEqual(L.CPD_switchOnFor(true, ["b"], "a"), false);
  assert.strictEqual(L.CPD_switchOnFor(true, null, "a"), false);
  assert.strictEqual(L.CPD_switchOnFor(true, "some", "a"), false);
  assert.strictEqual(L.CPD_switchOnFor(false, "all", "a"), false);
  assert.strictEqual(L.CPD_switchOnFor(true, "all", ""), false);
});
t("staff upgrades: preview or switch", () => {
  assert.strictEqual(L.CPD_staffPlus(true, false), true);
  assert.strictEqual(L.CPD_staffPlus(false, true), true);
  assert.strictEqual(L.CPD_staffPlus(false, false), false);
  assert.strictEqual(L.CPD_staffPlus("1", false), false);
});
t("gate file keeps its keys and never writes tk_settings", () => {
  const src = fs.readFileSync(path.join(__dirname, "CPD_gate.js"), "utf8");
  assert.ok(src.includes('"mgb_clientdrop_preview"'));
  assert.ok(src.includes('"client_page_drop_enabled", "client_page_drop_pilot"'));
  assert.ok(!/\.(upsert|insert|update)\(/.test(src), "gate never writes");
});

// ---- Files
t("10-file cap, the rest are listed with a reason", () => {
  const list = Array.from({ length: 12 }, (_, i) => f("f" + i + ".pdf", 10, "application/pdf", i + 1));
  const r = L.CPD_takeFiles(list, []);
  assert.strictEqual(r.accepted.length, 10);
  assert.strictEqual(r.rejected.length, 2);
  assert.ok(/Up to 10 files/.test(r.rejected[0].reason));
});
t("cap counts files already waiting, and skips repeats", () => {
  const waiting = Array.from({ length: 9 }, (_, i) => f("w" + i + ".pdf", 10, "", i + 1));
  const r = L.CPD_takeFiles([waiting[0], f("new.pdf", 10, "", 99), f("new2.pdf", 10, "", 98)], waiting);
  assert.deepStrictEqual(r.accepted.map((x) => x.name), ["new.pdf"]);
  assert.strictEqual(r.rejected.length, 1);
});
t("type and size checks come from Basic Home", () => {
  const r = L.CPD_takeFiles([f("a.exe", 10), f("big.pdf", 26 * 1024 * 1024), f("ok.png", 10, "image/png")], []);
  assert.deepStrictEqual(r.accepted.map((x) => x.name), ["ok.png"]);
  assert.strictEqual(r.rejected.length, 2);
});

// ---- Names
t("default name drops the extension", () => {
  assert.strictEqual(L.CPD_defaultName("March statement.pdf"), "March statement");
  assert.strictEqual(L.CPD_defaultName(".env"), ".env");
  assert.strictEqual(L.CPD_defaultName("noext"), "noext");
});
t("clean name", () => {
  assert.deepStrictEqual(L.CPD_cleanName("  a\nb  "), { value: "a b", error: null });
  assert.ok(L.CPD_cleanName("   ").error);
  assert.ok(L.CPD_cleanName("x".repeat(201)).error);
  assert.strictEqual(L.CPD_cleanName("x".repeat(200)).error, null);
});
t("display name only when it differs from the file's own name", () => {
  assert.strictEqual(L.CPD_displayNameFor("a.pdf", "a"), null);
  assert.strictEqual(L.CPD_displayNameFor("a.pdf", "a.pdf"), null);
  assert.strictEqual(L.CPD_displayNameFor("a.pdf", " March bank "), "March bank");
  assert.strictEqual(L.CPD_displayNameFor("a.pdf", ""), null);
});
t("type tags", () => {
  assert.strictEqual(L.CPD_fileTypeTag("x.PDF"), "PDF");
  assert.strictEqual(L.CPD_fileTypeTag("x.xlsx"), "Excel");
  assert.strictEqual(L.CPD_fileTypeTag("x.heic"), "Image");
  assert.strictEqual(L.CPD_fileTypeTag("x", "application/pdf"), "PDF");
  assert.strictEqual(L.CPD_fileTypeTag("x.zip"), "ZIP");
  assert.strictEqual(L.CPD_fileTypeTag("x"), "File");
});

// ---- Who can see it
const logins = [
  { email: "me@org.test", name: "Me", is_me: true },
  { email: "b@org.test", name: "B" },
  { email: "c@org.test", name: "C" },
];
t("everyone has no list", () => {
  assert.deepStrictEqual(L.CPD_normalizeAccess("everyone", ["b@org.test"], logins, "me@org.test"), { mode: "everyone", emails: [], dropped: [], error: null });
  assert.strictEqual(L.CPD_normalizeAccess("bogus", [], logins, "me@org.test").mode, "everyone");
});
t("only keeps me on the list", () => {
  const r = L.CPD_normalizeAccess("only", ["B@org.test "], logins, "me@org.test");
  assert.deepStrictEqual(r.emails, ["b@org.test", "me@org.test"]);
  assert.strictEqual(r.error, null);
});
t("only with nobody else is just me (allowed)", () => {
  assert.deepStrictEqual(L.CPD_normalizeAccess("only", [], logins, "me@org.test").emails, ["me@org.test"]);
});
t("staff (not a login) need at least one person on only", () => {
  assert.ok(L.CPD_normalizeAccess("only", [], logins, "staff@mygoodbooks.org").error);
});
t("except never lists me and needs someone", () => {
  const r = L.CPD_normalizeAccess("except", ["me@org.test", "c@org.test"], logins, "me@org.test");
  assert.deepStrictEqual(r.emails, ["c@org.test"]);
  assert.ok(L.CPD_normalizeAccess("except", ["me@org.test"], logins, "me@org.test").error);
});
t("stale logins are dropped from only and reported", () => {
  const r = L.CPD_normalizeAccess("only", ["gone@org.test", "b@org.test"], logins, "me@org.test");
  assert.deepStrictEqual(r.emails, ["b@org.test", "me@org.test"]);
  assert.deepStrictEqual(r.dropped, ["gone@org.test"]);
  assert.deepStrictEqual(L.CPD_staleEmails(["gone@org.test", "B@org.test"], logins), ["gone@org.test"]);
});
t("except keeps stale logins (they stay hidden, matching the server)", () => {
  const r = L.CPD_normalizeAccess("except", ["gone@org.test", "b@org.test"], logins, "me@org.test");
  assert.deepStrictEqual(r.emails, ["b@org.test", "gone@org.test"]);
  assert.deepStrictEqual(r.dropped, []);
  assert.strictEqual(L.CPD_normalizeAccess("except", ["gone@org.test"], logins, "me@org.test").error, null);
});
t("50-person cap", () => {
  const many = Array.from({ length: 51 }, (_, i) => ({ email: "p" + i + "@o.test" }));
  assert.ok(L.CPD_normalizeAccess("except", many.map((l) => l.email), many, "x@o.test").error);
});
t("badges", () => {
  assert.strictEqual(L.CPD_accessBadge("everyone", 0), "Everyone");
  assert.strictEqual(L.CPD_accessBadge("only", 1), "Only 1 person");
  assert.strictEqual(L.CPD_accessBadge("only", 3), "Only 3 people");
  assert.strictEqual(L.CPD_accessBadge("except", 2), "Everyone except 2");
});
t("View as: who sees what", () => {
  assert.strictEqual(L.CPD_loginSees("everyone", [], "x@o.test"), true);
  assert.strictEqual(L.CPD_loginSees("only", ["X@o.test"], "x@o.test"), true);
  assert.strictEqual(L.CPD_loginSees("only", ["y@o.test"], "x@o.test"), false);
  assert.strictEqual(L.CPD_loginSees("except", ["x@o.test"], "x@o.test"), false);
  assert.strictEqual(L.CPD_loginSees("except", ["y@o.test"], "x@o.test"), true);
});

// ---- Errors, summaries, history, links, folders
t("error wording", () => {
  assert.ok(/File storage is down/.test(L.CPD_errorText({ code: "drive_not_connected" })));
  assert.ok(/no longer has a login/.test(L.CPD_errorText({ code: "bad_access_list" })));
  assert.ok(/no longer has a login/.test(L.CPD_errorText({ message: "bad_access_list: x is not an active login" })));
  assert.strictEqual(L.CPD_errorText({ status: 413 }), "Over 25 MB.");
  assert.ok(/isn't turned on/.test(L.CPD_errorText({ code: "feature_off" })));
  assert.strictEqual(L.CPD_errorText({ message: "Other" }), "Other");
});
t("summary", () => {
  assert.strictEqual(L.CPD_summary(2, 0), "Added 2 files. Your bookkeeper can see them now.");
  assert.strictEqual(L.CPD_summary(1, 0), "Added 1 file. Your bookkeeper can see it now.");
  assert.ok(/1 of 2 uploaded/.test(L.CPD_summary(1, 1)));
  assert.ok(/Couldn't upload 2 files/.test(L.CPD_summary(0, 2)));
});
t("history lines", () => {
  const lines = L.CPD_historyLines([
    { at: "2026-10-30T10:00:00Z", action: "access_changed", ok: true, actor: "a@x", detail: JSON.stringify({ file_id: "1", access_mode: "only", count: 2, emails: ["a@x", "b@x"], display_name_changed: true }) },
    { at: "2026-10-30T09:00:00Z", action: "renamed", ok: true, actor: "s@x", detail: JSON.stringify({ file_id: "1", to: "New" }) },
    { at: "2026-10-30T08:00:00Z", action: "upload", ok: true, actor: "a@x", detail: JSON.stringify({ file_id: "1", access_mode: "except" }) },
    { at: "2026-10-30T07:00:00Z", action: "trash", ok: false, actor: "s@x", detail: "boom" },
    { at: "2026-10-30T06:00:00Z", action: "restore", ok: true, actor: "s@x", detail: "not json" },
  ]);
  assert.strictEqual(lines.length, 4);
  assert.strictEqual(lines[0].text, "Who can see it: Only 2 people (a@x, b@x); name changed");
  assert.strictEqual(lines[1].text, "Renamed to “New”");
  assert.strictEqual(lines[2].text, "Uploaded, hidden from some people");
  assert.strictEqual(lines[3].text, "Restored from Trash");
});
t("copy link", () => {
  assert.strictEqual(L.CPD_copyLinkUrl("https://app.x", "/", "#c=a&t=documents"), "https://app.x/#c=a&t=documents");
  assert.strictEqual(L.CPD_copyLinkUrl("https://app.x", "/index.html", "c=a"), "https://app.x/index.html#c=a");
});
t("folder names", () => {
  assert.ok(L.CPD_folderNameError("", []));
  assert.ok(L.CPD_folderNameError("x".repeat(61), []));
  assert.ok(L.CPD_folderNameError("Tax", ["Tax"], "Bank"));
  assert.strictEqual(L.CPD_folderNameError("Tax", ["Tax"], "Tax"), null);
  assert.strictEqual(L.CPD_folderNameError("New", ["Tax"], "Tax"), null);
});

console.log("clientPageDropLogic: " + n + " checks passed");
