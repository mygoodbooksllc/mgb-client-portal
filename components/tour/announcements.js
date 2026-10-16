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

var ANN_REGISTRY = [
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
        title: "Nothing is emailed yet",
        body: () =>
          "Client emails for requests are a dry run until the owner switches them on, so tell the client yourself and use Record answer when they reply. To see this again, press ? and pick New: Ask client tour.",
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
        title: "Emails still wait for the owner",
        body: () =>
          "Until the owner switches client emails on, Email again and Send reminder are a dry run (or a test copy to you only). To see this again, press ? and pick New: Clients answer requests tour.",
      },
    ],
  },
];

if (typeof module !== "undefined" && module.exports) module.exports = { ANN_REGISTRY: ANN_REGISTRY };
