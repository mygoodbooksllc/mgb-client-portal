// components/staff/WorkPage.jsx — the Work place: Tasks, Close and Deadlines
// as one page with a tab row (staff navigation redesign, 2026-10-08).
//
//   WK_WorkPage({ clients, staffUser, statusOverrides, canManageTemplates,
//                 canCreateTemplates, onOpenTemplates })
//
// App mounts it for the "work" page. The open tab lives in the hash
// (#/work/tasks, #/work/close, #/work/deadlines) through NAV_useHashSub, so a
// deep link opens the right tab and a tab click is not a history entry. Each
// tab shows the same component the old standalone page showed (MyTasksPage in
// app.jsx, CT_CloseTrackerPage, DL_DeadlinesPage) with the same props, so the
// pages themselves are unchanged; only where they live.
//
// Tab badge: Tasks shows how many of my open items are due now (overdue plus
// due today), counted from the same staff_reminders rows the top bar reads
// (TB_useMyItems + countDueStaffItems in app.jsx), unless App passes its own
// `myTasksDue` count. Close has no badge: its "blocked" count only exists once
// the tracker has loaded every client's checks, so it would cost a second
// full load just for a number.
//
// Prefix: WK_. Like every component file, it only touches app.jsx globals at
// render time, never at the top level.

// { overdue, due } for the Tasks badge, or null when nothing can count.
// `given` is App's own count when it passes one; then no extra query runs.
function WK_useTasksDue(staffUser, given) {
  const email = (staffUser && staffUser.email) || "";
  const canCount = !given && typeof TB_useMyItems === "function" && typeof countDueStaffItems === "function";
  // TB_useMyItems either exists for the whole session or never does, so the
  // hook call is stable across renders.
  const rows = typeof TB_useMyItems === "function" ? TB_useMyItems(email, canCount) : [];
  if (given) return given;
  if (!canCount) return null;
  return countDueStaffItems(rows, email, todayLocal(), Date.now());
}

// The small count on the Tasks tab, read aloud as "3 due, 1 overdue". Only
// mounted when there is a count: NAV_TabRow draws the pill around any badge
// it is given, so an empty one would show as an empty pill.
function WK_TasksBadge({ due }) {
  const parts = [`${due.due} due`];
  if (due.overdue) parts.push(`${due.overdue} overdue`);
  return (
    <>
      <span aria-hidden="true">{due.due}</span>
      <span className="wk-sr">{parts.join(", ")}</span>
    </>
  );
}

function WK_WorkPage({ clients, staffUser, statusOverrides, canManageTemplates, canCreateTemplates, onOpenTemplates, myTasksDue }) {
  const isAdmin = !!(staffUser && staffUser.role === "admin");
  const tabs = NAV_visibleTabs("work", { isAdmin });
  const keys = tabs.map((t) => t.key);
  const [tab, setTab] = NAV_useHashSub("work", keys, "tasks");
  const due = WK_useTasksDue(staffUser, myTasksDue);

  const rowTabs = tabs.map((t) => ({
    key: t.key,
    label: t.label,
    tour: "work-" + t.key,
    badge: t.key === "tasks" && due && due.due > 0 ? <WK_TasksBadge due={due} /> : null,
  }));

  let body = null;
  if (tab === "tasks") {
    body =
      typeof MyTasksPage === "function" ? (
        <MyTasksPage
          staffUser={staffUser}
          clients={clients}
          statusOverrides={statusOverrides}
          canManageTemplates={canManageTemplates}
          canCreateTemplates={canCreateTemplates}
          onOpenTemplates={onOpenTemplates}
        />
      ) : (
        <p className="card-subtitle">Tasks aren't available right now.</p>
      );
  } else if (tab === "close") {
    body =
      typeof CT_CloseTrackerPage === "function" ? (
        <CT_CloseTrackerPage clients={clients} staffUser={staffUser} />
      ) : (
        <p className="card-subtitle">The close tracker isn't available right now.</p>
      );
  } else if (tab === "deadlines") {
    body =
      typeof DL_DeadlinesPage === "function" ? (
        <DL_DeadlinesPage clients={clients} staffUser={staffUser} />
      ) : (
        <p className="card-subtitle">Deadlines aren't available right now.</p>
      );
  }

  // App's page header already shows "Work" and its subtitle (PAGE_META), so
  // the hub starts at the tab row.
  return (
    <div className="wk-page">
      <NAV_TabRow label="Work" tabs={rowTabs} current={tab} onSelect={setTab} idPrefix="wk" />
      <div id="wk-panel" role="tabpanel" aria-labelledby={"wk-tab-" + tab}>
        {body}
      </div>
    </div>
  );
}
