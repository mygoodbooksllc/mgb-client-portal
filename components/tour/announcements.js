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
];

if (typeof module !== "undefined" && module.exports) module.exports = { ANN_REGISTRY: ANN_REGISTRY };
