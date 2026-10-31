// node components/tasks/TK_searchLogic.test.js
// Slate plus unified search: pure logic (docs/slateplus-profile2-spec.md §2).
const assert = require("assert");
const L = require("./TK_searchLogic.js");
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
const U = (i) => "00000000-0000-4000-8000-00000000000" + i;

t("norm: lowercase, non a-z0-9 runs become one space, trimmed", () => {
  assert.strictEqual(L.TKS_norm("  Bank—Reconcile (Q4)!! "), "bank reconcile q4");
  assert.strictEqual(L.TKS_norm("O'Neil & Sons_LLC"), "o neil sons llc");
  assert.strictEqual(L.TKS_norm(null), "");
  assert.strictEqual(L.TKS_norm("Café"), "caf"); // no accent folding
});

t("terms: normalized, de-duplicated, max 6, each cut to 40", () => {
  assert.deepStrictEqual(L.TKS_terms("Bank bank RECON"), ["bank", "recon"]);
  assert.deepStrictEqual(L.TKS_terms("a b c d e f g h"), []); // all 1-char, many terms
  assert.deepStrictEqual(L.TKS_terms("one two three four five six seven"), ["one", "two", "three", "four", "five", "six"]);
  const long = "x".repeat(50);
  assert.deepStrictEqual(L.TKS_terms(long), ["x".repeat(40)]);
  assert.deepStrictEqual(L.TKS_terms(""), []);
  assert.deepStrictEqual(L.TKS_terms("%_"), []);
  assert.deepStrictEqual(L.TKS_terms("q".repeat(201)), []);
});

t("terms: 1-char term kept only beside a 2+ char term, or alone", () => {
  assert.deepStrictEqual(L.TKS_terms("j smith"), ["j", "smith"]);
  assert.deepStrictEqual(L.TKS_terms("a"), ["a"]);
  assert.deepStrictEqual(L.TKS_terms("a b"), []);
});

t("wordPrefix: every term starts a word in some field (AND), case-insensitive", () => {
  assert.strictEqual(L.TKS_wordPrefix("Bank Reconcile", ["recon"]), true);
  assert.strictEqual(L.TKS_wordPrefix("Bank Reconcile", ["con"]), false);
  assert.strictEqual(L.TKS_wordPrefix("Bank Reconcile", ["concile"]), false);
  assert.strictEqual(L.TKS_wordPrefix(["Monthly close", "Pelican Bakery"], ["clo", "pel"]), true);
  assert.strictEqual(L.TKS_wordPrefix(["Monthly close", "Pelican Bakery"], ["clo", "zzz"]), false);
  assert.strictEqual(L.TKS_wordPrefix("BANK reconcile", L.TKS_terms("bAnK")), true);
  assert.strictEqual(L.TKS_wordPrefix("anything", []), false);
  assert.strictEqual(L.TKS_wordPrefix([null, ""], ["a"]), false);
});

t("escapeLike: backslash, percent and underscore escaped", () => {
  assert.strictEqual(L.TKS_escapeLike("a\\b%c_d"), "a\\\\b\\%c\\_d");
  assert.strictEqual(L.TKS_escapeLike("plain"), "plain");
});

t("rank: title start > word prefix > client > notes > comment > substring", () => {
  const terms = ["bank"];
  assert.strictEqual(L.TKS_rank({ title: "Bank reconcile", terms }), 0);
  assert.strictEqual(L.TKS_rank({ title: "Reconcile bank", terms }), 1);
  assert.strictEqual(L.TKS_rank({ title: "Reconcile", client: "Bank of Oz", terms }), 2);
  assert.strictEqual(L.TKS_rank({ title: "Reconcile", notes: "the bank feed", terms }), 3);
  assert.strictEqual(L.TKS_rank({ title: "Reconcile", comment: "bank said", terms }), 4);
  assert.strictEqual(L.TKS_rank({ title: "Embankment", terms, allowSubstring: true }), 5);
  assert.strictEqual(L.TKS_rank({ title: "Embankment", terms }), 9);
  // server rows rank from match
  assert.strictEqual(L.TKS_rank({ match: "client", task_text: "x" }), 2);
  assert.strictEqual(L.TKS_rank({ match: "comment" }), 4);
  assert.strictEqual(L.TKS_rank({ match: "title", task_text: "Bank rec", q: "bank" }), 0);
  assert.strictEqual(L.TKS_rank({ match: "title", task_text: "Rec bank", q: "bank" }), 1);
  assert.strictEqual(L.TKS_rank(null), 9);
});

t("compare: rank, then due date (none last), then name", () => {
  const rows = [
    { rank: 1, due: "", title: "b" },
    { rank: 1, due: "2026-11-02", title: "z" },
    { rank: 0, due: "", title: "y" },
    { rank: 1, due: "2026-11-01", title: "q" },
    { rank: 1, due: "", title: "a" },
  ];
  assert.deepStrictEqual(rows.sort(L.TKS_compare).map((r) => r.title), ["y", "q", "z", "a", "b"]);
});

t("matchItems: local group matched and ranked", () => {
  const people = [
    { email: "ana@x.org", name: "Ana Ruiz" },
    { email: "ben@x.org", name: "Ben Anders" },
    { email: "cy@x.org", name: "Cy Lane" },
  ];
  const r = L.TKS_matchItems(people, "an", (p) => ({ title: p.name }));
  assert.deepStrictEqual(r.map((x) => x.item.email), ["ana@x.org", "ben@x.org"]);
  assert.deepStrictEqual(r.map((x) => x.rank), [0, 1]);
  assert.deepStrictEqual(L.TKS_matchItems(people, "", (p) => ({ title: p.name })), []);
});

t("cap: group order, caps, more, empty groups dropped", () => {
  const many = (k, c) => Array.from({ length: c }, (_, i) => ({ type: k, id: k + i }));
  const g = L.TKS_cap([
    { key: "tasks", items: many("task", 11) },
    { key: "people", items: many("person", 2) },
    { key: "help", items: [] },
    { key: "actions", items: many("action", 4) },
  ]);
  assert.deepStrictEqual(g.map((x) => x.key), ["people", "tasks", "actions"]);
  assert.deepStrictEqual(g.map((x) => x.items.length), [2, 8, 3]);
  assert.deepStrictEqual(g.map((x) => x.more), [0, 3, 1]);
  assert.strictEqual(g[1].label, "Tasks");
  const c = L.TKS_cap([{ key: "people", items: many("p", 9) }], { people: 2 });
  assert.strictEqual(c[0].items.length, 2);
  assert.strictEqual(c[0].more, 7);
});

t("flatten: options only (no headers), footer after its group; step wraps", () => {
  const groups = [
    { key: "people", label: "People", items: [{ id: 1 }, { id: 2 }] },
    { key: "tasks", label: "Tasks", items: [{ id: 3 }], footer: { type: "seeAll", q: "x" } },
  ];
  const f = L.TKS_flatten(groups);
  assert.deepStrictEqual(f.map((o) => o.id), ["tks-opt-0", "tks-opt-1", "tks-opt-2", "tks-opt-3"]);
  assert.deepStrictEqual(f.map((o) => o.group), ["people", "people", "tasks", "tasks"]);
  assert.strictEqual(f[3].footer, true);
  assert.ok(f.every((o) => !o.item.label || o.item.label !== "People"));
  assert.strictEqual(L.TKS_step(-1, 1, 4), 0);
  assert.strictEqual(L.TKS_step(-1, -1, 4), 3);
  assert.strictEqual(L.TKS_step(3, 1, 4), 0);
  assert.strictEqual(L.TKS_step(0, -1, 4), 3);
  assert.strictEqual(L.TKS_step(1, Infinity, 4), 3);
  assert.strictEqual(L.TKS_step(2, -Infinity, 4), 0);
  assert.strictEqual(L.TKS_step(0, 1, 0), -1);
});

t("routeFor: person route is a 16-hex key, never contains @", () => {
  const r = L.TKS_routeFor({ type: "person", email: "Ana.Ruiz@mygoodbooks.org" });
  assert.strictEqual(r.kind, "person");
  assert.ok(/^[0-9a-f]{16}$/.test(r.key));
  assert.strictEqual(r.hash, "#/tasks/person/" + r.key);
  assert.ok(!JSON.stringify(r).includes("@"));
  assert.strictEqual(L.TKS_routeFor({ type: "person", email: "" }), null);
});

t("routeFor: clients, projects, tasks, SOPs, help, pages, filter, see all", () => {
  assert.deepStrictEqual(L.TKS_routeFor({ type: "client", id: "acme" }), { kind: "client", id: "acme", nav: { view: "client", id: "acme" } });
  assert.deepStrictEqual(L.TKS_routeFor({ type: "project", id: U(1) }).nav, { view: "project", id: U(1) });
  assert.strictEqual(L.TKS_routeFor({ type: "project", id: "nope" }), null);
  assert.deepStrictEqual(L.TKS_routeFor({ type: "task", id: U(2) }), { kind: "task", id: U(2) });
  assert.deepStrictEqual(L.TKS_routeFor({ type: "note", id: U(3) }), { kind: "task", id: U(3) });
  assert.strictEqual(L.TKS_routeFor({ type: "task", id: "x" }), null);
  assert.deepStrictEqual(L.TKS_routeFor({ type: "sop", clientId: "acme" }), { kind: "sop", clientId: "acme" });
  assert.strictEqual(L.TKS_routeFor({ type: "help", slug: "a b" }).hash, "#/help/a%20b");
  const go = () => 1;
  assert.strictEqual(L.TKS_routeFor({ type: "page", go }).go, go);
  assert.strictEqual(L.TKS_routeFor({ type: "action" }), null);
  assert.deepStrictEqual(L.TKS_routeFor({ type: "filter", q: "rec" }), { kind: "filter", q: "rec" });
  assert.deepStrictEqual(L.TKS_routeFor({ type: "seeAll", q: "rec" }), { kind: "searchPage", hash: "#/tasks/search", q: "rec" });
  assert.strictEqual(L.TKS_routeFor({ type: "mystery" }), null);
  assert.strictEqual(L.TKS_routeFor(null), null);
});

t("seq: only the newest request is current", () => {
  const s = L.TKS_seq();
  const a = s.next();
  const b = s.next();
  assert.strictEqual(s.current(a), false);
  assert.strictEqual(s.current(b), true);
  const other = L.TKS_seq();
  assert.strictEqual(other.current(b), false);
});

t("constants: caps and min chars match the spec table", () => {
  assert.deepStrictEqual(L.TKS_CAPS, { filter: 1, people: 5, clients: 5, projects: 5, tasks: 8, notes: 5, sops: 5, help: 5, pages: 4, actions: 3 });
  assert.strictEqual(L.TKS_MIN.people, 1);
  assert.strictEqual(L.TKS_MIN.tasks, 2);
  assert.strictEqual(L.TKS_GROUP_ORDER[0], "filter");
});

console.log("TK_searchLogic: " + n + " passed");
