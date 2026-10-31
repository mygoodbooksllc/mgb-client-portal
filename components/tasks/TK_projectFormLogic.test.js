// node components/tasks/TK_projectFormLogic.test.js
// Slate plus New project form rules (docs/slateplus-projectform-spec.md).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const L = require("./TK_projectFormLogic.js");
const ROOT = path.join(__dirname, "..", "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
let n = 0;
const pending = [];
function t(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      pending.push(
        r.then(
          () => n++,
          (e) => {
            console.error("FAIL " + name);
            throw e;
          },
        ),
      );
      return;
    }
  } catch (e) {
    console.error("FAIL " + name);
    throw e;
  }
  n++;
}

t("description: trimmed, blank lines squeezed, cut to 500", () => {
  assert.strictEqual(L.TKPF_cleanDescription("  hi\r\n\r\n\r\n\r\nthere  "), "hi\n\nthere");
  assert.strictEqual(L.TKPF_cleanDescription(null), "");
  assert.strictEqual(L.TKPF_cleanDescription("x".repeat(600)).length, 500);
  assert.strictEqual(L.TKPF_descLeft("abc"), 497);
  assert.strictEqual(L.TKPF_descLeft("x".repeat(700)), 0);
});

t("due date: real calendar days only", () => {
  assert.strictEqual(L.TKPF_cleanDue("2026-11-03"), "2026-11-03");
  assert.strictEqual(L.TKPF_cleanDue(" 2028-02-29 "), "2028-02-29");
  assert.strictEqual(L.TKPF_cleanDue("2027-02-29"), null);
  assert.strictEqual(L.TKPF_cleanDue("2026-13-01"), null);
  assert.strictEqual(L.TKPF_cleanDue("11/03/2026"), null);
  assert.strictEqual(L.TKPF_cleanDue("1999-01-01"), null);
  assert.strictEqual(L.TKPF_cleanDue(""), null);
});

t("dueInfo: late only when past due and not archived", () => {
  assert.strictEqual(L.TKPF_dueInfo({}, "2026-10-28"), null);
  assert.deepStrictEqual(L.TKPF_dueInfo({ due_on: "2026-11-03" }, "2026-10-28"), { text: "Due Nov 3", late: false });
  assert.deepStrictEqual(L.TKPF_dueInfo({ due_on: "2026-10-28" }, "2026-10-28"), { text: "Due Oct 28", late: false });
  assert.deepStrictEqual(L.TKPF_dueInfo({ due_on: "2026-10-01" }, "2026-10-28"), { text: "Late: was due Oct 1", late: true });
  assert.strictEqual(L.TKPF_dueInfo({ due_on: "2026-10-01", archived_at: "2026-10-20T00:00:00Z" }, "2026-10-28").late, false);
  assert.strictEqual(L.TKPF_dueInfo({ due_on: "2027-01-05" }, "2026-10-28").text, "Due Jan 5, 2027");
});

t("templates: three starters, copies only from visible projects with sections", () => {
  assert.strictEqual(L.TKPF_STARTERS.length, 3);
  const projects = [
    { id: "b", name: "Beta", sections: ["One", "Two"] },
    { id: "a", name: "alpha", sections: ["X"] },
    { id: "c", name: "Empty", sections: [] },
    { id: "d", name: "Old", sections: ["Y"], archived_at: "2026-01-01" },
  ];
  const o = L.TKPF_templateOptions(projects);
  assert.deepStrictEqual(o.starters.map((x) => x.value), ["starter:board", "starter:monthend", "starter:onboarding"]);
  assert.deepStrictEqual(o.copies, [
    { value: "project:a", label: "alpha (1 section)" },
    { value: "project:b", label: "Beta (2 sections)" },
  ]);
  assert.strictEqual(L.TKPF_templateText("starter:board", projects), "To do\nDoing\nDone");
  assert.strictEqual(L.TKPF_templateText("project:b", projects), "One\nTwo");
  assert.strictEqual(L.TKPF_templateText("project:d", projects), null);
  assert.strictEqual(L.TKPF_templateText("project:zz", projects), null);
  assert.strictEqual(L.TKPF_templateText("", projects), null);
  assert.strictEqual(L.TKPF_templateText("starter:nope", projects), null);
});

t("people: never yourself, no duplicates, active staff only, role owner|member", () => {
  const staff = [
    { email: "Me@x.org", name: "Me", active: true },
    { email: "ana@x.org", name: "Ana", active: true },
    { email: "bo@x.org", name: "Bo", active: false },
    { email: "cy@x.org", name: "Cy" },
    { email: "", name: "No email" },
  ];
  const ch = L.TKPF_staffChoices(staff, [{ email: "ANA@x.org" }], "me@x.org");
  assert.deepStrictEqual(ch.map((s) => s.name), ["Cy"]);
  const picks = L.TKPF_normalizePicks(
    [
      { email: "Ana@x.org", role: "owner" },
      { email: "ana@x.org", role: "member" },
      { email: "me@x.org", role: "owner" },
      { email: "cy@x.org", role: "admin" },
      { email: "nope" },
    ],
    "ME@x.org",
  );
  assert.deepStrictEqual(picks, [
    { email: "ana@x.org", role: "owner" },
    { email: "cy@x.org", role: "member" },
  ]);
  const many = [];
  for (let i = 0; i < 40; i++) many.push({ email: "p" + i + "@x.org" });
  assert.strictEqual(L.TKPF_normalizePicks(many, "").length, L.TKPF_MEMBER_MAX);
});

t("clients: the viewer's list, sorted, ids as strings", () => {
  assert.deepStrictEqual(L.TKPF_clientChoices([{ id: 2, name: "beta" }, { id: "1", name: "Alpha" }, { id: null, name: "x" }, null]), [
    { id: "1", name: "Alpha" },
    { id: "2", name: "beta" },
  ]);
  assert.deepStrictEqual(L.TKPF_clientChoices(undefined), []);
});

t("visibility: summary and warning", () => {
  assert.deepStrictEqual(L.TKPF_visibility({ openToStaff: true, people: 0 }), { summary: "Visible to all staff", warn: null });
  assert.strictEqual(L.TKPF_visibility({ people: 3 }).summary, "Visible to you and 3 people");
  assert.strictEqual(L.TKPF_visibility({ people: 1 }).summary, "Visible to you and 1 person");
  assert.strictEqual(L.TKPF_visibility({ people: 1 }).warn, null);
  const none = L.TKPF_visibility({ people: 0, canOpen: true });
  assert.strictEqual(none.summary, "Visible only to you");
  assert.ok(/turn on Open to all staff/.test(none.warn));
  assert.ok(!/Open to all staff/.test(L.TKPF_visibility({ people: 0, canOpen: false }).warn));
  assert.strictEqual(L.TKPF_visibility({ people: 0, clientName: "Acme" }).summary, "Visible to you and staff who work on Acme");
  assert.strictEqual(L.TKPF_visibility({ people: 0, clientName: "Acme" }).warn, null);
  assert.strictEqual(L.TKPF_visibility({ people: 2, clientName: "Acme" }).summary, "Visible to you, 2 people and staff who work on Acme");
  assert.ok(/Off: only the owner, the people you add below and admins/.test(L.TKPF_visibilityHelp(true)));
  assert.ok(/An admin can open it to all staff/.test(L.TKPF_visibilityHelp(false)));
});

t("buildCreate: client makes it a client project; extras only when set", () => {
  const pal = ["blue", "teal"];
  const base = L.TKPF_buildCreate({ name: " P ", sectionsList: ["A"], kind: "internal", palette: pal });
  assert.deepStrictEqual(base, { name: "P", sections: ["A"], kind: "internal", client_id: null, open_to_staff: false });
  const c = L.TKPF_buildCreate({ name: "P", kind: "internal", clientId: 42, color: "teal", description: " d ", dueOn: "2026-11-30", openToStaff: true, palette: pal });
  assert.deepStrictEqual(c, { name: "P", sections: [], kind: "onboarding", client_id: "42", open_to_staff: true, color: "teal", description: "d", due_on: "2026-11-30" });
  const bad = L.TKPF_buildCreate({ name: "P", color: "chartreuse", dueOn: "2026-02-30", description: "   ", palette: pal });
  assert.ok(!("color" in bad) && !("due_on" in bad) && !("description" in bad));
  const ob = L.TKPF_buildCreate({ name: "P", kind: "onboarding", clientId: "7" });
  assert.strictEqual(ob.kind, "onboarding");
  assert.strictEqual(ob.client_id, "7");
});

t("addMembers: one at a time, a refusal never stops the rest", () => {
  const calls = [];
  const fake = (pid, email, role) => {
    calls.push([pid, email, role]);
    if (email === "bo@x.org") return Promise.reject({ code: "22023", message: "tk_member_inactive" });
    if (email === "cy@x.org") throw { code: "tk_offline" };
    return Promise.resolve({ ok: 1 });
  };
  const picks = [
    { email: "ana@x.org", role: "owner" },
    { email: "bo@x.org", role: "member" },
    { email: "cy@x.org", role: "member" },
    { email: "di@x.org", role: "member" },
  ];
  return L.TKPF_addMembers(fake, "p1", picks).then((res) => {
    assert.deepStrictEqual(calls.map((c) => c[1]), ["ana@x.org", "bo@x.org", "cy@x.org", "di@x.org"]);
    assert.deepStrictEqual(calls[0], ["p1", "ana@x.org", "owner"]);
    assert.deepStrictEqual(res.map((r) => r.ok), [true, false, false, true]);
    const failed = L.TKPF_failures(res, [{ email: "Bo@x.org", name: "Bo Lee" }]);
    assert.deepStrictEqual(failed, [
      { email: "bo@x.org", name: "Bo Lee", reason: "not an active staff member" },
      { email: "cy@x.org", name: "cy", reason: "you were offline" },
    ]);
    const txt = L.TKPF_failureText(failed);
    assert.ok(txt.indexOf("The project was created, but 2 people could not be added: Bo Lee (not an active staff member), cy (you were offline).") === 0);
    assert.strictEqual(L.TKPF_failureText([]), "");
    assert.strictEqual(L.TKPF_memberReason({ code: "42501" }), "not allowed");
    assert.strictEqual(L.TKPF_memberReason(null), "could not be added");
  });
});

t("addMembers: empty list resolves to []", () => {
  return L.TKPF_addMembers(() => Promise.reject(new Error("never")), "p", []).then((res) => assert.deepStrictEqual(res, []));
});

// ---- Wiring (source checks) ------------------------------------------------
t("wiring: gate off keeps the old form; gate on swaps in TKPF_NewProjectModal", () => {
  const side = read("components/tasks/TK_Sidebar.jsx");
  assert.ok(/function TK_NewProjectModal\(props\) \{\n  var plusOn = typeof TKP_useOn === "function" \? TKP_useOn\(\) : false;\n  if \(plusOn && typeof TKPF_NewProjectModal === "function"\) return <TKPF_NewProjectModal \{\.\.\.props\} \/>;\n  return <TK_vNewProjectModalClassic \{\.\.\.props\} \/>;\n\}/.test(side));
  // The old form still sends exactly name, sections, kind, client_id, open_to_staff.
  const classic = side.slice(side.indexOf("function TK_vNewProjectModalClassic"), side.indexOf("function TK_vSameRoute"));
  assert.ok(/TK_api\.createProject\(\{\n      name: n,\n      sections: list,\n      kind: onboarding \? "onboarding" : "internal",\n      client_id: onboarding \? props\.clientId \|\| null : null,\n      open_to_staff: want,\n    \}\)/.test(classic));
  assert.ok(classic.indexOf("TKPF_") < 0 && classic.indexOf("description") < 0);
  const html = read("index.html");
  assert.ok(html.indexOf('"components/tasks/TK_projectFormLogic.js"') > 0 && html.indexOf('"components/tasks/TK_ProjectForm.jsx"') > 0);
  assert.ok(html.indexOf('"components/tasks/TK_ProjectForm.jsx"') < html.indexOf('"components/tasks/TK_Sidebar.jsx"'));
});

t("wiring: API selects the new columns only with the gate on; extras only when passed", () => {
  const api = read("components/tasks/TK_api.js");
  assert.ok(api.indexOf('var PROJECT_COLS = "id, name, kind, client_id, owner_email, open_to_staff, sections, archived_at, created_at, updated_at, color";') > 0);
  assert.ok(/TKP_on\(\) \? PROJECT_COLS_PLUS : PROJECT_COLS/.test(api));
  assert.ok(api.indexOf('var PROJECT_UPDATE_FIELDS = ["name", "sections", "open_to_staff", "archived_at"];') > 0);
  assert.ok(/if \(typeof f\.color === "string" && f\.color\) row\.color = f\.color;/.test(api));
  assert.ok(/if \(typeof f\.description === "string" && f\.description\.trim\(\)\) row\.description/.test(api));
});

t("wiring: header and Manage projects read the gate before showing anything", () => {
  const list = read("components/tasks/TK_List.jsx");
  assert.ok(/var plusDue = plusOn && typeof TKPF_dueInfo === "function"/.test(list));
  assert.ok(/var plusDesc = plusOn && /.test(list));
  const mp = read("components/tasks/TK_ManageProjects.jsx");
  assert.ok(/if \(!plusOn \|\| !r \|\| typeof TKPF_dueInfo !== "function"\) return null;/.test(mp));
});

t("migration: additive only (no drop outside comments), RLS untouched", () => {
  const sql = read("supabase/slateplus-project-form.sql");
  const code = sql
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
  assert.ok(/add column if not exists description text/.test(code) && /add column if not exists due_on date/.test(code));
  assert.ok(/char_length\(description\) <= 500/.test(code));
  assert.ok(!/\bdrop\b|\bpolicy\b|\bgrant\b|\brevoke\b|\bdelete\b|\bupdate public/i.test(code));
});

t("US spelling in the new files", () => {
  ["components/tasks/TK_ProjectForm.jsx", "components/tasks/TK_projectFormLogic.js", "supabase/slateplus-project-form.sql"].forEach((f) => {
    const s = read(f);
    assert.ok(!/colour|\bgrey\b/i.test(s), f);
  });
});

Promise.all(pending).then(
  () => console.log("TK_projectFormLogic: " + n + " passed"),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
