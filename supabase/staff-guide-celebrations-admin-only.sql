-- staff-guide-celebrations-admin-only.sql
--
-- Owner decision 2026-10-27: celebrations are ADMIN ONLY for now. Withdraws the
-- non-admin 7-day heads-up wording. Built from the live staff_guide text read on
-- 2026-10-27 (md5 of each body_md is checked first; if a live article changed
-- since, the block raises and nothing is written). Replaces only; never
-- deletes. body_plain is generated, never updated.
do $$
declare n int;
begin
  update public.staff_guide set
    body_md = replace(replace(replace(replace(body_md, $x0o$- **Team › People › Celebrations** lists everyone's birthdays and work anniversaries in the next 30 days.
- **Today (everyone else)** gives you a **7-day heads-up** on coworkers' birthdays and work anniversaries, in the **This week** card, for example "Debra Ruffin's birthday, May 27 · in 5 days · give a shout out". Click **Give a shout out** to open the shout-out composer with that teammate already picked. Nothing is sent until you write a note and click **Send shout-out**, and then they get the usual bell notice from [How do I give a teammate a shout-out?](#/help/shoutouts), nothing more. Your own birthday or anniversary shows there too, with no button. These lines never take the Do next spot, and nothing shows a birth year or an age.
$x0o$, $x0n$- **Admins only for now.** Birthdays and work anniversaries are shown to admins only. Bookkeepers, temporary admins and account managers don't see celebrations on Today or in Team › People, and there is no celebration shout-out button. You can still give a teammate a shout-out any time from their profile or the **Shout-outs** card (see [How do I give a teammate a shout-out?](#/help/shoutouts)).
$x0n$), $x1o$- **Today (admins)** shows$x1o$, $x1n$- **Today** shows$x1n$), $x2o$- **Team › People › Celebrations (admins)** lists the same 30 days with the date, days away, years on the team, and a "gift sent" or "dismissed" tag once you have marked one. Everyone else sees the date, and a **Give a shout out** button on anything in the next 7 days (not your own).$x2o$, $x2n$- **Team › People › Celebrations** lists the same 30 days with the date, days away, years on the team, and a "gift sent" or "dismissed" tag once you have marked one.$x2n$), $x3o$- **Weekly digest (admins)**$x3o$, $x3n$- **Weekly digest**$x3n$),
    keywords = array_remove(array_remove(array_remove(keywords, '7 day heads-up'), 'give a shout out'), 'coworker birthday heads-up'),
    updated_at = now()
  where slug = 'celebrations' and md5(body_md) = 'c8e2cd37baa7b91defe7adfc30f311e3';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'celebrations changed since it was read (md5 mismatch)'; end if;

  update public.staff_guide set
    body_md = replace(body_md, $x0o$(everyone gets a 7-day heads-up with a **Give a shout out** button; admins see the next 30 days with the date and days away, so there is time to send a gift, with **Gift sent** and **Dismiss** under each line)$x0o$, $x0n$(admins only: the next 30 days with the date and days away, so there is time to send a gift, with **Gift sent** and **Dismiss** under each line; other staff don't see celebrations)$x0n$),
    updated_at = now()
  where slug = 'home-page' and md5(body_md) = 'a2f0714289daf341e8b5e2b65acc2232';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'home-page changed since it was read (md5 mismatch)'; end if;

  update public.staff_guide set
    body_md = replace(body_md, $x0o$A quick way: when a coworker's birthday or work anniversary is within 7 days, Today's **This week** card and **Team › People › Celebrations** show **Give a shout out**. It opens the same form with them already picked.

$x0o$, $x0n$Admins also get a quick way in from a birthday or work anniversary on Today (**Send shout-out**), which opens the same form with that person already picked.

$x0n$),
    updated_at = now()
  where slug = 'shoutouts' and md5(body_md) = 'bd6246f2dfdd2705237902cc6e0b27b6';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'shoutouts changed since it was read (md5 mismatch)'; end if;

  update public.staff_guide set
    body_md = replace(body_md, $x0o$### 2026-10-27: a 7-day heads-up on coworkers' birthdays and anniversaries
- **Know a few days ahead.** Everyone now sees coworkers' birthdays and work anniversaries **7 days ahead** in **Today** (the **This week** card) and in **Team › People › Celebrations**, with a **Give a shout out** button. It opens the shout-out form with that person already picked; nothing is sent until you write a note and send it, and they get the usual bell notice. Your own day shows with no button. No birth year or age is shown. Admins keep their 30-day view. See [Birthdays, work anniversaries and gift reminders](#/help/celebrations).

$x0o$, $x0n$### 2026-10-27: celebrations are for admins only (for now)
- **Birthdays and work anniversaries are admin only.** Only admins see them now, 30 days ahead on **Today**, in **Team › People › Celebrations** and in the weekly digest. Bookkeepers, temporary admins and account managers no longer see celebration lines, the Celebrations card or a celebration shout-out button, and the short-lived 7-day heads-up for them is withdrawn. Shout-outs themselves are unchanged: anyone can still thank a teammate from **Team › People › Shout-outs** or a profile. See [Birthdays, work anniversaries and gift reminders](#/help/celebrations).

$x0n$),
    updated_at = now()
  where slug = 'whats-new' and md5(body_md) = '6829a74730660793be3e6d5a3f775ee5';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'whats-new changed since it was read (md5 mismatch)'; end if;
end $$;
