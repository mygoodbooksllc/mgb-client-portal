# Team Reviews: comparison lock until the meeting (spec)

Owner, 2026-10-21: "just the bookkeepers should not see the comparison. all admin
can see both sides. jesse will need the comparison to prep for the meeting. he
needs to be notified once the bookkeepers submit their side, then he completes
his side, then the comparison unlocks for the reviewer immediately, bookkeeper is
then notified that both sides are complete and they need to set up a meeting
time with jesse. jesse reveals the comparison in meeting. jesse needs an unlock
button and bailley."

## Rule

| Who | Before both are in | Both in, not revealed | Revealed |
| --- | --- | --- | --- |
| Reviewee (any role, admins too) | own form | own form + "Both sides complete, set up a time with {reviewer}" | full comparison, steps, sign |
| Reviewer | own form | full comparison (prep), add steps, **Reveal** | full, sign |
| Other admins | both sides live, drafts too | full comparison, add steps | full |
| Revealer list (Jesse, Bailley) | as admins | as admins + **Reveal** | full |

"Revealed" = `reviews.revealed_at is not null` **or** `status = 'signed'`
(`tr_review_revealed(reviews)`). Signed reviews count as revealed by
definition, so no existing row is updated (Bailley's signed test review
`83707247` stays untouched). Reveal is one-way: nothing can clear it.

## Data

- `reviews.revealed_at timestamptz`, `reviews.revealed_by uuid` (additive).
- `review_settings.revealer_emails text[]`, seeded `jesse@`, `bailley@`.
- `review_events.kind` gains `reveal` (check constraint replaced, superset).
- `tr_reviews_guard`: `revealed_at/by` may be set once, even on a locked
  (closed_unsigned) row; changing or clearing them is refused on every row.

## RPCs (all SECURITY DEFINER, enforced in the database)

- `tr_reveal_comparison(p_review)`: caller is an active admin, not the reviewee,
  and is the review's reviewer or in `revealer_emails`. Both forms submitted,
  status `comparing` or `closed_unsigned`. Sets revealed_at/by, writes a
  `reveal` event. Already revealed: no-op. No email (they're in the meeting).
- `tr_can_see_submission`: new 9-arg version with `p_revealed`. The reviewee
  sees the other side only when revealed. The old 8-arg version now calls it
  with `false` (fails closed if anything still uses it).
- `tr_submission_json`, `tr_get_review`: pass revealed. For a reviewee before
  reveal, `requires_action_step`, `steps`, `signatures`, `addenda` are empty and
  `comparison_locked = true`. New keys `revealed`, `revealed_at`,
  `revealed_by_name`, `can_reveal`, `comparison_locked`. Events list `reveal`.
- `tr_require_editable`: the reviewee can't edit steps or comments before
  reveal; reviewer and admins can prep steps.
- `tr_set_action_step_status`: reviewee only after reveal.
- `tr_save_recipient_comments`: inherits the editable rule.
- `tr_sign`: both signers only after reveal.
- `tr_save_submission`: when both are in, the reviewer gets
  `comparison_ready` (prep wording); the reviewee gets `both_complete` (meeting
  wording, no "results are ready"). If already revealed (resubmit after a
  reopen) the reviewee gets `comparison_ready`.
- `tr_my_overview`: `my_review.revealed/both_submitted`; due items `meet`
  (reviewee) and `reveal` (reviewer) replace `sign` until reveal;
  `last_totals` and `open_steps` only from revealed reviews (carried steps stay).
- `tr_history`: own scores and step counts only from revealed reviews.
- `tr_team_status`: `manager_total` via the new rule; year averages leave out
  the viewer's own unrevealed review; rows carry `revealed`.
- `tr_queue_reminders`: `todo.meet` / `todo.reveal` before reveal, `sign` after.
- `tr_year_doc`: quarter totals only for revealed reviews.
- `staff_performance`: the review component only uses revealed reviews, except
  an admin looking at someone else.
- RLS `action_steps`: own rows only when the review is revealed or the step was
  carried in; admins see others' rows.

## Edge function (team-reviews)

- New `both_complete` email (meeting.ts, pure + tested); only to the reviewee.
- `comparison_ready` to the reviewee renders the meeting email unless the
  review is revealed at send time (covers any old queued row).
- Reminder todos `meet` and `reveal`; wording updates in `review_assigned`,
  `cycle_opened`, `self_review_submitted`.
- PDF stays signed-only (`tr_review_doc`), year PDF uses `tr_year_doc`.

## Leak hunt (self-critique)

- Realtime: no review table is in `supabase_realtime`. OK.
- Direct table reads: `review_submissions`, `review_signatures`,
  `review_events`, `review_addenda`, `review_notifications` have no grants.
  `reviews` row (own) shows status/revealed_at only. `action_steps` tightened.
- Notification bodies: no scores in any pre-lock email; the reviewee's
  both-complete email names the reviewer only.
- Audit rows: events are only read through `tr_get_review`; reopen reasons are
  admin text the reviewee already saw before this change.
- Lists/search: `tr_my_overview`, `tr_history`, `tr_team_status`,
  `staff_performance`, `tr_year_doc` covered. `wb_inbox` doesn't read reviews.
  The staff guide search has no review data.
- "Requires action step" flag leaks a low manager rating: hidden pre-reveal.
- Admin reviewee (Bailley): checked before the admin branch, so no live view of
  her own review and she can't reveal her own.
- Reopen after reveal: reveal stays; the reopened form is hidden until it is
  resubmitted (submitted-only rule), then visible again.
- Cycle close before reveal: becomes closed_unsigned, still unrevealed; the
  reviewer or a revealer can reveal it later.

## Q3 2026 (cycle 88f571cf)

Five reviews open with only the self-review in; Bailley's is signed. Rows that
change state: **0** (no review has both sides in and is unsigned).
