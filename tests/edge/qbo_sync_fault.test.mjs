// node --test tests/edge/*.test.mjs
// supabase/functions/qbo-sync/intuit_fault.ts: what qbo-sync keeps from an
// Intuit error reply (type, code, parameter name only) and which report
// failures are skipped instead of retried every 5 minutes (MGB Home S0).
import test from "node:test";
import assert from "node:assert/strict";
import * as F from "../../supabase/functions/qbo-sync/intuit_fault.ts";

test("keeps Fault type, code and parameter name", () => {
  const body = JSON.stringify({
    Fault: {
      Error: [{ Message: "Invalid Date", Detail: "start_date 2026-08-02 is bad SECRET-ECHO", code: "2020", element: "start_date" }],
      type: "ValidationFault",
    },
    time: "2026-10-31T12:00:00.000-07:00",
  });
  assert.equal(F.faultSummary(body), "ValidationFault 2020 start_date");
});

test("never keeps Message or Detail text", () => {
  const body = JSON.stringify({
    Fault: { Error: [{ Message: "Acme Donor $5,000", Detail: "Acme Donor $5,000", code: "6000" }], type: "SystemFault" },
  });
  const s = F.faultSummary(body);
  assert.equal(s, "SystemFault 6000");
  assert.doesNotMatch(s, /Acme|5,000/);
});

test("drops values that are not the expected shape", () => {
  const body = JSON.stringify({
    Fault: { Error: [{ code: "12; drop", element: "a b <script>" }], type: "Validation Fault!" },
  });
  assert.equal(F.faultSummary(body), "");
});

test("non-JSON, empty and non-Fault bodies give an empty summary", () => {
  assert.equal(F.faultSummary(""), "");
  assert.equal(F.faultSummary(null), "");
  assert.equal(F.faultSummary("<html>Bad Request: customer Acme</html>"), "");
  assert.equal(F.faultSummary(JSON.stringify({ Report: { Rows: {} } })), "");
});

test("only a 400 is treated as hopeless; 401, 429 and 5xx keep their handling", () => {
  assert.equal(F.isHopelessReportStatus(400), true);
  for (const s of [401, 403, 429, 500, 502, 503]) assert.equal(F.isHopelessReportStatus(s), false, String(s));
});

// Fault-in-200 (2026-10-31): Intuit answered TransactionList with `columns`
// as HTTP 200 and a body that is only { Fault, time }. intuitFetch must
// throw on it instead of handing an empty report to the caller.
test("a 200 body that is only { Fault, time } is a Fault", () => {
  const body = {
    Fault: { Error: [{ Message: "x", Detail: "Acme $5", code: "6000" }], type: "ValidationFault" },
    time: "2026-10-31T12:00:00.000-07:00",
  };
  assert.equal(F.isFaultBody(body), true);
  assert.equal(F.faultSummaryOf(body), "ValidationFault 6000");
  assert.equal(F.isFaultBody({ fault: { type: "SystemFault" } }), true);
});

test("real answers and look-alikes are not Faults", () => {
  assert.equal(F.isFaultBody(null), false);
  assert.equal(F.isFaultBody([]), false);
  assert.equal(F.isFaultBody("Fault"), false);
  assert.equal(F.isFaultBody({ QueryResponse: { Purchase: [] }, time: "t" }), false);
  assert.equal(F.isFaultBody({ Header: {}, Columns: {}, Rows: {} }), false);
  assert.equal(F.isFaultBody({ CDCResponse: [] }), false);
  // A Fault key with nothing in it, or not an object, is not the pattern.
  assert.equal(F.isFaultBody({ Fault: {} }), false);
  assert.equal(F.isFaultBody({ Fault: { Error: [] } }), false);
  assert.equal(F.isFaultBody({ Fault: "boom" }), false);
  assert.equal(F.isFaultBody({ Fault: [{ code: "1" }] }), false);
  // A Fault riding along with a real payload is left to the payload.
  assert.equal(F.isFaultBody({ Fault: { type: "ValidationFault" }, QueryResponse: {} }), false);
});

test("a Fault-in-200 is skipped like a 400", () => {
  assert.equal(F.FAULT_IN_200_STATUS, 200);
  assert.equal(F.isHopelessReportStatus(F.FAULT_IN_200_STATUS), true);
});
