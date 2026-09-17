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

## §49 — Team Chat v2: any-to-any DMs, attachments, edit/unsend, live read receipts

Rebuilt Team Chat's data model from the ground up. The old one (§47) supported exactly one
fixed thread per bookkeeper ("that bookkeeper" <-> "any admin who picks it up") — good enough
for a first cut, but it couldn't support two bookkeepers messaging each other about a shared
client, and had no room for attachments, edit/unsend, or real read receipts. This replaces it
with a real conversation model.

- **New schema** (`supabase/staff-chat-v2.sql`, already applied live; **drops the old
  `staff_messages` table** — sample/test content only, not worth migrating):
  - `staff_conversations` — one row per 1:1 DM, keyed by `dm_key` (`"emailA|emailB"`, sorted) so
    "open my conversation with X" is a single indexed lookup instead of a membership join.
  - `staff_conversation_members` — `(conversation_id, staff_email, last_read_at)`. `last_read_at`
    is the real read receipt: stamped server-side the moment a conversation is opened, readable
    by the other participant, and the basis for both the sidebar unread dot and the per-message
    "Sent"/"Seen" label.
  - `staff_messages` — now `conversation_id`-scoped rather than `staff_email`-scoped, plus
    `attachment_name`/`attachment_url`/`attachment_size`, and `edited_at`/`deleted_at` for
    edit/unsend.
  - RLS: a new `is_conversation_member()` security-definer function (same recursion-avoidance
    pattern as `is_active_staff()`) gates reading/sending messages. Editing/unsending is its own
    policy: `author_email = jwt() and created_at > now() - interval '5 seconds'` — the 5-second
    window is enforced server-side, not just hidden in the UI once it passes.
  - New public storage bucket `staff-chat-attachments`, with insert restricted to active staff
    and select open to anyone (internal tool; same posture as everything else in Team Chat).
  - `staff_messages` and `staff_conversation_members` added to the `supabase_realtime`
    publication — the client subscribes to both, so a new message, an edit, an unsend, or the
    other person opening the thread all show up live with no polling and no manual refresh.
- **Directory + recent chats, one merged list.** `StaffMessagesPage` loads every other active
  staff member once, and merges it with the caller's actual conversations (most recent first) —
  clicking an existing conversation opens it, clicking someone with no conversation yet creates
  one (finds-or-creates by `dm_key`) and opens it. This is deliberately *not* admin-gated the way
  the old roster picker was: any bookkeeper can start a DM with any other bookkeeper or admin,
  which is the whole point of "bookkeepers working the same client need to talk to each other."
- **Attachments**: a paperclip button plus drag-and-drop onto the message card (reusing the exact
  `.message-card.dragging`/`.attach-btn`/`.attachment-chip` classes and staging flow the mock
  client-messaging page already had) uploads to the new storage bucket on send and stores a
  public URL + name + size on the message row.
- **Edit/unsend, 5-second window.** Each of the sender's own messages shows Edit/Unsend links for
  5 seconds after sending (a `setInterval` re-render tick expires them live, without needing a
  page action to notice the window closed) — editing does an in-place text update
  (`edited_at` stamped, tagged "· edited" in the UI), unsending soft-deletes (`deleted_at`
  stamped; the client just filters those rows out, no "message removed" placeholder for now).
  Both are enforced again server-side by the RLS policy, not just hidden client-side once expired.
- **Read receipts**: the sender's own most recent message in an open thread shows "Sent" until the
  other participant's `last_read_at` catches up to that message's `created_at`, at which point it
  flips to "Seen" — live, via the Realtime subscription on `staff_conversation_members`, not on
  next reload.
- Removed the old per-browser `mygoodbooks_staffmsg_read_v1:*` localStorage read-tracking
  entirely — read state is now a real server column, which is both more correct (works the same
  regardless of who's on the other end) and was needed anyway for the live "Seen" label.
- `App`'s sidebar-dot check (`checkStaffMessagesUnread`) rewritten against the new schema — same
  idea (latest message per conversation vs. that conversation's `last_read_at`), no more
  admin/bookkeeper special-casing since every conversation is now symmetric.

`MGB_VERSION` bumped to `2026-09-17d`.

## §50 — Small polish: branded confirm dialogs, an animated dropzone border, and one less popup

Three small fixes, bundled with the Team Chat v2 work above:

- **`window.confirm()` replaced with a real in-app modal** for the Documents folder-delete flow.
  The browser's native `confirm()` dialog is chrome-owned and prefixes itself with the page's
  domain ("example.com says…"), which reads wrong for a client-facing app under its own brand.
  New `ConfirmModal` component (next to `ModalShell`) renders an ordinary modal instead, so there's
  no browser-owned text in it at all. Only the folder-delete confirm was moved over for now — the
  other three `window.confirm()` call sites (staff/client-access removal, note deletion) are
  unchanged.
- **Animated dashed border on the document upload dropzone.** A real CSS `border` can't animate
  its own dashes marching around a rounded rect. First pass used a rotating masked
  `repeating-conic-gradient`, but that just spins the whole ring around the card's center — not
  the same thing as the dashes trailing along the perimeter. Replaced with the same idea as the
  Live Report masthead's scrolling rule (`components/daily-close/DailyClose.css`'s
  `dcMastheadScroll`), traced around a rounded rect instead of a straight line: an absolutely
  positioned SVG `<rect>` overlay with `stroke-dasharray`/animated `stroke-dashoffset`. Speeds up
  while a file is being dragged over it.
- **Client messages: no more auto-opening floating chat window.** The desktop-only `ChatWidget`
  (a floating mini-thread that popped open automatically over any unread message) is removed
  entirely. Every screen size now gets the same treatment mobile already had (`ChatFab` — a plain
  round unread-count button that jumps straight to the real Messages page on tap) rather than a
  screen-stealing panel appearing unprompted. Corresponding now-dead `.chat-widget*` CSS removed.

`MGB_VERSION` bumped to `2026-09-17d` (same bump as §49 — landed together); the dropzone border
fix below landed as a quick follow-up and bumped it again to `2026-09-17e`.

## §51 — Dashboard: two new widgets, plus saved views

The premium-tab brainstorm earlier (Reconciliation Pro, Fund Accounting Pro, Custom Dashboard
Pro) is parked — names/scope for those are still undecided. This is the "Custom Dashboard Pro"
half of that list landing on the *existing* Dashboard tab instead of behind a new premium tab:
more widget choices and saved layouts, no gating, no tab renamed.

- **Two new widget types**, added to `DashboardPage`'s `widgets` array alongside the existing
  ones (opt-in like any other widget, but visible by default — same "new widget merges into
  everyone's order" behavior `useWidgetLayout`'s own comment already documents):
  - **Cash by Account** — the existing `AccountCashDonut` component (already used on the Bank
    Accounts tab), reused here rather than rebuilt, so cash's per-account split doesn't require
    leaving the dashboard to see.
  - **Top Expense Categories** — this month's biggest expense categories, rendered with the
    existing `ReportBarRows` component. Deliberately expense-only and chart-styled, rather than
    reusing `CategoryLedger` (the income+expense ledger already embedded inside the Income vs.
    Expenses card) outright — the two would otherwise show the same numbers twice if a client
    turned on both.
- **Saved views.** `useWidgetLayout` (shared by `DashboardPage`, `ScopedDashboardPage`, and
  Bookkeeper Home — all three get this for free) now tracks named snapshots of an order/hidden
  set, separate from the single "current" layout it already persisted: `saveView(name)` (new
  `localStorage` key `mygoodbooks_dashboard_views_v1`, same scoping as the existing widget-layout
  key so a bookkeeper's scoped preview doesn't see a client's own saved views or vice versa),
  `applyView(name)`, `deleteView(name)`. Surfaced in the existing "Customize dashboard" modal
  (`WidgetPickerModal`) as a new "Saved views" section below the widget list — save the current
  arrangement under a name, apply or delete any saved one. Saving under a name that already
  exists overwrites it rather than piling up duplicates.

`MGB_VERSION` bumped to `2026-09-17f`.

## §52 — Live Report: the same two dashboard features, but on the premium tab

§51's widgets landed on the standard `DashboardPage` only. Premium-plan clients never see that
page — their Dashboard tab renders Live Report (`<DailyClose />`, `showsLiveReport` in `App`)
instead, a completely separate, self-contained component with its own widget-layout system
(`LIVE_REPORT_WIDGETS`/`useLiveReportLayout`/`LiveReportCustomizeModal` in `DailyClose.tsx` — not
a call into app.jsx's `useWidgetLayout`, by the file's own existing design: it's meant to load and
run independent of app.jsx). §51 was explicitly asked for on this tab too, so this ports both
features into that parallel system rather than assuming premium clients get them for free.

- **Cash by Account** didn't already exist here, since `DailyCloseData.cash` only ever carried a
  single total, no per-account split. Added `cash.byAccount?: { name, balance }[]` to
  `types.ts` (optional — omitting it hides the panel), populated in `fromClient.js` from
  `client.bankAccounts`, and added to `sampleData.ts`. New `DonutList` component in
  `DailyClose.tsx` (a conic-gradient donut, same technique as app.jsx's `AccountCashDonut`, but a
  parallel implementation rather than a shared one — same self-containment reasoning as the rest
  of this file) plus matching `dc-donut*` CSS in `DailyClose.css`, built off this file's own color
  tokens (`--series-revenue`/`--good`/`--warning`/`--critical`) rather than app.jsx's gold/navy
  ones, so it stays visually native to Live Report instead of looking pasted in.
- **Top Expense Categories already existed here** under a different name — "Where the Money
  Went" (widget id `expense-breakdown`) is the same "this month's expenses by category" data,
  already shipped. Nothing to add.
- **Saved views** ported into `useLiveReportLayout`: `views`/`saveView`/`applyView`/`deleteView`,
  same shape as app.jsx's version, new `localStorage` key
  `mygoodbooks_live_report_views_v1:<clientId>`. Surfaced as a new "Saved views" section in
  `LiveReportCustomizeModal`, below the widget list.

`MGB_VERSION` bumped to `2026-09-17g`.

## §53 — Sidebar: collapsed premium tabs into their standard counterpart, PRO pill instead of a second name

Naming cleanup, worked through first as a mockup (two artboards comparing today's sidebar against
a proposed one, plus a third showing an alternative "in-page toggle" approach that was considered
and turned down in favor of this one). Three pairs of tabs that used to be two separately-named
rows in the sidebar — one visible to every client, one only to premium clients — are now one row
each, same name for both plans, with a small gold "PRO" pill marking the upgraded state. This is
the same pattern `Dashboard`/Live Report already used (one tab, content swapped by plan), extended
to the other three tabs that had drifted into a different, more cluttered pattern instead.

- **Budget vs. Actual** now shows `BudgetingToolPage` instead of `BudgetPage` for a premium,
  full-access client; **Cash Flow** shows `APCommandCenterPage` instead of
  `ReceivablesPayablesPage`; **Reports** shows `ReportBuilderPage` instead of `ReportsPage`. Same
  gating as Dashboard's existing `showsLiveReport`: `hasPremiumPlan(client) && !access.isCategoryScoped`
  — a category-scoped premium user (e.g. Luis, Youth Ministry) still gets the plain version of all
  three, same as they already did for Dashboard, since none of the upgraded pages have a
  "their slice" to narrow down to.
- **`report-builder`/`budgeting-tool`/`ap-command-center` are no longer separate nav items or
  reachable page keys** — removed from `NAV_SECTIONS`, and their `effectivePage === "..."` render
  branches removed from `App`. Their `PAGE_META` entries are kept, though: `App`'s `meta` fallback
  chain now picks them for the header title/subtitle whenever the *upgraded* state of `budget`/
  `receivables`/`reports` is showing, same idea as `showsLiveReport` already borrowing
  `PAGE_META["daily-close"]`.
- New `PREMIUM_UPGRADE_TAB_KEYS` (`dashboard`/`budget`/`receivables`/`reports`) drives a small
  `.nav-pro-pill` badge in `Sidebar` — reused styling from the existing `.nav-signature-badge`
  ("Premium" pill next to the Enterprise heading), just at item level instead of section level.
  Replaces the old one-off "Dashboard" → "Dashboard Live" label swap with the same pill treatment
  every one of the four now gets, rather than a special case for just one of them.
- `PREMIUM_TAB_KEYS` (no nav item carries `premium: true` anymore) is now always empty — kept
  rather than deleted, since `resolveAccess` still reads it and an empty set is exactly the
  correct behavior (nothing left to strip from a standard client's `access.tabs`).
- Bookkeeper Home's "Needs attention" row used to jump every overdue bill to `"ap-command-center"`
  regardless of the client's plan — already latently broken for a standard-plan client (that page
  key was never in their `access.tabs`, so it silently fell back to Dashboard). Now points at
  `"receivables"`, the single merged tab, which is correct for every plan.
- **Known small gap, accepted rather than fixed in this pass**: global search's Budget vs. Actual
  category-row results jump to a DOM id that only exists in the plain `BudgetPage`. For a premium
  client (who now sees `BudgetingToolPage` there instead), that search result still opens the
  right tab but won't scroll to/flash the specific row — `useCardFlash`'s `jumpToCard` guards on
  `if (el)` so this fails silently rather than breaking anything, but it's a real, if minor,
  regression worth revisiting if it comes up.
- **Rollback**: this is one PR/commit (see this section's version bump) on top of the previous,
  unrelated changes — `git revert` it to restore the previous 11-row sidebar and separately-named
  pages exactly as they were, no flag or dual code path kept around for it. This app doesn't use
  feature flags for one-off product decisions like this one (`FEATURE_FLAGS`, further up this
  file, is explicitly scoped to per-browser dev/QA toggles only) — a straightforward git revert was
  judged simpler and cleaner than carrying a permanent "old sidebar" branch in the code on the
  chance it's needed.

`MGB_VERSION` bumped to `2026-09-17h`.

## §54 — Fixed a §53 regression, then built the in-page toggles discussed alongside it

**Regression first.** §53 made "Reports" show `ReportBuilderPage` outright for a premium client,
same full-replace pattern as the other three. That page never had the simple "just give me a PDF"
download grid `ReportsPage` has (Profit & Loss / Balance Sheet / Budget vs. Actual / Contribution
Statement) — it's a from-scratch custom-report builder with its own two-stage flow. So premium
clients lost the quick-download buttons entirely; a real functionality loss, not just a naming
change, caught right after §53 shipped. Fixed by factoring the download grid out into a shared
`QuickDownloadReports` component (used by both `ReportsPage` and, now, `ReportBuilderPage`) so
Report Builder is a strict superset of what Reports could already do rather than a swap — the same
bar the other three full-replace pairs already clear (Live Report, Budgeting Tool, and Cash Flow
Pro all keep or exceed their standard page's functionality; only "Reports" had briefly failed
that).

**Then, the toggles.** Five spots discussed as good candidates for an in-page segmented control
(same-data, flip-between-views situations, as opposed to Cash Flow's would-be toggle, which
would've hidden real functionality — see §53's discussion). New shared `.view-toggle`/
`.view-toggle-btn` CSS, used by all of these:

- **Reports** (`QuickDownloadReports`, so this lands on both `ReportsPage` and the "Quick
  Download" side of Report Builder) — a Month/Quarter/Year-to-Date period toggle. Scoped
  honestly: only the Profit & Loss Statement has a real trailing-month range to aggregate over
  (`client.monthly`); Balance Sheet is always a point-in-time snapshot, and Budget vs. Actual/the
  Contribution Statement only ever carry one period's data in this mock dataset, so the toggle
  says plainly that it applies to P&L only rather than pretending to affect all four.
  `buildProfitAndLossPdf` now takes a `periodKey` and aggregates `client.monthly` accordingly.
- **Report Builder** — a new "Custom Report" / "Quick Download" toggle at the top of the builder
  stage, the direct fix for the regression above: `QuickDownloadReports` on one side, the existing
  builder panel on the other.
- **Bank Accounts** — "This Account" (existing account-tabs-driven view, unchanged) vs. "All
  Accounts" (every account's transactions combined, most recent first, with its own Account
  column) on the Recent Transactions table. Export CSV respects whichever is active. A
  search-result jump (which always targets one specific account's transaction) forces the view
  back to "This Account" first, same as it already forces the account tab itself.
- **Giving & Funds** — Fund Balances and Recent Contributions used to both sit on the page at
  once, with the KPI cards above just scrolling down to one or the other. Now a real toggle shows
  one section at a time; the KPI cards switch the toggle instead of scrolling.
- **Budget vs. Actual** — "By Category" (the existing budgeted-vs-actual table, unchanged) vs.
  "Spending Trend" (the real multi-month income/expense chart also used on the Dashboard,
  `IncomeExpenseChart`). This is NOT the "this period vs. prior period" toggle floated in
  discussion — `client.budget` only ever carries one period's category-level actuals in this mock
  data model, with no prior-period figures to compare against, and fabricating them would mean
  inventing numbers rather than showing something real. Swapped for a toggle the data actually
  supports instead.
- **Documents** — "All Documents" vs. "Full Access Only", filtering by the existing `visibility`
  flag (not a "shared with me" personalization — this app's documents only ever carry that one
  binary flag, so that's the honest thing to filter by). Only shown when at least one restricted
  document exists to filter to, which a category-scoped client viewer never has (already filtered
  out of their document list upstream) — so it naturally stays hidden for them.
- Two small correctness fixes alongside the Bank/Budget toggles: a KPI-card click or a
  search-result jump into a table that's only mounted in one of the two toggle states now switches
  the toggle first and defers the actual `jumpToCard` (a second effect keyed on the toggle state,
  or — for the one synchronous click-handler case on Budget's KPI cards — a same-tick
  `setTimeout`) rather than looking for a DOM node that doesn't exist yet in that render.

`MGB_VERSION` bumped to `2026-09-17i`.

## §55 — Another §53-style regression, caught from a mockup: Budgeting Tool was missing the Spending Trend chart

Same class of bug as §54's Report Builder fix, caught this time by reviewing a standard-vs-premium
feature comparison mockup rather than live testing: §54 added a "Spending Trend" toggle (the
multi-month income/expense chart, `IncomeExpenseChart`) to the standard `BudgetPage`, but never
carried it over to `BudgetingToolPage` — so a premium client lost that view entirely, the same
"full-replace has to be a superset" bar §54's own writeup states.

Not implemented as a toggle here, deliberately: `BudgetingToolPage`'s draft-editing table is the
whole reason the page exists, so hiding it behind a toggle (the way Budget vs. Actual's category
table can be swapped out) would be a worse fit. Instead, the trend chart is appended below the
draft table as a plain reference card — reachable, but not competing with the draft workflow for
the same screen space.

`MGB_VERSION` bumped to `2026-09-17j`.

## §56 — Report Builder: swapped Quick Download and Custom Report

Small follow-up: swapped the order of the two toggle buttons on Report Builder's landing view
(`ReportBuilderPage`) — "Quick Download" now comes first — and changed `builderTab`'s default
state to match, so a premium client now lands on the simple per-report PDF grid first, with the
custom report builder one click away, instead of the other way around.

`MGB_VERSION` bumped to `2026-09-17k`.

## §57 — Dashboard pared back to essentials; Cash by Account / Top Expense Categories are Live Report only

Request: make the standard Dashboard vs. premium Live Report split feel more distinct, with the
standard tab holding only "need to know" basics and the premium version clearly worth the
upgrade. §51 had added two new widgets — Cash by Account (donut) and Top Expense Categories — to
`DashboardPage` before they were ported to Live Report in §52, so for a while both plans had
identical feature sets on their respective home tabs. That undercut the premium pitch.

Removed both widgets' catalog entries and render cases from `DashboardPage` (`app.jsx`), along
with the now-unused `topExpenseCategories` derivation. Standard Dashboard is back to: KPI row,
Income vs. Expenses chart, Recent Activity, the cross-tab pulls, plus drag-to-reorder/show-hide
and saved views (kept — customization itself isn't being treated as a premium-only capability,
just these two specific content widgets). Live Report keeps both widgets and its own saved-views
system untouched; no changes there. `AccountCashDonut` and `ReportBarRows`, the two components
those widgets used, stay in the file — both are still used elsewhere (cross-tab widgets and
Reports/Report Builder), so nothing to delete.

Existing localStorage layouts that reference the removed widget IDs degrade safely — the layout
hook already filters `visibleOrder` against the current `allIds` list, so a stale saved order
simply drops IDs that no longer exist rather than erroring.

`MGB_VERSION` bumped to `2026-09-17l`.

## §58 — Two new premium upgrades built: Reconciliation Pro (Bank Accounts) and Fund Accounting Pro (Giving & Funds)

Request: build out the two candidate premium tiers sketched in an earlier mockup ("Reconciliation
Pro" over Bank Accounts, "Fund Accounting Pro" over Giving & Funds), keeping the same tab-naming
pattern as the other four premium upgrades (§53) — one nav item, same label, content swapped by
plan, PRO pill marks the upgraded state. `PREMIUM_UPGRADE_TAB_KEYS` now includes `"bank"` and
`"giving"`, so the sidebar's generic `isUpgraded` check picked both up with no Sidebar code
changes needed.

**Bank Accounts → Reconciliation Pro** (`BankReconciliationPage`). Standard's whole transaction
view was factored out into a shared `BankTransactionsPanel`, so `BankPage` (standard) and
`BankReconciliationPage` (premium) both render it — no duplicated JSX, and it stays a strict
superset per the §54 bar. Premium adds a Transactions/Reconciliation in-page toggle (same pattern
as §54's toggles); Reconciliation shows, per account: Statement Balance, Outstanding Items, and a
Difference KPI; a read-only Cleared/Outstanding status table (see below on why it's read-only);
and a Reconciliation History table of prior closed periods. Download Reconciliation Report
generates a real PDF via the existing jsPDF pipeline.

**Cleared status is read-only, deliberately** — the earlier mockup's "Cleared / Uncleared toggle"
idea would need a bookkeeper action and a persistence layer neither of which exist yet (this app
has no backend write path for reconciliation state), so building an interactive checkbox that
silently didn't save anywhere would be actively misleading. The page shows the current state (set
in mock data) instead of pretending to let you change it — same reasoning as §54's "no fabricated
prior-period budget data."

**Giving & Funds → Fund Accounting Pro** (`FundAccountingProPage`). Standard's Fund Balances and
Contributions views were factored into shared `FundBalancesCard`/`ContributionsCard` components,
reused by both pages. Premium adds two more toggle views: Fund Activity (a transfer ledger between
funds, with a reason per move) and Pledges (committed vs. received per donor, with a Fulfilled /
Overdue / In progress status pill using the same `daysUntil`/`todayLocal` helpers Cash Flow Pro's
aging already uses) plus a "Giving Statement" per-pledge download (a new `buildGivingStatementPdf`,
one donor's YTD gifts across every fund).

**Fund Balance Trend chart — scoped out, not built.** The original mockup flagged this as "the
cheapest piece to build first," which turned out to be wrong on closer look: unlike Budget's
Spending Trend (which reads real multi-month `client.monthly` data that already exists), a fund
balance trend needs each fund's balance sampled monthly — this mock dataset only carries a current
snapshot balance plus this period's contributions and transfers. Building it would mean fabricating
six months of per-fund numbers, the same thing §54 already declined to do for Budget vs. Actual's
period comparison. Left out rather than inventing data.

**New mock data** (`data.js`, `grace-community` and `riverside-pantry` only — the two premium
clients, since these pages only render for them): each bank transaction gained a `cleared` flag;
each account gained `statementBalance`/`statementDate`; each client gained `bankReconciliations`
(closed-period history), `fundTransfers`, and `pledges`. The cleared/outstanding split is
constructed so the invariant `balance === statementBalance + sum(uncleared amounts)` holds exactly
— the Difference KPI reads $0.00 for every account, including one (Riverside's Reserve Savings)
deliberately left with nothing outstanding to show what "fully reconciled" looks like. Standard
clients (`new-hope`, `open-arms`) weren't touched — `ReconciliationPanel` defaults missing
`cleared`/`statementBalance` to "fully cleared" rather than requiring the fields, so nothing new
was needed there, and neither page renders for a standard plan.

`ENTERPRISE_FEATURES` (Enterprise upgrade preview page) and its "Six tools" summary line were
updated to include both new tiers.

`MGB_VERSION` bumped to `2026-09-17m`.

## §59 — Enterprise upgrade page: interactive pricing + tool-by-tool comparison, with scroll reveal

Request: make the page a standard client lands on when they click the premium upsell an actual
interactive comparison (not just a static feature list) they can explore to decide whether to
upgrade, plus a mock price comparison (real numbers to follow later). A follow-up asked for real
motion on the page — scroll-triggered reveals in the vein of Apple's marketing pages, not just a
static layout.

**Pricing cards.** Two cards at the top of `EnterpriseUpgradePage`: Standard (current plan) and
Enterprise (the add-on), each with a price. `ENTERPRISE_PRICING` is a new constant holding both —
explicitly commented as placeholder figures, one place to swap in real numbers later. The premium
card gets a slow breathing gold glow (a new `pricingCardGlow` keyframe, same technique as the
sidebar's existing `.theme-toggle-signature` glow) so it reads as the highlighted option without
an animated border competing with the price for attention.

**Tool-by-tool comparison accordion.** A new `ENTERPRISE_COMPARISON` array — one entry per tab with
a premium upgrade (all six from §58), each with a Standard feature list and a Premium feature list,
grounded in what the real pages actually render (same rule as the earlier comparison mockup, not
marketing copy). Renders as a click-to-expand accordion: closed by default so the page loads short,
each row opens independently. This is the actual interactive exploration the request asked for —
better than the old static six-card grid alone, which is kept above it as a still-useful "at a
glance" summary.

**Scroll reveal.** Rather than building a second observer, this reuses the *existing* global
IntersectionObserver in `App` (the one that already drives chart entrance animations app-wide via
`data-in-view` — see the "Chart/graph entrance animations" comment above it) — extended to also
watch `.compare-row` elements (accordion rows aren't `.card`s, so they weren't covered). New CSS,
scoped entirely under a `.enterprise-page` wrapper class so nothing about how `.card` behaves
changes anywhere else in the app: every card and accordion row starts faded/offset and animates up
into place individually as it crosses into view, with the accordion rows cascading in quick
succession (a short per-row `animation-delay` staircase) so scrolling down reads as one continuous
reveal rather than six separate pops. The accordion's open/close itself animates too, via a
`grid-template-rows: 0fr → 1fr` transition on the row body — the one CSS-only way to animate height
to/from "auto" without a guessed max-height that either clips content or leaves a stutter.

**Caught along the way**: three uses of `var(--text-faint)`/`var(--border-strong)`/
`var(--text-primary)` — CSS custom properties that don't exist in this app's actual token set
(`--text-muted`, `--gold-deep`, `--text` are the real ones) — snuck into §58's Fund Accounting Pro
code and this session's own first draft, evidently carried over by habit from the dark-navy/gold
Artifact mockups this session also produces, which use a different, unrelated token set. Fixed all
of them to the real tokens.

`MGB_VERSION` bumped to `2026-09-17n`.

## §60 — Enterprise pricing switched to per user profile per month

Small follow-up to §59: `ENTERPRISE_PRICING` now holds a `perUser` rate for each plan instead of a
flat `price`, and each pricing card shows both the per-user rate ("$19/user/mo") and the computed
total for this client ("$19/mo total for 1 user profile" / "$114/mo total for 6 user profiles"),
using `client.users.length` — every login configured for the organization, not just full-access
ones, since that's what actually drives seat count. Still placeholder figures pending real pricing.

`MGB_VERSION` bumped to `2026-09-17o`.

## §61 — Card hover: dropped the lift app-wide, kept the icon enlarge

Request: the Enterprise pricing cards' hover treatment (shadow pops, the icon inside enlarges
slightly, but the card itself doesn't lift) was liked enough to want everywhere, not just there.

`.card:hover` (`styles.css`) previously did both `box-shadow: var(--shadow-hover)` and
`transform: translateY(-4px) scale(1.015)` — the lift/scale is gone now, shadow-only, which
applies to every `.card` in the app immediately since it's the one shared rule (no page has its
own competing `.kpi-card:hover`/`.report-card:hover`/etc. override — checked). The
`prefers-reduced-motion: reduce` override that turned the lift off is gone too, since there's no
transform left to turn off.

The icon-enlarge-on-hover (`.card:hover .icon-badge { transform: translateY(-3px) scale(1.06); }`)
was previously scoped to `.enterprise-page` only (§59) — generalized to plain `.card:hover
.icon-badge`, still gated under `prefers-reduced-motion: no-preference`. `.icon-badge` is
currently only used on the Enterprise upgrade page's six feature cards, so this has no visible
effect anywhere else yet — it'll just apply automatically if `.icon-badge` gets reused on another
page later, same as the rest of the app's shared `.card` styling already does.

`MGB_VERSION` bumped to `2026-09-17p`.

## §62 — Card text enlarges on hover too; masonry's lone trailing card centers itself

Two follow-ups to §61.

**Text enlarge.** Same treatment as the icon-badge enlarge: `.card-title`, `.kpi-value`, and
`.pricing-value` now scale up slightly (`scale(1.05)`, `transform-origin: left center`) on
`.card:hover`, app-wide. Scale only, no `translateY` — growing a line of text upward off its own
baseline reads as broken in a way a small isolated icon shape can get away with, so this
deliberately doesn't reuse the icon's exact motion. `.kpi-value` needed `display: inline-block`
added (it's a `<span>`, and `transform` has no effect on a plain inline box in any browser); the
other two are already block-level and didn't need it.

**Masonry orphan centering.** Asked: on `.content-masonry` pages (Dashboard, Home, Receivables &
Payables, AP Command Center, Staff Access), when a trailing card ends up alone at the bottom with
nothing beside it, center it across the full width instead of leaving it pinned to whichever
column the browser's height-balancer put it in. This needed actual measurement, not CSS alone —
CSS multi-column layout has no selector for "the last card the balancer left by itself"; which
column each card lands in is an internal browser decision based on height-balancing, not something
expressible as `:last-child` or similar. A new effect in `App` (paired with the same
scroll-reveal-observer section) checks, after layout settles (`ResizeObserver` + a `resize`
listener + the same document-wide `MutationObserver` pattern the reveal observer already uses),
whether the last card in each `.content-masonry` vertically overlaps any sibling; if nothing does,
it's alone, and gets a `.cm-solo` class. That class applies `column-span: all` (pulls the card out
of the column flow into its own full-width band) plus a capped `max-width` and `margin: auto` —
the combination is what actually produces "gaps on either side," not just the card stretching to
fill the full width edge-to-edge.

`MGB_VERSION` bumped to `2026-09-17q`.

## §63 — Premium-exclusive sections get a gold shimmer; Messages moved above Dashboard

Two requests. First: the premium side of the app should visually stand out — "shimmery gold in
titles and in certain aspects that make sense" — so a client can tell at a glance which parts of a
page are the premium add-on rather than reading feature-by-feature. Second: move Messages to just
above Dashboard in the sidebar, for both plans.

**Messages above Dashboard.** One-line change: swapped the two items' order in the Enterprise
section of `NAV_SECTIONS` (`app.jsx`). `NAV_SECTIONS` is the same array for every client regardless
of plan, so this applies to standard and premium alike with nothing plan-specific to change.

**Gold shimmer.** New reusable `.premium-shimmer` class in `styles.css`, extracted from the gold
gradient-text-clip treatment the sidebar's `.nav-item-signature`/`.nav-section-label-signature`
already used (same `navSignatureShine` keyframe, so this isn't a second animation to keep in sync —
just the existing one applied to more text). Deliberately NOT applied everywhere — sprinkling it
across every heading in a premium page would just make the whole page look gold instead of marking
what's actually new, so it's scoped to text that's genuinely premium-exclusive:

- The page subtitle (right under the greeting) shimmers whenever the current page is one of the
  six upgraded pages (`isPremiumPage`, a new `App` variable OR-ing together all six `showsX`
  flags) — one glance tells you which plan's version you're looking at, without needing to notice
  the sidebar's PRO pill or scroll into the page itself.
- Section titles that exist ONLY on the premium side of a pair, not the shared baseline a standard
  client already has: Reconciliation Pro's "{account} — Cleared Status" and "Reconciliation
  History"; Fund Accounting Pro's "Fund Activity" and "Pledges"; Cash Flow Pro's "Open Bills," "Pay
  Run," "Vendor Summary," "Aging Summary" (the whole page is bonus content, so all four got it);
  Budgeting Tool's "Draft Budget by Category" (its "Spending Trend" card was deliberately left
  plain — that chart is shared with standard Budget vs. Actual per §54/§55, not a Budgeting Tool
  exclusive); Report Builder's "Build a report" entry card (not the generated report's own section
  headers inside it — those are meant to read as a formatted board document, and shimmer text
  doesn't belong inside something built to be presented/exported).
- Live Report's Collections Queue panel title, in `DailyClose.css`/`.tsx` — the one Live Report
  panel with no standard-Dashboard equivalent at all. A new `.dc-premiumShimmer` class there reuses
  the shell's `navSignatureShine` keyframe directly (CSS keyframes are global regardless of which
  stylesheet defines them, so nothing needed duplicating) rather than reinventing the gradient in
  DailyClose's own token language. The rest of Live Report — KPI row, Revenue vs. Expenses, Where
  the Money Went, Outlook — was left alone; going further into DailyClose's self-contained component
  tree for every possible premium-only touch felt like more surface area than "certain aspects that
  make sense" asked for, and the page subtitle shimmer already marks the page as a whole.

`MGB_VERSION` bumped to `2026-09-17r`.

## §64 — Live Report: five new widgets, each click-through to its deep-dive tab

Request: make the premium Dashboard (Live Report) more robust, with widgets that surface insight
from the other tabs and let a bookkeeper jump straight into the deep dive from the dashboard.
Brainstormed five (Reconciliation Status, Fund Activity, Bills Due Soon, Budget Health, Your
Bookkeeper), all approved and built — none redundant with an existing widget, and each grounded in
data that already exists rather than invented.

**Data contract** (`components/daily-close/types.ts`): five new optional `DailyCloseData` fields —
`budgetHealth`, `payablesDueSoon`, `fundActivity`, `reconciliation`, `bookkeeper` — each documented
as omit-to-hide, same convention `cash.byAccount` already established. `fromClient.js` computes all
five from real client fields (`client.budget`, `client.payables`, `client.contributions` +
`client.fundTransfers` + `client.pledges`, `client.bankAccounts[].cleared/statementBalance` +
`client.bankReconciliations`, and a new `client.assignedBookkeeper`). `sampleData.ts` (the
standalone demo dataset) got matching sample values for everything except `fundActivity` — a
for-profit coffee roaster has no funds to report on, so that one's correctly omitted rather than
filled with placeholder data.

**New client data** (`data.js`, all four clients): `assignedBookkeeper: { name, role, initials }` —
a named contact per client, which didn't exist anywhere before (every in-app message thread just
attributed to generic "MyGoodBooks"). Two bookkeepers across the firm (Alicia Fenwick and Priya
Anand on the two premium/larger clients, Marcus Webb on both standard clients) — a believable small
firm's caseload spread, not one name repeated four times.

**The five widgets** (`DailyClose.tsx`/`.css`), each a `.panel` in Live Report's existing
customizable widget system (just five more entries in `LIVE_REPORT_WIDGETS` — the layout hook
already merges new IDs into existing saved orders, so no versioning bump needed) with a
"View in [Tab]" link at the bottom, wired to the same `onNavigate` prop that already exists:

- **Reconciliation Status** — per-account count/total of items still awaiting clearance, plus when
  each account last closed. Deliberately factual, not framed as a health/warning signal: mid-period
  outstanding items are normal, not a problem, so this never says "reconciled" or "needs attention."
  → Bank Accounts (Reconciliation Pro).
- **Fund Activity** — a merged, dated feed of contributions and fund transfers, plus a running
  pledges-outstanding total. Pledges are never mixed into the chronological feed itself since
  `data.js` has no per-payment date for them, only running committed/received totals — same
  discipline as §54's "don't fabricate data a page doesn't have." → Giving & Funds (Fund Accounting
  Pro).
- **Bills Due Soon** — the top 5 payables, soonest due first, correctly distinguishing "due in N
  days" from "N days overdue" (a bug in the first draft showed "due today" for anything already
  overdue). → Cash Flow (Cash Flow Pro).
- **Budget Health** — categories running over budget this period, worst first, with a small bar
  showing actual against the 100%-of-budgeted mark. → Budget vs. Actual (Budgeting Tool).
- **Your Bookkeeper** — a small contact card (initials avatar, name, role) with a "Message
  [first name]" link straight into that thread.

**Bug caught and fixed along the way**: the existing Accounts Payable KPI tile's `onClick={() =>
onNavigate("ap-command-center")}` was dead — `"ap-command-center"` stopped being a real navigable
page key back in §53 (it survives only as a `PAGE_META` lookup key for the header title), so
clicking that tile silently fell back to Dashboard instead of opening Cash Flow Pro, for as long as
this session's premium-tab collapse has existed. Fixed to `onNavigate("receivables")` — the same
class of stale-page-key bug already found and fixed once before in Bookkeeper Home's "Needs
attention" row.

`MGB_VERSION` bumped to `2026-09-17s`.

## §65 — Fund Accounting Pro: Tax Documents; Live Report's own card-lift bug fixed

Two items.

**Tax Documents.** Request: let a client send year-end giving statements so contributors can write
off their donations. New "Tax Documents" view on `FundAccountingProPage` — a fifth toggle button
alongside Fund Balances/Contributions/Fund Activity/Pledges. Shows one row per named donor (never
"Anonymous" — there's no one to send a receipt to, and a YTD total shouldn't be attributable to a
single anonymous contact), each with their YTD total, gift count, and email on file, plus per-row
Download (real, via the existing `buildGivingStatementPdf`) and Send buttons, and a page-level
"Send All" that sends to every donor who has an email.

**Send is a simulated toast, not a real email**, and says so on the page — same honest-mock
posture as the referral popup's own "this doesn't send a real email yet" disclaimer. This isn't a
shortcut: a `mailto:` link (the pattern Collections Queue's reminder draft already uses elsewhere)
categorically can't attach a file, and the entire point of this feature is attaching a generated
PDF, so pretending otherwise would be actively misleading rather than an honest placeholder.

New `client.donors` lookup in `data.js` for the two premium clients (name → email), a genuinely new
piece of mock data — contributions previously had no donor contact info at all, only a name.
Standard clients don't need it since this page never renders for them.

**Live Report card-lift bug.** Separately reported: cards on the premium Dashboard (Live Report)
were still lifting on hover, unlike the rest of the app after §61 removed that everywhere. Root
cause: `DailyClose.css`'s `.dc-panel`/`.dc-kpiTile:hover` was its own independent copy of the exact
rule `.card:hover` used to have (`transform: translateY(-4px) scale(1.015)`) — this file is
deliberately self-contained (see its own header comment on why) and was never touched when §61
fixed the shell's copy. Fixed the same way: shadow-only, no transform, dead
`prefers-reduced-motion: reduce` override removed since there's nothing left to disable.

`MGB_VERSION` bumped to `2026-09-17t`.

## §66 — Live Report's five new widgets get tab-matching icons

Follow-up to §64: each of the five new Enterprise-only widgets now carries the same icon as the
sidebar tab it deep-links to — Reconciliation Status gets `BankIcon`, Bills Due Soon gets
`SwapIcon` (Cash Flow's icon), Budget Health gets `PieChartIcon`, Fund Activity gets
`GiftHeartIcon`, and Your Bookkeeper gets `ChatIcon` (Messages) inline next to the name, since that
card already leads with its own avatar circle for "who." The paths are copied from app.jsx's icon
components rather than imported — this file stays self-contained (see its own header comment) —
with a note to keep them in sync by hand if app.jsx's icons ever change. A small `.dc-panelIcon`
badge (gold-tinted, 22px) sits to the left of each panel's title in a new `.dc-panelTitleRow`
wrapper.

`MGB_VERSION` bumped to `2026-09-17u`.

## §67 — Grace Community Church: 3 more bank accounts, for a total of 5

Request: give one sample client several bank accounts to see how the app looks with more than
two. Added Payroll Account (Checking, $6,200), Petty Cash Checking (Checking, $850), and Money
Market Reserve (Money Market, $25,000) to Grace Community Church's existing General Operating and
Building Fund Savings.

Every invariant this data keeps got recomputed, not just appended to:

- **Reconciliation math** (§58's `balance == statementBalance + sum(uncleared amounts)`) holds for
  all 5 accounts individually — Payroll and Reserve are fully cleared (nothing outstanding), Petty
  Cash has one uncleared item, matching the same mix of states the original two accounts already
  demonstrated.
- **Fund balance invariant** (the comment above `funds:` — total bank balances minus payables must
  equal the sum of every fund): 5 accounts now total $242,770.55 cash, so General Fund (the
  unrestricted, balancing entry) moved from $35,850.55 to $67,900.55. The four restricted funds are
  untouched — the new cash is general operating reserve, not earmarked to Building/Missions/Kids
  Ministry/Benevolence.
- **`bankReconciliations` history** got matching closed-period entries for all 3 new accounts, so
  Reconciliation Pro's history table isn't empty for them.

Also bumped both donut-chart palettes (`ACCOUNT_DONUT_COLORS` in app.jsx,
`DONUT_COLORS` in DailyClose.tsx) from 4 colors to 5 — at 4, a 5th account's slice would have
silently repeated the 1st account's color instead of getting one of its own.

`MGB_VERSION` bumped to `2026-09-17v`.

## §68 — Reconciliation Pro gets a chart; Budgeting Tool's missing card gap fixed

**Outstanding by Account.** Request: another visual in premium Bank Accounts. `ReconciliationPanel`
only ever showed one account's detail at a time (via the account tabs), so there was no way to
compare accounts against each other at a glance. New "Outstanding by Account" card reuses
`ReportBarRows` (already used for Top Expense Categories and Fund Balances — no new chart component
needed) to show not-yet-cleared dollars per account, across all of them at once. Sits between the
KPI row and the per-account Cleared Status table.

**Budgeting Tool card spacing.** Asked to check card spacing on Budget vs. Actual — found it on the
premium side (`BudgetingToolPage`): the Draft Budget card had no `marginBottom`, so it butted
directly against the Spending Trend card below it with no gap. Same class of bug as the spacing
fixes noted earlier in this file (this app spaces stacked `.card` blocks with an inline
`style={{ marginBottom: 20 }}` per block, not a shared CSS rule, so a page can miss one). Standard
`BudgetPage` doesn't have this issue — its two views are mutually exclusive via a toggle, never both
mounted at once.

`MGB_VERSION` bumped to `2026-09-17w`.

## §69 — Every client's `monthly` extended from 6 to 12 trailing months

Reported: Report Builder's Reporting Period dropdown only offered 6 months (March–August) and a
mostly-empty Q1/Q4, because `client.monthly` — the one source every period option derives from
(`reportPeriodOptions`) — only carried 6 months for all four clients.

Extended every client to a full trailing 12 months, Sep (prior year) through Aug (current) rather
than a Jan–Dec calendar year — prepending 6 new months (Sep–Feb) before the existing Mar–Aug data,
which is untouched. This is safe against the one real risk with month-name-only matching
(`REPORT_QUARTER_DEFS` matches by name, not by year): 12 *consecutive* months can never repeat a
month name, so there's no chance of two different years' Julys silently summing together into one
"quarter." All four quarters and every month option are now fully populated in the dropdown, where
before only Q2/Q3 (and a partial Q1) had anything in them.

Wrote real, distinct figures for each client rather than repeating a pattern — Riverside Food
Pantry's new December spike deliberately lines up with the Holiday Meal Drive Fund already in its
`funds`/`contributions` data, so the two aren't telling contradictory stories.

Also fixed three stale hardcoded "6-month"/"Last 6 months" labels that would have been wrong once
the underlying data grew: `DashboardPage`'s Income vs. Expenses card subtitle now reads
`client.monthly.length` dynamically (same pattern `BudgetPage`'s Spending Trend already used), and
two catalog description strings (`app.jsx`'s widget picker, `DailyClose.tsx`'s `LIVE_REPORT_WIDGETS`)
now say "12-month."

`MGB_VERSION` bumped to `2026-09-17x`.

## §70 — Spending Trend: budget line + surplus/deficit shading

Follow-up to "the spending trend graph is a little boring": sketched 5 chart-enhancement options as
static mockups (budget line overlay, surplus/deficit shading, diverging bars, cumulative running
total, anomaly markers), all drawn with Grace Community Church's real 12-month figures rather than
placeholder numbers — published as a Design canvas so they could be compared side by side before
committing to any. User picked #1 and #2, combined.

`IncomeExpenseChart` (`app.jsx`, shared by Dashboard's Income vs. Expenses widget, `BudgetPage`'s
and `BudgetingToolPage`'s Spending Trend) gained one new optional prop, `budgetTotal`. When passed:

- A dashed gold reference line at that value, labeled "Budgeted $X/mo" — `maxVal`'s scale now also
  accounts for `budgetTotal` so the line can't get clipped off the top of the chart on a month
  where actuals happen to run under budget.
- The gap between the income and expense lines fills green where income is ahead that month, red
  where expenses are — computed per month-to-month segment (straight lines between points, not the
  smoothed curve the strokes themselves use) so the fill always matches exactly where the two lines
  actually cross, rather than a curved approximation over- or under-shooting the real crossing point.

Only `BudgetPage` and `BudgetingToolPage` pass `budgetTotal` (their existing `totals.budgeted` /
`totalCurrent` sums) — Dashboard's call site is untouched and renders exactly as before. This was
deliberate, not an oversight: the whole reason #1 and #2 beat the other three options is that they
tie the chart specifically to a *Budget* page; adding a budget-comparison line to Dashboard's
generic Income vs. Expenses widget, which isn't framed around any specific budget, would just be
noise there.

`MGB_VERSION` bumped to `2026-09-17y`.

## §71 — Live Report PDF: match everything the page now shows

The downloadable Live Report PDF (`DailyClose.tsx`'s `downloadPdf`) was still frozen at its original
3 tables — key metrics, receivables aging, flagged anomalies — from before this session added the
Budget Health, Bills Due Soon, Fund Activity, Reconciliation Status and Your Bookkeeper widgets to
the page itself. Downloading it no longer matched what you'd see on screen.

Brought the PDF up to parity with the live page, same "omit to hide" contract as the widgets
themselves (each section only renders if its `DailyCloseData` field is present/non-empty):

- Key metrics row now shows AP past-due status and net income margin vs. target, not just raw totals.
- New sections, in the same order as the page: Cash by Account, Expense Breakdown, Over Budget,
  Bills Due Soon, Fund Activity (with pledges-outstanding footer row), Reconciliation Status (with
  the last-closed-period note as small print, same factual framing as the panel — not styled as a
  warning).
- Footer on every page: "Prepared by {bookkeeper}, {role}" on the left, "Page X of Y" on the right —
  a printed/forwarded copy previously had no page count and no indication who to contact.

Money/date formatting reuses the file's existing local `fmtMoney`/`fmtDate` helpers; no new
dependencies. Verified with `prettier --parser babel-ts`.

`MGB_VERSION` bumped to `2026-09-17z`.

## §72 — Live Report: restored the text-enlarge hover

`DailyClose.css`'s `.dc-kpiTile:hover`/`.dc-panel:hover` had the shadow-only fix from the earlier
"cards lifting like the old UI" bug (§ in the previous window), but never got the paired
text-enlarge rule that `styles.css` added afterward app-wide (`.card:hover .icon-badge` /
`.card-title` / `.kpi-value` scaling up 1.05–1.06x on hover). The two files don't share a
stylesheet, so the shell's later addition never propagated here — Live Report's cards looked
inert next to every other card in the app.

Added the same rule, scoped to this file's own class names: `.dc-panelIcon` enlarges on
`.dc-panel:hover`, `.dc-kpiValue` on `.dc-kpiTile:hover`, `.dc-panelTitle` on `.dc-panel:hover`.
Same `prefers-reduced-motion` guard, same transform values, kept in sync by hand like the rest of
this file's shell-mirrored rules.

## §73 — Payroll add-on (Gusto)

New tab, "Payroll" — under Finances, between Bank Accounts and Reports. Unlike every other upgrade
this session (Reconciliation/Fund Accounting/Cash Flow/Report Builder/Budgeting Tool/Live Report),
this one is NOT a premium-plan upgrade: it's a separate paid add-on, independent of `client.plan`,
priced per-employee-per-run rather than per-user-per-month. Mocked first (Design canvas, 3
artboards) before building, per the user's steer: connects to Gusto (read-only — this page never
triggers a real pay run), priced as a percentage of processed payroll rather than a flat monthly fee,
and YTD figures live on their own Reports entry rather than crowding the roster table.

- `client.payrollAddOn` / `client.payroll` gate the page — `PayrollPage` renders `PayrollUpsell`
  (a "Connect Gusto" card, same house pattern as `EnterpriseUpgradePage`'s hero card) when absent,
  the real page when present. No `hasPremiumPlan` check anywhere in this feature — `payroll` isn't
  in `PREMIUM_UPGRADE_TAB_KEYS`, and `open-arms` (Standard plan) has the add-on while
  `riverside-pantry` (Premium) doesn't, on purpose, to prove the two are orthogonal.
- Page shows: KPI row (active employees, next run total, last run net pay, YTD payroll cost), next
  pay run detail (gross/taxes/net), tax deposits (Federal 941, state withholding, FUTA — amount, due
  date, status), and an employee roster (name, role, pay type, direct deposit, status). Roster
  deliberately excludes rate and YTD figures — those are one click away on Reports instead of
  crowding this table, matching Fund Accounting Pro's own "detail lives in its own report" pattern.
- `buildPayrollYtdPdf` joins `REPORT_PDF_BUILDERS` as a fifth report type (`REPORT_TYPES` gained a
  `requires: "payroll"` field, filtered in `QuickDownloadReports` so a client without the add-on
  simply doesn't see the report card — same absence-as-the-gate approach as `payroll` itself).
  Works from both the standard Reports page and Report Builder's Quick Downloads tab, since both
  already share `QuickDownloadReports`.
- `payroll` added to `ORG_WIDE_TABS` — a category-scoped user (e.g. Grace Community's Kids Ministry
  director) never sees it, matching Bank Accounts/Cash Flow/Reports.

`MGB_VERSION` bumped to `2026-09-17aa`.

## §74 — Live Report "View in X" links matched to real tab names

Fixed: 4 links pointed to old page names (Budgeting Tool, Cash Flow Pro, Fund Accounting Pro,
Reconciliation Pro) instead of the sidebar's actual labels (Budget vs. Actual, Cash Flow,
Giving & Funds, Bank Accounts) — those pro names were retired when the pages replaced their
standard tab in-place. Text-only fix, `onNavigate` targets were already correct.

## §75 — One "Pro Client" pill instead of PRO on every tab

Replaced the per-tab gold "PRO" pill (6 tabs, one each) with a single shimmering "Pro Client" pill
next to the "Enterprise" sidebar heading — same shine as the Enterprise label text, applied to the
pill's background instead (`.nav-signature-badge-shimmer`). Tabs still shimmer their own label text
(`nav-item-signature`, untouched); `.nav-pro-pill` itself stays (still used on the Enterprise
upgrade page's pricing card/comparison rows), just dropped from the sidebar item row.

`MGB_VERSION` bumped to `2026-09-17ab`.

## §76 — Team Chat: fixed cross-talk + dead edit window, added groups

Two real bugs reported against the live app, plus the requested group-thread feature:

1. **"I message Gillian, Jeff gets it too."** Root cause: clicking a person with no existing
   conversation kicks off an async insert (`openWith`); `activeConversationId` didn't update until
   that resolved. If Send was hit before it did, the message posted against whatever conversation
   was still active from before — not a data bug, a client race. Fixed with a request-token
   (`openTokenRef`) that only lets the *latest* click's result ever set `activeConversationId`, and
   `selectConversation` now clears `activeConversationId`/`messages` immediately on click so a stale
   conversation is never sitting there to accidentally send into.
2. **"Editing a message doesn't change it."** The edit/unsend RLS window (`staff-chat-v2.sql`) was
   5 seconds — routinely expired before Save was even clicked. Widened to 15 minutes
   (`CHAT_EDIT_WINDOW_MS` in app.jsx, mirrored in the new `supabase/staff-chat-groups.sql` policy —
   **needs that migration run against the live DB**, editing the file alone doesn't apply it).
3. **Group threads.** `staff_conversations` gains `is_group`/`title`; `dm_key` uniqueness moves to a
   partial index (1:1 only) so it can be null for groups. "+ New Group" opens a checklist modal
   (`GroupComposeModal`) — pick 2+ people, optional name. Conversation list now aggregates *all*
   other members per thread instead of assuming exactly one (that assumption was also silently
   mislabeling anything that got more than one other member). "Seen" becomes "Seen by N/M" in a
   group.
4. Thread list gets a filter input and groups get a gold-bordered tab (`.thread-tab-group`) to
   scan apart from 1:1s at a glance — the "make it easy to navigate" ask.

**Action needed: run `supabase/staff-chat-groups.sql` in the Supabase SQL editor** — the group
columns and the 15-minute edit policy don't exist until it's applied.

`MGB_VERSION` bumped to `2026-09-17ac`.

## §77 — Attachment upload fix + unread threads more visible

Checked the live DB for the reported "sent Gillian a file, can't open it" — zero rows in
`staff_messages` have ever had an attachment, and the `staff-chat-attachments` bucket has zero
objects, ever. `send()` bails out before inserting the message row if the upload fails, so a failed
upload leaves nothing behind at all to retry, just a toast that's easy to miss. Root cause: the
storage key was built straight from the filename — Supabase Storage rejects characters a normal
filename has all the time (`#`, `%`, `&`, `?`, `+`, non-ASCII), and any such name failed outright.
Now sanitized to `[a-zA-Z0-9._-]` for the storage key only; `attachment_name` keeps the real name
for display.

Also: thread preview text and the unread dot already existed but were easy to miss in a full list —
unread threads now sort to the top, get a tinted background + outline, and the name/preview text
goes bold, not just a small dot in the corner.

`MGB_VERSION` bumped to `2026-09-17ad`.

## §78 — Team Chat: send() could hang forever with zero feedback

Live report: attaching a real PDF (one generated by this app's own Download PDF) and hitting Send
left the button stuck "sending" — attachment never clickable, nothing happened, no error shown.

Cause: `send()` had no try/catch. `upload()`/`insert()` normally resolve with `{ error }` rather
than throw, but that's not a guarantee — any rejected promise (network blip, CORS, timeout)
skipped past every `setSending(false)` call in the function, leaving Send permanently disabled and
the attachment stuck staged with no feedback at all. Wrapped the whole body in try/catch/finally so
`setSending(false)` always runs and a toast always shows, whatever the failure mode — a silent hang
is worse than any specific bug, since it gives nothing to diagnose from. Next real failure will
surface an actual error message to go on.

`MGB_VERSION` bumped to `2026-09-17ae`.

## §79 — Team Chat: online presence + typing indicator (Realtime)

Follow-up to the Google Chat question — the answer was "you already have Supabase Realtime, it's
just only using Postgres Changes." Added the other two pieces it offers, no new backend:

- **Presence**: every signed-in staff member joins a shared `staff-presence` channel keyed by their
  own email and calls `track()` on subscribe. `sync` events keep `onlineEmails` current — no polling,
  no heartbeat table. A small green dot shows next to a name in the thread list and the conversation
  header (group threads: dot shows if *any* other member is online).
- **Typing**: a per-conversation Broadcast channel (`conv-typing-<id>`), created only while that
  conversation is open — not the per-user inbox channel, which isn't shared between the two people in
  a DM. Draft keystrokes send a throttled (1.5s) `typing` event; the receiving side shows "X is
  typing…" for 3s, self-clearing rather than needing an explicit "stopped" event (survives a closed tab).

Both channels are cleaned up (`removeChannel`) on unmount/conversation switch, same as the existing
postgres_changes subscription.

`MGB_VERSION` bumped to `2026-09-17af`.

## §80 — Client-side chat header names the assigned bookkeeper

The client's Messages page header said "Conversation with MyGoodBooks" — a brand name, not a
person. Now falls back to `client.assignedBookkeeper.name` (e.g. "Conversation with Alicia
Fenwick"), same field the Enterprise "Your Bookkeeper" card and Live Report PDF footer already use.
Bookkeeper-side view (picking which client's thread to view) is unaffected.

`MGB_VERSION` bumped to `2026-09-17ag`.

## §81 — Orphaned solo masonry card no longer floats centered

A trailing card left alone at the bottom of `.content-masonry` (e.g. Scoped Dashboard's "Budget
Totals" widget) got `.cm-solo`: pulled full-width via `column-span: all`, then capped to 460px and
centered — which read as a small box orphaned in the middle of a wide row instead of a deliberate
footer. Now it just fills the full-width band edge-to-edge like the rest of the page's cards.

`MGB_VERSION` bumped to `2026-09-17ah`.

## §82 — Message bubble author still said MyGoodBooks

§80 fixed the thread header but missed the per-bubble author label — each bookkeeper message still
printed the literal `m.author` value ("MyGoodBooks") from the sample data. Client view now swaps in
`client.assignedBookkeeper.name` there too. Bookkeeper-side view is unaffected (still shows their
own name/whoever authored it).

`MGB_VERSION` bumped to `2026-09-17ai`.

## §83 — Message author still said MyGoodBooks in "Preview As" view

§82's swap only applied when `!isBookkeeper`, so staff using "Preview As" to see a client's page
still saw the literal sample-data "MyGoodBooks" author on bookkeeper messages. Dropped the
`isBookkeeper` condition — the swap to `client.assignedBookkeeper.name` now applies regardless of
who's viewing.

`MGB_VERSION` bumped to `2026-09-17aj`.

## §84 — Client Messages page: online dot + simulated typing indicator

Team Chat (staff-to-staff) already got a real Presence/Broadcast-backed online dot and typing
indicator (§79). The client-facing Messages page has no backend at all (MockBanner: "sending a
message here doesn't notify anyone yet") — the bookkeeper's reply is a hardcoded setTimeout — so
there's no real channel to broadcast on. Added the same *visual* treatment without fabricating a
fake Realtime connection: a green online dot next to the bookkeeper's name in the thread header
(mock — always on, matches the simulated-reply's implicit "always available" behavior), and a
"{bookkeeper} is typing…" line above the compose bar that shows for the same 900ms window the
simulated reply already waits on (`bookkeeperTyping` state lifted to the app shell, set true on
send and false when the reply lands).

## §85 — Report Builder: Cash Flow section now checked by default

`sections.receivables` (the "Cash Flow" checkbox — same key as the Cash Flow tab) defaulted to
`false` while every other core section (Revenue & Expenses, Budget vs. Actual, Cash Position,
Outlook) defaulted to `true`. Flipped it to match.

`MGB_VERSION` bumped to `2026-09-17ak`.

## §86 — Manage Access: throttle Premium features per person

Premium was purely client-level (`hasPremiumPlan(client)`) — every person at a Premium org got the
same Pro pages, with no way to hold one back (e.g. a board member who shouldn't see the Pro tools
the rest of the org has). Added a per-person override, controlled by MyGoodBooks from each client's
"Manage Access" modal:

- `resolveAccess` now returns `access.premiumForUser` (`hasPremiumPlan(client) && !user.premiumThrottled`)
  alongside the existing org-level `hasPremiumPlan(client)`. Every place that decided whether to show
  the upgraded/Pro version of a page for a *specific signed-in person* — the six
  showsLiveReport/showsBudgetingTool/.../showsFundAccountingPro flags, the sidebar's Enterprise-section
  upsell state, and the "PRO" nav-item styling — now reads `access.premiumForUser` instead of
  `hasPremiumPlan(client)` directly. Previewing as MyGoodBooks (no specific person) is unaffected —
  the org-level plan is still the only thing that matters there.
- People list (Manage Access → People) gets a "Premium" / "Premium throttled" pill per person,
  shown whenever the client is on Premium, so staff can see who's throttled without opening each one.
- Each person's editor gets a "Premium features on / throttled" toggle, shown only for Premium
  clients, wired through the same `userAccess` state (and `toggleUserPremium`) that already drives
  tab/category/fund overrides — no new persistence layer, same session-local pattern as the rest of
  Manage Access.

`MGB_VERSION` bumped to `2026-09-17al`.

## §87 — Spending by Category: bullet-bar chart

Picked from the 4 chart-option mockups (design canvas). The old bar just filled 0–100% of the
budget, so an over-budget row looked identical to one right at the limit — no way to see it by how
much. Now each row is a bullet bar: the fill is scaled to the real dollar amount (track spans
`max(budgeted, actual) * 1.08`, not a fixed 0–100%), and a gold `.bullet-target` tick marks exactly
where the budget line falls, so an over-budget row visibly runs past the tick.

`MGB_VERSION` bumped to `2026-09-17am`.

## §88 — Access Request Form: client-fillable form + staff review queue

A client's admin can now specify each of their staff's access themselves, without a MyGoodBooks
account of their own (Phase 2's real client login isn't built yet). New pieces:

- `supabase/access-requests.sql` — `access_request_links` (one row per shareable token, generated
  by staff) and `access_requests` (one row per submission, `people` a JSON array of
  `{name, email, role, access, tabs, categories}` — the same shape UserAccessEditor already edits).
  RLS: staff (via `is_active_staff()`) manage links and read/triage submissions; the public can read
  a link by token (to resolve which client it's for) and insert a request only against a token that
  names a currently-active link.
- `AccessRequestForm` (app.jsx) — a public, unauthenticated page reached at `?access-form=<token>`,
  intercepted in the `ReactDOM.createRoot` call at the bottom of the file *before* `AuthGate` even
  mounts (a client filling this out will never have a staff account). Styled to match the rest of
  the app (same cards, tab-toggle rows, access-level toggle as UserAccessEditor) rather than looking
  like a bare government form.
- Manage Access gets a third tab, **Requests**: "Generate a link" (creates a token, shows a
  copyable URL, "Regenerate" deactivates the old one and makes a new one), and a list of submitted
  requests per client with a "Reviewed" checkbox.

Deliberately does NOT auto-apply a submission into `userAccess` — a bookkeeper reads it and sets it
up by hand in the People tab. Access control here is still `client.users` mock data plus
session-local overrides, not a real per-user table to write into yet. **Once Phase 2 (real client
login) and Phase 3 (client_users driving real access) land, this is the natural intake point to wire
straight into that table instead of a bookkeeper re-typing it** — flagged here as a reminder for
when that work starts.

`MGB_VERSION` bumped to `2026-09-17an`.

## §89 — Budgeting Tool (Pro) gets the bullet-bar chart too

§87's bullet-bar chart only landed on standard Budget vs. Actual's "Spending by Category" — a
Premium client never sees that page at all (Budgeting Tool replaces it entirely), so they had no
equivalent. Added the same treatment to the Draft Budget by Category table's category column: bar
scaled to `max(current budget, actual)`, tick at the current budget line, fill colored by
over/under — against actual vs. the CURRENT budget, not the proposed number being drafted in that
row.

`MGB_VERSION` bumped to `2026-09-17ao`.

## §90 — Phase 2 scaffolding: real client login (magic link)

First real piece of the Phase 2 plan (client auth, decided: match on email against `client_users`,
same pattern as staff/`AuthGate`):

- `supabase/client-auth-phase2.sql` — adds `access`/`tabs`/`categories`/`funds`/`premium_throttled`
  to `client_users` (same shape UserAccessEditor and the Access Request Form already read/write),
  plus a policy letting a signed-in client read their own row.
- `components/auth/ClientAuthGate.jsx` — magic-link login (not Google OAuth; clients aren't on a
  Workspace domain), gated on an active `client_users` row, same shape as `AuthGate`/`staff`.
- Reached via `?client-login=1`, checked before `AuthGate` at the bottom of app.jsx (a client signing
  in for real is never staff).

**Deliberately stops at a placeholder** once signed in — wiring a real `clientUser` into the actual
dashboard pages means real surgery on `App` (skip the client picker/"Preview As"/staff sidebar
chrome, feed `resolveAccess` the real row instead of mock `client.users`), which isn't something to
rush in alongside this scaffolding. That's the next concrete step whenever this picks back up.

`MGB_VERSION` bumped to `2026-09-17ap`.

## §91 — Phase 2: signed-in clients reach the real dashboard

`App` now accepts `clientPortalUser` (a real `client_users` row) alongside `staffUser` — never both.
The insight that made this a small change instead of a rewrite: `resolveAccess`'s `user` object and
the Sidebar's `isBookkeeper` branch already treat "a real, resolved person is signed in" as the
client-facing view — that's exactly what "Preview As" has exercised in mock form all along. So:

- `resolveAccess` takes an optional `overrideUser` — when set, skips the mock `client.users` lookup
  and uses it directly (same shape, so every existing check keeps working unchanged).
- `App` pins `selectedClientId` to `clientPortalUser.client_id` (no picker) and builds that override
  from the signed-in row, normalizing `premium_throttled` → `premiumThrottled`.
- `ClientPortalGuard` (replacing the old placeholder) checks the client_id resolves to a real
  `CLIENTS` entry (data.js is still mock — Phase 3) before rendering `<App clientPortalUser=... />`.
- Fixed two crash risks flushed out by staffUser now legitimately being `undefined`: `initialPage()`'s
  fresh-session default (`bookkeeper-home`, staff-only) and an effect reading
  `effectiveStaffUser.role` unguarded.

Not fully exercised end-to-end yet (needs a real `client_users` row with `realAuthEnabled`-equivalent
setup and a live magic-link round trip to confirm) — architecturally it's the same code path staff
already use daily via "Preview As", which is what makes this a reasonably safe first pass rather than
a parallel client-only render tree.

`MGB_VERSION` bumped to `2026-09-17aq`.

## §92 — Fix: client magic-link email dropped ?client-login=1 on redirect

Live-tested end to end and found the real bug: `signInWithOtp()` without `emailRedirectTo` sends the
confirmed session back to the bare site URL, dropping the `?client-login=1` query param that tells
the app to mount `ClientAuthGate` instead of the staff `AuthGate`. The confirmed client landed back
on the staff Google sign-in screen instead of their dashboard. Fixed by passing
`emailRedirectTo: window.location.href` so the redirect echoes back whatever URL (params included)
the person started from.

Note: Supabase enforces an allowlist on redirect URLs (Authentication → URL Configuration in the
dashboard) — if this still redirects to the bare domain after this fix, that allowlist needs
`https://app.mygoodbooks.org/*` added.

`MGB_VERSION` bumped to `2026-09-17ar`.

## §93 — Client login gets a friendly /login path

`?client-login=1` worked but wasn't something to hand a client — added `vercel.json` with a rewrite
(`/login` → `/index.html`, since this is a static SPA with no server-side router) and `clientLoginMode`
now checks `window.location.pathname === "/login"` too. `?client-login=1` still works for any link
already sent out. `ClientAuthGate`'s `emailRedirectTo: window.location.href` needed no change — it
already echoes back whatever path the person started from.

Real client sign-in link once this deploys: `https://app.mygoodbooks.org/login`.

`MGB_VERSION` bumped to `2026-09-17as`.

## §94 — Documents tab: Supabase holds Drive links only, not files

Kicked off the "client docs stay in Google Drive" integration. Supabase never
stores file bytes — it's a passthrough: `client_documents` table holds
`{client_id, name, drive_url, category, added_by, created_at}` only.

- `supabase/` migration `client_documents`: RLS lets staff manage rows for any
  client, and lets a signed-in client (via `client_users`) read their own
  client's rows. Applied live via `apply_migration`.
- Manage Access modal gained a "Documents" tab: add a name + paste a Drive
  share link, list opens the file in Drive in a new tab, remove deletes the
  row (never touches the actual file in Drive).
- No live Drive API call yet — this is metadata + manual link-paste. A real
  Drive picker / auto-sync (service account, folder-per-client) is the next
  step whenever we want it, same track as the sketched QuickBooks Edge
  Function sync (OAuth per client, scheduled pull into Supabase tables,
  Documents stays link-only since it's explicitly meant to avoid storing
  large files in Supabase).
