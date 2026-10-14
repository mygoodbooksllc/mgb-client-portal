# Ledger review and quote tool: foundation spec

Status: DRAFT v1, written 2026-10-14 (session 1 of the GL Review plan). **Spec only. Nothing is built and no migration is applied.**
Source plan: `~/Desktop/Claude Projects/MGB GL Review/` (`PLAN.md`, `HANDOFF.md`, `prototype/`, `portal-mockup.html`).
Rule for the whole project: **settle what we pull and store once, here.** Phases 2 to 5 add screens and checks, not new pulls or reshaped tables.
QuickBooks is read-only. Nothing in this spec writes anything to Intuit. No AI call anywhere in the app.

---

## 0. Decisions locked in this session

| # | Question | Decision | Source |
|---|---|---|---|
| D1 | New edge function or a mode in `qbo-sync`? | **New `qbo-gl-review`.** The QuickBooks connection and token helpers are **shared** in `supabase/functions/_shared/qbo.ts`, not copied (see 3.2 for the one hazard this creates). | Owner, via the main session |
| D2 | Does an unfinished "Ledger reviewed" step block marking the month Done? | **See 0.1. Built as one setting with two values, `warn` or `block`. Ships as `warn`.** | Owner, in this session |
| D3 | Email for clients who don't use the portal | **Outbound only for v1.** The email's reply-to is the bookkeeper's own address. No inbound path. A new `contact_email` holds the address. | Owner, in this session |
| D4 | First values for the quote tool's assumptions | **Placeholders**, labeled "placeholder, tune from real hours data" in the UI until an admin saves them. Later they auto-tune from real QuickBooks Time hours vs. transaction counts (section 9.4). | Owner, in this session, plus the main session |
| D5 | No AI in the app | Confirmed. The summary is a template behind one `findings -> text` function. | PLAN.md, 2026-10-13 |
| D6 | Quote tool access | Admins only, whole tool. "Review a file" stays open to all staff. | PLAN.md, 2026-10-12 |
| D7 | Tab name and placement | "Ledger review", staff client tab right after Close, route `#/client/<id>/ledger`. All active staff with `can_access_client()`. | PLAN.md |

### 0.1 Conflict to resolve before the build: warn or block

Two instructions reached this session on D2 and they disagree:
- The owner's answer typed in this session: **warn only.**
- A relayed message from the "MGB App 10/27" session, said to come from the owner: **block; "Ledger reviewed" is required.**

I followed the direct answer, and I'm not treating the relayed message as an override. Either value is one setting (`gl_review_settings.done_gate`, section 4.9, default `warn`), so the build is identical and flipping it later is one admin click. **Needs one confirming word from the owner before phase 1 ships.** If it is `block`, section 6.4 lists what else turns on (the database guard, and an admin override with a reason).

### 0.2 Deviations from PLAN.md (each needs a "yes" or a "no")

1. **Sign-off is per client and month, not per flag.** PLAN.md puts `approved_by` / `approved_at` / `sent_back_note` on the flag row. The Close step signs off a whole month, so that data lives in a new `gl_review_signoffs` table (4.4). The three columns also stay on `gl_review_flags`, nullable, with a narrow meaning: an admin disagrees with one specific clear and sends that flag back. This keeps the plan's promise that sign-off never reshapes the flag table.
2. **Greeting name and contact email go on `client_profile`, not `clients`.** `clients` is readable by every active staff member (the roster) and writable only by admins (`clients-roster.sql`). A bookkeeper could not set a greeting name, and a contact email would be visible to staff who aren't assigned to the client. `client_profile` is already "staff manage, scoped by `can_access_client()`". The summary reads `clients.org_type` and `client_profile.greeting_name` together. Fallback if you want `clients` anyway: one admin-only column plus a security-definer setter.
3. **`transaction_questions` can't be reused as-is for Ask client.** It models the client asking staff: staff cannot insert (policy), and the notify trigger posts the message as the client. Section 5 specs the change. PLAN.md assumed "no schema change"; this is the one real exception.

---

## 1. What exists today (verified against `origin/main`, 5ca1d71)

- `qbo-sync` (1,965 lines) pulls the GL three ways, all narrow: uncategorized accounts only (`tx_date,txn_type,subt_nat_amount`), and giving by donor (`qbo_donor_gifts`, income accounts, one call per year). It has no full-column, all-accounts GL pull.
- The cleared column is already used: `TransactionList` with `is_cleared` in `pullCloseData` (R = reconciled; anything else counts as unreconciled). The GL pull requests the same field name; the sandbox check in section 11 confirms the GL report returns it.
- `qbo_accounts` already stores `account_type`, `account_sub_type`, `classification`. `qbo_transactions` keys on `(client_id, txn_type, qbo_id)`. Its `txn_type` text comes from the TransactionList column, and `transaction_questions.txn_key` is `<txn_type>:<qbo_id>`.
- Auth for a signed-in person: anon-key client with the caller's JWT, `staff.active`, then `can_access_client` RPC, then service_role. `qbo_usage_add(source, calls)` meters calls (service_role only). `qbo_connections.sync_started_at` is the per-client lock.
- Close tab: `month_close` (status not_started / in_progress / review / done / na; `period` is the first of the month) plus `client_close_items` (`period` is text `YYYY-MM`, `item_key`, `done`). `CLOSE_CHECKLIST` in `app.jsx` has six items.
- Cost model: `staff_cost_rates` (staff_email, effective_from, hourly_cost), `profitability_settings` (target_margin_pct, default 40), `client_fees`, `client_profitability()`. All admin-only. `staff.role` is `bookkeeper` or `admin`.
- Milestones: `PRICING_MILESTONES` in `app.jsx` (9 tiers; Church Plant is tier 0 and is never suggested) and `client_milestone_stats` (90-day transaction count, expenses annualized).

---

## 2. The GL pull

### 2.1 Report and columns

One Intuit report, `GeneralLedger`, all accounts, `accounting_method` **pinned to the company's own preference as read from its `Preferences` once and then sent explicitly** on every pull (a company flipping cash/accrual otherwise changes every closed month's hash; the pull records the basis it used in the print so a flip is reported as "basis changed", not "edited after close"). Columns requested:

`tx_date, txn_type, doc_num, name, memo, account_name, split_acc, subt_nat_amount, rbal_nat_amount, is_cleared, klass_name, dept_name`

Each line the function returns (in memory only, see 2.5):

| Field | Source | Why it is in the pull now |
|---|---|---|
| `key` | `<txn_type>:<qbo_id>`, `qbo_id` from the `tx_date` cell's `id`, falling back to the `txn_type` cell's `id` like the donor pull (`qbo-sync:958-972`). A line with no id at all gets a synthetic key `syn:<date>:<type>:<num>:<acct_id>:<cents>:<n>`, is counted, hashed and shown, but can't be asked about | Dedupe, flags, `transaction_questions` link |
| `line` | `key` + account id + a per-key counter | Two sides of one transaction are separate lines |
| `date`, `type`, `num`, `name`, `memo`, `split`, `amt`, `bal` | the columns above | Prototype checks |
| `name_id` | the `name` cell's `id` | Joins to the vendor 1099 map |
| `acct_id`, `acct` | the account section header's `id` and value | Pass-through rules, trends |
| `acct_type`, `acct_subtype`, `classification` | joined from `qbo_accounts` by `acct_id` (falls back to one `Account` query if the client's `qbo_accounts` is empty or stale) | Trends on P&L accounts only; retires the `isBank()` name guess |
| `cls` | `klass_name` | Church checks later |
| `loc` | `dept_name` (QuickBooks "Location") | Church and fund checks later |
| `cleared` | `is_cleared`, normalized to `R`, `C` or empty | Reconciliation panel |
| `v1099` | joined by `name_id` from the vendor map (2.3) | 1099 review later |

The response also returns `cleared_available`, `class_tracking`, `location_tracking` (false when the column is absent for that company). The UI then says "Not available for this company" and never guesses. Column resolution uses the existing `reportColumn(report, key, ...titles)` pattern: by key and title, never by position.

### 2.2 Window and chunking

- Default window: the first day of the month 14 months before the current month, through today. That covers the year to date and the same months last year (the "Seasonal" check needs 13 or more).
- Split by calendar quarter, one `GeneralLedger` call per quarter (5 calls for 14 months), run two or three at a time. A chunk that Intuit rejects as too large is halved by date until it fits. **Unverified:** whether an oversized report errors or is silently truncated (section 11). The function must detect truncation (a report-level warning/`Header.Option`, or a chunk whose total disagrees with its `Summary`) and treat it as a failure, never as a short ledger.
- A pull is **all or nothing**. Any chunk that fails fails the pull. A partial ledger would make "missing usual activity" and "fixed" logic lie.
- Optional narrower windows (`ytd`, a single month) for the Close card refresh.

### 2.3 Vendor 1099 status

Not a GL column. One `select Id, DisplayName, Vendor1099 from Vendor` query (paged at 1,000) per pull gives `id -> v1099`. Missing tax IDs for the later 1099 review: whether Intuit returns `TaxIdentifier` to our app is **unverified** (section 11); the pull stores nothing about it either way.

### 2.4 Cost and metering

About 5 report calls plus 1 to 2 vendor/account queries, about 7 per pull, metered as `qbo_usage_add('gl_review', n)` once per request (`source` is 9 characters; the column allows 40). A heavy month is 30 to 40 pulls across the firm, so under 300 calls. Round numbers against the 500,000 limit: well under 0.1%. `qbo_usage_status()` mode `stopped` does not block this function, because it is only ever user-initiated (same rule as "Sync now"). Never log Intuit bodies; log status codes, counts and `intuit_tid` only.

### 2.5 What is stored from a pull, and what is not

- **GL lines are not stored** (PLAN.md's leaning, confirmed). The function returns them to the browser, which runs the checks. The browser keeps them in memory for 15 minutes per client and nowhere else (no localStorage or sessionStorage, because it is customer financial data).
- Stored by the function (service_role): month fingerprints (4.5) and the pull audit row (4.6).
- Stored by the browser through RLS: flags, rules, summaries, sign-offs (via RPC).
- Consequence to accept: opening the tab costs a pull (5 to 7 calls, a few seconds). The Close card reads only stored flag counts and needs no pull.

### 2.6 Request and response

`POST /functions/v1/qbo-gl-review`

| action | body | result |
|---|---|---|
| `pull` | `{client_id, window?: "rolling14" or "ytd" or {start,end}, force?}` | `{status:"ok", pulled_at, window, lines[], vendors_loaded, cleared_available, class_tracking, location_tracking, calls}` or `{status:"fresh"}` / `{status:"in_progress"}` / `{status:"error", error}` |
| `baseline` | `{client_id, period}` | Pulls just that month and stores the closed-month snapshot (4.5). `{status:"ok"}` |

`fresh`: a pull completed under 30 seconds ago and `force` is false (the client keeps its in-memory copy). Errors are short plain-language strings, never Intuit text.

---

## 3. Edge functions

### 3.1 `qbo-gl-review` (new)

- `verify_jwt` **on** (no cron caller, unlike `qbo-sync`), and the checks are still done by hand: `auth.getUser()` as the caller, `staff.active`, `can_access_client(client_id)` via the caller's JWT, and only then the service_role client. Staff only. A client user gets 403.
- Connection must exist and `status = 'connected'`; otherwise `{status:"error", error:"QuickBooks isn't connected for this client"}` and the UI offers "Review a file".
- Lock: a row in `gl_review_pulls` (4.6) with a 3-minute stale takeover.
- No scheduled/cron mode in phase 1 (PLAN.md's "daily during close week" is deferred: checks run in the browser, and a cron would need them on the server. Revisit in phase 4 with the changed-after-close check).

### 3.2 `_shared/qbo.ts` (new) and the token hazard

Exports: `IntuitError`, `intuitFetch(ctx, url, what)` with a per-request call counter on `ctx` (no module-level global), `reportUrl`, `queryUrl`, `reportColumn`, `walkDataRows`, `num`, `baseForEnv` + the per-connection `api_env` resolution, and `getAccessToken(admin, clientId)`.

- **Phase 1 copies, not rewrites.** `_shared/qbo.ts` is lifted from `qbo-sync`; `qbo-sync` keeps its own fetch/report helpers until the shared module has tests, then a separate change migrates it. (A function bundles `_shared` at deploy time, so each picks up shared changes only when redeployed. That differs from the "deployed independently" property `qbo-sync`'s header describes, so the header is updated when it migrates.)
- **Hazard, and the one change this forces in existing code: concurrent token refresh.** Intuit rotates the refresh token on every use and the old one dies instantly. Today the paths that refresh have **no lock**: `qbo-sync`'s `getAccessToken` (`index.ts:250-297`) and `qbo-refresh-token`; a third in this function would make it worse. `sync_started_at` is not a refresh lock: only "Sync now" takes it (the scheduled run doesn't) and it is held for the whole sync, so waiting on it would time out and taking it would make Sync now answer `in_progress`.
  Fix, in the **same release** as `qbo-gl-review`: a dedicated `qbo_connections.token_refresh_at timestamptz`, taken with the conditional-update pattern of `acquireSyncLock` (stale after 60 seconds) and held only around the Intuit token call plus `qbo_store_tokens`. A caller that can't take it waits 2 seconds, up to 3 tries, then **re-reads the stored tokens** (the other process refreshed) rather than refreshing. `qbo-sync`, `qbo-refresh-token` and `qbo-gl-review` all adopt it (about 15 lines in each existing function). This is the only place phase 1 edits production sync code. It fixes an existing race, so sandbox-test it first with two simultaneous refreshes.

### 3.3 `gl-review-send` (new, small)

Sends the two outbound emails (Ask client and the client summary) to a non-portal client. **It takes only an id** (`{kind:'question'|'summary', id}`) and reads the recipient, subject and body from that database row, so it can't relay arbitrary text from the firm domain. `verify_jwt` on. Staff JWT + `can_access_client`, then `_shared/email.ts` `sendEmail` with `replyTo` set to the signed-in bookkeeper's email and the usual MGB layout/signature (`_shared/layout.ts`, `_shared/signature.ts`). Honors the client-email switches (`client_email_settings` master switch, `client_email_prefs.opt_out_all`, `test_only`) the way `client-emails` does, and logs to `client_email_log`. Never includes fees, rates or margins. **Owner sign-off needed:** `notification-emails.sql` (lines 38-39) says firm emails never carry message text or amounts, and these would (the question text and one transaction amount are the point of the email). `client_email_log`'s feature check must also accept the new feature values; re-read its latest definition live before writing the migration. It does not read QuickBooks. Separate from `qbo-gl-review` so the QuickBooks function never holds email credentials. Also used for portal clients who have email notifications on, only through the existing message-notification triggers, not directly.

---

## 4. Tables and RLS

All new tables: RLS on, `revoke all ... from anon`, column-level grants where only some columns are writable, `created_by` / `updated_by` stamped by trigger from the JWT (the `transaction_questions_stamp` pattern), no delete policy unless stated. Staff access = `is_active_staff() and can_access_client(client_id)`. Client users have **no** policy on any of these. Files: `supabase/gl-review-1-flags.sql`, `-2-month-prints.sql`, `-3-summaries.sql`, `-4-questions.sql`, `quote-1-settings.sql`, `quote-2-saved.sql`. Each safe to re-run, with the applied date in its header like the others.

### 4.1 `gl_review_flags`

```
id uuid pk default gen_random_uuid()
client_id text not null references clients(id) on delete cascade
period date not null check (period = date_trunc('month', period)::date)   -- month of txn_date
txn_key text not null check (length between 1 and 200)                      -- '<txn_type>:<qbo_id>'
flag_type text not null  -- suspense, obe, dup, negbank, jecash, gap, large, round, weekend, blank,
                         -- + phase 2: swing, vendor_acct, loan_expense, watch_vendor, recon_uncleared, changed_after_close ...
severity text not null check (in ('high','medium','low'))
why text not null check (length <= 1000)
txn_date date, amount numeric, name text, memo text, account_name text, account_qbo_id text,
other_side text, class_name text, location_name text         -- snapshot, so the row reads after a re-pull
status text not null default 'open' check (in ('open','asked','cleared','fixed'))   -- insert always 'open' (RPC)
cleared_reason text check (in ('expected','reviewed_ok','fixed_in_qbo','client_answered','other')),
note text check (<= 2000)
stop_flagging boolean default false                           -- set with the clear; creates a rule (4.2)
reviewer text                                                 -- last staff email to act, stamped
cleared_by text, cleared_at timestamptz
question_id uuid references transaction_questions(id) on delete set null   -- set when status = 'asked'; same client enforced in the RPC
approved_by text, approved_at timestamptz, sent_back_note text -- admin review of one clear (0.2 item 1)
first_period date not null, first_seen_at timestamptz default now(), last_seen_at timestamptz,
last_pull_at timestamptz                                      -- server-issued time of the pull that last saw it
fixed_at timestamptz, fixed_by text                           -- system, or 'rule' when a new rule hides it
checks_version int not null                                   -- version of the check code that produced it
created_at, updated_at
unique (client_id, txn_key, flag_type)   -- txn_key is a real '<type>:<id>' or a made-up key, see below
indexes: (client_id, period, status), (client_id, status, severity)
```

- **Keys for flags that aren't one transaction.** `txn_key` is `<txn_type>:<qbo_id>` for transaction flags (duplicate, large, round, weekend, blank, JE-to-cash, suspense, OBE, `loan_expense`, `watch_vendor`, `vendor_acct`). Others use fixed made-up formats so the unique key holds: `acct:<acct_id>:<YYYY-MM>` for `swing`, `recon_uncleared` and balance-sheet checks; `chk:<acct_id>:<num>` for `gap` (the check after the gap); `neg:<acct_id>:<YYYY-MM-DD>` for `negbank` (start of the streak); `month:<YYYY-MM>` for `changed_after_close`. `period` is derived from the key's date/month. On conflict, `period`, `txn_date` and the snapshot **update** (a date edited in QuickBooks moves the flag; `first_period` never changes).
- `status`: **open** (detected, nobody acted), **asked** (question sent), **cleared** (a person decided), **fixed** (the check no longer fires, set by the system). `fixed` that fires again reopens to `open`. `cleared` stays cleared unless an admin sends it back (`approved_*` / `sent_back_note`), which sets `open` with a note.
- **All writes go through security-definer RPCs; the browser gets no INSERT or UPDATE grant on this table** (SELECT only, staff + `can_access_client`). An invoker upsert can't work with a column-limited UPDATE grant, and a granted `status` column would let the browser insert rows already `cleared` or set `fixed` directly, because a trigger can't tell an RPC from a direct call. Each RPC checks `is_active_staff()` and `can_access_client(client_id)` itself, lowercases emails, stamps `reviewer/cleared_by/cleared_at` from the JWT, and enforces the transitions:
  - `gl_review_upsert_flags(client, pull_at, checks_version, flags jsonb)`: new rows are `open`; on conflict updates only detection fields, `last_seen_at`, `last_pull_at`; reopens `fixed`; never changes `open/asked/cleared`. Max 2,000 flags per call.
  - `gl_review_mark_fixed(client, pull_id)`: flips `open` flags whose `last_pull_at < pull_at` of that pull. **Only a full, complete `rolling14` pull may call it**, and only for flags whose `checks_version` equals the pull's (a changed threshold or new check must not mass-"fix" old flags). A flag hidden by a new `stop_flagging` or `pass_through` rule becomes `cleared` with reason `rule`, not `fixed`. A stale tab (older `pull_at` than a flag's `last_pull_at`) is a no-op, which is what stops two open tabs from flipping each other's flags.
  - `gl_review_clear(flag, reason, note, stop_flagging)` (open/asked to cleared), `gl_review_ask(flag, ...)` (creates the question and sets the flag to `asked` in one transaction; refuses a question from another client), `gl_review_answer(flag, answer)`, `gl_review_send_back(flag, note)` (admin only; cleared to open).
- Flag rows hold names, amounts and memos: the same sensitivity as `transaction_questions`, same RLS. Cleared and fixed flags older than 24 months are archived by a monthly job in phase 4; no deletes in phase 1. Deleting a client cascades the flags; the `question_id` / `flag_id` pair uses `on delete set null` on both sides so that cascade can't fail.

### 4.2 `gl_review_rules`

```
id uuid pk
client_id text not null references clients(id) on delete cascade
kind text not null check (in ('stop_flagging','pass_through','account_type_override','threshold'))
status text not null default 'active' check (in ('active','suggested','dismissed'))   -- 'suggested' = repeated-clears feature (phase 4)
flag_type text                 -- stop_flagging, threshold
match_name text                -- stop_flagging: vendor/customer name (case-insensitive exact)
account_qbo_id text, account_name text   -- stop_flagging, pass_through, account_type_override
account_type_override text     -- one of the QuickBooks account types
params jsonb                   -- threshold values (later); {} otherwise
source text not null default 'manual' check (in ('manual','auto_detected','suggested'))
note text, created_by, created_at, updated_by, updated_at
checks: stop_flagging needs flag_type and (match_name or account); pass_through needs an account;
        account_type_override needs an account and account_type_override
unique INDEX (not a table constraint, because of the coalesce expressions) on (client_id, kind, coalesce(flag_type,''), coalesce(lower(match_name),''), coalesce(account_qbo_id, lower(account_name),''))
```

- **pass_through**: the account (BILL, Divvy, Ramp spend-card clearing accounts) is left out of trends and transaction counts. Auto-detected by name in code (`/\b(bill\.?com|bill pay|divvy|ramp)\b/i`) and shown as a removable suggestion; only an explicit rule is stored. API pulls match on `account_qbo_id`; file uploads match on name.
- **account_type_override**: for file uploads, where the account type is a name-based guess, and for API accounts QuickBooks has typed wrongly. The correction is saved once per client.
- Staff manage for clients they can access. Anyone who can clear a flag may create a `stop_flagging` rule; `suggested` rows are created by the app and accepted by one click ("Stop flagging this for Grace?"). Nothing mutes automatically.

### 4.3 `gl_review_summaries`

```
id uuid pk, client_id text not null refs clients, period date not null (first of month)
variant text check (in ('clean','minor','action'))
body text not null check (length <= 8000)            -- the editable draft
findings jsonb not null                              -- counts and totals the text was built from
status text not null default 'draft' check (in ('draft','sent'))
sent_via text check (in ('portal','email')), sent_to text[], sent_by text, sent_at timestamptz
created_by, created_at, updated_by, updated_at
unique (client_id, period)
```

A sent summary is locked (body not editable after `status='sent'`; a new month gets a new row; a correction is a new message through the normal channels). On send, also write a `client_sent_items` row (`item_type 'other'`, label "Ledger review summary") so it shows in the Close tab's "Sent to the client" history. The template lives behind one function `LR_summaryText(findings, client) -> {variant, body}` in `components/ledger/LR_summary.js` so wording can change without touching the table, screen or send flow.

### 4.4 `gl_review_signoffs` (per client and month)

```
client_id text, period date, primary key (client_id, period)
status text not null default 'in_review' check (in ('in_review','reviewed','approved','sent_back'))
reviewed_by text, reviewed_at timestamptz, high_open_at_review int
approved_by text, approved_at timestamptz
sent_back_by text, sent_back_at timestamptz, sent_back_note text
override_by text, override_note text, override_at timestamptz   -- only used in block mode (6.4)
updated_at
```

Three security-definer RPCs, each checking staff + `can_access_client`:
- `gl_review_mark_reviewed(client, period)`: any staff. Sets `reviewed`, records the open high count, and upserts `client_close_items(item_key='ledger_reviewed', done=true)`.
- `gl_review_approve(client, period)`: `is_active_staff_admin()` only. Any admin (Jesse by default). **An admin who is the recorded reviewer cannot approve their own review** (compare lowercased emails: `is_active_staff_admin` and `is_client_member` compare case-sensitively today), so a second admin is needed; the same RPC can be called with `p_override_note` for a sole-admin emergency, which is logged. (Open question 3.)
- `gl_review_send_back(client, period, note)`: admin only, note required (1 to 1,000 characters). Sets `sent_back`, sets the close item `done=false`, so the Close step reopens.
No direct table writes from the browser. SELECT for staff on assigned clients. The close-item upsert converts `period` (date) to `to_char(period,'YYYY-MM')` explicitly. Reopening a month (Done to anything else) **clears** the approval and any override, so a warn-era approval or override can't satisfy block mode later. Because the RPC bypasses the UI, it also performs the first-tick effect `CT_applyFirstTick` does (month to In progress).

### 4.5 `gl_review_month_prints` (fingerprints, and closed-month snapshots)

```
id uuid pk, client_id text refs clients, period date
kind text check (in ('pull','baseline'))
line_count int, debit_total numeric, hash text         -- sha-256 hex
captured_at timestamptz default now(), captured_by text  -- 'staff:<email>'
lines jsonb                                             -- baseline rows only; null otherwise
unique (client_id, period, kind, captured_at)
```

- **Fingerprint:** for each month in the pull, build one string per line `key|acct_id|date|cents|cls|loc|name_id`, **sort the strings** (not Intuit's row order, which isn't stable), join with newlines and hash with SHA-256 (Deno `crypto.subtle`). Class, location and name are in the hash so a church recoding a fund after close is caught. `line_count` counts lines; `debit_total` sums the debit-side amounts (the sign convention for debit vs. credit lines is fixed from the account's classification in the build, and unit-tested). Amounts are rounded to cents as integers before hashing so float noise can't change a hash.
- A `pull` print is inserted **only when the hash differs from that month's latest print**, so a month that never changes costs one row.
- **Baseline snapshot:** `lines` is a compact array `[key, acct_id, date, cents, name]` for one month, written (a) from the last `pull` print captured **before** `month_close` was set to done, when the app's best-effort call in (b) was missed, never from a pull taken after Done (which could already contain post-close edits; if no earlier print exists the month is marked "no baseline" and "changed after close" is not offered for it), or (b) the app calls `baseline` right after a month is marked Done (best effort: if QuickBooks is down, Done still goes through and the month gets its baseline on the next pull). Re-closing a reopened month replaces its baseline. Size: about 100 bytes per line; a 300-line month is 30 KB; 100 clients at 12 months a year is under 40 MB a year. Baseline `lines` are nulled after 24 months.
- **Phase 4 "changed after close"** compares the latest print with the baseline: different hash means diff the baseline `lines` against the fresh pull and name the added, removed and edited transactions.
- Prints are only saved when someone pulls. A cheap fingerprint-only job (no checks needed) in phase 4 can run nightly so closed months are watched even when nobody opens the tab.
- Written only by the function (service_role). Staff can SELECT (without needing `lines` in the list view: column grant excludes `lines` except through the diff RPC). No browser writes.

### 4.6 `gl_review_pulls` (audit and lock)

`client_id pk (latest pull only, it is the lock and the "last pulled" display, not an audit trail; the usage table is the audit of calls), started_at, finished_at, status ('ok','error','running'), calls int, window_start, window_end, line_count, error text (short), pulled_by`. Service_role writes; staff select. Gives "Last pulled 10:42 by Gillian" and the in-progress lock. No Intuit bodies.

### 4.7 Vendor watch list: `gl_review_watch_vendors`

`id, pattern text not null (case-insensitive substring, 2 to 80 chars), category text (streaming, liquor, gambling, personal_payment, other), note, active boolean default true, created_by/at, updated_by/at`. Firm-wide, **admin-edited** (insert/update by `is_active_staff_admin()`), readable by all active staff. Seeded in the migration with a starter list (streaming services, liquor, casino, Venmo, Cash App) that admins edit in Team > Ledger review settings. Matching is done in the browser against the loaded list; per-client exceptions are `stop_flagging` rules.

### 4.8 Quote tables: section 9.

### 4.9 `gl_review_settings` (single row)

`id boolean pk`, `done_gate text check (in ('warn','block')) default 'warn'`, `pull_window text default 'rolling14'`, `updated_by/at`. Admins update, active staff read. Same pattern as `month_close_settings`.

### 4.10 `client_profile` additions

`greeting_name text check (<= 80)` ("Pastor Mark", "Mrs. Ellis") and `contact_email text check (looks like an email, lowercase)`. Both nullable. Existing "staff manage client profile" policy covers them. Summary rule: if `org_type` is a church and no greeting name is set, the summary header says "Hello," and the screen shows a "Set a greeting name" prompt; never "Pastor" plus a guessed first name.

---

## 5. Ask client: changes to `transaction_questions`

Today the table only represents a **client asking staff**: the client INSERT policy checks only `is_client_member` and `status='open'` (`transaction-questions.sql:66-68`), the SELECT policy shows every row to any client member (`:60-64`), the stamp trigger allows only open to resolved (`:102-104`), the grant is `update (status, resolution_note)` (`:57`), and the notify trigger posts an insert as `author_kind='client'` and a resolve into the thread of `new.created_by` (`:167-168`). Ask client is the opposite direction, so migration `gl-review-4-questions.sql` changes all of those, and the changes below are **security-relevant**, not just additive.

New columns:
```
direction text not null default 'client_asked' check (in ('client_asked','staff_asked'))
asked_of_email text            -- lowercased; the portal user it is for (staff_asked), or contact_email on the email path
asked_via text check (in ('portal','email'))
answer text check (<= 2000), answered_by text, answered_at timestamptz
flag_id uuid references gl_review_flags(id) on delete set null
```
`status` becomes `('open','answered','resolved')`. Existing rows are all `client_asked`. The `suggested_category or note` check is relaxed for `staff_asked` (the question text goes in `note`, still required).

**Who can do what (the stamp trigger enforces it; policies back it up):**
- **`direction` is set by the trigger from the caller, never trusted from the row:** an active staff member inserts `staff_asked`; a client member inserts `client_asked`. The client INSERT policy adds `direction='client_asked'`. `answer`, `answered_*` and `resolved_*` are nulled on insert.
- **Insert by staff** is only through `gl_review_ask` (an RPC), which validates that `asked_of_email` (lowercased) belongs to an active `client_users` row of the same `client_id` for `asked_via='portal'`, or equals `client_profile.contact_email` for `'email'`.
- **SELECT** replaces the old policy: staff with `can_access_client`; a client member sees `client_asked` rows they created (`created_by = jwt email`) and `staff_asked` rows addressed to them (`asked_of_email = jwt email`). That also respects category/fund-scoped users (`client-scope-rls-bank.sql`), who must not see other transactions.
- **Transitions:**

| Caller | Direction | Allowed | Notes |
|---|---|---|---|
| staff | client_asked | open to resolved | unchanged |
| client user (the addressee) | staff_asked | open to answered, writes `answer` once | own rows only; column grant adds `answer` |
| staff | staff_asked, `asked_via='email'` | open to answered, writes `answer` | "Got an answer" typed in for a non-portal client |
| staff | staff_asked | answered to resolved, or open to resolved with a note | closing it |

- **Notify trigger routes by `direction` and `asked_via`.** `staff_asked` + portal: insert a **staff**-authored `client_messages` row into the thread of `asked_of_email`; on `answered`, a client-kind message with the answer into that same thread, so staff see "Message waiting". `staff_asked` + email: **post nothing** (no fake thread, no `client_message` email to the bookkeeper). `gl-review-send` emails the question with reply-to the bookkeeper. If `contact_email` is empty, Ask client is disabled: "Add a contact email in Client setup".
- The unique "one open question per transaction" index stays; a staff-asked and a client-asked open question on one transaction collide, and the UI shows the existing one.
- A flag's `question_id` and the question's `flag_id` point at each other (`on delete set null` on both). Answering does not clear the flag: **a person clears it** after reading the answer.
- **UI that must filter or label by `direction`, or break:** `components/client/TxnQuestions.jsx` (and `TQ_api.resolve`, which filters `status='open'`, so answered questions could never be resolved: it must accept `answered`), `components/client/BankAccounts.jsx` (lines ~372 and ~656 show open questions per row to clients), the Inbox context pane, the client overview badge, `ClientTabCounts`, and the "What we need from you" list.
- Follow-up task (phase 5): `TK_api.create({source:'gl_review', source_ref: flag.id, due_date: +3 business days})`; `flag_id` and the flag `id` already exist, so no schema change then.

---

## 6. Close tab integration

### 6.1 New close step

Add `{ key: "ledger_reviewed", label: "Ledger reviewed" }` to `CLOSE_CHECKLIST` after `review` ("Reports reviewed"). It shows as a normal checkbox plus a sub-line, "Reviewed by Gillian · Approved by Jesse" (or "Waiting for admin approval" / "Sent back: <note>"). The checkbox itself is driven by `gl_review_mark_reviewed` and `gl_review_send_back`, not by a free toggle, so it can't diverge from the sign-off row.

**This is a bigger change than one array entry.** `CLOSE_CHECKLIST.length` / its items are used at `app.jsx` ~5823, 6270-6415 and 7371, `HomeCards.jsx` ~242 and 266, `StaffInbox.jsx` ~761 (which counts every done row), and `ClientClosePage.jsx` ~205, 795 and 868. The step list must become per client and month: **`closeStepsFor(client, period)`** returns six or seven steps (7 only when the client is QuickBooks-connected, see 6.3) and every one of those sites uses it. Rules:
- **Effective-from period.** The new step only applies to months on or after the first month it ships, so every past month doesn't become 6/7 and flip to "behind", inflate the "Closes open" tile or trip the Inbox close rules.
- The "sent" auto-tick toast ("N steps left") counts only applicable steps.
- "Six steps" copy appears in `month-end-close.md`, `client-overview.md`, `faq.md`, `bookkeeper-guide.md`, `README.md:485` and `app.jsx:6234`; they change in the same commit.
- **The checkbox cannot be set directly.** `client_close_items` has a FOR ALL staff policy (`staff-client-tools.sql:182-184`), so any staff member could tick `ledger_reviewed` by hand. A trigger on `client_close_items` rejects writes to `item_key='ledger_reviewed'` unless they come from the sign-off RPCs (which set a transaction-local flag), and the UI renders the box read-only from `gl_review_signoffs`.

### 6.2 Suggested-done and the Close card

A "Ledger review" card on the Close tab shows: open / asked / cleared counts for the month, high-priority count, last pulled, the sign-off state, and a button to the tab. The step is **suggested** (a "Ready to mark reviewed" hint) when no high-priority flags are `open`; a person still marks it. Because there is no scheduled pull in phase 1, the card shows "Last pulled <time>" and says "counts as of the last pull" rather than presenting stale numbers as current; opening the tab refreshes them.

### 6.3 Clients with no QuickBooks connection

`closeStepsFor` omits the step (six steps, as today) unless the client has a QuickBooks connection with `status='connected'`. File uploads on a client are not stored in phase 1, so there is nothing to sign off. This must be explicit, or a non-connected client could never finish a close under `block`.

### 6.4 Warn vs. block (`gl_review_settings.done_gate`)

- **warn (default):** marking a month Done while the step is not `approved` shows "Ledger review isn't approved. Mark done anyway?" The override and who did it are written to `client_activity_log` and `gl_review_signoffs.override_*` through an RPC (`gl_review_override_done(client, period, note)`, any staff who can access the client), since the sign-off table has no browser writes.
- **block:** the same screen, but "Mark done" is disabled; an admin gets "Override..." with a required reason. Enforced by UI **and** a `before insert or update` trigger on `month_close` (an insert straight to `done` must be caught too, `month-close.sql:67`) that raises when `status` is or becomes `done` and the client is QuickBooks-connected, the gate is `block`, the month has no `approved` sign-off and no override. The trigger keeps working if some other screen (Work > Close grid) writes `month_close`. All writes go through `CT_saveMonthClose`, so the UI gate lives in one place.

---

## 7. Phase 1 screens

All in new files under `components/ledger/` with the `LR_` name prefix, added to `window.__SOURCE_ORDER` before `app.jsx`, no bundler. Pure functions (`LR_parse`, `LR_checks`, `LR_summary`) have no React or DOM dependency and ship with `*.test.js` beside them like `staffOpsLogic.test.js`.

1. **Client > Ledger review** (`STAFF_CLIENT_TABS` entry `client-ledger`, label "Ledger review", tour key, `#/client/<id>/ledger`). Month picker (defaults to the last completed month). Summary strip (Ledger lines, open flags, high priority, asked, Uncategorized $ and Ask Client $). Flag table with filter chips per type, status tabs (Open, Asked, Cleared), `Open since <month>`, per-row **Clear** (reason, note, "stop flagging this for <client>") and **Ask client**, **Got an answer**. Reconciliation panel per bank, card and loan account (it reuses the existing `reconciled` close check and `qbo_account_status` where the API has them, and adds uncleared count, dollars, oldest date from the pull; a loan uncleared while operating accounts are clean is high priority; "Not available for this company" when no cleared data). "Month vs. the year" on income and expense accounts only, pass-through accounts excluded. Sign-off bar: **Mark reviewed**, admin **Approve / Send back**.
2. **Client > Close**: the Ledger review card and the new step (section 6).
3. **Summary for the client** (a panel on the Ledger review tab): template draft, editable, **Send via portal** or **Send by email** (disabled with a reason when there is no portal user / no contact email). Nothing sends automatically.
4. **Work > Ledger review > Review a file**: all staff. Drop a CSV/XLSX; parse and check in the browser, nothing stored, no Intuit calls. Reads the Cleared column. Rules that apply by name (pass-through guesses, account-type guesses) are editable in the page and not saved (saved only when reviewing inside a client). "Copy for Excel" is the only output.
5. **Client setup**: Greeting name and Contact email fields (4.10).
6. **Team settings** (admin): vendor watch list editor; `done_gate` switch.
7. **Mobile and design:** surface top bar and tabs, Bitter / IBM Plex, the existing tokens (the mockup's CSS); stacks under 860 px as in the prototype.

### Phase 1 checks (from the prototype and Bailley's standard)

Ten prototype checks (suspense/uncategorized, OBE, duplicate, negative bank balance, manual JE to cash, check gap, unusually large, round dollar, weekend, no name or memo), deduped to one flag per transaction per type, plus the Cleared/Reconciliation panel, P&L-only trends, and pass-through. Phase 2 (step 4 in the plan) adds: swing "why" lines with One-time / Seasonal, vendor-account, loan-draw and watch-list checks. The data for all of them is in the section 2 pull, so no re-pull.

---

## 8. Account types and rules in the checks

- API pull: `acct_type` from QuickBooks. P&L accounts = `classification` Revenue or Expense (Income, Other Income, Expense, Other Expense, Cost of Goods Sold). Excluded from trends: Bank, Credit Card, Other Current Liability (payroll liabilities), Long Term Liability, Accounts Receivable, Accounts Payable, Equity, Fixed Asset, Other Asset, and any `pass_through` account. `account_type_override` rules win over both.
- File upload: name-based guess, the same list, correctable and (inside a client) saved as `account_type_override`.
- "Bank" for check-gap and negative-balance checks uses `acct_type in ('Bank')` and credit cards where relevant; the `isBank()` regex is kept only for files.

---

## 9. Quote tool (phase 3 build; tables specced now)

### 9.1 What it reuses

Hourly cost: average current `staff_cost_rates.hourly_cost` of active staff with `role='bookkeeper'` (latest `effective_from <= today` each), or a chosen bookkeeper's rate, changeable for one quote. Target margin: `profitability_settings.target_margin_pct`; saving it from the quote tool updates that row (one number for both features). Neither is copied. Reads go through a new admin-only RPC `quote_inputs()` (security invoker, explicit `is_active_staff_admin()`), because both tables are admin-only.

### 9.2 `quote_settings` (single row) and `quote_settings_history`

```
quote_settings:
  id boolean pk
  min_per_txn numeric(6,2) default 1.0
  min_per_recon numeric(6,2) default 20
  min_reports_review numeric(6,2) default 60
  cleanup_min_uncategorized numeric(6,2) default 3
  cleanup_min_duplicate numeric(6,2) default 5
  cleanup_min_obe numeric(6,2) default 10
  cleanup_min_unreconciled_month numeric(6,2) default 90
  is_placeholder boolean default true        -- true until an admin first saves; UI shows "Placeholder, tune from real hours data"
  auto_tune boolean default false
  updated_by, updated_at
quote_settings_history: id, changed_by, changed_at, source ('manual','auto_tune','seed'), old jsonb, new jsonb, note
```

A trigger writes the history row on every update, so a save can't skip it. Admins select/update (`is_active_staff_admin()`); no insert or delete grants. The starting values above are the placeholders from this session's question 4 and are **not** measured.

### 9.3 `saved_quotes`

```
id uuid pk
client_id text null references clients(id) on delete set null    -- filled by quote -> client (phase 5)
prospect_name text not null check (<= 200)
status text default 'draft' check (in ('draft','sent','accepted','declined','converted'))
period_start date, period_end date, source_file_name text        -- name only; the ledger is never stored
inputs jsonb     -- txn per month, annual expenses (+ typed budget), accounts found, flag counts and dollars
assumptions jsonb -- EVERY number used: the minutes, hourly cost (+ who/which rate), target margin, pricing version
result jsonb     -- milestone tier and fee, monthly hours and cost, margin per month, suggested fee at target, cleanup hours and dollars
note text, created_by, created_at, updated_at, converted_at
```

Admin-only RLS for all four operations. A saved quote copies the assumptions, so changing defaults later never changes it. The fee and tier are stored in `result`, so a later `PRICING_MILESTONES` change doesn't rewrite history. Contains a prospect's name and financial summary counts but **no ledger lines**. Prospect data retention: ask in open question 4.

Calculation (browser, one pure function `QT_compute(inputs, assumptions)`): transactions per month = unique transactions (not GL lines) over the last 3 full months divided by 3, **excluding pass-through accounts**; annual expenses = 3 months of expense-account activity x 4, or a typed budget/990; milestone = the higher tier of the two on `PRICING_MILESTONES`; Church Plant never suggested. Monthly minutes = txns x `min_per_txn` + reconcilable accounts x `min_per_recon` + `min_reports_review`; cleanup minutes = flags x the cleanup minutes. Cost = hours x hourly cost. Margin per month = fee minus cost. Suggested fee at target = cost / (1 - margin%).

### 9.4 Auto-tuning from real hours (owner request)

- `quote_tune_suggestion()` (admin RPC) computes minutes per transaction from clients with actual hours (the same hours `client_profitability()` uses) versus `qbo_transactions` counts over the same months, per client-month, using the median of ratios and excluding onboarding/cleanup months. It returns the suggestion, the sample size (clients and months) and the current value.
- Guardrails: at least 8 clients and 3 full months each; a single change is clamped to plus or minus 25% of the current value; the result needs `auto_tune = true` **and** `is_placeholder = false`, and `auto_tune` can't be turned on until the firm's QuickBooks Time connection is live (the main session reports the firm QBO connection is still waiting on Jeff's QuickBooks admin access). Until then: the readout does not exist, the toggle is disabled, and the values are the labeled placeholders.
- Applied by a monthly job that writes through the settings trigger (so the history row has `source='auto_tune'`). Admins get a notification when it changes a number. Phase 3 ships the **suggestion readout and a one-click "Apply"**; the scheduled auto-apply is a later switch.
- Also the estimated-hours column on the profitability screen (phase 3).

---

## 10. Security and privacy checklist

- RLS tests required for every table: a bookkeeper on client A reads/writes nothing for client B; a non-admin cannot touch quote tables, the watch list, `gl_review_settings`, approve or send back; a client user reads none of these tables and cannot see `staff_asked` rows addressed to someone else; an anon caller gets nothing.
- Edge functions: JWT check order as in 3.1; service_role used only after `can_access_client`; no Intuit body logged; `intuit_tid` kept.
- GL data is customer financial data: not stored, not in browser storage, not in logs, not sent to any third party. Flag snapshots hold name, amount, memo and are RLS-protected like `transaction_questions`.
- Outbound email only through `gl-review-send`, honoring the global kill switch, per-client opt-outs and `test_only`.
- The privacy policy and Dev Tools infra page do not need to change for phase 1 (no new processor). They would if a Claude step is ever added; out of scope.
- The vendor 1099 map is held in memory per pull and not persisted.

---

## 11. Verify in the Intuit sandbox before the build starts (the cheap, high-value step)

1. `GeneralLedger` accepts and returns `is_cleared`, `klass_name`, `dept_name`, `split_acc`, `rbal_nat_amount` in `columns=`, and returns the cleared values as R / C / blank. If `is_cleared` is not available on GeneralLedger, fall back to one `TransactionList` call joined on `key` (already proven in `pullCloseData`), adding one call per chunk.
2. The GL `txn_type` text and the transaction id cell produce the **same `txn_key`** as `qbo_transactions` / `transaction_questions` for the same transaction (for example "Bill Payment (Check)" vs "BillPayment", Journal Entry, Deposit, Transfer). If they differ, the function maps through a normalizer, or flags and questions use a new `line`-based key. This decides whether existing questions link to flags.
3. Too-large-report behavior and the exact error on a big ledger, to confirm the halving rule.
4. `Vendor1099` returned on the Vendor query; whether `TaxIdentifier` is returned.
5. Two simultaneous token refreshes against one connection (3.2) do not strand the connection.
6. A company with no classes and no locations returns a column set without those columns (the `class_tracking: false` path).
7. Whether an oversized GL report errors or silently truncates (2.2), and how to detect truncation.

---

## 12. Build order and checklist

**Phase 1 (plan step 2)**: migrations 1 to 4 and the profile columns; `_shared/qbo.ts`; `qbo-gl-review`; `gl-review-send`; `components/ledger/*`; Close step and card; tab; Review a file; settings. Start saving fingerprints from the first pull.

Same-commit upkeep (standing rules): staff guide article and the "What's new", role tours, staff tips (tip targets that point at the Close tab/tab row), help menus, README, Dev Tools (`MGB_VERSION`, infra links, flags, reset keys, `PAGE_META`), Usage Stats page meta; `CLOSE_CHECKLIST` count wherever it appears; `TxnQuestions`/Inbox/`ClientTabCounts` direction filters; the `qbo-sync` header gets a pointer to `qbo-gl-review`.

Tests: pure-function tests for the parser (CSV, XLSX, debit/credit, per-row account column, `(1,234.56)`, Excel dates, Beginning Balance/Total/footer rows, missing header), each check (triggers, and a non-trigger fixture), the sample ledger counts (suspense 2, dup 2, obe 1, large 1, gap 1, jecash 1, weekend 10 to 5 after dedupe, round 6, blank 2), the fingerprint hash (stable under reorder and float noise), flag upsert never reopening a cleared flag, and the quote math. RLS tests per section 10. Edge function tests against the sandbox.

Phases 2 to 5 as in PLAN.md. This spec adds no schema for any of them except as noted in 9.4 (the scheduled auto-tune job).

---

## 13. Decisions confirmed by the owner (2026-10-14)

1. **Warn only** for the "Ledger reviewed" step (`done_gate` = `warn`); block stays available as a setting.
2. The three deviations in 0.2 are approved (sign-off table; greeting name and contact email on `client_profile`; `transaction_questions` direction change).
3. Client emails may carry the question text and one amount (3.3). Update the notification-emails rule note accordingly when building.
4. An admin cannot approve their own review unless a logged override is used (as specced in 4.4).
5. Saved quotes for prospects who never sign are auto-archived after **90 days** (delete on request). Bailley reviews both the three summary templates (clean / minor items / needs action) and the starting vendor watch list before they ship.

Remaining open items are the live-QuickBooks checks in section 11, which are verified during the build.
