// Launch announcements: one entry per new product or feature, in the same
// commit that ships it (see "How to add an announcement" in README.md).
// The next time each person in `roles` opens the app they get one quiet
// notice (Announcements.jsx) offering a ~1 minute tour; the rules for who
// sees what and when are in announcementsLogic.js, and each person's answer
// is saved in public.staff_announcements (supabase/staff-announcements.sql).
// Every entry also stays listed in What's new (Launches) and in the ? menu,
// Cmd/Ctrl+K and Settings > Help as "New: <title> tour", so it can be rerun.
//
// STAFF SIDE ONLY today. "client" is an allowed role name so the registry
// won't need reshaping later, but nothing shows a notice to a portal client
// yet (the client portal has no notice and ANN_roleSet never returns it).
//
// Entry fields:
//   id       short, unique, lower-case with hyphens; the key in the database
//            and in the tour key "ann:<id>". Never reuse or rename one.
//   date     YYYY-MM-DD it shipped. People whose account was made after this
//            day never see it, and it stops showing 60 days later.
//   title    what is new, a few words ("Team > Reviews emails").
//   summary  one sentence for the notice and What's new.
//   roles    who it is for: admin (real admins), tempAdmin, bookkeeper
//            (includes temporary admins), accountManager. Not "client" yet.
//   hash     where "Open" goes, such as "#/team/reviews".
//   steps    (ctx) => Tour.jsx steps, 3 to 6 stops, about a minute. The
//            first is a centered welcome (no `targets`). Build the rest with
//            TOUR_tabStep(place, tab, title, body) and TOUR_go; it is a
//            function so those helpers are looked up when the tour starts.
//            Point only at targets that exist (a `#id` or a data-tour key).
//   ready    optional (ctx) => boolean. The notice waits until it is true
//            (checked every render of the notice, so it can read
//            localStorage); What's new and the ? menu list the tour anyway.
//            Use it when the feature only makes sense once the person has
//            met it, like "unassigned-tasks" (mgb_tk_seen_unassigned_v1).

// True when the Desk is on for this person (WB_store loads after this file).
function ANN_deskOn() {
  try {
    return typeof WB_store !== "undefined" && !!WB_store.getState().on;
  } catch (e) {
    return false;
  }
}

// True on a window wide enough for the Desk's right column (the phone sheet
// below 760px has no rail and no width grip).
function ANN_deskDocked() {
  try {
    return typeof window !== "undefined" && !!window.matchMedia && !window.matchMedia("(max-width: 760px)").matches;
  } catch (e) {
    return false;
  }
}

// True once the Reviews overview has loaded and this person is in reviews:
// a review of their own this cycle, reviews they're giving, or past totals.
function ANN_inReviews() {
  try {
    if (typeof TR_store === "undefined" || !TR_store.data) return false;
    var d = TR_store.data;
    return !!(d.my_review || (d.giving || []).length || (d.last_totals || []).length);
  } catch (e) {
    return false;
  }
}

var ANN_REGISTRY = [
  {
    id: "today-redesign",
    date: "2026-10-19",
    title: "A calmer Today",
    summary:
      "Today now leads with one Do next card (your top item and what comes after it) and a row of small cards: clients needing attention, waiting on others, reminders and this week. The long list lives in Slate and the Desk.",
    roles: ["admin", "bookkeeper"],
    hash: "#/today",
    steps: () => [
      {
        id: "ann-welcome",
        title: "Today, simplified",
        body: () =>
          "Today no longer repeats your whole list. It shows the one thing to do next, and a few small cards around it. About a minute.",
      },
      {
        id: "ann-next",
        targets: ["today-list"],
        wait: true,
        title: "Do next",
        body: () =>
          "Your top item, with what comes after it. The button starts or opens it. The rest of your list is one click away in Slate (and in the Desk, once it's on).",
      },
      {
        id: "ann-summary",
        targets: ["today-kpis"],
        wait: true,
        title: "The count line",
        body: () => "How many things are due today and how many are late, with a link to Slate. The four number tiles are gone.",
      },
      {
        id: "ann-cards",
        targets: ["today-cards-grid", "today-cards"],
        wait: true,
        title: "Cards you can turn off",
        body: () =>
          "Clients needing attention, Waiting on others, Reminders and This week. Use Also show at the bottom to hide any of them. Approvals, handbook and the other less common items sit under Also needs you.",
      },
    ],
  },
  {
    id: "desk-right-now",
    date: "2026-10-19",
    title: "Right now, at the top of the Desk",
    summary:
      "The open Desk now starts with your waiting counts and, on a client's page, a Right now card: open tasks, messages to answer, QuickBooks sync. With the Desk on, the top bar's + and Slate counts step aside.",
    roles: ["admin", "bookkeeper"],
    hash: "#/today",
    // Only for people who have the Desk on.
    ready: () => ANN_deskOn(),
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "The Desk follows the page",
        body: () =>
          "When you open the Desk, its top now shows what is waiting on you and what matters on the page you are on. About a minute.",
      },
      {
        id: "ann-rightnow",
        when: (c) => !!(c && c.myClient),
        go: () => {
          try {
            if (typeof TOUR_openClient === "function" && ctx && ctx.myClient) TOUR_openClient(ctx.myClient.id, "overview")();
            if (typeof WB_store !== "undefined" && !WB_store.getState().drawerOpen) WB_store.setDrawerOpen(true, "tour");
          } catch (e) {}
        },
        targets: ["wb-rightnow", "wb-glance"],
        wait: true,
        title: "Right now",
        body: () =>
          "On a client's page the Desk shows a Right now card: your open tasks (late ones marked), messages to answer and the oldest wait, questions waiting on the client, a month close problem and the QuickBooks sync. Click the tasks line for the Client tab, or the messages line to answer. On Inbox it shows what waits on you. Above it, the counts the rail shows while closed; click one to filter.",
      },
      {
        id: "ann-topbar",
        title: "Fewer duplicates at the top",
        body: () =>
          "With the Desk on, the top bar's Slate button is a plain link to Slate (your counts are in the Desk bar), the top bar's + moves to the foot of the rail on a computer, and Today drops its four number tiles (the filter buttons keep their counts). Turn the Desk off and they all come back.",
      },
    ],
  },
  {
    id: "desk-task-view",
    date: "2026-10-19",
    title: "Tasks open in the Desk",
    summary:
      "With the Desk on, a task you open shows in the Desk column beside the page instead of a pop-up. Back and Esc step back, F6 moves between the Desk and the page.",
    roles: ["admin", "bookkeeper"],
    hash: "#/tasks/my",
    // Only for people who have the Desk on.
    ready: () => ANN_deskOn(),
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "Tasks open beside the page",
        body: () =>
          "Open a task from Slate, My Tasks, a client's page, the bell or a link and it now shows in the Desk column, so the list stays in view. On a phone it fills the Desk sheet.",
      },
      {
        id: "ann-row",
        targets: ["tk-status"],
        title: "Try it on any task",
        body: () =>
          "Click a task's name and its details open in the Desk on the right, with the row marked here. Status, assignee, comments and the rest work the same as in the pop-up.",
      },
      {
        id: "ann-keys",
        title: "Getting back",
        body: () =>
          "Back at the top of the task (or Esc) steps back: from a subtask to its parent, then to the list. D closes the Desk and the task waits 5 minutes for you. F6 moves between the Desk and the page. On a client's page, t opens the Desk's Client tab.",
      },
    ],
  },
  {
    id: "desk-right-launch",
    date: "2026-10-19",
    title: "The Desk moves to the right",
    summary:
      "The Desk now lives on the right: a slim rail with your message, review, file and mention counts, a column that opens beside the page, and an info bar along the bottom.",
    roles: ["admin", "bookkeeper"],
    hash: "#/today",
    // Only for people who have the Desk on.
    ready: () => ANN_deskOn(),
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "Your Desk, on the right",
        body: () =>
          "The Desk moved from the bottom of the page to the right side. Nothing inside it changed: Inbox, Slate and Client are still its tabs, and D still opens and closes it. About a minute.",
      },
      {
        id: "ann-bar",
        targets: ["wb-bar"],
        title: "The info bar",
        body: () =>
          "This bar along the bottom shows how many tasks are late, how many of today's you have done, your next task and, on a client's pages, that client's open tasks and QuickBooks sync. Click it or press D to open the Desk.",
      },
      {
        id: "ann-rail",
        when: () => ANN_deskDocked(),
        go: () => {
          try {
            if (typeof WB_store !== "undefined" && WB_store.getState().drawerOpen) WB_store.setDrawerOpen(false, "tour");
          } catch (e) {}
        },
        targets: ["wb-rail"],
        title: "The rail",
        body: () =>
          "While the Desk is closed, this slim rail shows four counts: messages, reviews, files and mentions. Point at one to see the latest few, or click it to open them. The chat bubble is gone while the Desk is on: the messages icon opens chat. The + at the foot adds a task or message.",
      },
      {
        id: "ann-handle",
        when: () => ANN_deskDocked(),
        go: () => {
          try {
            if (typeof WB_store !== "undefined" && !WB_store.getState().drawerOpen) WB_store.setDrawerOpen(true, "tour");
          } catch (e) {}
        },
        targets: ["wb-desk-handle"],
        wait: true,
        title: "Make it wider or narrower",
        body: () =>
          "The open Desk sits beside the page and pushes it over on a wide screen (on a smaller one it sits over the page). Drag its left edge to change the width; it remembers yours. Esc goes back to the rail.",
      },
      {
        id: "ann-done",
        title: "That's it",
        body: () =>
          "On a phone the Desk still opens full screen from the bar. To see this again, press ? and pick New: The Desk moves to the right, or read Use the Desk in the guide.",
      },
    ],
  },
  {
    id: "one-avatar",
    date: "2026-10-19",
    title: "Settings and Sign out are at the top right",
    summary: "The left sidebar no longer shows your name, Settings or Sign out. Click your picture or initials at the top right for Settings, dark mode, Preview as and Sign out.",
    roles: ["admin", "bookkeeper"],
    hash: "#/today",
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "One place for your account",
        body: () =>
          "Your name, Settings and Sign out used to be in two places, the left sidebar and the top right. They now live only at the top right, and the sidebar is just the places. About half a minute.",
      },
      {
        id: "ann-avatar",
        title: "Your account menu",
        // Phones hide the top bar's account menu (top-bar.css) and keep
        // Settings and Sign out in the drawer, so point there instead.
        body: (key) =>
          key === "staff-nav-settings"
            ? "On a phone, Settings and Sign out are here in the menu, as before."
            : "Click your picture or initials for Settings, dark mode, Preview as (on a client's pages) and Sign out. The page itself works exactly as before.",
        targets: ["tb-avatar", "staff-nav-settings"],
        drawer: true,
      },
      {
        id: "ann-done",
        title: "That's it",
        body: () =>
          "The sidebar keeps Today, Inbox, Work, Clients and Team, with Expand and Collapse at the bottom. To see this again, press ? and pick New: Settings and Sign out are at the top right tour.",
      },
    ],
  },
  {
    id: "team-reviews-final-email",
    date: "2026-10-19",
    title: "Final scores when a review locks",
    summary: "When a review is signed by both and locks, the team member and the reviewer each get one email with the final scores, the change from the last locked review and the agreed action steps. The same comparison shows on the locked review.",
    roles: ["admin", "bookkeeper"],
    hash: "#/team/reviews",
    // Only for people who take part in reviews (the overview has loaded and has something for them).
    ready: () => ANN_inReviews(),
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "Final scores, by email and on the review",
        body: () =>
          "When both of you sign a quarterly review, you each get one email with the final scores (the reviewer's ratings), how each area changed from the last locked review (Up, Down or No change) and the agreed action steps. About half a minute.",
      },
      TOUR_tabStep(
        "team",
        "reviews",
        "Team › Reviews",
        "Open a locked review here to see the same numbers under Compared with last quarter. If the last locked review wasn't the quarter right before, it says which quarter it compares with; a first review has nothing to compare yet.",
      ),
      {
        id: "ann-done",
        title: "That's it",
        body: () =>
          "The email never includes comments or self-review scores, and adding an addendum doesn't send it again. To see this again, press ? and pick New: Final scores when a review locks tour.",
      },
    ],
  },
  {
    id: "tasks-field-grid",
    date: "2026-10-19",
    title: "Task details fields at the top",
    summary: "A task's details now open with Assignee, Due, Client, Project, Priority and Status together at the top, and empty ones say so (Unassigned, No due date, No client, No project).",
    roles: ["admin", "bookkeeper"],
    hash: "#/tasks/my",
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "The main fields, together",
        body: () =>
          "When you open a task, the six fields you change most now sit in one block right under the title. About half a minute.",
      },
      {
        id: "ann-open",
        title: "Open any task",
        body: () =>
          "Click a task on your Slate to open its details. Nothing else about opening, closing or the keys has changed.",
        targets: ["tk-groups"],
      },
      {
        id: "ann-fields",
        title: "Assignee, Due, Client, Project, Priority, Status",
        body: () =>
          "Each field has its name on the left. An empty one shows faint text such as No due date, so you can see what's missing. Status moved here from beside the title. Description, subtasks, comments and Ask client are below as before. To see this again, press ? and pick New: Task details fields at the top tour.",
        // Only on the page while a task's details are open; centered otherwise.
        targets: ["tk-dw-fields"],
        wait: true,
      },
    ],
  },
  {
    id: "tasks-inline-edit",
    date: "2026-10-19",
    title: "Task rows you can change in place",
    summary: "Click a task's person badge, due date or priority to change it right on the row, and use the Add task row at the bottom of each group to add one fast. Red means overdue, amber means due today.",
    roles: ["admin", "bookkeeper"],
    hash: "#/tasks/my",
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "Change a task without opening it",
        body: () =>
          "Each task row now has a person badge, a due date and a priority you can click to change in place, and an Add task row at the bottom of every group. About a minute.",
      },
      {
        id: "ann-row",
        title: "Click what you want to change",
        body: () =>
          "The round badge is the person (a dashed circle means nobody yet), the chip is the due date (red is overdue, amber is today) and the dot is the priority. Click one and pick. Hover a row for the ... menu: Open, Mark done, Claim and Copy link. The status pill works as before.",
        targets: ["tk-status"],
      },
      {
        id: "ann-add",
        title: "Add task at the bottom of a group",
        body: () =>
          "Click Add task at the bottom of Today, This week or Later, type a name and press Enter. It's made with that group's day, and the box stays open for the next one. Esc closes it. To see this again, press ? and pick New: Task rows you can change in place tour.",
        targets: ["tk-groups"],
      },
    ],
  },
  {
    id: "rail-default",
    date: "2026-10-17",
    title: "The sidebar starts as icons",
    summary: "The left sidebar now opens as the narrow icon rail so pages get more room. Hover or tab to an icon for its name, and click Expand to keep the names showing; it remembers your choice.",
    roles: ["admin", "bookkeeper"],
    hash: "#/today",
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "More room for the page",
        body: () =>
          "The left sidebar now starts as a narrow icon rail, with the name under each icon, so the page beside it has more room. About a minute.",
      },
      {
        id: "ann-rail",
        title: "Names on hover",
        body: () =>
          "Hover over an icon, or tab to it, to see its full name. Today, Inbox, Work, Clients and Team work exactly as before.",
        targets: ["staff-nav"],
      },
      {
        id: "ann-expand",
        title: "Expand it if you like",
        body: () =>
          "Click Expand at the bottom of the sidebar to show the full names. It stays that way for you until you click Collapse. Settings and Sign out are in the menu under your picture at the top right. To see this again, press ? and pick New: The sidebar starts as icons tour.",
        targets: ["staff-rail-collapse"],
      },
    ],
  },
  {
    id: "dup-smart",
    date: "2026-10-17",
    title: "Smarter duplicate checks",
    summary: "Ledger review's Possible duplicate check now has a Smart mode (the new default) that sets aside look-alikes that are clearly not duplicates, and a Strict mode that flags every same-date, same-amount match.",
    roles: ["admin", "bookkeeper"],
    hash: "#/team/ledger",
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "Fewer false duplicate flags",
        body: () =>
          "Ledger review now has two ways to check for a Possible duplicate. Smart is the new default and skips look-alikes that are clearly not duplicates. Strict is the old rule. About a minute.",
      },
      {
        id: "ann-skips",
        title: "What Smart sets aside",
        body: () =>
          "Smart leaves out amounts under $1, a Payment and a Deposit that pass through Undeposited Funds, entries with different memos or different invoice numbers, and the lines of one split transaction. Different dates never match, so monthly payments don't flag.",
      },
      TOUR_tabStep(
        "team",
        "ledger",
        "Smart or Strict",
        "Admins pick Smart or Strict here in Ledger review settings for the whole firm, and a client can be set differently. A change to Smart applies on the next Pull; Strict brings hidden flags back right away. Each change is written to the Audit log.",
      ),
      {
        id: "ann-done",
        title: "Nothing is lost",
        body: () =>
          "Each client's Ledger review shows a Smart or Strict chip, and Smart lists the flags it set aside. Anything unclear still flags, and your Ask, Clear and note decisions are never touched. To see this again, press ? and pick New: Smarter duplicate checks tour.",
      },
    ],
  },
  {
    id: "late-task-grace",
    date: "2026-10-17",
    title: "No late-task penalties yet",
    summary: "No late-task penalties yet while everyone settles in. Late and overdue tasks are not counted in scores or reports until the owner turns it on. Filing deadlines still count.",
    roles: ["admin", "bookkeeper"],
    hash: "#/tasks/my",
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "A grace period for late tasks",
        body: () =>
          "No late-task penalties yet while everyone settles in. For now, a late or overdue task is not counted in your performance score, client health, on-time rates or the weekly digest. About a minute.",
      },
      {
        id: "ann-still",
        title: "What still counts",
        body: () =>
          "Filing deadlines are not tasks, so they still count. Your own Slate still shows what is due and what is overdue, as a reminder for you.",
      },
      {
        id: "ann-done",
        title: "When it changes",
        body: () =>
          "The owner decides when late tasks start to count, probably when Slate fully rolls out next quarter. Only tasks due after that day will count, so nothing from the past is held against anyone. To see this again, press ? and pick New: No late-task penalties yet tour.",
      },
    ],
  },
  {
    id: "desk-launch",
    date: "2026-10-17",
    title: "The Desk: glass, resizable, D to open",
    summary:
      "The Desk now sits over the page as a glass panel you can drag taller or shorter, and the page behind it keeps working. Press D to open and close it (W no longer does).",
    roles: ["admin", "bookkeeper"],
    hash: "#/today",
    // Only for people who have the Desk on.
    ready: () => ANN_deskOn(),
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "Your Desk, updated",
        body: () =>
          "The Workbench is now called the Desk, it has a new glass look, you can make it taller or shorter, and the page stays usable while it is open. The shortcut is now D. About a minute.",
      },
      {
        id: "ann-bar",
        targets: ["wb-bar"],
        wait: true,
        title: "Press D, or click the bar",
        body: () =>
          "The bar at the bottom of every page is the Desk. Click it or press D (not while typing) to open and close it. W no longer opens it. Your Inbox, your Slate and one Client are tabs inside, as before.",
      },
      {
        id: "ann-handle",
        when: () => ANN_deskDocked(),
        go: () => {
          try {
            if (typeof WB_store !== "undefined" && !WB_store.getState().drawerOpen) WB_store.setDrawerOpen(true, "tour");
          } catch (e) {}
        },
        targets: ["wb-desk-handle"],
        wait: true,
        title: "Drag the left edge to change the width",
        body: () =>
          "The Desk now opens as a column on the right. Drag its left edge to make it wider or narrower; it settles at narrow, standard or wide and remembers your width. You can also focus the edge and use the arrow keys.",
      },
      {
        id: "ann-page",
        title: "The page keeps working",
        body: () =>
          "Nothing is dimmed behind the Desk any more: scroll, click and use page shortcuts like q while it is open. Esc goes back one step only while you are working inside the Desk. On a phone it still opens full height. To see this again, press ? and pick the New: tour for this change.",
      },
    ],
  },
  {
    id: "desk-rename",
    date: "2026-10-17",
    // Wording follows whether the Desk is on for this person: someone who
    // never had the Workbench only hears about Slate.
    get title() {
      return ANN_deskOn() ? "Workbench is now Desk, Tasks is now Slate" : "Tasks is now Slate";
    },
    get summary() {
      return ANN_deskOn()
        ? "Two names changed and nothing else: the Workbench is now the Desk, and Tasks is now Slate. Your tasks, lists and shortcuts are all where they were."
        : "One name changed and nothing else: Tasks is now Slate. Your tasks, lists and shortcuts are all where they were.";
    },
    roles: ["admin", "bookkeeper"],
    hash: "#/tasks/my",
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: ANN_deskOn() ? "Two new names" : "Tasks is now Slate",
        body: () =>
          (ANN_deskOn() ? "The Workbench is now the Desk, and Tasks is now Slate." : "Tasks is now Slate.") +
          " Only the names changed: your tasks, lists, projects and keyboard shortcuts work the same. About a minute.",
      },
      {
        id: "ann-bar",
        when: () => ANN_deskOn(),
        targets: ["wb-bar"],
        wait: true,
        title: "The Desk",
        body: () =>
          "The bar at the bottom of the page is the Desk. Click it or press D and it opens with tabs for your Inbox, your Slate and one Client. The full-page list on Today is still called Today, with the list titled Needs you.",
      },
      {
        id: "ann-done",
        title: "Same place, new name",
        body: () =>
          "Work › Slate and the Slate button in the top bar are where Work › Tasks and the Tasks button used to be, and old links still work. The guide articles use the new names too. To see this again, press ? and pick the New: tour for this change in that menu.",
      },
    ],
  },
  {
    id: "tasks-bulk-undo",
    date: "2026-10-16",
    title: "Select many tasks, with Undo",
    summary: "Tick several tasks to complete, reassign, move, reschedule or delete them together. Done, delete and reassign now come with Undo.",
    roles: ["admin", "bookkeeper"],
    hash: "#/tasks/my",
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "Select many tasks at once",
        body: () =>
          "In My Tasks and every list you can now pick several tasks and act on them together: complete, reopen, reassign, move to a project, change the due date or delete. And most changes can be undone. About a minute.",
      },
      {
        id: "ann-select",
        go: () => {
          if (!/^#\/tasks\/my(\?|$)/.test(window.location.hash || "")) window.location.hash = "#/tasks/my";
        },
        targets: ["tk-select", "tk-groups"],
        wait: true,
        spot: "top",
        title: "Tick to select",
        body: () =>
          "Each row has a checkbox at its left (it shows when you point at the row). Tick it, or press v on the focused row; Shift-click or Shift+V picks a whole run. A bar at the bottom shows how many you picked and what you can do. Esc clears.",
      },
      {
        id: "ann-done",
        title: "Skips are listed, and Undo",
        body: () =>
          "Complete never touches a task that's in review or waiting on a client; the bar says how many it skipped and why, and you can open each one. After a change, the message has Undo for 10 seconds, or press Ctrl+Z (Cmd+Z on a Mac). To see this again, press ? and pick New: Select many tasks, with Undo tour.",
      },
    ],
  },
  {
    id: "close-checklist-tasks",
    date: "2026-10-16",
    title: "Close steps can be tasks",
    summary: "For a client that has it turned on, five Close steps become month-end tasks, and ticking a step moves its task. Off for every client to start.",
    roles: ["admin", "bookkeeper"],
    hash: "#/tasks/templates",
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "Close steps can be tasks",
        body: () =>
          "For a client that has it turned on, bank feed, bank rec, card rec, entries and review become tasks each month, and the step and its task stay in step. It's off for every client while the firm tries it on one or two. About a minute.",
      },
      {
        id: "ann-steps",
        when: (c) => !!(c && c.myClient),
        go: () => {
          if (typeof TOUR_openClient === "function" && ctx && ctx.myClient) TOUR_openClient(ctx.myClient.id, "close")();
        },
        targets: ["close-steps"],
        wait: true,
        spot: "top",
        title: "On the Close tab",
        body: () =>
          "A step with a task shows who has it and its status; click it to open the task. Ticking the step moves the task, and a message says what happened (Sent for review, Ask an admin to reopen). When QuickBooks shows bank feed or bank rec is done, a Looks done line offers Mark done. It never ticks by itself.",
      },
      {
        id: "ann-switch",
        go: () => {
          if (!/^#\/tasks\/templates(\?|$)/.test(window.location.hash || "")) window.location.hash = "#/tasks/templates";
        },
        targets: ["tk-recurring-client"],
        wait: true,
        spot: "top",
        title: "Turning it on for a client",
        body: () =>
          "Under One client, pick the client and turn on Create month-end tasks from the Close checklist (admins and the client's account manager). The first tasks are next month's close unless you tick Also this month. If the client already has templates that look like month-end work, you'll be told so you can skip them.",
      },
      {
        id: "ann-done",
        title: "That's it",
        body: () =>
          "The guide has the full list of what a tick does in each case: How do Close checklist steps become tasks? To see this again, press ? and pick New: Close steps can be tasks tour.",
      },
    ],
  },
  {
    id: "tasks-quick-add-plain-words",
    date: "2026-10-16",
    title: "Quick add understands plain words",
    summary: "Type a task the way you'd say it, like Send the payroll summary for Sierra re Example Church by Friday, and quick add picks the person, client and due date.",
    roles: ["admin", "bookkeeper"],
    hash: "#/tasks/my",
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "Quick add reads plain words",
        body: () =>
          "Type a task the way you'd say it and quick add picks out the person, the client and the due date, and shows what it understood before you save. About a minute.",
      },
      {
        id: "ann-quick",
        targets: ["tb-quick", "wb-rail-add"],
        wait: true,
        title: "Try it from the + button",
        body: () =>
          "Click + then New task (or press q) and type something like: Send the payroll summary for Sierra re Example Church by Friday. A Will add line shows who, which client and when, before you save.",
      },
      {
        id: "ann-done",
        title: "Nothing is guessed",
        body: () =>
          "A name it doesn't know stays in the title. If a name fits more than one person or client, Did you mean offers each choice, and the x on a plain-words chip puts its words back. To see this again, press ? and pick New: Quick add understands plain words tour.",
      },
    ],
  },
  {
    id: "workbench-launch",
    date: "2026-10-16",
    title: "The Workbench",
    summary: "Today is now one ordered list of everything that needs you (tasks, reviews, client messages, Ledger flags and new client files), and a drawer at the bottom of every page shows it too. Press D.",
    roles: ["admin", "bookkeeper"],
    hash: "#/today",
    // Only once the Workbench is on for this person (the owner's wb_enabled
    // switch, or the Workbench preview flag), so nobody is toured through
    // tiles they can't see. Classic Today keeps it waiting.
    ready: () => typeof WB_store !== "undefined" && !!WB_store.getState().on,
    steps: (ctx) => {
      const on = () => typeof WB_store !== "undefined" && !!WB_store.getState().on;
      const goToday = () => {
        if (!/^#\/today(\?|$)/.test(window.location.hash || "")) window.location.hash = "#/today";
      };
      return [
        {
          id: "ann-welcome",
          title: "Everything that needs you, in one list",
          body: () =>
            "Today now pulls your tasks, reviews, client messages, Ledger flags and new client files into one list, most urgent first, and the same list sits in a drawer at the bottom of every page. About a minute.",
        },
        {
          id: "ann-row",
          when: on,
          targets: ["wb-row-action", "wb-list"],
          wait: true,
          title: "One button does the next thing",
          body: () =>
            "Today shows your top item with one main button (Reply, Start, Open, Review or File). The full list, with Snooze, No reply needed and Mark checked (each with Undo), is in the Desk.",
        },
        {
          id: "ann-bar",
          when: on,
          targets: ["wb-bar"],
          wait: true,
          title: "The drawer, on every page",
          body: () =>
            "This bar runs across the bottom of the page and shows what is late, today's progress and your next task. Click it or press D anywhere (not while typing) and the Desk opens as a column on the right, with tabs for your Inbox, Slate and one Client's tasks; Esc closes it.",
        },
        {
          id: "ann-done",
          title: "That's it",
          body: () =>
            "Messages you've answered, tasks you've finished and files you've checked drop off by themselves. To see this again, press ? and pick New: The Workbench tour, or read Use the Workbench in the guide.",
        },
      ];
    },
  },
  {
    id: "team-reviews-self-review-emails",
    date: "2026-10-15",
    title: "Team › Reviews emails",
    summary: "Reviewers are now emailed when the person they review submits their self-review first (no scores, once per review).",
    roles: ["admin"],
    hash: "#/team/reviews",
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "Reviewers now hear when a self-review is in",
        body: () =>
          "A quick look at what changed on Team › Reviews. When someone submits their self-review before you've done yours, you now get an email. About a minute.",
      },
      TOUR_tabStep(
        "team",
        "reviews",
        "Team › Reviews",
        "Quarterly reviews live here. The email links straight to your form for that person, so you can start without hunting for it.",
      ),
      {
        id: "ann-giving",
        when: (c) => !!c.isAdmin,
        go: () => {
          if (typeof TR_goReviews === "function") TR_goReviews("giving");
        },
        targets: ["#tr-tab-giving"],
        wait: true,
        title: "Reviews I’m giving",
        body: () =>
          "The reviews waiting on you are listed here, with a number on the Reviews tab. The email never includes the person's scores or answers, and it comes once per review, even if an admin reopens their form.",
      },
      {
        id: "ann-done",
        title: "That's it",
        body: () =>
          "If you've already submitted your own review, you won't get the email (the comparison email covers that). To see this again, press ? and pick New: Team › Reviews emails tour.",
      },
    ],
  },
  {
    id: "month-sign-off",
    date: "2026-10-15",
    title: "Admin sign-off for each month",
    summary: "Bookkeepers now mark a month Ready for sign-off; only an admin signs it off (Done), and reopening needs a reason.",
    roles: ["admin", "bookkeeper"],
    hash: "#/work/close",
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "Months are now signed off by an admin",
        body: () =>
          "A quick look at how a month gets finished now. The Review status is now Ready for sign-off, and only an admin can make a month Done. About a minute.",
      },
      TOUR_tabStep(
        "work",
        "close",
        "Work › Close",
        "Every client's months are here. A month marked Ready for sign-off shows as Ready; an admin signs it off from the cell, which emails the client that reports are ready.",
      ),
      {
        id: "ann-grid",
        go: TOUR_go("work", "close"),
        targets: ["close-grid"],
        wait: true,
        title: "Ready, then signed off",
        body: () =>
          ctx && ctx.isAdmin
            ? "Click a cell and pick Done (sign off). Open tasks for the month only warn. To reopen a signed-off month, pick another status and say why."
            : "Click a cell and pick Ready for sign-off when your part is finished. Your on-time score counts from then, not from the sign-off.",
      },
      {
        id: "ann-done",
        title: "That's it",
        body: () =>
          "On a client's Close tab the button now reads Mark {Month} ready for sign-off (admins: Sign off {Month}). To see this again, press ? and pick New: Admin sign-off for each month tour.",
      },
    ],
  },
  {
    id: "task-review",
    date: "2026-10-15",
    title: "Task review and on-time",
    summary: "Work that needs review now goes to a named reviewer (never the person who did it), send-backs need a note, and Review in the Tasks sidebar lists everything waiting.",
    roles: ["admin", "bookkeeper"],
    hash: "#/tasks/review",
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "Task review got a proper loop",
        body: () =>
          ctx && ctx.isAdmin
            ? "A quick look at reviewing staff work. Each task in review has a reviewer, sending it back needs a note, and nobody approves their own work, admins included. About a minute."
            : "A quick look at what happens when your task needs review. You send it, an admin approves it or sends it back with a note, and you can take it back while it waits. About a minute.",
      },
      {
        id: "ann-nav",
        go: () => {
          if (!/^#\/tasks\/review(\?|$)/.test(window.location.hash || "")) window.location.hash = "#/tasks/review";
        },
        targets: ["tk-review-nav"],
        wait: true,
        title: "Review in the Tasks sidebar",
        body: () =>
          ctx && ctx.isAdmin
            ? "Everything waiting for review, oldest first. The number is what you can approve now."
            : "Your work waiting for an admin's approval is listed here.",
      },
      {
        id: "ann-groups",
        targets: ["tk-review-groups"],
        wait: true,
        spot: "top",
        title: "Who it's waiting on",
        body: () =>
          ctx && ctx.isAdmin
            ? "Waiting on you, Any admin, Other reviewers, then Your work in review. Open a task to Approve it or Send back with a short note. Your own work goes to another admin."
            : "Open a task to see who reviews it and how long it has waited. Take back moves it to In progress if you need to change something.",
      },
      {
        id: "ann-stats",
        when: (c) => !!(c && c.isAdmin),
        targets: ["tk-review-stats"],
        wait: true,
        title: "On time, last 30 days",
        body: () =>
          "For each person: how much was finished (or approved) by the end of its due date, with client-wait time added, plus approvals, first passes and send-backs.",
      },
      {
        id: "ann-done",
        title: "That's it",
        body: () =>
          "A task sent back shows up as In progress with the reviewer's note in its comments. To see this again, press ? and pick New: Task review and on-time tour.",
      },
    ],
  },
  {
    id: "recurring-tasks",
    date: "2026-10-15",
    title: "Recurring tasks",
    summary: "Recurring templates moved to Tasks › Recurring. They start as drafts, tasks they make carry a Recurring tag, and you can skip or change a template for one client.",
    roles: ["admin", "bookkeeper"],
    hash: "#/tasks/templates",
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "Recurring tasks have a home",
        body: () =>
          ctx && ctx.isAdmin
            ? "A quick look at recurring templates. They now live in Tasks, start as drafts, and only make tasks once you turn them on. About a minute."
            : "A quick look at where recurring tasks come from. Tasks made from a template show a Recurring tag and end with the period, like \"· Sep 2026\". About a minute.",
      },
      {
        id: "ann-nav",
        go: () => {
          if (!/^#\/tasks\/templates(\?|$)/.test(window.location.hash || "")) window.location.hash = "#/tasks/templates";
        },
        targets: ["tk-recurring-nav"],
        wait: true,
        title: "Recurring in the Tasks sidebar",
        body: () => "Every recurring template, grouped by set, with how often it repeats and when it's due.",
      },
      {
        id: "ann-client",
        targets: ["tk-recurring-client"],
        wait: true,
        spot: "top",
        title: "One client",
        body: () =>
          "Pick a client you look after to see which templates reach them. Skip one for that client, change its title, due date or who does it, or preview the next 60 days.",
      },
      {
        id: "ann-actions",
        when: (c) => !!(c && c.isAdmin),
        targets: ["tk-recurring-actions"],
        wait: true,
        title: "New template, previews and runs",
        body: () =>
          "New templates are drafts. Use Preview on a row before you click Turn on. Make due tasks now runs the morning job straight away; nothing already made is made twice.",
      },
      {
        id: "ann-done",
        title: "That's it",
        body: () =>
          "Tasks from a template don't send an assignment email; they're on your list the next morning. To see this again, press ? and pick New: Recurring tasks tour.",
      },
    ],
  },
  {
    id: "ask-client",
    date: "2026-10-16",
    title: "Ask client",
    summary: "Ask a client a question, for a document or for an approval right from a client task; the task waits until they answer, and Tasks › Waiting on client lists every open request.",
    roles: ["admin", "bookkeeper"],
    hash: "#/tasks/waiting",
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "Ask the client from a task",
        body: () =>
          "Open any client task and you'll find Client requests above Files and links. Ask client sends a question, a document request or an approval to the client's portal users or contacts, and the task waits on the client until they answer. About a minute.",
      },
      {
        id: "ann-nav",
        go: () => {
          if (!/^#\/tasks\/waiting(\?|$)/.test(window.location.hash || "")) window.location.hash = "#/tasks/waiting";
        },
        targets: ["tk-waiting-nav"],
        wait: true,
        title: "Waiting on client",
        body: () => "Every open request for the clients you work on. The number is how many are still waiting.",
      },
      {
        id: "ann-list",
        targets: ["tk-waiting-head"],
        wait: true,
        spot: "top",
        title: "Longest wait first",
        body: () =>
          "Grouped by client. Click a request to open its task, or use Send reminder, Email again or Cancel right here. After four reminders a request says No reply: time to call.",
      },
      {
        id: "ann-done",
        title: "Check before you count on the email",
        body: () =>
          "Client emails for requests go only to clients the owner has put on the pilot list; for every other client they are a dry run, so tell the client yourself and use Record answer when they reply. To see this again, press ? and pick New: Ask client tour.",
      },
    ],
  },
  {
    id: "client-answers",
    date: "2026-10-16",
    title: "Clients answer requests",
    summary: "Clients now answer your requests themselves: in the portal under Messages › Requests (What we need from you), or from an emailed link with no login. Client contacts live in each client's tasks drawer.",
    roles: ["admin", "bookkeeper"],
    hash: "#/tasks/waiting",
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "Clients answer for themselves",
        body: () =>
          "When you Ask client, portal users see it under Messages › Requests, called What we need from you, and can reply or upload there. A client contact without a login (a treasurer, a pastor) gets a link that opens just that one request. About a minute.",
      },
      {
        id: "ann-nav",
        go: () => {
          if (!/^#\/tasks\/waiting(\?|$)/.test(window.location.hash || "")) window.location.hash = "#/tasks/waiting";
        },
        targets: ["tk-waiting-nav"],
        wait: true,
        title: "Answers come back here",
        body: () =>
          "When a client answers, the request leaves Waiting on client, the task comes back to you with their reply and files, and you get a notification.",
      },
      {
        id: "ann-contacts",
        title: "Client contacts",
        body: () =>
          "Open a client's tasks drawer and expand Client contacts to add the people who answer by link. Untick Can answer requests by email link, or remove them, and their open links stop working at once.",
      },
      {
        id: "ann-done",
        title: "Emails only go to pilot clients",
        body: () =>
          "Email again and Send reminder only email clients the owner has switched on (the pilot list on the Emails page). For other clients they are a dry run, and test clients get a test copy sent to you only. To see this again, press ? and pick New: Clients answer requests tour.",
      },
    ],
  },
  {
    id: "ooo-handoff",
    date: "2026-10-16",
    title: "Time off hands tasks to backups",
    summary: "When you're out, your open tasks due during your time off go to each client's backup bookkeeper and come back after. Click Hand my tasks to backups on My time off before you go.",
    roles: ["admin", "bookkeeper"],
    hash: "#/team/people",
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "Your tasks are covered while you're out",
        body: () =>
          "Click Hand my tasks to backups before you go and open tasks due while you're away move to each client's backup bookkeeper. When you're back they come home on their own. Ready for review, private and MGB (internal) tasks stay with you. About a minute.",
      },
      TOUR_tabStep(
        "team",
        "people",
        "Team › People",
        "Time off lives here. Add your days off and the team sees who's out.",
      ),
      {
        id: "ann-mine",
        when: (c) => !(c && c.isAdmin),
        targets: ["cv-my-timeoff"],
        wait: true,
        title: "Hand my tasks to backups",
        body: () =>
          "Each time off has Hand my tasks to backups. It shows what goes to whom and what stays (and why) before anything moves. Hand back now ends it early.",
      },
      {
        id: "ann-admin",
        when: (c) => !!(c && c.isAdmin),
        targets: ["cv-coverage"],
        wait: true,
        title: "Hand off anyone's tasks",
        body: () =>
          "Each person's time off has Hand off tasks. For a client with no backup, or a backup who is also out, pick someone to cover. Your hand-off also gives the backup access to the client for the time off.",
      },
      {
        id: "ann-done",
        title: "Where you'll see it",
        body: () =>
          "A covered task says Covering for … in its drawer and on Today, and its Activity shows the hand-off and the hand-back. Set each client's backup on Client overview. To see this again, press ? and pick New: Time off hands tasks to backups tour.",
      },
    ],
  },
  {
    id: "unassigned-tasks",
    date: "2026-10-16",
    title: "Unassigned tasks and Claim",
    summary: "Tasks with nobody on them now show as Unassigned. My Tasks has an Unassigned group, and Claim makes one yours.",
    roles: ["admin", "bookkeeper"],
    hash: "#/tasks/my",
    // Only once an Unassigned task has been on screen (TK_TaskRow.jsx sets
    // the flag), so nobody is toured through a group they've never had.
    ready: () => {
      try {
        return window.localStorage.getItem("mgb_tk_seen_unassigned_v1") === "1";
      } catch (e) {
        return false;
      }
    },
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "Some tasks start with nobody on them",
        body: () =>
          "Tasks brought over from Asana without an assignee, and recurring tasks set to leave unassigned, now show as Unassigned instead of landing on someone by default. About a minute.",
      },
      {
        id: "ann-group",
        go: () => {
          if (!/^#\/tasks\/my(\?|$)/.test(window.location.hash || "")) window.location.hash = "#/tasks/my";
        },
        targets: ["tk-unassigned-group", "tk-groups"],
        wait: true,
        title: "The Unassigned group",
        body: () =>
          ctx && ctx.isAdmin
            ? "My Tasks lists open Unassigned tasks after Waiting on client: the ones you own and the ones on clients where you're the bookkeeper. They never count as anyone's overdue."
            : "My Tasks lists open Unassigned tasks on your clients after Waiting on client. They aren't yours until you claim one.",
      },
      {
        id: "ann-claim",
        targets: ["tk-claim"],
        wait: true,
        title: "Claim",
        body: () =>
          "Claim makes the task yours and moves it into your dated groups. If someone got there first you'll see Someone already took this task. Claiming never sends an email.",
      },
      {
        id: "ann-done",
        title: "Anywhere you see Unassigned",
        body: () =>
          "Client and project lists say Unassigned in the Assignee column, the Assignee filter has an Unassigned choice, and a task's details show an Unassigned chip with Claim. To see this again, press ? and pick New: Unassigned tasks and Claim tour.",
      },
    ],
  },
  {
    id: "asana-import",
    date: "2026-10-16",
    title: "Your Asana tasks are in Tasks",
    summary: "Open Asana tasks were copied into Tasks on Oct 16, each on the person it was assigned to, with a link back to the Asana task. Asana itself was not changed.",
    roles: ["admin", "bookkeeper"],
    hash: "#/tasks/my",
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "Your Asana tasks came over",
        body: () =>
          "The open tasks in Asana were copied into Tasks once, on Oct 16, each on the person it was assigned to and on its client where we could match one. Asana itself was not changed. About a minute.",
      },
      {
        id: "ann-groups",
        go: () => {
          if (!/^#\/tasks\/my(\?|$)/.test(window.location.hash || "")) window.location.hash = "#/tasks/my";
        },
        targets: ["tk-groups"],
        wait: true,
        title: "They're on My Tasks",
        body: () =>
          "Imported tasks sit in your groups by due date like any other task. Open one and its details say Imported from Asana, with a link to the original. Tasks with no assignee in Asana show as Unassigned for anyone on the client to claim.",
      },
      {
        id: "ann-no-team",
        when: (c) => !!(c && c.isAdmin),
        targets: ["tk-no-team", "tk-sidebar"],
        wait: true,
        title: "Admins: clients with no team",
        body: () =>
          "Clients that came over from Asana without a bookkeeper are listed under No team yet in the Tasks sidebar. Open one and use Assign team; no email is sent.",
      },
      {
        id: "ann-done",
        title: "What didn't come over",
        body: () =>
          "Anything added or changed in Asana after Oct 16 is not in Tasks. Repeating Asana tasks came over as draft recurring templates that are switched off until an admin reviews them, so nothing new is made from them yet. No emails were sent. To see this again, press ? and pick New: Your Asana tasks are in Tasks tour.",
      },
    ],
  },
  {
    id: "tasks-manage-projects",
    date: "2026-10-16",
    title: "Group tasks by client, and manage projects",
    summary: "My Tasks can group by client instead of due date, and admins get a Manage projects screen to rename, archive or move projects to the trash.",
    roles: ["admin", "bookkeeper"],
    hash: "#/tasks/my",
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "Two small Tasks upgrades",
        body: () =>
          "My Tasks can now group by client instead of by due date, and admins can rename, archive or trash projects from one screen. About a minute.",
      },
      {
        id: "ann-groupby",
        go: () => {
          if (!/^#\/tasks\/my(\?|$)/.test(window.location.hash || "")) window.location.hash = "#/tasks/my";
        },
        targets: ["tk-groupby"],
        wait: true,
        title: "Group by Client",
        body: () =>
          "Switch Group by from Due date to Client to see your tasks one client at a time, clients A to Z, with No client after them and test or internal clients last. The portal remembers your choice. Admins get the same switch on a person's list under People.",
      },
      {
        id: "ann-manage",
        when: (c) => !!(c && c.isAdmin),
        go: () => {
          if (!/^#\/tasks\/my(\?|$)/.test(window.location.hash || "")) window.location.hash = "#/tasks/my";
        },
        targets: ["tk-manage-nav", "tk-sidebar"],
        wait: true,
        title: "Admins: Manage projects",
        body: () =>
          "Manage projects, under Projects in the sidebar, lists every project with its owner and task counts. Rename or archive one, or move it to the trash. A trashed project and its tasks disappear from every list until you restore it. Nothing is deleted.",
      },
      {
        id: "ann-done",
        title: "Where to find it again",
        body: () =>
          "Project owners can also move their own project to the trash from its Project options menu; an admin restores it from Manage projects. To see this again, press ? and pick New: Group tasks by client, and manage projects tour.",
      },
    ],
  },
  {
    id: "tasks-subtasks-colors",
    date: "2026-10-16",
    title: "Subtasks open in place, and project colors",
    summary: "Click a task with subtasks and they open right under it, and every project now has its own color.",
    roles: ["admin", "bookkeeper"],
    hash: "#/tasks/my",
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "Two small Tasks upgrades",
        body: () =>
          "Subtasks now open right under their task, and every project has its own color. No more opening another window to find them. About a minute.",
      },
      {
        id: "ann-subtasks",
        go: () => {
          if (!/^#\/tasks\/my(\?|$)/.test(window.location.hash || "")) window.location.hash = "#/tasks/my";
        },
        targets: ["tk-subtoggle", "tk-groups"],
        wait: true,
        title: "Click a task to see its subtasks",
        body: () =>
          "A task with subtasks shows a small arrow and a count like 2/5. Click the row, or the arrow, to open them underneath; click again to close. Tick a subtask right there. Click the task name to open the full details. The portal remembers what you left open.",
      },
      {
        id: "ann-colors",
        go: () => {
          if (!/^#\/tasks\/my(\?|$)/.test(window.location.hash || "")) window.location.hash = "#/tasks/my";
        },
        targets: ["tk-sidebar"],
        wait: true,
        title: "Every project has a color",
        body: () =>
          "Each project in the sidebar has a color dot, and the same dot shows next to its tasks in every list. Change it from a project's Project options menu, or from Manage projects if you are an admin.",
      },
      {
        id: "ann-done",
        title: "Where to find it again",
        body: () =>
          "New projects pick a color on their own, and you can change it any time. To see this again, press ? and pick New: Subtasks open in place, and project colors tour.",
      },
    ],
  },
  {
    id: "staff-profile-photos",
    date: "2026-10-16",
    title: "Profile photos",
    summary: "Everyone now adds a profile photo, and admins tidy the background so every photo matches.",
    roles: ["admin", "bookkeeper"],
    hash: "#/settings",
    steps: (ctx) => [
      {
        id: "ann-welcome",
        title: "Profile photos for the whole team",
        body: () =>
          ctx && ctx.isAdmin
            ? "Everyone now adds a profile photo. You can download each one, remove the background, and put the edited photo back so the team matches. About a minute."
            : "Everyone now adds a profile photo, so clients see the same tidy look from all of us. An admin removes the background for you. About a minute.",
      },
      {
        id: "ann-settings",
        go: () => {
          if (!/^#\/settings(\?|$)/.test(window.location.hash || "")) window.location.hash = "#/settings";
        },
        targets: ["#st-profile-photo"],
        wait: true,
        title: "Your photo lives in Settings",
        body: () => "Change photo opens the same picker any time. Your original is kept, and an admin will tidy the background.",
      },
      TOUR_tabStep(
        "team",
        "members",
        "Team › Members",
        "The Photo column shows who still needs an edit. Click a photo to download it, replace it with your edited version or restore the original.",
        // A temporary admin sees Members but can't act on photos.
        (c) => !!(c && c.isAdmin),
      ),
      {
        id: "ann-photo-cell",
        when: (c) => !!(c && c.isAdmin),
        targets: ["members-photo"],
        wait: true,
        title: "Download, edit, replace",
        body: () =>
          "Download the original, remove the background in your editor, save it as a PNG with a transparent background, then choose Replace with edited photo.",
      },
    ],
  },
  {
    id: "handbook-policies-employee-records",
    date: "2026-10-19",
    title: "New handbook policies and employee records",
    summary: "Admins can add handbook policies (reference or signed), and keep an employee record for each staff member.",
    roles: ["admin"],
    hash: "#/team/handbook",
    steps: () => [
      {
        id: "ann-welcome",
        title: "Two new admin tools",
        body: () =>
          "Add your own handbook policies, either reference (read only) or signed, and keep job and emergency contact details for each staff member. About a minute.",
      },
      TOUR_tabStep(
        "team",
        "handbook",
        "Team › Handbook › New policy",
        "New policy saves a draft only admins see. Pick Reference (nobody signs it) or Signed (bookkeepers are asked to sign when you publish). Nobody is emailed until you choose Publish.",
      ),
      TOUR_tabStep(
        "team",
        "employees",
        "Team › Employee records",
        "One record per staff member: job details, personal contact details and an emergency contact. Only admins see it, and each record you open is logged. No pay or Social Security numbers here.",
      ),
    ],
  },
];

if (typeof module !== "undefined" && module.exports) module.exports = { ANN_REGISTRY: ANN_REGISTRY };
