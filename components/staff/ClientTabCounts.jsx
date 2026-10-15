// ----------------------------------------------------------------------------
// ClientTabCounts.jsx: the numbers behind the staff in-client tab row badges
// and the Overview "Open for this client" strip (TABS-SPEC WP1 step 13).
//
// One hook, `useClientTabCounts(clientId, { client, me, budgetOn, enabled })`,
// called once in App (hooks region) and passed down as `counts`. It keeps a
// small shared store per client (stale-while-revalidate, 60 s fresh window,
// 2 min poll while the page is visible, no realtime). Every part is wrapped in
// its own safe(): one failing query never blanks the others, and a missing
// table counts as 0. When every part fails (or the core messages, documents
// and bank parts all fail) it returns `error: true` and the tab row shows no
// badges.
//
// Rules (tabs-study/tab-counts.md, decisions D14 in TABS-SPEC 1.1):
//   messages   threads where the client spoke last (Today's rule, read state
//              ignored); the wait starts at the first message of the
//              unanswered run; "overdue" = waits over CTC_WAIT_HOURS.
//   documents  doc requests marked uploaded; overdue = open and past due.
//   bank       transaction questions that need the bookkeeper: client-asked
//              and open, or staff-asked and answered (`waiting` = staff-asked,
//              still with the client).
//   close      last month's close: red for a QuickBooks reconnect, a blocked
//              check (uncategorized / undeposited), a late close or the month
//              before still open; amber when bank or card accounts are behind.
//              No "late" tone without a working QuickBooks connection.
//   sop        SF_freshness(...).stale from the shared SOP status store.
//   budget     newest submitted draft budget not submitted by staff.
//   tasks      my open tasks on this client (Today's "mine" rule).
//   deadline   next unfiled filing deadline from the DL store.
//
// Loaded before app.jsx: app globals (todayLocal, staffItemsApi, ...) are
// read only inside functions, never at load time. Top-level names carry
// the CTC_ prefix (shared global scope).
// ----------------------------------------------------------------------------

const CTC_FRESH_MS = 60 * 1000; // tab switches inside a minute: no refetch
const CTC_POLL_MS = 2 * 60 * 1000; // same as Today and TQ_POLL_MS
const CTC_WAIT_HOURS = 24; // client_health client_wait, client_reply_times goal
const CTC_STAFF_DOMAIN = /@mygoodbooks\.org$/i;
const CTC_PARTS = ["messages", "documents", "bank", "close", "budget", "tasks"];
const CTC_CORE = ["messages", "documents", "bank"];

const CTC_store = {
  byClient: {}, // id -> { data: {part: value}, failed: {part: bool}, at, loaded }
  inflight: {}, // id|parts -> promise
  opts: {}, // id -> latest { client, me, budgetOn }
  subs: {}, // id -> Set(bump)
  lateDay: null,
  createdAt: {},
  items: null, // { me, at, rows }
  listening: false,
  pollTimer: null,
};

function CTC_today() {
  return todayLocal();
}

// "YYYY-MM-01" for `back` months before this one.
function CTC_monthStart(back) {
  const x = new Date();
  const m = new Date(x.getFullYear(), x.getMonth() - back, 1);
  return m.getFullYear() + "-" + String(m.getMonth() + 1).padStart(2, "0") + "-01";
}

function CTC_monthName(period) {
  const [y, m] = String(period || "").split("-").map(Number);
  if (!y || !m) return "Last month";
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long" });
}

// True when `period` (YYYY-MM-01) is past its late day (late_day of the next month).
function CTC_pastLateDay(period, lateDay) {
  const [y, m] = String(period).split("-").map(Number);
  const deadline = new Date(y, m, lateDay || 15); // month index m = the following month
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate()) > deadline;
}

// The client existed before `period`'s month ended (health's created-date guard).
function CTC_existedIn(createdAt, period) {
  if (!createdAt) return true;
  const [y, m] = String(period).split("-").map(Number);
  const end = new Date(y, m, 1).getTime();
  const c = Date.parse(createdAt);
  return isNaN(c) || c < end;
}

function CTC_missing(error) {
  if (!error) return false;
  return TQ_isMissing(error);
}

// Runs a query; resolves to rows (a missing table = []), throws on any other error.
async function CTC_rows(q) {
  const r = await Promise.resolve(q);
  if (r && r.error) {
    if (CTC_missing(r.error)) return [];
    throw r.error;
  }
  return (r && r.data) || [];
}

// ---------------------------------------------------------------------------
// Parts (each returns that part's value or throws)
// ---------------------------------------------------------------------------

async function CTC_loadMessages(sb, id) {
  const rows = await CTC_rows(
    sb
      .from("client_messages")
      .select("id, participant_email, author_kind, internal, created_at")
      .eq("client_id", id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(300),
  );
  const threads = {};
  rows.forEach((row) => {
    if (row.internal) return; // a note to staff, not part of the thread
    const k = String(row.participant_email || "").trim().toLowerCase();
    const st = threads[k];
    if (!st) {
      const fromClient = row.author_kind === "client";
      threads[k] = { waiting: fromClient, done: !fromClient, startAt: row.created_at, startId: row.id, email: k };
    } else if (!st.done) {
      if (row.author_kind === "client") {
        st.startAt = row.created_at; // walk back to the first message of the run
        st.startId = row.id;
      } else st.done = true;
    }
  });
  const waiting = Object.values(threads).filter((t) => t.waiting);
  waiting.sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
  const now = Date.now();
  const overdue = waiting.filter((t) => now - Date.parse(t.startAt) > CTC_WAIT_HOURS * 3600 * 1000).length;
  const first = waiting[0] || null;
  return {
    count: waiting.length,
    overdue,
    oldestWaitAt: first ? first.startAt : null,
    firstMsgId: first ? first.startId : null,
    email: first ? first.email : null, // memory only, never put in a URL
  };
}

async function CTC_loadDocuments(sb, id) {
  const rows = await CTC_rows(
    sb.from("client_doc_requests").select("id, status, due_date, created_at").eq("client_id", id).in("status", ["open", "uploaded"]),
  );
  const today = CTC_today();
  const uploaded = rows
    .filter((r) => r.status === "uploaded")
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const overdue = rows
    .filter((r) => r.status === "open" && r.due_date && String(r.due_date).slice(0, 10) < today)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  return {
    uploaded: uploaded.length,
    overdueOpen: overdue.length,
    firstUploadedId: uploaded[0] ? uploaded[0].id : null,
    firstOverdueId: overdue[0] ? overdue[0].id : null,
  };
}

// GL Review (spec section 5): questions now run both ways. `open` counts what
// needs the bookkeeper: client-asked questions still open, plus staff-asked
// questions the client has answered. `waiting` counts staff-asked questions
// still waiting on the client (shown, not counted as work). Before
// gl-review-2-questions.sql runs there is no `direction` column, so it falls
// back to the old open-only query.
async function CTC_loadBank(sb, id) {
  const q = (cols, statuses) =>
    sb
      .from("transaction_questions")
      .select(cols)
      .eq("client_id", id)
      .in("status", statuses)
      .order("created_at", { ascending: true })
      .limit(200);
  let rows;
  const r = await Promise.resolve(q("id, status, created_at, direction", ["open", "answered"]));
  if (r && r.error && /direction|42703/.test(String(r.error.message || "") + " " + (r.error.code || ""))) {
    rows = await CTC_rows(q("id, status, created_at", ["open"]));
  } else {
    rows = await CTC_rows(r);
  }
  const staffAsked = (x) => x.direction === "staff_asked";
  const open = rows.filter((x) => (staffAsked(x) ? x.status === "answered" : !x.status || x.status === "open"));
  const waiting = rows.filter((x) => staffAsked(x) && x.status === "open").length;
  return {
    open: open.length,
    waiting,
    oldestOpenAt: open[0] ? open[0].created_at : null,
    firstId: open[0] ? open[0].id : null,
  };
}

async function CTC_loadClose(sb, id, opts) {
  const P = CTC_monthStart(1);
  const P2 = CTC_monthStart(2);
  const client = (opts && opts.client) || null;
  const soft = (q) => Promise.resolve(q).then((r) => r, (e) => ({ data: null, error: e }));
  const jobs = [
    CTC_rows(sb.from("month_close").select("period, status").eq("client_id", id).eq("period_kind", "month").gte("period", P2)),
    CTC_rows(sb.from("close_checks").select("period, status, checks").eq("client_id", id).eq("period", P)),
    soft(sb.from("qbo_connections").select("status").eq("client_id", id).maybeSingle()),
    CTC_store.lateDay == null ? soft(sb.from("month_close_settings").select("late_day").maybeSingle()) : null,
    CTC_store.createdAt[id] === undefined && !(client && (client.created_at || client.createdAt))
      ? soft(sb.from("clients").select("created_at").eq("id", id).maybeSingle())
      : null,
  ];
  const [mc, cc, conn, st, created] = await Promise.all(jobs);
  if (st) CTC_store.lateDay = (st.data && st.data.late_day) || 15;
  if (created) CTC_store.createdAt[id] = (created.data && created.data.created_at) || null;
  const createdAt = (client && (client.created_at || client.createdAt)) || CTC_store.createdAt[id] || null;
  const lateDay = CTC_store.lateDay || 15;

  const statusOf = (p) => {
    const row = mc.find((r) => String(r.period).slice(0, 10) === p);
    return (row && row.status) || "not_started";
  };
  const isClosed = (s) => s === "done" || s === "na";
  const status = statusOf(P);
  const statusP2 = statusOf(P2);
  const check = cc.find((r) => String(r.period).slice(0, 10) === P) || null;
  const checks = check && Array.isArray(check.checks) ? check.checks : [];
  const failing = checks.filter((c) => c && c.ok === false).map((c) => c.key);
  // close_checks stores a month that is both behind and blocked as "behind",
  // so read the individual checks; fall back to the status with no checks.
  const blocked = failing.includes("uncategorized") || failing.includes("undeposited") || (!checks.length && !!check && check.status === "blocked");
  const behind = failing.includes("bank_active") || failing.includes("reconciled") || (!checks.length && !!check && check.status === "behind");

  const connRow = conn && !conn.error ? conn.data : null;
  let qbo = "none";
  if (connRow && connRow.status === "error") qbo = "error";
  else if (connRow && connRow.status === "connected") qbo = "ok";
  else if (!connRow && client && client.dataSource === "quickbooks") qbo = "ok";
  const qboWorks = qbo === "ok" && !(check && check.status === "no_data");

  const inP = CTC_existedIn(createdAt, P);
  const inP2 = CTC_existedIn(createdAt, P2);
  const openP = inP && !isClosed(status);
  const lateP = openP && CTC_pastLateDay(P, lateDay);
  const openP2 = inP2 && !isClosed(statusP2);

  let tone = null;
  let label = null;
  let late = false;
  let latePeriod = null;
  if (qbo === "error") {
    tone = "bad";
    label = "QuickBooks needs reconnecting";
  } else if (openP && blocked) {
    tone = "bad";
    label = CTC_monthName(P) + " close is blocked in QuickBooks";
  } else if (lateP && qboWorks) {
    tone = "bad";
    late = true;
    latePeriod = P;
    label = CTC_monthName(P) + " close is late";
  } else if (openP2 && qboWorks) {
    tone = "bad";
    late = true;
    latePeriod = P2;
    label = CTC_monthName(P2) + " close is late";
  } else if (openP && behind) {
    tone = "warn";
    label = CTC_monthName(P) + " close: bank or card accounts need catching up in QuickBooks";
  }
  if (!late && qboWorks && (lateP || openP2)) {
    late = true;
    latePeriod = lateP ? P : P2;
  }
  return { period: P, label, status, check: check ? check.status : null, failing, late, latePeriod, qbo, tone };
}

async function CTC_loadBudget(sb, id, opts) {
  if (!opts || !opts.budgetOn) return { awaitingStaff: false, fiscalYear: null };
  const rows = await CTC_rows(
    sb
      .from("client_budget_drafts")
      .select("fiscal_year, version, status, submitted_by, submitted_at")
      .eq("client_id", id)
      .eq("status", "submitted")
      .order("fiscal_year", { ascending: false })
      .limit(1),
  );
  const row = rows.find((r) => !r.status || r.status === "submitted") || null;
  // Staff-submitted drafts wait on the client. Domain test in JS (the
  // preview's fake Supabase treats .not() as a no-op).
  const awaitingStaff = !!row && !CTC_STAFF_DOMAIN.test(String(row.submitted_by || "").trim());
  return { awaitingStaff, fiscalYear: row ? row.fiscal_year : null };
}

async function CTC_loadTasks(sb, id, opts, force) {
  const me = (opts && opts.me) || "";
  if (!me) return { mine: 0, overdue: 0, firstId: null };
  const cached = CTC_store.items;
  if (force || !cached || cached.me !== me || Date.now() - cached.at > CTC_FRESH_MS) {
    const r = await staffItemsApi.list(sb, me);
    if (r && r.error) throw r.error;
    CTC_store.items = { me, at: Date.now(), rows: (r && r.data) || [] };
  }
  const mineTest = isMyStaffItem;
  const today = CTC_today();
  // Tasks module rules when loaded: open = not done or deleted (a task waiting
  // for review still counts), and waiting on the client is never overdue.
  // staffItemsApi.list already leaves deleted rows out once the column exists.
  const tk = typeof TK_isOpen === "function" && typeof TK_isOverdue === "function";
  const isOpen = (t) => (tk ? TK_isOpen(t) : !t.done && !t.deleted_at);
  const mine = CTC_store.items.rows.filter((t) => t && t.client_id === id && isOpen(t) && t.kind !== "note" && mineTest(t, me));
  const overdue = mine.filter((t) => (tk ? TK_isOverdue(t, today) : t.due_date && String(t.due_date).slice(0, 10) < today));
  const first = overdue[0] || mine.filter((t) => t.due_date).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0] || mine[0] || null;
  return { mine: mine.length, overdue: overdue.length, firstId: first ? first.id : null };
}

const CTC_LOADERS = {
  messages: CTC_loadMessages,
  documents: CTC_loadDocuments,
  bank: CTC_loadBank,
  close: CTC_loadClose,
  budget: CTC_loadBudget,
  tasks: CTC_loadTasks,
};

function CTC_emit(id) {
  const set = CTC_store.subs[id];
  if (set) set.forEach((fn) => fn());
}

// Loads the given parts for one client and merges them into the store.
function CTC_load(id, parts, force) {
  const sb = window.mgbSupabase;
  if (!id) return Promise.resolve();
  const list = parts && parts.length ? parts : CTC_PARTS;
  const key = id + "|" + list.join(",");
  if (CTC_store.inflight[key]) return CTC_store.inflight[key];
  const opts = CTC_store.opts[id] || {};
  const run = (async () => {
    const prev = CTC_store.byClient[id] || { data: {}, failed: {}, at: 0, loaded: false };
    const data = { ...prev.data };
    const failed = { ...prev.failed };
    if (!sb) {
      CTC_store.byClient[id] = { data: {}, failed: {}, at: Date.now(), loaded: true, noSb: true };
      return;
    }
    await Promise.all(
      list.map((p) =>
        Promise.resolve()
          .then(() => CTC_LOADERS[p](sb, id, opts, force))
          .then(
            (v) => {
              data[p] = v;
              failed[p] = false;
            },
            () => {
              failed[p] = true; // keep the last good value
            },
          ),
      ),
    );
    const full = list.length === CTC_PARTS.length;
    CTC_store.byClient[id] = {
      data,
      failed,
      at: full ? Date.now() : prev.at || Date.now(),
      loaded: prev.loaded || full,
    };
  })().finally(() => {
    delete CTC_store.inflight[key];
    CTC_emit(id);
  });
  CTC_store.inflight[key] = run;
  return run;
}

function CTC_reloadSubscribed(parts, onlyStale) {
  Object.keys(CTC_store.subs).forEach((id) => {
    if (!CTC_store.subs[id] || !CTC_store.subs[id].size) return;
    const e = CTC_store.byClient[id];
    if (onlyStale && e && Date.now() - e.at <= CTC_FRESH_MS) return;
    CTC_load(id, parts, true);
  });
}

function CTC_listen() {
  if (CTC_store.listening) return;
  CTC_store.listening = true;
  const on = (name, parts) => window.addEventListener(name, () => CTC_reloadSubscribed(parts));
  on("mgb:client-messages-changed", ["messages"]);
  on(STAFF_TOOLS_EVENT, ["documents", "budget"]);
  on(TQ_EVENT, ["bank"]);
  on(CC_CHANGED_EVENT, ["close"]);
  on(OB_CHANGED_EVENT, ["close"]);
  on("mgb:month-close-changed", ["close"]);
  on(STAFF_ITEMS_CHANGED_EVENT, ["tasks"]);
  window.addEventListener("focus", () => CTC_reloadSubscribed(null, true));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) CTC_reloadSubscribed(null, true);
  });
  CTC_store.pollTimer = setInterval(() => {
    if (!document.hidden) CTC_reloadSubscribed(null, false);
  }, CTC_POLL_MS);
}

const CTC_ZERO = {
  messages: { count: 0, overdue: 0, oldestWaitAt: null, firstMsgId: null, email: null },
  documents: { uploaded: 0, overdueOpen: 0, firstUploadedId: null, firstOverdueId: null },
  bank: { open: 0, waiting: 0, oldestOpenAt: null, firstId: null },
  close: { period: null, label: null, status: null, check: null, failing: [], late: false, latePeriod: null, qbo: "none", tone: null },
  sop: { stale: false, days: null, firstStaleSection: null },
  budget: { awaitingStaff: false, fiscalYear: null },
  tasks: { mine: 0, overdue: 0, firstId: null },
  deadline: { next: null, tone: null },
};

function useClientTabCounts(clientId, opts) {
  const o = opts || {};
  const enabled = !!o.enabled && !!clientId;
  const client = o.client || null;
  const me = String(o.me || "").toLowerCase();
  const budgetOn = !!o.budgetOn;
  const [, bump] = React.useReducer((n) => n + 1, 0);

  // Keep the latest options for the loaders (read at load time).
  if (enabled) CTC_store.opts[clientId] = { client, me, budgetOn };

  React.useEffect(() => {
    if (!enabled) return undefined;
    CTC_listen();
    const set = (CTC_store.subs[clientId] = CTC_store.subs[clientId] || new Set());
    set.add(bump);
    const e = CTC_store.byClient[clientId];
    if (!e || !e.loaded || Date.now() - e.at > CTC_FRESH_MS) CTC_load(clientId, null, false);
    return () => {
      set.delete(bump);
    };
  }, [enabled, clientId]);

  // Budget and tasks depend on options that can arrive after the first load.
  React.useEffect(() => {
    if (enabled && CTC_store.byClient[clientId]) CTC_load(clientId, ["budget"], true);
  }, [enabled, clientId, budgetOn]);
  React.useEffect(() => {
    if (enabled && me && CTC_store.byClient[clientId]) CTC_load(clientId, ["tasks"], false);
  }, [enabled, clientId, me]);

  // Shared firm-wide stores (warm from Today); same hook calls every render.
  const sopByClient = SF_useSopStatus(enabled);
  const dl = DL_useStore(enabled);

  const refresh = React.useCallback(() => {
    if (clientId) CTC_load(clientId, null, true);
  }, [clientId]);

  const entry = enabled ? CTC_store.byClient[clientId] : null;
  if (!entry || !entry.loaded) {
    return { loaded: false, error: false, ...CTC_ZERO, refresh };
  }
  if (entry.noSb) {
    return { loaded: true, error: false, ...CTC_ZERO, refresh };
  }

  let sop = CTC_ZERO.sop;
  if (sopByClient) {
    const f = SF_freshness(sopByClient[clientId], CTC_today());
    if (f) sop = { stale: !!f.stale, days: f.days, firstStaleSection: null };
  }

  let deadline = CTC_ZERO.deadline;
  if (dl && !dl.loading && client) {
    try {
      const today = CTC_today();
      const next = DL_items(dl, [client], OPS_addDays(today, -180), OPS_addDays(today, 365)).filter((i) => i.state !== "filed")[0] || null;
      deadline = { next, tone: next ? (next.state === "overdue" ? "bad" : next.state === "soon" ? "warn" : null) : null };
    } catch (e) {
      deadline = CTC_ZERO.deadline;
    }
  }

  const failed = entry.failed || {};
  const error = CTC_PARTS.every((p) => failed[p]) || CTC_CORE.every((p) => failed[p]);
  const d = entry.data || {};
  return {
    loaded: true,
    error,
    messages: d.messages || CTC_ZERO.messages,
    documents: d.documents || CTC_ZERO.documents,
    bank: d.bank || CTC_ZERO.bank,
    close: d.close || CTC_ZERO.close,
    sop,
    budget: d.budget || CTC_ZERO.budget,
    tasks: d.tasks || CTC_ZERO.tasks,
    deadline,
    refresh,
  };
}
