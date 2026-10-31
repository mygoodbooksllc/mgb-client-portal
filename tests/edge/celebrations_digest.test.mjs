// node --test tests/edge/*.test.mjs
// supabase/functions/weekly-admin-digest/celebrations.ts: the digest's
// "Coming up" birthdays and work anniversaries, a month (30 days) ahead, month
// and day only. Must agree with the browser copy (components/staff/celebrationLead.js).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import * as C from "../../supabase/functions/weekly-admin-digest/celebrations.ts";

const require = createRequire(import.meta.url);
const B = require("../../components/staff/celebrationLead.js");
const TODAY = "2026-10-27";
const row = (o) => ({ email: "d@x.org", name: "Debra Ruffin", start_date: "2023-03-01", next_birthday: null, next_anniversary: null, years: null, birthday_action: null, anniversary_action: null, ...o });

test("lead time is 30 days", () => {
  assert.equal(C.LEAD_DAYS, 30);
  assert.equal(C.celebrationItems([row({ next_birthday: "2026-11-26" })], TODAY).length, 1);
  assert.equal(C.celebrationItems([row({ next_birthday: "2026-11-27" })], TODAY).length, 0);
  assert.equal(C.celebrationItems([row({ next_birthday: "2026-10-26" })], TODAY).length, 0);
});

test("shows the date, how many days away and years on the team", () => {
  const [i] = C.celebrationItems([row({ next_birthday: "2026-11-26" })], TODAY);
  assert.equal(i.when, "November 26 (in 30 days)");
  assert.equal(i.who, "Debra Ruffin");
  assert.equal(i.what, "birthday · 3 years on the team");
  const [a] = C.celebrationItems([row({ next_anniversary: "2026-10-28", years: 1 })], TODAY);
  assert.equal(a.when, "October 28 (tomorrow)");
  assert.equal(a.what, "1 year with the firm");
});

test("gift sent and dismissed occurrences are left out; sorted nearest first", () => {
  const rows = [
    row({ email: "a@x.org", name: "Al", next_birthday: "2026-11-10", birthday_action: "gift" }),
    row({ email: "b@x.org", name: "Bo", next_birthday: "2026-11-20" }),
    row({ email: "c@x.org", name: "Cy", next_birthday: "2026-11-02", start_date: null }),
  ];
  const out = C.celebrationItems(rows, TODAY);
  assert.deepEqual(out.map((i) => i.who), ["Cy", "Bo"]);
  assert.equal(out[0].what, "birthday");
});

test("never shows a birth year or age", () => {
  const out = C.celebrationItems([row({ birthday: "1985-11-26", next_birthday: "2026-11-26" })], TODAY);
  const all = JSON.stringify(out);
  assert.doesNotMatch(all, /1985|\bage\b|turns|years old/i);
});

test("bad input is safe", () => {
  assert.deepEqual(C.celebrationItems(null, TODAY), []);
  assert.deepEqual(C.celebrationItems([null, {}], TODAY), []);
});

test("agrees with the browser rules", () => {
  const rows = [
    row({ email: "a@x.org", name: "Al", next_birthday: "2026-11-10", next_anniversary: "2026-11-12", years: 3 }),
    row({ email: "b@x.org", name: "Bo", next_birthday: "2026-11-26", start_date: "2020-11-26" }),
    row({ email: "c@x.org", name: "Cy", next_birthday: "2026-12-30" }),
  ];
  const server = C.celebrationItems(rows, TODAY);
  const browser = B.CEL_items(rows, TODAY);
  assert.equal(server.length, browser.length);
  server.forEach((s, k) => {
    assert.equal(s.days, browser[k].days);
    assert.equal(s.who, browser[k].name);
    assert.equal(s.when, `${B.CEL_dateLabel(browser[k].on)} (${browser[k].away})`);
  });
  assert.equal(C.dateLabel("2027-05-27"), B.CEL_dateLabel("2027-05-27"));
  assert.equal(C.tenureYears("2023-03-01", "2026-11-20"), B.CEL_tenureYears("2023-03-01", "2026-11-20"));
});

test("the digest uses it, with a month-ahead note and the 30-day client line unchanged", () => {
  const src = fs.readFileSync(new URL("../../supabase/functions/weekly-admin-digest/index.ts", import.meta.url), "utf8");
  assert.match(src, /from "\.\/celebrations\.ts"/);
  assert.match(src, /celebrationItems\(rows, today\)/);
  assert.doesNotMatch(src, /days > 14/);
  assert.match(src, /a month ahead/);
  assert.match(src, /orgAnniversaryText\(orgAnniversaryCount\(d\.org_anniversaries\)\)/);
});
