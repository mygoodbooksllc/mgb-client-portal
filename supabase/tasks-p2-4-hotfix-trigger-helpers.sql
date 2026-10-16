-- =====================================================================
-- Tasks Phase 2, S4 hotfix (S3 leftover a): signed-in task writes.
--
-- staff_reminders_before_write is SECURITY INVOKER. S3 made it call
-- tk__is_active_admin and tk__default_reviewer, which are revoked from
-- authenticated. Postgres checks EXECUTE when the trigger's IF expression
-- is planned (no short-circuit), so every direct insert or update of
-- staff_reminders by a signed-in user failed with
-- "permission denied for function tk__is_active_admin".
--
-- Fix: two gated SECURITY DEFINER wrappers that authenticated may execute.
-- They leak nothing a signed-in staff member cannot already see:
--   tk__trg_is_admin(email)               -> false unless the caller is
--                                            active staff (or no JWT)
--   tk__trg_default_reviewer(client, ex)  -> null unless the caller is
--                                            active staff with access to
--                                            that client (or no JWT)
-- The trigger calls the wrappers; the internal helpers stay revoked.
--
-- Safe to re-run, one transaction. Nothing is dropped. Proof:
-- supabase/tasks-p2-4-recurring-tests.sql section 1 runs a write as
-- role authenticated.
-- =====================================================================

create or replace function pg_temp.patch_fn(p_sig text, p_from text, p_to text, p_expected int)
returns void
language plpgsql
as $f$
declare
  d text;
  n int;
begin
  d := pg_get_functiondef(p_sig::regprocedure);
  if position(p_to in d) > 0 then
    return;  -- already patched
  end if;
  n := (length(d) - length(replace(d, p_from, ''))) / length(p_from);
  if n <> p_expected then
    raise exception 'patch_fn %: expected % occurrence(s) of anchor %, found %', p_sig, p_expected, p_from, n;
  end if;
  execute replace(d, p_from, p_to);
end
$f$;

-- No JWT (cron, SQL editor, a definer path with no user): the internal answer.
-- A signed-in caller must be active staff.
create or replace function public.tk__trg_is_admin(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null and coalesce(auth.jwt() ->> 'email', '') = '' then public.tk__is_active_admin(p_email)
    when public.is_active_staff() then public.tk__is_active_admin(p_email)
    else false
  end;
$$;

create or replace function public.tk__trg_default_reviewer(p_client text, p_exclude text[])
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null and coalesce(auth.jwt() ->> 'email', '') = '' then public.tk__default_reviewer(p_client, p_exclude)
    when public.is_active_staff() and (p_client is null or public.can_access_client(p_client))
      then public.tk__default_reviewer(p_client, p_exclude)
    else null
  end;
$$;

revoke all on function public.tk__trg_is_admin(text) from public, anon, authenticated;
revoke all on function public.tk__trg_default_reviewer(text, text[]) from public, anon, authenticated;
grant execute on function public.tk__trg_is_admin(text) to authenticated;
grant execute on function public.tk__trg_default_reviewer(text, text[]) to authenticated;

select pg_temp.patch_fn('public.staff_reminders_before_write()',
  'public.tk__is_active_admin(', 'public.tk__trg_is_admin(', 2);
select pg_temp.patch_fn('public.staff_reminders_before_write()',
  'public.tk__default_reviewer(', 'public.tk__trg_default_reviewer(', 1);
