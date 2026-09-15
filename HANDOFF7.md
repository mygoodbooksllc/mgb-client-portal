# MyGoodBooks — Session Handoff (7)

*Written 2026-09-11, updated 2026-09-12. This one is written to stand alone — read this
first, then HANDOFF6.md (QA pass, dark-mode default) and HANDOFF5.md (the infra rollout)
only if you want the detail behind something mentioned here.*

**Update, 2026-09-12:** §4 below originally described the auth plan as "scoped, not yet
built." That's now stale — Phase 1 (the team login gate) was actually built and verified
working the same night this doc was first written, but on a different machine/folder than
this git repo, so it looked lost. It's now recovered and merged in — see the new §4a.

---

## 1. What this is

MyGoodBooks is a bookkeeping client-portal SaaS for churches and nonprofits. A bookkeeping
practice uses it to give each client organization a self-serve financial dashboard —
cash on hand, budget vs. actual, receivables/payables, giving & funds, reports, a budgeting
tool, documents, and in-app messaging with their bookkeeper.

It's built as **no-bundler React**: `index.html` fetches `app.jsx` and `data.js` as plain
text and compiles them in-browser with Babel standalone at load time. That's deliberate —
don't reach for a build step by default. `app.jsx` (~93KB) is effectively the whole
application; `data.js` (~24KB) is 100% mock data for four sample clients (Grace Community
Church and Riverside Food Pantry on the premium plan, New Hope Fellowship and Open Arms
Family Services on standard). There is no backend, no database, and — this is the important
one right now — **no real authentication**. Anyone with the URL can act as any client or as
the bookkeeper; a dropdown ("Preview As") swaps between identities client-side.

**Live today** at `app.mygoodbooks.org` (Vercel, deployed straight from GitHub, no build
command), linked from a "Client Portal" button on the real `mygoodbooks.org` Squarespace
site. That whole rollout — GitHub → Vercel → domain → Squarespace button — is done; see
HANDOFF5.md if you want the story of how it got there.

---

## 2. What shipped last session (HANDOFF6, for context)

A full QA pass across desktop/tablet/mobile, dark/light, live and local. Headlines: dark
mode is now the default (was following the OS setting, now an explicit toggle that
persists), boot time went from ~25-30s blank screen to ~1s (parallel fetch instead of
serial fetch-then-compile), "Cash Runway" was quietly reporting 184.9 months due to a bad
formula and is now "Operating Reserve" with correct, differentiated numbers per client, six
of eight tables were scrolling sideways on phones and now restack, and modals gained
keyboard/screen-reader support for the first time (a shared `ModalShell` — any new modal
should use it). Full detail in HANDOFF6.md.

---

## 3. This session: AP Command Center

You handed over a separate one-off doc (`/Users/holdengray/Desktop/AP command center/
ap-command-center.md`) — a standalone HTML mockup of an accounts-payable dashboard,
originally designed as a cross-client tool showing bills from 6 different businesses. You
asked to wire a version of it into the app itself, matching the existing design and using
the app's real mock data instead of the mockup's invented sample bills.

**What was built:** a new **AP Command Center** tab, added to the Enterprise Tools section
alongside Daily Report, Report Builder, and Budgeting Tool — same premium-plan gate, same
"org-wide, no category dimension" treatment as Receivables & Payables. It reads the same
`client.payables` array already used elsewhere (no new data), and adds on top of it:

- Four KPI tiles — Total Payable, Overdue, Due Within 7 Days, Scheduled — computed live by
  comparing each bill's due date to today
- A searchable, filterable bills table (All / Overdue / Due soon / Scheduled), using the
  same label-based mobile stacking as every other table in the app
- An aging-summary panel (Current / 1–7 / 8–30 / 30+ days overdue) and a "Next 5 Due" list

It was checked against Riverside (2 overdue bills), Grace Community (1 of 3 overdue),
confirmed the premium gate correctly hides it for standard-plan clients, and holds up in
both themes and at mobile width. New code lives entirely in `app.jsx` (new
`APCommandCenterPage` component, ~180 lines) and `styles.css` (a new `.ap-cc-*` block, ~150
lines) — nothing elsewhere needed to change.

**Not yet done:** this is uncommitted. `python3 build.py` (rebuilds `dist/`) hasn't been
run since before this work, and nothing has been pushed. See §5.

---

## 4. Also scoped this session: real login

You asked whether a login portal for your team through Google Workspace was possible, tied
to giving the internal team secure access to the client portal. Short answer: yes, and it's
a good fit — folded into the Supabase step that's been parked since HANDOFF5. The plan,
in full, now lives in memory (`project_team_client_auth_plan.md`) rather than only in this
document, since it'll need to survive several sessions before it's built. Summary:

**One Supabase Auth backend, two sign-in paths:**
- **Your team** — "Sign in with Google," with the OAuth app set to Google's *Internal* mode
  for your Workspace domain. Google itself refuses the sign-in for anyone outside that
  domain before any of our code runs.
- **Clients** (the churches/nonprofits) — a separate email/magic-link flow, since they're
  not on your Workspace domain.

**The catch:** today "the bookkeeper" isn't a real identity — it's one shared sentinel
(`BOOKKEEPER_VIEW` in `app.jsx`) behind a dropdown reading "MyGoodBooks (full access)."
There's no roster of named staff anywhere. Real Workspace SSO means a new **`staff` table**
is the actual source of truth for who's authorized — being on the Workspace domain proves
*who someone is*, not that they should have portal access.

**Recommended order, once you're ready to start:**
1. Team login gate — Supabase project, Google OAuth (Internal mode), a `staff` table, a
   login screen in front of the whole app. Still reads `data.js` underneath. This alone
   closes "the whole app is a public URL, no login."
2. Client-side auth — magic link per organization, replacing today's implicit trust.
3. Replace `data.js` with real Supabase tables.

**Blocked on you, not code:** creating the Supabase project and registering the Google
Cloud OAuth client both need your own login — same as the GitHub push and DNS steps back
in the original rollout. I can write the schema, the login screen, and the access-model
changes; I can't create those accounts.

---

## 4a. Phase 1 actually got built and verified (same night, different machine)

Later the same evening this handoff was first written, Phase 1 above was fully built and
tested working — just in a separate copy of this project on another Mac
("Desktop - Holden's MacBook Pro"), not in this git repo. That copy had no `.git` at all,
so none of it was at risk of a bad push, but it also meant it didn't show up here and
looked lost the next day. Recovered and merged into this repo on 2026-09-12 — diffed
clean against this repo's `app.jsx` (the only difference was exactly the auth-gate code,
no conflicts with AP Command Center).

**What's real and working, as of this update:**
- Supabase project `MGB Client Portal` (org "Mygoodbooks LLC", Pro plan) — live, with a
  `staff` table (RLS: a user can only read their own row) seeded with Holden as admin.
- Google Cloud project `MyGoodBooks Auth`, created under the real `mygoodbooks.org`
  Workspace org (11 active users, Business Standard billing — confirmed real, this had
  been in doubt during setup). OAuth consent screen is **Internal**, restricted to
  `mygoodbooks.org` accounts.
- OAuth 2.0 Client `MyGoodBooks Staff Portal`, with Supabase's callback URL registered as
  an authorized redirect URI, Client ID/Secret saved into Supabase's Google provider.
- New code, all committed as of this handoff: `auth-config.js` (Supabase URL/anon key —
  both public-safe), `components/auth/supabaseClient.js`, `components/auth/AuthGate.jsx`
  (the actual login gate — Google sign-in hinted to `mygoodbooks.org`, checks the signed-in
  email against `staff`, only then renders the app via a render-prop), and `app.jsx`
  changes replacing the old `"MyGoodBooks (full access)"` sentinel label with the real
  signed-in staffer's name plus a "Sign out" control. `BOOKKEEPER_VIEW` and
  `resolveAccess()` are untouched — only where the label text comes from changed.
- **Verified end-to-end twice**, on two different machines: signed in as Holden through
  the real Google OAuth screen, landed in the dashboard with "Holden (full access)" in the
  sidebar, signed out cleanly, re-gated back to login. No console errors.

**Debugging notes worth keeping, if this breaks again:**
- Supabase's Google provider has two independent things that must both be set: the enable
  toggle, *and* the Client ID/Secret fields actually saved. Toggling on without saving
  the ID/Secret gives a misleading `"Unsupported provider: provider is not enabled"` error.
- Google's OAuth client "Authorized redirect URIs" field does not auto-fill — it silently
  defaults to empty, which Google rejects at sign-in time. Must be added by hand.
- The Client Secret on a Google OAuth client's detail page shows masked (`****dQTa`) with
  no visible "reveal" link — the copy icon next to it copies the full unmasked value
  regardless. No need to regenerate the secret to get it.

**Known limitation, unresolved:** the published Artifact link cannot run this login gate —
its CSP allowlist doesn't include Supabase's API host, so `supabase.auth` calls silently
fail there even though the bundle boots fine. The gate only actually works at
**app.mygoodbooks.org** (Vercel). Need to decide what the Artifact link is for going
forward (retire it, leave it as an unauthenticated legacy demo, or something else) — not
decided yet.

---

## 5. Everything still open, in the order I'd tackle it

1. **Push this commit.** AP Command Center and Phase 1 auth are both now committed together
   in this repo (see §4a) — push to `origin/main` and confirm Vercel deploys, then sign in
   for real at app.mygoodbooks.org (not just localhost) to close the loop.
2. **Decide on the Artifact link**, per the known limitation in §4a — it can't complete
   Supabase login under its CSP.
3. **Add more staff rows.** Only Holden is seeded in the `staff` table right now — add
   other bookkeepers via the Supabase SQL editor (or wait for a real staff-management UI).
4. **Move to Phase 2** (client-side magic-link auth for the churches/nonprofits) — lower
   urgency than Phase 1 if no client has actually been handed portal access yet.
5. **Real-device touch check** — outstanding since HANDOFF5. Everything mobile (drag-and-
   drop, 44px touch targets, the single-scroll drawer, table restacking) has only ever been
   verified via emulation, never a real finger on a real phone.
6. **Light-mode contrast on the gold text.** Can't be measured by script — the page
   background is a decorative mesh layer, not an element background, so computed contrast
   ratios come out meaningless. The gradient "Enterprise Tools" nav items and gold client-
   name label look washed out on cream. Needs a human eye.
7. **`Your Funds` in scoped client view** shows the org-wide fund total to a limited-access
   user — pre-existing, possibly intentional, sits oddly next to a code comment saying
   org-wide figures aren't theirs to see. Worth settling now that real auth (§4a) exists and
   "limited-access user" means something backed by a real account.
8. **Receipt-capture / document digitization.** Still parked, no decision. Camera capture
   itself is trivial; the open question is how real "digitize" should be: (1) capture and
   attach as a plain document, (2) capture with simulated/canned extraction — matching how
   every other not-yet-real feature here is mocked, or (3) real in-browser OCR via
   Tesseract.js, which has nowhere to persist extracted data until Phase 3 (§4) lands.

---

## State as of this handoff (updated 2026-09-12)

- **Committed, not yet pushed:** AP Command Center (`app.jsx`, `styles.css`) and Phase 1
  auth (`app.jsx`, `index.html`, `build.py`, `auth-config.js`, `components/auth/`,
  `supabase/staff-schema.sql`) — all landed in one commit on top of local `main`, which is
  now several commits ahead of `origin/main`. Push next.
- **`dist/mygoodbooks-dashboard.html`** was rebuilt with `python3 build.py` as part of this
  update and reflects both features — but note the Artifact CSP limitation in §4a means
  republishing it won't give the Artifact link a working login.
- **Live site** (`app.mygoodbooks.org`) reflects everything through HANDOFF6 only; none of
  this handoff's work has been pushed or deployed yet.
- Two project memories exist from when the auth plan was first scoped:
  `project_team_client_auth_plan.md` and an update to `project_infra_rollout.md`.
- Supabase and the Google Cloud OAuth client are both live and correctly configured (§4a) —
  that setup does not need redoing. QuickBooks is still not connected; the "not connected to
  QuickBooks yet" badges in the UI remain accurate.
- **Housekeeping note:** this repo's git required Xcode Command Line Tools, which needed the
  license accepted (`sudo xcodebuild -license`) before `git` would run at all on this
  machine — worth remembering if a fresh checkout on another Mac hits the same wall.

---

## 6. Update, 2026-09-14: everything in §5's open list got worked through

All pushed and merged into `main` via PRs #1–#4, deployed live at `app.mygoodbooks.org`:

- **Staff Access page shipped** (§5.3) — an admin-only page for adding/editing/removing
  staff rows from the UI instead of hand-writing SQL, enforced by a Postgres RLS policy
  (`supabase/staff-admin-policies.sql`), not client code. Hit and fixed an infinite-recursion
  bug in that policy along the way (`SECURITY DEFINER` function instead of a raw
  self-referencing subquery) — worth knowing about if `staff` lookups ever start failing
  with a vague "Couldn't verify staff access" error again.
- **Scoped-view fund bug fixed** (§5.7) — a category-scoped client user (e.g. a Worship
  Lead, a Warehouse Manager) with no explicit `funds` list defaulted to seeing every fund in
  the org on their own dashboard, contradicting the page's own "org-wide figures aren't
  theirs to see" rule. Two real mock users hit this. Now defaults to none, and a "Funds they
  can see" section in the per-person access editor lets a bookkeeper grant specific funds.
- **Artifact link retired** (§5.2) — decided against keeping it as a no-login demo (a fix
  was built and then reverted once the decision changed). The link
  (`https://claude.ai/code/artifact/ffe4688e-ddd4-459f-9662-a65937a2ffa2`, referenced in
  HANDOFF2–6) is permanently deleted and no longer resolves. `build.py`/`dist/` still exist
  in the repo (nothing currently uses them) in case a similar single-file bundle is wanted
  again later — no decision made on removing them outright.
- **Developer Tools added to Staff Access** — three more admin-only cards: a Recent Activity
  audit feed (`supabase/staff-audit-log.sql`, logged by a Postgres trigger so it's accurate
  regardless of how a change was made), a System Info panel (app version, Supabase
  connectivity, who's signed in — meant to shortcut exactly the kind of manual debugging the
  RLS recursion bug above required), and two per-browser dev flags (force premium plan,
  verbose console logging) plus a "reset local state" button. All three still open items,
  lower priority: bulk staff CSV import, a real invite/email flow, and impersonating another
  staff member's view.
- **Staff-to-client messaging** — asked about and deliberately deferred. The in-app Messages
  tab already exists and is the intended real channel (keeps conversations attached to a
  client's financial context, unlike separate email); an email *notification* when a new
  portal message arrives is the one addition worth adding, once Phase 3 (§4) gives the app a
  real backend to send from.

- **Per-bookkeeper client access + Home page** — admins can check/uncheck which clients each
  bookkeeper sees (`supabase/staff-client-access.sql`, opt-in default — zero checked means
  zero visible, until an admin grants some). Every signed-in staffer also gets a "Home" link:
  overdue/due-soon bills and unread messages rolled up across every client they can see,
  recently-viewed/needs-a-visit lists (per-device, `localStorage` only), shared per-client
  notes (`supabase/client-notes.sql` — any active staff member, not just the author, can read
  and write these), and a search box over the client list. The sidebar hides the per-client
  nav while on Home, since none of it applies there.
- **A directory, not a vault** — discussed and declined building an in-app password vault for
  GitHub/Supabase/Vercel/GoDaddy credentials (no MFA, no breach monitoring, a real single
  point of failure). Added a "Where things live" card to Developer Tools instead — links to
  each service plus a pointer to the real password manager vault holding its credentials.
  `INFRA_LINKS` in `app.jsx` — edit by hand as accounts change.
- **Cmd+K command palette — parked for later.** Considered as a cross-page/cross-client quick
  jump; built a simpler in-page client search box on Home instead, since the new due-bills/
  unread/badge rollups already cover most of the "where do I need to look" need. Worth
  revisiting if that turns out not to be enough once there are more clients or more staff.

Still open, unchanged from §5: Phase 2 (client-side magic-link auth), real-device touch
testing, and the receipt-capture/digitization decision.

---

## 7. Update, 2026-09-14 (later the same day): real bugs found and fixed via a screen recording

All pushed and merged into `main` via PRs #7–16, deployed live. Two categories: Home page
polish, and real bugs — several found only because you sent a screen recording when a
described symptom ("scroll gets stuck") didn't match what two rounds of guessed CSS fixes
actually addressed. Worth remembering that pattern: when a UI bug report doesn't resolve after
one targeted fix, ask for a recording rather than keep guessing.

**Home page polish:**
- Greets the signed-in staffer by name ("Good evening, Holden"), not a client contact's name —
  the shared page-header greeting used to pull from whatever client was last selected, which
  made no sense on a page that isn't about any one client.
- Sidebar hides the per-client tab nav, "Preview as," and "Manage access" while on Home,
  replaced by a one-line "pick a client above" note — those never applied there anyway.
- The Unread Messages KPI tile is now clickable (jumps to the oldest unread thread).
- Fixed several `.card`/`.content-grid` blocks butting directly against their next sibling
  with no gap, on Home, Staff Access, AP Command Center, and Documents — this codebase spaces
  stacked top-level blocks with an inline `style={{ marginBottom: 20 }}` per block (see e.g.
  `GivingFundsPage`'s Fund Balances card), not a shared CSS rule, and several pages missed it.
- The floating chat widget no longer auto-opens over Home or Staff Access — it's scoped to
  whatever client was last selected, which is irrelevant on either page.

**Real bugs found and fixed:**
- **Modal focus-steal bug** (root cause, not a patch): `ModalShell`'s focus-management effect
  depended on `onClose`. Any modal whose *own* invoking component also owns fast-changing
  state (e.g. typing in the client-note textarea) passed a fresh inline `onClose` identity
  every keystroke, re-running the effect — whose cleanup restores focus to whatever was
  focused before the modal opened. That's what caused "type one letter, get kicked out of the
  field." Fixed by reading `onClose` from a ref instead of depending on it, so the effect only
  runs on mount/unmount. Fixes every current and future `ModalShell` user, not just the note
  editor.
- **Login vs. refresh routing.** A fresh sign-in (or a brand-new tab/window) now lands on Home;
  refreshing mid-work restores exactly the page *and client* you were on. Distinguished via a
  `sessionStorage` flag (per-tab, cleared on sign-out), not Supabase auth events, which fire
  ambiguously between a real new sign-in and a silently-restored existing session.
  `selectedClientId` is now actually persisted across refreshes too — previously only the page
  was saved, so a refresh silently reset back to Riverside regardless of which client was open.
- **Dashboard drag-and-drop could permanently block page scroll.** `useDragReorder`'s touch
  path blocks page scroll for the whole duration a card is picked up, and only cleared that
  state via pointer events bound to the *specific* card DOM element — but reordering live
  during the drag can cause React to swap that exact node out from under the gesture, losing
  the pointer capture and its handlers. If the browser then doesn't cleanly deliver a
  `pointercancel`, the drag state never resets and the scroll-blocker stays attached forever.
  Added document-level pointerup/pointercancel/pointerleave listeners as a safety net (fire
  regardless of which element the capture was on) plus a hard 5s ceiling as a second backstop.
  Not confirmed as *the* cause of any specific report, but a genuine bug worth having fixed
  regardless.
- **Pinch-to-zoom disabled** — viewport meta (`maximum-scale=1.0, user-scalable=no`) plus
  `touch-action: pan-x pan-y` on `<html>` as the modern fallback, since some mobile browsers
  ignore `user-scalable=no` on purpose for accessibility.

**The "Chrome scroll stuck" saga — worth reading if it comes up again:** reported as "on
mobile, page is getting stuck, can't scroll to the top." Two rounds of plausible-sounding CSS
fixes (`overscroll-behavior-y: contain` on `body`, then on `html` too, since Chrome reads it
off the document element specifically) did not resolve it. A screen recording settled it: the
icons appearing on pull-down (+ / ⟳ / ✕) aren't a refresh spinner — they're **Chrome-for-iOS's
own tab-strip quick actions** (new tab / reload / close tab), a browser-chrome-level gesture
that lives above the web page entirely. Confirmed by elimination: it didn't respond to
`overscroll-behavior` (which reliably suppresses true pull-to-refresh), and Safari — same
underlying WebKit engine, different browser chrome — doesn't have it. **Concluded: not fixable
from the app.** No CSS or JS on a web page can reach Chrome's own UI gestures. If this comes up
again, don't re-attempt an `overscroll-behavior` fix — point straight at this section.

**Discussed, explicitly declined or parked:**
- An in-app password vault for GitHub/Supabase/Vercel/GoDaddy credentials — declined (no MFA,
  no breach monitoring, a real single point of failure). Built a "Where things live" directory
  instead (`INFRA_LINKS` in `app.jsx`) — links only, real credentials stay in your password
  manager.
- Google Meet / video meetings inside the app — scoped (needs a `calendar.events` OAuth scope
  beyond today's identity-only Google sign-in, and clients don't have real accounts to receive
  a native "join" link through until Phase 2) but **put on hold, not started**, per your call
  mid-conversation. Revisit when you're ready.

---

## To do, next session

1. ~~Retest on real devices~~ — **done**, confirmed working (modal focus-steal fix, login-lands-
   on-Home/refresh-restores-your-page, pinch-zoom, drag-and-drop reorder).
2. ~~Add real bookkeeper staff rows and test per-bookkeeper access for real~~ — **done**,
   confirmed working (Gillian's restricted client list, Staff Access hidden from her, shared
   client notes visible across staff).
3. **Decide on Google Meet / real video meetings** — on hold, see above. Needs a decision on
   the broader Google OAuth consent scope before any code starts.
4. Everything still open from §5/§6: **Phase 2** (client-side magic-link auth) and the
   lower-priority Developer Tools follow-ups (bulk staff CSV import, a real invite/email flow,
   impersonating another staff member's view). **Cmd+K** stays parked per §6 — revisit only if
   the client search box + rollups on Home stop being enough.
5. **Receipt-capture / document digitization — dropped.** Was open since HANDOFF5 with three
   unresolved options (plain attachment, simulated extraction, real OCR); decided not to
   pursue it. No longer on the list.
6. No SQL migrations are currently pending — `staff-schema.sql`, `staff-admin-policies.sql`,
   `staff-audit-log.sql`, `staff-client-access.sql`, `staff-reminders.sql`, and
   `client-notes.sql` have all been run against the live Supabase project and verified
   working. Only a *new* feature would add another one.

**Update, later the same day:** items 1 and 2 above confirmed done. Receipt-capture/
digitization (item 5, and the open question in HANDOFF5/HANDOFF6/§5.8 before that) is
dropped — not being pursued. Home's cards also gained the same drag-and-drop
reorder/hide/show system the client Dashboard already had (`useWidgetLayout` +
`useDragReorder` + `CustomizeDashboardButton`, scoped to `"bookkeeper-home"` rather than a
client id) — click "Customize dashboard" on Home to rearrange or hide any of its 10 cards.

---

## 8. Update, same night, one more round: two real bugs, both found via screen recordings

Both diagnosed from recordings you sent rather than guessed at — worth doing that early
again next time a UI report doesn't resolve after one fix attempt.

- **Drag-and-drop never actually swapped anything, on any page, mouse or touch.** Confirmed
  by recording: a card picks up, the ghost correctly hovers over a different card, but the
  order is unchanged after dropping. Root cause: `dragover`/`pointermove` fire continuously
  (many times a second) while hovering, and `layout.reorder(draggedId, targetId)` in
  `useDragReorder` (app.jsx) is **not idempotent** for a stationary hover — calling it twice
  in a row on the same pair swaps the two cards, then swaps them right back, because the
  dragged item's index relative to the target flips after the first call, which flips which
  branch of the insert-position math runs. Any hover longer than one event tick — i.e. any
  real, deliberate drag, not just Home's — oscillates between two arrangements and can land
  back at the start by the time you release. This means the client Dashboard's widget
  drag-and-drop was very likely never fully working either, not just Home's new one — worth
  keeping in mind if that's ever come up as "kind of works, kind of doesn't." Fixed by only
  calling `reorder` once per newly-entered target (tracked in a ref, reset on drag start/end),
  for both the mouse and touch paths.
- **Two more spots greeted with the wrong name.** The full-access bookkeeper view (nobody
  being previewed) said "Good morning, John" — borrowed from the org's first listed contact,
  even though nobody named John is actually signed in. Now shows the org's own name instead
  ("Good morning, Grace Community Church"). Staff Access had the same "wrong greeting" issue
  Home did before it was fixed — greets the signed-in staffer now, not whatever client
  happened to be last selected. Real previewed-person greetings ("Preview as" in the sidebar)
  are unaffected — those legitimately show the real person's name.
- Masonry (§7's fix) was also extended to every other `.content-grid` pairing that could show
  the same dead-gap problem: Dashboard, Scoped Dashboard (removing the now-unneeded
  `contentCardClass`/`COMPACT_CONTENT_CARDS` mechanism and the dead
  `.content-grid-adaptive`/`.content-card-full` CSS it required), Receivables & Payables, AP
  Command Center, and Staff Access. This is the single biggest-blast-radius change of the
  night, since it touches Dashboard — the most-used page in the app.
- Also fixed along the way: Staff Access showed the sidebar's client picker/nav/Preview-as/
  Manage-access for whatever client happened to be last selected, same issue Home had before
  it got the same treatment — Staff Access now hides all of it (including the picker itself,
  unlike Home, which keeps it on purpose for jumping into a client). And an earlier attempt at
  disabling pinch-to-zoom (`touch-action: pan-x pan-y` on `<html>`) turned out to be the actual
  cause of the drag-and-drop symptom above being *worse* for a few commits in the middle of
  tonight — replaced with a gesture-level fix (block only when a second finger joins) that
  doesn't touch single-finger interaction at all. If pinch-zoom or drag-and-drop ever act up
  together again, check `touch-action` first.

**Stopping here for the night.** Nothing urgent left blocking — the to-do list above (Google
Meet decision, Phase 2, the lower-priority Developer Tools items) is unchanged from earlier
today. Worth a fresh real-device pass next session on the drag-and-drop fix specifically,
since it went through several wrong turns before the actual root cause was found.

---

## 9. Update, 2026-09-15: staff impersonation ("View as")

First of the three lower-priority Developer Tools items from §6/§8 — picked "impersonate
another staff member's view" over the CSV import and invite/email flow, since it's the most
useful one for verifying the per-bookkeeper client-access restriction actually works without
needing a second Google account to test with.

- Staff Access roster now has a **"View as"** button next to every active, non-admin staffer.
  Clicking it drops the signed-in admin into that person's view: their assigned clients only
  (`staff_client_access`), Home's rollups scoped to those clients, their own name in the
  greeting. A banner ("Viewing as ___ — Exit") stays pinned across every page while
  impersonating; Exit returns to the admin's own view and Home.
- Staff Access itself is unreachable while impersonating — the page gate checks the *real*
  signed-in admin's role, not the impersonated person's, so there's no path from a
  bookkeeper's-eye view back into staff management.
- **One real limitation, worth remembering:** this only changes what's read and displayed, not
  the underlying Supabase auth session. Writes made while impersonating (a client note) still
  happen under the real admin's login, and anything gated by RLS to the actual signed-in
  email — the impersonated bookkeeper's own private reminders, specifically — won't show
  through, since Postgres is still checking the admin's `auth.jwt()`, not the person being
  viewed as. Due bills, unread messages, and client assignment are all computed client-side
  from data the admin can already see, so those work correctly; reminders are the one card on
  Home that'll look emptier than the real bookkeeper would see it. Fine for what this tool is
  for (checking client-access scoping), but don't mistake it for a full "log in as" — if that's
  ever needed, it'd have to go through Supabase's actual admin API to mint a session for that
  user, not this.
- Shipped in PR #24. `MGB_VERSION` bumped to `2026-09-15a`.

**Also shipped, same session: the other two Developer Tools follow-ups (PR #26).**
- **Bulk staff CSV import** — a "Bulk import" card above the roster: paste `email, name, role`
  rows straight out of a spreadsheet (header row auto-detected and skipped, role optional,
  defaults to bookkeeper), see a live per-row preview with validation, import just the valid
  rows. Each row inserts individually rather than as one batch, so a single bad/duplicate row
  doesn't block the rest — results are shown per row after the import runs.
- **Email invites** — every non-self roster row (freshly bulk-imported ones included) now has
  an "Email invite" link. It's a `mailto:` link, not an automated send — there's no backend to
  send real email from yet (that's Phase 3 territory), so this opens the admin's own mail
  client with the recipient, subject, and a ready-to-send sign-in message already filled in.
  Honest about what it actually does rather than pretending to have sent something.
- `MGB_VERSION` bumped to `2026-09-15b`.

All three Developer Tools follow-ups from §6/§8 are now done. Nothing new left on that list —
next open items are unchanged from §8: Google Meet decision (on hold), Phase 2 client auth,
Cmd+K (parked), and a real-device retest of the drag-and-drop fix.

---

## 10. Update, 2026-09-15 (later the same day): a real bug from testing "View as", and a Phase 2 design conversation

**Bug: Home's client picker was a no-op.** First real-world use of staff impersonation (§9)
turned up a genuine bug, not an impersonation-specific one. Report was "viewed as a bookkeeper,
it wouldn't let me look at their clients when I toggled through." Checked the live Supabase data
first to rule out an assignment/RLS problem (`gillian@mygoodbooks.org` → `grace-community`,
`new-hope`, both real, both correctly scoped) — the assignment was fine. The actual bug: the
sidebar's "Viewing client" dropdown, which stays visible on Home on purpose ("for jumping
straight into a client," per its own code comment), only ever updated which client was
*selected* — it never changed the page away from Home, so picking a client from it did
nothing visible. Fixed in PR #28 by having Home navigate to that client's dashboard on
selection, restoring what the comment always promised.

**Then simplified further (PR #29):** once the picker actually worked, it was just a worse,
mobile-unfriendly duplicate of Home's own "Your clients" card (search box, per-client status,
already there). Dropped the sidebar picker from Home entirely rather than keep two paths to
the same thing — it's unchanged on every other page. `onSelectClient` went back to a plain
`setSelectedClientId` since the Home-only navigation branch had nothing left to trigger it.

`MGB_VERSION`: `2026-09-15c` (picker fix) → `2026-09-15d` (picker removed from Home).

**Design conversation, not yet built: Phase 2 client login.** Walked through how client-side
magic-link auth would actually work day to day, since it's been on the to-do list without a
concrete shape. Landed on:
- Client enters their email on a separate client sign-in page; Supabase's `signInWithOtp` emails
  them a one-time link — no password, ever.
- Clicking it drops them straight into their own org's view. No client picker needed on that
  side — a client only ever belongs to one org.
- Sessions persist normally after that (access + refresh token, same mechanism staff already get
  from Google sign-in) — a client is NOT re-emailed a link on every visit, only when their
  session is actually gone (signed out, cleared site data, new device, or a long enough gap that
  the refresh token expired). An active client might go months between seeing the login screen
  again.
- Getting a new link is fully self-service — an email field and "send me a link" button on their
  end, same pattern as any "forgot password" flow. Never anything staff has to manually send.
- Security level is deliberately email-possession-based, not full MFA — judged to match the
  industry-normal bar for a "view your own financials" client portal (QBO client access,
  Bill.com, etc.), and true TOTP MFA would be real friction for non-technical church/nonprofit
  contacts. Staff, by contrast, already ride on whatever MFA policy the `mygoodbooks.org` Google
  Workspace admin console enforces — worth confirming that's actually turned on there, since
  that's staff's real second factor, not anything this app controls.
- One open decision, flagged for whenever this gets built rather than decided now: one shared
  login per org (e.g. `info@gracecommunity.org`) vs. a separate magic-link login per named
  contact in `client.users`. Per-person logins line up better with the access-control work
  already built (different users already have different tab/fund access), but need an actual
  `auth.users` row per contact matched to the right `client.users` record — more Supabase setup
  than a single shared org email.

Nothing built from this yet — still Phase 2, still unscheduled. Recorded here so the shape
doesn't have to be re-derived from scratch next time it comes up.

**Stopping here.** Open items unchanged: Google Meet decision (on hold), Phase 2 client auth
(now with a concrete shape, above), Cmd+K (parked), a real-device retest of the drag-and-drop
fix.
