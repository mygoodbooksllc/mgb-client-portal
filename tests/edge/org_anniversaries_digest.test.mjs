// node --test tests/edge/*.test.mjs
// supabase/functions/weekly-admin-digest/orgAnniversaries.ts: the one
// "Anniversaries coming up" line in the weekly digest. Null (switch off),
// errors and junk mean no line, so the email is unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import * as O from "../../supabase/functions/weekly-admin-digest/orgAnniversaries.ts";

test("null, zero, negative, fractional and non-numbers give no line", () => {
  for (const v of [null, undefined, 0, -3, 1.5, "4", NaN, Infinity, {}, []]) {
    assert.equal(O.orgAnniversaryCount(v), null, String(v));
    assert.equal(O.orgAnniversaryText(O.orgAnniversaryCount(v)), null, String(v));
  }
});

test("a positive count gives the line, singular and plural", () => {
  assert.equal(O.orgAnniversaryText(O.orgAnniversaryCount(1)), "Anniversaries coming up: 1 client");
  assert.equal(O.orgAnniversaryText(O.orgAnniversaryCount(7)), "Anniversaries coming up: 7 clients");
});
