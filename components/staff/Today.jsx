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
// Optional cards (Reminders, Milestones, Recently viewed) each have a
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
  { key: "reminders", label: "Reminders" },
  { key: "milestones", label: "Milestones" },
  { key: "recent", label: "Recently viewed" },
];
const TD_CARD_DEFAULTS = { reminders: true, milestones: true, recent: true };
// The word shown beside each row's icon. Colour never carries the meaning
// on its own: the band heading and this label say it in words.
const TD_KIND_LABEL = {
  access: "Access",
  reply: "Reply",
  task: "Task",
  deadline: "Deadline",
  close: "Close",
  bill: "Bills",
  review: "Review",
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
      setState({ items: (data || []).filter((r) => isMyStaffItem(r, me)), error: "" });
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
      TD_safe(sb.from("month_close").select("client_id, period, status").eq("period", period).in("client_id", ids)),
      TD_safe(sb.from("close_checks").select("client_id, period, status, reasons").eq("status", "blocked").eq("period", period).in("client_id", ids)),
    ]);
    const statusOf = {};
    ((mc && mc.data) || []).forEach((r) => (statusOf[r.client_id] = r.status));
    const open = mc.error ? [] : ids.filter((id) => !["done", "na"].includes(statusOf[id] || "not_started")).map((id) => ({ client_id: id, status: statusOf[id] || "not_started" }));
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

// Builds the two bands. Every row: { key, kind, rank, sort, title, detail,
// onClick?, actions?: [{ label, primary?, disabled?, onClick }] }. Lower rank
// first, then lower sort (days until / most overdue first, oldest wait
// first). Ranks in "Now": 0 waiting on you (access, replies), 1 overdue,
// 2 due today, 3 reviews, 4 upgrades. In "This week": 1 due soon, 2 clients
// at risk, 3 coverage gaps, 9 stale SOPs.
function TD_buildRows(x) {
  const now = [];
  const week = [];
  const { clients, today, me } = x;
  const byId = {};
  (clients || []).forEach((c) => (byId[c.id] = c));
  const nameOf = (id) => (byId[id] ? byId[id].name : id);
  const myClientIds = new Set(x.myClients.map((c) => c.id));

  // Teammates asking for temporary access to a client I look after.
  (x.toApprove || []).forEach((g) => {
    const who = g.staff_name || g.staff_email;
    const busy = x.grantBusy === g.id;
    now.push({
      key: "grant-" + g.id,
      kind: "access",
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
    const open = () => x.onNavigateToClient(r.client_id, "dashboard", { openAccessManager: true });
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
      onClick: () => x.onNavigateToClient(row.client_id, "messages"),
    });
  });

  // My open tasks: overdue and due today go in "Now", the rest of the week
  // below. Done ticks the item off right here (same path as Work › Tasks).
  (x.items || []).forEach((t) => {
    if (t.done || t.kind === "note" || !t.due_date) return;
    const diff = daysUntil(t.due_date, today);
    if (diff > TD_SOON_DAYS) return;
    (diff <= 0 ? now : week).push({
      key: "task-" + t.id,
      kind: "task",
      rank: diff < 0 ? 1 : diff === 0 ? 2 : 1,
      sort: diff,
      title: t.text,
      detail: [staffItemDueLabel(t, today), t.client_id ? nameOf(t.client_id) : ""].filter(Boolean).join(" · "),
      onClick: () => NAV_go("work", "tasks"),
      actions: [{ label: "Done", onClick: () => x.toggleItem(t) }],
    });
  });

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
      onClick: () => NAV_go("work", "deadlines"),
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
      onClick: () => NAV_go("work", "close"),
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
      onClick: () => x.onNavigateToClient(g.clientId, "receivables"),
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
      onClick: () => NAV_go("team", "reviews"),
      actions: [{ label: "Open", primary: diff <= 0, onClick: () => NAV_go("team", "reviews") }],
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
        onClick: () => x.onNavigateToClient(c.id, "client-overview"),
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

  // Birthdays and work anniversaries within 7 days (admins). Today's sit in
  // "now", the rest in "this week". "Gift sent" or "Dismiss" hides one.
  (x.celebrations || []).forEach((r) => {
    const push = (kind, on, action, title, what) => {
      if (!on || action) return;
      const d = daysUntil(on, x.today);
      if (d < 0 || d > 7) return;
      const when = d === 0 ? "Today" : d === 1 ? "Tomorrow" : fmtDate(on);
      (d === 0 ? now : week).push({
        key: "cel-" + kind + "-" + r.email,
        kind: "celebrate",
        rank: 0,
        sort: d,
        title,
        detail: `${when} · ${what}`,
        onClick: () => x.openShoutout(r.email),
        actions: [
          { label: "Send shout-out", primary: true, onClick: () => x.openShoutout(r.email) },
          { label: "Gift sent", onClick: () => x.celebrate(r, kind, "gift") },
          { label: "Dismiss", onClick: () => x.celebrate(r, kind, "dismissed") },
        ],
      });
    };
    push("birthday", r.next_birthday, r.birthday_action, `${r.name}'s birthday`, "send a gift or a shout-out");
    push("anniversary", r.next_anniversary, r.anniversary_action, `${r.name}: ${r.years} year${r.years === 1 ? "" : "s"} with the firm`, "work anniversary");
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
            <li className={"td-row" + (r.actions && r.actions.length > 1 ? " td-row-stack" : "")} key={r.key}>
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
                    <button key={a.label} type="button" className={a.primary ? "btn-primary" : "btn-secondary"} disabled={a.disabled} onClick={a.onClick}>
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
function TD_RemindersCard({ me, items, error, onAdd, onToggle, onRemove, today }) {
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
        Private to you and admins unless you share one with a client's team. For times, repeats and sharing, open{" "}
        <button type="button" className="td-link" onClick={() => NAV_go("work", "tasks")}>
          Work › Tasks
        </button>
        .
      </p>
      <div className="staff-add-row">
        <input
          type="text"
          aria-label="New reminder"
          placeholder="Follow up with Grace Community about..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <input type="date" aria-label="Due date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button type="button" className="btn-primary" disabled={adding || !text.trim()} onClick={add}>
          + Add
        </button>
      </div>
      {error && <p className="card-subtitle negative td-card-note">{error}</p>}
      {items === null && !error && <p className="card-subtitle td-card-note">Loading…</p>}
      {items && sorted.length === 0 && !error && <p className="card-subtitle td-card-note">No reminders yet.</p>}
      {sorted.length > 0 && (
        <ul className="staff-audit-list">
          {sorted.map((r) => (
            <li className="staff-audit-row" key={r.id}>
              <label className="staff-active-toggle td-reminder">
                <input type="checkbox" checked={!!r.done} onChange={() => onToggle(r)} />
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
              <button type="button" className="row-remove-btn" onClick={() => onRemove(r)} aria-label={`Remove reminder: ${r.text}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TD_MilestonesCard({ clients, onOpenClientMilestone }) {
  const [count, setCount] = React.useState(0);
  return (
    <section className={"card td-card" + (count > 0 ? " td-card-week" : "")} aria-labelledby="td-milestones-title">
      <h3 className="card-title" id="td-milestones-title">
        Milestones to review
      </h3>
      <p className="card-subtitle">Numbers pointing to a different milestone, not confirmed yet, or close to the next one.</p>
      {typeof MilestonesReviewList === "function" ? (
        <MilestonesReviewList clients={clients} onCount={setCount} onOpenClient={(id) => onOpenClientMilestone && onOpenClientMilestone(id)} />
      ) : (
        <p className="card-subtitle td-card-note">Milestones aren't available right now.</p>
      )}
    </section>
  );
}

// Per-browser visit history (recordClientVisit in app.jsx): whatever this
// browser last recorded, read once on mount.
function TD_RecentCard({ clients, onNavigateToClient }) {
  const visits = React.useMemo(() => (typeof loadClientVisits === "function" ? loadClientVisits() : {}), []);
  const recent = React.useMemo(
    () =>
      (clients || [])
        .filter((c) => visits[c.id])
        .sort((a, b) => visits[b.id] - visits[a.id])
        .slice(0, 5),
    [clients, visits],
  );
  return (
    <section className="card td-card" aria-labelledby="td-recent-title">
      <h3 className="card-title" id="td-recent-title">
        Recently viewed
      </h3>
      <p className="card-subtitle">The clients you've had open most recently, on this device.</p>
      {recent.length === 0 && <p className="card-subtitle td-card-note">Nothing viewed yet on this device.</p>}
      {recent.length > 0 && (
        <div className="staff-audit-list">
          {recent.map((c) => (
            <button type="button" className="staff-due-row" key={c.id} onClick={() => onNavigateToClient(c.id, "client-overview")}>
              <span className="staff-flag-label">{c.name}</span>
              <span className="staff-flag-desc">{fmtDateTime(new Date(visits[c.id]).toISOString())}</span>
            </button>
          ))}
        </div>
      )}
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
  const [rows, setRows] = React.useState([]);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!admin) return;
    const sb = window.mgbSupabase;
    if (!sb || typeof sb.rpc !== "function") return;
    let alive = true;
    sb.rpc("staff_celebrations").then(({ data, error }) => {
      if (alive && !error) setRows(Array.isArray(data) ? data : []);
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
  return { rows: admin ? rows : [], act };
}

function TD_TodayPage({ staffUser, clients, onNavigateToClient, onOpenClientMilestone, isAdmin }) {
  const showToast = useToast();
  const me = TD_lc(staffUser && staffUser.email);
  const admin = !!(isAdmin || (staffUser && staffUser.role === "admin"));
  const today = todayLocal();
  const allClients = clients || [];
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
  const reviews = typeof TR_useOverview === "function" ? TR_useOverview() : null;
  const health = typeof HL_useHealth === "function" ? HL_useHealth() : null;
  const sopStatus = typeof SF_useSopStatus === "function" ? SF_useSopStatus(true) : null;
  const st = typeof ST_useSettings === "function" ? ST_useSettings() : null;
  // Celebrations to act on (admins) and whether my own profile still needs
  // its birthday and start date (everyone; stays on the list until done).
  const cel = TD_useCelebrations(admin, today);
  const myProfile = typeof ST_useMyProfile === "function" ? ST_useMyProfile(me) : null;
  const profileIncomplete = !!(myProfile && myProfile.loaded && !(myProfile.row && myProfile.row.birthday && myProfile.row.start_date));
  // First sign-in: one welcome prompt per browser, then the Today item
  // carries the reminder until both dates are filled in.
  const promptKey = "mgb-profile-prompt:" + me;
  const [profilePrompt, setProfilePrompt] = React.useState(false);
  React.useEffect(() => {
    if (!profileIncomplete || !me) return;
    let seen = false;
    try {
      seen = !!localStorage.getItem(promptKey);
    } catch (e) {}
    if (!seen) setProfilePrompt(true);
  }, [profileIncomplete, me]);
  const dismissProfilePrompt = () => {
    setProfilePrompt(false);
    try {
      localStorage.setItem(promptKey, "1");
    } catch (e) {}
  };

  const [expanded, setExpanded] = React.useState(false);
  const [grantBusy, setGrantBusy] = React.useState(null);
  const [grantError, setGrantError] = React.useState("");
  const [flash, setFlash] = React.useState(false);
  const flashTimer = React.useRef(null);
  React.useEffect(() => () => clearTimeout(flashTimer.current), []);

  // Item actions share Work › Tasks' write path, so a tick here rolls a
  // recurring item forward and every view refreshes through
  // STAFF_ITEMS_CHANGED_EVENT.
  const sb = window.mgbSupabase;
  const toggleItem = React.useCallback(
    async (item) => {
      if (!sb) return;
      const { error } = await staffItemsApi.toggleDone(sb, me, item);
      if (error) showToast(`Couldn't update that: ${error.message}`);
    },
    [sb, me, showToast],
  );
  const addItem = React.useCallback(
    async (item) => {
      if (!sb) return false;
      const { error } = await staffItemsApi.add(sb, me, item);
      if (error) {
        showToast(`Couldn't add reminder: ${error.message}`);
        return false;
      }
      return true;
    },
    [sb, me, showToast],
  );
  const removeItem = React.useCallback(
    async (item) => {
      if (!sb) return;
      const { error } = await staffItemsApi.remove(sb, item.id);
      if (error) showToast(`Couldn't remove reminder: ${error.message}`);
    },
    [sb, me, showToast],
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
    reviews && reviews.data && !(staffUser && staffUser.name && reviews.data.me && reviews.data.me.name && staffUser.name !== reviews.data.me.name) ? reviews.data : null;

  const celebrate = async (row, kind, action) => {
    const error = await cel.act(row, kind, action, me);
    showToast(error ? "Couldn't save: " + (error.message || "try again") : action === "gift" ? "Marked as gift sent" : "Dismissed");
  };
  const openShoutout = (to) => {
    if (typeof SO_openCompose === "function") SO_openCompose(to);
    else NAV_go("team", "people");
  };
  const goProfile = () => NAV_go("settings"); // Settings opens on Profile

  const nowMs = Date.now();
  const rows = React.useMemo(
    () =>
      TD_buildRows({
        clients: allClients,
        myClients,
        today,
        me,
        nowMs,
        celebrations: cel.rows,
        celebrate,
        openShoutout,
        profileIncomplete,
        goProfile,
        toApprove: grants && grants.status === "ready" ? grants.toApprove : [],
        grantBusy,
        decideGrant,
        accessRequests: access.rows,
        waiting: waiting.rows,
        items: mine.items || [],
        toggleItem,
        deadlines,
        blocked: closes.blocked,
        reviews: reviewData,
        upgrades: upgrades.rows,
        upgradeBusyId: upgrades.busyId,
        setUpgradeStatus: upgrades.setStatus,
        health: health && health.status === "ready" ? health.byId : null,
        coverageGaps: coverage.gaps,
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
      deadlines,
      closes.blocked,
      reviewData,
      upgrades.rows,
      upgrades.busyId,
      health && health.status,
      health && health.byId,
      coverage.gaps,
      staleSops,
      cel.rows,
      profileIncomplete,
      onNavigateToClient,
    ],
  );

  // Tiles. Overdue = everything late that's mine: tasks, filing deadlines and
  // bills. Its only home is the "Now" band right below, so it scrolls there.
  const openItems = (mine.items || []).filter((t) => !t.done && t.kind !== "note" && t.due_date);
  const dueToday = openItems.filter((t) => t.due_date === today).length;
  const overdue =
    openItems.filter((t) => t.due_date < today).length +
    deadlines.filter((it) => it.state === "overdue").length +
    rows.now.filter((r) => r.kind === "bill").length;
  const closePeriod = TD_prevMonthStart();
  const jumpToNow = () => {
    const el = document.getElementById("td-band-now") || document.getElementById("td-list");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    clearTimeout(flashTimer.current);
    setFlash(true);
    flashTimer.current = setTimeout(() => setFlash(false), CARD_FLASH_HOLD_MS);
  };
  const tiles = [
    {
      key: "replies",
      label: "Replies waiting",
      value: waiting.loaded ? waiting.rows.length : "…",
      tone: waiting.rows.length > 0 ? "now" : "calm",
      sub: waiting.rows.length > 0 ? "clients waiting on an answer" : "every client has an answer",
      go: () => NAV_go("inbox"),
    },
    {
      key: "due",
      label: "Tasks due today",
      value: mine.items ? dueToday : "…",
      tone: dueToday > 0 ? "week" : "calm",
      sub: dueToday > 0 ? "open Work › Tasks" : "nothing due today",
      go: () => NAV_go("work", "tasks"),
    },
    {
      key: "overdue",
      label: "Overdue",
      value: mine.items ? overdue : "…",
      tone: overdue > 0 ? "now" : "calm",
      sub: overdue > 0 ? "tasks, deadlines and bills past due" : "nothing past due",
      go: jumpToNow,
    },
    {
      key: "closes",
      label: "Closes open",
      value: closes.loaded ? closes.open.length : "…",
      tone: closes.open.length > 0 ? "week" : "calm",
      sub:
        closes.open.length > 0
          ? `${TD_monthName(closePeriod)} not finished` + (closes.blocked.length ? ` · ${closes.blocked.length} blocked` : "")
          : `${TD_monthName(closePeriod)} is wrapped up`,
      go: () => NAV_go("work", "close"),
    },
  ];

  // Optional cards: saved per person; a toggle still works for this visit
  // when settings can't save (e.g. "View as").
  const saved = st && st.email === me && TD_isObj(st.settings && st.settings.todayCards) ? st.settings.todayCards : {};
  const [cardOverride, setCardOverride] = React.useState(null);
  const cards = { ...TD_CARD_DEFAULTS, ...saved, ...(cardOverride || {}) };
  const toggleCard = (key) => {
    const next = { ...cards, [key]: !cards[key] };
    setCardOverride(next);
    if (typeof ST_store !== "undefined" && ST_store && typeof ST_store.update === "function") ST_store.update({ todayCards: next });
  };

  const settled = waiting.loaded && mine.items !== null && access.loaded && upgrades.loaded && closes.loaded;
  const empty = settled && rows.now.length === 0 && rows.week.length === 0;
  const hasMore = rows.now.length > TD_ROW_LIMIT || rows.week.length > TD_ROW_LIMIT;
  const errors = [waiting.error, mine.error, access.error, upgrades.error, grantError, dl && dl.error ? dl.error : ""].filter(Boolean);
  const tone = rows.now.length ? "now" : rows.week.length ? "week" : "clear";
  const chip = (t, text, onClick) => {
    const Tag = onClick ? "button" : "span";
    return (
      <Tag className={"td-chip td-chip-" + t} {...(onClick ? { type: "button", onClick } : {})}>
        <span className="td-band-dot" aria-hidden="true" />
        {text}
      </Tag>
    );
  };

  return (
    <div className="td-page">
      {profilePrompt && typeof ModalShell === "function" && (
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
            <p>Add your birthday and start date so the team can celebrate with you. Your name, title and photo show on your clients' dashboards too.</p>
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
        <div className="td-chips">
          {rows.now.length > 0 && chip("now", `${rows.now.length} need${rows.now.length === 1 ? "s" : ""} you now`, jumpToNow)}
          {rows.week.length > 0 && chip("week", `${rows.week.length} this week`)}
          {empty && chip("clear", "All clear")}
        </div>
      </div>

      <div className="kpi-grid td-kpis">
        {tiles.map((t) => (
          <button type="button" key={t.key} className={"card kpi-card kpi-card-clickable td-kpi td-kpi-" + t.tone} onClick={t.go}>
            <span className="kpi-label">{t.label}</span>
            <span className="kpi-value">{t.value}</span>
            <span className="kpi-sub">{t.sub}</span>
          </button>
        ))}
      </div>

      <section className={"card td-list td-tone-" + tone + (flash ? " card-flash" : "")} id="td-list" data-tour="today-list" aria-labelledby="td-list-title">
        <h2 className="card-title" id="td-list-title">
          Needs you
        </h2>
        <p className="card-subtitle">Everything waiting on you across every client you can see, most urgent first.</p>
        {!settled && !empty && rows.now.length === 0 && rows.week.length === 0 && (
          <p className="card-subtitle td-loading" role="status">
            Looking for anything that needs you…
          </p>
        )}
        {empty && (
          <div className="td-empty" role="status">
            <span className="td-empty-mark" aria-hidden="true">
              ✓
            </span>
            <span className="td-empty-text">
              <strong>Nothing needs you right now.</strong>
              <span>Enjoy the quiet. New messages, tasks and deadlines show up here as they come in.</span>
            </span>
          </div>
        )}
        <TD_Band tone="now" title="Now" rows={rows.now} expanded={expanded} />
        <TD_Band tone="week" title="This week" rows={rows.week} expanded={expanded} />
        {hasMore && (
          <button type="button" className="td-more" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {expanded ? "Show less" : "Show everything"}
          </button>
        )}
        {errors.map((e) => (
          <p className="card-subtitle negative td-error" key={e}>
            {e}
          </p>
        ))}
      </section>

      <div className="td-cards-bar">
        <span className="td-cards-label" id="td-cards-label">
          Also show
        </span>
        <div className="td-cards-toggles" role="group" aria-labelledby="td-cards-label" data-tour="today-cards">
          {TD_CARDS.map((c) => (
            <button type="button" key={c.key} className={"td-toggle" + (cards[c.key] ? " is-on" : "")} aria-pressed={!!cards[c.key]} onClick={() => toggleCard(c.key)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
      {(cards.reminders || cards.milestones || cards.recent) && (
        <div className="td-cards">
          {cards.reminders && <TD_RemindersCard me={me} items={mine.items} error={mine.error} today={today} onAdd={addItem} onToggle={toggleItem} onRemove={removeItem} />}
          {cards.milestones && <TD_MilestonesCard clients={allClients} onOpenClientMilestone={onOpenClientMilestone} />}
          {cards.recent && <TD_RecentCard clients={allClients} onNavigateToClient={onNavigateToClient} />}
        </div>
      )}
    </div>
  );
}
