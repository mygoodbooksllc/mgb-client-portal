PUBLISHED 2026-10-25: slate_app_enabled is on and this text is live (docs/staff-guide/*.md and the staff_guide table). Kept only as the source of record; do not re-apply.

WIRED 2026-10-21 (launch prep): the notice and tour are in components/tour/announcements.js as slate-app-launch, gated by visible(); the guide text is applied at flip time with supabase/staff-guide-slate-launch.sql (built by drafts/slate-launch-patch.mjs from these drafts). The text below stays here as the source for that script.

DRAFT - not live until the owner flips tk_settings.slate_app_enabled. Nothing here is in announcements.js or Tour.jsx.

What is live today (flag-gated, nobody sees it unless they have the Slate app preview on): the existing portal tour step `tk-popout` in components/tour/Tour.jsx and the tip `tk-popout` in Tips.jsx now read "Open Slate app ..." when TK_slateAppOn() is true, and keep the old "Open in own window" wording for everyone else. At launch, drop the gate and keep only the new text (and update the Tips row in docs/staff-guide/tips.md).

The `tk-size` step is NOT added to Tour.jsx. The Slate app window hides the tour, tips and notices (app.jsx: tkShell), so a step targeting the size buttons could never show; a step gated on TK_slateInApp() would be dead code. It stays here. If the owner wants an in-app tour later, it needs the app to host the tour first (a separate slice).

Launch kit (mgb-launch-kit): one announcement entry, shown once per person at their next visit to the portal, with a short tour that runs in the portal. Roles: admin, bookkeeper (includes temporary admins) and accountManager; clients never see it (the app is staff-only). The notice only makes sense on a computer, so `ready` waits for a computer and for the app being on.

--- announcements.js entry (add at the end of the registry; pick the launch date) ---

  {
    id: "slate-app-launch",
    date: "DATE",
    title: "Slate is now its own app",
    summary:
      "Slate can open as its own app: a sliver with your current task, a full page with a detail pane, and views, bulk edits, manual order and a board for shaping your work. Look for Open Slate app on the Slate page.",
    roles: ["admin", "bookkeeper", "accountManager"],
    hash: "#/tasks/my",
    // Only where the app is on for this person and the window is a computer's.
    ready: () => typeof TK_slateAppOn === "function" && TK_slateAppOn() && ANN_deskDocked(),
    steps: () => [
      {
        id: "ann-welcome",
        title: "Slate, in its own window",
        body: () =>
          "Slate can now open as its own app. Shrink it to your current task, or grow it to a full page with a detail pane. Nothing changes in the portal until you open it. About a minute.",
      },
      {
        id: "ann-open",
        go: () => {
          if (!/^#\/tasks\/my(\?|$)/.test(window.location.hash || "")) window.location.hash = "#/tasks/my";
        },
        targets: ["tk-popout"],
        wait: true,
        title: "Open Slate app",
        body: () =>
          "This opens Slate in a window of its own, with no rail or top bar. Install Slate app next to it adds an icon to your Dock or Start menu, in Chrome or Edge.",
      },
      {
        id: "ann-sizes",
        title: "Four sizes",
        body: () =>
          "Drag the window smaller and it becomes a compact list, then a sliver with just your current task and Start and Done. Bigger and it gets a left rail, then a detail pane beside the list. The Sliver, List and Full page buttons in the app jump to a size.",
      },
      {
        id: "ann-shape",
        title: "Shape your work",
        body: () =>
          "In the app, Views saves how your list is set up, bulk edit changes Status, Priority and Section together, Manual order lets you drag rows, and the List | Board switch shows columns by status or section. Links to clients open in this portal window.",
      },
      {
        id: "ann-quick",
        title: "Quick actions",
        body: () =>
          "In the app, right-click a task (or press and hold on a touch screen) for a menu: Duplicate, Copy, due dates, Assign to me and more. Cmd+D duplicates, Cmd+C and Cmd+V copy and paste, drag on empty space to select several, and swipe two fingers right to go back. Undo works for 9 minutes. Press ? for every key.",
      },
      {
        id: "ann-done",
        title: "That's the Slate app",
        body: () =>
          "Slate in the portal works as before. Take this tour again from the ? menu, and see How do I use the Slate app? in Help.",
      },
    ],
  },

Steps to verify at launch: that `tk-popout` resolves on #/tasks/my (it is the Open Slate app button when the app is on; the existing tour already uses that target), that the notice shows once and can be dismissed, and that the test in components/tour/announcementsLogic.test.js line ~493 (it asserts the new-look notice has no "slate app" text) still passes: it only reads the combined look-and-layout entry, so it should. Bookkeeper and temporary admin versions are the same steps (the Slate page is the same for them); client version: none.

--- the in-app tk-size step (draft only, for a future in-app tour host) ---

  {
    id: "tk-size",
    when: () => typeof TK_slateInApp === "function" && TK_slateInApp(),
    targets: ["tk-size"],   // needs data-tour="tk-size" on the .tk-slate-sizes group in TK_SlateModes.jsx (TK_SlateSizeButtons)
    wait: true,
    title: "Window size",
    body: () =>
      "Sliver, List and Full page resize this window. A sliver keeps just your current task on screen, with Start and Done.",
  },
