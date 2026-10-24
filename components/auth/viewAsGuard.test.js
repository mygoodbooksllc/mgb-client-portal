// Plain node, no framework: `node components/auth/viewAsGuard.test.js`.
// The View as read-only fetch guard in supabaseClient.js
// (docs/view-as-full-app-spec.md §3.1). The file is loaded in a vm sandbox
// with a stub window, so the real wrapper and verdict run.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let n = 0;
async function t(name, fn) {
  try {
    await fn();
  } catch (e) {
    console.error("FAIL " + name);
    throw e;
  }
  n++;
}

const BASE = "https://proj.supabase.co";
const calls = [];
const toasts = [];
const audits = [];
const sandbox = {
  console: { warn() {}, debug() {}, log() {}, error() {} },
  URL,
  Response,
  Request,
  Promise,
  JSON,
  Date,
  Set,
  String,
  setTimeout,
  CustomEvent: class {
    constructor(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    }
  },
  localStorage: { getItem: () => null },
  location: { href: "https://app.example.com/index.html" },
  SUPABASE_CONFIG: { url: BASE, anonKey: "anon" },
  supabase: { createClient: () => ({ stub: true }) },
  dispatchEvent(ev) {
    if (ev.type === "mgb:toast") toasts.push(ev.detail.text);
  },
  fetch(input, init) {
    calls.push({ input, init });
    return Promise.resolve(new Response("{}", { status: 200 }));
  },
  AL_logEvent(action, clientId, detail) {
    audits.push({ action, detail });
    return Promise.resolve({ error: null });
  },
  __mgbActor: { page: "work" },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "supabaseClient.js"), "utf8"), sandbox);

const W = sandbox;
function on() {
  W.mgbViewAs = { on: true, name: "Kim Lee", email: "kim@x.com" };
}
function off() {
  W.mgbViewAs = null;
}
// Runs one request through the wrapped fetch: true when it went through.
async function passes(input, init) {
  const before = calls.length;
  const res = await W.fetch(input, init);
  const went = calls.length > before;
  if (!went) assert.strictEqual(res.status, 403);
  return went;
}
const post = (body) => ({ method: "POST", body: body === undefined ? "{}" : body });
const verdict = (u, m, init) => W.MGB_viewAsVerdict(new URL(u, BASE), m, init, BASE);

(async () => {
  await t("client is still built", () => assert.deepStrictEqual(W.mgbSupabase, { stub: true }));

  await t("inert when off", async () => {
    off();
    assert.strictEqual(W.MGB_viewAsReadOnly(), false);
    assert.ok(await passes(BASE + "/rest/v1/tasks", post()));
    assert.ok(await passes(BASE + "/functions/v1/send-email", post()));
    W.mgbViewAs = { on: false };
    assert.ok(await passes(BASE + "/rest/v1/tasks", { method: "DELETE" }));
  });

  await t("GET table ok, POST/PATCH/DELETE table blocked", async () => {
    on();
    assert.ok(await passes(BASE + "/rest/v1/tasks?select=*"));
    assert.ok(await passes(BASE + "/rest/v1/tasks", { method: "HEAD" }));
    assert.ok(!(await passes(BASE + "/rest/v1/tasks", post())));
    assert.ok(!(await passes(BASE + "/rest/v1/tasks?id=eq.1", { method: "PATCH", body: "{}" })));
    assert.ok(!(await passes(BASE + "/rest/v1/tasks?id=eq.1", { method: "DELETE" })));
  });

  await t("usage_events and client_errors POST ok, PATCH not", async () => {
    on();
    assert.ok(await passes(BASE + "/rest/v1/usage_events", post()));
    assert.ok(await passes(BASE + "/rest/v1/client_errors", post()));
    assert.ok(!(await passes(BASE + "/rest/v1/usage_events?id=eq.1", { method: "PATCH", body: "{}" })));
  });

  await t("allow-listed RPC ok with any method", async () => {
    on();
    assert.ok(await passes(BASE + "/rest/v1/rpc/staff_directory", post()));
    assert.ok(await passes(BASE + "/rest/v1/rpc/staff_directory"));
    assert.ok(await passes(BASE + "/rest/v1/rpc/log_audit_event", post()));
    assert.ok(await passes(BASE + "/rest/v1/rpc/record_app_time", post()));
    assert.ok(await passes(BASE + "/rest/v1/rpc/tk_my_coverage", post()));
  });

  await t("unknown and removed RPCs blocked with a toast", async () => {
    on();
    for (const name of ["tk_complete_task", "client_reply_times", "access_link_client"]) {
      const v = verdict("/rest/v1/rpc/" + name, "POST");
      assert.strictEqual(v.ok, false, name);
      assert.ok(!v.silent, name);
    }
    assert.ok(!(await passes(BASE + "/rest/v1/rpc/tk_complete_task")));
  });

  await t("silent-deny RPCs: 403, no toast, no audit", async () => {
    on();
    const names = [
      "tr_my_overview",
      "tr_get_review",
      "tr_survey_get",
      "tr_survey_results",
      "hb_status",
      "hb_approver_access",
      "tk_search",
      "wb_inbox",
      "sp_my_photo_status",
      "tk_project_task_counts",
    ];
    W.__mgbActor.page = "silent-page";
    const t0 = toasts.length;
    const a0 = audits.length;
    for (const name of names) {
      assert.strictEqual(verdict("/rest/v1/rpc/" + name, "POST").silent, true, name);
      assert.ok(!(await passes(BASE + "/rest/v1/rpc/" + name, post())), name);
    }
    assert.strictEqual(toasts.length, t0);
    assert.strictEqual(audits.length, a0);
    // Read markers are silent too.
    assert.strictEqual(verdict("/rest/v1/client_message_reads", "POST").silent, true);
    W.__mgbActor.page = "work";
  });

  await t("auth: token and logout POST ok, user GET ok, PUT user blocked", async () => {
    on();
    assert.ok(await passes(BASE + "/auth/v1/token?grant_type=refresh_token", post()));
    assert.ok(await passes(BASE + "/auth/v1/logout", post()));
    assert.ok(await passes(BASE + "/auth/v1/user"));
    assert.ok(!(await passes(BASE + "/auth/v1/user", { method: "PUT", body: "{}" })));
    assert.ok(!(await passes(BASE + "/auth/v1/otp", post())));
  });

  await t("storage: GET and sign/list ok, upload and upload/sign blocked", async () => {
    on();
    assert.ok(await passes(BASE + "/storage/v1/object/public/b/a.png"));
    assert.ok(await passes(BASE + "/storage/v1/object/sign/staff-photos/a.png", post()));
    assert.ok(await passes(BASE + "/storage/v1/object/list/staff-photos", post()));
    assert.ok(!(await passes(BASE + "/storage/v1/object/upload/sign/staff-photos/a.png", post())));
    assert.ok(!(await passes(BASE + "/storage/v1/object/staff-photos/a.png", post())));
    assert.ok(!(await passes(BASE + "/storage/v1/object/staff-photos/a.png", { method: "DELETE" })));
  });

  await t("functions blocked for every method, GET included", async () => {
    on();
    assert.ok(!(await passes(BASE + "/functions/v1/qbo-sync", post())));
    assert.ok(!(await passes(BASE + "/functions/v1/qbo-sync")));
    assert.ok(!(await passes(BASE + "/functions/v1/notification-emails?x=1")));
  });

  await t("drive-files: status/list/link ok, other actions blocked", async () => {
    on();
    const u = BASE + "/functions/v1/drive-files";
    for (const action of ["status", "list", "link"])
      assert.ok(await passes(u, post(JSON.stringify({ action, client_id: "c1" }))), action);
    for (const action of ["upload", "connect", "delete", "rename", "disconnect"])
      assert.ok(!(await passes(u, post(JSON.stringify({ action })))), action);
    assert.ok(!(await passes(u, post("not json"))));
    assert.ok(!(await passes(u, post(JSON.stringify({ action: 5 })))));
    assert.ok(!(await passes(u, { method: "POST" })));
    // GET without a download token is still an edge call.
    assert.ok(!(await passes(u)));
  });

  await t("drive-files ?t= GET download ok", async () => {
    on();
    assert.ok(await passes(BASE + "/functions/v1/drive-files?t=abc123"));
    assert.ok(!(await passes(BASE + "/functions/v1/drive-files?t=abc123", post())));
  });

  await t("realtime broadcast POST blocked; graphql POST blocked", async () => {
    on();
    assert.ok(!(await passes(BASE + "/realtime/v1/api/broadcast", post())));
    assert.ok(!(await passes(BASE + "/graphql/v1", post())));
  });

  await t("other origins pass", async () => {
    on();
    assert.ok(await passes("https://cdnjs.cloudflare.com/x.js", post()));
    assert.ok(await passes("https://example.org/api", { method: "DELETE" }));
  });

  await t("URL object and Request inputs", async () => {
    on();
    assert.ok(await passes(new URL(BASE + "/rest/v1/tasks")));
    assert.ok(!(await passes(new URL(BASE + "/rest/v1/tasks"), post())));
    assert.ok(await passes(new Request(BASE + "/rest/v1/tasks")));
    assert.ok(!(await passes(new Request(BASE + "/rest/v1/tasks", { method: "POST", body: "{}" }))));
    // init.method wins over the Request's method.
    assert.ok(!(await passes(new Request(BASE + "/rest/v1/tasks"), { method: "DELETE" })));
  });

  await t("relative URLs resolve against the page", async () => {
    on();
    assert.ok(await passes("components/app.jsx", post()));
    assert.ok(await passes("/docs/x.md"));
    // A relative URL on the Supabase origin page is guarded.
    W.location.href = BASE + "/";
    assert.ok(!(await passes("/rest/v1/tasks", post())));
    W.location.href = "https://app.example.com/index.html";
  });

  await t("unparseable URL blocked", async () => {
    on();
    assert.ok(!(await passes("http://[bad", post())));
    assert.strictEqual(W.MGB_viewAsVerdict(null, "GET", null, BASE).ok, false);
  });

  await t("blocked write: toast deduped, one audit per page", async () => {
    on();
    W.__mgbActor.page = "fresh-page";
    const a0 = audits.length;
    await passes(BASE + "/rest/v1/tasks", post());
    await passes(BASE + "/rest/v1/tasks", post());
    const mine = audits.slice(a0);
    assert.strictEqual(mine.length, 1);
    assert.strictEqual(mine[0].action, "view_as.blocked");
    assert.strictEqual(mine[0].detail.target, "kim@x.com");
    assert.strictEqual(mine[0].detail.page, "fresh-page");
    assert.strictEqual(mine[0].detail.kind, "rest");
    assert.ok(toasts.length >= 1);
    const t0 = toasts.length;
    await passes(BASE + "/rest/v1/notes", post());
    assert.strictEqual(toasts.length, t0, "second toast inside 4 s is dropped");
    W.__mgbActor.page = "work";
  });

  await t("blocked response body is JSON with code VIEWAS", async () => {
    on();
    const res = await W.fetch(BASE + "/rest/v1/tasks", post());
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.code, "VIEWAS");
  });

  off();
  console.log("viewAsGuard: " + n + " passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
