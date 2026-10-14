-- Budget approval is locked to admins and the client's full-access contacts,
-- workflow names come from the signed-in user, and client-tool notes and
-- comments are soft deleted (2026-10-14).
--
-- NOTE: the "Second pass" section at the end of this file is the current
-- rule. The owner later chose: active MyGoodBooks admins OR the client's own
-- active full-access contacts approve (can_approve_client_budget); non-admin
-- staff and limited contacts can't. The second pass also adds the Opus
-- review fixes. Where the text below says "admin only", read the second pass.
--
-- Last two items of the author-spoofing series (client-messages-author-
-- stamp.sql, client-tools-author-stamp.sql, client-users-invite-actor.sql).
-- Owner decisions (final, 2026-10-14):
--   (A) Only active MyGoodBooks admins may approve a budget. "Submitted by",
--       "Approved by" / "Changes requested by" and the close checklist's
--       "Done by" come from the signed-in identity, never the browser.
--   (B) Notes and comments are soft deleted (who deleted and when are
--       recorded) instead of hard deleted. Author or admin may delete.
--
-- (A) Budget drafts (public.client_budget_drafts). Before this, any staff
-- member with access to the client, or any client contact of the org,
-- could set status = 'approved' and write submitted_by / decided_by as any
-- email through the API (the UI let staff and full-access contacts approve).
-- New BEFORE INSERT OR UPDATE trigger client_budget_drafts_guard:
--   - Signed in (a JWT email, or JWT role authenticated/anon):
--       * moving into 'approved' (insert or update) needs
--         public.is_active_staff_admin(), else error 42501;
--       * any change to a row that is already 'approved' needs an admin
--         (no editing lines under an approval; reopening an approved budget
--         is the admin's call);
--       * submitted_by / submitted_by_name / submitted_at,
--         decided_by / decided_by_name / decided_at are frozen. They are
--         stamped from the JWT only on a status change: into 'submitted'
--         (decided_* cleared), into 'approved' or 'changes_requested';
--       * updated_by := the JWT email.
--     Name: staff.name when the email is staff (canonical, see
--     staff-name-canonical.sql; staff email wins), else the client_users
--     name for that client, else staff -> the email, client -> null.
--   - Not signed in (service role, SQL editor, cron): values kept as sent.
--   Who may submit and request changes is unchanged (anyone who can use the
--   client's tools; the UI still limits deciding to staff and full-access
--   contacts). New columns submitted_by_name, decided_by_name (nullable).
--   History (client_budget_draft_history): a signed-in non-admin can't
--   insert an 'approved' history row (client_budget_history_guard).
--   Grants: authenticated loses DELETE (the app never deletes drafts, and a
--   non-admin could otherwise remove an approved budget) and TRUNCATE /
--   TRIGGER / REFERENCES.
--
-- (A) Close checklist (public.client_close_items): done_by took the email
-- from the browser. New BEFORE INSERT OR UPDATE trigger
-- client_close_items_stamp_done: signed in, ticking stamps done_by (JWT
-- email), done_by_name (staff.name, else the email) and done_at (now());
-- a row that stays ticked keeps its original stamp; unticking clears all
-- three. No JWT: values kept as sent. New column done_by_name. authenticated
-- loses DELETE (the app only upserts) and TRUNCATE / TRIGGER / REFERENCES.
--
-- (B) Soft delete for client_internal_notes, client_budget_comments and
-- client_variance_notes:
--   - New nullable columns deleted_at, deleted_by_email.
--   - authenticated loses DELETE on all three. Deleting goes through
--     security-definer RPCs that stamp deleted_by_email from the JWT:
--       delete_client_internal_note(p_id uuid)
--       delete_client_budget_comment(p_id uuid)
--       delete_client_variance_note(p_client_id, p_period, p_category)
--     Allowed: the note's author (author_email = JWT email) or an active
--     admin, and only for someone who can see the note (staff with access
--     for internal notes, can_use_client_tools for the other two).
--   - BEFORE INSERT OR UPDATE trigger client_tools_guard_soft_delete
--     (fires before client_tools_stamp_author): signed-in users can't set
--     deleted_at / deleted_by_email themselves (only the RPCs can). One
--     exception: client_variance_notes is one note per (client, period,
--     category) written by upsert, so writing new text onto a deleted
--     one revives it (deleted_* cleared, author re-stamped; this replaces
--     the deleted text, the same as editing a note always has). Writing
--     the same text back does not revive it.
--   - Hidden from readers: internal notes and budget comments get split
--     RLS policies whose SELECT hides deleted rows from everyone but active
--     admins (admins can still see them through the API); every app query
--     also filters deleted_at is null. Variance notes keep their single
--     policy (an upsert onto a hidden row would fail RLS) and the app
--     queries filter deleted_at is null. No edge function or database
--     function reads these tables (verified 2026-10-14).
--   - client_tools_stamp_author is redefined (same as
--     client-tools-author-stamp.sql) plus: a revived variance note
--     re-stamps its author.
--
-- Existing rows are not rewritten (new columns are null; triggers only act
-- on later writes).
--
-- Depends on (verified live 2026-10-14): public.client_budget_drafts,
-- public.client_budget_draft_history, public.client_budget_comments,
-- public.client_variance_notes (pro-budget-reports.sql),
-- public.client_internal_notes, public.client_close_items
-- (staff-client-tools.sql), client-tools-author-stamp.sql (trigger
-- client_tools_stamp_author), public.staff (email, name), public.client_users
-- (email, client_id, name), public.is_active_staff(),
-- public.is_active_staff_admin(), public.can_access_client(text),
-- public.can_use_client_tools(text), auth.jwt().
-- Safe to re-run. Applied to production 2026-10-14.

begin;

-- ---------------------------------------------------------------------------
-- 0. Columns
-- ---------------------------------------------------------------------------
alter table public.client_budget_drafts add column if not exists submitted_by_name text;
alter table public.client_budget_drafts add column if not exists decided_by_name text;
alter table public.client_close_items add column if not exists done_by_name text;
alter table public.client_internal_notes add column if not exists deleted_at timestamptz;
alter table public.client_internal_notes add column if not exists deleted_by_email text;
alter table public.client_budget_comments add column if not exists deleted_at timestamptz;
alter table public.client_budget_comments add column if not exists deleted_by_email text;
alter table public.client_variance_notes add column if not exists deleted_at timestamptz;
alter table public.client_variance_notes add column if not exists deleted_by_email text;

-- ---------------------------------------------------------------------------
-- Shared: the signed-in person's display name (staff canonical first)
-- ---------------------------------------------------------------------------
create or replace function public.mgb_jwt_display_name(p_client_id text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text := nullif(btrim(auth.jwt() ->> 'email'), '');
  v_is_staff boolean;
  v_name text;
begin
  if v_email is null then
    return null;
  end if;
  select true, nullif(btrim(s.name), '') into v_is_staff, v_name
    from staff s
   where lower(s.email) = lower(v_email)
   order by (s.email = v_email) desc
   limit 1;
  if coalesce(v_is_staff, false) then
    return left(coalesce(v_name, v_email), 120);
  end if;
  if p_client_id is not null then
    select nullif(btrim(cu.name), '') into v_name
      from client_users cu
     where lower(cu.email) = lower(v_email)
       and cu.client_id = p_client_id
     order by (cu.email = v_email) desc
     limit 1;
  end if;
  return left(v_name, 120);
end;
$$;

revoke all on function public.mgb_jwt_display_name(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Budget drafts: admin-only approval, stamped workflow names
-- ---------------------------------------------------------------------------
create or replace function public.client_budget_drafts_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := nullif(btrim(auth.jwt() ->> 'email'), '');
  v_role text := coalesce(auth.jwt() ->> 'role', '');
  v_name text;
  v_admin boolean;
begin
  if not (v_email is not null or v_role in ('authenticated', 'anon')) then
    return new;  -- trusted backend: keep what was sent
  end if;
  v_admin := public.is_active_staff_admin();
  v_name := public.mgb_jwt_display_name(new.client_id);

  if tg_op = 'UPDATE' then
    if old.status = 'approved' and not v_admin then
      raise exception 'This budget is approved. Only an admin can change or reopen it.'
        using errcode = '42501';
    end if;
    new.submitted_by := old.submitted_by;
    new.submitted_by_name := old.submitted_by_name;
    new.submitted_at := old.submitted_at;
    new.decided_by := old.decided_by;
    new.decided_by_name := old.decided_by_name;
    new.decided_at := old.decided_at;
  else
    new.submitted_by := null;
    new.submitted_by_name := null;
    new.submitted_at := null;
    new.decided_by := null;
    new.decided_by_name := null;
    new.decided_at := null;
  end if;

  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved')
     and not v_admin then
    raise exception 'Only an admin can approve a budget.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'submitted' then
      new.submitted_by := v_email;
      new.submitted_by_name := v_name;
      new.submitted_at := now();
      new.decided_by := null;
      new.decided_by_name := null;
      new.decided_at := null;
    elsif new.status in ('approved', 'changes_requested') then
      new.decided_by := v_email;
      new.decided_by_name := v_name;
      new.decided_at := now();
    end if;
  end if;

  new.updated_by := v_email;
  return new;
end;
$$;

revoke all on function public.client_budget_drafts_guard() from public, anon, authenticated;

drop trigger if exists client_budget_drafts_guard on public.client_budget_drafts;
create trigger client_budget_drafts_guard
  before insert or update on public.client_budget_drafts
  for each row execute function public.client_budget_drafts_guard();

create or replace function public.client_budget_history_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved'
     and (nullif(btrim(auth.jwt() ->> 'email'), '') is not null
          or coalesce(auth.jwt() ->> 'role', '') in ('authenticated', 'anon'))
     and not public.is_active_staff_admin() then
    raise exception 'Only an admin can approve a budget.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.client_budget_history_guard() from public, anon, authenticated;

drop trigger if exists client_budget_history_guard on public.client_budget_draft_history;
create trigger client_budget_history_guard
  before insert on public.client_budget_draft_history
  for each row execute function public.client_budget_history_guard();

revoke delete, truncate, trigger, references on public.client_budget_drafts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Close checklist: done_by / done_by_name / done_at from the JWT
-- ---------------------------------------------------------------------------
create or replace function public.client_close_items_stamp_done()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := nullif(btrim(auth.jwt() ->> 'email'), '');
  v_role text := coalesce(auth.jwt() ->> 'role', '');
begin
  if not (v_email is not null or v_role in ('authenticated', 'anon')) then
    return new;  -- trusted backend
  end if;
  if coalesce(new.done, false) then
    if tg_op = 'UPDATE' and coalesce(old.done, false) then
      new.done_by := old.done_by;
      new.done_by_name := old.done_by_name;
      new.done_at := old.done_at;
    else
      new.done_by := v_email;
      new.done_by_name := public.mgb_jwt_display_name(new.client_id);
      new.done_at := now();
    end if;
  else
    new.done_by := null;
    new.done_by_name := null;
    new.done_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.client_close_items_stamp_done() from public, anon, authenticated;

drop trigger if exists client_close_items_stamp_done on public.client_close_items;
create trigger client_close_items_stamp_done
  before insert or update on public.client_close_items
  for each row execute function public.client_close_items_stamp_done();

revoke delete, truncate, trigger, references on public.client_close_items from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Soft delete: guard trigger
-- ---------------------------------------------------------------------------
create or replace function public.client_tools_guard_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_signed_in boolean := nullif(btrim(auth.jwt() ->> 'email'), '') is not null
                         or coalesce(auth.jwt() ->> 'role', '') in ('authenticated', 'anon');
  v_rpc boolean := coalesce(current_setting('mgb.soft_delete', true), '') = 'on';
begin
  if tg_table_name not in ('client_internal_notes', 'client_budget_comments',
                           'client_variance_notes') then
    raise exception 'client_tools_guard_soft_delete: unexpected table %', tg_table_name;
  end if;
  if v_rpc or not v_signed_in then
    return new;  -- the delete RPCs, or a trusted backend
  end if;
  if tg_op = 'INSERT' then
    new.deleted_at := null;
    new.deleted_by_email := null;
    return new;
  end if;
  -- Writing new text onto a deleted variance note revives it (upsert on the
  -- same key). Same text doesn't, so nobody can simply undelete a note.
  -- (Nested IF: plpgsql resolves new.note even when the table test is false.)
  if tg_table_name = 'client_variance_notes' and old.deleted_at is not null then
    if new.note is distinct from old.note then
      new.deleted_at := null;
      new.deleted_by_email := null;
      return new;
    end if;
  end if;
  new.deleted_at := old.deleted_at;
  new.deleted_by_email := old.deleted_by_email;
  return new;
end;
$$;

revoke all on function public.client_tools_guard_soft_delete() from public, anon, authenticated;

drop trigger if exists client_tools_guard_soft_delete on public.client_internal_notes;
create trigger client_tools_guard_soft_delete
  before insert or update on public.client_internal_notes
  for each row execute function public.client_tools_guard_soft_delete();

drop trigger if exists client_tools_guard_soft_delete on public.client_budget_comments;
create trigger client_tools_guard_soft_delete
  before insert or update on public.client_budget_comments
  for each row execute function public.client_tools_guard_soft_delete();

drop trigger if exists client_tools_guard_soft_delete on public.client_variance_notes;
create trigger client_tools_guard_soft_delete
  before insert or update on public.client_variance_notes
  for each row execute function public.client_tools_guard_soft_delete();

-- ---------------------------------------------------------------------------
-- 4. Author stamp: same as client-tools-author-stamp.sql, plus a revived
--    variance note re-stamps its author
-- ---------------------------------------------------------------------------
create or replace function public.client_tools_stamp_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jwt_email text := nullif(btrim(auth.jwt() ->> 'email'), '');
  v_jwt_role text := coalesce(auth.jwt() ->> 'role', '');
  v_signed_in boolean;
  v_history boolean := tg_table_name = 'client_budget_draft_history';
  v_old_email text;
  v_old_name text;
  v_email text;
  v_name text;
  v_is_staff boolean;
  v_restamp boolean := false;
begin
  if tg_table_name not in ('client_internal_notes', 'client_budget_comments',
                           'client_variance_notes', 'client_budget_draft_history') then
    raise exception 'client_tools_stamp_author: unexpected table %', tg_table_name;
  end if;
  v_signed_in := v_jwt_email is not null or v_jwt_role in ('authenticated', 'anon');

  if tg_op = 'UPDATE' then
    if v_history then
      v_old_email := old.changed_by;
      v_old_name := old.changed_by_name;
    else
      v_old_email := old.author_email;
      v_old_name := old.author_name;
    end if;
    -- (Nested IF: plpgsql resolves new.note even when the table test is false.)
    if tg_table_name = 'client_variance_notes' and v_signed_in then
      v_restamp := (new.note, new.category, new.period, new.client_id)
                   is distinct from (old.note, old.category, old.period, old.client_id)
                   or (old.deleted_at is not null and new.deleted_at is null);
    end if;
    if not v_restamp then
      if v_history then
        new.changed_by := v_old_email;
        new.changed_by_name := v_old_name;
      else
        new.author_email := v_old_email;
        new.author_name := v_old_name;
      end if;
      return new;
    end if;
  end if;

  if v_signed_in then
    v_email := v_jwt_email;
    if v_email is not null then
      select true, nullif(btrim(s.name), '') into v_is_staff, v_name
        from staff s
       where lower(s.email) = lower(v_email)
       order by (s.email = v_email) desc
       limit 1;
      if coalesce(v_is_staff, false) then
        v_name := coalesce(v_name, v_email);
      elsif tg_table_name <> 'client_internal_notes' then
        select nullif(btrim(cu.name), '') into v_name
          from client_users cu
         where lower(cu.email) = lower(v_email)
           and cu.client_id = new.client_id
         order by (cu.email = v_email) desc
         limit 1;
      end if;
    end if;
  else
    if v_history then
      v_email := new.changed_by;
      v_name := new.changed_by_name;
    else
      v_email := new.author_email;
      v_name := new.author_name;
    end if;
  end if;

  v_name := left(v_name, 120);
  if v_history then
    new.changed_by := v_email;
    new.changed_by_name := v_name;
  else
    new.author_email := v_email;
    new.author_name := v_name;
  end if;
  return new;
end;
$$;

revoke all on function public.client_tools_stamp_author() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Soft delete RPCs (author or active admin)
-- ---------------------------------------------------------------------------
create or replace function public.delete_client_internal_note(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := nullif(btrim(auth.jwt() ->> 'email'), '');
  r record;
begin
  if v_email is null then
    raise exception 'Sign in to delete a note.' using errcode = '42501';
  end if;
  select client_id, author_email, deleted_at into r
    from client_internal_notes where id = p_id for update;
  if not found or r.deleted_at is not null
     or not (public.is_active_staff() and public.can_access_client(r.client_id)) then
    raise exception 'That note was not found.' using errcode = 'P0002';
  end if;
  if lower(coalesce(r.author_email, '')) <> lower(v_email) and not public.is_active_staff_admin() then
    raise exception 'Only the person who wrote this note or an admin can delete it.'
      using errcode = '42501';
  end if;
  perform set_config('mgb.soft_delete', 'on', true);
  update client_internal_notes
     set deleted_at = now(), deleted_by_email = v_email
   where id = p_id;
  perform set_config('mgb.soft_delete', '', true);
end;
$$;

create or replace function public.delete_client_budget_comment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := nullif(btrim(auth.jwt() ->> 'email'), '');
  r record;
begin
  if v_email is null then
    raise exception 'Sign in to delete a comment.' using errcode = '42501';
  end if;
  select client_id, author_email, deleted_at into r
    from client_budget_comments where id = p_id for update;
  if not found or r.deleted_at is not null or not public.can_use_client_tools(r.client_id) then
    raise exception 'That comment was not found.' using errcode = 'P0002';
  end if;
  if lower(coalesce(r.author_email, '')) <> lower(v_email) and not public.is_active_staff_admin() then
    raise exception 'Only the person who wrote this comment or an admin can delete it.'
      using errcode = '42501';
  end if;
  perform set_config('mgb.soft_delete', 'on', true);
  update client_budget_comments
     set deleted_at = now(), deleted_by_email = v_email
   where id = p_id;
  perform set_config('mgb.soft_delete', '', true);
end;
$$;

create or replace function public.delete_client_variance_note(
  p_client_id text, p_period text, p_category text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := nullif(btrim(auth.jwt() ->> 'email'), '');
  r record;
begin
  if v_email is null then
    raise exception 'Sign in to delete a note.' using errcode = '42501';
  end if;
  select author_email, deleted_at into r
    from client_variance_notes
   where client_id = p_client_id and period = p_period and category = p_category
   for update;
  if not found or r.deleted_at is not null or not public.can_use_client_tools(p_client_id) then
    raise exception 'That note was not found.' using errcode = 'P0002';
  end if;
  if lower(coalesce(r.author_email, '')) <> lower(v_email) and not public.is_active_staff_admin() then
    raise exception 'Only the person who wrote this note or an admin can delete it.'
      using errcode = '42501';
  end if;
  perform set_config('mgb.soft_delete', 'on', true);
  update client_variance_notes
     set deleted_at = now(), deleted_by_email = v_email
   where client_id = p_client_id and period = p_period and category = p_category;
  perform set_config('mgb.soft_delete', '', true);
end;
$$;

revoke all on function public.delete_client_internal_note(uuid) from public, anon;
revoke all on function public.delete_client_budget_comment(uuid) from public, anon;
revoke all on function public.delete_client_variance_note(text, text, text) from public, anon;
grant execute on function public.delete_client_internal_note(uuid) to authenticated;
grant execute on function public.delete_client_budget_comment(uuid) to authenticated;
grant execute on function public.delete_client_variance_note(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Grants and read policies
-- ---------------------------------------------------------------------------
revoke delete on public.client_internal_notes from anon, authenticated;
revoke delete on public.client_budget_comments from anon, authenticated;
revoke delete on public.client_variance_notes from anon, authenticated;

drop policy if exists "staff manage internal notes" on public.client_internal_notes;
drop policy if exists "staff read internal notes" on public.client_internal_notes;
drop policy if exists "staff add internal notes" on public.client_internal_notes;
create policy "staff read internal notes" on public.client_internal_notes
  for select using (public.is_active_staff() and public.can_access_client(client_id)
                    and (deleted_at is null or public.is_active_staff_admin()));
create policy "staff add internal notes" on public.client_internal_notes
  for insert with check (public.is_active_staff() and public.can_access_client(client_id));

drop policy if exists "client tools budget comments" on public.client_budget_comments;
drop policy if exists "client tools budget comments read" on public.client_budget_comments;
drop policy if exists "client tools budget comments add" on public.client_budget_comments;
create policy "client tools budget comments read" on public.client_budget_comments
  for select using (public.can_use_client_tools(client_id)
                    and (deleted_at is null or public.is_active_staff_admin()));
create policy "client tools budget comments add" on public.client_budget_comments
  for insert with check (public.can_use_client_tools(client_id));

commit;

-- ===========================================================================
-- Second pass (2026-10-14, same day): owner picked "staff admins plus the
-- client's own full-access contacts approve", and the Opus review fixes.
-- The functions below replace the versions earlier in this file.
--   - can_approve_client_budget(client_id): active staff admin, or an active
--     client_users row for that client with access = 'full'. Non-admin staff
--     and limited (scoped) contacts can't approve. Used by both budget guards.
--   - Budget drafts: a signed-in user can't change client_id or fiscal_year.
--   - Close items: moving a ticked row to another client/period/item
--     re-stamps Done by.
--   - Variance notes: signed-in users can't change the key (client, period,
--     category); changing a live note's text needs its author or an admin;
--     writing new text onto a deleted note revives it and first copies the
--     deleted version to client_variance_note_tombstones (admin read only).
--   - Variance notes' SELECT hides deleted rows from non-admins (admins can
--     still read them). The app saves through save_client_variance_note()
--     (security definer, so the upsert can reach a hidden deleted row; the
--     triggers still apply the rules above with the caller's JWT).
-- ===========================================================================
begin;

create or replace function public.can_approve_client_budget(p_client_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_staff_admin()
      or exists (
        select 1 from client_users cu
         where lower(cu.email) = lower(nullif(btrim(auth.jwt() ->> 'email'), ''))
           and cu.client_id = p_client_id
           and cu.active
           and cu.access = 'full'
      );
$$;
revoke all on function public.can_approve_client_budget(text) from public, anon;
grant execute on function public.can_approve_client_budget(text) to authenticated;

create or replace function public.client_budget_drafts_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := nullif(btrim(auth.jwt() ->> 'email'), '');
  v_role text := coalesce(auth.jwt() ->> 'role', '');
  v_name text;
  v_ok boolean;
begin
  if not (v_email is not null or v_role in ('authenticated', 'anon')) then
    return new;  -- trusted backend: keep what was sent
  end if;
  v_ok := public.can_approve_client_budget(new.client_id);
  v_name := public.mgb_jwt_display_name(new.client_id);

  if tg_op = 'UPDATE' then
    if (new.client_id, new.fiscal_year) is distinct from (old.client_id, old.fiscal_year) then
      raise exception 'A budget can''t be moved to another organization or year.'
        using errcode = '42501';
    end if;
    if old.status = 'approved' and not v_ok then
      raise exception 'This budget is approved. Only an admin or the organization''s full-access contact can change or reopen it.'
        using errcode = '42501';
    end if;
    new.submitted_by := old.submitted_by;
    new.submitted_by_name := old.submitted_by_name;
    new.submitted_at := old.submitted_at;
    new.decided_by := old.decided_by;
    new.decided_by_name := old.decided_by_name;
    new.decided_at := old.decided_at;
  else
    new.submitted_by := null;
    new.submitted_by_name := null;
    new.submitted_at := null;
    new.decided_by := null;
    new.decided_by_name := null;
    new.decided_at := null;
  end if;

  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved')
     and not v_ok then
    raise exception 'Only an admin or the organization''s full-access contact can approve a budget.'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'submitted' then
      new.submitted_by := v_email;
      new.submitted_by_name := v_name;
      new.submitted_at := now();
      new.decided_by := null;
      new.decided_by_name := null;
      new.decided_at := null;
    elsif new.status in ('approved', 'changes_requested') then
      new.decided_by := v_email;
      new.decided_by_name := v_name;
      new.decided_at := now();
    end if;
  end if;

  new.updated_by := v_email;
  return new;
end;
$$;
revoke all on function public.client_budget_drafts_guard() from public, anon, authenticated;

create or replace function public.client_budget_history_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved'
     and (nullif(btrim(auth.jwt() ->> 'email'), '') is not null
          or coalesce(auth.jwt() ->> 'role', '') in ('authenticated', 'anon'))
     and not public.can_approve_client_budget(new.client_id) then
    raise exception 'Only an admin or the organization''s full-access contact can approve a budget.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.client_budget_history_guard() from public, anon, authenticated;

create or replace function public.client_close_items_stamp_done()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := nullif(btrim(auth.jwt() ->> 'email'), '');
  v_role text := coalesce(auth.jwt() ->> 'role', '');
begin
  if not (v_email is not null or v_role in ('authenticated', 'anon')) then
    return new;  -- trusted backend
  end if;
  if coalesce(new.done, false) then
    if tg_op = 'UPDATE' and coalesce(old.done, false)
       and (new.client_id, new.period, new.item_key)
           is not distinct from (old.client_id, old.period, old.item_key) then
      new.done_by := old.done_by;
      new.done_by_name := old.done_by_name;
      new.done_at := old.done_at;
    else
      new.done_by := v_email;
      new.done_by_name := public.mgb_jwt_display_name(new.client_id);
      new.done_at := now();
    end if;
  else
    new.done_by := null;
    new.done_by_name := null;
    new.done_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.client_close_items_stamp_done() from public, anon, authenticated;

create table if not exists public.client_variance_note_tombstones (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  period text not null,
  category text not null,
  note text,
  author_email text,
  author_name text,
  updated_at timestamptz,
  deleted_at timestamptz,
  deleted_by_email text,
  replaced_at timestamptz not null default now(),
  replaced_by_email text
);
alter table public.client_variance_note_tombstones enable row level security;
revoke all on public.client_variance_note_tombstones from public, anon, authenticated;
grant select on public.client_variance_note_tombstones to authenticated;
drop policy if exists "admins read variance note tombstones" on public.client_variance_note_tombstones;
create policy "admins read variance note tombstones" on public.client_variance_note_tombstones
  for select using (public.is_active_staff_admin());

create or replace function public.client_tools_guard_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := nullif(btrim(auth.jwt() ->> 'email'), '');
  v_signed_in boolean := nullif(btrim(auth.jwt() ->> 'email'), '') is not null
                         or coalesce(auth.jwt() ->> 'role', '') in ('authenticated', 'anon');
  v_rpc boolean := coalesce(current_setting('mgb.soft_delete', true), '') = 'on';
begin
  if tg_table_name not in ('client_internal_notes', 'client_budget_comments',
                           'client_variance_notes') then
    raise exception 'client_tools_guard_soft_delete: unexpected table %', tg_table_name;
  end if;
  if v_rpc or not v_signed_in then
    return new;  -- the delete RPCs, or a trusted backend
  end if;
  if tg_op = 'INSERT' then
    new.deleted_at := null;
    new.deleted_by_email := null;
    return new;
  end if;
  -- (Nested IFs: plpgsql resolves new.note even when the table test is false.)
  if tg_table_name = 'client_variance_notes' then
    if (new.client_id, new.period, new.category)
       is distinct from (old.client_id, old.period, old.category) then
      raise exception 'A budget note can''t be moved.' using errcode = '42501';
    end if;
    if new.note is distinct from old.note then
      if old.deleted_at is not null then
        -- New text on a deleted note: keep the deleted version, then revive.
        insert into client_variance_note_tombstones
          (client_id, period, category, note, author_email, author_name, updated_at,
           deleted_at, deleted_by_email, replaced_by_email)
        values (old.client_id, old.period, old.category, old.note, old.author_email,
                old.author_name, old.updated_at, old.deleted_at, old.deleted_by_email, v_email);
        new.deleted_at := null;
        new.deleted_by_email := null;
        return new;
      end if;
      if lower(coalesce(old.author_email, '')) <> lower(coalesce(v_email, ''))
         and not public.is_active_staff_admin() then
        raise exception 'Only the person who wrote this note or an admin can change it.'
          using errcode = '42501';
      end if;
    end if;
  end if;
  new.deleted_at := old.deleted_at;
  new.deleted_by_email := old.deleted_by_email;
  return new;
end;
$$;
revoke all on function public.client_tools_guard_soft_delete() from public, anon, authenticated;

create or replace function public.save_client_variance_note(
  p_client_id text, p_period text, p_category text, p_note text)
returns public.client_variance_notes
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.client_variance_notes;
begin
  if nullif(btrim(auth.jwt() ->> 'email'), '') is null
     or not public.can_use_client_tools(p_client_id) then
    raise exception 'You don''t have access to this organization''s budget.' using errcode = '42501';
  end if;
  insert into client_variance_notes (client_id, period, category, note, updated_at)
  values (p_client_id, p_period, p_category, p_note, now())
  on conflict (client_id, period, category)
  do update set note = excluded.note, updated_at = excluded.updated_at
  returning * into r;
  if r.deleted_at is not null then
    -- Same text as the deleted note: it stays deleted.
    raise exception 'That note was deleted. Change the text to add it again.' using errcode = '42501';
  end if;
  return r;
end;
$$;
revoke all on function public.save_client_variance_note(text, text, text, text) from public, anon;
grant execute on function public.save_client_variance_note(text, text, text, text) to authenticated;

drop policy if exists "client tools variance notes" on public.client_variance_notes;
drop policy if exists "client tools variance notes read" on public.client_variance_notes;
drop policy if exists "client tools variance notes add" on public.client_variance_notes;
drop policy if exists "client tools variance notes change" on public.client_variance_notes;
create policy "client tools variance notes read" on public.client_variance_notes
  for select using (public.can_use_client_tools(client_id)
                    and (deleted_at is null or public.is_active_staff_admin()));
create policy "client tools variance notes add" on public.client_variance_notes
  for insert with check (public.can_use_client_tools(client_id));
create policy "client tools variance notes change" on public.client_variance_notes
  for update using (public.can_use_client_tools(client_id))
  with check (public.can_use_client_tools(client_id));

commit;
