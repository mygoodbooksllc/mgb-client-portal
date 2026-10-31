-- staff-guide-celebrations-month-ahead.sql
--
-- Owner request 2026-10-27: admins see staff birthdays and work anniversaries
-- a month (30 days) ahead. Guide text only. Built from the live staff_guide
-- text read on 2026-10-27 (md5 of each body_md is checked first; if a live
-- article changed since, the block raises and nothing is written). Upserts and
-- replaces only; never deletes. body_plain is generated, never updated.
--
-- Applied to production 2026-10-27.
do $$
declare n int;
begin
  -- celebrations: whole article
  update public.staff_guide set
    body_md = $cb$Add your **birthday** and **start date** in **Settings › Profile** so the team can celebrate with you. For your birthday you pick just a **month** and a **day**: the portal never asks for the year and never shows an age.

### Your first sign-in

The first time you sign in, Today asks you to finish your profile. **Later** closes the prompt, and a **Complete your profile** item stays on your Today list until both dates are filled in.

### Where celebrations show

- **Team › People › Celebrations** lists everyone's birthdays and work anniversaries in the next 30 days.
- **Today (admins)** shows each one a **month ahead** (30 days), so there is time to plan and send a gift. Each line gives the date, how many days away it is, and, for a birthday, how long the person has been on the team, for example "Debra Ruffin's birthday, May 27 · in 30 days · 3 years on the team". The first week sits at the top of the list as before; later ones are listed lower and never take the Do next spot. The **This week** card shows them with **Gift sent** and **Dismiss** under each line; click the line to send a shout-out. Nothing shows a birth year or an age.
- The three buttons: **Send shout-out** opens the shout-out composer with the teammate already picked, **Gift sent** records that a gift went out, and **Dismiss** hides it for this year. A birthday that is today sits in "needs you now".
- **Weekly digest (admins)** gets a "Coming up" section with the next 30 days: the date, how many days away, and the same "years on the team" note. It also has one line for how many **client anniversaries** are coming up in the next 30 days (when Client gifts is on); plan those in **Team › Client gifts**.
- **Team › People › Celebrations (admins)** lists the same 30 days with the date, days away, years on the team, and a "gift sent" or "dismissed" tag once you have marked one. Everyone else sees the date only, with no change.

### Admins: filling in dates for someone

**HR › Members** has a **Birthday** and a **Start date** column. Pick a month and day for the birthday and a date for the start date, and each saves on its own. **Clear** empties a birthday. Staff can change their own dates in Settings › Profile at any time.
$cb$,
    keywords = array['month ahead','a month ahead','gift lead time']::text[] || keywords,
    updated_at = now()
  where slug = 'celebrations' and md5(body_md) = '791fdef461847bff7eafc5cf077f4266';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'celebrations changed since it was read (md5 mismatch)'; end if;

  -- admin-guide: Today row
  update public.staff_guide set
    body_md = replace(body_md, $a$plus birthdays and work anniversaries a week ahead;$a$, $a$plus birthdays and work anniversaries a month ahead;$a$),
    updated_at = now()
  where slug = 'admin-guide' and md5(body_md) = 'e2eb6d679c32e4a5f1773edce577faba';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'admin-guide changed since it was read (md5 mismatch)'; end if;

  -- home-page: This week card bullet
  update public.staff_guide set
    body_md = replace(body_md, $h$- **This week**: birthdays and work anniversaries coming up (admins; send a shout-out), and$h$, $h$- **This week**: birthdays and work anniversaries coming up (admins see the next 30 days with the date and days away, so there is time to send a gift; **Gift sent** and **Dismiss** sit under each line), and$h$),
    updated_at = now()
  where slug = 'home-page' and md5(body_md) = 'aaae1e314f0e9b53f81bcd1d350fce8c';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'home-page changed since it was read (md5 mismatch)'; end if;

  -- whats-new: new entry above the birthdays entry
  update public.staff_guide set
    body_md = replace(body_md, '### 2026-10-27: birthdays are just a month and day', $w$### 2026-10-27: celebrations a month ahead (admins)
- **Time to plan gifts.** Admins now see staff birthdays and work anniversaries **30 days ahead** (it was 7) on **Today** (the **This week** card, with **Gift sent** and **Dismiss** under each line), in **Team › People › Celebrations**, and in the weekly digest's **Coming up** section (it was 14 days). Each line gives the date, how many days away, and years on the team, for example "Debra Ruffin's birthday, May 27 · in 30 days · 3 years on the team". No birth year or age is shown. Client anniversaries already looked 30 days ahead in **Team › Client gifts** and the digest. Nothing changes for non-admins. See [Birthdays, work anniversaries and gift reminders](#/help/celebrations).

### 2026-10-27: birthdays are just a month and day$w$),
    keywords = array['celebrations a month ahead','gift lead time','birthdays month ahead']::text[] || keywords,
    updated_at = now()
  where slug = 'whats-new' and md5(body_md) = 'e72301990dcdf2c438f76ca0b81e396f';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'whats-new changed since it was read (md5 mismatch)'; end if;
end;
$$;
