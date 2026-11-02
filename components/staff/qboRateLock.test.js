// Plain node, no framework: `node components/staff/qboRateLock.test.js`.
// Guards supabase/qbo-hourly-rate-lock.sql (QuickBooks Time billing rates are
// grant-only): signed-in users have column SELECT on every
// qbo_time_activities column except hourly_rate, so any browser read of that
// table must name its columns, never "*" and never hourly_rate, or it fails
// 42501 for every admin. This scans the app and edge-function sources for
// .from("qbo_time_activities") reads and checks each select list against the
// migration's grant list, and checks the grant list covers every column of
// the table except hourly_rate.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
let n = 0;
function t(name, fn) {
  try {
    fn();
    n++;
  } catch (e) {
    console.error("FAIL " + name);
    throw e;
  }
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const cols = (s) => s.split(",").map((c) => c.trim()).filter(Boolean);

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === ".git" || ent.name.startsWith(".")) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?|mjs)$/.test(ent.name) && !/\.test\.(js|mjs)$/.test(ent.name) && !/ \d\.\w+$/.test(ent.name)) out.push(p);
  }
  return out;
}

// The migration's grant list.
const mig = read("supabase/qbo-hourly-rate-lock.sql");
const gm = mig.match(/grant select \(([\s\S]*?)\)\s*on public\.qbo_time_activities to authenticated;/);
const granted = gm ? cols(gm[1]) : [];

// The table's columns, from its create table.
const ddl = read("supabase/qbo-firm-time.sql");
const tm = ddl.match(/create table if not exists public\.qbo_time_activities \(([\s\S]*?)\n\);/);
const tableCols = tm
  ? tm[1].split("\n").map((l) => l.replace(/--.*$/, "").trim()).filter((l) => l && !/^primary key/i.test(l)).map((l) => l.split(/\s+/)[0])
  : [];

t("migration grants a column list to authenticated", () => {
  assert.ok(granted.length > 10, "grant list not found");
});
t("grant list never includes hourly_rate", () => {
  assert.ok(!granted.includes("hourly_rate"));
});
t("grant list covers every other column of the table", () => {
  assert.ok(tableCols.includes("hourly_rate") && tableCols.includes("minutes"), "table DDL not parsed");
  const missing = tableCols.filter((c) => c !== "hourly_rate" && !granted.includes(c));
  const extra = granted.filter((c) => !tableCols.includes(c));
  assert.deepStrictEqual(missing, [], "columns not granted: " + missing.join(","));
  assert.deepStrictEqual(extra, [], "granted columns not in the table: " + extra.join(","));
});
t("migration revokes table-wide privileges from anon and authenticated", () => {
  assert.ok(/revoke all on table public\.qbo_time_activities from anon, authenticated;/.test(mig));
});
t("migration keeps the hours RPCs SECURITY DEFINER", () => {
  assert.ok(/alter function public\.qbo_hours_by_client\(date, date\) security definer;/.test(mig));
  assert.ok(/alter function public\.qbo_hours_by_staff\(date, date\) security definer;/.test(mig));
});
t("rates RPC requires the internal grant", () => {
  const body = mig.slice(mig.indexOf("function public.qbo_time_activity_rates"));
  assert.ok(/security definer/.test(body) && /can_view_internal\(\)/.test(body) && /errcode = '42501'/.test(body));
});

// Every source read of the table.
const files = walk(ROOT, []);
const reads = [];
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const re = /\.from\(\s*["'`]qbo_time_activities["'`]\s*\)\s*\.(\w+)\(\s*([^)]*)\)/g;
  let m;
  while ((m = re.exec(src))) reads.push({ file: path.relative(ROOT, f), op: m[1], arg: m[2].trim(), src });
}

t("every mention of the table in source is a chained, checkable select", () => {
  // A table name held in a variable, or .select("*", {count, head}) style
  // reads, would slip past the pattern below; flag any unmatched mention.
  let mentions = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    mentions += (src.match(/\.from\(\s*["'`]qbo_time_activities["'`]\s*\)/g) || []).length;
    const loose = src.split("\n").filter((l) => /["'`]qbo_time_activities["'`]/.test(l) && !/\.from\(/.test(l) && !/^\s*(\/\/|\*)/.test(l));
    assert.deepStrictEqual(loose, [], "table name used outside .from() in " + path.relative(ROOT, f));
  }
  assert.strictEqual(mentions, reads.length, "a .from(\"qbo_time_activities\") read is not followed by a plain .select(...)");
});

t("found the known readers (Team › Hours, Capacity, client-emails)", () => {
  const where = new Set(reads.map((r) => r.file));
  assert.ok(where.has(path.join("components", "staff", "TeamQbo.jsx")));
  assert.ok(where.has(path.join("components", "staff", "TeamCapacity.jsx")));
});

for (const r of reads) {
  t(`${r.file}: reads name their columns, never * or hourly_rate`, () => {
    assert.strictEqual(r.op, "select", "only select is expected on qbo_time_activities in " + r.file);
    let list;
    const lit = r.arg.match(/^["'`]([^"'`]*)["'`]/);
    if (lit) list = lit[1];
    else {
      const name = r.arg.split(/[\s,]/)[0];
      const def = r.src.match(new RegExp("const\\s+" + name + "\\s*=\\s*\\n?\\s*[\"'`]([^\"'`]*)[\"'`]"));
      assert.ok(def, `select list ${name} not resolvable in ${r.file}`);
      list = def[1];
    }
    const sel = cols(list);
    assert.ok(sel.length > 0, "empty select() means *");
    assert.ok(!sel.includes("*"), "select * on qbo_time_activities");
    assert.ok(!sel.includes("hourly_rate"), "hourly_rate selected");
    // Browser code runs as authenticated: every column must be granted.
    if (!r.file.startsWith(path.join("supabase", "functions"))) {
      const notGranted = sel.filter((c) => !granted.includes(c));
      assert.deepStrictEqual(notGranted, [], "not granted to authenticated: " + notGranted.join(","));
    }
  });
}

console.log(`qboRateLock: all ${n} passed`);
