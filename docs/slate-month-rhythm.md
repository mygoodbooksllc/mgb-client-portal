# Slate: the month rhythm (4th, 14th, 24th)

Written 2026-10-20 against `main` at `065edfc`. Build input, additive only. Same fold-in rules
as `docs/slate-differentiators.md`: do not rename, re-scope or reorder anything built or
specced (Phases 1 to 4, Desk D1 to D3, any `TK_` / `tk_` / `wb_` name, route or table).

Owner decisions, 2026-10-20:
- Ship **Option A, "the thirds"** as the default monthly template.
- **Option B** (by client, in close order) is a *view* on top of A's tasks, not a second list.
- **Option C** (by cadence) holds the non-monthly work: Quarterly, Annual, Occasional.
- Each bookkeeper picks A or B per client list, remembered per person.
- **The three dates live in firm settings**, not in each template, so the rhythm can change
  with one edit.

## The workflow (owner's words, structured)

All three parts describe work for the **previous** month. A date that falls on a weekend or
holiday rolls to the next business day (existing `roll: "next"`).

| Part | Day | What happens |
| --- | --- | --- |
| Check in | **4th** | Check in with each client. Ask for any missing documents. |
| Send reports | **14th** | Send reports. If documents were not sent in time, send **preliminary** reports instead. |
| Follow up | **24th** | Check back in with clients who still have not sent what is needed for **full** reports. |

So the 14th has two outcomes per client (full or preliminary), and the 24th only matters for
clients who ended up on preliminary.

## Template rows (replace the 15-item draft in the earlier brainstorm)

Section names are the part labels. Titles are final copy; descriptions and checklists are
suggestions the bookkeeper edits per client.

**Check in (4th)**
1. Check in with the client about last month. *Checklist: anything unusual, new accounts, large purchases, staff changes.*
2. Ask for missing documents. *Creates an Ask client request. Checklist: bank statements, card statements, receipts, payroll reports, loan statements.*
3. Categorize the bank feed through month end. *Close step 1; work that needs no documents.*
4. Note what is still missing. *One line on the client Overview so the 14th knows who is on preliminary.*

**Send reports (14th)**
5. Finish the month with the documents received. *Reconcile banks and cards, post entries, review. Close steps 2 to 5.*
6. Send reports: full if complete, **preliminary** if documents are missing. *Close step 6. A preliminary send is labeled Preliminary and lists what is missing.*

**Follow up (24th)**
7. Follow up on missing documents. *Second request to the client and their other contacts; tell the account manager if it is the second month in a row.*
8. Finish and send full reports once documents arrive. *Replaces the preliminary reports. Then mark the month Ready for sign-off.*

Rows 7 and 8 only apply to a client that was on preliminary. Recommended behavior:
**always create them, and auto-complete both with a note "Nothing outstanding" when the client has
zero open requests on the 24th.** That keeps the task count predictable and lets a bookkeeper
see at a glance which clients did not need a follow-up. (Alternative: do not create them.
Rejected because a missing task is harder to notice than a ticked one.)

## Where the three dates live

`public.tk_settings` already exists (`key` text, `value` jsonb, admin write, every change
audited into `tk_settings_audit`; `supabase/tasks-p2-3-review.sql`). Add one key:

```json
// key: "month_rhythm"
{
  "parts": [
    { "key": "check_in",  "label": "Check in",     "day": 4 },
    { "key": "reports",   "label": "Send reports", "day": 14 },
    { "key": "follow_up", "label": "Follow up",    "day": 24 }
  ],
  "roll": "next"
}
```

Validation: exactly the three part keys, `day` an integer 1 to 28, days strictly ascending,
`roll` one of `next` / `prev` / `none`. Edited by admins only, in Settings next to the other
Tasks settings, with the audit trail already provided.

### How a template points at a part

Templates need to say "the check-in date" rather than "the 4th". The cleanest way is one new
due rule type, resolved from the setting at generation time:

```json
{ "type": "firm_part", "part": "reports", "month_offset": 1 }
```

This is **additive**: no existing rule type changes. It does touch a mirrored validator, so
treat it as a shared-code change:

- JS: `RULE_TYPES` and `dueRuleValid` / `resolveDue` in `components/tasks/TK_recurrenceLogic.js`.
  `resolveDue` gains a `firmParts` argument (the setting), and the `firm_part` branch becomes a
  `day_of_month` resolve using that part's day and the setting's `roll`.
- SQL: `tk_due_rule_valid(jsonb)` and the generator that resolves due dates must accept the
  same type and read `tk_settings`.
- Tests: add vectors to `components/tasks/TK_recurrence.fixtures.js` and the SQL self-check
  that asserts the same vectors, so JS and SQL stay in agreement (the audit's existing rule).

**What changing the setting does:** it applies to tasks generated from then on. Tasks already
generated keep their dates. Offer an admin action "Also move open tasks for this month" only if
the owner asks for it; do not do it silently.

**Fallback with no engine change:** keep rule type `day_of_month` and, when an admin saves the
setting, rewrite the `day` on every template tagged with that part. Simpler, but a fan-out
write across templates; recommended only if touching the validator is unacceptable.

## Option B as a view (not a second list)

Group the same tasks by close step with a **Next** pill on the first unticked step and a
**Waiting on client** pill where a step's documents are missing. Suggestion rules read
`close_checks` and the client's open Ask client requests. Target windows (the part dates) show
as a hint, never red. The per-client A/B choice is a view setting remembered per person
(`mgb_tk_` localStorage key, same pattern as `mgb_wb_hub`), not a data change.

## Option C for everything else

Quarterly, Annual and Occasional items sit under their own headings on every client list, in
the existing section order (`TK_CLIENT_SECTION_ORDER`). Only filings take hard dates, from
`firm_deadlines`, so a filing never has two due dates.

## Build order

1. `tk_settings` key `month_rhythm` plus its Settings editor (admin).
2. `firm_part` rule type in JS and SQL with shared fixtures and tests.
3. Seed the eight monthly templates above (cadence `monthly`, `due_rule` `firm_part`).
4. The 24th auto-complete rule (needs the open-requests count per client).
5. Option B view, then the per-person A/B choice.
6. Option C pre-fill by client type.

## Open questions for the owner

- Is "preliminary" a report status the portal should record (so clients see "Preliminary,
  missing: statement for Operating") or just a label on the email? Recommended: record it.
- Should the 24th follow-up also notify the account manager when a client has been
  preliminary two months running?
- Do any clients get a different rhythm (for example a client billed on a 15th close)? If yes,
  allow a per-client override of the three days; if no, leave the setting firm-wide.
