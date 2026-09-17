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

## §23 — Live Report accent word matches theme; sidebar gap under Enterprise Tools

- **`.dc-accentword` ("Report" in the masthead) was blue** (`var(--accent)`: `#24425f` light /
  `#7fa9c9` dark), a leftover from `DailyClose`'s own original design system — it was never
  updated when the app switched to its navy/gold theme. Fixed to the shell's gold (`#c7ae86`)
  directly, scoped to just `.dc-accentword` rather than reassigning `--accent` itself, since that
  variable is also used for the tab-indicator bar and a focus outline elsewhere in
  `DailyClose.css` that weren't reported as off-theme.
- **Sidebar gap under Enterprise Tools.** §21 removed `.nav-section-signature`'s gold
  `border-bottom` but left its `padding-bottom: 14px` / `margin-bottom: 16px` in place — those
  existed to size the gap the gold line sat inside, so removing the line without removing the
  padding left a visibly empty ~30px gap before the next section. Dropped both overrides; the
  section now falls back to the same `margin-bottom: 2px` every other `.nav-section` uses.

`MGB_VERSION` bumped to `2026-09-16w`.

## §24 — Live Report gets the same "maximize it" treatment as AP Command Center

Brainstormed what would make Live Report feel worth a premium price the same way AP Command
Center's pay runs/vendor summary/duplicate detection did. User said build all of it.

- **Click-to-jump KPI tiles.** Accounts Receivable jumps to the Receivables Aging panel below;
  Net Income jumps to the Outlook section's Revenue Trend tab. Accounts Payable cross-navigates
  to AP Command Center itself via a new optional `onNavigate` prop (wired to `setPage` at the
  `<DailyClose />` call site in `app.jsx`) — full AP detail already lives there, so this points at
  it instead of duplicating it. `onNavigate` is optional so the standalone prototype (which has
  nowhere to navigate to) still renders the tile, just non-interactive (`disabled`).
- **Cash on hand gets a threshold alert instead of a jump.** It's the one KPI tile that stayed a
  `<div>` — nesting a button-triggered editor inside a `<button>` tile isn't valid HTML, and a
  low-cash alert is a more useful interaction for that number than jumping somewhere anyway. An
  "Alert" toggle opens an inline "Alert below $___" input; the threshold is stored in
  `localStorage` per client (`mygoodbooks_cash_floor_v1:<clientId>`, same throwaway-per-browser
  posture as `app.jsx`'s own `FEATURE_FLAGS`) and the tile gets a red outline + warning line once
  today's cash total drops under it.
- **Collections queue on Receivables Aging.** `fromClient.js` now also emits row-level
  `receivables.list` (description/amount/due date/days overdue/aging tone) alongside the existing
  bucket totals — the buckets alone had no individual line items to select from. Overdue rows get
  checkboxes; "Draft Reminder" opens a `mailto:` draft (no recipient — the data has no customer
  email field yet, so this hands off to the browser's own mail client for the client to address
  themselves, same "real email you review and hit send on" posture as the staff-invite flow in
  `app.jsx`) listing the selected balances and total.
- **Anomaly review workflow.** Each "Needs a look" item gets a "Mark reviewed" / "Undo" toggle
  (local component state, not persisted); reviewed items fade and sort to the bottom, so the list
  reads as a working queue instead of a static log.
- **One-click PDF snapshot.** "Download Live Report" in the masthead builds a PDF (KPI summary,
  aging table, flagged items) using `window.jspdf` directly, styled to match the app's navy theme
  (`rgb(5, 8, 13)`, same fix as the rest of the app's PDF exports) — this file is a separate
  vendored component, so it builds its own small PDF rather than importing `app.jsx`'s
  `PDF_TABLE_THEME`/`newReportDoc` (also avoids introducing a cross-file dependency into a
  component whose module wiring is explicitly kept self-contained).
- **Not built: a period comparison toggle.** The brainstormed "vs. last year" option needs a full
  year of prior-period actuals; `client.monthly` only carries the trailing ~8 months, so a toggle
  would either be disabled most of the time or fabricate numbers the app has no real basis for —
  same reasoning that dropped recurring-bill detection from AP Command Center's brainstorm.

`components/daily-close/types.ts` gained two optional fields to carry this: `client.id` (namespaces
the cash-floor setting) and `receivables.list` (row-level backing for the Collections queue). Both
are optional so a consumer of this component that doesn't supply them (or the standalone
prototype's own sample data, now filled in for both) still renders correctly, just without the
alert/collections features. `MGB_VERSION` bumped to `2026-09-16x`.

## §25 — Global search results jump to and highlight the exact row

Previously a search result click only navigated to the right tab and left the client to scan the
whole page for what they searched. Now it scrolls straight to the matching row and flashes it,
reusing the same `useCardFlash`/`.card-flash` mechanism KPI click-to-jump already uses elsewhere
in the app — just with a new `.row-flash` variant (background-color tint instead of a box-shadow
ring, since a ring reads poorly around a single table row) sharing the same 2600ms hold-then-fade
timing.

- `GlobalSearch`'s result builder now attaches a `highlightKey` to every result (and `accountId`
  for bank transactions, since a transaction only exists in the DOM once its account tab is
  active): `"tx-" + i`, `"budget-row-" + slugify(category)`, `"doc-row-" + slugify(name)`,
  `"msg-" + i`. Clicking a result calls the existing `onNavigate` (tab switch) plus a new
  `onHighlightResult` prop.
- `App` holds a `searchTarget` state (`{ ...result, nonce }` — the nonce forces the effect on the
  receiving page to re-fire even if the same row is clicked twice), passed down only to the four
  pages that can act on it (`BudgetPage`, `BankPage`, `DocumentsPage`, `MessagesPage`), each only
  when `searchTarget.page` matches that page's own key.
- Each of those four pages gained (or reused, for `BudgetPage`, which already had one for its KPI
  jump) a `useCardFlash()` instance, an effect that calls `jumpToCard` when `searchTarget.nonce`
  changes, and `id`/flash-class wiring on the actual row. `BankPage` additionally switches
  `activeAccountId` first when the hit belongs to a different account tab than the one currently
  open, in a separate effect, before the scroll/flash effect fires.
- Messages didn't need a thread-switch step: `GlobalSearch` only ever searches the currently open
  thread's messages (a pre-existing scoping choice, not something this changed), so a message hit
  is always already on the right conversation.

`MGB_VERSION` bumped to `2026-09-16y`.

## §26 — Live Report: animated masthead line + customizable layout; sidebar reorder + rename

- **Animated masthead line.** `.dc-masthead`'s plain `border-bottom` is now an absolutely
  positioned `::after` with a `repeating-linear-gradient` dashed pattern, animated via
  `background-position-x` (`0` → `24px`, matching the pattern's own tile size) on a 1.1s linear
  infinite loop — a continuously scrolling dashed line under the title, not just a static rule.
  Respects `prefers-reduced-motion`.
- **Live Report is now customizable, same idea as Dashboard's customize feature in app.jsx** (hide
  widgets, reorder via ▲/▼). Not a call into app.jsx's `useWidgetLayout`/`WidgetPickerModal`/
  `ModalShell` — `DailyClose.tsx` is deliberately self-contained (its own header comment explains
  why: it loads before app.jsx even exists), so this is a small parallel implementation:
  `useLiveReportLayout(clientId)` (order/hidden state, `localStorage` key
  `mygoodbooks_live_report_layout_v1:<clientId>`, same shape as the Dashboard's own layout
  storage) plus a self-built `LiveReportCustomizeModal`/`LiveReportCustomizeButton` (not
  `ModalShell` — a lighter one with just Escape-to-close and backdrop click, no full focus trap).
  Eight widgets: the four KPI tiles (`kpi-cash`, `kpi-ar`, `kpi-ap`, `kpi-net`) and four content
  sections (`trend`, `expense-breakdown`, `aging`, `outlook`).
- The KPI row and every content section below it now render by mapping over
  `layout.visibleOrder` instead of being hardcoded JSX in a fixed sequence — each KPI tile's
  distinct behavior (the cash-floor editor, the AR/AP/Net-income click targets) is preserved
  exactly, just selected by id inside the map instead of written out four times in a row.
- **The old fixed 2-column `.dc-grid2` (Revenue vs. Expenses beside Where the Money Went) is
  gone**, replaced by `.dc-contentMasonry` — a CSS-columns masonry (`columns: 420px 2`), the same
  pattern `app.jsx`'s own `.content-masonry` already uses for Dashboard's customizable widgets.
  A fixed 2-up grid assumes exactly two children in a fixed order; once any of the four sections
  can be hidden or reordered relative to the others, that assumption breaks. At the default order
  the masonry still lands Revenue vs. Expenses and Where the Money Went in the first two column
  slots, so the common case looks close to before — but it's no longer a special-cased pair.

**Sidebar:** "Enterprise Tools" renamed to "Enterprise" (the `isSignature` check in `Sidebar`
updated to match). Dashboard pulled out of the "Overview" section into its own top-level section,
placed first — above Messages, which was already its own top section from §21 — so the order is
now Dashboard, Messages, Enterprise, Budget (renamed from "Overview," which held only Budget vs.
Actual once Dashboard moved out), Finances, Documents. A bookkeeper's previously-saved custom tab
order for the old "Overview"/"Enterprise Tools" section labels (`tabOrder[clientId][sectionLabel]`)
will no longer match these renamed keys and silently falls back to default order for those two
sections — the same graceful-degradation behavior the app already relies on for any stored order
that doesn't fully match its current widget set, not a new failure mode.

`MGB_VERSION` bumped to `2026-09-16z`.

## §27 — Live Report footer copy

Small wording fix in `DailyClose.tsx`'s footer: "data refreshes automatically each morning" →
"data refreshes live, automatically" (the old copy read like a once-a-day batch job, which is
exactly the framing "Live Report" replaced "Daily Report" to get away from), and "Reply to this
report or message your bookkeeper" → "Message your bookkeeper" (there's no actual reply-to-report
channel — messaging is the one real path, so the copy shouldn't imply a second one).

`MGB_VERSION` bumped to `2026-09-16aa`.

## §28 — Enterprise section moved to the top of the sidebar

`NAV_SECTIONS` reordered so `Enterprise` leads the sidebar, ahead of Dashboard and Messages —
the premium add-on section is now the first thing in the nav, not sandwiched between them.
`isSignature`'s collapsible/gold styling is unaffected by section order, so this is purely a
`NAV_SECTIONS` array reorder. `MGB_VERSION` bumped to `2026-09-16ab`.

## §29 — Live Report footer: "Message your bookkeeper" links to Messages

The footer's "Message your bookkeeper" was plain text. Now a button (styled as an inline gold
link, matching the accent word) that calls the existing `onNavigate` prop to jump straight to the
Messages tab — same prop already wired for the Accounts Payable KPI tile's cross-navigation to AP
Command Center. Falls back to plain text when `onNavigate` isn't provided (the standalone
prototype), same guard pattern as that KPI tile. `MGB_VERSION` bumped to `2026-09-16ac`.

## §30 — Enterprise sidebar section is no longer collapsible

Enterprise was the one section with a click-to-collapse heading (chevron, `collapsedSections`
state). Removed: `collapsedSections`/`toggleSection` state deleted from `Sidebar`, and the
Enterprise heading is now a plain, always-visible `<div>` (still gold-styled via
`nav-section-label-signature`) rather than a `<button>` toggle — no chevron, no `aria-expanded`,
items are never `hidden`. Added `.nav-section-label-static` to strip the pointer cursor/hover
background the shared `.nav-section-label` class still needs for the non-premium upsell row
(which is a real button and stays clickable). Dead CSS this left behind (`.nav-section-chevron`,
`.nav-section.collapsed .nav-section-chevron`, `.holds-active`, `.nav-section-label .nav-badge-dot`)
was removed rather than left orphaned. `MGB_VERSION` bumped to `2026-09-16ad`.

## §31 — Standard-plan Enterprise upsell row: badge placement + upgrade icon

The "Premium" badge on the standard-plan upsell row had `margin-left: auto`, which in the row's
flex layout pushed it all the way to the far right edge of the sidebar — far from the word
"Enterprise" it's labeling, rather than sitting next to it. Removed that so the badge sits
directly after the label text. Added a new `UpgradeIcon` (thin-line diagonal arrow, same house
style as every other icon) at the far right instead — `margin-left: auto` moved to a new
`.nav-upsell-icon` class on it, so the row now reads "Enterprise · Premium ⤴" — the badge
explains what's next to it, the icon on the far edge reads as "upgrade/add-on" at a glance.
`MGB_VERSION` bumped to `2026-09-16ae`.

## §32 — Enterprise upgrade page caught up with everything built since it was written

`EnterpriseUpgradePage`/`ENTERPRISE_FEATURES` hadn't been touched since the original 3-tool
version — missing AP Command Center entirely (built and maximized in §17/§24) and still saying
"Enterprise Tools" everywhere after the §21 rename to "Enterprise."

- Added a fourth feature card, **AP Command Center**, with `StackedBillsIcon` (matches its
  sidebar icon) and a description covering what actually got built: aging + vendor summaries,
  batch pay runs with approval and a cash-impact forecast, duplicate-bill detection, ACH export.
- Fixed **Budgeting Tool's icon** — it was `ShieldCheckIcon` (a security/trust glyph with no
  connection to budgeting), swapped for `CalculatorIcon`, the same icon the sidebar already uses
  for that tab.
- Updated **Live Report's description** to mention what it actually does now (click-to-jump KPIs,
  cash alert, collections queue, PDF export, customizable layout) instead of just the original
  "continuously-live snapshot" line.
- Renamed every "Enterprise Tools" string on this page and its supporting code to "Enterprise":
  the `MockBanner` text, the eyebrow badge, the "Unlock ___ for {client.name}" heading,
  `PAGE_META["enterprise-upgrade"].title`, the `FEATURE_FLAGS` dev-tools description, and a code
  comment. "Three tools" → "Four tools" in the intro paragraph.
- `.report-grid` already uses `repeat(auto-fit, minmax(240px, 1fr))`, so the fourth card needed no
  CSS changes to lay out cleanly.

`MGB_VERSION` bumped to `2026-09-16af`.

## §33 — Developer Tools is now its own sidebar page; upsell icon swapped for a padlock

- **Feature flags + "Reset local state" moved out of Staff Access into a new `DeveloperToolsPage`,**
  reachable from a new admin-only sidebar link (Home / Staff Access / Client Roster / **Developer
  Tools**, new `WrenchIcon`). It didn't belong buried in the middle of the one page that writes
  directly to the real Supabase staff table — Developer Tools touches only this browser's own
  `localStorage`, and mixing the two made it easy to mistake one for the other. Staff Access keeps
  its "System info" card (app version, Supabase project, staff/audit table read status) since
  that's diagnosing Staff Access's own Supabase connectivity, not a generic dev toggle.
- New synthetic page `"developer-tools"`, gated the same way as `staff-access`/`client-access`
  (admin role, not impersonating) in `effectivePage`'s bypass logic, with its own `PAGE_META` entry.
- **Introduced `NON_CLIENT_PAGES`** (`bookkeeper-home`, `staff-access`, `client-access`,
  `developer-tools`) — every place that used to special-case "is this one of the synthetic
  staff-only pages" with an ad-hoc `page !== "x" && page !== "y"` chain (the client picker, the
  "preview as" picker, the "Manage access" button, whether to stamp a client visit, both header
  greeting spots, the mobile topbar title, the nav's own render branch) now reads
  `NON_CLIENT_PAGES.has(page)`. Adding developer-tools by hand-editing every one of those checks
  is exactly the kind of place a spot gets missed; one shared set closes that off for whatever
  gets added next too.
- **Swapped the standard-plan upsell row's icon** from the diagonal arrow (§31) to `LockIcon` —
  the app already had this icon (used on Documents' "Full access only" pill), and a padlock is a
  more literal match for "this is behind a paywall" than a generic external-link-style arrow.
  `UpgradeIcon` deleted as dead code now that nothing uses it.

`MGB_VERSION` bumped to `2026-09-16ag`.

## §34 — Developer Tools: the four follow-up suggestions

Built all four dev-tool suggestions from the Developer Tools split-out.

- **Fixed "Reset local state"'s real gap.** It cleared an explicit, hand-maintained list of
  keys (`RESETTABLE_STORAGE_KEYS`) that had already drifted out of date — neither the cash-floor
  alert (`mygoodbooks_cash_floor_v1:<clientId>`) nor Live Report's own widget layout
  (`mygoodbooks_live_report_layout_v1:<clientId>`) were in it, so resetting silently left them
  behind. Replaced with `resettableLocalStorageKeys()`, which matches every key under the shared
  `mygoodbooks_` prefix at reset time instead of a maintained list — closes the gap for whatever
  gets added next too. Feature flags (`mygoodbooks_ff_*`) are deliberately excluded, since they're
  their own toggles right above the button, not what "reset local state" means.
- **Jump to client.** A search-by-name box at the top of Developer Tools; clicking a result calls
  a new `onJumpToClient` prop (wired at the render site to `setSelectedClientId` + `setPage("dashboard")`),
  skipping the sidebar dropdown.
- **Raw local storage viewer.** Lists every `mygoodbooks_` key currently in this browser with its
  stored value, pretty-printed if it's JSON. Not reactive to storage changes (a "Refresh" button
  re-reads on demand) — good enough for "let me see what's actually stored" during a bug report.
- **Simulate slow network.** New feature flag, checked directly in
  `components/auth/supabaseClient.js` (not through app.jsx's `isFlagOn()` — that file loads
  before app.jsx exists, so it duplicates the same "1" in localStorage check under the same key,
  with a comment pointing at why). When on, `createClient()`'s `global.fetch` override adds an
  ~1.8s delay before every real Supabase request — every existing call site (Staff Access's roster
  and audit-log loads, client access, etc.) gets the delay for free, without touching any of them.

`MGB_VERSION` bumped to `2026-09-16ah`.

## §35 — System info/Recent activity/Where things live moved to Dev Tools; Jump to client on Home

- **Moved three cards from Staff Access to Developer Tools**: "Recent activity" (the
  `staff_audit_log` read), "System info" (app version, Supabase project, read-status checks,
  signed-in-as), and "Where things live" (`INFRA_LINKS`). None of them are about who can sign in —
  they're debugging/ops aids, same category as the feature flags and local-state reset that
  already moved there in §33.
  - The audit-log fetch (`loadAudit`) moved wholesale into `DeveloperToolsPage`, including its own
    `auditRows`/`auditError` state — Staff Access no longer re-fetches or displays it, and the
    `loadAudit()` calls after every staff-admin action (add/remove/update/CSV import) were dropped
    from `StaffAccessPage`, since nothing there renders that state anymore; Developer Tools does
    its own fresh fetch on mount whenever someone actually opens that page.
  - "Staff table read" status **could not simply move** — Staff Access's own `rows`/`loadError`
    are tied to the actual roster fetch that page still needs for its CRUD table. Developer Tools
    gets its own minimal read-only check instead (`select("id").limit(1)`, status only, no data
    kept) rather than duplicating the full roster query.
  - `DeveloperToolsPage` now takes a `staffUser` prop (for "Signed in as"), wired at its render
    call site the same way `StaffAccessPage` already receives it.
- **"Jump to client" added to `BookkeeperHomePage`, at the very top** — same search-by-name,
  click-to-jump pattern as Developer Tools' own version (§34), reusing the page's existing
  `onNavigateToClient` prop rather than adding a new one. Deliberately separate from the page's
  existing "Your clients" card/search (`clientSearch` state) further down: that card is a
  customizable widget that can be hidden or reordered via Customize dashboard, while this is a
  fixed quick-jump that's always the first thing on the page.

`MGB_VERSION` bumped to `2026-09-16ai`.

## §36 — Fix: chat widget could pop up on Developer Tools; Dev Tools masonry layout

- **Bug**: the floating chat widget's `canShow` effect explicitly excluded `bookkeeper-home`,
  `staff-access`, and `client-access` by name, but was never updated when `developer-tools` was
  added in §33/§35 — exactly the class of bug `NON_CLIENT_PAGES` (§33) exists to prevent, except
  this call site had been missed when that refactor went through. A client's unread-message
  widget could pop up while looking at Developer Tools, scoped to whatever client happened to be
  last selected — not just visually odd, actively misleading (nothing about that page is about
  any client). Switched the check to `!NON_CLIENT_PAGES.has(effectivePage)`, closing this one and
  any future page in that set off from the same mistake.
- **Audited every `.content-masonry` usage in the app** for the same mistake (per user request,
  a page-by-page check). Five of six wrap either a dynamic customizable widget list or multiple
  fixed cards — fine as-is. The sixth, Developer Tools' "System info," was a masonry wrapping a
  single card by itself — a leftover from when it used to sit alongside the "Developer tools" card
  before that moved out in §33, leaving System info alone in a masonry container next to visibly
  empty space (see the reported screenshot). Moved "Where things live" into that same masonry
  instead of its own separate full-width card below, so the two now sit side by side.

`MGB_VERSION` bumped to `2026-09-16aj`.

## §37 — Customize move buttons: SVG chevrons, bigger mobile touch targets

Replaced the "▲"/"▼" text-glyph move buttons in both Customize dashboard's `WidgetPickerModal`
(app.jsx) and Live Report's `LiveReportCustomizeModal` (DailyClose.tsx) with proper thin-line SVG
chevrons (new `ChevronUpIcon`/`ChevronDownIcon` in app.jsx; DailyClose gets its own inline copies,
same self-containment reasoning as its other icons) — a Unicode triangle glyph at font-size 10px
renders inconsistently small across devices/fonts, which is what made these read as "too small on
mobile."

- `.widget-picker-move-btn` bumped from 26×22px to 28×24px at desktop, and gets its own mobile
  touch-target override (38×36px, 18×18px icon) in the same `min-height: 44px` media-query block
  every other touch control in the app already uses — it had been left out of that block entirely,
  which is the real reason it stayed small on a phone regardless of the glyph swap.
- `.dc-customizeMoveGroup button` bumped from 26×26px to 34×34px (Live Report's customize modal
  has no separate mobile breakpoint yet, so this is just a larger base size, flex-centered around
  the new icon).

`MGB_VERSION` bumped to `2026-09-16ak`.

## §38 — Customize dashboard rows get real breathing room on mobile

The ⠿ drag handle next to each row's move buttons does nothing on a touch device — dragging is
mouse-only (`useDragReorder`'s own comment explains why: four different real-device bugs made
reimplementing native drag-and-drop over touch not worth it). At phone width it just crowded the
row next to the move buttons, reported as looking overlapped. Hidden via
`.widget-picker-row .drag-handle { display: none; }` in the existing mobile touch-target media
query — move is already the only way to reorder on a phone, so nothing is lost.

That alone didn't fully fix the cramped feel: every widget's label/description wraps to 2-3 lines
at phone width, and the move-button stack (§37's mobile bump) runs ~76px tall — vertically
centering either against the other, at the original tight spacing, still read as nearly
overlapping. Given the OK to let rows spread out for the sake of it, added: more gap between rows
in `.widget-picker-list` (4px → 10px), top-aligned columns instead of centered
(`align-items: flex-start`) so wrapped text and the button stack each keep their own clear space,
and a bit more row padding.

`MGB_VERSION` bumped to `2026-09-16al`.

## §39 — Move buttons side by side; chat widget never renders over an open modal

- **Widget picker move buttons are now side by side** (`.widget-picker-move` switched from
  `flex-direction: column` to `row`) instead of stacked — also shrinks the column's height back
  down to just the button height, which reduces the vertical cramping §38 was already fighting
  with extra row spacing.
- **The floating chat FAB/widget could render in front of an open modal** (reported: the Customize
  dashboard modal's "Done" button on a phone). `.modal-overlay` (z-index 2000) already outranks
  `.chat-fab-wrap`/`.chat-widget` (z-index 900) on paper, but a modal mounted deep in the component
  tree can still lose that comparison in practice depending on ancestor stacking contexts, and
  chasing that case by case isn't worth it when the fab has no reason to be visible at all while a
  modal has focus. Fixed with `body:has(.modal-overlay) .chat-fab-wrap, body:has(.modal-overlay)
  .chat-widget { display: none; }` — every modal in the app renders through the shared
  `ModalShell`, which always wraps itself in `.modal-overlay`, so this one CSS rule covers every
  current and future modal without threading each one's own open state up to `App` just to gate
  this.

`MGB_VERSION` bumped to `2026-09-16am`.

## §40 — Switching clients lands on Dashboard; sidebar order confirmed

- **Sidebar order**: Dashboard already sits immediately below the Enterprise section (moved there
  in §31/§32), so "Dashboard Live is the first tab under Enterprise" for a premium client was
  already true structurally — checked, not changed. It can't literally live *inside* the
  Enterprise section's own item list: that section's items are entirely replaced by a single
  upsell button for standard-plan clients (`isSignature && !hasPremiumPlan(client)`), which would
  make Dashboard vanish from a standard client's sidebar entirely if it were nested there.
- **New behavior**: switching which client is selected now resets `page` to `"dashboard"` — this
  app is browsed by staff via the client picker, not separate per-client client logins, so "first
  page that loads for premium/standard clients" means what shows right after picking a different
  client, not a distinct login flow per client. Previously the current tab carried over across a
  client switch (e.g., staying on Report Builder after switching to a standard-plan client that
  doesn't even have that tab). A `skipFirstClientSwitch` ref skips the very first run of this
  effect (on mount) so a plain page refresh still restores the last-viewed tab as before — this
  only fires on an actual switch.

`MGB_VERSION` bumped to `2026-09-16an`.

## §41 — Renamed: Receivables & Payables → Cash Flow, AP Command Center → Cash Flow Pro

Standard-plan "Receivables & Payables" → **Cash Flow**; premium-only "AP Command Center" →
**Cash Flow Pro**. Chosen over keeping "Command Center" or "AP" in the name so the premium tab
reads as an upgraded tier of the standard one (same relationship the naming already implies
between them) rather than a narrower AP-only tool.

Blanket string replacement across every user-facing occurrence: `NAV_SECTIONS` labels,
`PAGE_META` titles (`receivables`/`ap-command-center` keys, unchanged — display text only),
`ENTERPRISE_FEATURES`' Cash Flow Pro card, Report Builder's section picker
(`REPORT_SECTION_DEFS`) and its rendered `<h2>`, the cross-tab "Cash Flow" widget on Bookkeeper
Home, the page's own `MockBanner` text, and every code comment mentioning either name — plus the
matching swap in `DailyClose.tsx`'s Live Report (its Accounts Payable KPI tile's "view in ___"
cross-navigation label). Internal keys (`"receivables"`, `"ap-command-center"`) are untouched —
same internal-key-survives-the-rename pattern as the earlier Dashboard/Live Report rename, so
nothing about routing, `ORG_WIDE_TABS`, `PREMIUM_TAB_KEYS`, or stored tab config broke.

`MGB_VERSION` bumped to `2026-09-16ao`.

## §42 — Dashboard and Messages moved above Enterprise

Reverses §31's "Enterprise leads the sidebar" ordering: `NAV_SECTIONS` now starts with Dashboard,
then Messages, then Enterprise, then the rest — unchanged otherwise. Enterprise keeps its static
gold heading (§30) and its own item order.

`MGB_VERSION` bumped to `2026-09-16ap`.

## §43 — Dashboard & Messages now live inside Enterprise, as its first two items

Reconciles two contradictory-sounding requests from the same conversation: "Enterprise needs to
be at the top" and "Dashboard Live and Messages need to be at the top." Both are true at once
once Dashboard and Messages are items *inside* the Enterprise section rather than their own
separate sections above or below it — `NAV_SECTIONS` is back down to Enterprise leading the
sidebar, but its `items` array now starts with `dashboard`, `messages`, then the three premium
tools.

This is the nesting I'd avoided in §31/§32 because the section's whole item list used to get
replaced by a single upsell button for standard-plan clients (`isSignature &&
!hasPremiumPlan(client)` returned early with only a CTA) — nesting Dashboard/Messages in there
would have made them vanish from a standard client's sidebar entirely. Fixed properly this time:

- That early-return branch is gone. `items` is still filtered by `visibleKeys.has(item.key)` as
  before — since `resolveAccess()` already strips the premium keys (`report-builder`,
  `budgeting-tool`, `ap-command-center`) out of a standard-plan client's `access.tabs`, this filter
  alone naturally narrows the Enterprise section down to just Dashboard + Messages for them, with
  no separate branch needed to keep those two reachable.
- A `showUpsell = isSignature && !hasPremiumPlan(client)` flag now appends a single upsell row
  *after* whatever items did make it through, instead of replacing the whole section. Same visual
  treatment (gold shimmer, Premium badge, padlock icon), just positioned as the last item in the
  list rather than the section's only content.
- The gold "signature" shimmer treatment (`.nav-item-signature`) now keys off `item.premium`
  instead of the section's `isSignature` flag — Dashboard and Messages sit inside the Enterprise
  section but aren't premium features themselves, so they render as plain nav items; only the
  three gated tools (and the upsell row) get the gold treatment.
- `TabSettingsModal`'s "Pages they can open" list groups by the same `NAV_SECTIONS` structure, so
  Dashboard/Messages now appear grouped under the "Enterprise" heading there too — a natural
  consequence of the shared source of truth, not a separate change.

`MGB_VERSION` bumped to `2026-09-16aq`.

## §44 — Shortened the Enterprise upsell row label

§43's upsell row spelled out "Report Builder, Budgeting Tool & Cash Flow Pro" as its label —
wrapped to three lines in the sidebar and looked cluttered next to the one-line items above it.
The "Enterprise" section heading already sets the context, so the row itself just needs a short
call to action: shortened to "Premium tools."

`MGB_VERSION` bumped to `2026-09-16ar`.

## §45 — Premium badge/lock moved onto the Enterprise heading; no separate upsell row

§43/§44's separate upsell row (a fake "tab" spelling out which tools were locked) is gone. The
Premium badge and padlock now live directly on the "Enterprise" section heading itself: for a
standard-plan client the heading becomes a clickable button (same gold shimmer, `Premium` badge,
`LockIcon`, opens the upgrade page), for a premium client it's the same plain static heading as
before. Locked tool names (Report Builder, Budgeting Tool, Cash Flow Pro) no longer appear
anywhere in a standard-plan client's sidebar at all — they're simply absent from `items` (already
filtered out via `access.tabs`), with the heading alone signaling that there's more available.

`MGB_VERSION` bumped to `2026-09-16as`.

## §46 — Removed the stale "Pick a client above" note on Bookkeeper Home

Home's sidebar showed "Pick a client above to see their tabs." — but the client-picker dropdown
is deliberately hidden on Home (per the existing comment just above this code: showing one there
would be confusing, since Home isn't about any single client). The note referred to a dropdown
that was never actually shown on that page. Removed; Home now renders no sidebar note at all,
same as the other synthetic staff-only pages (Staff Access, Client Roster, Developer Tools).
Dropped the now-dead `.sidebar-home-note` CSS rule too.

`MGB_VERSION` bumped to `2026-09-17a`.

## §47 — Added Team Chat: internal staff messaging

Bookkeepers can now message management directly inside the app, separate from client
conversations (which are still mock data — `data.js`'s `threads`, not Supabase). This is a real
feature on a real backend table, same posture as `staff_reminders`/`client_notes`.

- **New table `staff_messages`** (`supabase/staff-messages.sql`, already applied to the live
  project): `staff_email` (whose thread — always the bookkeeper's, regardless of who's writing
  into it), `author_email`/`author_name`/`author_role`, `text`, `created_at`. One thread per
  bookkeeper. RLS: a bookkeeper reads/writes only their own thread
  (`staff_email = auth.jwt() ->> 'email'`); any active admin reads/writes any thread
  (`is_active_staff_admin()`, reused from `staff-admin-policies.sql`) — there's no single "the
  account manager" row in `staff`, every admin can pick a thread up. Either way, `author_email`
  is checked against the signed-in JWT, so nobody can post as someone else.
- **New page `StaffMessagesPage`**, reachable from a new sidebar link ("Team Chat", new
  `ChatIcon` reuse) visible to **every** signed-in staff member, not just admins — unlike Staff
  Access/Client Roster/Developer Tools. A bookkeeper sees their own thread directly; an admin
  gets a roster picker (reusing the client-messaging `.thread-picker`/`.thread-tab` styling) to
  choose whose thread to open. Reuses `.message-thread`/`.message-bubble-row`/`.message-compose`
  from the client messaging UI — text-only, no attachments (nothing real to store one in yet,
  unlike client messages' in-memory mock attachments).
- **Sidebar unread dot**: `App` tracks `staffMessagesUnread`, rechecked on every page change (a
  single lightweight query, not polling) — an admin's check scans the latest message per
  bookkeeper thread across the board; a bookkeeper's only checks their own. "Read" is a
  per-thread `localStorage` timestamp (`mygoodbooks_staffmsg_read_v1:<bookkeeper email>`, same
  per-browser-only posture as every other read-tracking in this app), stamped the moment a
  thread is opened and already covered by Developer Tools' "Reset local state" (prefix-matched,
  see §34).
- **Hidden during "View as" impersonation.** Whose Team Chat thread should show while an admin is
  impersonating a bookkeeper — the real admin's, or the impersonated bookkeeper's — has no clean
  answer, so `staff-messages` simply isn't reachable mid-impersonation (same treatment the other
  admin-only synthetic pages already get, extended here to a page that's normally open to every
  role).
- Added `staff-messages` to the existing `NON_CLIENT_PAGES` set (§33) and swapped one remaining
  hand-written page-name chain (the sidebar's own nav-render branch) over to it while touching
  this code, closing the last spot that predated that refactor.

`MGB_VERSION` bumped to `2026-09-17b`.

## §48 — Documents tab: added folders

Clients (and bookkeepers) can now organize the Documents tab into folders, so files don't just
sit in one flat list.

- **Persistence, deliberately narrower than the rest of the page.** Documents themselves stay
  session-only mock data (rebuilt from `client.documents`/newly uploaded files on every mount,
  per the page's own `MockBanner`) — that hasn't changed. But which folder each document sits in
  is the one part of this page worth remembering between visits, so it's the one part that's
  actually persisted: `mygoodbooks_doc_folders_v1:<client.id>` in `localStorage` holds `{ folders,
  assignments }`, where `assignments` maps document **name** → folder name (there's no stable doc
  id in this data model). On mount, the persisted assignments are merged onto the fresh
  `client.documents` array; any edit to folders or a doc's folder re-derives and re-saves that
  blob. Already covered by Developer Tools' "Reset local state" via the existing
  `mygoodbooks_`-prefix sweep (§34) — no new key to hand-register.
- **UI**: a pill row above the document table — "All Documents" (total count) plus one pill per
  folder (its own count, a small `×` to delete it), plus a "+ New Folder" pill that swaps to an
  inline text input. Selecting a pill filters the table to that folder and retitles the card.
  Deleting a folder unassigns its documents back to Unfiled rather than deleting them — confirmed
  via `window.confirm` since it can't be undone from the UI.
- **Per-row assignment via a `<select>` dropdown**, not drag-and-drop. This app abandoned touch
  drag-and-drop app-wide earlier in the project after repeated real-device bugs — every
  "reorder"/"move" UI since uses buttons or a dropdown instead (`ChevronUpIcon`/`ChevronDownIcon`
  move buttons, etc.). A drag-to-file-into-folder interaction would reintroduce exactly that risk
  for no real gain over a `<select>`, which works identically on every device with no new gesture
  code.
- A file uploaded while a folder is selected lands directly in that folder (`activeFolder` is
  used as the new doc's initial `folder`), rather than always landing in Unfiled.
- New CSS: `.doc-folder-bar`, `.doc-folder-pill` (+ `.active`, `.doc-folder-add-trigger`),
  `.doc-folder-count`, `.doc-folder-remove`, `.doc-folder-new`, `.doc-folder-select` — styled off
  the same tokens as the existing `.visibility-toggle` pill.

`MGB_VERSION` bumped to `2026-09-17c`.
