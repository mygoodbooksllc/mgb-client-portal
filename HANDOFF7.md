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

---

## 11. Update, 2026-09-15: Client Access — the roster half of Phase 2, built ahead of the rest

Decided the per-contact-login question from §10 (per-contact, not one shared org email — lines
up with the access-control work already built) and built the piece of it that's safe to ship
without wiring real client login yet: a **Client Access** admin page, `staff-access`'s sibling.

- New table `supabase/client-users.sql` → `client_users` (email primary key, client_id, name,
  role, active). Applied directly to the live project via the Supabase MCP. Admin-only RLS for
  now (`is_active_staff_admin()`, same helper Staff Access already uses) — there's no login
  gate reading this table yet, so nobody else has a reason to touch it.
- **This is authentication roster data, not authorization.** `CLIENTS[].users` in `data.js`
  still owns what a person can see (tabs, categories, funds) via the existing "Manage access"
  editor — that's unchanged and stays. Client Access only controls *who will be able to sign
  in at all* once Phase 2's actual login gate exists. Said explicitly in the page's own
  warning banner so it's not mistaken for already being live.
- New `ClientAccessPage` component, reachable from the sidebar (admin-only, same gating
  pattern as Staff Access): add-a-contact form (pick client from a dropdown, email/name/role),
  bulk CSV import (`client_id, email, name, role` — client_id must be the exact slug, not the
  display name), a searchable roster table, active/inactive toggle, remove. Deliberately
  **no "Email invite" button** here, unlike Staff Access's — reused that mailto builder at
  first and caught that its message text promises Google Workspace sign-in, which is wrong for
  client contacts and describes a login flow that doesn't exist yet. Left out rather than ship
  something misleading; add a client-appropriate version once Phase 2's login page is real.
- Added a search box up front, not as an afterthought — asked directly whether this holds up
  at 100+ clients and many more logins. Backend-wise yes, trivially (Postgres/Supabase Auth
  aren't close to any real ceiling at that scale, and it's still within the free/Pro-plan MAU
  allowance). The one thing that doesn't scale unpaginated is an admin table, so Client Access
  got the same client-side search treatment Home's client list already has.
- **The real ceiling isn't this feature** — it's that `CLIENTS` is still a hardcoded array in
  `data.js`, not a real table. Fine for a handful of clients; if 100+ becomes real, Phase 3
  (replacing `data.js` with real Supabase tables) stops being optional.
- `MGB_VERSION` bumped to `2026-09-15e`.

**Still not done, and this doesn't change that:** there is still no actual client login. Client
Access just makes sure the roster exists and is ready — the magic-link sign-in page, session
handling, and wiring `AuthGate`-equivalent logic for clients (the "replacing today's implicit
trust" part of §10's plan) haven't been started. That's the next real Phase 2 step whenever
you're ready for it.

---

## 12. Update, 2026-09-15: navy darkened to near-black (light mode)

Unrelated to Phase 2 — a design change, requested and iterated live via a mockup rather than
edited blind in the CSS. Built a small Artifact showing the real sidebar/header/KPI/table layout
with real sample data (not swatches), with a toggle to compare the shipped navy against a
proposed replacement, and revised it twice on request: first a warm black, then (your call) a
much darker version of the same navy hue kept intentionally blue rather than going neutral.
Landed on `#05080d` / `#020306`.

- **Only light mode changes.** Dark mode already uses its own separate dark-green chrome
  (`--navy: #1f2a24` there), untouched either way — this only touches the bare `:root` block's
  `--navy`/`--navy-deep`.
- **Every consumer of those two tokens picks it up automatically** — sidebar chrome, headings,
  primary buttons, KPI values, `<DailyClose />` (shares the same token set via
  `components/daily-close/DailyClose.css`). Nothing else needed editing.
- **`--chart-income` was deliberately left alone**, still the old `#243746` — it was already
  decoupled from `--navy` for exactly this reason (a chart series has to stay a legible blue
  regardless of what the chrome color is doing, per the comment already on that line).
- **The company design-system package also updated** (`design-system/src/styles.css`, which the
  README says is a manual copy extracted from this app's `styles.css`, not an import) — same two
  values, same reasoning comment, kept in sync. Ran `npm install && npm run build` there to
  regenerate `design-system/dist/` (including `dist/styles.css`) from the new source; confirmed
  the brace-balance check from `.design-sync/NOTES.md` still passes (0) since I'd hand-edited the
  file, per that doc's own warning about silent CSS breakage from an unbalanced edit.
- **`design-system/ds-bundle/` was deliberately NOT hand-edited.** That directory is a synced
  snapshot of a claude.ai design-system project (see `.design-sync/config.json`'s `projectId`),
  managed by the `/design-sync` skill with its own build/verdict/hash tracking — it'll go stale
  until that skill is run again, which is expected and correct; hand-editing it would desync its
  tracking metadata from what's actually there. Run `/design-sync` when you want this pushed to
  the remote design-system project.
- Old navy (`#243746`/`#1a2830`) kept as a commented-out reference right next to the new values
  in both `styles.css` files, in case this needs reverting or comparing later.
- `MGB_VERSION` bumped to `2026-09-15f`.

Recommended before calling this fully done: click through the real app in light mode (not just
the mockup) — a sidebar full of real nav items, badges, and hover states can read differently
than three curated screenshots did.

**Also renamed the same day: "Client Access" → "Client Roster."** Sidebar link and page title
only — the internal page key (`client-access`) and the `ClientAccessPage` component name are
unchanged, so this was a display-label-only edit. `MGB_VERSION` bumped to `2026-09-15g`.

---

## 13. Update, 2026-09-16: the real-device touch check (§5 item, finally done), and touch
drag-and-drop replaced entirely

Item 1 from HANDOFF5's original open list — a real phone, not emulation — finally happened.
Found four real bugs, three of them clustered around the same feature.

**First pass, three bugs from one screenshot + description (PRs #36–37, one fix-of-a-fix):**
- Mobile topbar showed the last-selected client's name on Home/Staff Access/Client Roster,
  none of which are about any client — same missing `effectivePage` check that the page-header
  greeting already had elsewhere. Fixed.
- Report Builder's config panel stayed `position: sticky` even in the single-column mobile
  layout, reading as the bottom "Live Preview" card sliding up over the Sections checklist.
  First attempt at disabling it on mobile (PR #36) put the `@media` override *before* the
  unconditional `.rb-panel { position: sticky }` rule — two rules of equal specificity where
  both conditions are true resolve by source order, not by which one reads as "the override,"
  so the plain rule always won and the fix silently no-op'ed. A follow-up screenshot caught it
  still broken; PR #37 reordered the rules correctly. Worth remembering: **CSS override order
  bugs look identical to "the fix didn't work" until you check source order specifically.**
- Mobile drag-and-drop picked cards up (jiggle mode engaged) but never reordered them.
  Diagnosed as `document.elementFromPoint()` (the touch path's hit-test) finding the lifted
  card itself instead of seeing through to whatever was actually under the finger, since the
  lifted card doesn't move with the finger. Fixed with `pointer-events: none` on
  `.card-dragging` — correct, but not sufficient, per below.

**Then two more real bugs on the same feature, each only surfacing once the previous one was
fixed (PRs #38–39):**
- With the hit-test fixed, a long-press instead triggered iOS's text-selection highlight
  before the drag's own timer ever got a shot at the gesture. `-webkit-touch-callout: none`
  (already present) only suppresses the copy/share *menu* that follows a completed selection —
  it does nothing about the selection itself. Added `user-select: none`.
- With text selection suppressed, a long-press instead started a native page scroll. Real
  cause: `touch-action` was left at its default until `.card-dragging` set it to `none`, but
  that only applied *after* the 350ms long-press timer fired — and a real scroll gesture gets
  recognized by the browser in well under 100ms, so native scroll was winning that race every
  single time, no matter how still someone held their finger. Set `touch-action: none`
  unconditionally on `.draggable-card` instead of only once picked up.

**At that point the user asked a better question than "keep patching it": is there a
non-drag option just for mobile?** Also flagged, separately, that the *other* drag-and-drop
surface — the "Customize dashboard" widget picker modal — had never worked on touch either,
for a much simpler reason: it only ever used plain HTML5 `draggable`, and HTML5 drag events
are never fired from a touch on any mobile browser, full stop. Two different drag
implementations, two different flavors of "doesn't work on touch," in the same feature.

**Decision: stop trying to make touch drag-and-drop work, replace it.** Four real, distinct
bugs in a row on the card-level touch drag — each one a genuine, separate root cause, not the
same bug recurring — was the signal that reimplementing native drag-and-drop over touch
(pointer capture + `elementFromPoint` hit-testing + a long-press timer racing the OS's own
gesture recognizers) is fragile in a way that's realistically never fully closed out, only
patched hole by hole. Replaced with something that can't have this whole class of bug at all:

- **`useDragReorder` is now mouse-only.** All the touch-simulation code (pointer capture,
  `elementFromPoint`, the long-press timer, the stuck-drag safety-net effect) is deleted
  outright, not just disabled — it was pure liability once nothing used it. Desktop/mouse
  drag-and-drop on the actual dashboard cards is completely unchanged.
- **`useWidgetLayout` gained a `move(id, direction)` method** — swaps a widget with its
  immediate neighbor, ±1. A plain swap, not the shift-based math `reorder()` needs, since a
  button only ever acts on one already-adjacent step.
- **The "Customize dashboard" modal (`WidgetPickerModal`) now has ▲▼ buttons on every row**,
  using `layout.move()`. This is the one place a person on any device — mouse or touch —
  reorders their dashboard/Home cards now; the modal's own mouse-drag-to-reorder is left in
  place as a bonus for desktop, since it cost nothing to keep.
- Reordering the actual cards in place (drag the card itself) is mouse-only now. Touch users
  go through Customize dashboard's arrows instead. This is a real, deliberate scope reduction,
  not a bug — flagging it in case "why can't I drag the card anymore on my phone" comes up:
  that was never reliable to begin with, per the four bugs above.
- `MGB_VERSION` bumped through `2026-09-16b` → `2026-09-16f` across this whole sequence.

**Real-device check (§5 item 1) is now genuinely done** — it's what surfaced every bug in this
section. Still outstanding from the original checklist: light-mode contrast on the gold text
(§5 item 6, needs a human eye, can't be script-measured) and the Google Meet /
Phase 2 items already tracked elsewhere in this document.

**Follow-up the same day: the floating chat widget also got a mobile-specific treatment,** for
the same underlying reason as the drag-and-drop decision above — a `position: fixed` panel and
the on-screen keyboard don't reliably agree on mobile, and a 320px floating box doesn't have
much room to be a useful 3-message preview on a phone screen anyway. Rather than fight that,
mobile now gets a completely different, simpler design:

- New `useIsMobile()` hook — `matchMedia("(max-width: 760px)")` plus a change listener, the
  same breakpoint the phone sidebar-drawer layout already switches on. Not a resize listener +
  `innerWidth` check, since `matchMedia`'s `change` event only fires when the query's
  truthiness actually flips.
- New `ChatFab` component: a round tap-to-open button (with an unread-count badge) plus a
  small separate dismiss button, fixed to the bottom-right corner respecting the safe-area
  inset. Tapping it navigates straight to the real Messages page — no mini-thread, no compose
  box, no fixed-panel-vs-keyboard problem to have in the first place.
- `ChatWidget` (the desktop floating mini-thread) is completely unchanged and unaffected —
  `App` just chooses which of the two to render based on `isMobile`.
- `MGB_VERSION` bumped to `2026-09-16g`.

**Then, following the chat icon fix, asked to remove every emoji in the app** and replace each
with a matching line icon. Scanned the whole repo by Unicode range (pictograph block, symbols
block, regional-indicator flags — not just eyeballing) rather than trusting a manual read-
through. Found and replaced, all in the same thin-line `stroke="currentColor"` style as
`ENTERPRISE_FEATURES`'s icons:
- Sidebar theme toggle (☀️/🌙 → `SunIcon`/`MoonIcon`)
- Global search (🔍 → `SearchIcon`)
- `MockBanner` (🧪 → `FlaskIcon`) — both in `app.jsx` AND its separate copy in the
  `design-system` package (`design-system/src/MockBanner.tsx`), which had drifted to still
  have the emoji since it's a manual port, not a shared import. Rebuilt `design-system/dist/`
  after fixing it, same as the navy-color change earlier.
- Staff Access's and Client Roster's "writes directly to the real table" warning banners
  (⚠️ → `WarningIcon`)
- Documents' "Full access only" pill (🔒 → `LockIcon`)
- Message attachments, in the thread, the pending-attachment chip, and the compose bar's
  attach button (📎 → `PaperclipIcon`, three call sites)
- Daily Report's 90-day forecast callout (💡 → an inline SVG lightbulb, in
  `components/daily-close/DailyClose.tsx` — a vendored component with its own styling scope,
  so it got its own inline icon rather than importing from `app.jsx`)
- New shared `.icon-inline` CSS class (`vertical-align: -3px`, since SVGs default to baseline
  alignment and sit a little low next to a line of text otherwise) — added to both `styles.css`
  and the design-system package's own copy.

**Deliberately left alone:** the plain `✕`/`×` close-button glyphs and the `⚙` gear next to
"Manage access"/"Customize dashboard." These aren't emoji in the rendering sense — no Unicode
variation selector, default *text* presentation on every platform, so they already render in
the theme's own text color rather than as a colorful pictograph. Converting all ~13 close-button
instances plus the gear to SVG would be a much larger, separate refactor for something that
wasn't actually causing the reported problem — flagged rather than done speculatively; say the
word if full icon consistency there is wanted too.
`MGB_VERSION` bumped to `2026-09-16i`.

---

## 14. Update, 2026-09-16 (later): gear/sliders icon swap, and count-up scope changed

- ⚙ (the gear next to "Manage access" and "Customize dashboard") turned out to still render as
  a colorful emoji on the user's actual device despite having no Unicode variation selector —
  the "default text presentation" rule isn't honored by every font/platform in practice.
  Replaced with `GearIcon`, same house style. `MGB_VERSION` → `2026-09-16j`.
- Asked for alternatives to the gear specifically on "Customize dashboard." Published a quick
  Artifact comparing six options (sliders, grid, pencil, layers, drag-dots, the gear) in the
  real button style rather than describing them in text — picked **sliders**. `SlidersIcon`
  added; "Customize dashboard" uses it, "Manage access" keeps the gear. `MGB_VERSION` →
  `2026-09-16k`.
- **Reported "the numbers stopped counting up."** Checked git history first — `countUpArmed`
  (the count-up gating logic) had been touched by exactly one commit in the repo's entire
  history: the one that introduced it. None of the session's other work had touched it; nothing
  was accidentally broken. The actual, unchanged-since-before behavior: numbers only ever
  counted up on the very first page landed on after a fresh load, then stayed silent for the
  rest of that session — a deliberate fix from earlier (§ recorded in an earlier handoff) for
  the animation re-firing (and looking like jitter) on every tab click. Asked directly whether
  to keep that scope or widen it — **answer: animate every time, no exceptions.**
  - Removed the disarm-on-navigation effect and the `countUpArmed`/`countUpTeardown`/
    `countUpFirstPage` refs entirely, rather than just loosening the condition — they're not
    needed: each page is conditionally rendered (`effectivePage === "x" && <Page />`), so
    switching pages or clients already mounts brand-new DOM nodes every time, which the
    existing `MutationObserver` scan picks up and animates fresh regardless. The only thing
    preventing that from already happening was the deliberate disarm logic — deleting it was
    sufficient, no new mechanism needed.
  - Worth knowing since it's a reversion of a considered decision: if "every number resets to
    $0 and counts up on every single tab click" starts feeling like jitter/noise again (the
    original complaint that led to the disarm logic in the first place), that's the tradeoff
    being knowingly taken here at the user's explicit request, not a fresh bug.
  - `MGB_VERSION` → `2026-09-16l`.

---

## 15. Update, 2026-09-16 (later still): click-to-jump KPI cards, everywhere it fits

Started as two small asks — make Home's "Your clients" KPI flash longer, and check the rest of
the app for the same opportunity — and turned into extracting a real, reusable pattern.

- **`useCardFlash()`** — a small shared hook (scroll-to + timed highlight), factored out of the
  one-off flash logic written for "Your clients" earlier today. Returns `{ flashCardId,
  jumpToCard }`; `jumpToCard(domId, cardId)` scrolls smoothly to `domId` and sets `flashCardId`
  for `CARD_FLASH_HOLD_MS`.
- **Flash duration is now 2600ms** (was 900ms) — long enough to actually read after a
  smooth-scroll lands, not just a blink. `.card-flash`'s CSS keyframes were redesigned to match:
  ring appears fast (~8%), **holds** through most of the duration, then fades — rather than the
  original quick pulse-and-gone.
- **Every page with a KPI grid now has its KPIs jump to the specific content card they
  summarize**, where one exists on the same page:
  - **Home** (already had "Your clients" from earlier): added Overdue bills / Due within N
    days → the "Needs attention" card.
  - **AP Command Center**: all four totals (Total Payable, Overdue, Due Within N Days,
    Scheduled) now both **filter** the Open Bills table to that status AND jump+flash to it —
    reuses the page's own existing status-filter control rather than adding a second one.
  - **Receivables & Payables**: Money Owed To You → Receivables table, Money You Owe →
    Payables table. Net Position stays non-clickable (it's a derived combination, no single
    card it belongs to).
  - **Giving & Funds**: Recent Giving → Recent Contributions table; Unrestricted/Restricted
    Funds → Fund Balances card (same target for both).
  - **Budget vs. Actual**: all three (Budgeted/Actual/Variance) → Spending by Category table.
  - **Budgeting Tool**: all three (Current/Proposed/Change) → Draft Budget by Category table.
  - **Dashboard**: Net Surplus and Revenue → Income vs. Expenses chart; Cash on Hand → Recent
    Activity. Operating Reserve (the runway ring) intentionally left alone — no single content
    card on the page summarizes it.
  - **Scoped Dashboard** (category-restricted client view): Budgeted/Spent/Remaining → Your
    Budget table. Your Funds KPI left alone — nothing on this page shows fund detail to jump to.
- Every jump target respects `layout.hidden` — if a bookkeeper/client has hidden the content
  card via Customize dashboard, the KPI quietly stops being clickable rather than jumping
  nowhere.
- Deliberately **not** added anywhere a KPI's target would be a guess rather than an obvious
  1:1 (or clean many-to-one) match — e.g., nothing on Report Builder, since its "KPI" numbers
  live inside the Live Preview panel itself, not a separate card to jump to.
- `MGB_VERSION` bumped to `2026-09-16o`.

---

## 16. Update, 2026-09-16 (evening): "Manage access" matches Customize dashboard; every icon
ported to the design system

- **"Manage access" now uses the sliders icon too**, not the gear — matches "Customize
  dashboard" from earlier today. `GearIcon` had no other callers left after this, so it was
  deleted outright rather than kept around unused.
- **Extracted two more inline icon groups into named components**, for consistency and so they
  could be ported below: `ChatIcon` (was duplicated inline in both `ChatFab` and `ChatWidget`)
  and `DocumentIcon`/`BarChartIcon`/`ShieldCheckIcon` (were inline in the `ENTERPRISE_FEATURES`
  array). Same thin-line house style as everything else, no behavior change.
- **Every icon used anywhere in the app is now also exported from the `mygoodbooks-ds` design
  system package** — 13 in total, one file each per that package's established convention
  (`WarningIcon`, `SearchIcon`, `LockIcon`, `PaperclipIcon`, `FlaskIcon`, `SunIcon`, `MoonIcon`,
  `SlidersIcon`, `ChatIcon`, `DocumentIcon`, `BarChartIcon`, `ShieldCheckIcon`, `LightbulbIcon`).
  Each takes any native `<svg>` prop, so size/stroke-width can be overridden per use.
  `MockBanner.tsx` was also updated to import `FlaskIcon` instead of keeping its own duplicate
  copy of that SVG.
  - `LightbulbIcon` is the one exception worth knowing about: Daily Report's own forecast
    callout (`components/daily-close/DailyClose.tsx`) is a vendored component with its own
    styling scope, so it keeps its own inline copy rather than importing from the design-system
    package — the export exists so the icon is still represented in the shared set, but editing
    it there won't change what Daily Report actually renders.
  - `README.md` updated with a full icon list; rebuilt `design-system/dist/` (`npm install &&
    npm run build`) and spot-checked the output for zero remaining emoji-range characters.
- **Checked the "paperclip is still an emoji" report** — confirmed in the live source it's
  already `PaperclipIcon` at all three call sites (compose bar, pending-attachment chip, sent
  attachment). No code fix needed; if it's still showing an emoji, that's almost certainly a
  stale cached bundle rather than something to fix here — worth a hard refresh / cache-busted
  reload before assuming it's a regression.
- `MGB_VERSION` bumped to `2026-09-16p`.

Also asked for, not yet done: icon **options** for each sidebar nav item (the sidebar currently
shows a plain dot next to each tab, no icon at all) — next up, as a visual comparison rather
than guessing which icon fits which tab.

---

## 17. Update, 2026-09-16 (night): icons on every sidebar tab

Published a mockup (real sidebar, all sections, Home/Staff Access/Client Roster included) with
one icon proposed per tab, plus alternates for four tabs that had more than one reasonable
option (Budgeting Tool, AP Command Center, Receivables & Payables, Reports). Picked: the
alternate "C" for Budgeting Tool (calculator, not shield-check) and AP Command Center (stacked
bills, not checklist), alternate "B" for Reports (download arrow, not folded-corner doc), and
the originally-proposed icon everywhere else.

- 12 new icon components (`HomeIcon`, `UsersIcon`, `ClientRosterIcon`, `GridIcon`,
  `PieChartIcon`, `BankIcon`, `SwapIcon`, `CalculatorIcon`, `StackedBillsIcon`, `DownloadIcon`,
  `GiftHeartIcon`, `FolderIcon`), same thin-line house style as everything else. `ChatIcon` and
  `DocumentIcon`/`BarChartIcon` (from the icon-porting work earlier today) got reused rather
  than duplicated — same icon for Messages/Daily Report/Report Builder in both the sidebar and
  their original spots.
- `NAV_SECTIONS` items each carry an `icon` field now (a JSX element); the nav-item button
  renders it before the label. Home/Staff Access/Client Roster's own buttons (rendered
  separately, above the main nav) got icons the same way. `.staff-access-link` switched from
  `display: block` to a flex row so its icon and label sit side by side.
- All 12 new icons also ported into the `mygoodbooks-ds` design-system package, same as the
  rest of the icon set — `design-system/dist/` rebuilt, README updated with the full sidebar
  icon list.
- Confirmed via a follow-up screenshot that the earlier paperclip-emoji fix is genuinely live
  (was a stale-cache concern, not a real regression — see §16).
- `MGB_VERSION` bumped to `2026-09-16q`.

---

## 18. Update, 2026-09-16 (night, continued): Dashboard merges with Live Report for premium
clients; Daily Report renamed

Asked whether any sidebar tabs were redundant enough to combine. Two real candidates: Dashboard
vs. Daily Report (both "here's where things stand," Daily Report just a richer live version of
the same idea) and Receivables & Payables vs. AP Command Center (the same payables data shown
twice, once plain and once with aging/filtering). Went with the first — highest-traffic page,
clearest overlap — and confirmed the shape before building: **Daily Report replaces Dashboard
entirely for premium, full-access clients**, not a combined everything-on-one-page layout.

- **`daily-close` is no longer a separate nav item.** Removed from `NAV_SECTIONS`. A premium,
  non-scoped client's "Dashboard" tab now renders what used to be the separate Live Report page
  instead of the old KPI-grid `DashboardPage` — one cohesive page, not two competing overviews.
  Standard-plan clients, and category-scoped premium users (a live org-wide snapshot has no
  "their" slice to narrow to, same reasoning `ORG_WIDE_TABS` already used), see the unchanged
  plain `DashboardPage`/`ScopedDashboardPage`.
- New `showsLiveReport` flag in `App` (`effectivePage === "dashboard" && hasPremiumPlan(client)
  && !access.isCategoryScoped`) drives both which component renders under the `dashboard` key
  and which `PAGE_META` entry the page header pulls its title/subtitle from — so the outer
  header correctly reads "Live Report" instead of "Dashboard" when that's what's actually
  showing.
- `daily-close` survives as an **internal** key (`PAGE_META["daily-close"]`, `DailyClose`'s own
  component/file names, `dailyCloseFromClient()`) even though it's not a reachable page/nav key
  anymore — renaming the vendored component and its directory for a label change wasn't worth
  the churn, same reasoning as before.
- Cleaned up now-dead references: removed `"daily-close"` from `ORG_WIDE_TABS` (redundant now
  that `showsLiveReport` checks `isCategoryScoped` directly), changed `initialPage()`'s final
  fallback from `"daily-close"` to `"dashboard"`.
- **Renamed "Daily Report" → "Live Report"** everywhere user-facing: the page header title,
  the Enterprise Tools upgrade page's feature card (title + description rewritten to describe
  "your dashboard becomes live" rather than a separate tab), and touched-up internal comments.
  The `daily-close` internal key/component/file names were deliberately NOT renamed, per above.
- `MGB_VERSION` bumped to `2026-09-16r`.

**Not done, lower priority per the original analysis:** merging Receivables & Payables into AP
Command Center for premium clients — same shape, just less-visited pages, didn't ask for it
built yet.

Also asked, separately: what would make AP Command Center itself feel worth a premium price
(brainstormed, not yet built — pending which direction is picked), and the downloadable PDF
export needs to match the new near-black navy theme (also not yet built as of this entry).

## §19 — AP Command Center premium features; PDF exports match the navy theme

Brainstormed what would make AP Command Center feel worth a premium price (batch pay runs,
approval workflow, vendor profiles, duplicate detection, ACH/bank export, cash-impact forecast).
User said to build all of it and they'd weed out anything unneeded later, rather than picking one.

- **Bill selection + batch pay runs.** Checkboxes per row (plus a header "select all shown") on
  the Open Bills table. Selecting bills surfaces a new "Pay Run" card showing the selected count/
  total, cash on hand today, and the projected balance after paying (`totalCash(client) -
  selectedTotal`) — the cash-impact forecast idea.
- **Lightweight approval workflow.** "Send for Approval" turns the selection into a `payRun`
  object (`{ ids, total, status }`) and shows an "Awaiting Treasurer approval" pill; "Approve Pay
  Run" flips it to an "Approved" pill. There's no real multi-user sign-off backend here (same
  honest-mock-data posture as the rest of the app) — it's a state machine on the client, not a
  notification sent to anyone.
- **ACH/bank export.** "Export ACH Batch (CSV)" downloads the selected (or active pay run's)
  bills as a CSV — vendor, description, amount, due date — same `Blob`/`URL.createObjectURL`
  pattern `BankPage`'s existing CSV export already used.
- **Vendor Summary card.** New card grouping `client.payables` by vendor (total open balance,
  bill count, overdue count), sorted by total descending, top 6 shown — the vendor-profile idea,
  scoped down to what the existing table already has rather than inventing a vendor detail page.
- **Duplicate detection.** Any two bills sharing the same vendor + amount are flagged with a
  "Possible duplicate" pill next to the description — a same-vendor-same-amount collision is a
  much stronger duplicate-entry signal than coincidence for a bookkeeping app's bill list.
- Recurring-bill detection was in the original brainstorm list but not built — there isn't
  enough historical/dated bill data in the mock payables to detect a real recurrence pattern
  from (a single current snapshot, not a paid-bill history), so it'd just be a fake toggle.

**PDF exports now match the navy theme.** `PDF_TABLE_THEME` and `newReportDoc()` (shared by every
report: Profit & Loss, Balance Sheet, Budget vs. Actual, Contribution Statement, Draft Budget)
were still hardcoded to the old mygoodbooks.org navy, `rgb(36, 55, 70)` / `#243746`, from before
the 2026-09-15 theme change. Replaced every occurrence with `rgb(5, 8, 13)` — `--navy` (`#05080d`)
— so the downloaded PDF's header band and heading text match the app's current near-black navy
instead of the old lighter navy. jsPDF only takes RGB triples, not CSS custom properties, so this
has to be kept in sync by hand if the theme color changes again (left a comment to that effect
above `PDF_TABLE_THEME`). The gold footer color (`rgb(199, 174, 134)`, `--gold`) was already
correct and untouched.

`MGB_VERSION` bumped to `2026-09-16s`.

## §20 — Documents tab: click a document to open a preview

Rows in "All Documents" are now clickable (and keyboard-operable — `tabIndex` + Enter) and open a
`DocumentPreviewModal` via the shared `ModalShell`.

- **Real uploads get a real preview.** `addFiles()` now keeps the actual `File` object on the doc
  record, not just its derived metadata. The modal creates an object URL from it (cleaned up with
  `URL.revokeObjectURL` on unmount) and renders an `<img>` for image extensions or an `<iframe>`
  for `.pdf`; anything else falls back to a placeholder with a Download link — there's no way to
  render a `.xlsx` or `.docx` inline without a real viewer library, and this prototype doesn't
  have one.
- **Pre-loaded sample documents have no real file behind them** (`data.js`'s `documents` arrays
  are just name/category/date/size — no bytes, no URL), so those get the same placeholder panel
  with an honest "this is sample data, there's no real file to preview yet" message instead of
  pretending to show a document. Consistent with the page's existing `MockBanner` framing.
- The "Visible To" toggle button inside each row calls `e.stopPropagation()` so clicking it
  doesn't also open the preview modal for the row it sits in.
- Swapped the dropzone's "⬆" emoji for a new `UploadIcon` (thin-line, matches the rest of the
  icon set) while touching this page — new icons `UploadIcon` and `FileIcon` (used as the
  document-row prefix and the modal's placeholder/header icon) were added net new, not yet ported
  to the design-system package.

`MGB_VERSION` bumped to `2026-09-16t`.

## §21 — Sidebar polish: no more gold divider, Messages moved to top, "Dashboard Live"

Three small sidebar requests, all in `NAV_SECTIONS`/`Sidebar`:

- **Removed the gold line under Enterprise Tools.** `.nav-section-signature`'s `border-bottom:
  1px solid rgba(199, 174, 134, 0.4)` is gone; the section still keeps its bottom padding/margin
  so spacing before the next section is unchanged, just without the rule.
- **Messages moved to its own section at the very top of the sidebar** — above even Enterprise
  Tools. Previously it lived at the bottom, inside "Client Tools" alongside Documents; a client
  could easily miss an unread-message badge buried under three sections above it. `NAV_SECTIONS`
  now starts with a single-item `Messages` section; the old `Client Tools` section, now holding
  only Documents, was renamed `Documents` since "tools" (plural) no longer fit a lone item.
  Non-signature sections render no visible heading (confirmed by re-reading `Sidebar`'s render —
  only the collapsible Enterprise Tools section gets a label button), so this reads as the
  Messages nav item simply being first, not an extra header taking up space.
- **Premium Dashboard tab reads "Dashboard Live."** The sidebar label for the `dashboard` key is
  now computed per-viewer: `"Dashboard Live"` when `hasPremiumPlan(client) && !access.isCategoryScoped`
  (the same condition `showsLiveReport` in `App` already uses to decide whether that tab renders
  the Live Report), otherwise the plain `"Dashboard"` label from `NAV_SECTIONS`. The page itself
  was already titled "Live Report" (renamed in §18) — this only changes what the sidebar *tab*
  is called, so a premium client sees "Dashboard Live" in the nav and lands on a page titled
  "Live Report," rather than a tab called plain "Dashboard" that opens something called "Live
  Report."

`MGB_VERSION` bumped to `2026-09-16u`.

## §22 — Fix: Live Report's own masthead still said "Daily Report"

§18/§21 renamed the page everywhere the app shell controls text (`PAGE_META`, the sidebar tab),
but `<DailyClose />` (`components/daily-close/DailyClose.tsx`) renders its own masthead with a
hardcoded `<h1>` — "Daily <span>Report</span>" — independent of any prop or `PAGE_META` lookup.
That heading is the big styled title actually visible at the top of the page, so the rename
never reached what the user was looking at. Changed the literal text to "Live <span>Report</span>"
(kept the same `accentword` span/styling, just swapped the word). No other "Daily Report"
occurrences left in `components/daily-close/`.

`MGB_VERSION` bumped to `2026-09-16v`.
