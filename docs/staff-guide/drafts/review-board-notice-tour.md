# Review board: DRAFT next-visit notice, tour, tip and ? menu entry

Held until launch. Nothing below is in `components/tour/announcements.js`, `components/tour/Tour.jsx`, `docs/staff-guide/tips.md` or the ? menu yet. Add them in the launch commit, when the owner flips `tk_settings.reviewboard_enabled` (the same day), so the notice never shows before the board does.

Gate for all of it: `RB_firmOn()` (components/staff/RB_gate.js): a real admin, not in View as, and the firm switch as last read (`mgb_reviewboard_cache` = "1"). Do not use `RB_on()` here: that also counts the per-person preview, and admins trying the preview early should not get the launch notice twice.

Targets already in the page: `data-tour="rb-table"` (the board's table), `rb-filters` (the toolbar), `rb-chip` (the first row's Check in chip), `rb-expander` (the contacts row, only while one is open), and the Work tab row's `work-review` (NAV_TabRow gives every tab `"work-" + key`).

## Next-visit notice (announcements.js)

```js
{
  // Review board launch (docs/review-board-spec.md). Re-date to launch day:
  // the notice stops showing 60 days after `date`. Guide: article review-board.
  id: "review-board",
  date: "<launch day>",
  title: "Review board",
  summary:
    "Work › Review board shows every client's 4th, 14th and 24th tasks for a month on one screen, with close status and contacts. Sort any column, filter by bookkeeper or status, and click a chip to open the task.",
  roles: ["admin"],                      // real admins only; RB_firmOn also checks
  hash: "#/work/review",
  visible: () => typeof RB_firmOn === "function" && RB_firmOn(),
  steps: () => [
    {
      id: "ann-welcome",
      title: "Review board",
      body: () => "One screen for the month rhythm across every client. About a minute.",
    },
    {
      id: "ann-rb-tab",
      targets: ["work-review"],
      title: "Where it lives",
      body: () => "Work › Review board. Admins only. The Close tracker has an Open Review board button too.",
    },
    {
      id: "ann-rb-filters",
      targets: ["rb-filters"],
      wait: true,
      title: "Pick the month and narrow it down",
      body: () => "Last month is the default; the two before it are in the Month list. Filter by bookkeeper or by status (Has late, Any open, All three done, No task yet, Close not done, Preliminary reports).",
    },
    {
      id: "ann-rb-table",
      targets: ["rb-table"],
      wait: true,
      title: "Every column sorts",
      body: () => "Click a header to sort, again to reverse. A chip shows who did each deadline and when, or who it is waiting on; red means late. Click a chip to open the task, the Close pill to open the client's close. The ▸ arrow shows the client's contacts.",
    },
  ],
},
```

If the owner also turns on the digest list at launch, add one more step after `ann-rb-table`:

```js
{
  id: "ann-rb-digest",
  targets: ["tb-bell"],
  title: "Deadline digest",
  body: () => "If you are on the digest list, your bell gets one entry per deadline each morning, like 41 of 62 done, 21 open. Click it to open the board on that month.",
},
```

## Admin tour step (Tour.jsx, admin tour, Work section)

Add after the Close tracker stop, behind the same gate:

```js
...(typeof RB_firmOn === "function" && RB_firmOn()
  ? [
      {
        id: "admin-review-board",
        go: TOUR_go("#/work/review"),
        targets: ["rb-table", "work-review"],
        wait: true,
        title: "Review board",
        body: "Every client's 4th, 14th and 24th tasks for a month, with close status and contacts. Sort any column; click a chip to open the task.",
      },
    ]
  : []),
```

## Tip (tips.md row + tip registry)

- Target `rb-filters`, page `work/review`, admins only, gate `RB_firmOn()`.
- Text: "Filter the Review board by bookkeeper or by status, like Has late, to see who needs a nudge."
- Learn more: `review-board`.

## ? menu entry (help menu for Work)

- "Review board" → help article `review-board`. Show only when `RB_firmOn()`.

## Usage Stats

`USAGE_PAGE_TAB_LABELS.work.review` = "Review board" is already in app.jsx, so the tab is labeled in Usage Stats as soon as anyone uses it.


> **Held note (client contacts, 2026-11-05):** when both `reviewboard_enabled` and `org_contacts_enabled` are on (or for test clients / the Org profile contacts preview), the ▸ expander shows one **People** list instead of "Main contact … first portal login" and Portal logins. Each person shows where they came from: **Main contact**, **Main contact (from org profile, not saved as a contact yet)**, **Contact list** or **Portal login**, plus Monthly emails, Can answer, **Added by client** and Opted out. Email-draft To chips come from the same list (main contact and Monthly emails preselected, never anyone opted out). See `drafts/client-contacts-org-profile.md`. Update this text at that launch.
