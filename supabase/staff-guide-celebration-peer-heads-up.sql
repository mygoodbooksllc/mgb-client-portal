-- staff-guide-celebration-peer-heads-up.sql
--
-- Owner request 2026-10-27: non-admin staff get a 7-day heads-up on coworkers'
-- birthdays and work anniversaries, with a Give a shout out action (the
-- existing shout-out composer). Guide text only. Built from the live
-- staff_guide text read on 2026-10-27 (md5 of each body_md is checked first;
-- if a live article changed since, the block raises and nothing is written).
-- Replaces only; never deletes. body_plain is generated, never updated.
--
-- Applied to production 2026-10-27.
do $$
declare n int;
begin
  update public.staff_guide set
    body_md = replace(replace(body_md, $a$- **Team › People › Celebrations** lists everyone's birthdays and work anniversaries in the next 30 days.
$a$, $a$- **Team › People › Celebrations** lists everyone's birthdays and work anniversaries in the next 30 days.
- **Today (everyone else)** gives you a **7-day heads-up** on coworkers' birthdays and work anniversaries, in the **This week** card, for example "Debra Ruffin's birthday, May 27 · in 5 days · give a shout out". Click **Give a shout out** to open the shout-out composer with that teammate already picked. Nothing is sent until you write a note and click **Send shout-out**, and then they get the usual bell notice from [How do I give a teammate a shout-out?](#/help/shoutouts), nothing more. Your own birthday or anniversary shows there too, with no button. These lines never take the Do next spot, and nothing shows a birth year or an age.
$a$),
      $b$Everyone else sees the date only, with no change.$b$, $b$Everyone else sees the date, and a **Give a shout out** button on anything in the next 7 days (not your own).$b$),
    keywords = array['7 day heads-up','give a shout out','coworker birthday heads-up']::text[] || keywords,
    updated_at = now()
  where slug = 'celebrations' and md5(body_md) = '9607bf899b079e00e6945ad821a55b6b';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'celebrations changed since it was read (md5 mismatch)'; end if;

  update public.staff_guide set
    body_md = replace(body_md, $a$(admins see the next 30 days with the date and days away, so there is time to send a gift; **Gift sent** and **Dismiss** sit under each line)$a$, $a$(everyone gets a 7-day heads-up with a **Give a shout out** button; admins see the next 30 days with the date and days away, so there is time to send a gift, with **Gift sent** and **Dismiss** under each line)$a$),
    updated_at = now()
  where slug = 'home-page' and md5(body_md) = 'f2891b9419f70ca04038bc170bb8495c';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'home-page changed since it was read (md5 mismatch)'; end if;

  update public.staff_guide set
    body_md = replace(body_md, E'### Give one\n', $s$### Give one

A quick way: when a coworker's birthday or work anniversary is within 7 days, Today's **This week** card and **Team › People › Celebrations** show **Give a shout out**. It opens the same form with them already picked.
$s$),
    keywords = array['give a shout out','birthday shout-out','anniversary shout-out']::text[] || keywords,
    updated_at = now()
  where slug = 'shoutouts' and md5(body_md) = '71099ae2b0003da74638d67467bcb075';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'shoutouts changed since it was read (md5 mismatch)'; end if;

  update public.staff_guide set
    body_md = replace(body_md, '### 2026-10-27: client gifts follow the founding date (admins)', $w$### 2026-10-27: a 7-day heads-up on coworkers' birthdays and anniversaries
- **Know a few days ahead.** Everyone now sees coworkers' birthdays and work anniversaries **7 days ahead** in **Today** (the **This week** card) and in **Team › People › Celebrations**, with a **Give a shout out** button. It opens the shout-out form with that person already picked; nothing is sent until you write a note and send it, and they get the usual bell notice. Your own day shows with no button. No birth year or age is shown. Admins keep their 30-day view. See [Birthdays, work anniversaries and gift reminders](#/help/celebrations).

### 2026-10-27: client gifts follow the founding date (admins)$w$),
    keywords = array['birthday heads-up','anniversary heads-up','give a shout out']::text[] || keywords,
    updated_at = now()
  where slug = 'whats-new' and md5(body_md) = '2bee7618ec815acc20c8950d694bc108';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'whats-new changed since it was read (md5 mismatch)'; end if;
end;
$$;
