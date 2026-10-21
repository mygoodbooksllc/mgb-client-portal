// Plain node: `node components/tasks/TK_rhythmClient.test.js`.
// Slate month rhythm slice 5: a client's own rhythm days (client_profile.rhythm).
// Shared vectors (TK_rhythmClient.fixtures.js) through the JS helpers, a check
// that the SQL self-test carries every vector row with the same text, the
// editor helpers, a due date with a merged rhythm, and static guards on the
// gated UI wiring.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const R = require("./TK_rhythmLogic.js");
const L = require("./TK_recurrenceLogic.js");
const FX = require("./TK_rhythmClient.fixtures.js");

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

const ROOT = path.join(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SQL = read("supabase/slate-rhythm-5-client-override.sql");
const SQL_TESTS = read("supabase/slate-rhythm-5-client-override-tests.sql");
const parse = (s) => (s === null ? undefined : JSON.parse(s));
const sqlLit = (v) => (v === null ? "null" : "'" + v + "'");

// ---- Shared vectors --------------------------------------------------------

t("vectors: unique ids and the expected counts", () => {
  const ids = FX.PROBLEM_CASES.map((c) => c.id).concat(FX.MERGE_CASES.map((c) => c.id));
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.strictEqual(FX.PROBLEM_CASES.length, 14);
  assert.strictEqual(FX.MERGE_CASES.length, 13);
});

FX.PROBLEM_CASES.forEach((c) => {
  t("problem " + c.id, () => {
    const v = parse(c.json);
    assert.strictEqual(R.TK_clientRhythmProblem(v === undefined ? null : v), c.problem, c.id);
  });
});

FX.MERGE_CASES.forEach((c) => {
  t("merge " + c.id, () => {
    const firm = c.firm === null ? null : JSON.parse(c.firm);
    const client = c.client === null ? null : JSON.parse(c.client);
    const got = R.TK_rhythmForClient(firm, client);
    if (c.expect === null) assert.strictEqual(got, null, c.id);
    else assert.deepStrictEqual(got, JSON.parse(c.expect), c.id);
  });
});

t("SQL self-test carries every problem vector row verbatim", () => {
  FX.PROBLEM_CASES.forEach((c) => {
    const row = "  ('" + c.id + "', " + [c.json, c.problem].map(sqlLit).join(", ") + ")";
    assert.ok(SQL_TESTS.includes(row), "missing SQL row for " + c.id);
  });
  assert.ok(SQL_TESTS.includes("count(*) = " + FX.PROBLEM_CASES.length + " from t_problem"));
});

t("SQL self-test carries every merge vector row verbatim", () => {
  FX.MERGE_CASES.forEach((c) => {
    const row = "  ('" + c.id + "', " + [c.firm, c.client, c.expect].map(sqlLit).join(", ") + ")";
    assert.ok(SQL_TESTS.includes(row), "missing SQL row for " + c.id);
  });
  assert.ok(SQL_TESTS.includes("count(*) = " + FX.MERGE_CASES.length + " from t_merge"));
});

t("SQL: client first, then firm, then fail closed; admin-only write; audited; marked applied", () => {
  assert.ok(/add column if not exists rhythm jsonb/i.test(SQL));
  const flat = SQL.replace(/\s+/g, " ");
  assert.ok(flat.includes("select public.tk_month_rhythm_merge( public.tk_month_rhythm(), (select cp.rhythm from public.client_profile cp where cp.client_id = p_client));"));
  assert.ok(SQL.includes("client_profile_rhythm_guard"));
  assert.ok(SQL.includes("client_rhythm_audit"));
  assert.ok(/alter table (public\.)?client_rhythm_audit enable row level security/i.test(SQL));
  assert.ok(SQL.includes("Applied to production 2026-10-21"));
  assert.ok(/rollback;\s*$/i.test(SQL_TESTS.trim() + "\n"), "self-test must end in rollback");
});

// ---- Editor helpers ----------------------------------------------------------

const FIRM = R.TK_rhythmDefault();

t("FromForm: three days in order -> [{key, day}] x3, labels and roll never stored", () => {
  const b = R.TK_clientRhythmFromForm({ check_in: 5, reports: 15, follow_up: 25 });
  assert.deepStrictEqual(b.value, [
    { key: "check_in", day: 5 },
    { key: "reports", day: 15 },
    { key: "follow_up", day: 25 },
  ]);
  assert.deepStrictEqual(b.errors, {});
  assert.strictEqual(R.TK_clientRhythmProblem(b.value), null);
});

t("FromForm: out of order or equal days are refused with the firm form's messages", () => {
  const b = R.TK_clientRhythmFromForm({ check_in: 15, reports: 15, follow_up: 25 });
  assert.strictEqual(b.value, null);
  assert.ok(Object.keys(b.errors).length > 0);
  const firmB = R.TK_rhythmFromForm({ check_in: 15, reports: 15, follow_up: 25, roll: "next" }, null);
  assert.deepStrictEqual(b.errors, firmB.errors);
  assert.strictEqual(R.TK_clientRhythmFromForm(null).value, null);
});

t("DaysText", () => {
  assert.strictEqual(R.TK_clientRhythmDaysText(JSON.parse(FX.PROBLEM_CASES[2].json)), "5th, 15th, 25th");
  assert.strictEqual(R.TK_clientRhythmDaysText(FIRM), "4th, 14th, 24th");
  assert.strictEqual(R.TK_clientRhythmDaysText([{ key: "check_in", day: 1 }, { key: "reports", day: 2 }, { key: "follow_up", day: 3 }]), "1st, 2nd, 3rd");
  assert.strictEqual(R.TK_clientRhythmDaysText(null), "");
  assert.strictEqual(R.TK_clientRhythmDaysText([{ key: "check_in", day: 5 }]), "");
});

t("Summary: firm, own, not valid", () => {
  assert.strictEqual(R.TK_clientRhythmSummary(FIRM, null), "Uses the firm rhythm (4th, 14th, 24th)");
  assert.strictEqual(R.TK_clientRhythmSummary(null, null), "Uses the firm rhythm");
  assert.strictEqual(
    R.TK_clientRhythmSummary(FIRM, [{ key: "check_in", day: 5 }, { key: "reports", day: 15 }, { key: "follow_up", day: 25 }]),
    "Own rhythm: 5th, 15th, 25th"
  );
  const bad = R.TK_clientRhythmSummary(FIRM, [{ key: "check_in", day: 30 }]);
  assert.ok(/not valid/.test(bad) && !/!/.test(bad));
  // Review: an override in the firm (object) shape fails closed in the merge,
  // so the summary must not call it a valid own rhythm.
  const objShape = { parts: [{ key: "check_in", day: 5 }, { key: "reports", day: 15 }, { key: "follow_up", day: 25 }] };
  assert.strictEqual(R.TK_rhythmForClient(FIRM, objShape), null);
  assert.ok(/not valid/.test(R.TK_clientRhythmSummary(FIRM, objShape)));
});

// ---- Due dates with a merged rhythm ------------------------------------------

t("TK_resolveDue with the merged rhythm uses the client days and the firm roll", () => {
  const merged = R.TK_rhythmForClient(FIRM, [
    { key: "check_in", day: 5 },
    { key: "reports", day: 15 },
    { key: "follow_up", day: 25 },
  ]);
  const due = (part) => L.TK_resolveDue({ type: "firm_part", part: part, month_offset: 1 }, "2026-10-01", "2026-10-31", [], merged);
  assert.strictEqual(due("check_in"), "2026-11-05");
  assert.strictEqual(due("reports"), "2026-11-16"); // the 15th is a Sunday, roll next
  assert.strictEqual(due("follow_up"), "2026-11-25");
  // No override: the firm days, unchanged.
  const firmDue = L.TK_resolveDue({ type: "firm_part", part: "check_in", month_offset: 1 }, "2026-10-01", "2026-10-31", [], R.TK_rhythmForClient(FIRM, null));
  assert.strictEqual(firmDue, "2026-11-04");
  // A bad override fails closed (no date, never the firm days).
  assert.throws(
    () => L.TK_resolveDue({ type: "firm_part", part: "check_in", month_offset: 1 }, "2026-10-01", "2026-10-31", [], R.TK_rhythmForClient(FIRM, [{ key: "check_in", day: 30 }])),
    /tk_month_rhythm_missing/
  );
});

// ---- Static guards on the gated UI ------------------------------------------

t("TK_api: clientRhythm reads the column, setClientRhythm calls the admin RPC", () => {
  const api = read("components/tasks/TK_api.js");
  assert.ok(api.includes("api.clientRhythm = function"));
  assert.ok(api.includes('select("rhythm")'));
  assert.ok(api.includes("api.setClientRhythm = function"));
  assert.ok(api.includes('c.rpc("tk_set_client_rhythm"'));
});

t("Slate › Recurring previews use the client rhythm only when the rhythm is on", () => {
  const tpl = read("components/tasks/TK_Templates.jsx");
  const flat = tpl.replace(/\s+/g, " ");
  assert.ok(flat.includes("var clientOverride = props.rhythmOn && crPair[0].forId === clientId ? crPair[0].value : null;"));
  assert.ok(flat.includes("var rhythmFor = props.rhythmOn && clientOverride != null && typeof TK_rhythmForClient === \"function\" ? TK_rhythmForClient(props.rhythm || null, clientOverride) : props.rhythm;"));
  assert.ok(tpl.includes("rhythm: rhythmFor || null"));
  assert.ok(tpl.includes("rhythm={rhythmFor}"));
});

t("client Settings row: gated by TK_rhythmEnabled, admin-only editor, wired from app.jsx", () => {
  const st = read("components/settings/Settings.jsx");
  const i = st.indexOf("function ST_ClientRhythmRow");
  assert.ok(i > 0);
  const body = st.slice(i, st.indexOf("function ST_FirmSettings"));
  assert.ok(body.includes("if (!st.loaded || !st.enabled) return null;"));
  assert.ok(body.includes("TK_rhythmEnabled()"));
  assert.ok(body.includes("canEdit && !st.failed && !form"));
  assert.ok(body.includes("TK_api.setClientRhythm(clientId, value)"));
  assert.ok(!/!["<]/.test(body.replace(/!==|!=|!\w|!\(|!!|!st|!form|!built|!res/g, "")), "no exclamation marks in copy");
  assert.ok(st.includes("<ST_ClientRhythmRow clientId={client.id} canEdit={!!canEditRhythm} />"));
  const app = read("app.jsx");
  assert.ok(app.includes("canEditRhythm={isStaffSession && !isPreviewingUser && STAFF_isRealAdmin(effectiveStaffUser)}"));
});

console.log("TK_rhythmClient.test.js: " + n + " passed");
