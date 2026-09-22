-- Audit hardening, batch 3: QuickBooks OAuth state tokens.
-- Companion to the qbo-callback edge function change in the same commit.
--
-- Background
-- ----------
-- (a) The callback consumed the state token with a SELECT, then a separate
--     UPDATE ... set used = true. Two concurrent callbacks carrying the same
--     token both read used = false and both proceeded — the single-use
--     guarantee the token exists for was a check-then-act race. The function
--     now consumes it in one atomic UPDATE ... WHERE used = false ... RETURNING,
--     so exactly one caller can ever win.
--
-- (b) Nothing recorded WHO started a connect flow. qbo_connections.connected_by
--     existed but was never written, so a completed QuickBooks connection —
--     the single most sensitive integration in the product — had no attribution
--     at all. created_by is stamped server-side from the JWT at insert time
--     (the Connect button's insert is authenticated staff), and the callback
--     carries it across to qbo_connections.connected_by.
--
-- (c) Rows were never cleaned up. Every connect attempt, successful or
--     abandoned, left a permanent row; a token is worthless after 15 minutes
--     (STATE_MAX_AGE_MS in the edge function), so keeping a day of them is
--     already generous and leaves a short operational trail.

-- (a) is entirely in supabase/functions/qbo-callback/index.ts — no schema
--     change is needed for it, the atomic UPDATE works against the table as
--     it already stands.

-- (b) attribution
alter table qbo_connect_state add column if not exists created_by text;

-- Reuses the single stamping function from audit2-author-stamping.sql (which
-- carries the qbo_connect_state branch) — apply that file first.
drop trigger if exists stamp_author on qbo_connect_state;
create trigger stamp_author
  before insert on qbo_connect_state
  for each row execute function public.stamp_author_from_jwt();

-- (c) hourly cleanup. unschedule first so this file is re-runnable; the guard
--     is needed because cron.unschedule() raises if the job doesn't exist.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'qbo-connect-state-cleanup') then
    perform cron.unschedule('qbo-connect-state-cleanup');
  end if;
end
$$;

select cron.schedule(
  'qbo-connect-state-cleanup',
  '0 * * * *',
  $$delete from qbo_connect_state where created_at < now() - interval '1 day'$$
);
