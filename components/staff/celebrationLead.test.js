// Plain node, no framework: `node components/staff/celebrationLead.test.js`.
// Guards the admin month-ahead rules for staff celebrations (owner request
// 2026-10-27): 30 days, date + "in N days" + years on the team, never a birth
// year or age, admin-only wiring, and the weekly digest staying in step.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const L = require("./celebrationLead.js");

const TODAY = "2026-10-27";
const row = (o) => Object.assign({ email: "d@x.org", name: "Debra Ruffin", start_date: "2023-03-01", next_birthday: null, next_anniversary: null, years: null, birthday_action: null, anniversary_action: null, birthday: null }, o);

// constants
assert.strictEqual(L.CEL_ADMIN_LEAD_DAYS, 30);
assert.strictEqual(L.CEL_NEAR_DAYS, 7);

// day math and labels
assert.strictEqual(L.CEL_daysBetween("2026-11-26", TODAY), 30);
assert.strictEqual(L.CEL_daysBetween(TODAY, TODAY), 0);
assert.strictEqual(L.CEL_daysBetween("2027-01-02", "2026-12-30"), 3); // across a year end
assert.strictEqual(L.CEL_daysBetween("2026-11-02", "2026-10-31"), 2); // across DST change in the US (Nov 1)
assert.ok(Number.isNaN(L.CEL_daysBetween("", TODAY)));
assert.strictEqual(L.CEL_dateLabel("2027-05-27"), "May 27");
assert.strictEqual(L.CEL_dateLabel("2026-11-26"), "November 26");
assert.strictEqual(L.CEL_dateLabel(""), "");
assert.strictEqual(L.CEL_awayText(0), "today");
assert.strictEqual(L.CEL_awayText(1), "tomorrow");
assert.strictEqual(L.CEL_awayText(30), "in 30 days");
assert.strictEqual(L.CEL_awayText(9), "in 9 days");

// tenure: whole years from the start date to the celebrated day
assert.strictEqual(L.CEL_tenureYears("2023-03-01", "2026-11-20"), 3);
assert.strictEqual(L.CEL_tenureYears("2023-12-01", "2026-11-20"), 2);
assert.strictEqual(L.CEL_tenureYears("2023-11-20", "2026-11-20"), 3); // on the anniversary day itself
assert.strictEqual(L.CEL_tenureYears("2026-03-01", "2026-11-20"), null); // under a year: no text
assert.strictEqual(L.CEL_tenureYears(null, "2026-11-20"), null);
assert.strictEqual(L.CEL_tenureText(1), "1 year on the team");
assert.strictEqual(L.CEL_tenureText(3), "3 years on the team");
assert.strictEqual(L.CEL_tenureText(null), "");

// the example from the request: a birthday 30 days out
let items = L.CEL_items([row({ next_birthday: "2026-11-26" })], TODAY);
assert.strictEqual(items.length, 1);
assert.strictEqual(items[0].days, 30);
assert.strictEqual(items[0].near, false);
assert.strictEqual(items[0].title, "Debra Ruffin's birthday, November 26");
assert.strictEqual(items[0].detail, "in 30 days · 3 years on the team · send a gift or a shout-out");

// window: 31 days is out, today and 30 are in, the past is out
assert.strictEqual(L.CEL_items([row({ next_birthday: "2026-11-27" })], TODAY).length, 0);
assert.strictEqual(L.CEL_items([row({ next_birthday: "2026-10-27" })], TODAY).length, 1);
assert.strictEqual(L.CEL_items([row({ next_birthday: "2026-10-26" })], TODAY).length, 0);
// a custom lead still works (the old 7-day behavior)
assert.strictEqual(L.CEL_items([row({ next_birthday: "2026-11-05" })], TODAY, 7).length, 0);
assert.strictEqual(L.CEL_items([row({ next_birthday: "2026-11-03" })], TODAY, 7).length, 1);

// near = first 7 days (Today keeps ranking those at the top as before)
assert.strictEqual(L.CEL_items([row({ next_birthday: "2026-11-03" })], TODAY)[0].near, true);
assert.strictEqual(L.CEL_items([row({ next_birthday: "2026-11-04" })], TODAY)[0].near, false);

// anniversary row
items = L.CEL_items([row({ next_anniversary: "2026-11-10", years: 3 })], TODAY);
assert.strictEqual(items[0].title, "Debra Ruffin: 3 years with the firm, November 10");
assert.strictEqual(items[0].detail, "in 14 days · work anniversary");
assert.strictEqual(L.CEL_items([row({ next_anniversary: "2026-11-10", years: 1 })], TODAY)[0].title, "Debra Ruffin: 1 year with the firm, November 10");

// handled occurrences are hidden unless asked for, and tagged
const done = row({ next_birthday: "2026-11-10", birthday_action: "gift" });
assert.strictEqual(L.CEL_items([done], TODAY).length, 0);
assert.strictEqual(L.CEL_items([done], TODAY, 30, true)[0].handled, "gift");
// only the handled occurrence is hidden; the other one stays
assert.strictEqual(L.CEL_items([row({ next_birthday: "2026-11-10", birthday_action: "dismissed", next_anniversary: "2026-11-12", years: 2 })], TODAY).length, 1);

// no start date: the birthday still shows, without tenure text
items = L.CEL_items([row({ start_date: null, next_birthday: "2026-11-10" })], TODAY);
assert.strictEqual(items[0].detail, "in 14 days · send a gift or a shout-out");

// sort: nearest first, then name; bad input is safe
items = L.CEL_items(
  [row({ email: "b@x.org", name: "Bo", next_birthday: "2026-11-10" }), row({ email: "a@x.org", name: "Al", next_birthday: "2026-11-10" }), row({ email: "c@x.org", name: "Cy", next_birthday: "2026-11-01" })],
  TODAY,
);
assert.deepStrictEqual(items.map((i) => i.name), ["Cy", "Al", "Bo"]);
assert.deepStrictEqual(L.CEL_items(null, TODAY), []);
assert.deepStrictEqual(L.CEL_items([null, {}], TODAY), []);

// never a birth year or age, whatever the row holds
items = L.CEL_items([row({ birthday: "1985-11-26", next_birthday: "2026-11-26" })], TODAY);
const shown = JSON.stringify(items.map((i) => [i.title, i.detail, i.what, i.away, i.tenure]));
assert.ok(!/1985|\bage\b|turns|years old/i.test(shown), shown);
assert.ok(!/\b(19|20)\d\d\b/.test(shown), shown);

// wiring (static): admin-only, non-admin unchanged, no year or age in the UI
const read = (...p) => fs.readFileSync(path.join(__dirname, "..", "..", ...p), "utf8");
const today = read("components", "staff", "Today.jsx");
assert.ok(today.includes("CEL_items(x.celebrations || [], x.today)"), "Today builds celebration rows from CEL_items");
assert.ok(/return \{ rows, act \};/.test(today), "Today loads celebration rows for everyone (admins get CEL_items, others CEL_peerItems)");
assert.ok(today.includes("x.celAdmin ? CEL_items("), "month-ahead rows only for real admins");
assert.ok(today.includes("!x.celAdmin && CEL_canSee(false)"), "peer rows only while CEL_STAFF_VISIBLE is on");
assert.ok(today.includes("if (!CEL_canSee(admin)) return;"), "non-admins do not even load celebration rows");
assert.ok(today.includes("CEL_peerItems(x.celebrations || [], x.today, x.me)"), "non-admins get the 7-day peer rows");
assert.ok(/rank: it\.near \? 0 : 8/.test(today), "month-ahead rows rank low; the first 7 days keep rank 0");
assert.ok(/filter\(\(r\) => !r\.far\)/.test(today), "a far celebration is never the Do next top item");
const team = read("components", "staff", "TeamPage.jsx");
assert.ok(team.includes("<TP_UpcomingCard admin={isAdmin} me={staffUser && staffUser.email} />"), "Team card gets the admin flag and who is signed in");
assert.ok(team.includes("if (!canSee) return null;") && team.includes("CEL_canSee(admin)"), "Team card is hidden for non-admins while CEL_STAFF_VISIBLE is off");
assert.ok(/d <= 7 && !ro/.test(team), "shout-out button: 7 days, not in View as");
assert.ok(/if \(admin && typeof CEL_items === "function"\)/.test(team), "month-ahead detail only for admins");
const html = read("index.html");
assert.ok(html.includes('"components/staff/celebrationLead.js"'), "celebrationLead.js is loaded by index.html");
assert.ok(html.indexOf("celebrationLead.js") < html.indexOf('"components/staff/Today.jsx"'), "loaded before Today.jsx");

// ---- non-admin 7-day heads-up (owner request 2026-10-27) ----
// admin only by default (owner decision 2026-10-27); one switch brings the peer view back
assert.strictEqual(L.CEL_STAFF_VISIBLE, false);
assert.strictEqual(L.CEL_canSee(true), true);
assert.strictEqual(L.CEL_canSee(false), false);
assert.strictEqual(L.CEL_canSee(undefined), false);
assert.strictEqual(L.CEL_STAFF_LEAD_DAYS, 7);
const ME = "me@x.org";
let peers = L.CEL_peerItems([row({ next_birthday: "2026-11-02" })], TODAY, ME);
assert.strictEqual(peers.length, 1);
assert.strictEqual(peers[0].title, "Debra Ruffin's birthday, November 2");
assert.strictEqual(peers[0].detail, "in 6 days \u00b7 give a shout out");
assert.strictEqual(peers[0].shout, true);
assert.strictEqual(peers[0].self, false);
// window: 7 days in, 8 out, past out
assert.strictEqual(L.CEL_peerItems([row({ next_birthday: "2026-11-03" })], TODAY, ME).length, 1);
assert.strictEqual(L.CEL_peerItems([row({ next_birthday: "2026-11-04" })], TODAY, ME).length, 0);
assert.strictEqual(L.CEL_peerItems([row({ next_birthday: "2026-10-26" })], TODAY, ME).length, 0);
// anniversary says years with the firm only; no tenure on a birthday
peers = L.CEL_peerItems([row({ next_anniversary: "2026-10-30", years: 3 })], TODAY, ME);
assert.strictEqual(peers[0].title, "Debra Ruffin: 3 years with the firm, October 30");
assert.strictEqual(peers[0].detail, "in 3 days \u00b7 give a shout out");
assert.ok(!/on the team/.test(JSON.stringify(L.CEL_peerItems([row({ next_birthday: "2026-10-30" })], TODAY, ME))));
// admin gift marks are ignored and never shown
peers = L.CEL_peerItems([row({ next_birthday: "2026-10-30", birthday_action: "gift" })], TODAY, ME);
assert.strictEqual(peers.length, 1);
assert.ok(!/gift|dismiss/i.test(JSON.stringify(peers.map((i) => [i.title, i.detail, i.what]))));
// your own day shows, with no shout-out (case-insensitive email match)
peers = L.CEL_peerItems([row({ email: "Me@X.org", name: "Me Myself", next_birthday: "2026-10-30", next_anniversary: "2026-10-31", years: 2 })], TODAY, ME);
assert.deepStrictEqual(peers.map((i) => [i.title, i.shout, i.self]), [["Your birthday, October 30", false, true], ["Your work anniversary, October 31", false, true]]);
assert.strictEqual(peers[1].detail, "in 4 days \u00b7 2 years with the firm");
// no signed-in email: nobody counts as you
assert.strictEqual(L.CEL_peerItems([row({ next_birthday: "2026-10-30" })], TODAY, "")[0].shout, true);
// sorted, bad input safe, never a birth year or age
peers = L.CEL_peerItems([row({ email: "b@x.org", name: "Bo", next_birthday: "2026-10-30" }), row({ email: "c@x.org", name: "Cy", next_birthday: "2026-10-28" })], TODAY, ME);
assert.deepStrictEqual(peers.map((i) => i.name), ["Cy", "Bo"]);
assert.deepStrictEqual(L.CEL_peerItems(null, TODAY, ME), []);
const peerShown = JSON.stringify(L.CEL_peerItems([row({ birthday: "1985-11-02", next_birthday: "2026-11-02", next_anniversary: "2026-11-01", years: 3 })], TODAY, ME).map((i) => [i.title, i.detail, i.what]));
assert.ok(!/1985|\bage\b|turns|years old/i.test(peerShown), peerShown);
assert.ok(!/\b(19|20)\d\d\b/.test(peerShown), peerShown);
// wiring: non-admin rows never reach Do next, no actions in View as
assert.ok(/far: true/.test(today) && today.includes("x.readOnly"), "peer rows are far (never Do next) and hide the action in View as");

console.log("celebrationLead tests passed");
