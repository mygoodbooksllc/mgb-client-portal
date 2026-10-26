// ----------------------------------------------------------------------------
// TOUR_slateLogic.js — "Slate, start to finish": the presenter tour of every
// live part of Slate (staff demo 2026-10-26). Steps, chapters and the
// read-only navigation they use. Tour.jsx runs it (TOUR_STAFF_TOURS key
// "slate", the big card with a chapter picker); TOUR_slateLogic.test.js checks
// it in node.
//
// HARD RULE: a step only navigates and opens. No step creates, edits,
// completes, deletes, sends, asks a client, approves, sends back or bulk
// changes anything. Write features are pointed at and explained; the presenter
// does them live. Every `go` is built from TOUR_slNav / TOUR_slOpenDemo /
// TOUR_slSettings below, which only set location.hash, close the task details
// (a UI state, nothing saved) or open a task's details (TK_vOpenTask).
//
// The demo client is Pro Test Client (grace-community, a test client with
// [Demo] tasks). Never a real client. A task step opens the first [Demo] task
// on that list, else the first top-level task there, else nothing (the card
// is centered and the step still reads fine).
//
// Every step has a `go`, so Back and Next always land on the right screen and
// TOUR_visibleStaffSteps never drops one (the chapter picker's indexes hold).
// A target missing in this window (an app-only control in the portal, an
// admin-only one) centers the card after the usual short search.
//
// Loaded before Tour.jsx (index.html __SOURCE_ORDER), plain globals with a
// TOUR_sl / TOUR_SLATE prefix; no React here.
// ----------------------------------------------------------------------------

var TOUR_SLATE_CLIENT = "grace-community";
var TOUR_SLATE_CLIENT_HASH = "#/tasks/c/" + TOUR_SLATE_CLIENT;

var TOUR_SLATE_CHAPTERS = [
  { key: "day", label: "Your day" },
  { key: "client", label: "Client lists" },
  { key: "task", label: "Working a task" },
  { key: "speed", label: "Speed" },
  { key: "team", label: "Team flow" },
  { key: "auto", label: "Automation" },
  { key: "setup", label: "Your setup" },
];

// True when a hash asks for the tour: #/tasks/...?tour=slate (the portal's ?
// menu opens the Slate app with it; also the dry-run link).
function TOUR_slateHashAsks(hash) {
  return /^#\/tasks(\/[^?#]*)?\?(?:[^#]*&)?tour=slate(?:&|$)/.test(String(hash || ""));
}

// The hash's path, without its query (#/tasks/my?tour=slate -> #/tasks/my).
function TOUR_slHashPath(hash) {
  return String(hash || "").split("?")[0];
}

// The task the demo opens: the first top-level, not deleted [Demo] task, else
// the first top-level one. `tasks` is a list of task rows. Id string or null.
function TOUR_slPickTask(tasks) {
  var list = (Array.isArray(tasks) ? tasks : []).filter(function (t) {
    return t && t.id != null && !t.deleted_at && (t.parent_id == null || t.parent_id === "");
  });
  var demo = list.find(function (t) {
    return /^\s*\[demo\]/i.test(String(t.text || t.title || ""));
  });
  var pick = demo || list[0] || null;
  return pick ? String(pick.id) : null;
}

// Cmd on a Mac, Ctrl elsewhere.
function TOUR_slMod() {
  try {
    return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "") ? "Cmd" : "Ctrl";
  } catch (e) {
    return "Ctrl";
  }
}

// ---- Read-only navigation ----------------------------------------------------

// Closes an open task's details (the drawer or the app's detail pane): a UI
// state only (the same action as its Close button), nothing is saved.
function TOUR_slCloseTask() {
  try {
    var st = typeof TK_store !== "undefined" && TK_store && TK_store.getState ? TK_store.getState() : null;
    if (st && st.drawerId != null && typeof TK_dwDispatch === "function") {
      TK_dwDispatch({ type: "drawer", id: null });
      return true;
    }
  } catch (e) {}
  return false;
}

// A step's go: close any open task, then open `hash` unless it's already the
// page. False when nothing changed (no wait needed).
function TOUR_slNav(hash) {
  return function () {
    var closed = TOUR_slCloseTask();
    if (TOUR_slHashPath(window.location.hash) === hash) return closed ? undefined : false;
    window.location.hash = hash;
    return undefined;
  };
}

// Settings lives in the Slate app only (TK_App shows it there); elsewhere the
// step stays on My Slate and its card is centered.
function TOUR_slSettings() {
  return function () {
    var inApp = typeof TK_slateInApp === "function" && TK_slateInApp();
    return TOUR_slNav(inApp ? "#/tasks/settings" : "#/tasks/my")();
  };
}

// The demo task's id from the loaded Pro Test Client list, or null.
function TOUR_slDemoId() {
  try {
    var st = typeof TK_store !== "undefined" && TK_store && TK_store.getState ? TK_store.getState() : null;
    var L = st && st.lists ? st.lists["client:" + TOUR_SLATE_CLIENT] : null;
    if (!L || !Array.isArray(L.ids)) return null;
    return TOUR_slPickTask(
      L.ids.map(function (id) {
        return st.tasks[id];
      }),
    );
  } catch (e) {
    return null;
  }
}

// A step's go: Pro Test Client's list, then that list's demo task's details
// (only opening them; read-only). Waits up to ~2.4 s for the list to load;
// with no task there it opens nothing.
function TOUR_slOpenDemo() {
  return function () {
    var moved = false;
    if (TOUR_slHashPath(window.location.hash) !== TOUR_SLATE_CLIENT_HASH) {
      TOUR_slCloseTask();
      window.location.hash = TOUR_SLATE_CLIENT_HASH;
      moved = true;
    }
    var tries = 0;
    var tryOpen = function () {
      if (TOUR_slHashPath(window.location.hash) !== TOUR_SLATE_CLIENT_HASH) return;
      var id = TOUR_slDemoId();
      if (!id) {
        if (tries++ < 16) setTimeout(tryOpen, 150);
        return;
      }
      var st = typeof TK_store !== "undefined" && TK_store && TK_store.getState ? TK_store.getState() : null;
      if (st && (String(st.drawerId) === id || String(st.deskTaskId) === id)) return;
      if (typeof TK_vOpenTask === "function") TK_vOpenTask(id, { from: "list" });
    };
    // After a hash change the drawer closes itself for 500 ms of arrivals
    // only; open just after that.
    setTimeout(tryOpen, moved ? 550 : 0);
    return undefined;
  };
}

// ---- Steps -------------------------------------------------------------------

// ctx: the staff tour ctx (isAdmin, showsAdminPages, ...). Each step:
// { id, chapter, title, body(), targets, go, wait, spot }.
function TOUR_slateSteps(ctx) {
  var c = ctx || {};
  void c;
  var mod = TOUR_slMod();
  var api = typeof TK_api !== "undefined" && TK_api ? TK_api : {};
  var depth = api.UNDO_DEPTH_SLATE || 5;
  var mins = Math.round((api.SLATE_UNDO_MS || 9 * 60 * 1000) / 60000);
  var my = TOUR_slNav("#/tasks/my");
  var client = TOUR_slNav(TOUR_SLATE_CLIENT_HASH);
  var demo = TOUR_slOpenDemo();
  var s = function (chapter, id, title, body, targets, go, spot) {
    return { id: id, chapter: chapter, title: title, body: typeof body === "function" ? body : function () { return body; }, targets: targets, go: go, wait: true, spot: spot };
  };
  return [
    // 1 Your day
    s("day", "sl-welcome", "Slate, start to finish",
      "Seven short chapters, from your day to your settings. Use the arrow keys, or jump with Chapters.",
      [], my),
    s("day", "sl-my", "My Slate",
      "Everything on you: Overdue, Today, This week, Later, Waiting on client, Unassigned and Done.",
      ["tk-groups"], my, "top"),
    s("day", "sl-chips", "Mine today",
      "Mine today shows only what's yours and due now. Waiting on client shows what's out with clients.",
      ["tk-slate-chips"], my),
    s("day", "sl-groupby", "Group by",
      "Group by due date, client, 4th/14th/24th or status. Slate remembers how you left it.",
      ["tk-groupby"], my),
    s("day", "sl-sort", "Sort",
      "Sort inside each group by due date, priority, status or name. Click again to flip the order.",
      ["tk-slate-sort"], my),
    s("day", "sl-views", "Saved views",
      "In the Slate app, Views saves a setup under a name, so you can switch back in one click.",
      ["tk-slate-views"], my),
    // 2 Client lists
    s("client", "sl-client", "One list per client",
      "Every client has its own list. This is Pro Test Client, our demo client.",
      ["tk-sections"], client, "top"),
    s("client", "sl-people", "Who's on the client",
      "Bookkeeper, backup, account manager and reviewer sit right in the header.",
      ["tk-ch-people"], client),
    s("client", "sl-sections", "Sections",
      "Weekly, Monthly, Quarterly and Annual work each get a section. Click a heading to fold it.",
      ["tk-sections"], client, "top"),
    s("client", "sl-links", "SOP, Drive and contacts",
      "Open the client, its SOP, its Drive folder and its contacts from here.",
      ["tk-ch-links"], client),
    s("client", "sl-qbo", "QuickBooks status",
      "This pill shows whether the client's QuickBooks connection is working.",
      ["tk-ch-qbo"], client),
    s("client", "sl-sharing", "Private or shared",
      "Client tasks are shared with the client's team. Untick this box to keep one private.",
      ["tk-dw-sharing", "tk-dw-fields"], demo),
    // 3 Working a task
    s("task", "sl-add", "Add a task",
      "Use Add task, the add row in each section, or press q anywhere. Type @name, #client, a day like fri and !high as you go.",
      ["tk-add"], client),
    s("task", "sl-row", "Change it in place",
      "Click a row's person, due date, priority or status to change it without opening the task.",
      ["tk-status"], my),
    s("task", "sl-open", "Task details",
      "Click a task to open its details. In the portal they open in the Desk's right panel.",
      ["wb-taskview", "tk-dw-fields"], demo),
    s("task", "sl-fields", "The main fields",
      "Assignee, due date, client, project, priority and status sit at the top.",
      ["tk-dw-fields"], demo),
    s("task", "sl-subtasks", "Subtasks",
      "Break a task into steps. Each subtask has its own person and due date.",
      ["tk-dw-subtasks", "tk-dw-fields"], demo),
    s("task", "sl-checklist", "Checklist",
      "For quick tick-offs that don't need their own person or date.",
      ["tk-dw-checklist"], demo),
    s("task", "sl-thread", "Comments and activity",
      "Type @ in a comment to mention someone; they get notified. Activity shows every change and who made it.",
      ["tk-dw-thread"], demo),
    s("task", "sl-copylink", "Copy link",
      "Copies a link straight to this task, ready to paste in a message.",
      ["tk-dw-copylink"], demo),
    // 4 Speed
    s("speed", "sl-select", "Select many",
      "Tick tasks, or Shift-click a range, then change up to 100 at once from the bar that appears.",
      ["tk-select", "tk-groups"], my),
    s("speed", "sl-copy", "Copy, duplicate, paste",
      "In the Slate app, right-click a task for its menu. " + mod + "+D duplicates; " + mod + "+C and " + mod + "+V copy and paste into another list.",
      ["tk-groups"], my, "top"),
    s("speed", "sl-undo", "Undo",
      function () {
        return "In the Slate app, " + mod + "+Z undoes your last " + depth + " changes for up to " + mins + " minutes. A two-finger swipe right goes back a page.";
      },
      [], my),
    s("speed", "sl-nav", "Back, Forward, Refresh",
      "The Slate app has its own Back, Forward and Refresh buttons beside the logo.",
      ["tk-sbar-nav"], my),
    s("speed", "sl-window", "Its own window",
      "Slate opens in its own app window. Sliver, List and Full page resize it; a sliver keeps just your current task beside your other work.",
      ["tk-slate-sizes", "tk-popout"], my),
    s("speed", "sl-board", "List or board",
      "Switch a list to a board, by status or by section, and drag cards between columns.",
      ["tk-board-switch"], my),
    // 5 Team flow
    s("team", "sl-review", "Needs review",
      "Work sent for review waits here for its reviewer, never the person who did it.",
      ["tk-review-groups", "tk-review-stats"], TOUR_slNav("#/tasks/review"), "top"),
    s("team", "sl-approve", "Approve or send back",
      "Open a task here to Approve it, or Send back with a note that says what to fix.",
      ["tk-review-groups"], TOUR_slNav("#/tasks/review"), "top"),
    s("team", "sl-waiting", "Waiting on client",
      "Tasks waiting on a client land here, longest wait first, and never count as late. Ask client, which emails the client for you, is coming soon.",
      ["tk-waiting-groups", "tk-waiting-head"], TOUR_slNav("#/tasks/waiting"), "top"),
    s("team", "sl-reassign", "Change the bookkeeper",
      "Admins change a client's bookkeeper from the header, and the open tasks move across.",
      ["tk-ch-people"], client),
    s("team", "sl-noteam", "Clients waiting for a bookkeeper",
      "Admins see clients with no bookkeeper under No team yet in the lists rail, with Assign team on the client.",
      ["tk-no-team"], my),
    // 6 Automation
    s("auto", "sl-recurring", "Recurring templates",
      "Templates make tasks on a schedule: weekly, monthly, quarterly or annual.",
      ["tk-recurring-list", "tk-recurring-actions"], TOUR_slNav("#/tasks/templates"), "top"),
    s("auto", "sl-weekends", "Weekends and holidays",
      "A due date on a weekend or firm holiday moves to the next business day, or the day before.",
      ["tk-recurring-list"], TOUR_slNav("#/tasks/templates"), "top"),
    s("auto", "sl-perclient", "One client",
      "Pick a client to preview its next 60 days, and skip or change a template just for them.",
      ["tk-recurring-client"], TOUR_slNav("#/tasks/templates")),
    // 7 Your setup
    s("setup", "sl-settings", "Slate settings",
      "The gear opens your Slate settings: default view, layout, keys and undo. They're yours alone.",
      ["tk-set-view", "tk-sbar-gear"], TOUR_slSettings()),
    s("setup", "sl-notify", "Notifications",
      "Choose which task emails and alerts you get, in the portal's Settings, Notifications.",
      ["tk-set-notify"], TOUR_slSettings()),
    s("setup", "sl-help", "Replay and help",
      "Replay this tour or open the staff guide from here, or from the ? menu in the portal.",
      ["tk-set-help", "tb-help"], TOUR_slSettings()),
    s("setup", "sl-done", "That's Slate",
      "Questions? Open the staff guide, or tell us through Send feedback.",
      [], my),
  ];
}

// The index of each chapter's first step: [{ key, label, index, count }].
function TOUR_slateChapterIndex(steps) {
  var out = [];
  (steps || []).forEach(function (st, i) {
    var ch = TOUR_SLATE_CHAPTERS.find(function (x) {
      return x.key === st.chapter;
    });
    if (!ch) return;
    var last = out[out.length - 1];
    if (last && last.key === ch.key) last.count += 1;
    else out.push({ key: ch.key, label: ch.label, index: i, count: 1 });
  });
  return out;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TOUR_SLATE_CLIENT: TOUR_SLATE_CLIENT,
    TOUR_SLATE_CHAPTERS: TOUR_SLATE_CHAPTERS,
    TOUR_slateHashAsks: TOUR_slateHashAsks,
    TOUR_slHashPath: TOUR_slHashPath,
    TOUR_slPickTask: TOUR_slPickTask,
    TOUR_slateSteps: TOUR_slateSteps,
    TOUR_slateChapterIndex: TOUR_slateChapterIndex,
    TOUR_slNav: TOUR_slNav,
    TOUR_slOpenDemo: TOUR_slOpenDemo,
    TOUR_slSettings: TOUR_slSettings,
    TOUR_slCloseTask: TOUR_slCloseTask,
    TOUR_slDemoId: TOUR_slDemoId,
  };
}
