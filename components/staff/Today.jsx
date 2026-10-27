// ----------------------------------------------------------------------------
// Today (staff navigation redesign, 2026-10-08). The staff start page,
// #/today, mounted by App as <TD_TodayPage/>. Replaces BookkeeperHomePage.
//
// One ranked list of everything that needs the signed-in person, in two
// bands: "Now" (late, or waiting on you) and "This week" (coming up, or worth
// a look). Four tiles above it, a few optional cards below. The old widget
// board (Customize drawer, custom cards, drag to reorder) is gone for staff;
// client dashboards keep theirs.
//
// Sources, each failing soft (a table that isn't there just leaves its rows
// out, with a quiet note under the list when it's a real error):
//   replies waiting   client_messages, same rule as the Inbox: the newest
//                     message in a thread that a client can see is from the
//                     client, so nobody has replied yet
//   tasks             staff_reminders via staffItemsApi (mine: owned by me or
//                     assigned to me)
//   deadlines         DL_useStore / DL_items (Deadlines.jsx), my clients
//   month-end close   month_close (last month, not done) and close_checks
//                     (blocked in QuickBooks), my clients
//   reviews           TR_useOverview (TeamReviews.jsx); replaces the old
//                     TR_HomeDueNotice card
//   handbook          HB_useStatus (components/handbook/HB_api.js): policies
//                     I need to sign (bookkeepers), signatures I countersign
//   clients at risk   HL_useHealth (ClientHealth.jsx)
//   stale SOPs        SF_useSopStatus / SF_staleTodos (SopFreshness.jsx)
//   access            teammates' temporary-access requests to approve
//                     (CS_useAccessGrants) and clients' portal access_requests
//   upgrades          enterprise_upgrade_requests (any staff member can
//                     follow up, same as before)
//   coverage gaps     coverage_overview, admins only (the RPC is admin-only)
//   bills             each client's open payables, grouped per client
//
// "My clients" (deadlines, close) = clients I'm the assigned bookkeeper on;
// an admin with none assigned sees every client, like the old Home cards.
//
// Optional cards (Clients needing attention, Waiting on others, Reminders,
// This week, Recent clients) each have a
// show/hide toggle saved to user_settings.settings.todayCards through
// ST_store (components/settings/Settings.jsx). While settings are paused
// ("View as") the toggle still works for this visit, it just isn't saved.
//
// Loaded before app.jsx and shares its global scope: every top-level name
// carries a TD_ prefix, hooks are used as React.*, and app.jsx globals
// (staffItemsApi, fmtDate, NAV_go, useToast...) are only touched at render
// or effect time. Modules that may not be loaded are guarded with typeof.
// ----------------------------------------------------------------------------

const TD_REFRESH_MS = 2 * 60 * 1000;
// "This week" = due within this many days (matches AP_SOON_DAYS and
// OPS_DEADLINE_SOON_DAYS so the three sources agree on what "soon" means).
const TD_SOON_DAYS = 7;
// Rows per band before "Show everything".
const TD_ROW_LIMIT = 6;
// Coverage gaps: time off starting within this many days.
const TD_COVERAGE_DAYS = 14;
const TD_CARDS = [
  { key: "attention", label: "Clients needing attention" },
  { key: "waiting", label: "Waiting on others" },
  { key: "reminders", label: "Reminders" },
  { key: "milestones", label: "This week" },
  { key: "recent", label: "Recent clients" },
];
const TD_CARD_DEFAULTS = { attention: true, waiting: true, reminders: true, milestones: true, recent: true };
// Clients shown per "needing attention" / "waiting" card.
const TD_CARD_ROWS = 4;
// Admins see celebrations a month ahead (celebrationLead.js), so the This
// week card shows more of them than the 4 rows other cards use.
const TD_CEL_CARD_ROWS = 10;
// The word shown beside each row's icon. Color never carries the meaning
// on its own: the band heading and this label say it in words.
const TD_KIND_LABEL = {
  access: "Access",
  reply: "Reply",
  task: "Task",
  deadline: "Deadline",
  close: "Close",
  bill: "Bills",
  review: "Review",
  handbook: "Handbook",
  photos: "Photos",
  upgrade: "Upgrade",
  risk: "Health",
  coverage: "Coverage",
  sop: "SOP",
};

const TD_lc = (s) => String(s || "").trim().toLowerCase();
const TD_isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const TD_safe = (p) => Promise.resolve(p).then((r) => r, (e) => ({ data: null, error: e }));

// First day of last month, YYYY-MM-01: the period month_close and
// close_checks key last month's close on (same as the top bar's bell).
function TD_prevMonthStart() {
  const d = new Date();
  const m = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-01`;
}

// "September" for a YYYY-MM-01 period.
function TD_monthName(period) {
  const [y, m] = String(period || "").split("-").map(Number);
  if (!y || !m) return "last month";
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long" });
}

// "Wednesday, October 8" (with the year once it isn't this year).
function TD_dateLine() {
  const d = new Date();
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function TD_greeting(name) {
  const hour = new Date().getHours();
  const first = String(name || "").trim().split(/\s+/)[0];
  return "Good " + (hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening") + (first ? `, ${first}` : "") + ".";
}

// A plain sentence for a failed load; "" when the table simply isn't set up
// yet (nothing to say, the feature just isn't on).
function TD_errText(what, error) {
  if (!error) return "";
  if (typeof isMissingTableError === "function" && isMissingTableError(error)) return "";
  const msg = error.message ? String(error.message) : "";
  return `Couldn't load ${what}.` + (msg ? " " + msg : "");
}

// Clients I'm the assigned bookkeeper on. An admin with none assigned gets
// every client they can see, so their Today isn't empty for no reason.
function TD_myClients(clients, me, isAdmin) {
  const mine = (clients || []).filter((c) => c.assignedBookkeeper && TD_lc(c.assignedBookkeeper.email) === TD_lc(me));
  return mine.length === 0 && isAdmin ? clients || [] : mine;
}

// Refresh `load` on mount, when any of `events` fires, and every
// TD_REFRESH_MS while the tab is visible.
function TD_useRefresh(load, events) {
  React.useEffect(() => {
    load();
    const id = setInterval(() => !document.hidden && load(), TD_REFRESH_MS);
    const evs = (events || []).filter(Boolean);
    evs.forEach((ev) => window.addEventListener(ev, load));
    return () => {
      clearInterval(id);
      evs.forEach((ev) => window.removeEventListener(ev, load));
    };
    // `events` is a fresh array each render but its contents never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);
}

// ---------------------------------------------------------------------------
// Data hooks
// ---------------------------------------------------------------------------

// Threads waiting on a reply: the newest message a client can see is the
// client's. Same rule as the Inbox's "waiting" flag; the bell adds a
// "haven't read it" test on top, which isn't the question here (read but
// not answered is still waiting).
function TD_useWaitingThreads(me, clients) {
  const idsKey = (clients || [])
    .map((c) => c.id)
    .sort()
    .join(",");
  const [state, setState] = React.useState({ rows: [], loaded: false, error: "" });
  const load = React.useCallback(async () => {
    const sb = window.mgbSupabase;
    if (!sb || !me || !idsKey) {
      setState({ rows: [], loaded: true, error: "" });
      return;
    }
    const res = await TD_safe(
      sb
        .from("client_messages")
        .select("id, client_id, participant_email, author_kind, author_name, body, internal, created_at")
        .in("client_id", idsKey.split(","))
        // A deleted message is as if it was never sent (message-delete-24h.sql).
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(400),
    );
    if (res.error) {
      setState({ rows: [], loaded: true, error: TD_errText("client messages", res.error) });
      return;
    }
    const seen = new Set();
    const rows = [];
    (res.data || []).forEach((row) => {
      if (row.internal) return; // a note to staff, not part of the thread
      const k = row.client_id + "|" + TD_lc(row.participant_email);
      if (seen.has(k)) return; // only the newest visible message decides
      seen.add(k);
      if (row.author_kind === "client") rows.push(row);
    });
    rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))); // oldest wait first
    setState({ rows, loaded: true, error: "" });
  }, [idsKey, me]);
  TD_useRefresh(load, ["mgb:client-messages-changed", "mgb:staff-tools-changed"]);
  return state;
}

// My tasks and reminders (staffItemsApi, the same rows Work › Tasks edits).
function TD_useMyItems(me) {
  const [state, setState] = React.useState({ items: null, error: "" });
  const load = React.useCallback(() => {
    const sb = window.mgbSupabase;
    if (!sb || !me) {
      setState({ items: [], error: "" });
      return;
    }
    staffItemsApi.list(sb, me).then(({ data, error }) => {
      if (error) {
        setState({ items: [], error: TD_errText("your tasks", error) });
        return;
      }
      // View as: private tasks dropped, failing closed (VA_visibleItems, Q3).
      const rows = typeof VA_visibleItems === "function" ? VA_visibleItems(data) : data || [];
      setState({ items: rows.filter((r) => isMyStaffItem(r, me)), error: "" });
    });
  }, [me]);
  TD_useRefresh(load, [STAFF_ITEMS_CHANGED_EVENT]);
  return state;
}

// Clients' portal access requests (access_requests), firm-wide. RLS already
// limits the rows to clients this person can reach, so no .in() here.
function TD_useAccessRequests() {
  const [state, setState] = React.useState({ rows: [], loaded: false, error: "" });
  const load = React.useCallback(async () => {
    const sb = window.mgbSupabase;
    if (!sb) {
      setState({ rows: [], loaded: true, error: "" });
      return;
    }
    const res = await TD_safe(
      sb.from("access_requests").select("id, client_id, submitted_by_name, submitted_at, people").eq("reviewed", false).order("submitted_at", { ascending: true }),
    );
    setState({ rows: res.error ? [] : res.data || [], loaded: true, error: TD_errText("access requests", res.error) });
  }, []);
  TD_useRefresh(load, [STAFF_TOOLS_EVENT]);
  return state;
}

// "Upgrade to Enterprise" requests from clients' upgrade preview page
// (supabase/enterprise-upgrade-requests.sql). Any staff member can mark one
// contacted, completed or dismissed.
function TD_useUpgradeRequests(showToast) {
  const [state, setState] = React.useState({ rows: [], loaded: false, error: "" });
  const [busyId, setBusyId] = React.useState(null);
  const load = React.useCallback(async () => {
    const sb = window.mgbSupabase;
    if (!sb) {
      setState({ rows: [], loaded: true, error: "" });
      return;
    }
    // "*" so this keeps working whether or not requested_plan exists yet.
    const res = await TD_safe(sb.from("enterprise_upgrade_requests").select("*").eq("status", "new").order("created_at", { ascending: true }));
    setState({ rows: res.error ? [] : res.data || [], loaded: true, error: TD_errText("upgrade requests", res.error) });
  }, []);
  TD_useRefresh(load, [STAFF_TOOLS_EVENT]);
  const setStatus = React.useCallback(
    async (row, status) => {
      const sb = window.mgbSupabase;
      if (!sb) return;
      setBusyId(row.id);
      const { error } = await TD_safe(sb.from("enterprise_upgrade_requests").update({ status }).eq("id", row.id));
      setBusyId(null);
      if (error) {
        if (showToast) showToast(`Couldn't update that request: ${error.message || "try again"}`);
        return;
      }
      load();
    },
    [load, showToast],
  );
  return { ...state, busyId, setStatus };
}

// Last month's close for my clients: which aren't done yet (month_close,
// no row = not started) and which QuickBooks flags as blocked (close_checks).
function TD_useCloses(clientIds) {
  const idsKey = clientIds.slice().sort().join(",");
  const period = TD_prevMonthStart();
  const [state, setState] = React.useState({ open: [], blocked: [], loaded: false });
  const load = React.useCallback(async () => {
    const sb = window.mgbSupabase;
    if (!sb || !idsKey) {
      setState({ open: [], blocked: [], loaded: true });
      return;
    }
    const ids = idsKey.split(",");
    const [mc, cc] = await Promise.all([
      TD_safe(sb.from("month_close").select("client_id, period, status").eq("period_kind", "month").eq("period", period).in("client_id", ids)),
      TD_safe(sb.from("close_checks").select("client_id, period, status, reasons").eq("status", "blocked").eq("period", period).in("client_id", ids)),
    ]);
    const statusOf = {};
    ((mc && mc.data) || []).forEach((r) => (statusOf[r.client_id] = r.status));
    const open = mc.error ? [] : ids.filter((id) => !["done", "na", "review"].includes(statusOf[id] || "not_started")).map((id) => ({ client_id: id, status: statusOf[id] || "not_started" }));
    setState({ open, blocked: cc.error ? [] : cc.data || [], loaded: true });
  }, [idsKey, period]);
  TD_useRefresh(load, [STAFF_TOOLS_EVENT, "mgb:close-checks-changed", typeof OB_CHANGED_EVENT === "string" ? OB_CHANGED_EVENT : null]);
  return state;
}

// Admins: teammates out now or soon whose clients have no backup who can
// open them (Coverage.jsx's gap rule). Quietly empty when the RPC isn't
// there or this person can't call it.
function TD_useCoverageGaps(enabled) {
  const [state, setState] = React.useState({ gaps: [], loaded: !enabled });
  const load = React.useCallback(async () => {
    const sb = window.mgbSupabase;
    if (!enabled || !sb) {
      setState({ gaps: [], loaded: true });
      return;
    }
    const today = todayLocal();
    const res = await TD_safe(sb.rpc("coverage_overview", { p_from: today, p_to: OPS_addDays(today, TD_COVERAGE_DAYS) }));
    if (res.error || !res.data) {
      setState({ gaps: [], loaded: true });
      return;
    }
    const gaps = [];
    (res.data.time_off || []).forEach((t) =>
      (t.clients || []).forEach((c) => {
        if (["none", "none_set", "not_staff"].includes(c.backup_access)) gaps.push({ timeOff: t, client: c });
      }),
    );
    setState({ gaps, loaded: true });
  }, [enabled]);
  TD_useRefresh(load, [STAFF_TOOLS_EVENT]);
  return state;
}

// ---------------------------------------------------------------------------
// The ranked list
// ---------------------------------------------------------------------------

const TD_NONE = [];
// Staff Handbook: "Sign", "Countersign" and (the policy approver) one
// "Review" row for drafts to approve, from the shared hb_status store (HB_api.js). Quiet: no schema, no access or no module = no rows.
// enabled=false in View as: hb_status is the signed-in admin's.
function TD_useHandbookItems(enabled) {
  const can = typeof HB_useStatus === "function" && typeof HB_todayItems === "function";
  const st = can ? HB_useStatus(enabled) : null;
  const data = st && st.data;
  return React.useMemo(() => {
    if (!can || !data) return { me: null, items: TD_NONE };
    try {
      return { me: data.me || null, items: HB_todayItems(data) };
    } catch (e) {
      return { me: null, items: TD_NONE };
    }
  }, [data]);
}

// Builds the two bands. Every row: { key, kind, rank, sort, title, detail,
// onClick?, actions?: [{ label, primary?, disabled?, onClick }] }. Lower rank
// first, then lower sort (days until / most overdue first, oldest wait
// first). Ranks in "Now": 0 waiting on you (access, replies), 1 overdue,
// 2 due today, 3 reviews and handbook signatures not yet late (an overdue
// one is 1, a countersign 0), 4 upgrades. In "This week": 1 due soon, 2 clients
// at risk, 3 coverage gaps, 9 stale SOPs.
// Tasks module helpers (components/tasks/), asked at call time.
function TD_tkReady() {
  try {
    return typeof TK_api !== "undefined" && !!TK_api && typeof TK_store !== "undefined" && !!TK_store && TK_store.getState().schema === "ok";
  } catch (e) {
    return false;
  }
}
// A friendly line for a Tasks error: the TK_COPY text the Tasks pages use for
// tk_ codes, else the caller's fallback. The raw code goes to the console only.
function TD_tkErr(e, fallback) {
  const code = e && e.code ? String(e.code) : "";
  try {
    console.warn("[Today]", code || (e && e.message) || e);
  } catch (x) {}
  if (/^tk_/.test(code) && typeof TK_vErrText === "function") return TK_vErrText(e);
  return fallback;
}
function TD_toast(text) {
  try {
    window.dispatchEvent(new CustomEvent("mgb:toast", { detail: { text } }));
  } catch (e) {}
}

const TD_NO_ROWS = [];

function TD_buildRows(x) {
  const now = [];
  const week = [];
  const { clients, today, me } = x;
  const coverByTask = typeof TK_coverageByTask === "function" ? TK_coverageByTask(x.coverRows) : {};
  const coverText = (t) => {
    const lbl = coverByTask[t.id] && typeof TK_coverageLabel === "function" ? TK_coverageLabel(coverByTask[t.id], me) : null;
    return lbl && lbl.tone === "covering" ? lbl.text : "";
  };
  const byId = {};
  (clients || []).forEach((c) => (byId[c.id] = c));
  const nameOf = (id) => (byId[id] ? byId[id].name : id);
  const myClientIds = new Set(x.myClients.map((c) => c.id));
  // Deep link to the exact item (TABS-SPEC D16).
  const lk = (t, hint) => () => LK_go(t, hint);

  // Teammates asking for temporary access to a client I look after.
  (x.toApprove || []).forEach((g) => {
    const who = g.staff_name || g.staff_email;
    const busy = x.grantBusy === g.id;
    now.push({
      key: "grant-" + g.id,
      kind: "access",
      // A yes/no decision: Do next reveals this row instead of guessing.
      decide: true,
      rank: 0,
      sort: new Date(g.requested_at || 0).getTime(),
      title: `${who} wants ${nameOf(g.client_id)} for ${CS_durationLabel(g.duration_days)}`,
      detail: (g.reason ? g.reason + " · " : "") + "asked " + CS_ago(g.requested_at, x.nowMs),
      onClick: () => x.onNavigateToClient(g.client_id, "client-overview"),
      actions: [
        { label: "Deny", disabled: busy, onClick: () => x.decideGrant(g, false) },
        { label: "Approve", primary: true, disabled: busy, onClick: () => x.decideGrant(g, true) },
      ],
    });
  });

  // A client asking for portal access for someone on their side.
  (x.accessRequests || []).forEach((r) => {
    const people = Array.isArray(r.people) ? r.people.length : 0;
    const open = lk({ clientId: r.client_id, tab: "settings", sub: "client", item: "setup:access.requests" });
    now.push({
      key: "access-" + r.id,
      kind: "access",
      rank: 0,
      sort: new Date(r.submitted_at || 0).getTime(),
      title: nameOf(r.client_id),
      detail:
        `Portal access for ${people === 1 ? "1 person" : `${people} people`}` +
        (r.submitted_by_name ? `, asked by ${r.submitted_by_name}` : "") +
        (r.submitted_at ? ` on ${fmtDate(r.submitted_at.slice(0, 10))}` : ""),
      onClick: open,
      actions: [{ label: "Review", primary: true, onClick: open }],
    });
  });

  // Client messages nobody has replied to, longest wait first.
  (x.waiting || []).forEach((row) => {
    const since = relTime(row.created_at);
    now.push({
      key: "reply-" + row.id,
      kind: "reply",
      rank: 0,
      sort: new Date(row.created_at || 0).getTime(),
      title: `${row.author_name || row.participant_email} · ${nameOf(row.client_id)}`,
      detail: (since ? `Waiting since ${since}` : "Waiting on a reply") + (row.body ? ` · ${String(row.body).replace(/\s+/g, " ").slice(0, 80)}` : ""),
      onClick: lk({ clientId: row.client_id, tab: "messages", item: "msg:" + row.id }, { email: row.participant_email }),
    });
  });

  // My open tasks: overdue and due today go in "Now", the rest of the week
  // below. Done ticks the item off right here (same path as Work › Tasks).
  // With the Tasks module loaded, its My Tasks groups decide (overdue and
  // today are "Now", this week below; waiting on the client never shows) and
  // Done goes through TK_api.complete, so a task that needs review is sent
  // for review with one toast. The link stays work/tasks: LK_go hands it to
  // the task drawer when that's ready.
  if (typeof TK_groupMyTasks === "function") {
    const g = TK_groupMyTasks(
      (x.items || []).filter((t) => t.kind !== "note"),
      { today, email: me },
    );
    const complete = (t) => {
      if (typeof TK_api !== "undefined" && TK_api && typeof TK_api.complete === "function") {
        Promise.resolve(TK_api.complete(t, { isAdmin: !!x.isAdmin })).catch((e) => TD_toast(TD_tkErr(e, "Couldn't update that. Try again.")));
      } else x.toggleItem(t);
    };
    const pushTask = (band, t) => {
      const diff = daysUntil(t.due_date, today);
      // Waiting for review: no Done (it would only send it again). Admins
      // get Approve instead; everyone sees that it's in review.
      const inReview = (typeof TK_effectiveStatus === "function" ? TK_effectiveStatus(t) : t.status) === "ready_for_review";
      const actions = !inReview
        ? [{ label: "Done", onClick: () => complete(t) }]
        : x.isAdmin
          ? [{ label: "Approve", onClick: () => complete(t) }]
          : [];
      band.push({
        key: "task-" + t.id,
        kind: "task",
        taskId: t.id,
        rank: diff < 0 ? 1 : diff === 0 ? 2 : 1,
        sort: diff,
        title: t.text,
        detail: [inReview ? "In review" : "", staffItemDueLabel(t, today), t.client_id ? nameOf(t.client_id) : "", coverText(t)].filter(Boolean).join(" · "),
        onClick: lk({ place: "work", tab: "tasks", item: "task:" + t.id }),
        actions,
      });
    };
    g.overdue.forEach((t) => pushTask(now, t));
    g.today.forEach((t) => pushTask(now, t));
    g.week.forEach((t) => pushTask(week, t));
  } else {
    (x.items || []).forEach((t) => {
      if (t.done || t.kind === "note" || !t.due_date) return;
      const diff = daysUntil(t.due_date, today);
      if (diff > TD_SOON_DAYS) return;
      (diff <= 0 ? now : week).push({
        key: "task-" + t.id,
        kind: "task",
        taskId: t.id,
        rank: diff < 0 ? 1 : diff === 0 ? 2 : 1,
        sort: diff,
        title: t.text,
        detail: [staffItemDueLabel(t, today), t.client_id ? nameOf(t.client_id) : ""].filter(Boolean).join(" · "),
        onClick: lk({ place: "work", tab: "tasks", item: "task:" + t.id }),
        actions: [{ label: "Done", onClick: () => x.toggleItem(t) }],
      });
    });
  }

  // Filing deadlines for my clients (Deadlines.jsx): overdue, or due within
  // the week. Filed ones are already out.
  (x.deadlines || []).forEach((it) => {
    const diff = daysUntil(it.due, today);
    const overdue = it.state === "overdue";
    (overdue ? now : week).push({
      key: "dl-" + it.id,
      kind: "deadline",
      rank: 1,
      sort: diff,
      title: it.rule_name + (it.period_label ? " · " + it.period_label : ""),
      detail: `${it.client_name} · ${overdue ? `${-diff} day${diff === -1 ? "" : "s"} overdue` : diff === 0 ? "due today" : `due ${fmtDate(it.due)}`} · verify the date before filing`,
      onClick: lk({ place: "work", tab: "deadlines", item: "deadline:" + it.id }),
    });
  });

  // Last month's close blocked in QuickBooks (close_checks).
  (x.blocked || []).forEach((row) => {
    if (!myClientIds.has(row.client_id)) return;
    now.push({
      key: "close-" + row.client_id + "-" + row.period,
      kind: "close",
      rank: 1,
      sort: 0,
      title: `${nameOf(row.client_id)} · ${TD_monthName(row.period)} close is blocked`,
      detail: Array.isArray(row.reasons) && row.reasons.length ? String(row.reasons[0]) : "Something in QuickBooks needs fixing before the month can close",
      onClick: lk({ clientId: row.client_id, tab: "close", item: "at:close-qbo" }),
    });
  });

  // Open bills, grouped per client so ten bills are one row.
  const billGroups = {};
  (clients || []).forEach((c) => {
    (c.payables || []).forEach((p) => {
      const diff = daysUntil(p.dueDate, today);
      if (diff > TD_SOON_DAYS) return; // scheduled: nothing to do yet
      const status = diff < 0 ? "overdue" : "soon";
      const k = c.id + ":" + status;
      const g = billGroups[k] || (billGroups[k] = { clientId: c.id, clientName: c.name, status, n: 0, total: 0, first: diff });
      g.n++;
      g.total += Number(p.amount) || 0;
      g.first = Math.min(g.first, diff);
    });
  });
  Object.values(billGroups).forEach((g) => {
    const overdue = g.status === "overdue";
    (overdue ? now : week).push({
      key: "bill-" + g.clientId + g.status,
      kind: "bill",
      rank: 1,
      sort: g.first,
      title: g.clientName,
      detail:
        `${g.n} bill${g.n === 1 ? "" : "s"} ${overdue ? "overdue" : "due soon"} · ` +
        `${fmtMoney(g.total, { cents: true })} · ${overdue ? "oldest " : "next "}${apDueText(g.first).toLowerCase()}`,
      // Basic has no Cash flow tab; the row is admin-only, so Billing and time is on the Overview.
      onClick:
        byId[g.clientId] && isBasicPlan(byId[g.clientId])
          ? lk({ clientId: g.clientId, tab: "overview", item: "at:ov-billing" })
          : lk({ clientId: g.clientId, tab: "receivables" }),
    });
  });

  // Quarterly review things I owe (TeamReviews.jsx).
  const ov = x.reviews;
  if (ov && typeof TR_dueCount === "function" && TR_dueCount(ov) > 0) {
    const dueYmd = String(ov.due.due_at).slice(0, 10);
    const diff = daysUntil(dueYmd, today);
    const labels = (ov.due.items || []).map((i) => i.label).join(" · ");
    (diff <= 0 ? now : week).push({
      key: "review-" + dueYmd,
      kind: "review",
      rank: diff <= 0 ? 3 : 1,
      sort: diff,
      title: `Review due ${TR_fmtDate(ov.due.due_at)}` + (diff < 0 ? " (past due)" : diff === 0 ? " (today)" : ""),
      detail: (ov.cycle && ov.cycle.label ? ov.cycle.label + ": " : "") + (labels || "your part of this quarter's review"),
      onClick: () => NAV_go("hr", "reviews"),
      actions: [{ label: "Open", primary: diff <= 0, onClick: () => NAV_go("hr", "reviews") }],
    });
  }

  // Staff Handbook: sign (bookkeepers), countersign (the countersigner) and
  // one "N handbook policies need your approval" row (the policy approver;
  // slug "approvals" opens the Needs your approval panel).
  (x.handbook || []).forEach((h) => {
    const open = lk({ place: "hr", tab: "handbook", item: "handbook:" + h.slug });
    now.push({
      key: h.key,
      kind: "handbook",
      rank: h.kind === "countersign" ? 0 : h.overdue ? 1 : 3,
      sort: h.due ? daysUntil(h.due, today) : 0,
      title: h.title,
      detail: h.detail,
      onClick: open,
      actions: [{ label: h.kind === "countersign" ? "Countersign" : h.kind === "approve" ? "Review" : "Sign", primary: true, onClick: open }],
    });
  });

  // Admins: profile photos waiting for a background edit (HR › Members).
  if (x.photosItem) {
    const p = x.photosItem;
    const openPhotos = () => {
      try {
        sessionStorage.setItem("mgb-photo-open", "needs-edit");
      } catch (e) {}
      NAV_go("hr", "members");
    };
    now.push({
      key: p.key,
      kind: "photos",
      rank: 3,
      sort: 0,
      title: p.title,
      detail: p.detail,
      onClick: openPhotos,
      actions: [{ label: "Open", primary: true, onClick: openPhotos }],
    });
  }

  // Clients asking to move up a plan.
  (x.upgrades || []).forEach((r) => {
    const c = byId[r.client_id];
    const busy = x.upgradeBusyId === r.id;
    now.push({
      key: "upgrade-" + r.id,
      kind: "upgrade",
      rank: 4,
      sort: new Date(r.created_at || 0).getTime(),
      title: c ? c.name : r.client_id,
      detail:
        "Wants " +
        (r.requested_plan === "payroll" ? "the Payroll add-on" : r.requested_plan ? planLabel(r.requested_plan) : "to upgrade") +
        (c ? ` (on ${planLabel(c.plan)})` : "") +
        ` · asked by ${r.requested_by || "unknown"} ${fmtDateTime(r.created_at)}`,
      onClick: lk({ clientId: r.client_id, tab: "settings", sub: "plan" }),
      actions: [
        { label: "Contacted", disabled: busy, onClick: () => x.setUpgradeStatus(r, "contacted") },
        { label: "Completed", disabled: busy, onClick: () => x.setUpgradeStatus(r, "completed") },
        { label: "Dismiss", disabled: busy, onClick: () => x.setUpgradeStatus(r, "dismissed") },
      ],
    });
  });

  // Clients whose health score is At risk (red) or Watch (amber), worst first.
  if (x.health) {
    (clients || []).forEach((c) => {
      const h = x.health[c.id];
      if (!h || h.band === "green") return;
      const reasons = (h.reasons || [])
        .slice()
        .sort((a, b) => b.points - a.points)
        .slice(0, 2)
        .map((r) => r.label)
        .join(" · ");
      week.push({
        key: "risk-" + c.id,
        kind: "risk",
        rank: 2,
        sort: (HLB_BAND_ORDER[h.band] || 0) * 1000 + (Number(h.score) || 0),
        title: `${c.name || c.id} · ${HL_LABEL[h.band] || h.band} (${h.score})`,
        detail: reasons || "Health score below the healthy line",
        onClick: lk({ clientId: c.id, tab: "overview", item: "at:ov-why" }),
      });
    });
  }

  // Admins: a teammate is out and a client of theirs has no backup who can
  // open it.
  (x.coverageGaps || []).forEach(({ timeOff: t, client: c }) => {
    const out = t.starts_on <= today ? `is out until ${fmtDate(t.ends_on)}` : `is out ${fmtDate(t.starts_on)} to ${fmtDate(t.ends_on)}`;
    week.push({
      key: "cov-" + t.id + "-" + c.client_id,
      kind: "coverage",
      rank: 3,
      sort: daysUntil(t.starts_on, today),
      title: c.client_name || nameOf(c.client_id),
      detail:
        `${t.staff_name || t.staff_email} ${out} · ` +
        (c.backup_access === "none_set" ? "no backup bookkeeper set" : c.backup_access === "not_staff" ? "the backup isn't an active staff member" : `${c.backup_name || c.backup_email || "the backup"} can't open this client yet`),
      onClick: () => NAV_go("team", "people"),
    });
  });

  // SOPs not edited or marked accurate in 180 days (SopFreshness.jsx).
  (x.staleSops || []).forEach((r) => week.push({ ...r, kind: "sop", rank: 9 }));

  // Birthdays and work anniversaries within 30 days (admins only; the rows
  // are empty for everyone else), so there is time to send a gift. The first
  // 7 days behave as before: today's sit in "now", the rest in "this week",
  // ranked at the top. Days 8-30 are "far": ranked low and never Do next.
  // "Gift sent" or "Dismiss" hides one. Pure rules: celebrationLead.js.
  if (!x.isAdmin) {
    // Everyone else: coworkers' birthdays and anniversaries in the next 7
    // days, each with "Give a shout out" (hidden in View as, which is
    // read-only). Always in "this week", never Do next. Your own day shows
    // with no action. No gift marks, no birth year, no age.
    CEL_peerItems(x.celebrations || [], x.today, x.me).forEach((it) => {
      week.push({
        key: it.key,
        kind: "celebrate",
        rank: 8,
        far: true,
        sort: it.days,
        title: it.title,
        detail: it.detail,
        onClick: it.shout && !x.readOnly ? () => x.openShoutout(it.email) : undefined,
        actions: it.shout && !x.readOnly ? [{ label: "Give a shout out", primary: true, onClick: () => x.openShoutout(it.email) }] : [],
      });
    });
  }
  (x.isAdmin ? CEL_items(x.celebrations || [], x.today) : []).forEach((it) => {
    const r = it.row;
    const kind = it.kind;
    (it.days === 0 ? now : week).push({
      key: it.key,
      kind: "celebrate",
      rank: it.near ? 0 : 8,
      far: !it.near,
      sort: it.days,
      title: it.title,
      detail: it.detail,
      onClick: () => x.openShoutout(r.email),
      actions: [
        { label: "Send shout-out", primary: true, onClick: () => x.openShoutout(r.email) },
        { label: "Gift sent", onClick: () => x.celebrate(r, kind, "gift") },
        { label: "Dismiss", onClick: () => x.celebrate(r, kind, "dismissed") },
      ],
    });
  });

  // My own profile is missing its birthday or start date. Stays until done.
  if (x.profileIncomplete) {
    now.push({
      key: "profile",
      kind: "profile",
      rank: 10,
      sort: 0,
      title: "Complete your profile",
      detail: "Add your birthday and start date so the team can celebrate with you.",
      onClick: x.goProfile,
      actions: [{ label: "Open my profile", primary: true, onClick: x.goProfile }],
    });
  }

  const order = (a, b) => a.rank - b.rank || a.sort - b.sort;
  return { now: now.sort(order), week: week.sort(order) };
}

function TD_KindIcon({ kind }) {
  const p = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" };
  switch (kind) {
    case "reply":
      return (
        <svg {...p}>
          <path d="M4 5h16v11H8l-4 4V5z" />
          <path d="M8 10h8M8 13h5" />
        </svg>
      );
    case "celebrate":
      return (
        <svg {...p}>
          <rect x="3" y="10" width="18" height="11" rx="1.5" />
          <path d="M12 10v11M3 14.5h18" />
          <path d="M12 10c-1.2-3.2-5.2-4.2-5.2-1.6S10.2 10 12 10zm0 0c1.2-3.2 5.2-4.2 5.2-1.6S13.8 10 12 10z" />
        </svg>
      );
    case "profile":
      return (
        <svg {...p}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 3.5-6.5 8-6.5s8 2.5 8 6.5" />
        </svg>
      );
    case "task":
      return (
        <svg {...p}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
          <path d="M8 12.5l2.5 2.5L16 9.5" />
        </svg>
      );
    case "deadline":
      return (
        <svg {...p}>
          <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
          <path d="M3.5 10h17M8 3v4M16 3v4M8 14h3M8 17h6" />
        </svg>
      );
    case "close":
      return (
        <svg {...p}>
          <path d="M5 4h14v16H5z" />
          <path d="M9 8h6M9 12h6M9 16h3" />
        </svg>
      );
    case "bill":
      return (
        <svg {...p}>
          <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" />
          <path d="M9 8h6M9 12h6" />
        </svg>
      );
    case "review":
      return (
        <svg {...p}>
          <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.9L12 3.5z" />
        </svg>
      );
    case "handbook":
      return (
        <svg {...p}>
          <path d="M6 3h9l3 3v15H6V3z" />
          <path d="M9 9h6M9 12h6" />
          <path d="M9 17.5c1-1.6 1.8-1.6 2.4 0s1.4 1.6 2.6-.5" />
        </svg>
      );
    case "photos":
      return (
        <svg {...p}>
          <circle cx="12" cy="9" r="3.5" />
          <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
        </svg>
      );
    case "upgrade":
      return (
        <svg {...p}>
          <path d="M12 19V5" />
          <path d="M6 11l6-6 6 6" />
        </svg>
      );
    case "risk":
      return (
        <svg {...p}>
          <path d="M3 12h4l2-5 3 10 2-7 2 2h5" />
        </svg>
      );
    case "coverage":
      return (
        <svg {...p}>
          <path d="M3 13a9 9 0 0 1 18 0H3z" />
          <path d="M12 13v5a2 2 0 0 0 4 0" />
        </svg>
      );
    case "sop":
      return (
        <svg {...p}>
          <path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4V4z" />
          <path d="M20 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8V4z" />
        </svg>
      );
    case "access":
    default:
      return (
        <svg {...p}>
          <circle cx="8" cy="12" r="4" />
          <path d="M12 12h9M18 12v3M15 12v2" />
        </svg>
      );
  }
}

// One band of the list ("Now" / "This week"). Nothing in it: renders nothing.
function TD_Band({ tone, title, rows, expanded }) {
  if (!rows.length) return null;
  const shown = expanded ? rows : rows.slice(0, TD_ROW_LIMIT);
  const id = "td-band-" + tone;
  return (
    <section className={"td-band td-band-" + tone} id={id} aria-labelledby={id + "-h"}>
      <h3 className="td-band-heading" id={id + "-h"}>
        <span className="td-band-dot" aria-hidden="true" />
        {title}
        <span className="td-band-count">{rows.length}</span>
      </h3>
      <ul className="td-rows">
        {shown.map((r) => {
          const kindLabel = TD_KIND_LABEL[r.kind] || r.kind;
          const body = (
            <>
              <span className="td-row-kind">
                <TD_KindIcon kind={r.kind} />
                <span>{kindLabel}</span>
              </span>
              <span className="td-row-text">
                <span className="td-row-title">{r.title}</span>
                {r.detail && <span className="td-row-detail">{r.detail}</span>}
              </span>
            </>
          );
          return (
            <li className={"td-row" + (r.actions && r.actions.length > 1 ? " td-row-stack" : "")} key={r.key} data-td-key={r.key} tabIndex={-1}>
              {r.onClick ? (
                <button type="button" className="td-row-main" onClick={r.onClick}>
                  {body}
                </button>
              ) : (
                <span className="td-row-main">{body}</span>
              )}
              {r.actions && r.actions.length > 0 && (
                <span className="td-row-actions">
                  {r.actions.map((a) => (
                    <button key={a.label} type="button" className={a.primary ? "btn-primary" : "btn-secondary"} disabled={a.disabled} title={a.title} onClick={a.onClick}>
                      {a.label}
                    </button>
                  ))}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Optional cards
// ---------------------------------------------------------------------------

// Your reminders: the same staff_reminders rows as Work › Tasks, just the
// quick add-and-tick view. Private to you and admins unless shared.
function TD_RemindersCard({ me, items, error, onAdd, onToggle, onRemove, today, readOnly }) {
  const roTitle = readOnly ? "Read-only in View as" : undefined;
  const [text, setText] = React.useState("");
  const [date, setDate] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const sorted = React.useMemo(
    () =>
      (items || [])
        .filter((r) => r.kind !== "note")
        .slice()
        .sort((a, b) => {
          if (a.done !== b.done) return a.done ? 1 : -1;
          if (!!a.due_date !== !!b.due_date) return a.due_date ? -1 : 1;
          if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
          return (a.due_at || "") < (b.due_at || "") ? -1 : 1;
        }),
    [items],
  );
  const add = async () => {
    const t = text.trim();
    if (!t || adding) return;
    setAdding(true);
    const ok = await onAdd({ text: t, due_date: date || null });
    setAdding(false);
    if (ok) {
      setText("");
      setDate("");
    }
  };
  return (
    <section className="card td-card" aria-labelledby="td-reminders-title">
      <h3 className="card-title" id="td-reminders-title">
        Your reminders
      </h3>
      <p className="card-subtitle">
        Private to you and admins. For times, repeats and sharing, open{" "}
        <button type="button" className="td-link" onClick={() => NAV_go("work", "tasks")}>
          Work › Slate
        </button>
        .
      </p>
      <div className="staff-add-row">
        <input
          type="text"
          aria-label="New reminder"
          placeholder="Follow up with Grace Community about..."
          value={text}
          disabled={readOnly}
          title={roTitle}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !readOnly) add();
          }}
        />
        <input type="date" aria-label="Due date" value={date} disabled={readOnly} title={roTitle} onChange={(e) => setDate(e.target.value)} />
        <button type="button" className="btn-primary" disabled={readOnly || adding || !text.trim()} title={roTitle} onClick={add}>
          + Add
        </button>
      </div>
      {error && <p className="card-subtitle negative td-card-note">{error}</p>}
      {items === null && !error && <p className="card-subtitle td-card-note">Loading…</p>}
      {items && sorted.length === 0 && !error && <p className="card-subtitle td-card-note">No reminders yet.</p>}
      {sorted.length > 0 && (
        <div className="td-card-scroll">
        <ul className="staff-audit-list td-reminders-scroll">
          {sorted.map((r) => (
            <li className="staff-audit-row" key={r.id}>
              <label className="staff-active-toggle td-reminder">
                <input type="checkbox" checked={!!r.done} disabled={readOnly} title={roTitle} onChange={() => onToggle(r)} />
                <span className={r.done ? "td-reminder-done" : ""}>
                  {r.text}
                  {r.due_date && !r.done ? (
                    <span className={"task-due" + (r.due_date < today ? " overdue" : "")}>
                      {" — "}
                      {staffItemDueLabel(r, today)}
                    </span>
                  ) : (
                    ""
                  )}
                </span>
              </label>
              <button type="button" className="row-remove-btn" disabled={readOnly} title={roTitle} onClick={() => onRemove(r)} aria-label={`Remove reminder: ${r.text}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
        </div>
      )}
    </section>
  );
}

// View as: the same rows with every action disabled and titled read-only.
function TD_readOnlyRows(rows) {
  const lock = (r) =>
    r && r.actions && r.actions.length
      ? Object.assign({}, r, { actions: r.actions.map((a) => Object.assign({}, a, { disabled: true, title: "Read-only in View as" })) })
      : r;
  return { now: (rows.now || []).map(lock), week: (rows.week || []).map(lock) };
}
function TD_firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "Their";
}

// "This week": birthdays and anniversaries coming up (the celebration rows
// Today already builds, admins) above the milestones to review.
function TD_MilestonesCard({ clients, onOpenClientMilestone, celebrations }) {
  const [count, setCount] = React.useState(0);
  const cel = celebrations || TD_NONE;
  return (
    <section className={"card td-card" + (count > 0 || cel.length > 0 ? " td-card-week" : "")} aria-labelledby="td-milestones-title" data-tour="today-week">
      <h3 className="card-title" id="td-milestones-title">
        This week
      </h3>
      <p className="card-subtitle">Birthdays and anniversaries (the next 7 days; admins see the next 30, so there is time to send a gift), and milestones to review: numbers pointing to a different milestone, not confirmed yet, or close to the next one.</p>
      <div className="td-card-scroll">
      {cel.length > 0 && (
        <ul className="td-mini-list">
          {cel.slice(0, TD_CEL_CARD_ROWS).map((r) => (
            <li key={r.key}>
              <button type="button" className="td-mini-row" onClick={r.onClick}>
                <span className="td-mini-title">{r.title}</span>
                <span className="td-mini-sub">{r.detail}</span>
              </button>
              {(r.actions || []).filter((a) => !a.primary).length > 0 && (
                <div className="td-mini-actions">
                  {r.actions.filter((a) => !a.primary).map((a) => (
                    <button type="button" className="link-btn" key={a.label} onClick={a.onClick}>
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {typeof MilestonesReviewList === "function" ? (
        <MilestonesReviewList clients={clients} onCount={setCount} onOpenClient={(id) => onOpenClientMilestone && onOpenClientMilestone(id)} />
      ) : (
        <p className="card-subtitle td-card-note">Milestones aren't available right now.</p>
      )}
      </div>
    </section>
  );
}

// Per-browser visit history (recordClientVisit in app.jsx): whatever this
// browser last recorded, read once on mount. One line of chips.
function TD_RecentCard({ clients }) {
  const visits = React.useMemo(() => (typeof loadClientVisits === "function" ? loadClientVisits() : {}), []);
  const recent = React.useMemo(
    () =>
      (clients || [])
        .filter((c) => visits[c.id])
        .sort((a, b) => visits[b.id] - visits[a.id])
        .slice(0, 5),
    [clients, visits],
  );
  if (recent.length === 0) return null;
  return (
    <section className="td-recent" aria-labelledby="td-recent-title">
      <h3 className="td-recent-label" id="td-recent-title">
        Recent clients
      </h3>
      <div className="td-recent-chips">
        {recent.map((c) => (
          <button type="button" className="td-recent-chip" key={c.id} title={"Opened " + fmtDateTime(new Date(visits[c.id]).toISOString())} onClick={() => LK_go({ clientId: c.id })}>
            {c.name}
          </button>
        ))}
      </div>
    </section>
  );
}

// What Do next's button says and does for one of Today's rows, so the label
// always matches the action. Tasks open in the task drawer. A yes/no row
// (a teammate's access request) is never decided from here: "Review" opens
// Also needs you on that row, where Approve and Deny sit side by side.
function TD_doNext(r) {
  if (!r) return null;
  if (r.taskId != null && typeof TK_openTask === "function") return { label: "Open", run: () => TK_openTask(String(r.taskId), { from: "today" }) };
  if (r.decide) return { label: "Review", run: () => window.dispatchEvent(new CustomEvent("td:reveal", { detail: { key: r.key } })) };
  const primary = (r.actions || []).find((a) => a.primary && !a.disabled);
  if (primary) return { label: primary.label, run: primary.onClick };
  if (r.onClick) return { label: r.kind === "reply" ? "Reply" : "Open", run: r.onClick };
  const first = (r.actions || []).find((a) => !a.disabled);
  return first ? { label: first.label, run: first.onClick } : null;
}

// "Do next": the single top item from the ranked list (Today's own order, or
// the Desk's when it's on), the one after it, and the button that opens it.
// Slate and the Desk own the full lists (desk-right-spec decision 28).
// more: how many more, moreText: what they are ("tasks in"), onDesk: set on
// the Desk path (the rest live in the Desk; the wb-more tip points here).
function TD_DoNextCard({ loading, top, next, more, moreText, onDesk, onOpen, onHelp, error, onRetry, offline, updated }) {
  return (
    <section className="card td-next" id="td-list" data-tour="today-list" aria-labelledby="td-next-title">
      <div className="td-next-head">
        <h2 className="td-next-label" id="td-next-title">
          Do next
        </h2>
        <span className="td-next-tools">
          {offline && <span className="wb-offline">Offline</span>}
          {updated ? <span className="wb-updated">{updated}</span> : null}
          {onHelp && (
            <button type="button" className="wb-icon-btn" aria-label="Today help and shortcuts" title="Help and shortcuts" onClick={onHelp}>
              ?
            </button>
          )}
        </span>
      </div>
      {error && (
        <div className="wb-error" role="alert">
          <span>{error}</span>
          {onRetry && (
            <button type="button" className="btn-secondary" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      )}
      {loading ? (
        <p className="card-subtitle td-loading" role="status">
          Looking for what's next…
        </p>
      ) : top ? (
        <>
          <div className="td-next-body">
            <div className="td-next-main">
              <p className="td-next-title">{top.title}</p>
              {top.meta && <p className="td-next-meta">{top.meta}</p>}
              {next && <p className="td-next-then">then: {next}</p>}
            </div>
            <button type="button" className="btn-primary td-next-btn" onClick={onOpen} {...(onDesk ? { "data-tour": "wb-row-action" } : {})}>
              {top.label || "Open"}
            </button>
          </div>
          <p className="td-next-more">
            {more > 0 && onDesk ? (
              <>
                {more} more in your{" "}
                <button type="button" className="wb-linkish" onClick={onDesk}>
                  Desk
                </button>{" "}
                · <a href="#/tasks">Slate</a>
              </>
            ) : more > 0 ? (
              <>
                {more} more {moreText || "in"} <a href="#/tasks">Slate</a>
              </>
            ) : (
              <>
                That's all. <a href="#/tasks">Slate</a>
              </>
            )}
          </p>
        </>
      ) : (
        <div className="td-empty" role="status">
          <span className="td-empty-mark" aria-hidden="true">
            ✓
          </span>
          <span className="td-empty-text">
            <strong>Clean slate. Nothing needs you right now.</strong>
            <span>
              New messages, tasks and deadlines show up here as they come in. <a href="#/tasks">Slate</a> · <a href="#/inbox">Messages</a>
            </span>
          </span>
        </div>
      )}
    </section>
  );
}

// "N due today · N late · Open Slate": the compact line under the greeting.
function TD_SummaryLine({ due, late, ready }) {
  return (
    <p className="td-summary" data-tour="today-kpis">
      <span>{ready ? due : "…"} due today</span>
      <span className="td-sep" aria-hidden="true">
        ·
      </span>
      <span className={ready && late > 0 ? "td-summary-late" : ""}>{ready ? late : "…"} late</span>
      <span className="td-sep" aria-hidden="true">
        ·
      </span>
      <a href="#/tasks">Open Slate</a>
    </p>
  );
}

// A card of up to four lines: { key, title, chips: [{tone, text}], onClick }.
function TD_ListCard({ id, title, subtitle, lines, extra, emptyText, loaded, tour }) {
  const [showAll, setShowAll] = React.useState(false);
  const shown = showAll ? lines : lines.slice(0, TD_CARD_ROWS);
  return (
    <section className="card td-card" aria-labelledby={id} {...(tour ? { "data-tour": tour } : {})}>
      <h3 className="card-title" id={id}>
        {title}
      </h3>
      <p className="card-subtitle">{subtitle}</p>
      <div className="td-card-scroll">
      {!loaded && lines.length === 0 && <p className="card-subtitle td-card-note">Loading…</p>}
      {loaded && lines.length === 0 && <p className="card-subtitle td-card-note td-card-ok">{emptyText}</p>}
      {lines.length > 0 && (
        <ul className="td-mini-list">
          {shown.map((l) => (
            <li key={l.key}>
              <button type="button" className="td-mini-row" onClick={l.onClick} {...(l.tour ? { "data-tour": l.tour } : {})}>
                <span className="td-mini-title">{l.title}</span>
                <span className="td-mini-chips">
                  {l.chips.map((c) => (
                    <span key={c.text} className={"td-reason td-reason-" + c.tone}>
                      {c.text}
                    </span>
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {lines.length > TD_CARD_ROWS && (
        <button type="button" className="td-link td-card-note td-more" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show fewer" : "+" + (lines.length - TD_CARD_ROWS) + " more"}
        </button>
      )}
      </div>
      {extra}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
// Upcoming birthdays and work anniversaries for admins (rpc
// staff_celebrations) plus the "gift sent" / "dismiss" actions that clear
// an occurrence. Rows re-fetch after each action.
function TD_useCelebrations(admin, today) {
  // Admins act on the month ahead; everyone else gets the 7-day heads-up.
  const [rows, setRows] = React.useState([]);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const sb = window.mgbSupabase;
    if (!sb || typeof sb.rpc !== "function") return;
    let alive = true;
    sb.rpc("staff_celebrations").then(({ data, error }) => {
      let rows = Array.isArray(data) ? data : [];
      // View as: no full birthday (with the year), as a bookkeeper's call.
      if (typeof MGB_viewAsReadOnly === "function" && MGB_viewAsReadOnly()) rows = rows.map((r) => Object.assign({}, r, { birthday: null }));
      if (alive && !error) setRows(rows);
    });
    return () => {
      alive = false;
    };
  }, [admin, today, tick]);
  const act = React.useCallback(async (row, kind, action, byEmail) => {
    const sb = window.mgbSupabase;
    if (!sb) return { message: "Not connected" };
    const occurs_on = kind === "birthday" ? row.next_birthday : row.next_anniversary;
    const { error } = await sb
      .from("staff_celebration_actions")
      .upsert({ staff_email: row.email, kind, occurs_on, action, by_email: byEmail }, { onConflict: "staff_email,kind,occurs_on" });
    if (!error) setTick((t) => t + 1);
    return error;
  }, []);
  return { rows, act };
}

function TD_TodayPage({ staffUser, clients, onNavigateToClient, onOpenClientMilestone, isAdmin, impersonating, deskOn }) {
  const showToast = useToast();
  // Workbench (components/workbench/): when it's on, its list and tiles take
  // the place of "Needs you" and the old tiles. Off, or while viewing as
  // someone, Today is unchanged.
  const wbSwitch = typeof WB_useSwitch === "function" ? WB_useSwitch() : false;
  const wbOn = !!wbSwitch && !impersonating && typeof WB_Page === "function";
  // Classic Today chosen in this browser (WB_HelpSheet or Dev Tools): offer
  // the way back to the Workbench.
  const wbClassic = (() => {
    try {
      return !impersonating && typeof WB_Page === "function" && window.localStorage.getItem("mgb_wb_classic") === "1";
    } catch (e) {
      return false;
    }
  })();
  const me = TD_lc(staffUser && staffUser.email);
  const admin = !!(isAdmin || (staffUser && staffUser.role === "admin"));
  const today = todayLocal();
  // View as (docs/view-as-full-app-spec.md): read-only, and nothing here may
  // answer for the signed-in admin's own session.
  const ro = !!impersonating || (typeof MGB_viewAsReadOnly === "function" && MGB_viewAsReadOnly());
  // Totals and "my clients" lists count real clients only: no test clients, no
  // MGB (internal). The Recent card keeps the wider list so a test client you
  // opened still shows up there.
  const openableClients = React.useMemo(() => clients || [], [clients]);
  const allClients = React.useMemo(() => (typeof window.mgbRealClients === "function" ? window.mgbRealClients(openableClients) : openableClients), [clients]);
  // Ids of test / internal clients: anything tied to one of them stays out of
  // the Today list and its counts (rows keyed by client_id).
  // From the whole roster (CF_excludedIds), not just this list: the list
  // never holds MGB (internal) and drops test clients while "Show test
  // clients" is off, but their rows must stay out of the counts either way.
  const hiddenIds = React.useMemo(() => {
    const real = new Set(allClients.map((c) => c.id));
    const out = typeof CF_excludedIds === "function" ? CF_excludedIds() : new Set();
    openableClients.forEach((c) => {
      if (c && !real.has(c.id)) out.add(c.id);
    });
    return out;
  }, [openableClients, allClients]);
  const notHidden = (r) => !r || !r.client_id || !hiddenIds.has(r.client_id);
  const myClients = React.useMemo(() => TD_myClients(allClients, me, admin), [allClients, me, admin]);
  const myClientIds = React.useMemo(() => myClients.map((c) => c.id), [myClients]);

  // Data. Shared stores first (one fetch for the whole app), then this
  // page's own.
  const waiting = TD_useWaitingThreads(me, allClients);
  const mine = TD_useMyItems(me);
  const access = TD_useAccessRequests();
  const upgrades = TD_useUpgradeRequests(showToast);
  const closes = TD_useCloses(myClientIds);
  const coverage = TD_useCoverageGaps(admin);
  const grants = typeof CS_useAccessGrants === "function" ? CS_useAccessGrants() : null;
  const dl = typeof DL_useStore === "function" ? DL_useStore(true) : null;
  const reviews = typeof TR_useOverview === "function" ? TR_useOverview(!ro) : null;
  const handbook = TD_useHandbookItems(!ro);
  const health = typeof HL_useHealth === "function" ? HL_useHealth() : null;
  const sopStatus = typeof SF_useSopStatus === "function" ? SF_useSopStatus(true) : null;
  const st = typeof ST_useSettings === "function" ? ST_useSettings() : null;
  // Celebrations to act on (admins) and whether my own profile still needs
  // its birthday and start date (everyone; stays on the list until done).
  const cel = TD_useCelebrations(admin, today);
  // View as: no profile load and no "finish your profile" prompt (its Save is
  // a write and its seen-key is per person).
  const myProfile = typeof ST_useMyProfile === "function" ? ST_useMyProfile(ro ? null : me) : null;
  const profileIncomplete = !!(myProfile && myProfile.loaded && !(myProfile.row && myProfile.row.birthday && myProfile.row.start_date));
  // First sign-in: one welcome prompt per browser, then the Today item
  // carries the reminder until both dates are filled in.
  const promptKey = "mgb-profile-prompt:" + me;
  const [profilePrompt, setProfilePrompt] = React.useState(false);
  // The profile photo gate (#pg-gate) comes first. Wait for the photo status to
  // load, then hold the prompt until the gate is gone (it unmounts a beat after
  // the photo is saved, so re-check on the change event and on a short timer).
  const photoMine = typeof SP_useMyStatus === "function" ? SP_useMyStatus(ro ? null : me) : null;
  const photoReady = !photoMine || photoMine.loaded || !!photoMine.error;
  React.useEffect(() => {
    if (ro || !profileIncomplete || !me || !photoReady) return undefined;
    let seen = false;
    try {
      seen = !!localStorage.getItem(promptKey);
    } catch (e) {}
    if (seen) return undefined;
    let timer = null;
    let cancelled = false;
    const tryOpen = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.getElementById("pg-gate")) {
        timer = setTimeout(tryOpen, 600);
        return;
      }
      setProfilePrompt(true);
    };
    const onChanged = () => {
      clearTimeout(timer);
      timer = setTimeout(tryOpen, 300);
    };
    window.addEventListener("sp:changed", onChanged);
    timer = setTimeout(tryOpen, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("sp:changed", onChanged);
    };
  }, [profileIncomplete, me, photoReady, ro]);
  const dismissProfilePrompt = () => {
    setProfilePrompt(false);
    if (ro) return;
    try {
      localStorage.setItem(promptKey, "1");
    } catch (e) {}
  };

  const [moreOpen, setMoreOpen] = React.useState(false);
  const [grantBusy, setGrantBusy] = React.useState(null);
  const [grantError, setGrantError] = React.useState("");

  // Item actions share Work › Tasks' write path, so a tick here rolls a
  // recurring item forward and every view refreshes through
  // STAFF_ITEMS_CHANGED_EVENT.
  const sb = window.mgbSupabase;
  // With the Tasks module loaded these go through TK_api (complete knows the
  // review gate and falls back to the old toggle by itself; add and remove
  // wait for the Tasks tables). The old staffItemsApi path stays the else.
  const toggleItem = React.useCallback(
    async (item) => {
      if (!sb || ro) return;
      if (typeof TK_api !== "undefined" && TK_api && typeof TK_api.complete === "function" && typeof TK_isOpen === "function") {
        try {
          await TK_api.complete(item, { done: TK_isOpen(item), isAdmin: admin });
        } catch (e) {
          showToast(TD_tkErr(e, "Couldn't update that. Try again."));
        }
        return;
      }
      const { error } = await staffItemsApi.toggleDone(sb, me, item);
      if (error) showToast(`Couldn't update that: ${error.message}`);
    },
    [sb, me, showToast, admin, ro],
  );
  const addItem = React.useCallback(
    async (item) => {
      if (!sb || ro) return false;
      if (TD_tkReady()) {
        try {
          await TK_api.create({ text: item.text, due_date: item.due_date || null, kind: "reminder" });
          return true;
        } catch (e) {
          showToast(TD_tkErr(e, "Couldn't add that reminder. Try again."));
          return false;
        }
      }
      const { error } = await staffItemsApi.add(sb, me, item);
      if (error) {
        showToast(`Couldn't add reminder: ${error.message}`);
        return false;
      }
      return true;
    },
    [sb, me, showToast, ro],
  );
  const removeItem = React.useCallback(
    async (item) => {
      if (!sb || ro) return;
      if (TD_tkReady()) {
        try {
          await TK_api.remove(item.id);
        } catch (e) {
          showToast(TD_tkErr(e, "Couldn't remove that reminder. Try again."));
        }
        return;
      }
      const { error } = await staffItemsApi.remove(sb, item.id);
      if (error) showToast(`Couldn't remove reminder: ${error.message}`);
    },
    [sb, me, showToast, ro],
  );
  const decideGrant = React.useCallback(
    async (g, approve) => {
      setGrantBusy(g.id);
      setGrantError("");
      try {
        await CS_actions.decide(g.id, approve);
        showToast(approve ? `${g.staff_name || g.staff_email} now has access to ${CS_clientName(g.client_id)}` : "Request denied");
      } catch (err) {
        setGrantError(typeof CS_friendlyError === "function" ? CS_friendlyError(err) : "Couldn't save that. Try again.");
      } finally {
        setGrantBusy(null);
      }
    },
    [showToast],
  );

  // Deadlines: my clients, anything unfiled from the last 6 months through
  // the coming week.
  const deadlines = React.useMemo(() => {
    if (!dl || dl.loading || typeof DL_items !== "function") return [];
    return DL_items(dl, myClients, OPS_addDays(today, -180), OPS_addDays(today, TD_SOON_DAYS)).filter((it) => it.state !== "filed");
  }, [dl, myClients, today]);
  // Stale SOPs across every client I can see.
  const staleSops = React.useMemo(
    () => (typeof SF_staleTodos === "function" ? SF_staleTodos(allClients, sopStatus, today, (id) => onNavigateToClient(id, "sop")) : []),
    [allClients, sopStatus, today, onNavigateToClient],
  );
  // Hide reviews while an admin is in "View as" (the overview is theirs,
  // the page being shown is someone else's).
  const reviewData =
    reviews && reviews.data && !(typeof TR_isSomeoneElse === "function" && TR_isSomeoneElse(staffUser, reviews.data.me)) ? reviews.data : null;
  // Same for the handbook: hb_status is the signed-in person's, not the viewed one's.
  const handbookItems =
    handbook.me && !(typeof TR_isSomeoneElse === "function" && TR_isSomeoneElse(staffUser, handbook.me)) ? handbook.items : TD_NONE;

  // Admin item: profile photos waiting for an edit. Derived from the shared
  // list (also used by HR › Members); hidden in "View as" like the handbook.
  const photoList = typeof SP_useAdminList === "function" ? SP_useAdminList(admin) : null;
  const photosItem =
    admin && photoList && photoList.rows && typeof SP_todayItem === "function" && !(typeof TR_isSomeoneElse === "function" && TR_isSomeoneElse(staffUser, (reviews && reviews.data && reviews.data.me) || handbook.me))
      ? SP_todayItem(photoList.rows)
      : null;
  const photosKey = photosItem ? photosItem.key + ":" + photosItem.count + ":" + photosItem.detail : "";

  const celebrate = async (row, kind, action) => {
    if (ro) return;
    const error = await cel.act(row, kind, action, me);
    showToast(error ? "Couldn't save: " + (error.message || "try again") : action === "gift" ? "Marked as gift sent" : "Dismissed");
  };
  const openShoutout = (to) => {
    if (typeof SO_openCompose === "function") SO_openCompose(to);
    else NAV_go("team", "people");
  };
  const goProfile = () => NAV_go("settings"); // Settings opens on Profile

  const nowMs = Date.now();
  // Out-of-office hand-offs (Tasks Phase 2 S7): "Covering for Ann" on tasks I hold for someone.
  const coverRows = typeof CV_useMyCoverage === "function" ? CV_useMyCoverage() : TD_NO_ROWS;
  // View as: requests are scoped to the person's own clients (an admin's RLS
  // returns every client's), and the admin's own approvals queue is left out.
  const vaIds = React.useMemo(() => new Set(openableClients.map((c) => c && c.id)), [openableClients]);
  const inScope = (r) => !ro || (r && vaIds.has(r.client_id));
  const rowsAll = React.useMemo(
    () =>
      TD_buildRows({
        clients: allClients,
        myClients,
        today,
        me,
        nowMs,
        celebrations: cel.rows,
        readOnly: ro,
        celebrate,
        openShoutout,
        profileIncomplete,
        goProfile,
        toApprove: !ro && grants && grants.status === "ready" ? grants.toApprove.filter(notHidden) : [],
        grantBusy,
        decideGrant,
        accessRequests: (access.rows || []).filter(notHidden).filter(inScope),
        waiting: waiting.rows,
        items: (mine.items || []).filter(notHidden),
        toggleItem,
        isAdmin: admin,
        deadlines,
        blocked: closes.blocked,
        reviews: reviewData,
        handbook: handbookItems,
        photosItem,
        upgrades: (upgrades.rows || []).filter(notHidden).filter(inScope),
        upgradeBusyId: upgrades.busyId,
        setUpgradeStatus: upgrades.setStatus,
        health: health && health.status === "ready" ? health.byId : null,
        coverageGaps: coverage.gaps,
        coverRows,
        staleSops,
        onNavigateToClient,
      }),
    // decideGrant / toggleItem / setStatus only close over stable setters.
    [
      allClients,
      myClients,
      today,
      me,
      grants && grants.status,
      grants && grants.toApprove,
      grantBusy,
      access.rows,
      waiting.rows,
      mine.items,
      hiddenIds,
      deadlines,
      closes.blocked,
      reviewData,
      handbookItems,
      photosKey,
      upgrades.rows,
      upgrades.busyId,
      health && health.status,
      health && health.byId,
      coverage.gaps,
      coverRows,
      staleSops,
      cel.rows,
      profileIncomplete,
      onNavigateToClient,
      admin,
      ro,
      vaIds,
    ],
  );
  // View as: every row action is disabled (the guard would refuse it anyway).
  const rows = React.useMemo(() => (ro ? TD_readOnlyRows(rowsAll) : rowsAll), [rowsAll, ro]);

  // Header line. Late = everything late that's mine: tasks, filing deadlines
  // and bills (the old Overdue tile).
  const openItems = (mine.items || []).filter(notHidden).filter((t) => !t.done && t.kind !== "note" && t.due_date);
  const dueToday = openItems.filter((t) => t.due_date === today).length;
  // Slate rhythm s4 (owner rule): waiting on the client, or a preliminary
  // reports month, is never late (TK_lateExcused, same as SQL).
  const lateExcused = (t) => (typeof TK_lateExcused === "function" ? TK_lateExcused(t) : t.status === "waiting_client");
  const overdue =
    openItems.filter((t) => t.due_date < today && !lateExcused(t)).length +
    deadlines.filter((it) => it.state === "overdue").length +
    rows.now.filter((r) => r.kind === "bill").length;

  // Clients needing attention: one line per client, with why. Reuses the
  // waiting threads, blocked closes and coverage gaps already loaded above.
  const attentionLines = React.useMemo(() => {
    const by = {};
    const nameOf = {};
    allClients.forEach((c) => (nameOf[c.id] = c.name));
    // go: where a click lands; the first (most urgent) reason wins.
    const add = (id, tone, text, go) => {
      if (!id || !nameOf[id]) return;
      const e = by[id] || (by[id] = { id, name: nameOf[id], chips: [], score: 0, go: null });
      if (e.chips.some((c) => c.text === text)) return;
      e.chips.push({ tone, text });
      e.score += tone === "now" ? 2 : 1;
      if (!e.go && go) e.go = go;
    };
    const replies = {};
    const firstReply = {};
    waiting.rows.forEach((r) => {
      replies[r.client_id] = (replies[r.client_id] || 0) + 1;
      if (!firstReply[r.client_id]) firstReply[r.client_id] = r;
    });
    Object.keys(replies).forEach((id) => {
      const r = firstReply[id];
      add(id, "now", replies[id] === 1 ? "Reply waiting" : replies[id] + " replies waiting", () => LK_go({ clientId: id, tab: "messages", item: "msg:" + r.id }, { email: r.participant_email }));
    });
    (closes.blocked || []).forEach((r) => add(r.client_id, "now", "Close blocked", () => LK_go({ clientId: r.client_id, tab: "close", item: "at:close-qbo" })));
    if (health && health.status === "ready" && health.byId) {
      allClients.forEach((c) => {
        const h = health.byId[c.id];
        if (!h || h.band === "green") return;
        add(c.id, h.band === "red" ? "now" : "week", HL_LABEL[h.band] || h.band, () => LK_go({ clientId: c.id, tab: "overview", item: "at:ov-why" }));
      });
    }
    (coverage.gaps || []).forEach((g) => add(g.client && g.client.client_id, "week", "No backup while out", () => NAV_go("team", "people")));
    return Object.values(by)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .map((e) => ({ key: e.id, title: e.name, chips: e.chips, onClick: e.go || (() => onNavigateToClient(e.id)) }));
  }, [allClients, waiting.rows, closes.blocked, coverage.gaps, health && health.status, health && health.byId, onNavigateToClient]);
  // Open Also needs you on one row (Do next's Review, Waiting on others).
  const reveal = (key) => window.dispatchEvent(new CustomEvent("td:reveal", { detail: { key } }));
  // Waiting on others: access and upgrade requests, and replies to chase.
  const waitingLines = React.useMemo(() => {
    const nameOf = {};
    allClients.forEach((c) => (nameOf[c.id] = c.name));
    const out = [];
    // Teammates asking me for temporary access: Approve or Deny on the row.
    (!ro && grants && grants.status === "ready" ? grants.toApprove.filter(notHidden) : []).forEach((g) =>
      out.push({
        key: "grant-" + g.id,
        title: (g.staff_name || g.staff_email) + " · " + (nameOf[g.client_id] || g.client_id),
        chips: [{ tone: "now", text: "Wants access" }],
        onClick: () => reveal("grant-" + g.id),
      }),
    );
    (access.rows || []).filter(notHidden).filter(inScope).forEach((r) =>
      out.push({
        key: "acc-" + r.id,
        title: nameOf[r.client_id] || r.client_id,
        chips: [{ tone: "week", text: "Access request" }],
        onClick: () => LK_go({ clientId: r.client_id, tab: "settings", sub: "client", item: "setup:access.requests" }),
      }),
    );
    (upgrades.rows || []).filter(notHidden).filter(inScope).forEach((r) =>
      out.push({
        key: "upg-" + r.id,
        title: nameOf[r.client_id] || r.client_id,
        chips: [{ tone: "week", text: r.requested_plan === "payroll" ? "Wants Payroll" : "Wants an upgrade" }],
        tour: "today-upgrade",
        onClick: () => LK_go({ clientId: r.client_id, tab: "settings", sub: "plan" }),
      }),
    );
    if (waiting.rows.length > 0)
      out.push({
        key: "replies",
        title: waiting.rows.length === 1 ? "1 client reply" : waiting.rows.length + " client replies",
        chips: [{ tone: "now", text: "Waiting on us" }],
        onClick: () => NAV_go("inbox"),
      });
    return out;
  }, [allClients, grants && grants.status, grants && grants.toApprove, access.rows, upgrades.rows, waiting.rows, hiddenIds, ro, vaIds]);
  const celebrationRows = rows.now.concat(rows.week).filter((r) => r.kind === "celebrate");

  // Optional cards: saved per person; a toggle still works for this visit
  // when settings can't save (e.g. "View as").
  const saved = st && st.email === me && TD_isObj(st.settings && st.settings.todayCards) ? st.settings.todayCards : {};
  const [cardOverride, setCardOverride] = React.useState(null);
  const cards = { ...TD_CARD_DEFAULTS, ...saved, ...(cardOverride || {}) };
  // L1 left sidebar: its Recent clients section replaces this card while the
  // gate is on. The saved choice is left alone, so it returns when the gate is off.
  const ssOn = typeof SS_useOn === "function" ? SS_useOn() : false;

  // Everything the old list also carried that Slate and the Desk don't:
  // approvals, handbook, deadlines, reviews... kept behind one fold.
  // Celebrations stay here only while the This week card is off.
  const inFold = (r) => r.kind !== "task" && r.kind !== "reply" && !(r.kind === "celebrate" && cards.milestones);
  const moreNow = rows.now.filter(inFold);
  const moreWeek = rows.week.filter(inFold);
  const moreCount = moreNow.length + moreWeek.length;
  // td:reveal opens the fold and moves focus to that row.
  const [revealKey, setRevealKey] = React.useState(null);
  React.useEffect(() => {
    const on = (e) => {
      setMoreOpen(true);
      setRevealKey((e.detail && e.detail.key) || null);
    };
    window.addEventListener("td:reveal", on);
    return () => window.removeEventListener("td:reveal", on);
  }, []);
  React.useEffect(() => {
    if (!revealKey || !moreOpen) return;
    const el = document.querySelector('[data-td-key="' + String(revealKey).replace(/"/g, "") + '"]');
    if (el) {
      if (el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: "smooth" });
      const btn = el.querySelector(".td-row-actions .btn-primary") || el;
      try {
        btn.focus({ preventScroll: true });
      } catch (err) {}
    }
    setRevealKey(null);
  }, [revealKey, moreOpen]);
  const toggleCard = (key) => {
    const next = { ...cards, [key]: !cards[key] };
    setCardOverride(next);
    if (typeof ST_store !== "undefined" && ST_store && typeof ST_store.update === "function") ST_store.update({ todayCards: next });
  };

  const settled = waiting.loaded && mine.items !== null && access.loaded && upgrades.loaded && closes.loaded;
  const errors = [waiting.error, mine.error, access.error, upgrades.error, grantError, dl && dl.error ? dl.error : ""].filter(Boolean);
  // Do next from Today's own order (classic, and the Desk's fallback while
  // wb_inbox isn't live): first row of Now, then This week.
  // A month-ahead celebration (days 8-30) is never the one top item.
  const ranked = rows.now.concat(rows.week).filter((r) => !r.far);
  const topRow = ranked[0] || null;
  const topDo = TD_doNext(topRow);
  // "N more tasks in Slate": only what Slate holds; the rest is in the fold.
  const moreTasks = ranked.filter((r, i) => i > 0 && r.kind === "task").length;
  const classicBody = () => (
    <TD_DoNextCard
      loading={!settled && !topRow}
      top={topRow ? { title: topRow.title, meta: topRow.detail, label: topDo ? topDo.label : "Open" } : null}
      next={ranked[1] ? ranked[1].title : ""}
      more={moreTasks}
      moreText={moreTasks === 1 ? "task in" : "tasks in"}
      onOpen={() => topDo && topDo.run && topDo.run()}
    />
  );
  // Same counts with the Desk on: the line is about your tasks (and late
  // deadlines and bills), next to Open Slate. The Desk's bar has its own.
  const sumDue = dueToday;
  const sumLate = overdue;
  const sumReady = !!mine.items;

  return (
    <div className="td-page">
      {profilePrompt && !ro && typeof ModalShell === "function" && (
        <ModalShell onClose={dismissProfilePrompt} labelledBy="td-profile-title" className="confirm-modal">
          <div className="modal-header">
            <h3 className="card-title" id="td-profile-title" style={{ margin: 0 }}>
              Welcome! Finish your profile
            </h3>
            <button type="button" className="modal-close" onClick={dismissProfilePrompt} aria-label="Close">
              ×
            </button>
          </div>
          <div className="modal-body">
            <p>Add your birthday (just the month and day) and start date so the team can celebrate with you. Your name, title and photo show on your clients' dashboards too.</p>
            <p className="card-subtitle">This stays on your Today list until it's done.</p>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={dismissProfilePrompt}>
              Later
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                dismissProfilePrompt();
                goProfile();
              }}
            >
              Open my profile
            </button>
          </div>
        </ModalShell>
      )}
      <div className="td-head">
        <div className="td-head-text">
          <p className="td-greeting">{TD_greeting(staffUser && staffUser.name)}</p>
          <p className="td-date">{TD_dateLine()}</p>
        </div>
        <TD_SummaryLine due={sumDue} late={sumLate} ready={sumReady} />
      </div>

      {/* View as never mounts the Desk (§10.1): say why when it's on. */}
      {impersonating && wbSwitch && (
        <p className="wb-classic-note va-desk-note" data-tour="va-desk-note">
          {TD_firstName(staffUser && staffUser.name)}'s Desk is private to them, so View as shows the classic Today.
        </p>
      )}
      {!wbOn && wbClassic && (
        <p className="wb-classic-note">
          You're using classic Today in this browser.{" "}
          <button
            type="button"
            className="wb-linkish"
            onClick={() => {
              try {
                window.localStorage.removeItem("mgb_wb_classic");
              } catch (e) {}
              window.location.reload();
            }}
          >
            Switch back to the new Today
          </button>
        </p>
      )}
      {wbOn ? <WB_Page me={me} isAdmin={!!(staffUser && staffUser.role === "admin")} td={rows} fallback={classicBody()} deskOn={!!deskOn} /> : classicBody()}
      {errors.map((e) => (
        <p className="card-subtitle negative td-error" key={e}>
          {e}
        </p>
      ))}
      {moreCount > 0 && (
        <div className="td-more-wrap">
          <button type="button" className="td-more" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen} aria-controls="td-more-list">
            <span className="td-more-chev" aria-hidden="true">
              {moreOpen ? "▾" : "▸"}
            </span>
            Also needs you ({moreCount})
          </button>
          <div className="card td-list" id="td-more-list" hidden={!moreOpen}>
            {moreOpen && (
              <>
                <TD_Band tone="now" title="Now" rows={moreNow} expanded={true} />
                <TD_Band tone="week" title="This week" rows={moreWeek} expanded={true} />
              </>
            )}
          </div>
        </div>
      )}

      {(cards.attention || cards.waiting || cards.reminders || cards.milestones) && (
        <div className="td-cards" data-tour="today-cards-grid">
          {cards.attention && (
            <TD_ListCard
              id="td-attention-title"
              title="Clients needing attention"
              subtitle="Replies waiting, blocked closes, health and coverage gaps."
              lines={attentionLines}
              loaded={settled}
              emptyText="No client needs a nudge."
              tour="today-attention"
            />
          )}
          {cards.waiting && (
            <TD_ListCard id="td-waiting-title" title="Waiting on others" subtitle="Teammates and clients waiting on the firm: access and upgrade requests, and replies." lines={waitingLines} loaded={settled} emptyText="Nothing is waiting." />
          )}
          {cards.reminders && <TD_RemindersCard me={me} items={mine.items} error={mine.error} today={today} onAdd={addItem} onToggle={toggleItem} onRemove={removeItem} readOnly={ro} />}
          {cards.milestones && <TD_MilestonesCard clients={allClients} onOpenClientMilestone={onOpenClientMilestone} celebrations={celebrationRows} />}
        </div>
      )}
      {/* View as: this browser's visit history is the admin's, not theirs. */}
      {cards.recent && !ssOn && !ro && <TD_RecentCard clients={openableClients} />}

      <div className="td-cards-bar">
        <span className="td-cards-label" id="td-cards-label">
          Also show
        </span>
        <div className="td-cards-toggles" role="group" aria-labelledby="td-cards-label" data-tour="today-cards">
          {TD_CARDS.filter((c) => !(ssOn && c.key === "recent")).map((c) => (
            <button type="button" key={c.key} className={"td-toggle" + (cards[c.key] ? " is-on" : "")} aria-pressed={!!cards[c.key]} onClick={() => toggleCard(c.key)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
